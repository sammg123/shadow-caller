"""The backend gaps over HTTP (ui-architecture.md Appendix B #5, #7, #8 and its v1.2 note) on the shared sandboxed
server: offline, the saved TB at DAL game, a temp data folder. Never the live game. Every test sets its own state."""
import json
import urllib.error
import urllib.request

from helpers import EVENT, get, post, request_json


def send(base, path, body):
    """(status, parsed body) of a POST, 4xx answers included (urlopen raises on those)."""
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def test_versions_only_go_up(server):                     # G8, #91: another window refreshes after every change
    base = server["base"]
    post(base, "/api/feed", {"on": False})
    seen = [get(base + "/api/version")["version"]]
    steps = (("/api/reset", {}), ("/api/command", {"text": "new D25"}), ("/api/play", {"leaf": "run_inside", "yards": 4}),
             ("/api/undo", {}), ("/api/feed/replay", {"event_id": EVENT}), ("/api/reset", {}))
    for path, body in steps:
        out = post(base, path, body)
        v = get(base + "/api/version")["version"]
        assert out["version"] == v and not out.get("error"), path
        seen.append(v)
    assert all(a < b for a, b in zip(seen, seen[1:])), seen


def test_a_field_goal_off_the_field_is_refused(server):    # G22, #85
    base = server["base"]
    post(base, "/api/reset")
    for path, body in (("/api/drive", {"end": "fg"}), ("/api/command", {"text": "fg"})):
        status, out = send(base, path, body)
        assert status == 400 and "No DAL drive in progress" in out["error"], path
        assert (out["sit"]["score_off"], out["drive_active"]) == (0, False)
    status, out = send(base, "/api/drive", {"end": "touchdown"})
    assert status == 400 and "punt, fg, fg_miss or half" in out["error"]
    post(base, "/api/command", {"text": "new D25"})
    status, out = send(base, "/api/drive", {"end": "fg"})
    assert status == 200 and (out["sit"]["score_off"], out["drive_active"]) == (3, False)


def test_until_game_facts_and_espns_box(server):           # Appendix B #8, v1.2
    base = server["base"]
    post(base, "/api/feed", {"on": False})
    post(base, "/api/feed/replay", {"event_id": EVENT})
    full = get(base + "/api/timeline?since=0")
    assert (full["box_source"], full["box_espn"]["DAL"]["yards"], full["box_espn"]["TB"]["top"]) == ("espn", 366, "39:21")
    assert full["game"] == {"kickoff": "2026-10-09T00:15:00Z", "kickoff_local": "2026-10-08T19:15:00-05:00",
                            "venue": "AT&T Stadium", "city": "Arlington", "indoor": None, "grass": False,
                            "light": "night"}
    part = get(f"{base}/api/timeline?since=100&until=104&epoch={full['epoch']}")
    assert ([r["seq"] for r in part["rows"]], part["n"], part["until"], part["reset"]) == ([101, 102, 103, 104], 104, 104, False)
    assert (part["status"]["last_seq"], part["status"]["score"], part["box_espn"], part["box_source"]) == \
        (104, {"DAL": 10, "TB": 14}, None, "derived")
    assert "game" not in part and "until" not in full
    for bad in ("x", "-1", "1.5", "", "%D9%A3", "99999999999"):
        assert request_json(f"{base}/api/timeline?since=0&until={bad}") == (400, {"error": "until must be a whole number"})
    assert request_json(f"{base}/api/timeline?since=5&until=4") == (400, {"error": "until can't be before since"})

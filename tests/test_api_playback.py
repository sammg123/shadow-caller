"""Playback over HTTP (docs/design/restructure-v2.md section 9) on the sandboxed server: offline, the saved TB at DAL
game, a temp data folder, SHADOW_WATCH_SCALE unset. Never the live game. /api/open, /api/watch/seek, back and forward,
/api/golive, the watch object's marks and game, and GET /report (on an app of its own with a temp static folder)."""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

import pytest
from helpers import ESPN_FILE, EVENT, ROOT, get
from test_api_safety import own_server

JSON = {"Content-Type": "application/json"}
SESSION = ("playing", "paused", "done", "error")
PLAYBACK_POSTS = ("/api/open", "/api/watch/seek", "/api/watch/back", "/api/watch/forward", "/api/golive")
LIVE_EVENT, FOREIGN_EVENT = "401872123", "401872124"
SECURITY = ("Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "Cross-Origin-Opener-Policy")


def call(base, path, data=b"{}", headers=None):
    """(status, body bytes) of a POST sent with exactly these headers, 4xx answers included."""
    req = urllib.request.Request(base + path, data=data, method="POST", headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def send(base, path, body=None, raw=None):
    status, out = call(base, path, raw if raw is not None else json.dumps({} if body is None else body).encode(), JSON)
    return status, json.loads(out.decode())


def backups(data):
    return len(list(data.glob("live_state.backup-*.json")))


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    """This module's own sandboxed app (offline, the saved game, a temp data folder): its sessions, backups and planted
    events never reach the server the other API tests share (backups prune at 20, and the game on screen is what
    seek, back and forward work on)."""
    data = tmp_path_factory.mktemp("playback") / "data"
    data.mkdir()
    with own_server(data) as s:
        yield s


@pytest.fixture
def srv(server):
    """The shared sandbox server, idle before and after each test: no session (the game put back) and the feed off."""
    base = server["base"]

    def idle():
        if get(base + "/api/watch")["state"] in SESSION:
            send(base, "/api/watch/stop", {"restore": True})
        send(base, "/api/feed", {"on": False})
    idle()
    yield server
    idle()


def saved_game_on_screen(base):
    """No session, the feed off, and the saved TB at DAL game on screen again: a test that followed another event leaves
    that event's game behind (the game on screen is what seek, back and forward work on)."""
    if get(base + "/api/watch")["state"] in SESSION:
        send(base, "/api/watch/stop", {"restore": True})
    send(base, "/api/feed", {"on": False})
    assert send(base, "/api/feed/replay", {"event_id": EVENT})[0] == 200


def plant(data, event, n=None, state="in", home=None):
    """A saved game for `event` (offline mode reads summary_<event>_final.json): the TB at DAL game cut to its first n
    plays, its header saying `state`, and with home/away renamed when `home` is given ((away, home) abbreviations)."""
    s = json.loads(ESPN_FILE.read_text())
    keep = [str(p["id"]) for d in s["drives"]["previous"] for p in d["plays"]][:n]
    drives = [{**d, "plays": [p for p in d["plays"] if str(p["id"]) in set(keep)]} for d in s["drives"]["previous"]]
    s["drives"] = {"previous": [d for d in drives if d["plays"]]}
    comp = s["header"]["competitions"][0]
    comp["status"]["type"].update(state=state, shortDetail="2:58 - 3rd")
    for c in comp["competitors"] if home else ():
        c["team"]["abbreviation"] = home[1] if c["homeAway"] == "home" else home[0]
    path = data / "espn" / f"summary_{event}_final.json"
    path.write_text(json.dumps(s))
    return path


# ---------------------------------------------------------------- open and Go Live
def test_open_shows_a_finished_game_paused_at_kickoff_and_changes_nothing_after(srv):
    base, data = srv["base"], srv["data"]
    assert send(base, "/api/command", {"text": "new D25"})[0] == 200      # a game on screen for open to back up
    n = backups(data)
    status, out = send(base, "/api/open")
    w = out["watch"]
    assert status == 200 and (w["state"], w["idx"], w["total"], w["event_id"]) == ("paused", 0, 183, EVENT)
    assert w["game"] == {"status": "post", "detail": "Final"} and len(w["marks"]) == 32 and backups(data) == n + 1
    assert (out["log"], out["timeline"]["n"], out["timeline"]["mode"]) == ([], 0, "watch")
    v = get(base + "/api/version")
    status, again = send(base, "/api/open")                     # a session on screen: nothing changes
    assert status == 200 and get(base + "/api/version") == v and again["watch"] == get(base + "/api/watch")
    status, out = send(base, "/api/golive")                     # offline, the saved final: the final path
    assert status == 200 and (out["watch"]["state"], out["watch"]["idx"], out["timeline"]["n"]) == ("done", 183, 183)
    assert out["feed"]["on"] is False and backups(data) == n + 1   # the session's restore point is kept
    assert (out["sit"]["score_off"], out["sit"]["score_opp"]) == (16, 24)
    assert send(base, "/api/open")[1]["watch"]["state"] == "done"


def test_golive_follows_a_game_in_progress(srv):
    base, data = srv["base"], srv["data"]
    planted = plant(data, LIVE_EVENT, 133)
    try:
        assert send(base, "/api/watch/start", {"event_id": LIVE_EVENT, "speed": 0.5})[0] == 200
        assert send(base, "/api/watch/seek", {"idx": 30})[1]["watch"]["idx"] == 30
        n = backups(data)
        status, out = send(base, "/api/golive")
        w = out["watch"]
        assert status == 200 and (out["feed"]["on"], out["feed"]["event_id"]) == (True, LIVE_EVENT)
        assert (w["state"], w["idx"], w["total"], w["game"]) == ("stopped", 133, 133, {"status": "in",
                                                                                         "detail": "2:58 - 3rd"})
        assert (out["timeline"]["n"], out["timeline"]["mode"], backups(data)) == (133, "live", n)
        assert not (data / "watch_session.json").exists()        # the session ended keeping the game
        status, again = send(base, "/api/open")                  # the live feed is on: nothing changes
        assert status == 200 and again["feed"]["on"] and again["timeline"]["epoch"] == out["timeline"]["epoch"]
        status, out = send(base, "/api/watch/forward")           # live: nothing past the newest play
        assert status == 409 and out["error"] == "Already at the last play."
        status, out = send(base, "/api/watch/back")              # back from live: one drawn play back, feed off
        assert status == 200 and (out["watch"]["state"], out["watch"]["idx"]) == ("paused", 132)
        assert out["feed"]["on"] is False
        assert out["watch"]["feed_was_on"] is True and backups(data) == n + 1
    finally:
        planted.unlink()
        saved_game_on_screen(base)


def test_golive_refuses_another_matchup_and_changes_nothing(srv):
    base, data = srv["base"], srv["data"]
    planted = plant(data, FOREIGN_EVENT, 40, home=("NYG", "PHI"))
    try:
        assert send(base, "/api/watch/start", {"event_id": FOREIGN_EVENT, "speed": 0.5})[0] == 200
        assert send(base, "/api/watch/seek", {"idx": 5})[0] == 200
        before, v = get(base + "/api/watch"), get(base + "/api/version")
        status, out = send(base, "/api/golive")
        assert status == 400 and out["error"] == f"ESPN event {FOREIGN_EVENT} is NYG at PHI, not DAL v TB."
        assert get(base + "/api/watch") == before and get(base + "/api/version") == v and out["feed"]["on"] is False
    finally:
        planted.unlink()
        saved_game_on_screen(base)


# ---------------------------------------------------------------- seek, back, forward
def test_seek_back_and_forward_over_http(srv):
    base = srv["base"]
    status, out = send(base, "/api/watch/seek", {"idx": 40})
    w = out["watch"]
    assert status == 200 and (w["state"], w["idx"], w["ff_until"], out["timeline"]["n"]) == ("paused", 40, 40, 40)
    v = get(base + "/api/version")
    assert v["timeline_n"] == v["watch"]["idx"] == 40 and not {"marks", "game"} & set(v["watch"])
    assert {"marks", "game"} <= set(get(base + "/api/watch")) & set(get(base + "/api/state")["watch"])
    rows = get(base + "/api/timeline?since=0")
    assert (rows["n"], rows["mode"], rows["rows"][0]["id"]) == (40, "watch", "40187298040")
    status, out = send(base, "/api/watch/forward")
    assert status == 200 and (out["watch"]["idx"], out["watch"]["state"]) == (41, "paused")
    status, out = send(base, "/api/watch/back")
    assert status == 200 and (out["watch"]["idx"], out["watch"]["state"]) == (40, "paused")
    assert send(base, "/api/watch/seek", {"idx": 0})[1]["watch"]["idx"] == 0          # Reset
    status, out = send(base, "/api/watch/back")
    assert status == 409 and out["error"] == "Already at kickoff." and "sit" in out
    status, out = send(base, "/api/watch/seek", {"idx": 183})
    assert status == 200 and out["watch"]["state"] == "done"
    status, out = send(base, "/api/watch/forward")
    assert status == 409 and out["error"] == "Already at the last play."


def test_a_burst_of_seeks_keeps_one_backup(srv):
    base, data = srv["base"], srv["data"]
    n = backups(data)
    for idx in (5, 120, 0, 183, 60) * 5:
        assert send(base, "/api/watch/seek", {"idx": idx})[0] == 200
    assert backups(data) == n + 1


def test_playback_bodies_are_validated(srv):
    base = srv["base"]
    before = get(base + "/api/watch")
    for body in ({}, {"idx": "3"}, {"idx": True}, {"idx": 1.5}, {"idx": 2.0}, {"idx": -1}, {"idx": 184}, {"idx": None},
                 {"idx": 3, "x": 1}, [3]):
        status, out = send(base, "/api/watch/seek", body)
        assert status == 400 and out["error"] and "sit" in out, body
    for path in PLAYBACK_POSTS:
        status, out = send(base, path, raw=b"{not json")
        assert status == 400 and "JSON" in out["error"], path
    for path in PLAYBACK_POSTS[:1] + PLAYBACK_POSTS[2:]:
        status, out = send(base, path, {"idx": 3})
        assert status == 400 and "idx" in out["error"], path
    assert get(base + "/api/watch") == before


def test_only_this_machines_page_can_use_playback(srv):
    base, port = srv["base"], srv["port"]
    before = get(base + "/api/watch")
    refused = (({"Content-Type": "text/plain"}, 415), ({}, 415), ({**JSON, "Origin": "http://evil.example"}, 403),
               ({**JSON, "Origin": "null"}, 403), ({**JSON, "Host": f"evil.example:{port}"}, 400))
    for path in PLAYBACK_POSTS:
        for headers, status in refused:
            assert call(base, path, b'{"idx": 3}' if path.endswith("seek") else b"{}", headers)[0] == status, \
                (path, headers)
    assert get(base + "/api/watch") == before


# ---------------------------------------------------------------- GET /report, and ESPN out of reach (an app alone)
PROBE = r'''
import json, sys, urllib.error
sys.path.insert(0, {root!r})
import espn_feed


def unreachable(*args, **kwargs):
    raise urllib.error.URLError("network is unreachable")


espn_feed.fetch_summary = espn_feed.fetch_json = unreachable
import app

client = app.app.test_client()


def answer(r):
    body = r.get_json(silent=True)
    return {{"status": r.status_code, "type": r.mimetype, "text": r.get_data(as_text=True)[:200],
            "error": body.get("error") if isinstance(body, dict) else None,
            "state_body": isinstance(body, dict) and "sit" in body,
            "headers": {{k: r.headers.get(k) for k in {security!r}}}}}


out = {{}}
app.app.static_folder = {with_page!r}
out["report"], out["index"] = answer(client.get("/report")), answer(client.get("/"))
out["rebound"] = answer(client.get("/report", headers={{"Host": "evil.example"}}))
app.app.static_folder = {without_page!r}
out["missing"] = answer(client.get("/report"))
before = client.get("/api/version").get_json()
for path, body in (("/api/golive", {{}}), ("/api/open", {{}}), ("/api/watch/seek", {{"idx": 0}}),
                   ("/api/watch/back", {{}}), ("/api/watch/forward", {{}})):
    out[path] = answer(client.post(path, json=body))
out["unchanged"] = client.get("/api/version").get_json() == before
print(json.dumps(out))
'''


def test_report_page_is_served_like_the_home_page_and_espn_out_of_reach_is_a_503(tmp_path):
    with_page, without_page, data = tmp_path / "with", tmp_path / "without", tmp_path / "data"
    for folder in (with_page, without_page, data):
        folder.mkdir()
    for folder in (with_page, without_page):
        (folder / "index.html").write_text("<!doctype html><title>GameCast</title>")
    (with_page / "report.html").write_text("<!doctype html><title>Model Report</title>")
    env = {**os.environ, "SHADOW_DATA_DIR": str(data), "SHADOW_ESPN_OFFLINE": "", "SHADOW_NO_BROWSER": "1"}
    code = PROBE.format(root=str(ROOT), security=SECURITY, with_page=str(with_page), without_page=str(without_page))
    run = subprocess.run([sys.executable, "-c", code], cwd=tmp_path, env=env, capture_output=True, text=True,
                         timeout=120)
    assert run.returncode == 0, run.stderr
    out = json.loads(run.stdout.strip().splitlines()[-1])
    report, index = out["report"], out["index"]
    assert (report["status"], report["type"]) == (200, "text/html") and "Model Report" in report["text"]
    assert report["headers"] == index["headers"] and all(report["headers"].values())
    assert out["rebound"]["status"] == 400 and "Model Report" not in out["rebound"]["text"]
    assert out["missing"]["status"] == 404 and out["missing"]["error"]
    for path in ("/api/golive", "/api/open", "/api/watch/seek", "/api/watch/back", "/api/watch/forward"):
        assert out[path]["status"] == 503 and "ESPN" in out[path]["error"] and out[path]["state_body"], path
    assert out["unchanged"] is True

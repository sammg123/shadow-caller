"""/api/timeline over HTTP (data contract G23) on a sandboxed server: offline, the saved TB at DAL game, a temp data
folder. Never the live game."""
from helpers import EVENT, get, post, request_json


def test_since_and_epoch(server):
    base = server["base"]
    before = get(base + "/api/version")
    post(base, "/api/feed/replay", {"event_id": EVENT})
    v = get(base + "/api/version")
    assert v["epoch"] != before["epoch"] and v["timeline_n"] == 183           # a replay starts a new timeline

    full = get(base + "/api/timeline?since=0")
    assert (full["reset"], full["n"], len(full["rows"]), full["source"], full["mode"]) == (True, 183, 183, "espn", "replay")
    assert full["epoch"] == v["epoch"] and full["teams"]["DAL"]["caller"] and full["status"]["state"] == "post"
    assert get(base + "/api/state")["timeline"] == {"n": 183, "epoch": full["epoch"], "source": "espn", "mode": "replay"}

    part = get(f"{base}/api/timeline?since=100&epoch={full['epoch']}")
    assert [r["seq"] for r in part["rows"]] == list(range(101, 184))
    assert (part["reset"], part["since"], "teams" in part, len(part["drives"])) == (False, 100, False, 21)

    wrong = get(f"{base}/api/timeline?since=100&epoch=stale")
    assert wrong["reset"] and wrong["since"] == 0 and len(wrong["rows"]) == 183 and "meta" in wrong

    for bad in ("x", "-1", "1.5", "", "99999999999", "%D9%A3", "%EF%BC%93"):     # Arabic-Indic and fullwidth 3
        assert request_json(f"{base}/api/timeline?since={bad}") == (400, {"error": "since must be a whole number"})

    post(base, "/api/reset")
    after = get(base + "/api/version")
    assert after["epoch"] not in (full["epoch"], before["epoch"]) and after["timeline_n"] == 0
    empty = get(f"{base}/api/timeline?since=183&epoch={full['epoch']}")
    assert (empty["reset"], empty["n"], empty["rows"], empty["source"], empty["status"]["state"]) == (True, 0, [], "log", "pre")


def test_undo_in_manual_mode_starts_a_new_timeline(server):
    base = server["base"]
    post(base, "/api/reset")
    post(base, "/api/command", {"text": "new D25"})
    post(base, "/api/play", {"leaf": "run_ot_left", "yards": 6})
    v = get(base + "/api/version")
    rows = get(f"{base}/api/timeline?since=0&epoch={v['epoch']}")
    assert (rows["source"], rows["mode"], rows["n"], rows["rows"][0]["id"]) == ("log", "manual", 1, "log-1")
    post(base, "/api/undo")
    after = get(base + "/api/version")
    assert after["epoch"] != v["epoch"] and after["timeline_n"] == 0

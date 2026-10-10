"""Watch mode over HTTP (data contract E1, E4, G32) on the sandboxed server: offline, the saved TB at DAL game, a temp
data folder, SHADOW_WATCH_SCALE unset (real pace). Never the live game."""
import json
import time
import urllib.error
import urllib.request

import pytest
from helpers import EVENT, get, post

SLOW = 0.5            # speed: the opening kickoff lands 10 s after a start, so a session sits at row 0 during a test
WATCH_KEYS = {"state", "event_id", "speed", "idx", "total", "next_at", "skipped", "next_kind", "ff_until",
              "started_at", "feed_was_on", "backup", "error"}


def send(base, path, body=None, raw=None):
    """(status, parsed body) of a POST, 4xx answers included (urlopen raises on those)."""
    data = raw if raw is not None else json.dumps({} if body is None else body).encode()
    req = urllib.request.Request(base + path, data=data, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


@pytest.fixture
def srv(server):
    """The shared sandbox server. A session a test leaves behind is stopped, with the game put back, after it."""
    yield server
    if get(server["base"] + "/api/watch")["state"] in ("playing", "paused", "done", "error"):
        send(server["base"], "/api/watch/stop", {"restore": True})


def test_watch_start_validates_its_input(srv):
    base = srv["base"]
    before = get(base + "/api/watch")
    bad = [{"event_id": "abc"}, {"event_id": "12345"}, {"event_id": "../401872980"}, {"event_id": True},
           {"event_id": EVENT, "speed": 0.4}, {"event_id": EVENT, "speed": 10.5}, {"event_id": EVENT, "speed": "4"},
           {"event_id": EVENT, "from_seq": -1}, {"event_id": EVENT, "from_seq": 184}, {"event_id": EVENT, "from_seq": 2.5},
           {"event_id": EVENT, "bogus": 1}, [EVENT]]
    for body in bad:
        status, out = send(base, "/api/watch/start", body)
        assert status == 400 and out["error"] and "sit" in out, body      # the state body comes along, as on every POST
    assert send(base, "/api/watch/start", raw=b'{"event_id": "401872980", "speed": NaN}')[0] == 400
    status, out = send(base, "/api/watch/start", {"event_id": "401872999"})    # offline, and no saved copy of it
    assert status == 400 and "no saved game" in out["error"] and "/" not in out["error"]   # no server paths (G26)
    for path in ("/api/watch/pause", "/api/watch/resume", "/api/watch/step", "/api/watch/stop"):
        assert send(base, path)[0] == 409, path                                 # no session to act on
    assert send(base, "/api/watch/pause", {"x": 1})[0] == 400
    assert get(base + "/api/watch") == before


def test_feed_cannot_start_while_watching(srv):              # G32
    base = srv["base"]
    status, out = send(base, "/api/watch/start", {"event_id": EVENT, "speed": SLOW})
    assert status == 200 and out["watch"]["state"] == "playing"
    status, out = send(base, "/api/feed", {"on": True})
    assert status == 409 and "watch" in out["error"].lower() and out["feed"]["on"] is False
    assert get(base + "/api/version")["feed"]["on"] is False


def test_watch_session_over_http(srv):
    base = srv["base"]
    post(base, "/api/reset")
    post(base, "/api/command", {"text": "new D25"})
    pre = post(base, "/api/play", {"leaf": "run_ot_left", "yards": 6})          # the game a watch must put back

    status, out = send(base, "/api/watch/start", {"event_id": EVENT, "speed": SLOW, "from_seq": 0})
    assert status == 200 and set(out["watch"]) == WATCH_KEYS
    w = out["watch"]
    assert (w["state"], w["event_id"], w["speed"], w["idx"], w["total"], w["next_kind"]) == \
        ("playing", EVENT, 0.5, 0, 183, "kick")
    assert (srv["data"] / w["backup"]["state"]).exists() and (srv["data"] / w["backup"]["seen"]).exists()
    assert out["log"] == [] and out["timeline"]["mode"] == "watch" and out["timeline"]["n"] == 0
    assert out["timeline"]["epoch"] != pre["timeline"]["epoch"]
    v = get(base + "/api/version")
    assert set(v["watch"]) == {"state", "event_id", "idx", "total", "speed", "next_at", "next_kind", "skipped", "error"}
    assert v["watch"]["next_kind"] == "kick"                                    # v1.4: the pace of the row it waits on
    assert v["watch"]["next_at"] > time.time() * 1000 + 5000                    # 5 s x 1 / 0.5: about 10 s away

    for path, body in (("/api/watch/start", {"event_id": EVENT}), ("/api/watch/step", {}), ("/api/reset", {}),
                       ("/api/feed/replay", {"event_id": EVENT})):
        status, out = send(base, path, body)
        assert status == 409 and out["error"] and "sit" in out, path
    assert send(base, "/api/watch/speed", {"speed": 11})[0] == 400
    status, out = send(base, "/api/watch/speed", {"speed": 2})
    assert status == 200 and out["watch"]["speed"] == 2.0

    for _ in range(2):                                                          # pause is idempotent
        status, out = send(base, "/api/watch/pause")
        assert status == 200 and out["watch"]["state"] == "paused" and out["watch"]["next_at"] is None
    status, out = send(base, "/api/watch/step")
    assert status == 200 and out["watch"]["idx"] == 1 and out["timeline"]["n"] == 1
    v = get(base + "/api/version")
    assert v["timeline_n"] == v["watch"]["idx"] == 1
    rows = get(base + "/api/timeline?since=0")
    assert (rows["mode"], rows["n"], [r["id"] for r in rows["rows"]]) == ("watch", 1, ["40187298040"])
    assert set(get(base + "/api/watch")) == WATCH_KEYS
    status, out = send(base, "/api/watch/resume")
    assert status == 200 and out["watch"]["state"] == "playing"

    assert send(base, "/api/watch/stop", {"restore": "yes"})[0] == 400
    status, out = send(base, "/api/watch/stop", {"restore": True})
    assert status == 200 and out["watch"]["state"] == "stopped"
    assert (out["log"], out["sit"], out["drive_n"]) == (pre["log"], pre["sit"], pre["drive_n"])
    assert out["timeline"]["mode"] == pre["timeline"]["mode"] and out["timeline"]["epoch"] != rows["epoch"]
    assert out["version"] > v["version"]
    assert send(base, "/api/watch/stop")[0] == 409


def test_replay_stops_the_feed_and_backs_up_both_files(srv):          # data contract E6
    base, data = srv["base"], srv["data"]
    count = lambda pattern: len(list(data.glob(pattern)))              # noqa: E731
    post(base, "/api/feed", {"on": True, "event_id": "401872999"})    # offline with no saved copy: polls fail, apply nothing
    before = count("live_state.backup-*.json"), count("feed_seen.json.backup-*")
    status, out = send(base, "/api/feed/replay", {"event_id": EVENT})
    assert status == 200 and out["feed"]["on"] is False and out["feed"]["event_id"] == EVENT
    assert (out["sit"]["score_off"], out["sit"]["score_opp"], out["timeline"]["n"]) == (16, 24, 183)
    assert (count("live_state.backup-*.json"), count("feed_seen.json.backup-*")) == (before[0] + 1, before[1] + 1)


def wait_until(cond, timeout=60.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.1)
    return cond()


def test_a_finished_watch_keeps_the_screen_until_stopped(srv):
    """done still shows the watched game, with the pre-watch game behind it: reset, replay and the live feed wait
    for Stop instead of replacing it (and a later Stop putting back a stale game over the new one)."""
    base = srv["base"]
    post(base, "/api/reset")
    post(base, "/api/command", {"text": "new D25"})
    mine = post(base, "/api/play", {"leaf": "run_inside", "yards": 4})
    status, out = send(base, "/api/watch/start", {"event_id": EVENT, "speed": 10, "from_seq": 183})   # all at once
    assert status == 200
    assert wait_until(lambda: get(base + "/api/watch")["state"] == "done")
    for path, body in (("/api/reset", {}), ("/api/feed", {"on": True}), ("/api/feed/replay", {"event_id": EVENT})):
        status, out = send(base, path, body)
        assert status == 409 and "Stop" in out["error"] and out["watch"]["state"] == "done", path
    status, out = send(base, "/api/watch/stop", {"restore": True})
    assert status == 200 and out["log"] == mine["log"] and out["feed"]["on"] is False


def test_garbled_watch_bodies_are_refused(srv):
    """A body that isn't JSON is a 400, never 'no fields': a cut-off stop {"restore": true} must not keep the
    watched game, and a cut-off start must not wipe the game with the defaults."""
    base = srv["base"]
    before = get(base + "/api/state")
    status, out = send(base, "/api/watch/start", raw=b"{not json")
    assert status == 400 and "JSON" in out["error"] and out["log"] == before["log"]
    assert get(base + "/api/watch")["state"] not in ("playing", "paused")
    status, out = send(base, "/api/watch/start", {"event_id": EVENT, "speed": SLOW})
    assert status == 200
    status, out = send(base, "/api/watch/stop", raw=b'{"restore": tru')
    assert status == 400 and get(base + "/api/watch")["state"] == "playing"


def test_an_unexpected_error_is_a_500_with_its_traceback_in_the_log(srv):
    base, data = srv["base"], srv["data"]
    broken = data / "espn" / "summary_401872001_final.json"
    broken.write_text(json.dumps({"drives": "not a list"}))       # v1.4 (G1-6): a shape the feed now reads as no plays
    try:
        status, out = send(base, "/api/watch/start", {"event_id": "401872001"})
    finally:
        broken.unlink()
    assert status == 400 and "no plays" in out["error"]
    broken.write_text("[" * 100_000 + "]" * 100_000)              # valid JSON nothing can decode: RecursionError
    try:
        status, out = send(base, "/api/watch/start", {"event_id": "401872001"})
    finally:
        broken.unlink()
    assert status == 500 and "server log" in out["error"] and "recursion" not in out["error"].lower()
    assert get(base + "/api/watch")["state"] not in ("playing", "paused")
    assert wait_until(lambda: "RecursionError" in srv["log"].read_text(), 5)

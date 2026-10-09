"""Watch mode (docs/design/data-contract.md section E, tests G26 to G31, G33, G34) on the real TB at DAL game.

Pure: a Watch over a sandboxed engine and feed (make_feed), never Flask, never data/live_state.json. Pacing is
scaled down (SHADOW_WATCH_SCALE 0.001 for whole games), except where a test needs a long wait to look into."""
import copy
import json
import os
import subprocess
import sys
import threading
import time

import duckdb
import pytest
from helpers import ESPN_EVENT, ESPN_FILE, ROOT, TEST_GAME

import espn_feed
import live
import timeline as tl
import watch as wm
from espn_feed import iter_plays
from watch import Watch, WatchError

FAST = 0.001                     # SHADOW_WATCH_SCALE for whole games: about 0.1 s of pacing at 10x
FIRST_KICKOFF = "40187298040"


def wait_for(cond, timeout=10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.005)
    return cond()


def conflict(fn, *args):
    with pytest.raises(WatchError) as ex:
        fn(*args)
    return ex.value


@pytest.fixture
def watches():
    """Watch sessions a test makes; each is stopped and its thread gone before the next test starts."""
    made = []

    def make(feed, scale):
        w = Watch(feed, feed.lock, pace_scale=scale)
        made.append(w)
        return w
    yield make
    for w in made:
        if w.snapshot()["state"] in ("playing", "paused"):
            w.stop()
        assert w.join(timeout=10), "a watch thread outlived its test"


@pytest.fixture(scope="module")
def watched(make_feed, summary):
    """A whole game watched at 10x with FAST pacing. Records every apply_one: the engine version before and after,
    and how many plays the feed had applied; and samples (idx, applied) under LOCK while it plays."""
    e, feed = make_feed()
    w = Watch(feed, feed.lock, pace_scale=FAST)
    calls, samples = [], []
    real = feed.apply_one

    def spy(team, p, save=True):
        before = e.state.get("version", 0)
        logged = real(team, p, save=save)
        calls.append((before, e.state.get("version", 0), len(feed.applied)))
        return logged
    feed.apply_one = spy
    t0 = time.monotonic()
    w.start(ESPN_EVENT, summary, speed=10)
    while w.snapshot()["state"] == "playing" and time.monotonic() - t0 < 120:
        with feed.lock:                      # the thread moves idx and applied together, inside LOCK
            samples.append((w.idx, len(feed.applied)))
        time.sleep(0.02)
    assert w.join(timeout=10)
    return {"watch": w, "engine": e, "feed": feed, "calls": calls, "samples": samples,
            "seconds": time.monotonic() - t0}


# ---------------------------------------------------------------- E3: pacing
def test_pacing_table_matches_the_contract(summary):
    plan = wm.pace_plan(iter_plays(summary), "DAL")
    seconds = [s for kind, s in plan]
    counts = {s: seconds.count(s) for s in set(seconds)}
    assert counts == {7.0: 60, 4.0: 78, 5.0: 18, 1.0: 23, 3.0: 4}
    assert sum(seconds) == 857.0                        # 14:17 at 1x; 214 s at 4x, 86 s at 10x
    assert round(sum(seconds) / 4) == 214 and round(sum(seconds) / 10) == 86
    assert plan[0] == ("kickoff", 5.0) and plan[1] == ("play", 7.0)      # DAL receives, then DAL's first snap
    assert plan[-1] == ("admin", 3.0)                                   # END GAME
    kinds = {k for k, s in plan}
    assert kinds == {"play", "admin", "kickoff", "penalty", "punt", "fg", "kneel"}


def run_py(code, env_extra):
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env={**os.environ, **env_extra},
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()


def test_watch_scale_comes_from_the_environment():
    code = "import config; print(config.WATCH_SCALE)"
    assert run_py(code, {"SHADOW_WATCH_SCALE": ""}) == "1.0"
    assert run_py(code, {"SHADOW_WATCH_SCALE": "0.001"}) == "0.001"
    refuse = "try:\n    import config\nexcept ValueError as e:\n    print('refused', e)"
    for bad in ("abc", "0", "-1", "nan", "inf"):
        got = run_py(refuse, {"SHADOW_WATCH_SCALE": bad})
        assert got.startswith("refused") and "SHADOW_WATCH_SCALE" in got, bad


# ---------------------------------------------------------------- E1: request validation (pure)
def test_start_body_is_validated():
    assert wm.parse_start(None, ESPN_EVENT) == (ESPN_EVENT, 4.0, 0)
    assert wm.parse_start({"event_id": "401872980", "speed": 10, "from_seq": 183}, None) == ("401872980", 10.0, 183)
    assert wm.parse_start({"event_id": 401872980, "speed": 0.5}, None) == ("401872980", 0.5, 0)
    assert wm.parse_start({"event_id": ""}, ESPN_EVENT)[0] == ESPN_EVENT
    bad = [["401872980"], "401872980", {"event_id": "abc"}, {"event_id": "12345"}, {"event_id": "4018729801234"},
           {"event_id": "../401872980"}, {"event_id": "401872980\n"}, {"event_id": "٤٠١٨٧٢٩٨٠"}, {"event_id": True},
           {"event_id": 4.0e8}, {"speed": 0.4}, {"speed": 10.01}, {"speed": "4"}, {"speed": None}, {"speed": True},
           {"speed": float("nan")}, {"speed": float("inf")}, {"from_seq": -1}, {"from_seq": 1.5}, {"from_seq": "3"},
           {"from_seq": True}, {"from_seq": None}, {"speeed": 4}]
    for body in bad:
        err = conflict(wm.parse_start, body, ESPN_EVENT)
        assert err.status == 400 and str(err), body
    assert "event id" in str(conflict(wm.parse_start, {}, None))           # nothing to fall back on
    assert "speeed" in str(conflict(wm.parse_start, {"speeed": 4}, ESPN_EVENT))


def test_other_bodies_are_validated():
    assert wm.parse_speed({"speed": 8}) == 8.0
    assert wm.parse_stop(None) is False and wm.parse_stop({"restore": True}) is True
    assert wm.parse_empty(None) is None and wm.parse_empty({}) is None
    for fn, body in [(wm.parse_speed, {}), (wm.parse_speed, {"speed": 20}), (wm.parse_speed, {"speed": 4, "x": 1}),
                     (wm.parse_stop, {"restore": "yes"}), (wm.parse_stop, {"restore": 1}), (wm.parse_stop, [True]),
                     (wm.parse_empty, {"step": 2}), (wm.parse_empty, "x")]:
        assert conflict(fn, body).status == 400, body


def test_load_game_prefers_the_saved_final_and_says_when_there_is_none(sandbox, monkeypatch):
    espn_feed.RAW_DIR.mkdir(exist_ok=True)
    saved = espn_feed.RAW_DIR / ESPN_FILE.name
    saved.write_bytes(ESPN_FILE.read_bytes())
    monkeypatch.setattr(espn_feed, "fetch_summary", lambda eid: pytest.fail("the saved game needs no network"))
    try:
        assert len(wm.load_game(ESPN_EVENT)["drives"]["previous"]) == 21
    finally:
        saved.unlink()
    monkeypatch.undo()
    monkeypatch.setattr(espn_feed, "ESPN_OFFLINE", True)
    with pytest.raises(FileNotFoundError, match="no saved game"):
        wm.load_game("401872999")
    with pytest.raises(ValueError):
        wm.load_game("../x")


# ---------------------------------------------------------------- 26: backup, then reset
def test_watch_backs_up_state_and_seen_then_resets(make_feed, summary, sandbox, watches):
    e, feed = make_feed()
    feed.summary = summary
    for team, p in iter_plays(summary)[:20]:
        feed.apply_one(team, p)
    e.set_situation(qtr=e.state["sit"]["qtr"])                    # an undo step of Sam's after the last ESPN play
    assert e.state["log"] and e.history                           # a game in progress, with undo steps
    state_bytes, seen_bytes = live.STATE_PATH.read_bytes(), espn_feed.SEEN_PATH.read_bytes()
    w = watches(feed, 1.0)
    w.start(ESPN_EVENT, summary, speed=0.5)                        # the opening kickoff lands in 10 s
    snap = w.snapshot()
    assert (sandbox / snap["backup"]["state"]).read_bytes() == state_bytes
    assert (sandbox / snap["backup"]["seen"]).read_bytes() == seen_bytes
    assert snap["backup"]["state"].startswith("live_state.backup-") and snap["backup"]["state"].endswith(".json")
    assert snap["backup"]["seen"].startswith("feed_seen.json.backup-")
    assert e.state["log"] == [] and e.history == [] and e.state["drive_n"] == 0
    assert feed.applied == [] and feed.seen == set() and feed.event_id == ESPN_EVENT and feed.summary is summary
    assert (snap["state"], snap["idx"], snap["total"], snap["event_id"], snap["speed"]) == \
        ("playing", 0, 183, ESPN_EVENT, 0.5)
    assert snap["next_kind"] == "kickoff" and snap["ff_until"] == 0 and snap["error"] is None
    assert snap["feed_was_on"] is False and snap["started_at"][:2] == "20"


def test_backups_never_overwrite_each_other(make_feed, sandbox):
    e, feed = make_feed()
    feed.forget()                                                  # writes feed_seen.json
    one, two = wm.backup_game("20261009-211000"), wm.backup_game("20261009-211000")
    assert one["state"] != two["state"] and one["seen"] != two["seen"]
    assert two["state"].name == "live_state.backup-20261009-211000-2.json"
    assert two["seen"].name == "feed_seen.json.backup-20261009-211000-2"
    assert one["state"].read_bytes() == two["state"].read_bytes() == live.STATE_PATH.read_bytes()
    live.STATE_PATH.unlink()
    assert wm.backup_game("20261009-211001")["state"] is None       # nothing to back up: a fresh install


# ---------------------------------------------------------------- 27, 34: a whole game
def test_watch_runs_to_the_end(watched):
    w, e, feed = watched["watch"], watched["engine"], watched["feed"]
    snap = w.snapshot()
    assert (snap["state"], snap["idx"], snap["total"], snap["next_at"], snap["next_kind"]) == ("done", 183, 183, None, None)
    assert (e.state["sit"]["score_off"], e.state["sit"]["score_opp"]) == (16, 24)
    assert len(e.state["log"]) == 59 and len(feed.applied) == 183
    out = tl.response(feed.load_summary(), feed.applied, e.state, TEST_GAME, epoch=e.epoch(), mode="watch")
    assert (out["n"], out["status"]["state"], out["status"]["score"]) == (183, "post", {"DAL": 16, "TB": 24})
    assert watched["seconds"] < 60


def test_each_play_bumps_version_and_timeline_n(watched):
    calls, samples = watched["calls"], watched["samples"]
    assert len(calls) == 183
    assert all(after > before for before, after, n in calls)                 # every play saves the game
    assert [n for before, after, n in calls] == list(range(1, 184))           # one more applied row per play
    assert all(a[1] <= b[0] for a, b in zip(calls, calls[1:]))               # versions only go up
    assert samples and all(idx == n for idx, n in samples)                    # timeline_n == watch.idx


# ---------------------------------------------------------------- 28: pause, step
def test_watch_pause_holds_and_step_applies_one(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, FAST)
    w.start(ESPN_EVENT, summary, speed=10)
    assert wait_for(lambda: w.idx >= 3)
    w.pause()
    with feed.lock:                          # a play that was landing as we paused has finished
        held = w.idx
    time.sleep(0.2)
    snap = w.snapshot()
    assert (w.idx, snap["state"], snap["next_at"], len(feed.applied)) == (held, "paused", None, held)
    w.pause()                                # idempotent
    version = e.state["version"]
    w.step()
    assert w.idx == held + 1 and len(feed.applied) == held + 1 and e.state["version"] > version
    time.sleep(0.05)
    assert w.idx == held + 1 and w.snapshot()["state"] == "paused"
    w.resume()
    w.resume()                               # idempotent
    err = conflict(w.step)
    assert err.status == 409 and "Pause" in str(err)
    assert wait_for(lambda: w.idx > held + 1)


def last_drive(summary):
    """Only the game's last drive: TB's kneels, two DAL timeouts, END GAME (7 plays, no DAL snap to predict)."""
    return {**summary, "drives": {"previous": summary["drives"]["previous"][-1:]}}


def first_drive(summary):
    """Only the game's first drive: the opening kickoff, DAL's 70-yard touchdown drive (11 DAL snaps, 2 of them
    wiped out by flags) and the official timeout after it: 13 plays."""
    return {**summary, "drives": {"previous": summary["drives"]["previous"][:1]}}


def same(a, b):
    return json.loads(json.dumps(a)) == json.loads(json.dumps(b))


def typed_game(e):
    """A hand-typed game in progress (the game a watch must give back), its log as it stands."""
    e.command("new D25")
    e.record_play(None, 6, leaf="run_ot_left")
    return copy.deepcopy(e.state["log"])


def left_s(w):
    return w.snapshot()["next_at"] / 1000 - time.time()


def test_resume_keeps_the_time_left_and_step_at_the_last_play_finishes(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, 1.0)
    w.start(ESPN_EVENT, last_drive(summary), speed=1, from_seq=6)    # 6 plays at once, then END GAME after 3 s
    assert wait_for(lambda: w.idx == 6, timeout=10)
    time.sleep(0.5)
    before = left_s(w)                                           # about 2.5 s left
    w.pause()
    time.sleep(0.3)
    w.resume()
    assert abs(left_s(w) - before) < 0.1 and before < 2.8        # the pause kept the time left (no fresh 3 s)
    w.pause()
    w.step()                                                     # the last play: the session is done
    snap = w.snapshot()
    assert (snap["state"], snap["idx"], snap["total"], snap["next_at"]) == ("done", 7, 7, None)
    assert conflict(w.step).status == 409 and conflict(w.pause).status == 409 and conflict(w.resume).status == 409


# ---------------------------------------------------------------- 29: speed
def test_watch_speed_change_rescales_the_wait(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, 0.4)                    # the opening kickoff waits 5 s x 0.4 = 2 s at 1x
    w.start(ESPN_EVENT, summary, speed=1)
    first = w.snapshot()["next_at"]
    time.sleep(0.2)
    assert w.idx == 0
    t0 = time.monotonic()
    w.set_speed(10)                           # about 1.8 s left becomes about 0.18 s
    sped = w.snapshot()
    assert sped["speed"] == 10.0 and sped["next_at"] < first - 1000
    assert wait_for(lambda: w.idx >= 1, timeout=1.5)
    assert time.monotonic() - t0 < 1.0


def test_speed_change_while_paused_rescales_the_time_left(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, 0.1)                    # the opening kickoff waits 0.5 s at 1x
    w.start(ESPN_EVENT, summary, speed=1)
    time.sleep(0.3)
    before = left_s(w)                        # about 0.2 s left
    w.pause()
    w.set_speed(0.5)                          # half speed: twice the time left (a fresh wait would be 1.0 s)
    w.resume()
    assert abs(left_s(w) - 2 * before) < 0.05 and w.idx == 0
    assert wait_for(lambda: w.idx >= 1, timeout=2)


def test_from_seq_fast_forwards_then_paces(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, 1.0)
    w.start(ESPN_EVENT, summary, speed=0.5, from_seq=3)
    assert wait_for(lambda: w.idx == 3, timeout=30)           # no delay up to row 3
    time.sleep(0.2)
    snap = w.snapshot()
    assert (snap["idx"], snap["ff_until"], snap["state"]) == (3, 3, "playing")
    assert snap["next_at"] - time.time() * 1000 > 1000        # row 4 waits its pace again
    assert [str(p["id"]) for t, p in iter_plays(summary)[:3]] == feed.applied


# ---------------------------------------------------------------- 30: stop and restore
def test_stop_with_restore_puts_the_live_game_back(make_feed, summary, sandbox, watches, monkeypatch):
    e, feed = make_feed()
    feed.summary = summary
    for team, p in iter_plays(summary)[:20]:
        feed.apply_one(team, p)
    feed.on = True                                         # the live feed was on (its thread is not needed here)
    starts = []
    monkeypatch.setattr(feed, "start", lambda event_id=None: starts.append(event_id))
    log, seen, applied = copy.deepcopy(e.state["log"]), set(feed.seen), list(feed.applied)
    epoch, sit = e.epoch(), dict(e.state["sit"])
    w = watches(feed, FAST)
    w.start(ESPN_EVENT, summary, speed=10)
    assert feed.on is False                                # the watch turned the live feed off
    assert wait_for(lambda: w.idx >= 14, timeout=30)
    watched_version = e.state["version"]
    w.stop(restore=True)
    assert json.loads(json.dumps(e.state["log"])) == json.loads(json.dumps(log)) and e.state["sit"] == sit
    assert feed.seen == seen and feed.applied == applied and feed.event_id == ESPN_EVENT
    assert e.history == [] and e.epoch() != epoch and e.state["version"] > watched_version
    assert starts == [ESPN_EVENT]                          # the live feed comes back on
    assert w.snapshot()["state"] == "stopped"
    on_disk = json.loads(live.STATE_PATH.read_text())
    assert len(on_disk["log"]) == len(log) and json.loads(espn_feed.SEEN_PATH.read_text())[TEST_GAME["game_id"]] == applied
    con = duckdb.connect(str(live.DB_PATH))
    try:
        n = con.execute("SELECT count(*) FROM live_log WHERE game_id = ?", [TEST_GAME["game_id"]]).fetchone()[0]
    finally:
        con.close()
    assert n == len(log)                                   # the archive holds the live game again
    rows = tl.response(feed.load_summary(), feed.applied, e.state, TEST_GAME, epoch=e.epoch(), mode="live")["rows"]
    assert [r["id"] for r in rows] == applied
    assert conflict(w.stop).status == 409                  # nothing left to stop


def test_stop_without_restore_keeps_the_watched_game(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, FAST)
    w.start(ESPN_EVENT, summary, speed=10)
    assert wait_for(lambda: w.idx >= 5)
    w.stop()
    with feed.lock:
        n = w.idx
    time.sleep(0.1)
    assert w.idx == n == len(feed.applied) and w.snapshot()["state"] == "stopped"
    assert conflict(w.pause).status == 409 and conflict(w.stop, True).status == 409


def test_restore_without_any_backup_is_a_fresh_game(make_feed, summary, watches):
    e, feed = make_feed()
    live.STATE_PATH.unlink()
    espn_feed.SEEN_PATH.unlink(missing_ok=True)
    w = watches(feed, FAST)
    w.start(ESPN_EVENT, summary, speed=10)
    assert w.snapshot()["backup"] == {"state": None, "seen": None}
    assert wait_for(lambda: w.idx >= 5)
    w.stop(restore=True)
    assert e.state["log"] == [] and e.state["drive_n"] == 0 and feed.applied == []
    assert json.loads(live.STATE_PATH.read_text())["log"] == []


def test_a_missing_backup_leaves_the_session_stoppable(make_feed, summary, sandbox, watches):
    e, feed = make_feed()
    w = watches(feed, 1.0)
    w.start(ESPN_EVENT, summary, speed=0.5)
    (sandbox / w.snapshot()["backup"]["state"]).unlink()
    err = conflict(w.stop, True)
    assert err.status == 409 and "missing" in str(err)
    snap = w.snapshot()
    assert snap["state"] == "error" and "missing" in snap["error"]
    w.stop()                                               # end it without putting anything back
    assert w.snapshot()["state"] == "stopped"


def test_a_damaged_backup_is_refused_not_restored_as_a_fresh_game(make_feed, summary, sandbox, watches):
    e, feed = make_feed()
    mine = typed_game(e)
    w = watches(feed, FAST)
    w.start(ESPN_EVENT, last_drive(summary), speed=10)
    assert wait_for(lambda: w.snapshot()["state"] == "done")
    backup = sandbox / w.snapshot()["backup"]["state"]
    good = backup.read_bytes()
    backup.write_bytes(good[: len(good) // 2])             # cut off mid-write
    watched, on_disk = copy.deepcopy(e.state["log"]), live.STATE_PATH.read_bytes()
    err = conflict(w.stop, True)
    assert err.status == 409 and backup.name in str(err)
    assert w.snapshot()["state"] == "error" and backup.name in w.snapshot()["error"]
    assert e.state["log"] == watched and live.STATE_PATH.read_bytes() == on_disk      # nothing was put back
    backup.write_bytes(good)                               # the good copy again: Stop works
    w.stop(restore=True)
    assert same(e.state["log"], mine)


# ---------------------------------------------------------------- a session lasts until Stop, even after a restart
def test_a_finished_or_failed_watch_keeps_the_screen_until_stopped(make_feed, summary, watches, monkeypatch):
    """done and error still show the watched game with the restore point behind it: reset, replay and the live feed
    would replace it, so they wait for Stop."""
    e, feed = make_feed()
    w = watches(feed, FAST)
    w.start(ESPN_EVENT, last_drive(summary), speed=10)
    assert wait_for(lambda: w.snapshot()["state"] == "done")
    for doing in ("resetting the game", "replaying a game", "turning the live feed on"):
        err = conflict(w.require_idle, doing)
        assert err.status == 409 and doing in str(err) and "Stop" in str(err)
    monkeypatch.setattr(feed, "apply_one", lambda team, p, save=True: 1 / 0)
    w.start(ESPN_EVENT, last_drive(summary), speed=10)
    assert wait_for(lambda: w.snapshot()["state"] == "error")
    assert conflict(w.require_idle, "resetting the game").status == 409
    w.stop()
    w.require_idle("resetting the game")                   # stopped: nothing left to protect


def test_watching_again_after_done_or_error_still_restores_the_first_game(make_feed, summary, sandbox, watches,
                                                                          monkeypatch):
    e, feed = make_feed()
    mine = typed_game(e)
    w = watches(feed, FAST)
    w.start(ESPN_EVENT, last_drive(summary), speed=10)
    assert wait_for(lambda: w.snapshot()["state"] == "done")
    first = w.snapshot()["backup"]
    w.start(ESPN_EVENT, first_drive(summary), speed=10)    # Watch again, straight from done
    assert w.snapshot()["backup"] == first                 # Stop still means the game from before the first watch
    assert wait_for(lambda: w.snapshot()["state"] == "done")
    monkeypatch.setattr(feed, "apply_one", lambda team, p, save=True: 1 / 0)
    w.start(ESPN_EVENT, last_drive(summary), speed=10)
    assert wait_for(lambda: w.snapshot()["state"] == "error")
    monkeypatch.undo()
    w.start(ESPN_EVENT, last_drive(summary), speed=10)     # and again, from the error
    assert wait_for(lambda: w.snapshot()["state"] == "done")
    assert len(list(sandbox.glob("live_state.backup-*.json"))) == 1     # the watched games were never "your game"
    w.stop(restore=True)
    assert same(e.state["log"], mine) and w.snapshot()["backup"] == first


def test_a_restart_mid_watch_can_still_put_the_game_back(make_feed, summary, sandbox, watches):
    """A server restart ends the thread, and the files hold the watched game: the session comes back as an error
    that Stop can still undo, instead of an idle app that has forgotten where the real game went."""
    e, feed = make_feed()
    mine = typed_game(e)
    w = watches(feed, 1.0)
    w.start(ESPN_EVENT, summary, speed=0.5, from_seq=3)   # 3 plays at once, then a 10 s wait
    assert wait_for(lambda: w.idx == 3, timeout=30)
    w.pause()                                              # stands in for the kill: this session does nothing more
    assert (sandbox / wm.SESSION_FILE).exists()
    e2 = live.GameEngine()                                 # the restarted server reads the files
    feed2 = espn_feed.Feed(e2, threading.RLock())
    w2 = watches(feed2, FAST)
    snap = w2.snapshot()
    assert snap["state"] == "error" and "restart" in snap["error"] and "Stop" in snap["error"]
    assert (snap["backup"], snap["event_id"], snap["feed_was_on"]) == (w.snapshot()["backup"], ESPN_EVENT, False)
    assert conflict(w2.require_idle, "resetting the game").status == 409
    w2.stop(restore=True)
    assert same(e2.state["log"], mine) and same(json.loads(live.STATE_PATH.read_text())["log"], mine)
    assert not (sandbox / wm.SESSION_FILE).exists() and w2.snapshot()["state"] == "stopped"


def test_the_session_file_comes_and_goes_with_the_session(make_feed, summary, sandbox, watches):
    e, feed = make_feed()
    w = watches(feed, FAST)
    w.start(ESPN_EVENT, last_drive(summary), speed=10)
    saved = json.loads((sandbox / wm.SESSION_FILE).read_text())
    assert saved["backup"] == w.snapshot()["backup"] and saved["game_id"] == TEST_GAME["game_id"]
    assert wait_for(lambda: w.snapshot()["state"] == "done")
    w.stop()                                               # keep the watched game: nothing left to put back
    assert not (sandbox / wm.SESSION_FILE).exists()
    for bad in ("{not json", json.dumps({**saved, "backup": {"state": "../../etc/passwd", "seen": None}}),
                json.dumps({**saved, "game_id": "2026_06_DAL_NYG"})):
        (sandbox / wm.SESSION_FILE).write_text(bad)
        assert Watch(feed, feed.lock).snapshot()["state"] == "idle", bad
    (sandbox / wm.SESSION_FILE).unlink()


# ---------------------------------------------------------------- 31, 33: the live poller and LOCK
def test_inflight_live_poll_is_dropped(make_feed, summary, watches, monkeypatch):
    e, feed = make_feed()
    w = watches(feed, 1.0)
    gen = feed.gen                                         # a live poll read this before its fetch
    w.start(ESPN_EVENT, summary, speed=0.5)
    before = (copy.deepcopy(e.state["log"]), list(feed.applied), e.state["version"])
    assert feed.apply(summary, gen=gen) == 0
    assert (e.state["log"], feed.applied, e.state["version"]) == before
    w.stop()

    w2 = watches(feed, 1.0)                                # the same race through poll_once: the watch starts mid-fetch

    def fetch(eid):
        w2.start(ESPN_EVENT, summary, speed=0.5)
        return summary
    monkeypatch.setattr(espn_feed, "fetch_summary", fetch)
    assert feed.poll_once() == 0
    assert e.state["log"] == [] and feed.applied == [] and w2.snapshot()["state"] == "playing"


def test_watch_never_holds_lock_while_waiting(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, 1.0)
    w.start(ESPN_EVENT, summary, speed=0.5)                # the opening kickoff lands in 10 s
    got = []

    def grab():
        ok = feed.lock.acquire(timeout=0.05)
        got.append(ok)
        if ok:
            feed.lock.release()
    for _ in range(3):
        t = threading.Thread(target=grab)
        t.start()
        t.join()
        time.sleep(0.05)
    assert got == [True, True, True] and w.idx == 0 and w.snapshot()["state"] == "playing"


# ---------------------------------------------------------------- 409s and errors
def test_one_session_at_a_time_and_bad_games_are_refused(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, 1.0)
    for args, words in [((summary, 10, 184), "184"), (({"drives": {}}, 4, 0), "no plays"),
                        (({**summary, "header": {}, "boxscore": {}, "drives": _drives_without(summary, "DAL")}, 4, 0),
                         "isn't a DAL game")]:
        err = conflict(w.start, ESPN_EVENT, *args)
        assert err.status == 400 and words in str(err), words
    assert w.snapshot()["state"] == "idle" and conflict(w.stop).status == 409
    assert conflict(w.pause).status == 409 and conflict(w.resume).status == 409 and conflict(w.step).status == 409
    w.start(ESPN_EVENT, summary, speed=0.5)
    assert conflict(w.start, ESPN_EVENT, summary).status == 409
    assert conflict(w.require_idle, "turning the live feed on").status == 409
    w.pause()
    assert conflict(w.start, ESPN_EVENT, summary).status == 409
    assert w.active()


def _drives_without(summary, team):
    prev = [d for d in summary["drives"]["previous"] if d["team"]["abbreviation"] != team]
    return {"previous": prev}


def test_an_error_in_the_thread_is_reported_and_restore_still_works(make_feed, summary, watches, monkeypatch):
    e, feed = make_feed()
    feed.summary = summary
    for team, p in iter_plays(summary)[:5]:
        feed.apply_one(team, p)
    applied = list(feed.applied)
    w = watches(feed, FAST)

    def boom(team, p, save=True):
        raise RuntimeError("disk on fire")
    monkeypatch.setattr(feed, "apply_one", boom)
    w.start(ESPN_EVENT, summary, speed=10)
    assert wait_for(lambda: w.snapshot()["state"] == "error")
    assert "disk on fire" in w.snapshot()["error"] and not w.active()
    monkeypatch.undo()
    w.stop(restore=True)
    assert feed.applied == applied and w.snapshot()["state"] == "stopped"


def test_skipped_plays_are_counted_and_a_run_of_them_stops_the_watch(make_feed, summary, watches, monkeypatch):
    """A play the feed can't apply is skipped (README), but a watch never hides it: the watch object counts them,
    and a run of them (a full disk fails every play) ends the session in error instead of a 'done' with no game."""
    e, feed = make_feed()
    plays = iter_plays(first_drive(summary))
    bad = {str(plays[i][1]["id"]) for i in (1, 4)}         # two DAL snaps
    real = feed._apply_one

    def flaky(team, p):
        if str(p["id"]) in bad:
            raise RuntimeError("bad play")
        return real(team, p)
    monkeypatch.setattr(feed, "_apply_one", flaky)
    w = watches(feed, FAST)
    w.start(ESPN_EVENT, first_drive(summary), speed=10)
    assert wait_for(lambda: w.snapshot()["state"] == "done")
    snap = w.snapshot()
    assert (snap["idx"], snap["total"], snap["skipped"], snap["error"]) == (13, 13, 2, None)
    assert w.brief()["skipped"] == 2 and len(e.state["log"]) == 9          # 11 DAL snaps, 2 skipped

    def full_disk(team, p):
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(feed, "_apply_one", full_disk)
    w.start(ESPN_EVENT, first_drive(summary), speed=10)
    assert wait_for(lambda: w.snapshot()["state"] == "error")
    snap = w.snapshot()
    assert snap["idx"] == snap["skipped"] == wm.MAX_SKIPS_IN_A_ROW < 13
    assert "in a row" in snap["error"] and "No space left" in snap["error"] and "Stop" in snap["error"]
    time.sleep(0.05)
    assert w.idx == wm.MAX_SKIPS_IN_A_ROW                  # the thread stopped applying


def test_restore_turns_off_a_feed_left_on_and_drops_its_polls(make_feed, summary, watches, monkeypatch):
    e, feed = make_feed()
    w = watches(feed, FAST)
    w.start(ESPN_EVENT, last_drive(summary), speed=10)
    assert wait_for(lambda: w.snapshot()["state"] == "done")
    monkeypatch.setattr(feed, "_loop", lambda: None)
    feed.start(ESPN_EVENT)                                 # on behind the session's back (the app refuses this now)
    gen = feed.gen                                         # a live poll read this before its fetch
    w.stop(restore=True)                                   # the feed was off before the watch
    assert feed.on is False and feed.gen > gen
    assert feed.apply(summary, gen) == 0 and feed.applied == []


def test_idle_watch_object_and_version_brief(make_feed):
    e, feed = make_feed()
    w = Watch(feed, feed.lock)
    assert w.snapshot() == {"state": "idle", "event_id": None, "speed": None, "idx": 0, "total": 0, "next_at": None,
                            "skipped": 0, "next_kind": None, "ff_until": 0, "started_at": None, "feed_was_on": False,
                            "backup": None, "error": None}
    assert w.brief() == {"state": "idle", "event_id": None, "speed": None, "idx": 0, "total": 0, "next_at": None,
                         "skipped": 0, "error": None}
    w.set_speed(2)                                           # a speed picked before a session is kept
    assert w.snapshot()["speed"] == 2.0 and w.join(timeout=0.1)
    with pytest.raises(ValueError):
        Watch(feed, feed.lock, pace_scale=0)

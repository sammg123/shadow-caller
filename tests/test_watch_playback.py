"""Playback in the Watch engine (docs/design/restructure-v2.md sections 5 and 9) on the real TB at DAL game: seek, back,
forward and Go Live rebuild the game from kickoff or move on from where it stands, keep one restore point per session,
and never race the live feed. Pure: a Watch over a sandboxed engine and feed (make_feed), never Flask, never
data/live_state.json."""
import copy
import json
import threading
import time

import pytest
from helpers import ESPN_EVENT, TEST_GAME

import espn_feed
import live
import watch as wm
from espn_feed import iter_plays
from watch import Watch, WatchError

FAST = 0.001                     # SHADOW_WATCH_SCALE for whole games
LOG_KEYS = ("seq", "snap", "drive", "qtr", "clock", "down", "togo", "yardline_100", "score", "p", "p_league", "flag",
            "leaf", "family", "outcome", "yards", "espn_id", "nullified", "top_leaf", "leaf_rank")


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


def same(a, b):
    return json.loads(json.dumps(a)) == json.loads(json.dumps(b))


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


def ids_of(summary, n=None):
    return [str(p["id"]) for t, p in iter_plays(summary)][:n]


def backups(sandbox):
    return sorted(p.name for p in sandbox.glob("live_state.backup-*.json"))


def facts(e):
    """The game as the engine holds it, minus the wall-clock time each row was logged."""
    return ([{k: r.get(k) for k in LOG_KEYS} for r in e.state["log"]], dict(e.state["sit"]), e.state["drive_n"],
            e.state["drive_active"], dict(e.state["mem"]))


def straight(make_feed, summary, n):
    """The game after its first n plays applied one at a time, as the live feed and a watch apply them."""
    e, feed = make_feed()
    feed.summary = summary
    for team, p in iter_plays(summary)[:n]:
        feed.apply_one(team, p)
    return facts(e)


def typed_game(e):
    """A hand-typed game in progress: the game a session must be able to give back."""
    e.command("new D25")
    e.record_play(None, 6, leaf="run_ot_left")
    return copy.deepcopy(e.state["log"])


def in_progress(summary, n):
    """The saved game as ESPN showed it after its first n plays: only those, and a header that says it is on (pre
    before the first play)."""
    keep = set(ids_of(summary, n))
    drives = [{**d, "plays": [p for p in d["plays"] if str(p["id"]) in keep]} for d in summary["drives"]["previous"]]
    out = {**summary, "drives": {"previous": [d for d in drives if d["plays"]]},
           "header": copy.deepcopy(summary["header"])}
    out["header"]["competitions"][0]["status"]["type"].update(state="in" if n else "pre", shortDetail="2:58 - 3rd")
    return out


# ---------------------------------------------------------------- seek
def test_seek_rebuilds_from_kickoff_and_holds_there(make_feed, summary, sandbox, watches):
    want = straight(make_feed, summary, 40)
    e, feed = make_feed()
    mine = typed_game(e)
    w = watches(feed, FAST)
    assert w.session_game() == (None, None)                     # no session: the app loads the game on screen
    w.seek(40, ESPN_EVENT, summary)
    snap = w.snapshot()
    assert (snap["state"], snap["idx"], snap["total"], snap["ff_until"], snap["next_at"], snap["error"]) == \
        ("paused", 40, 183, 40, None, None)
    assert snap["next_kind"] == "caller_snap" and w.session_game()[1] is summary          # DAL's snap is next
    assert feed.applied == ids_of(summary, 40) and facts(e) == want                 # what 40 plays one by one give
    assert len(backups(sandbox)) == 1
    assert json.loads((sandbox / wm.SESSION_FILE).read_text())["backup"] == snap["backup"]
    on_disk = json.loads(live.STATE_PATH.read_text())
    assert (len(on_disk["log"]), on_disk["version"]) == (len(e.state["log"]), e.version)
    assert json.loads(espn_feed.SEEN_PATH.read_text())[TEST_GAME["game_id"]] == feed.applied
    w.resume()                                                  # its thread was waiting: on from play 41
    assert wait_for(lambda: w.idx >= 45)
    w.pause()
    with feed.lock:
        assert feed.applied == ids_of(summary, w.idx)
    w.stop(restore=True)
    assert same(e.state["log"], mine)


def test_seek_to_the_end_is_done_and_reset_is_seek_zero(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, FAST)
    w.seek(183, ESPN_EVENT, summary)
    snap = w.snapshot()
    assert (snap["state"], snap["idx"], snap["total"], snap["next_kind"]) == ("done", 183, 183, None)
    assert w.join(timeout=0.1) and (e.state["sit"]["score_off"], e.state["sit"]["score_opp"]) == (16, 24)
    assert conflict(w.resume).status == 409 and conflict(w.step).status == 409
    w.seek(0, ESPN_EVENT, summary)                              # Reset: kickoff, paused, from done
    assert (w.snapshot()["state"], w.idx, feed.applied, e.state["log"]) == ("paused", 0, [], [])
    assert w.snapshot()["next_kind"] == "kick"


def test_a_seek_to_where_the_session_already_holds_changes_nothing(make_feed, summary, watches):
    """A click on the bar where it already stands, or Go Live twice on a finished game: no rebuild, no redraw."""
    e, feed = make_feed()
    w = watches(feed, FAST)
    for n in (40, 183):
        w.seek(n, ESPN_EVENT, summary)
        before = (e.epoch(), e.version, w.snapshot())
        w.seek(n, ESPN_EVENT, summary)
        assert (e.epoch(), e.version, w.snapshot()) == before
    w.seek(40, ESPN_EVENT, summary)                             # anywhere else rebuilds: a new timeline
    assert (w.idx, w.snapshot()["state"]) == (40, "paused") and e.epoch() != before[0]


def test_seek_takes_a_whole_number_of_plays_within_the_game(make_feed, summary, sandbox, watches):
    assert wm.parse_seek({"idx": 0}) == 0 and wm.parse_seek({"idx": 183}) == 183
    for body in (None, {}, {"idx": True}, {"idx": False}, {"idx": 1.0}, {"idx": "3"}, {"idx": -1}, {"idx": None},
                 {"idx": [3]}, {"idx": 3, "speed": 4}, [3], "3"):
        err = conflict(wm.parse_seek, body)
        assert err.status == 400 and str(err), body
    e, feed = make_feed()
    w = watches(feed, FAST)
    for n in (184, 10 ** 30):
        err = conflict(w.seek, n, ESPN_EVENT, summary)
        assert err.status == 400 and "past the end" in str(err) and "183 plays" in str(err)
    assert "no plays" in str(conflict(w.seek, 0, ESPN_EVENT, {**summary, "drives": {}}))
    assert w.snapshot()["state"] == "idle" and backups(sandbox) == [] and not (sandbox / wm.SESSION_FILE).exists()


def test_a_session_backs_up_once_however_many_rebuilds(make_feed, summary, sandbox, watches):
    """KEEP_BACKUPS is 20: a backup per seek would prune the real game's copy after a burst of 20."""
    e, feed = make_feed()
    mine = typed_game(e)
    w = watches(feed, FAST)
    w.seek(10, ESPN_EVENT, summary)
    first = w.snapshot()["backup"]
    for n in (0, 183, 50, 3, 120) * 5:                          # 25 rebuilds, from paused and from done
        w.seek(n, ESPN_EVENT, summary)
    w.back(ESPN_EVENT, summary)
    w.forward(ESPN_EVENT, summary)
    assert w.snapshot()["backup"] == first and backups(sandbox) == [first["state"]]
    assert json.loads((sandbox / wm.SESSION_FILE).read_text())["backup"] == first
    w.stop(restore=True)
    assert same(e.state["log"], mine)


def test_seek_while_playing_stops_the_old_thread_first(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, FAST)
    w.start(ESPN_EVENT, summary, speed=10)
    assert wait_for(lambda: w.idx >= 20)
    old = w._thread
    w.seek(5, ESPN_EVENT, summary)
    old.join(timeout=5)
    assert not old.is_alive()
    time.sleep(0.1)
    assert (w.snapshot()["state"], w.idx, feed.applied) == ("paused", 5, ids_of(summary, 5))
    w.resume()
    assert wait_for(lambda: w.idx >= 12)
    with feed.lock:                                             # on from play 6: nothing applied twice
        assert feed.applied == ids_of(summary, w.idx)


def test_a_rebuild_saves_the_game_once_rather_than_twice_a_play(make_feed, summary, watches):
    """Lock-free /api/version readers see the version move a few times, not 300; and 150 plays take about 0.6 s."""
    e, feed = make_feed()
    w = watches(feed, FAST)
    before = e.version
    t0 = time.monotonic()
    w.seek(150, ESPN_EVENT, summary)
    assert e.version - before <= 4 and time.monotonic() - t0 < 10
    assert json.loads(live.STATE_PATH.read_text())["version"] == e.version


def test_lock_free_readers_never_see_rebuilt_plays_under_the_old_epoch(make_feed, summary, watches):
    """/api/version reads the epoch, the version and the applied ids without LOCK. A rebuild moves the epoch before
    its first play lands, so a page that polls in the middle refetches the whole timeline (which waits on LOCK)."""
    e, feed = make_feed()
    typed_game(e)
    w = watches(feed, FAST)
    old, samples, done = e.epoch(), [], threading.Event()

    def poll():
        while not done.wait(0.002):                             # a page polls every 250 ms: this is far denser
            samples.append((e.epoch(), len(feed.applied), e.version))
    reader = threading.Thread(target=poll)
    reader.start()
    try:
        w.seek(150, ESPN_EVENT, summary)
    finally:
        done.set()
        reader.join()
    assert samples and all(epoch != old for epoch, n, v in samples if n)
    assert len({v for epoch, n, v in samples if n}) <= 2           # the version holds still while plays land


# ---------------------------------------------------------------- back and forward
def test_back_and_forward_move_by_drawn_plays(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, FAST)
    w.seek(0, ESPN_EVENT, summary)
    err = conflict(w.back, ESPN_EVENT, summary)
    assert err.status == 409 and str(err) == "Already at kickoff."
    w.forward(ESPN_EVENT, summary)                              # the opening kickoff draws: one play
    assert (w.idx, w.snapshot()["state"]) == (1, "paused")
    for _ in range(11):
        w.forward(ESPN_EVENT, summary)
    assert w.idx == 12                                          # DAL's touchdown (play 11) is in
    w.forward(ESPN_EVENT, summary)                              # past the official timeout (no drawing) to TB's kickoff
    assert w.idx == 14 and feed.applied == ids_of(summary, 14)
    w.back(ESPN_EVENT, summary)                                 # back past the timeout: just after the touchdown
    assert (w.idx, w.snapshot()["state"], feed.applied) == (12, "paused", ids_of(summary, 12))
    w.back(ESPN_EVENT, summary)
    w.back(ESPN_EVENT, summary)
    assert w.idx == 10
    w.seek(182, ESPN_EVENT, summary)                            # only END GAME is left: forward finishes the game
    w.forward(ESPN_EVENT, summary)
    assert (w.idx, w.snapshot()["state"]) == (183, "done")
    err = conflict(w.forward, ESPN_EVENT, summary)
    assert err.status == 409 and str(err) == "Already at the last play."
    w.back(ESPN_EVENT, summary)                                 # from done: just after the kneel before the last one
    assert (w.idx, w.snapshot()["state"]) == (181, "paused")


def test_forward_while_playing_pauses_after_the_next_drawn_play(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, 1.0)
    w.start(ESPN_EVENT, summary, speed=0.5)                     # the opening kickoff lands in 10 s
    w.forward(ESPN_EVENT, summary)
    snap = w.snapshot()
    assert (snap["state"], snap["idx"], snap["next_at"], feed.applied) == ("paused", 1, None, ids_of(summary, 1))
    w.resume()                                                  # the same thread goes on: DAL's first snap is next
    snap = w.snapshot()
    assert (snap["state"], snap["next_kind"]) == ("playing", "caller_snap") and snap["next_at"] > time.time() * 1000


def test_with_no_session_back_and_forward_start_one_from_the_game_on_screen(make_feed, summary, sandbox, watches):
    e, feed = make_feed()
    feed.summary = summary
    for team, p in iter_plays(summary)[:30]:                    # ESPN's first 30 plays on screen, no watch
        feed.apply_one(team, p)
    w = watches(feed, FAST)
    w.back(ESPN_EVENT, summary)                                 # play 29 is DAL's timeout: back from play 28
    assert (w.snapshot()["state"], w.idx, len(backups(sandbox))) == ("paused", 28, 1)
    w.stop()                                                    # no session, the 28 plays stay on screen
    w.forward(ESPN_EVENT, summary)                              # a new session: the game on screen is backed up again
    assert (w.snapshot()["state"], w.idx, len(backups(sandbox))) == ("paused", 29, 2)


def test_a_typed_game_on_screen_is_at_kickoff_of_the_espn_game(make_feed, summary, sandbox, watches):
    e, feed = make_feed()
    mine = typed_game(e)
    w = watches(feed, FAST)
    err = conflict(w.back, ESPN_EVENT, summary)
    assert str(err) == "Already at kickoff." and backups(sandbox) == [] and same(e.state["log"], mine)
    w.forward(ESPN_EVENT, summary)                              # the kickoff: a session, the typed game backed up first
    assert (w.snapshot()["state"], w.idx, len(backups(sandbox))) == ("paused", 1, 1)
    w.stop(restore=True)
    assert same(e.state["log"], mine)


# ---------------------------------------------------------------- Go Live (the Watch's part: the app turns the feed on)
def test_go_live_keeps_the_sessions_plays_and_applies_the_rest(make_feed, summary, sandbox, watches, monkeypatch):
    now = in_progress(summary, 133)
    want = straight(make_feed, summary, 133)
    e, feed = make_feed()
    typed_game(e)
    w = watches(feed, FAST)
    w.seek(30, ESPN_EVENT, now)
    kept = backups(sandbox)
    applied = []
    real = feed.apply_one

    def spy(team, p, save=True):
        applied.append(str(p["id"]))
        return real(team, p, save=save)
    monkeypatch.setattr(feed, "apply_one", spy)
    w.go_live(ESPN_EVENT, now)
    snap = w.snapshot()
    assert (snap["state"], snap["idx"], snap["total"], snap["error"]) == ("stopped", 133, 133, None)
    assert applied == ids_of(summary, 133)[30:] and feed.applied == ids_of(summary, 133) and facts(e) == want
    assert snap["game"] == {"status": "in", "detail": "2:58 - 3rd"} and feed.summary is now
    assert not (sandbox / wm.SESSION_FILE).exists() and backups(sandbox) == kept     # no restore point; the copy stays
    assert conflict(w.stop, True).status == 409                                     # nothing to put back


def test_go_live_rebuilds_another_game_on_screen_after_a_backup(make_feed, summary, sandbox, watches):
    e, feed = make_feed()
    mine = typed_game(e)
    w = watches(feed, FAST)
    w.go_live(ESPN_EVENT, in_progress(summary, 60))
    assert (w.snapshot()["state"], feed.applied, len(backups(sandbox))) == ("stopped", ids_of(summary, 60), 1)
    assert same(json.loads((sandbox / backups(sandbox)[0]).read_text())["log"], mine)
    w.go_live(ESPN_EVENT, in_progress(summary, 70))            # ten more plays: they go on top, no new backup
    assert feed.applied == ids_of(summary, 70) and len(backups(sandbox)) == 1


def test_go_live_before_kickoff_is_a_fresh_game_that_keeps_the_sessions_backup(make_feed, summary, sandbox, watches):
    e, feed = make_feed()
    typed_game(e)
    w = watches(feed, FAST)
    w.seek(40, ESPN_EVENT, summary)
    w.go_live(ESPN_EVENT, in_progress(summary, 0))
    assert (w.snapshot()["state"], feed.applied, e.state["log"], e.state["drive_n"]) == ("stopped", [], [], 0)
    assert w.snapshot()["game"]["status"] == "pre" and len(backups(sandbox)) == 1


def test_a_go_live_that_fails_part_way_is_an_error_that_keeps_the_restore_point(make_feed, summary, watches,
                                                                                monkeypatch):
    """The session's thread is stopped first: a resume can never apply the plays Go Live already put in."""
    now = in_progress(summary, 133)
    e, feed = make_feed()
    mine = typed_game(e)
    w = watches(feed, FAST)
    w.seek(30, ESPN_EVENT, now)
    old, real = w._thread, e._save

    def full_disk():
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(e, "_save", full_disk)
    with pytest.raises(OSError):
        w.go_live(ESPN_EVENT, now)
    old.join(timeout=5)
    snap = w.snapshot()
    assert (snap["state"], old.is_alive()) == ("error", False) and "No space left" in snap["error"]
    assert conflict(w.resume).status == 409
    monkeypatch.setattr(e, "_save", real)
    w.stop(restore=True)
    assert same(e.state["log"], mine)


# ---------------------------------------------------------------- the watch object, the live feed, failures, restarts
def test_the_watch_object_carries_marks_and_the_game_but_the_brief_does_not(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, FAST)
    assert (w.snapshot()["marks"], w.snapshot()["game"]) == ([], None)
    w.seek(3, ESPN_EVENT, summary)
    snap = w.snapshot()
    assert snap["game"] == {"status": "post", "detail": "Final"} and len(snap["marks"]) == 32
    assert snap["marks"][1] == {"idx": 0, "kind": "drive", "team": "DAL", "label": "DAL ball · Q1 15:00"}
    assert "marks" not in w.brief() and "game" not in w.brief()
    snap["marks"].clear()
    assert len(w.snapshot()["marks"]) == 32                    # every snapshot is its own copy


def test_a_live_poll_in_flight_lands_nowhere_after_a_rebuild(make_feed, summary, watches):
    e, feed = make_feed()
    w = watches(feed, FAST)
    gen = feed.gen                                              # a live poll read this before its fetch
    w.seek(10, ESPN_EVENT, summary)
    before = (copy.deepcopy(e.state["log"]), list(feed.applied), e.state["version"])
    assert feed.apply(summary, gen=gen) == 0
    assert (e.state["log"], feed.applied, e.state["version"]) == before and feed.on is False


def test_a_rebuild_that_fails_is_an_error_that_keeps_the_restore_point(make_feed, summary, sandbox, watches,
                                                                       monkeypatch):
    e, feed = make_feed()
    mine = typed_game(e)
    w = watches(feed, FAST)
    w.seek(20, ESPN_EVENT, summary)
    real = e._save

    def full_disk():
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(e, "_save", full_disk)
    with pytest.raises(OSError):
        w.seek(60, ESPN_EVENT, summary)
    snap = w.snapshot()
    assert snap["state"] == "error" and "No space left" in snap["error"]
    assert backups(sandbox) == [snap["backup"]["state"]]
    monkeypatch.setattr(e, "_save", real)
    w.seek(60, ESPN_EVENT, summary)                             # tried again: the same restore point
    assert (w.snapshot()["state"], w.idx, w.snapshot()["error"], len(backups(sandbox))) == ("paused", 60, None, 1)
    w.stop(restore=True)
    assert same(e.state["log"], mine)


def test_a_first_backup_that_fails_changes_nothing(make_feed, summary, sandbox, watches, monkeypatch):
    e, feed = make_feed()
    mine = typed_game(e)
    w = watches(feed, FAST)

    def full_disk(stamp=None):
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(wm, "backup_game", full_disk)
    with pytest.raises(OSError):
        w.seek(5, ESPN_EVENT, summary)
    assert (w.snapshot()["state"], w.snapshot()["error"]) == ("idle", None) and same(e.state["log"], mine)
    assert not (sandbox / wm.SESSION_FILE).exists()


def test_after_a_restart_a_rebuild_keeps_the_sessions_restore_point(make_feed, summary, sandbox, watches):
    e, feed = make_feed()
    mine = typed_game(e)
    w = watches(feed, FAST)
    w.seek(30, ESPN_EVENT, summary)
    first = w.snapshot()["backup"]
    e2 = live.GameEngine()                                      # the restarted server reads the files
    w2 = watches(espn_feed.Feed(e2, threading.RLock()), FAST)
    assert w2.snapshot()["state"] == "error" and w2.session_game() == (ESPN_EVENT, None)
    w2.back(ESPN_EVENT, summary)                                # the files hold 30 plays: back from play 28
    assert (w2.snapshot()["state"], w2.idx, w2.snapshot()["backup"]) == ("paused", 28, first)
    assert backups(sandbox) == [first["state"]]
    w2.stop(restore=True)
    assert same(e2.state["log"], mine) and w2.feed.applied == []

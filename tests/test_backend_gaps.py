"""Backend gaps the 3D GameCast needs (ui-architecture.md Appendix B #5, #7, #8 and its v1.2 note; FI 5b G8, G22):
versions that only go up, no field goal off the field, the timeline as of a row (until), game facts for the scene,
ESPN's own box score outside Watch mode, an undo that never takes an ESPN play back out, and a shorthand line that is
all or nothing on disk too.

Pure: a sandboxed engine and feed (make_feed) on the real TB at DAL game. Never Flask, never data/live_state.json."""
import copy
import json

import duckdb
import pytest
from helpers import TEST_GAME

import live
import timeline as tl
import timeline_text as tt
from espn_feed import iter_plays


def build(feed, engine, **kw):
    kw.setdefault("epoch", "gaps-1")
    kw.setdefault("client_epoch", kw["epoch"])
    kw.setdefault("mode", "replay")
    return tl.response(feed.summary, feed.applied, engine.state, TEST_GAME, **kw)


def as_of(feed, engine, n, **kw):
    """The timeline built from the first n applied plays only: what any response must say as of row n."""
    return build(feed, engine, **kw) if n is None else \
        tl.response(feed.summary, feed.applied[:n], engine.state, TEST_GAME, epoch="gaps-1", client_epoch="gaps-1",
                    mode="replay", **kw)


def on_disk():
    return json.loads(live.STATE_PATH.read_text())


def archived_rows():
    con = duckdb.connect(str(live.DB_PATH))
    try:
        return con.execute("SELECT count(*) FROM live_log WHERE game_id = ?", [TEST_GAME["game_id"]]).fetchone()[0]
    finally:
        con.close()


@pytest.fixture(scope="module")
def game(make_feed, summary):
    e, feed = make_feed()
    feed.apply(summary)
    return e, feed


# ---------------------------------------------------------------- G8 (Appendix B #5): versions only go up
def test_version_goes_up_on_every_save_including_undo_and_reset(make_feed):
    e, feed = make_feed()
    seen = [e.version]
    e.command("new D25")
    seen.append(e.version)
    e.record_play(None, 6, leaf="run_ot_left")
    seen.append(e.version)
    e.undo()                                  # G8: an undo used to bring back the number it undid (play v334, undo v334)
    seen.append(e.version)
    assert e.state["log"] == []
    e.reset()                                 # G8: a reset used to start again at 1
    seen.append(e.version)
    assert all(a < b for a, b in zip(seen, seen[1:])), seen
    assert e.state["version"] == e.version == on_disk()["version"]
    assert live.GameEngine().version == e.version          # a restart goes on from the saved number


def test_a_replay_never_lowers_the_version(make_feed, summary):
    e, feed = make_feed()
    e.command("new D25")
    before = e.version
    e.reset()                                 # what /api/feed/replay does: reset, forget, apply every play
    feed.forget()
    feed.apply(summary)
    assert e.version > before + 183 and e.view()["version"] == e.version


def test_a_lock_free_reader_never_sees_the_version_drop_mid_reset(make_feed, monkeypatch):
    """/api/version reads engine.version without the lock. Between reset() swapping in the fresh game and saving it,
    the fresh game has no version yet: the reader must still get the newest number, never 0."""
    e, feed = make_feed()
    e.command("new D25")
    high, mid = e.version, []
    real = e._db_delete_after
    monkeypatch.setattr(e, "_db_delete_after", lambda n: (mid.append(e.version), real(n)))
    e.reset()
    assert mid == [high] and e.version == high + 1


# ---------------------------------------------------------------- G22 (Appendix B #7, #85): no field goal off the field
def test_a_field_goal_needs_a_drive(make_feed):
    e, feed = make_feed()
    e.command("DAL 7 TB 3")
    before, saved, steps = copy.deepcopy(e.state), live.STATE_PATH.read_bytes(), len(e.history)
    for attempt in (lambda: e.end_drive("fg"), lambda: e.command("fg")):
        with pytest.raises(ValueError, match="No DAL drive in progress"):
            attempt()
        assert e.state == before and live.STATE_PATH.read_bytes() == saved and len(e.history) == steps
    e.command("new D25")
    e.command("fg")                                        # with a drive: 3 points, and the drive is over (#87)
    assert (e.state["sit"]["score_off"], e.state["drive_active"], e.state["drive_ends"]) == (10, False, {"1": "fg"})
    e.command("punt")                                      # the ends that add no points stay harmless off the field
    with pytest.raises(ValueError, match="punt, fg, fg_miss or half"):
        e.end_drive("touchdown")


# ---------------------------------------------------------------- 6b: a shorthand line is all or nothing on disk too
def test_a_failed_shorthand_line_leaves_the_game_file_alone(make_feed):
    e, feed = make_feed()
    e.command("new D25")
    saved, state, version, steps = live.STATE_PATH.read_bytes(), copy.deepcopy(e.state), e.version, len(e.history)
    with pytest.raises(ValueError, match="Didn't understand 'KK 3'"):
        e.command("P 8 | KK 3")                 # the first segment logged a play before the second failed
    assert live.STATE_PATH.read_bytes() == saved            # the half-done line used to sit on disk until the next save
    assert (e.state, e.version, len(e.history), archived_rows()) == (state, version, steps, 0)
    e.command("P 8 | 2&2 D44")                  # a good line is one save: one new version, one undo step
    assert (e.version, on_disk()["version"], len(e.history)) == (version + 1, version + 1, steps + 1)
    assert e.state["message"] == "Done: P 8, 2&2 D44" and len(on_disk()["log"]) == 1 and archived_rows() == 1


def test_a_shorthand_line_whose_save_fails_changes_nothing(make_feed, monkeypatch):
    e, feed = make_feed()
    e.command("new D25")
    saved, state, steps = live.STATE_PATH.read_bytes(), copy.deepcopy(e.state), len(e.history)

    def crash(src, dst):
        raise OSError("disk full")
    monkeypatch.setattr(live.os, "replace", crash)
    with pytest.raises(OSError, match="disk full"):
        e.command("P 8")
    assert (e.state, len(e.history), live.STATE_PATH.read_bytes(), archived_rows()) == (state, steps, saved, 0)
    monkeypatch.undo()
    e.command("P 8")                            # the next good line still takes a number nobody has seen
    assert e.version > state["version"] and on_disk()["version"] == e.version


# ---------------------------------------------------------------- Appendix B #8: the timeline as of a row (until)
def test_until_gives_rows_drives_status_and_box_as_of_a_row(game):
    e, feed = game
    out = build(feed, e, since=100, until=104)
    assert ([r["seq"] for r in out["rows"]], out["n"], out["since"], out["until"], out["reset"]) == \
        ([101, 102, 103, 104], 104, 100, 104, False)
    ref = as_of(feed, e, 104)
    assert (out["drives"], out["status"], out["box"]) == (ref["drives"], ref["status"], ref["box"])
    assert (out["status"]["last_seq"], out["status"]["score"], len(out["drives"])) == (104, {"DAL": 10, "TB": 14}, 12)
    assert (out["box"]["DAL"]["yards"], out["box"]["TB"]["yards"]) == (187, 241)          # data contract G22
    for k in (101, 102, 103):                   # a snapshot alone: no rows, the panels as of row k
        snap, ref = build(feed, e, since=k, until=k), as_of(feed, e, k)
        assert (snap["rows"], snap["n"], snap["status"]["last_seq"]) == ([], k, k)
        assert (snap["drives"], snap["status"], snap["box"]) == (ref["drives"], ref["status"], ref["box"])
    past = build(feed, e, until=500)            # past the end: the whole timeline
    assert (past["n"], past["until"], past["rows"]) == (183, 183, build(feed, e)["rows"])
    stale = build(feed, e, since=10, until=50, client_epoch="old")       # a stale epoch answers from row 1
    assert stale["reset"] and [r["seq"] for r in stale["rows"]] == list(range(1, 51)) and "teams" in stale
    assert "until" not in build(feed, e)        # C1's shape when until isn't asked for


def test_until_in_manual_mode(make_feed):
    e, feed = make_feed()
    e.command("new D25")
    e.record_play(None, 6, leaf="run_ot_left")
    e.record_play(None, 3, leaf="run_inside")
    e.record_play(None, 0, leaf="dropback_short", outcome="incomplete")
    e.end_drive("punt")
    e.command("new D40")
    e.record_play(None, 12, leaf="pa_mid")
    full = build(feed, e, mode="manual")
    assert full["n"] == 4 and [d["result"] for d in full["drives"]] == ["PUNT", None]
    mid = build(feed, e, mode="manual", since=1, until=2)
    assert ([r["seq"] for r in mid["rows"]], mid["n"], len(mid["drives"])) == ([2], 2, 1)
    d1 = mid["drives"][0]
    assert (d1["complete"], d1["result"], d1["end"], d1["plays"], d1["yards"]) == (False, None, None, 2, 9)
    st = mid["status"]
    assert (st["state"], st["poss"], st["down_text"], st["ball_x"], st["ball_kind"], st["last_seq"], st["score"]) == \
        ("in", "DAL", "3rd & 1 at DAL 34", 34, "snap", 2, {"DAL": 0, "TB": 0})
    assert (mid["box"]["DAL"]["rush"], mid["box"]["DAL"]["plays"], mid["box"]["DAL"]["top"]) == \
        ({"att": 2, "yds": 9}, 2, None)
    end1 = build(feed, e, mode="manual", until=3)           # drive 1 ended on row 3 (the punt came after it)
    assert (end1["drives"][0]["result"], end1["drives"][0]["complete"]) == ("PUNT", True)
    assert (end1["status"]["poss"], end1["status"]["ball_x"], end1["status"]["down_text"]) == (None, None, None)
    assert build(feed, e, mode="manual", until=0)["status"]["state"] == "pre"
    assert build(feed, e, mode="manual", until=4)["status"] == full["status"]


# ---------------------------------------------------------------- game facts for the scene (kickoff, venue, light)
def test_game_facts_come_with_the_first_answer_only(game):
    e, feed = game
    out = build(feed, e, client_epoch=None)
    assert out["game"] == {"kickoff": "2026-10-09T00:15:00Z", "kickoff_local": "2026-10-08T19:15:00-05:00",
                           "venue": "AT&T Stadium", "city": "Arlington", "indoor": None, "grass": False,
                           "light": "night"}
    assert "game" not in build(feed, e, since=100)
    manual = tl.response(None, [], e.state, TEST_GAME, epoch="m", mode="manual")
    assert manual["game"] == {"kickoff": None, "kickoff_local": None, "venue": None, "city": None, "indoor": None,
                              "grass": None, "light": "night"}


def facts(date, **venue):
    address = {k: venue.pop(k) for k in ("city", "state", "country") if k in venue}
    return tt.game_facts({"header": {"competitions": [{"date": date}]},
                          "gameInfo": {"venue": {"fullName": "Field", "address": address, **venue}}})


def test_light_follows_the_kickoff_hour_where_the_game_is_played():
    assert facts("2026-09-13T17:00Z", city="Arlington", state="TX")["light"] == "day"           # 12:00 CDT
    assert facts("2026-09-13T20:25Z", city="Seattle", state="WA")["light"] == "day"             # 13:25 PDT
    assert facts("2026-09-14T00:20Z", city="Seattle", state="WA")["light"] == "night"           # 17:20 PDT
    assert facts("2026-09-13T23:59Z", city="Glendale", state="AZ")["light"] == "day"            # 16:59 MST, no DST
    assert facts("2026-09-14T00:05Z", city="Glendale", state="AZ")["light"] == "night"          # 17:05 MST
    london = facts("2026-10-04T13:30Z", city="London", country="England")
    assert (london["light"], london["kickoff_local"]) == ("day", "2026-10-04T14:30:00+01:00")
    assert facts("2026-09-27T20:25Z", city="Rio De Janeiro", country="Brazil")["light"] == "night"   # 17:25 BRT
    nowhere = facts("2026-09-13T17:00Z", city="Nowhere", country="Atlantis")
    assert (nowhere["kickoff"], nowhere["kickoff_local"], nowhere["light"]) == ("2026-09-13T17:00:00Z", None, "night")
    for bad in (None, "", "soon", "2026-13-40T99:99Z", 20260913, "2026-09-13T17:00"):   # the last has no zone
        f = facts(bad, city="Arlington", state="TX")
        assert (f["kickoff"], f["kickoff_local"], f["light"]) == (None, None, "night"), bad


def test_indoor_and_grass_are_espns_booleans_and_nothing_spoils():
    s = {"header": {"competitions": [{"date": "2026-10-09T00:15Z", "venue": {"indoor": True},
                                      "competitors": [{"score": "16", "winner": True, "record": "2-3"}]}]},
         "gameInfo": {"venue": {"fullName": "  Dome  ", "grass": "no", "address": {"city": 7, "state": "TX"}}}}
    f = tt.game_facts(s)
    assert (f["indoor"], f["grass"], f["venue"], f["city"]) == (True, None, "Dome", None)   # never a guess
    assert set(f) == {"kickoff", "kickoff_local", "venue", "city", "indoor", "grass", "light"}
    s["gameInfo"]["venue"]["indoor"] = False                 # gameInfo says it first
    assert tt.game_facts(s)["indoor"] is False
    assert tt.game_facts({"gameInfo": {"venue": {"fullName": "x" * 500}}})["venue"] == "x" * 120


# ---------------------------------------------------------------- ESPN's own box score, outside Watch mode only
def test_espn_box_comes_with_the_derived_one_outside_watch(game):
    e, feed = game
    replay = build(feed, e)
    assert replay["box_source"] == "espn" and replay["box_espn"] == replay["box"]       # equal on TB at DAL
    live_ = build(feed, e, mode="live", since=183)
    assert live_["box_source"] == "espn" and live_["box_espn"] == replay["box"]
    for out in (build(feed, e, mode="watch"), build(feed, e, since=100, until=104)):
        assert (out["box_source"], out["box_espn"]) == ("derived", None)    # Watch spoils; ESPN's isn't as of a row


def test_espn_box_waits_for_every_play_it_counts(make_feed, summary):
    """A watch stopped without restore leaves part of a finished game on screen in replay mode: ESPN's box is the
    final one, so it would spoil the rest and disagree with the field."""
    e, feed = make_feed()
    feed.summary = summary
    for team, p in iter_plays(summary)[:104]:
        feed.apply_one(team, p)
    out = build(feed, e)
    assert (out["box_source"], out["box_espn"], out["box"]["DAL"]["yards"]) == ("derived", None, 187)
    typed = tl.response(summary, [], e.state, TEST_GAME, epoch="m", mode="manual")
    assert (typed["box_source"], typed["box_espn"]) == ("derived", None)


def test_espn_box_parser_takes_live_shapes_and_refuses_partial_ones(summary):
    teams = ["TB", "DAL"]
    real = tt.espn_box(summary, teams)
    assert real["DAL"]["pass"] == {"comp": 24, "att": 42, "net": 316, "int": 2, "sacks": 0, "sack_yds": 0}
    assert (real["TB"]["top"], real["TB"]["top_s"], real["TB"]["penalties"]) == ("39:21", 2361, {"n": 14, "yds": 92})

    def with_stat(name, value, team=1):
        s = copy.deepcopy(summary)
        for st in s["boxscore"]["teams"][team]["statistics"]:
            if st["name"] == name:
                st["displayValue"] = value
        return s
    assert tt.espn_box(with_stat("rushingYards", "-3"), teams)["DAL"]["rush"]["yds"] == -3   # live: under zero
    for name, broken in (("completionAttempts", "24-42"), ("completionAttempts", "24/"), ("thirdDownEff", "--"),
                         ("possessionTime", ""), ("totalYards", None), ("turnovers", "1.5"), ("firstDowns", "²")):
        assert tt.espn_box(with_stat(name, broken), teams) is None, (name, broken)
    one_team = copy.deepcopy(summary)
    del one_team["boxscore"]["teams"][0]
    assert tt.espn_box(one_team, teams) is None and tt.espn_box({}, teams) is None and tt.espn_box(None, teams) is None
    assert tt.espn_box(summary, ["NYJ", "DAL"]) is None


# ---------------------------------------------------------------- 6a: undo never takes an ESPN play back out
def test_undo_never_takes_an_espn_play_back_out(make_feed, summary):
    """U after a play the feed (or a watch) applied used to take its row out of the log while its id stayed applied,
    so the feed never logged it again. Now the undo is refused and nothing changes; Sam's own changes made after the
    last ESPN play can still be undone."""
    e, feed = make_feed()
    feed.summary = summary
    plays = iter_plays(summary)
    for team, p in plays[:2]:                   # the opening kickoff and DAL's first snap
        feed.apply_one(team, p)
    log, applied, version = copy.deepcopy(e.state["log"]), list(feed.applied), e.version
    with pytest.raises(live.UndoRefused, match="ESPN"):
        e.undo()
    assert (e.state["log"], feed.applied, e.version) == (log, applied, version)     # nothing changed, nothing saved
    e.retag_last("A")
    assert e.state["log"][-1]["family"] == "pa"
    e.undo()                                    # a retag after the last ESPN play: still undoable
    assert e.state["log"] == log
    with pytest.raises(live.UndoRefused):
        e.undo()
    e.retag_last("A")
    feed.apply_one(*plays[2])                   # ESPN logs another play: the retag behind it can't be undone now
    with pytest.raises(live.UndoRefused):
        e.undo()
    assert e.state["log"][0]["family"] == "pa" and len(feed.applied) == 3


def test_forgetting_an_espn_game_drops_its_undo_steps_but_a_typed_game_comes_back(make_feed, summary):
    e, feed = make_feed()
    feed.apply(summary)
    e.reset()                                   # what /api/reset does: reset, then forget the applied ids
    feed.forget()
    e.undo()                                    # never back into a game whose ids are forgotten (G9: logged twice)
    assert (e.state["log"], e.state["message"]) == ([], "Nothing to undo.")
    e.command("new D25")
    e.record_play(None, 4, leaf="run_inside")
    typed = copy.deepcopy(e.state["log"])
    e.reset()
    feed.forget()
    e.undo()                                    # a typed game has no ESPN ids: U still brings it back
    assert e.state["log"] == typed


def test_a_seen_file_that_cant_be_saved_still_leaves_no_way_back(make_feed, summary, monkeypatch):
    e, feed = make_feed()
    feed.apply(summary)
    e.reset()

    def full_disk():
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(feed, "_save_seen", full_disk)
    with pytest.raises(OSError):
        feed.forget()
    assert e.history == [] and feed.applied == []          # an undo can't bring back rows whose ids are gone


def test_teams_from_a_broken_header_fall_back_to_the_game():
    for header in ({"competitions": [{"competitors": "TB DAL"}]}, {"competitions": [{"competitors": [7, {"team": 3}]}]},
                   {"competitions": "x"}, None):
        teams, order = tt.teams_of({"header": header}, TEST_GAME)
        assert order == ["TB", "DAL"] and teams["DAL"]["caller"] and teams["TB"]["color"] is None, header

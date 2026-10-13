"""Tracking both offenses (play-caller-models.md 7; game-picker.md 4; restructure-v2.md 11) on the saved TB at DAL
game: Schottenheimer calls Dallas's plays and Tampa Bay's 2026 play-caller from the table (callers.find_caller) calls
theirs, each from his own bundle (callers.load_caller). The offense with the ball predicts with its own model and
in-game memory, and each caller's calls, memory and scorecard are exactly what tracking him alone gives. Then the
engine API (possession, points, a side nobody tracks), the timeline, the archive's tracks and switching in place.
Sandboxed: never data/."""
import copy
import csv
import io
import json

import duckdb
import pytest
from helpers import TEST_GAME
from sides_helpers import SideDriver, without

import callers
import config
import live
import timeline as tl
from espn_feed import iter_plays

SEASON, WEEK = 2026, 5                  # TEST_GAME's game: 2026_05_TB_DAL
TB_GAME = {**TEST_GAME, "offense": "TB", "opponent": "DAL", "offense_is_home": False,
           "offense_spread": -TEST_GAME["offense_spread"]}
PER_TRACK = ("seq", "drive", "time")    # log position, engine drive number, wall clock: each track's own
SNAP = {"down": 1, "togo": 10, "qtr": 1, "clock": 900}


@pytest.fixture(scope="module")
def models():
    tb = callers.find_caller("TB", SEASON, WEEK)
    return {"DAL": callers.load_caller(config.CALLER_SLUG), "TB": callers.load_caller(tb["slug"])}


def fresh(sandbox, **kw):
    for p in sandbox.glob("*.json"):
        p.unlink()
    e = live.GameEngine(**kw)
    e.reset()
    return e


def played(engine, summary):
    """The whole game applied, and what the engine holds after it (copies: later tests reuse the sandbox)."""
    d = SideDriver(engine, summary)
    d.apply()
    return {"engine": engine, "log": copy.deepcopy(engine.state["log"]), "mem": copy.deepcopy(engine.state["mem"]),
            "metrics": engine.metrics(), "predictions": d.predictions}


@pytest.fixture(scope="module")
def both(sandbox, models, summary):
    return played(fresh(sandbox, callers={"TB": models["TB"], "DAL": models["DAL"]}), summary)


@pytest.fixture(scope="module")
def dal_alone(sandbox, models, summary):
    return played(fresh(sandbox, callers={"DAL": models["DAL"]}), summary)


@pytest.fixture(scope="module")
def tb_alone(sandbox, models, summary):
    """Tampa Bay's play-caller alone, with GAME from Tampa Bay's side (offense TB, away, the spread turned round)."""
    mp = pytest.MonkeyPatch()
    for k, v in TB_GAME.items():
        mp.setitem(config.GAME, k, v)
    try:
        return played(fresh(sandbox, callers={"TB": models["TB"]}), summary)
    finally:
        mp.undo()


def calls(game, team=None):
    return [without(r, PER_TRACK) for r in game["log"] if team is None or r["team"] == team]


# ---------------------------------------------------------------- the saved game, both play-callers
def test_tampa_bays_2026_caller_comes_from_the_table(models):
    assert models["TB"].name == callers.find_caller("TB", SEASON, WEEK)["name"] != models["DAL"].name
    assert models["TB"].profile["q0"] != models["DAL"].profile["q0"]


def test_the_two_callers_alternate_with_the_ball(both, models):
    e, preds = both["engine"], both["predictions"]
    assert all((p["team"], p["caller"]) == (team, models[team].name) for _, team, p in preds)
    teams = [team for _, team, _ in preds]
    turns = [t for i, t in enumerate(teams) if i == 0 or teams[i - 1] != t]
    assert turns[:4] == ["DAL", "TB", "DAL", "TB"] and len(turns) >= 15
    assert e.sides == ("TB", "DAL") and e.track == "DAL+TB"
    assert e.state["sides"] == ["TB", "DAL"] and e.profile is models["DAL"].profile     # GAME's offense leads


def test_every_call_is_logged_with_its_team_and_caller(both, models):
    log = both["log"]
    assert [r["seq"] for r in log] == list(range(1, len(log) + 1))
    assert {(r["team"], r["caller"]) for r in log} == {("DAL", models["DAL"].name), ("TB", models["TB"].name)}
    assert sum(r["team"] == "DAL" for r in log) == 59
    assert all(r["drive"] <= both["engine"].state["drive_n"] for r in log)


def test_each_callers_calls_are_exactly_his_calls_alone(both, dal_alone, tb_alone):
    assert calls(both, "DAL") == calls(dal_alone) and len(dal_alone["log"]) == 59
    assert calls(both, "TB") == calls(tb_alone) and len(tb_alone["log"]) > 50


def test_the_offense_with_the_ball_predicts_with_its_own_model(both, dal_alone, tb_alone):
    for team, alone in (("DAL", dal_alone), ("TB", tb_alone)):
        mine = [p for _, t, p in both["predictions"] if t == team]
        assert mine == [p for _, t, p in alone["predictions"]], team


def test_each_caller_keeps_his_own_in_game_memory(both, dal_alone, tb_alone, models, sandbox):
    assert both["mem"] == {"DAL": dal_alone["mem"], "TB": tb_alone["mem"]}
    start = fresh(sandbox, callers={"TB": models["TB"], "DAL": models["DAL"]}).state["mem"]
    assert start == {t: {"snap_n": 0, "qp": m.profile["q0"], "qr": m.profile["q0"], "prev": None}
                     for t, m in models.items()}


def test_each_caller_has_his_own_scorecard(both, dal_alone, tb_alone):
    e = both["engine"]
    assert e.metrics("DAL") == dal_alone["metrics"] and e.metrics("TB") == tb_alone["metrics"]
    assert e.metrics()["n"] == dal_alone["metrics"]["n"] + tb_alone["metrics"]["n"]
    with pytest.raises(ValueError, match="NYG"):
        e.metrics("NYG")


def test_the_view_lists_both_callers_in_the_order_given(both, models):
    e = both["engine"]
    v = e.view()
    assert [(t["team"], t["caller"], t["slug"]) for t in v["tracked"]] == \
        [(t, models[t].name, models[t].slug) for t in ("TB", "DAL")] == \
        [(t["team"], t["caller"], t["slug"]) for t in e.tracked()]
    for t in v["tracked"]:
        assert t["metrics"] == e.metrics(t["team"]) and t["profile"] is models[t["team"]].profile
        assert t["memory"]["snap_n"] == both["mem"][t["team"]]["snap_n"]
    assert v["metrics"] == e.metrics() and {r["team"] for r in v["log"]} == {"DAL", "TB"}


def test_a_team_nobody_tracks_gets_no_prediction(dal_alone, summary, sandbox, models):
    e = fresh(sandbox, callers={"DAL": models["DAL"]})
    d = SideDriver(e, summary)
    seen = []
    for team, p in iter_plays(summary)[:36]:          # Dallas's opening drive, then Tampa Bay's touchdown drive
        d.apply_one(team, p)
        seen.append((team, e.view()["prediction"]))
    assert any(team == "DAL" and pred for team, pred in seen)
    assert all(pred is None for team, pred in seen[14:35])          # Tampa Bay has the ball
    with pytest.raises(ValueError, match="TB"):
        e.predict("TB")


# ---------------------------------------------------------------- the engine API with two sides
def test_the_team_with_the_ball_starts_its_drive_and_ends_the_other(sandbox, models):
    e = fresh(sandbox, callers={"TB": models["TB"], "DAL": models["DAL"]})
    assert (e.state["poss"], e.state["drive_active"], e.view()["prediction"]) == (None, False, None)
    e.feed_sync({**SNAP, "yardline_100": 75}, offense_ball=True, team="TB")
    assert (e.state["poss"], e.state["drive_n"], e.state["drive_active"]) == ("TB", 1, True)
    assert (e.view()["poss"], e.view()["prediction"]["caller"]) == ("TB", models["TB"].name)
    e.record_play(None, 4, leaf="run_inside")
    assert e.state["mem"]["TB"]["prev"] is not None and e.state["mem"]["DAL"]["snap_n"] == 0
    e.feed_sync({**SNAP, "yardline_100": 80}, offense_ball=True, team="DAL")
    assert (e.state["poss"], e.state["drive_n"], e.state["mem"]["TB"]["prev"]) == ("DAL", 2, None)
    e.feed_sync({}, offense_ball=False, team="TB")    # not Tampa Bay's drive: nothing ends
    assert e.state["drive_active"] and e.view()["memory"]["snap_n"] == 0
    e.feed_sync({}, offense_ball=False)               # whoever has it
    assert not e.state["drive_active"] and (e.view()["poss"], e.view()["prediction"]) == (None, None)


def test_points_go_to_the_team_with_the_ball(sandbox, models):
    e = fresh(sandbox, callers={"TB": models["TB"], "DAL": models["DAL"]})
    e.new_drive(10, team="TB")
    e.record_play(None, 10, leaf="run_inside")
    assert (e.state["sit"]["score_off"], e.state["sit"]["score_opp"]) == (0, 7)
    assert e.state["message"].endswith("Waiting for the next drive.")
    e.new_drive(25, team="DAL")
    e.end_drive("fg")
    assert (e.state["sit"]["score_off"], e.state["sit"]["score_opp"]) == (3, 7)
    assert e.state["message"] == "Field goal good (+3). Waiting for the next drive."
    e.new_drive(70, team="TB")
    e.record_play(None, 5, leaf="run_inside")
    assert e.state["log"][-1]["score"] == "7-3"                       # his side first
    with pytest.raises(ValueError, match="NYG"):
        e.new_drive(70, team="NYG")


def test_typed_spots_and_flags_follow_the_offense_with_the_ball(sandbox, models):
    e = fresh(sandbox, callers={"TB": models["TB"], "DAL": models["DAL"]})
    e.set_situation(down=1, togo=10, spot="T25", team="TB")           # Tampa Bay's own 25
    assert (e.state["poss"], e.state["sit"]["yardline_100"], e.situation_text()) == ("TB", 75, "1st & 10 at TB 25")
    e.command("X DAL 5")                                               # on the defense
    assert e.state["message"].startswith("Done: Penalty on DAL: 5 yards") and e.state["sit"]["yardline_100"] == 70
    e.command("X TB 10")                                               # on the offense
    assert e.state["message"].startswith("Done: Penalty on TB: back 10 yards")
    e.set_situation(down=1, togo=10, spot="D20", team="DAL")           # Dallas's ball: Tampa Bay's drive ends
    assert (e.state["poss"], e.state["drive_n"], e.state["sit"]["yardline_100"]) == ("DAL", 2, 80)
    assert e.state["mem"]["TB"]["prev"] is None and e.view()["prediction"]["team"] == "DAL"
    flags = [r for r in e.state["log"] if r.get("kind") == "penalty"]
    assert [(r["team"], r["caller"]) for r in flags] == [("TB", models["TB"].name)] * 2


def test_a_game_file_of_other_sides_is_kept_aside_never_overwritten(sandbox, models):
    both = fresh(sandbox, callers={"TB": models["TB"], "DAL": models["DAL"]})
    both.new_drive(70, team="TB")
    saved = live.STATE_PATH.read_bytes()
    tonight = live.GameEngine()                                        # GAME's offense alone, on models/
    kept = list(sandbox.glob("live_state.sides-2026_05_TB_DAL-*.json"))
    assert len(kept) == 1 and kept[0].read_bytes() == saved and tonight.state["log"] == []
    assert tonight.state["message"].startswith(f"Kept the old game file as {kept[0].name}.")
    tonight.reset()
    again = live.GameEngine(callers={"TB": models["TB"], "DAL": models["DAL"]})
    assert again.state["drive_n"] == 0 and len(list(sandbox.glob("live_state.sides-*.json"))) == 2
    again.new_drive(70, team="TB")
    odd = json.loads(live.STATE_PATH.read_text())
    live.STATE_PATH.write_text(json.dumps({**odd, "poss": "NYG"}))                 # no side of this engine's
    assert live.GameEngine(callers={"TB": models["TB"], "DAL": models["DAL"]}).state["log"] == []
    assert len(list(sandbox.glob("live_state.sides-*.json"))) == 3


# ---------------------------------------------------------------- the timeline
def test_the_timeline_draws_both_offenses_calls(both, summary):
    e = both["engine"]
    applied = [str(p["id"]) for t, p in iter_plays(summary)]
    out = tl.response(summary, applied, e.state, config.GAME, epoch="both-1", client_epoch="both-1", mode="replay")
    linked = [r for r in out["rows"] if r["pred"]]
    assert len(linked) == len(e.state["log"]) and all(r["offense_is_caller"] for r in linked)
    assert all((r["pred"]["team"], r["pred"]["caller"]) == (r["team"], log["caller"])
               for r, log in zip(linked, e.state["log"]))
    assert all(r["offense_is_caller"] for r in out["rows"] if r["kind"] == "play")
    assert all(d["offense_is_caller"] for d in out["drives"])
    tb = next(r for r in out["rows"] if r["id"] == "401872980390")
    assert (tb["team"], tb["geo"]["dir"], tb["pred"]["team"]) == ("TB", -1, "TB")
    assert out["field"]["left_team"] == "DAL" and out["teams"]["DAL"]["caller"] and not out["teams"]["TB"]["caller"]


def test_the_timeline_of_hand_typed_calls_follows_each_offense(sandbox, models):
    e = fresh(sandbox, callers={"TB": models["TB"], "DAL": models["DAL"]})
    e.new_drive(75, team="DAL")
    e.record_play(None, 6, leaf="run_inside")
    e.end_drive("punt")
    e.new_drive(70, team="TB")
    e.record_play(None, 9, leaf="dropback_short")
    out = tl.response(None, [], e.state, config.GAME, epoch="m-1", client_epoch="m-1", mode="manual")
    dal, tb = out["rows"]
    geo = [(r["team"], r["opp"], r["geo"]["dir"], r["geo"]["x0"], r["geo"]["x_end"]) for r in (dal, tb)]
    assert geo == [("DAL", "TB", 1, 25, 31), ("TB", "DAL", -1, 70, 61)]          # TB attacks right to left
    assert tb["pre"]["text"] == "1st & 10 at TB 30" and tb["pred"]["caller"] == models["TB"].name
    assert [(d["team"], d["yards"], d["offense_is_caller"]) for d in out["drives"]] == [("DAL", 6, True),
                                                                                         ("TB", 9, True)]
    st = out["status"]
    assert (st["poss"], st["ball_x"], st["down_text"]) == ("TB", 61, "2nd & 1 at TB 39")
    assert set(out["box"]) == {"TB", "DAL"} and out["box"]["TB"]["pass"]["att"] == 1


# ---------------------------------------------------------------- the archive: one game, two tracks
def archived(db):
    con = duckdb.connect(str(db))
    try:
        return con.execute("SELECT track, team, count(*) FROM live_log GROUP BY ALL ORDER BY ALL").fetchall()
    finally:
        con.close()


def test_two_tracks_of_one_game_never_touch_each_others_rows(sandbox, models, monkeypatch, tmp_path):
    db = tmp_path / "shadow.duckdb"
    monkeypatch.setattr(live, "DB_PATH", db)
    tonight = fresh(sandbox)                           # the adopted track: models/
    con = tonight._db()
    con.execute("INSERT INTO live_log (game_id, snap, seq) VALUES (?, 1, 1)", [TEST_GAME["game_id"]])
    con.close()
    tonight.new_drive(75)
    tonight.record_play(None, 3, leaf="run_inside")
    monkeypatch.setattr(live, "STATE_PATH", tmp_path / "both_state.json")
    both = live.GameEngine(callers={"TB": models["TB"], "DAL": models["DAL"]})
    both.new_drive(75, team="DAL")
    both.record_play(None, 3, leaf="run_inside")
    both.new_drive(70, team="TB")
    both.record_play(None, 3, leaf="run_inside")
    assert archived(db) == [("DAL", "DAL", 1), ("DAL+TB", "DAL", 1), ("DAL+TB", "TB", 1), (None, None, 1)]
    both.reset()
    assert archived(db) == [("DAL", "DAL", 1), (None, None, 1)]
    monkeypatch.setattr(live, "STATE_PATH", sandbox / "live_state.json")
    tonight.reset()
    assert archived(db) == [(None, None, 1)], "a row from before tracks (graded live) is never deleted"


def test_the_csv_export_says_whose_call_each_row_is(both):
    head, *rows = csv.reader(io.StringIO(both["engine"].export_csv()))
    col = {name: i for i, name in enumerate(head)}
    assert "track" not in col and len(rows) == len(both["log"])
    assert [(r[col["team"]], r[col["caller"]]) for r in rows] == [(r["team"], r["caller"]) for r in both["log"]]


# ---------------------------------------------------------------- switching tracks in place
def test_reload_switches_play_callers_and_game_in_place(sandbox, models, monkeypatch, tmp_path):
    e = fresh(sandbox)
    e.new_drive(75)
    e.record_play(None, 3, leaf="run_inside")
    version, epoch = e.version, e.epoch()
    with pytest.raises(ValueError):
        e.reload(callers={"NYG": models["TB"]})
    assert e.sides == ("DAL",) and len(e.state["log"]) == 1 and e.epoch() == epoch     # nothing changed
    monkeypatch.setattr(live, "STATE_PATH", tmp_path / "live_state.json")
    e.reload(callers={"TB": models["TB"], "DAL": models["DAL"]})
    assert (e.sides, e.track, e.state["log"], e.history) == (("TB", "DAL"), "DAL+TB", [], [])
    assert e.epoch() != epoch and e.version >= version
    e.new_drive(70, team="TB")
    assert e.version > version and json.loads(live.STATE_PATH.read_text())["sides"] == ["TB", "DAL"]

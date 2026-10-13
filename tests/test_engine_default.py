"""The engine's play-caller wiring with one side (play-caller-models.md 7; restructure-v2.md 11). GameEngine() runs on
tonight's build in models/ exactly as before: every prediction and every log row of the saved TB at DAL game, bit for
bit, against the fingerprint of the Oct 12 engine (tests/fixtures/engine_default_tb_dal.json). What the wiring adds:
every caller row and prediction says whose call it is (team, caller), the view lists the tracked caller with his
scorecard, and the engine can run on one play-caller's bundle instead. Sandboxed: never data/."""
import json

import pytest
from helpers import legacy_game
from sides_helpers import GOLDEN, fingerprint

import callers
import config
import live

SCHOTTENHEIMER = "Brian Schottenheimer"


@pytest.fixture(scope="module")
def golden():
    return json.loads(GOLDEN.read_text())


@pytest.fixture(scope="module")
def default_game(make_feed, summary):
    e, feed = make_feed()
    feed.summary = summary
    return e, feed, fingerprint(e, feed, summary)


@pytest.fixture(scope="module")
def schottenheimer():
    return callers.load_caller(config.CALLER_SLUG)


def fresh(sandbox, **kw):
    for p in sandbox.glob("*.json"):
        p.unlink()
    e = live.GameEngine(**kw)
    e.reset()
    return e


# ---------------------------------------------------------------- the default stays today's engine
def test_the_default_engine_is_bit_identical_to_the_oct_12_engine(default_game, golden):
    fp = default_game[2]
    assert len(fp["predictions"]) == len(golden["predictions"]) == 70
    for i, (got, want) in enumerate(zip(fp["predictions"], golden["predictions"])):
        assert got == want, f"the prediction made after ESPN play {i} differs"
    assert len(fp["rows"]) == len(golden["rows"]) == 59
    for i, (got, want) in enumerate(zip(fp["rows"], golden["rows"])):
        assert got == want, f"log row {i + 1} differs"
    assert {k: fp[k] for k in golden} == golden


def test_the_default_engine_tracks_games_offense_on_tonights_build(default_game):
    e = default_game[0]
    assert e.sides == ("DAL",) and e.track == "DAL"
    assert e.tracked() == [{"team": "DAL", "caller": SCHOTTENHEIMER, "slug": config.CALLER_SLUG}]
    assert e.profile["caller"] == SCHOTTENHEIMER and set(e.models) == {"DAL"}
    assert "sides" not in e.state and "poss" not in e.state            # today's file shape
    assert set(e.state["mem"]) == {"snap_n", "qp", "qr", "prev"}


def test_every_row_and_prediction_says_whose_call_it_is(default_game):
    e = default_game[0]
    assert all((r["team"], r["caller"]) == ("DAL", SCHOTTENHEIMER) for r in e.state["log"])
    assert all((r["team"], r["caller"]) == ("DAL", SCHOTTENHEIMER) for r in e.view()["log"])
    p = e.predict()
    assert (p["team"], p["caller"]) == ("DAL", SCHOTTENHEIMER)


def test_his_metrics_are_the_scorecard_as_before(default_game, golden):
    e = default_game[0]
    assert e.metrics() == e.metrics("DAL") == golden["metrics"]
    with pytest.raises(ValueError, match="TB"):
        e.metrics("TB")                                    # the opponent is nobody's side here


def test_the_view_lists_the_tracked_caller_with_his_scorecard(default_game):
    v = default_game[0].view()
    assert (v["poss"], v["prediction"]) == (None, None)                    # the game is over
    (only,) = v["tracked"]
    assert (only["team"], only["caller"], only["slug"]) == ("DAL", SCHOTTENHEIMER, config.CALLER_SLUG)
    assert only["metrics"] == v["metrics"] and only["profile"] == v["profile"] and only["memory"] == v["memory"]


def test_a_game_saved_before_callers_loads_with_its_rows_named(make_feed, summary):
    e, feed = make_feed()
    feed.apply(summary)
    live.STATE_PATH.write_text(json.dumps(legacy_game(e.state)))
    again = live.GameEngine()
    assert all((r["team"], r["caller"]) == ("DAL", SCHOTTENHEIMER) for r in again.state["log"])
    assert [r["seq"] for r in again.state["log"]] == list(range(1, 60))
    assert again.metrics("DAL") == e.metrics()


def test_messages_name_the_tracked_team(make_feed):
    e, feed = make_feed()
    assert e.state["message"] == "Set the start of DAL's first drive."
    e.new_drive(75)
    assert e.view()["poss"] == "DAL"
    e.end_drive("punt")
    assert e.state["message"] == "Punt. Waiting for the next DAL drive."
    with pytest.raises(ValueError, match="No DAL drive in progress"):
        e.record_play(None, 3, leaf="run_inside")


# ---------------------------------------------------------------- the settings and the error the app catches
def test_the_callers_slug_is_made_from_his_name():
    assert config.CALLER_SLUG == callers.slugify(config.CALLER_NAME)


def test_one_model_version_error_for_models_and_bundles():
    assert live.ModelVersionError is callers.ModelVersionError


# ---------------------------------------------------------------- one play-caller's bundle
def test_one_bundle_runs_his_side_from_his_own_memory_start(sandbox, schottenheimer):
    e = fresh(sandbox, caller=schottenheimer)
    q0 = schottenheimer.profile["q0"]
    assert (e.sides, e.track) == (("DAL",), "DAL")
    assert e.profile is schottenheimer.profile and e.tracked()[0]["slug"] == schottenheimer.slug
    assert e.state["mem"] == {"snap_n": 0, "qp": q0, "qr": q0, "prev": None}
    e.new_drive(75)
    his = e.predict()
    tonight = live.GameEngine()                            # tonight's build, on the same saved game
    assert tonight.state["sit"] == e.state["sit"] and tonight.predict()["p"] != his["p"]
    assert (his["team"], his["caller"]) == ("DAL", schottenheimer.name)


@pytest.mark.parametrize("kw", [
    {"callers": {}}, {"callers": {"NYG": "model"}}, {"callers": {"DAL": "brian-schottenheimer"}},
    {"callers": ["DAL"]}, {"caller": "brian-schottenheimer"}])
def test_the_engine_refuses_play_callers_it_cant_run(sandbox, kw):
    with pytest.raises(ValueError):
        live.GameEngine(**kw)


def test_the_engine_takes_one_caller_or_one_per_team_not_both(sandbox, schottenheimer):
    with pytest.raises(ValueError, match="not both"):
        live.GameEngine(caller=schottenheimer, callers={"DAL": schottenheimer})
    with pytest.raises(ValueError, match="doesn't play in this game"):
        live.GameEngine(callers={"DAL": schottenheimer, "NYG": schottenheimer})
    with pytest.raises(ValueError):
        live.GameEngine(callers={"DAL": schottenheimer, "TB": schottenheimer, "NYG": schottenheimer})

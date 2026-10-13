"""live_sides.py: the play-callers an engine runs on and the game as each offense sees it (play-caller-models.md 7).
Pure: no game file, no archive; the bundles are the real ones in models/callers."""
import math

import pytest
from helpers import TEST_GAME

import callers
import config
import live_sides
from features import base_row
from live_sides import side_game, side_sit, track_key

TB_SIDE = {**TEST_GAME, "offense": "TB", "opponent": "DAL", "offense_is_home": False, "offense_spread": -9.5,
           "total_line": 49.5}
SIT = {"down": 2, "togo": 7, "yardline_100": 41, "qtr": 3, "clock": 400, "score_off": 16, "score_opp": 24,
       "clock_estimated": False}


@pytest.fixture(scope="module")
def schottenheimer():
    return callers.load_caller(config.CALLER_SLUG)


def test_games_offense_sees_game_itself():
    assert side_game(TEST_GAME, "DAL") is TEST_GAME and side_sit(SIT, TEST_GAME, "DAL") is SIT


def test_the_opponent_sees_game_turned_around():
    tb = side_game(TEST_GAME, "TB")
    assert (tb["offense"], tb["opponent"], tb["offense_is_home"]) == ("TB", "DAL", False)
    assert (tb["offense_spread"], tb["total_line"]) == (-TEST_GAME["offense_spread"], TEST_GAME["total_line"])
    assert TEST_GAME["offense"] == "DAL"                                   # GAME itself is never changed
    assert side_sit(SIT, TEST_GAME, "TB") == {**SIT, "score_off": 24, "score_opp": 16}
    assert base_row(side_sit(SIT, TEST_GAME, "TB"), tb)[4] == 8.0         # leading by 8 from Tampa Bay's side


def test_a_tracks_own_config_for_a_side_wins_when_it_has_the_line():
    game = {**TEST_GAME, "by_side": {"DAL": dict(TEST_GAME), "TB": TB_SIDE}}
    assert side_game(game, "TB") is TB_SIDE and side_game(game, "DAL") is game


@pytest.mark.parametrize("own", [
    {**TB_SIDE, "offense_spread": None}, {**TB_SIDE, "total_line": math.nan}, {**TB_SIDE, "offense_is_home": 0},
    {**TB_SIDE, "offense": "DAL"}, {**TB_SIDE, "offense_spread": True}, "TB", None])
def test_a_side_config_without_a_usable_line_falls_back_to_game_turned_around(own):
    tb = side_game({**TEST_GAME, "by_side": {"TB": own}}, "TB")
    assert (tb["offense_spread"], tb["total_line"], tb["offense_is_home"]) == (-8.5, 48.5, False)


def test_track_keys_sort_the_sides():
    assert (track_key(["DAL"]), track_key(("TB", "DAL")), track_key(["DAL", "TB"])) == ("DAL", "DAL+TB", "DAL+TB")


def test_a_bundle_side_carries_his_name_slug_and_memory_start(schottenheimer):
    side = live_sides.bundle_side("DAL", schottenheimer)
    assert (side.team, side.caller, side.slug) == ("DAL", schottenheimer.name, schottenheimer.slug)
    assert (side.alpha, side.q0) == (schottenheimer.profile["alpha"], schottenheimer.profile["q0"])
    assert side.w == {c: v["est"] for c, v in schottenheimer.profile["coefs"].items()}
    assert side.stage1 is schottenheimer.stage1 and side.granular is schottenheimer.granular


def test_the_default_side_is_tonights_build_in_models(tmp_path):
    side = live_sides.default_side("DAL", config.MODEL_DIR)
    assert (side.caller, side.slug) == (config.CALLER_NAME, config.CALLER_SLUG)
    with pytest.raises(FileNotFoundError):
        live_sides.default_side("DAL", tmp_path)                           # app.py rebuilds models/ on this


def test_models_built_with_another_scikit_learn_are_refused(tmp_path):
    (tmp_path / "profile.json").write_text('{"sklearn": "0.0.1"}')
    with pytest.raises(callers.ModelVersionError, match="0.0.1"):
        live_sides.default_side("DAL", tmp_path)


def test_make_sides_lists_the_sides_in_the_order_given(schottenheimer):
    sides = live_sides.make_sides(TEST_GAME, config.MODEL_DIR, by_team={"TB": schottenheimer, "DAL": schottenheimer})
    assert [s.team for s in sides] == ["TB", "DAL"]
    (one,) = live_sides.make_sides(TEST_GAME, config.MODEL_DIR, caller=schottenheimer)
    assert one.team == "DAL"

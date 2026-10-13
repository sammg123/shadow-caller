"""Per-game state (tracks.py; docs/design/game-picker.md 4): a track is (event, sides) with a folder of its own, its
config frozen in game.json when it is first made, and index.json naming the current one. Temp folders only."""
import json

import pytest

import tracks

TB_DAL = "401872980"
DAL_SIDE = {"game_id": "2026_05_TB_DAL", "label": "Buccaneers at Cowboys, Week 5, Thu Oct 8", "offense": "DAL",
            "opponent": "TB", "offense_is_home": True, "offense_spread": 9.5, "total_line": 49.5,
            "espn_event": TB_DAL, "line_source": "nflverse", "line_note": None}
TB_SIDE = {**DAL_SIDE, "offense": "TB", "opponent": "DAL", "offense_is_home": False, "offense_spread": -9.5}
DAL_CALLER = {"name": "Brian Schottenheimer", "slug": "brian-schottenheimer"}
TB_CALLER = {"name": "Zac Robinson", "slug": "zac-robinson"}
ABOUT = {"label": "Buccaneers at Cowboys, Week 5, Thu Oct 8", "away": "TB", "home": "DAL"}


def dal_track(**kw):
    return tracks.make_track(TB_DAL, ["DAL"], {"DAL": DAL_SIDE}, {"DAL": DAL_CALLER}, **kw)


def both_track():
    return tracks.make_track(TB_DAL, ["TB", "DAL"], {"TB": TB_SIDE, "DAL": DAL_SIDE},
                             {"TB": TB_CALLER, "DAL": DAL_CALLER})


# ---------------------------------------------------------------- keys and folders
@pytest.mark.parametrize("sides, key", [(["DAL"], "DAL"), (["TB", "DAL"], "DAL+TB"), (("DAL", "TB"), "DAL+TB")])
def test_a_tracks_key_is_its_sides_sorted_and_joined(sides, key):
    assert tracks.track_key(sides) == key


def test_each_track_has_its_own_folder(tmp_path):
    assert tracks.track_dir(tmp_path, TB_DAL, ["DAL"]) == tmp_path / "games" / TB_DAL / "DAL"
    assert tracks.track_dir(tmp_path, TB_DAL, ["TB", "DAL"]) == tmp_path / "games" / TB_DAL / "DAL+TB"
    state, seen = tracks.state_paths(tmp_path, both_track())
    assert (state.name, seen.name, state.parent) == ("live_state.json", "feed_seen.json",
                                                     tmp_path / "games" / TB_DAL / "DAL+TB")


@pytest.mark.parametrize("event_id, sides", [("40187298x", ["DAL"]), ("../x", ["DAL"]), (TB_DAL, ["../x"]),
                                             (TB_DAL, []), (TB_DAL, ["DAL", "DAL"]), (TB_DAL, ["A", "B", "C"])])
def test_a_folder_name_never_leaves_the_games_folder(tmp_path, event_id, sides):
    with pytest.raises(ValueError):
        tracks.track_dir(tmp_path, event_id, sides)


@pytest.mark.parametrize("sides", [[{"team": "DAL"}], [["DAL"]], ["DAL", {"x": 1}], [None, "DAL"], [7], [b"DAL"]])
def test_sides_that_arent_text_get_the_plain_reason(sides):
    """Anything but a string (a dict or a list can't even go in a set) is the same 400 as any other bad side."""
    with pytest.raises(ValueError) as err:
        tracks.check_sides(sides)
    assert str(err.value) == tracks.SIDES_HELP


# ---------------------------------------------------------------- the config of a track
def test_one_side_keeps_its_config_and_names_its_side():
    game = dal_track().config()
    assert {k: game[k] for k in DAL_SIDE} == DAL_SIDE
    assert (game["sides"], game["track"]) == (["DAL"], "DAL")


def test_both_sides_take_the_home_sides_config_with_each_sides_own_line():
    game = both_track().config()
    assert (game["offense"], game["opponent"], game["offense_is_home"]) == ("DAL", "TB", True)
    assert (game["sides"], game["track"]) == (["TB", "DAL"], "DAL+TB")
    assert game["by_side"]["TB"]["offense_spread"] == -9.5 and game["by_side"]["DAL"]["offense_spread"] == 9.5
    assert game["by_side"]["TB"]["total_line"] == game["total_line"] == 49.5


def test_a_tracks_config_is_a_fresh_copy_every_time():
    t = both_track()
    game = t.config()
    game["by_side"]["TB"]["offense_spread"] = 0
    assert t.config()["by_side"]["TB"]["offense_spread"] == -9.5
    with pytest.raises(TypeError):
        t.game["offense"] = "TB"


def test_the_sides_go_away_then_home_whatever_order_they_came_in():
    t = tracks.make_track(TB_DAL, ["DAL", "TB"], {"TB": TB_SIDE, "DAL": DAL_SIDE},
                          {"TB": TB_CALLER, "DAL": DAL_CALLER})
    assert t.sides == ("TB", "DAL") and t.key == "DAL+TB"


# ---------------------------------------------------------------- game.json: frozen when the track is made
def test_a_new_track_is_written_with_its_game_and_found_again(tmp_path):
    assert tracks.load_track(tmp_path, TB_DAL, ["DAL"]) is None
    assert tracks.save_track(tmp_path, dal_track(), ABOUT) is True
    doc = json.loads((tmp_path / "games" / TB_DAL / "game.json").read_text())
    assert (doc["event_id"], doc["away"], doc["home"], doc["label"]) == (TB_DAL, "TB", "DAL", ABOUT["label"])
    found = tracks.load_track(tmp_path, TB_DAL, ["DAL"])
    assert found.config() == dal_track().config() and found.callers == {"DAL": DAL_CALLER}
    assert found.model == "callers"


def test_a_tracks_line_is_frozen_once_made(tmp_path):
    tracks.save_track(tmp_path, dal_track(), ABOUT)
    moved = tracks.make_track(TB_DAL, ["DAL"], {"DAL": {**DAL_SIDE, "offense_spread": 3.0}}, {"DAL": DAL_CALLER})
    assert tracks.save_track(tmp_path, moved, ABOUT) is False
    assert tracks.load_track(tmp_path, TB_DAL, ["DAL"]).config()["offense_spread"] == 9.5


def test_another_track_of_the_game_joins_the_same_file_and_leaves_the_first_alone(tmp_path):
    tracks.save_track(tmp_path, dal_track(model="default"), ABOUT)
    first = (tmp_path / "games" / TB_DAL / "game.json").read_text()
    tracks.save_track(tmp_path, both_track(), ABOUT)
    doc = json.loads((tmp_path / "games" / TB_DAL / "game.json").read_text())
    assert sorted(doc["tracks"]) == ["DAL", "DAL+TB"]
    assert doc["tracks"]["DAL"] == json.loads(first)["tracks"]["DAL"]
    assert tracks.load_track(tmp_path, TB_DAL, ["DAL"]).model == "default"
    assert tracks.load_track(tmp_path, TB_DAL, ["DAL", "TB"]).key == "DAL+TB"


def test_forgetting_a_just_made_track_puts_game_json_back(tmp_path):
    tracks.save_track(tmp_path, dal_track(), ABOUT)
    before = (tmp_path / "games" / TB_DAL / "game.json").read_bytes()
    tracks.save_track(tmp_path, both_track(), ABOUT)
    tracks.forget_track(tmp_path, both_track())
    assert (tmp_path / "games" / TB_DAL / "game.json").read_bytes() == before
    tracks.forget_track(tmp_path, dal_track())
    assert not (tmp_path / "games" / TB_DAL / "game.json").exists()


@pytest.mark.parametrize("junk", ["{", "[]", '{"tracks": []}', '{"tracks": {"DAL": {"game": 5}}}'])
def test_a_broken_game_file_is_an_error_never_a_new_line(tmp_path, junk):
    path = tmp_path / "games" / TB_DAL / "game.json"
    path.parent.mkdir(parents=True)
    path.write_text(junk)
    with pytest.raises(ValueError):
        tracks.load_track(tmp_path, TB_DAL, ["DAL"])
    with pytest.raises(ValueError):
        tracks.save_track(tmp_path, dal_track(), ABOUT)
    assert path.read_text() == junk


# ---------------------------------------------------------------- index.json: the current track
def test_no_index_means_no_current_track(tmp_path):
    assert tracks.read_index(tmp_path) is None and tracks.current(tmp_path) is None


def test_the_current_track_is_written_whole_and_opened_again(tmp_path):
    tracks.save_track(tmp_path, both_track(), ABOUT)
    tracks.write_index(tmp_path, {"version": 1, "adopted": {"from": "live_state.json"}})
    tracks.set_current(tmp_path, both_track())
    index = tracks.read_index(tmp_path)
    assert index["current"] == {"event_id": TB_DAL, "sides": ["TB", "DAL"]}
    assert index["adopted"] == {"from": "live_state.json"}, "the rest of the index stays"
    assert tracks.current(tmp_path).key == "DAL+TB"
    assert not list((tmp_path / "games").glob("*.tmp")), "no temp file left behind"


def test_a_current_track_missing_from_its_game_file_is_an_error(tmp_path):
    tracks.write_index(tmp_path, {"version": 1, "current": {"event_id": TB_DAL, "sides": ["DAL"]}})
    with pytest.raises(ValueError):
        tracks.current(tmp_path)


# ---------------------------------------------------------------- what /api/state says about it
def test_the_state_names_the_track_and_its_callers():
    assert tracks.track_view(both_track()) == {"event_id": TB_DAL, "sides": ["TB", "DAL"], "label": "TB at DAL"}
    assert tracks.tracked_view(both_track()) == [{"team": "TB", "caller": "Zac Robinson", "slug": "zac-robinson"},
                                                 {"team": "DAL", "caller": "Brian Schottenheimer",
                                                  "slug": "brian-schottenheimer"}]


def test_a_neutral_site_game_says_vs_like_the_picker():
    """games.matchup says 'Eagles vs Jaguars' at a neutral site; the top bar's label says vs too (the flag is frozen
    with the track's config). Any other game, or a config from before the flag, says at."""
    london = {**DAL_SIDE, "neutral": True}
    assert tracks.matchup_of(london) == "TB vs DAL"
    made = tracks.make_track(TB_DAL, ["TB", "DAL"], {"TB": {**TB_SIDE, "neutral": True}, "DAL": london},
                             {"TB": TB_CALLER, "DAL": DAL_CALLER})
    assert tracks.track_view(made)["label"] == "TB vs DAL"
    assert tracks.track_view(None, london)["label"] == "TB vs DAL"
    assert tracks.matchup_of({**DAL_SIDE, "neutral": False}) == tracks.matchup_of(DAL_SIDE) == "TB at DAL"


def test_without_a_track_the_state_names_config_games_side():
    game = {**DAL_SIDE}
    assert tracks.track_view(None, game) == {"event_id": TB_DAL, "sides": ["DAL"], "label": "TB at DAL"}
    away = {**TB_SIDE, "label": "x"}
    assert tracks.track_view(None, away)["label"] == "TB at DAL"
    assert tracks.tracked_view(None, game, "Brian Schottenheimer") == [
        {"team": "DAL", "caller": "Brian Schottenheimer", "slug": "brian-schottenheimer"}]

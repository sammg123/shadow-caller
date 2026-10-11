"""Game picker, what the engine needs for a picked game (docs/design/game-picker.md): game_config (nflverse's betting
line first, ESPN's odds second, a plain flag when neither has one) and callers_for (the play-caller table). The
schedule and ESPN answers are real (tests/fixtures/espn; the TB at DAL summary is data/espn's saved final, read only).
Never the network."""
import copy
import json
import urllib.error

import pytest

from helpers import ESPN_FILE, FIXTURES
from test_games import ESPN_FIX, PHI_JAX, TB_DAL, Clock, FakeESPN

import games

SCHEDULE = json.loads((FIXTURES / "espn" / "nflverse_schedules_2026.json").read_text())["rows"]
ODDS_PHI_JAX = json.loads((ESPN_FIX / "summary_401872981_odds.json").read_text())
BUF_LAR = "401872994"
NYG_WSH = "401872988"
TABLE_HEAD = "season,team,first_week,last_week,play_caller,role,source\n"


def schedule(rows=None, fail=False):
    """nflreadpy's load_schedules, as the slim rows games.py keeps; `fail` raises like nflverse being unreachable."""
    calls = []

    def load(season):
        calls.append(season)
        if fail:
            raise ConnectionError("Failed to download games.parquet")
        return copy.deepcopy(SCHEDULE if rows is None else rows)
    load.calls = calls
    return load


def without_line(event_id):
    return [{**r, "spread_line": None, "total_line": None} if r["espn"] == event_id else r for r in SCHEDULE]


def summaries(by_id):
    calls = []

    def fetch(event_id):
        calls.append(event_id)
        if event_id not in by_id:
            raise urllib.error.URLError("ESPN is down")
        return copy.deepcopy(by_id[event_id])
    fetch.calls = calls
    return fetch


def make(tmp_path, **kw):
    kw.setdefault("load_schedule", schedule())
    kw.setdefault("fetch_summary", summaries({}))
    return games.Games(tmp_path, fetch_json=FakeESPN(), clock=Clock(), **kw)


# ---------------------------------------------------------------- game_config
def test_dallas_at_home_against_tampa_bay(tmp_path):
    """The sign: nflverse's spread_line is the home team's margin (positive = home favored), config.py's
    offense_spread is the offense's (positive = offense favored). Dallas, at home and favored, is positive."""
    assert make(tmp_path).game_config(TB_DAL, "DAL") == {
        "game_id": "2026_05_TB_DAL", "label": "Buccaneers at Cowboys, Week 5, Thu Oct 8",
        "offense": "DAL", "opponent": "TB", "offense_is_home": True,
        "offense_spread": 9.5, "total_line": 49.5, "espn_event": TB_DAL,
        "line_source": "nflverse", "line_note": None,
    }


def test_tampa_bay_is_the_same_game_from_the_other_side(tmp_path):
    cfg = make(tmp_path).game_config(TB_DAL, "TB")
    assert (cfg["game_id"], cfg["offense"], cfg["opponent"], cfg["offense_is_home"]) == ("2026_05_TB_DAL", "TB",
                                                                                          "DAL", False)
    assert (cfg["offense_spread"], cfg["total_line"]) == (-9.5, 49.5)


def test_espns_odds_stand_in_when_nflverse_has_no_line(tmp_path):
    """ESPN's pickcenter for TB at DAL: 'DAL -8.5', spread -8.5 (the home side), over/under 49.5."""
    fetch = summaries({TB_DAL: json.loads(ESPN_FILE.read_text())})
    g = make(tmp_path, load_schedule=schedule(without_line(TB_DAL)), fetch_summary=fetch)
    dal, tb = g.game_config(TB_DAL, "DAL"), g.game_config(TB_DAL, "TB")
    assert (dal["offense_spread"], dal["total_line"], dal["line_source"], dal["line_note"]) == (8.5, 49.5, "espn", None)
    assert (tb["offense_spread"], tb["total_line"]) == (-8.5, 49.5)


def test_espns_odds_stand_in_when_nflverse_is_unreachable(tmp_path):
    g = make(tmp_path, load_schedule=schedule(fail=True), fetch_summary=summaries({PHI_JAX: ODDS_PHI_JAX}))
    cfg = g.game_config(PHI_JAX, "JAX")
    assert (cfg["offense_spread"], cfg["total_line"], cfg["line_source"]) == (7.5, 41.5, "espn")
    assert cfg["label"] == "Eagles vs Jaguars, Week 5, Sun Oct 11", "a neutral site says vs"
    assert cfg["game_id"] == "2026_05_PHI_JAX"


def test_no_line_anywhere_is_flagged_and_never_invented(tmp_path):
    no_odds = {**ODDS_PHI_JAX, "pickcenter": []}
    g = make(tmp_path, load_schedule=schedule(without_line(PHI_JAX)), fetch_summary=summaries({PHI_JAX: no_odds}))
    cfg = g.game_config(PHI_JAX, "PHI")
    assert (cfg["offense_spread"], cfg["total_line"], cfg["line_source"]) == (None, None, None)
    assert cfg["line_note"] == ("No betting line for Eagles vs Jaguars yet: neither nflverse nor ESPN has one, and the "
                                "model needs the spread and the total.")


@pytest.mark.parametrize("pick", [
    {"details": "JAX -7.5", "spread": 7.5, "overUnder": 41.5},          # the two disagree: neither is trusted
    {"details": "JAX -7.5", "spread": -7.5, "overUnder": "41.5"},       # a total that isn't a number
    {"details": "JAX -7.5", "spread": -7.5, "overUnder": 410},          # a total no game has
    {"details": "JAX -75", "spread": -75.0, "overUnder": 41.5},         # a spread no game has
    {"details": "KC -7.5", "overUnder": 41.5},                          # another team
    {"spread": float("nan"), "overUnder": 41.5},
    {"spread": True, "overUnder": 41.5},
])
def test_espn_odds_that_dont_add_up_are_not_a_line(tmp_path, pick):
    odds = {**ODDS_PHI_JAX, "pickcenter": [{"provider": {"name": "DraftKings"}, **pick}]}
    g = make(tmp_path, load_schedule=schedule(without_line(PHI_JAX)), fetch_summary=summaries({PHI_JAX: odds}))
    assert g.game_config(PHI_JAX, "JAX")["line_source"] is None


def test_espn_odds_read_from_the_details_alone_or_even(tmp_path):
    for pick, want in (({"details": "PHI -3", "overUnder": 44}, -3.0), ({"details": "EVEN", "overUnder": 44}, 0.0),
                       ({"spread": -2.5, "overUnder": 44}, 2.5)):
        odds = {**ODDS_PHI_JAX, "pickcenter": [pick]}
        g = make(tmp_path, load_schedule=schedule(without_line(PHI_JAX)), fetch_summary=summaries({PHI_JAX: odds}))
        assert g.game_config(PHI_JAX, "JAX")["offense_spread"] == want, pick


def test_a_team_named_the_nflverse_way_is_the_same_team(tmp_path):
    cfg = make(tmp_path).game_config(BUF_LAR, "LA")
    assert (cfg["offense"], cfg["opponent"], cfg["game_id"]) == ("LAR", "BUF", "2026_05_BUF_LA")
    assert (cfg["offense_is_home"], cfg["offense_spread"], cfg["total_line"]) == (True, 3.5, 54.5)


def test_a_team_not_in_the_game_or_a_bad_id_is_refused(tmp_path):
    g = make(tmp_path)
    for event_id, offense in ((TB_DAL, "KC"), (TB_DAL, ""), (TB_DAL, None), (TB_DAL, "dal<"), ("40187x", "DAL")):
        with pytest.raises(ValueError):
            g.game_config(event_id, offense)


def test_nflverse_is_downloaded_once_and_kept_on_disk(tmp_path):
    load = schedule()
    g = make(tmp_path, load_schedule=load)
    g.game_config(TB_DAL, "DAL")
    g.game_config(PHI_JAX, "PHI")
    assert load.calls == [2026]
    assert (tmp_path / "nflverse" / "schedules_2026.json").is_file()
    restarted = make(tmp_path, load_schedule=schedule(fail=True))
    assert restarted.game_config(TB_DAL, "DAL")["line_source"] == "nflverse", "the copy on disk"


def test_offline_lines_come_from_the_saved_schedule(tmp_path):
    load = schedule()
    g = games.Games(tmp_path, offline=True, fixtures_dir=ESPN_FIX, fetch_json=FakeESPN(), clock=Clock(),
                    load_schedule=load, fetch_summary=summaries({}))
    cfg = g.game_config(TB_DAL, "DAL")
    assert (cfg["offense_spread"], cfg["total_line"], cfg["line_source"]) == (9.5, 49.5, "nflverse")
    assert load.calls == []


# ---------------------------------------------------------------- callers_for
def test_callers_for_names_each_teams_play_caller_that_week(tmp_path):
    (tmp_path / "play_callers.csv").write_text(TABLE_HEAD + "2026,DAL,1,22,Brian Schottenheimer,HC,https://x.org/a\n")
    g = make(tmp_path, has_model=lambda name: name == "Brian Schottenheimer")
    assert g.callers_for(TB_DAL) == {
        "DAL": {"name": "Brian Schottenheimer", "role": "HC", "source": "https://x.org/a", "model": True},
        "TB": None,
    }


def test_the_new_table_wins_when_it_exists(tmp_path):
    (tmp_path / "play_callers.csv").write_text(TABLE_HEAD + "2026,DAL,1,22,Brian Schottenheimer,HC,a\n")
    (tmp_path / "play_callers_2024_2026.csv").write_text(TABLE_HEAD + "2026,DAL,1,22,Brian Schottenheimer,HC,b\n"
                                                         "2026,TB,1,22,Tampa Caller,OC,c\n")
    callers = make(tmp_path).callers_for(TB_DAL)
    assert (callers["DAL"]["source"], callers["TB"]["name"], callers["TB"]["model"]) == ("b", "Tampa Caller", False)


def test_a_mid_season_change_and_nflverse_team_names(tmp_path):
    (tmp_path / "play_callers.csv").write_text(TABLE_HEAD + "2026,NYG,1,4,First Caller,OC,a\n"
                                               "2026,NYG,5,22,Second Caller,HC,b\n"
                                               "2026,WAS,1,22,Commanders Caller,OC,c\n"
                                               "2026,LA,1,22,Rams Caller,HC,d\n2025,BUF,1,22,Last Year,OC,e\n")
    g = make(tmp_path)
    assert {k: v["name"] for k, v in g.callers_for(NYG_WSH).items()} == {"NYG": "Second Caller",
                                                                        "WSH": "Commanders Caller"}
    assert g.callers_for(BUF_LAR) == {"BUF": None, "LAR": {"name": "Rams Caller", "role": "HC", "source": "d",
                                                           "model": False}}


def test_broken_rows_are_skipped_and_a_missing_table_means_nobody(tmp_path):
    assert make(tmp_path).callers_for(TB_DAL) == {"DAL": None, "TB": None}
    (tmp_path / "play_callers.csv").write_text(TABLE_HEAD + "x,DAL,1,22,A,HC,a\n2026,DAL,0,22,B,HC,b\n"
                                               "2026,D A L,1,22,C,HC,c\n2026,DAL,1,22,,HC,d\n"
                                               "2026,DAL,9,3,E,HC,e\n2026,TB,1,22," + "z" * 200 + ",OC,f\n")
    assert make(tmp_path).callers_for(TB_DAL) == {"DAL": None, "TB": None}


def test_a_table_without_week_columns_covers_the_whole_season(tmp_path):
    (tmp_path / "play_callers_2024_2026.csv").write_text("season,team,play_caller\n2026,TB,Tampa Caller\n")
    assert make(tmp_path).callers_for(TB_DAL)["TB"] == {"name": "Tampa Caller", "role": None, "source": None,
                                                        "model": False}


def test_postseason_weeks_count_on_from_the_regular_season():
    assert games.nflverse_week(2, 5, regular_weeks=18) == 5
    assert games.nflverse_week(3, 1, regular_weeks=18) == 19
    assert games.nflverse_week(3, 4, regular_weeks=18) == 22

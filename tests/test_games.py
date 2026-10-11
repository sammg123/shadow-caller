"""Game picker, the schedule (docs/design/game-picker.md): ESPN's 2026 scoreboards parsed into games, the week cache,
the season listing and pasted game references. The ESPN answers are real (fetched 2026-10-10, trimmed:
tests/fixtures/espn); a live game is one of them with its status set the way ESPN writes one in progress. Never the
network, never data/."""
import copy
import json
import urllib.error
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import pytest

from helpers import FIXTURES

import games

ESPN_FIX = FIXTURES / "espn"
NOW = datetime(2026, 10, 10, 18, 0, tzinfo=timezone.utc).timestamp()      # the Saturday of week 5
TB_DAL = "401872980"
PHI_JAX = "401872981"                                                     # week 5, London: a neutral site


def board(stype, week):
    path = ESPN_FIX / f"scoreboard_2026_{stype}_{week:02d}.json"
    return json.loads(path.read_text()) if path.exists() else None


def empty_board(stype, week):
    """A week ESPN answers with no games (the weeks the fixtures don't keep)."""
    return {"season": {"type": stype, "year": 2026}, "week": {"number": week},
            "leagues": copy.deepcopy(board(2, 5)["leagues"]), "events": []}


def in_progress(scoreboard, event_id, *, away=3, home=7, name="STATUS_IN_PROGRESS", short="12:34 - 2nd"):
    """The scoreboard with one game in progress, its status written the way ESPN writes a live one."""
    out = copy.deepcopy(scoreboard)
    for ev in out["events"]:
        if ev["id"] != event_id:
            continue
        comp = ev["competitions"][0]
        comp["status"] = {"clock": 754.0, "displayClock": "12:34", "period": 2,
                          "type": {"name": name, "state": "in", "completed": False, "detail": short,
                                   "shortDetail": short}}
        for c in comp["competitors"]:
            c["score"] = str(home if c["homeAway"] == "home" else away)
    return out


class FakeESPN:
    """ESPN's scoreboard from the fixtures (an empty week for the weeks they don't keep). Records every URL asked for;
    `fail` weeks raise like a network that is down, `answers` replace a week's answer."""

    def __init__(self, answers=None, fail=()):
        self.urls, self.answers, self.fail = [], dict(answers or {}), set(fail)

    def __call__(self, url, timeout=10):
        self.urls.append(url)
        parts = urlsplit(url)
        assert parts.scheme == "https" and parts.netloc == "site.api.espn.com", url
        assert parts.path == "/apis/site/v2/sports/football/nfl/scoreboard", url
        q = parse_qs(parts.query)
        assert q["dates"] == ["2026"], url
        key = (int(q["seasontype"][0]), int(q["week"][0]))
        if key in self.fail:
            raise urllib.error.URLError("ESPN is down")
        if key in self.answers:
            return copy.deepcopy(self.answers[key])
        return copy.deepcopy(board(*key) or empty_board(*key))

    def count(self, stype, week):
        asked = [parse_qs(urlsplit(u).query) for u in self.urls]
        return sum(1 for q in asked if (q["seasontype"], q["week"]) == ([str(stype)], [str(week)]))


class Clock:
    def __init__(self, t=NOW):
        self.t = t

    def __call__(self):
        return self.t


def make(tmp_path, fetch=None, clock=None, **kw):
    return games.Games(tmp_path, fetch_json=fetch or FakeESPN(), clock=clock or Clock(), **kw)


# ---------------------------------------------------------------- parsing a week
def test_week_5_parses_every_game_with_its_teams_status_and_score():
    week = games.parse_week(board(2, 5), 2026, 2, 5)
    assert len(week) == 15
    tb_dal = next(g for g in week if g["event_id"] == TB_DAL)
    assert tb_dal == {
        "event_id": TB_DAL, "season": 2026, "season_type": 2, "week": 5, "game_id": "2026_05_TB_DAL",
        "kickoff": "2026-10-09T00:15:00Z", "time_valid": True, "neutral": False,
        "status": "post", "detail": "Final", "completed": True, "clock": None, "period": None,
        "away": {"abbr": "TB", "nflverse": "TB", "name": "Tampa Bay Buccaneers", "short": "Buccaneers", "score": 24},
        "home": {"abbr": "DAL", "nflverse": "DAL", "name": "Dallas Cowboys", "short": "Cowboys", "score": 16},
    }
    london = next(g for g in week if g["event_id"] == PHI_JAX)
    assert (london["status"], london["completed"], london["neutral"]) == ("pre", False, True)
    assert (london["away"]["score"], london["home"]["score"]) == (None, None), "no score before kickoff"
    assert london["detail"] == "10/11 - 9:30 AM EDT"


def test_espn_abbreviations_map_to_nflverse_ones_and_every_game_id_matches_nflverse():
    schedule = json.loads((ESPN_FIX / "nflverse_schedules_2026.json").read_text())["rows"]
    by_espn = {r["espn"]: r for r in schedule}
    checked = 0
    for stype, week in ((2, 4), (2, 5), (2, 6), (2, 18)):
        for g in games.parse_week(board(stype, week), 2026, stype, week):
            row = by_espn[g["event_id"]]
            assert g["game_id"] == row["game_id"]
            assert (g["away"]["nflverse"], g["home"]["nflverse"]) == (row["away_team"], row["home_team"])
            checked += 1
    assert checked == 61
    assert games.nflverse_abbr("LAR") == "LA" and games.nflverse_abbr("WSH") == "WAS"
    assert games.nflverse_abbr("DAL") == "DAL"


def test_a_game_in_progress_carries_its_clock_quarter_and_score():
    live = games.parse_week(in_progress(board(2, 5), PHI_JAX), 2026, 2, 5)
    g = next(x for x in live if x["event_id"] == PHI_JAX)
    assert (g["status"], g["detail"], g["clock"], g["period"], g["completed"]) == ("in", "12:34 - 2nd", "12:34", 2,
                                                                                   False)
    assert (g["away"]["score"], g["home"]["score"]) == (3, 7)
    half = games.parse_week(in_progress(board(2, 5), PHI_JAX, name="STATUS_HALFTIME", short="Halftime"), 2026, 2, 5)
    g = next(x for x in half if x["event_id"] == PHI_JAX)
    assert (g["status"], g["detail"], g["clock"]) == ("in", "Halftime", None), "no running clock at halftime"


def test_postseason_games_without_teams_yet_are_left_out_and_tbd_kickoffs_say_so():
    assert games.parse_week(board(3, 1), 2026, 3, 1) == [], "TBD at TBD is not a game to pick"
    week18 = games.parse_week(board(2, 18), 2026, 2, 18)
    assert len(week18) == 16 and all(g["time_valid"] is False for g in week18)


def test_an_answer_for_another_week_or_season_is_refused():
    # ESPN answers an unknown week with the current one: cached under the wrong week it would list week 5 twice
    with pytest.raises(games.BadAnswer):
        games.parse_week(board(2, 5), 2026, 2, 7)
    with pytest.raises(games.BadAnswer):
        games.parse_week(board(2, 5), 2025, 2, 5)
    for junk in (None, [], "x", {"season": {"year": 2026, "type": 2}, "week": {"number": 5}, "events": "x"}):
        with pytest.raises(games.BadAnswer):
            games.parse_week(junk, 2026, 2, 5)


def test_hostile_or_broken_events_are_skipped_or_capped():
    raw = copy.deepcopy(board(2, 5))
    events = raw["events"]
    first = events[0]["competitions"][0]["competitors"]
    first[0]["team"]["displayName"] = "<b>" + "x" * 500
    events[1]["competitions"][0]["competitors"][0]["team"]["abbreviation"] = "<script>"
    events[2]["id"] = "40187 2990"
    events[3]["competitions"] = []
    events[4]["competitions"][0]["competitors"][0]["score"] = "99999999"
    events[5]["competitions"][0]["status"]["type"]["shortDetail"] = "y" * 300
    raw["events"] = events + [None, "x", copy.deepcopy(events[6])]           # junk, and a duplicate of a game
    week = {g["event_id"]: g for g in games.parse_week(raw, 2026, 2, 5)}
    assert len(week) == 12, "the bad team, the bad id, the empty game and the duplicate are out"
    assert len(week[events[0]["id"]][first[0]["homeAway"]]["name"]) == games.NAME_MAX
    huge = events[4]["competitions"][0]["competitors"][0]["homeAway"]
    assert week[events[4]["id"]][huge]["score"] is None, "a score past 999 isn't one"
    assert len(week[events[5]["id"]]["detail"]) == games.DETAIL_MAX


def test_trimming_keeps_what_the_parser_reads():
    for stype, week in ((2, 4), (2, 5), (3, 1)):
        raw = board(stype, week)
        trimmed = games.trim_scoreboard(raw)
        assert games.parse_week(trimmed, 2026, stype, week) == games.parse_week(raw, 2026, stype, week)
        assert games.trim_scoreboard(trimmed) == trimmed
        assert games.parse_calendar(trimmed) == games.parse_calendar(raw)


# ---------------------------------------------------------------- the calendar and the current week
def test_the_calendar_lists_the_regular_season_and_the_postseason():
    cal = games.parse_calendar(board(2, 5))
    assert [w["key"] for w in cal] == [f"2-{n}" for n in range(1, 19)] + [f"3-{n}" for n in range(1, 5)]
    assert cal[4] == {"key": "2-5", "season_type": 2, "week": 5, "label": "Week 5", "detail": "Oct 7-13",
                      "start": "2026-10-07T07:00:00Z", "end": "2026-10-14T06:59:00Z"}
    assert [w["label"] for w in cal[18:]] == ["Wild Card", "Divisional Round", "Conference Championship", "Super Bowl"]
    assert games.parse_calendar({"leagues": "x"}) == []


@pytest.mark.parametrize("when, key", [
    ("2026-10-10T18:00:00Z", "2-5"),
    ("2026-10-14T06:58:00Z", "2-5"),        # Monday night still belongs to week 5
    ("2026-10-14T07:00:00Z", "2-6"),
    ("2026-07-01T00:00:00Z", "2-1"),        # before the season: week 1
    ("2027-01-21T00:00:00Z", "3-2"),
    ("2027-03-01T00:00:00Z", "3-4"),        # after the Super Bowl: the last week
])
def test_the_current_week_follows_espns_calendar(when, key):
    t = datetime.fromisoformat(when.replace("Z", "+00:00")).timestamp()
    assert games.current_week(games.parse_calendar(board(2, 5)), t) == key


# ---------------------------------------------------------------- the week cache
def test_a_finished_week_is_fetched_once_and_kept_for_good(tmp_path):
    fetch, clock = FakeESPN(), Clock()
    g = make(tmp_path, fetch, clock)
    assert len(g.week(2, 4)["games"]) == 16
    clock.t += 60 * 86400
    assert len(g.week(2, 4)["games"]) == 16
    assert fetch.count(2, 4) == 1
    assert (tmp_path / "espn" / "scoreboard_2026_2_04.json").is_file()
    again = FakeESPN()                       # a restart: the file on disk, no network
    assert make(tmp_path, again, Clock(NOW + 90 * 86400)).week(2, 4)["stale"] is False
    assert again.urls == []


def test_a_week_with_upcoming_games_refreshes_after_its_ttl(tmp_path):
    fetch, clock = FakeESPN(), Clock()
    g = make(tmp_path, fetch, clock)
    g.week(2, 6)
    clock.t += games.UPCOMING_TTL_S - 1
    g.week(2, 6)
    assert fetch.count(2, 6) == 1
    clock.t += 2
    g.week(2, 6)
    assert fetch.count(2, 6) == 2


def test_a_week_with_a_game_on_refreshes_after_the_short_ttl(tmp_path):
    fetch, clock = FakeESPN(answers={(2, 5): in_progress(board(2, 5), PHI_JAX)}), Clock()
    g = make(tmp_path, fetch, clock)
    g.week(2, 5)
    clock.t += games.LIVE_TTL_S + 1
    g.week(2, 5)
    assert fetch.count(2, 5) == 2


def test_the_ttl_of_a_week():
    final = games.parse_week(board(2, 4), 2026, 2, 4)
    upcoming = games.parse_week(board(2, 5), 2026, 2, 5)
    assert games.week_ttl(final, NOW) is None, "a finished week is cached for good"
    assert games.week_ttl(upcoming, NOW) == games.UPCOMING_TTL_S
    kickoff = datetime(2026, 10, 11, 13, 30, tzinfo=timezone.utc).timestamp()      # Eagles v Jaguars
    assert games.week_ttl(upcoming, kickoff - games.SOON_S + 60) == games.LIVE_TTL_S, "about to kick off"
    assert games.week_ttl(games.parse_week(in_progress(board(2, 5), PHI_JAX), 2026, 2, 5), NOW) == games.LIVE_TTL_S
    assert games.week_ttl([], NOW) == games.UPCOMING_TTL_S, "a week with no games yet is looked at again"


def test_a_failed_refresh_keeps_the_last_copy_marked_stale(tmp_path):
    fetch, clock = FakeESPN(), Clock()
    g = make(tmp_path, fetch, clock)
    g.week(2, 6)
    fetch.fail.add((2, 6))
    clock.t += games.UPCOMING_TTL_S + 1
    week = g.week(2, 6)
    assert len(week["games"]) == 14 and week["stale"] is True and week["error"] is None


def test_a_week_espn_never_answered_says_so(tmp_path):
    week = make(tmp_path, FakeESPN(fail={(2, 7)})).week(2, 7)
    assert week["games"] == [] and week["error"] == "Couldn't get Week 7 from ESPN."
    assert not (tmp_path / "espn" / "scoreboard_2026_2_07.json").exists()


def test_an_answer_for_another_week_is_never_cached(tmp_path):
    fetch = FakeESPN(answers={(2, 7): board(2, 5)})
    week = make(tmp_path, fetch).week(2, 7)
    assert week["games"] == [] and week["error"]
    assert not (tmp_path / "espn" / "scoreboard_2026_2_07.json").exists()


def test_a_cache_file_that_is_broken_is_fetched_again(tmp_path):
    (tmp_path / "espn").mkdir()
    (tmp_path / "espn" / "scoreboard_2026_2_04.json").write_text("{not json")
    fetch = FakeESPN()
    assert len(make(tmp_path, fetch).week(2, 4)["games"]) == 16 and fetch.count(2, 4) == 1


def test_week_numbers_outside_the_calendar_are_refused(tmp_path):
    g = make(tmp_path)
    for stype, week in ((1, 1), (2, 0), (2, 40), (4, 1), (True, 1), ("2", 1), (2.0, 5), (2, 5.0), (2, None)):
        with pytest.raises(ValueError):
            g.week(stype, week)


# ---------------------------------------------------------------- the season
def test_the_season_lists_the_current_week_first_then_the_calendar(tmp_path):
    fetch = FakeESPN()
    season = make(tmp_path, fetch).season()
    keys = [w["key"] for w in season["weeks"]]
    assert season["season"] == 2026 and season["current"] == "2-5" and season["offline"] is False
    assert keys == ["2-5"] + [f"2-{n}" for n in range(1, 19) if n != 5], "no postseason week has teams yet"
    first = season["weeks"][0]
    assert (first["label"], first["detail"], first["current"], len(first["games"])) == ("Week 5", "Oct 7-13", True, 15)
    assert not any("seasontype=3" in u for u in fetch.urls), "the postseason isn't looked up months early"
    assert all(fetch.count(2, n) == 1 for n in range(1, 19))


def test_the_season_lists_a_postseason_week_once_it_has_teams(tmp_path):
    wild_card = copy.deepcopy(board(3, 1))
    wild_card["events"] = wild_card["events"][:1] + [
        {**copy.deepcopy(board(2, 5)["events"][0]), "id": "401872910", "week": {"number": 1},
         "season": {"year": 2026, "type": 3, "slug": "post-season"}}]
    fetch = FakeESPN(answers={(3, 1): wild_card})
    january = datetime(2027, 1, 14, 12, tzinfo=timezone.utc).timestamp()
    season = make(tmp_path, fetch, Clock(january)).season()
    keys = [w["key"] for w in season["weeks"]]
    assert keys[0] == "3-1" and "3-2" not in keys
    wc = season["weeks"][0]
    assert wc["label"] == "Wild Card" and [g["game_id"] for g in wc["games"]] == ["2026_19_TB_DAL"]


def test_offline_reads_the_cache_then_the_saved_fixtures_and_never_the_network(tmp_path):
    fetch = FakeESPN()
    season = make(tmp_path, fetch, offline=True, fixtures_dir=ESPN_FIX).season()
    assert fetch.urls == []
    assert season["offline"] is True and season["current"] == "2-5"
    assert [w["key"] for w in season["weeks"]] == ["2-5", "2-4", "2-6", "2-18"], "only the saved weeks"


def test_the_season_needs_espns_calendar(tmp_path):
    with pytest.raises(games.GamesError) as err:
        make(tmp_path, FakeESPN(fail={(2, 1)})).season()
    assert err.value.status == 503 and "ESPN" in str(err.value)


def test_games_in_the_listing_name_each_teams_play_caller(tmp_path):
    (tmp_path / "play_callers.csv").write_text("season,team,first_week,last_week,play_caller,role,source\n"
                                               "2026,DAL,1,22,Brian Schottenheimer,HC,https://example.org/a\n")
    g = make(tmp_path, has_model=lambda name: name == "Brian Schottenheimer")
    tb_dal = next(x for x in g.season()["weeks"][0]["games"] if x["event_id"] == TB_DAL)
    assert tb_dal["home"]["caller"] == {"name": "Brian Schottenheimer", "role": "HC", "model": True}
    assert tb_dal["away"]["caller"] is None


# ---------------------------------------------------------------- a pasted game reference
@pytest.mark.parametrize("text", [
    "401872980", "  401872980\n",
    "https://www.espn.com/nfl/game/_/gameId/401872980/buccaneers-cowboys",
    "https://www.espn.com/nfl/game/_/gameId/401872980",
    "www.espn.com/nfl/game/_/gameId/401872980",
    "espn.com/nfl/boxscore/_/gameId/401872980",
    "http://www.espn.com/nfl/playbyplay/_/gameId/401872980",
    "https://www.espn.com/nfl/game?gameId=401872980",
    "https://m.espn.com/nfl/game?gameId=401872980&src=app",
    "https://www.espn.com/nfl/game/_/gameid/401872980",
    "HTTPS://WWW.ESPN.COM/nfl/game/_/gameId/401872980#plays",
])
def test_a_game_id_or_espn_address_gives_the_id(text):
    assert games.parse_game_ref(text) == "401872980"


@pytest.mark.parametrize("text, why", [
    ("", "Paste an ESPN game id"),
    ("   ", "Paste an ESPN game id"),
    (None, "Paste an ESPN game id"),
    (401872980, "Paste an ESPN game id"),
    ("x" * 600, "too long"),
    ("4018729801234567", "isn't an ESPN game id"),
    ("401872980; rm -rf /", "isn't an ESPN game id"),
    ("401872980\nHost: evil.example", "isn't an ESPN game id"),
    ("401872980 401872981", "isn't an ESPN game id"),
    ("４０１８７２９８０", "isn't an ESPN game id"),
    ("https://evil.example/nfl/game/_/gameId/401872980", "espn.com"),
    ("https://espn.com.evil.example/nfl/game/_/gameId/401872980", "espn.com"),
    ("https://www.espn.com@evil.example/nfl/game/_/gameId/401872980", "espn.com"),
    ("https://evil.example/?next=https://www.espn.com/nfl/game/_/gameId/401872980", "espn.com"),
    ("https://notespn.com/nfl/game/_/gameId/401872980", "espn.com"),
    ("https://www.espn.com:8443/nfl/game/_/gameId/401872980", "espn.com"),
    ("javascript:alert(1)//espn.com/nfl/game/_/gameId/401872980", "espn.com"),
    ("file:///etc/passwd", "espn.com"),
    ("ftp://www.espn.com/nfl/game/_/gameId/401872980", "espn.com"),
    ("https://www.espn.com/college-football/game/_/gameId/401752740", "NFL"),
    ("https://www.espn.com/nfl/team/_/name/dal/dallas-cowboys", "no game id"),
    ("https://www.espn.com/nfl/game/_/gameId/401872980%2F..%2F", "no game id"),
    ("https://www.espn.com/nfl/game?gameId=401872980&gameId=401872981", "two games"),
    ("https://www.espn.com/nfl/game/_/gameId/401872980?gameId=401872981", "two games"),
])
def test_anything_else_is_refused_with_the_reason(text, why):
    with pytest.raises(ValueError) as err:
        games.parse_game_ref(text)
    assert why in str(err.value)
    assert len(str(err.value)) <= games.ERROR_MAX


def test_refusals_say_how_to_find_a_game_id():
    with pytest.raises(ValueError) as err:
        games.parse_game_ref("dallas")
    assert games.FIND_ID_HELP in str(err.value)
    assert games.FIND_ID_HELP == "Open the game on espn.com. The number after gameId/ in the address is the game id."


# ---------------------------------------------------------------- finding one game
def test_a_game_is_found_by_its_id_with_a_fresh_status(tmp_path):
    clock = Clock()
    fetch = FakeESPN()
    g = make(tmp_path, fetch, clock)
    assert g.game(TB_DAL)["game_id"] == "2026_05_TB_DAL"
    fetch.answers[(2, 5)] = in_progress(board(2, 5), PHI_JAX)
    clock.t += games.UPCOMING_TTL_S + 1
    assert g.game(PHI_JAX)["status"] == "in"


def test_a_game_outside_the_2026_listing_is_a_404_with_the_reason(tmp_path):
    def summary(event_id):
        if event_id == "401547000":
            return {"header": {"id": event_id, "season": {"year": 2023, "type": 2}, "week": 3,
                               "league": {"slug": "nfl"}}}
        if event_id == "401872900":
            return {"header": {"id": event_id, "season": {"year": 2026, "type": 1}, "week": 2,
                               "league": {"slug": "nfl"}}}
        raise urllib.error.HTTPError("https://site.api.espn.com/x", 404, "Not Found", {}, None)

    g = make(tmp_path, fetch_summary=summary)
    for event_id, why in (("401547000", "2023 season"), ("401872900", "preseason"), ("123", "no game with id 123")):
        with pytest.raises(games.GamesError) as err:
            g.game(event_id)
        assert err.value.status == 404 and why in str(err.value), str(err.value)
    with pytest.raises(ValueError):
        g.game("12a")


def test_the_payload_the_picker_is_tested_on_is_what_the_server_sends(tmp_path):
    """tests/js/picker/games-payload.json is GET /api/games, offline, on the saved weeks (the picker's node tests read
    it), so the two sides of the contract can't drift apart. Rewrite it from this test's payload after a change."""
    (tmp_path / "play_callers.csv").write_text("season,team,first_week,last_week,play_caller,role,source\n"
                                               "2026,DAL,1,22,Brian Schottenheimer,HC,https://example.org/a\n")
    fetch = FakeESPN()
    g = make(tmp_path, fetch, offline=True, fixtures_dir=ESPN_FIX, has_model=lambda n: n == "Brian Schottenheimer")
    saved = json.loads((FIXTURES.parent / "js" / "picker" / "games-payload.json").read_text())
    assert g.season() == saved and fetch.urls == []

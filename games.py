"""The season's games for the game picker (docs/design/game-picker.md; restructure-v2.md 7, phase 2): ESPN's public
scoreboard, week by week, parsed into games; a pasted game id or espn.com address; and, for a picked game, what the
engine needs: game_config (config.GAME from either side, the betting line from nflverse, else ESPN's odds, flagged
plainly when neither has one) and callers_for (each team's play-caller that week, from the play-caller table).

Nothing the user types ever reaches a URL: a pasted reference gives ASCII digits or a ValueError, and only those ids,
and the season, season type and week numbers of ESPN's own calendar, go into espn_feed's fixed endpoints, fetched
through espn_feed.fetch_json (no redirects, a size cap, a deadline).

The cache: DATA_DIR/espn/scoreboard_<season>_<type>_<week>.json, trimmed to what the parser reads. A finished week is
kept for good; a week with a game on, or one kicking off within SOON_S, refreshes after LIVE_TTL_S; any other week
after UPCOMING_TTL_S. A refresh that fails keeps the last copy (stale). nflverse's schedule lines are kept in
DATA_DIR/nflverse/schedules_<season>.json for NFLVERSE_TTL_S. Offline (SHADOW_ESPN_OFFLINE=1): the cached files, then
the saved ones in tests/fixtures/espn, never the network.
"""
import csv
import http.client
import json
import logging
import re
import threading
import time
import urllib.error
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit
from zoneinfo import ZoneInfo

import espn_feed
import logos
from config import CALLER_NAME, DATA_DIR, ESPN_OFFLINE, LEAGUE_SEASONS, ROOT

log = logging.getLogger(__name__)

SEASON = LEAGUE_SEASONS[-1]                # the season being played: the picker lists no other
REGULAR, POSTSEASON = 2, 3                 # ESPN's season types the picker lists (1 is the preseason, 4 the off season)
SEASON_TYPES = (REGULAR, POSTSEASON)
LEAGUE = "nfl"                             # the sport segment of an espn.com game address
STATES = ("pre", "in", "post")
WEEK_MAX = 25
FIXTURES_DIR = ROOT / "tests" / "fixtures" / "espn"
SCHEDULE_ZONE = ZoneInfo("America/New_York")    # the league's schedule clock: the date in a game's label
CALLER_TABLES = ("play_callers_2024_2026.csv", "play_callers.csv")   # the first that exists is read

LIVE_TTL_S = 30                            # a week with a game on, or one kicking off within SOON_S
UPCOMING_TTL_S = 15 * 60                   # any other week that isn't over
SOON_S = 60 * 60
POST_LOOKAHEAD_S = 14 * 86400              # a postseason week is looked up from two weeks before it starts
NFLVERSE_TTL_S = 60 * 60
FETCH_WORKERS = 6
REFRESH_BUDGET_S = 15                      # the listing waits this long for ESPN, then answers with what it has

REF_MAX, ERROR_MAX = 500, 300
NAME_MAX, SHORT_MAX, DETAIL_MAX, LABEL_MAX, CLOCK_MAX = 40, 24, 40, 40, 8
CALLER_MAX, ROLE_MAX, SOURCE_MAX, CALLER_ROWS_MAX = 60, 24, 300, 5000
SCORE_MAX, MAX_GAMES, MAX_WEEKS, PICKS_MAX = 999, 20, 30, 10
CACHE_MAX_BYTES = 2 * 1024 * 1024
SPREAD_MAX, TOTAL_MIN, TOTAL_MAX = 40.0, 20.0, 90.0

ABBR_RE = re.compile(r"[A-Z]{2,4}")
NUM_RE = re.compile(r"[0-9]{1,6}")
EVENT_RE = espn_feed.EVENT_RE
TIME_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2})?Z")
GAME_ID_RE = re.compile(r"[0-9]{4}_[0-9]{2}_[A-Z]{2,3}_[A-Z]{2,3}")
PATH_ID_RE = re.compile(r"(?:^|/)gameid/([0-9]{1,12})(?=/|$)", re.I)
FAVORITE_RE = re.compile(r"([A-Z]{2,4}) -([0-9]{1,2}(?:\.[05])?)")
EVEN_WORDS = ("EVEN", "PK", "PICK")
ESPN_TO_NFLVERSE = {"WSH": "WAS", "LAR": "LA"}    # every other team is spelled the same (nflverse 2026 schedule)
PLACEHOLDER = "TBD"                        # ESPN's postseason games before the seeds are set: TBD at TBD
SCHEDULE_COLS = ("game_id", "game_type", "week", "espn", "away_team", "home_team", "spread_line", "total_line")
# What the cache keeps of a scoreboard answer (trim_scoreboard): None keeps a value whole, a tuple those keys of a
# dict, a dict its keys cut by their own specs, and a one-item list each item of a list.
TEAM_KEYS = ("id", "abbreviation", "displayName", "shortDisplayName", "name", "location", "isActive")
STATUS_KEYS = {"clock": None, "displayClock": None, "period": None,
               "type": ("name", "state", "completed", "detail", "shortDetail")}
EVENT_KEYS = {"id": None, "date": None, "name": None, "shortName": None, "season": None, "week": None,
              "competitions": [{"id": None, "date": None, "timeValid": None, "neutralSite": None,
                                "competitors": [{"homeAway": None, "score": None, "team": TEAM_KEYS}],
                                "status": STATUS_KEYS}]}
CALENDAR_KEYS = [{"label": None, "value": None, "startDate": None, "endDate": None,
                  "entries": [("label", "alternateLabel", "detail", "value", "startDate", "endDate")]}]
SCOREBOARD_KEYS = {"season": ("type", "year"), "week": ("number",), "leagues": [{"calendar": CALENDAR_KEYS}],
                   "events": [EVENT_KEYS]}

FIND_ID_HELP = "Open the game on espn.com. The number after gameId/ in the address is the game id."
NOT_ESPN = f"That isn't an espn.com game address. {FIND_ID_HELP}"


class GamesError(Exception):
    """A request the picker can't answer; status is the HTTP code (404 no such game in the season, 503 ESPN can't be
    reached)."""

    def __init__(self, message, status=503):
        super().__init__(str(message)[:ERROR_MAX])
        self.status = status


class BadAnswer(ValueError):
    """ESPN's answer isn't a scoreboard for the season, season type and week asked for."""


# ---------------------------------------------------------------- small readers of ESPN's JSON
def _dict(value):
    return value if isinstance(value, dict) else {}


def _list(value):
    return value if isinstance(value, list) else []


def _text(value, cap):
    """ESPN text, trimmed and capped; None for anything that isn't a non-empty string."""
    return (value.strip()[:cap] or None) if isinstance(value, str) else None


def _whole(value, lo, hi):
    """A whole number from lo to hi, from a JSON number or ASCII digits ('24'); None otherwise (never a bool)."""
    if isinstance(value, str) and NUM_RE.fullmatch(value.strip()):
        value = int(value.strip())
    return espn_feed.whole_in(value, lo, hi)


def _number(value):
    """A finite float from a JSON number (never a bool or text); None otherwise."""
    value = espn_feed.finite(value)
    return None if value is None else float(value)


def _utc(value):
    """ESPN's '2026-10-09T00:15Z' (seconds optional) as an aware UTC datetime; None for anything else."""
    if not isinstance(value, str) or not TIME_RE.fullmatch(value):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def _iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _keep(value, spec):
    """`value` cut down to `spec` (SCOREBOARD_KEYS); a value of the wrong shape becomes an empty one."""
    if spec is None:
        return value
    if isinstance(spec, list):
        return [_keep(v, spec[0]) for v in _list(value)]
    value = _dict(value)
    if isinstance(spec, tuple):
        return {k: value[k] for k in spec if k in value}
    return {k: _keep(value[k], s) for k, s in spec.items() if k in value}


def nflverse_abbr(abbr):
    """ESPN's abbreviation as nflverse writes it ('LAR' -> 'LA', 'WSH' -> 'WAS')."""
    return ESPN_TO_NFLVERSE.get(abbr, abbr)


def nflverse_week(season_type, week, *, regular_weeks):
    """nflverse's week number: the postseason counts on from the regular season (the Wild Card is 19 after 18 weeks).
    None when the regular season's length isn't known."""
    if season_type == REGULAR:
        return week
    return regular_weeks + week if regular_weeks else None


def week_key(season_type, week):
    return f"{season_type}-{week}"


# ---------------------------------------------------------------- one week of ESPN's scoreboard
def trim_scoreboard(raw):
    """What the parser reads of ESPN's scoreboard answer (the season, the week, the calendar and the events): the copy
    the cache keeps, about a tenth of the answer."""
    return _keep(raw, SCOREBOARD_KEYS)


def parse_week(scoreboard, season, season_type, week):
    """One week's games from ESPN's scoreboard answer, in ESPN's order (by kickoff). BadAnswer when it isn't a
    scoreboard for that season, season type and week (ESPN answers a week it doesn't know with the current one).
    Placeholder games (TBD at TBD) and malformed events are left out; a game listed twice counts once."""
    if not isinstance(scoreboard, dict) or not isinstance(scoreboard.get("events"), list):
        raise BadAnswer("ESPN's answer isn't a scoreboard.")
    said = (_dict(scoreboard.get("season")).get("year"), _dict(scoreboard.get("season")).get("type"),
            _dict(scoreboard.get("week")).get("number"))
    if said != (season, season_type, week) or any(isinstance(x, bool) for x in said):
        raise BadAnswer(f"ESPN answered with another week ({str(said)[:40]}), not {season} {season_type}-{week}.")
    regular = sum(1 for w in parse_calendar(scoreboard) if w["season_type"] == REGULAR) or None
    out, seen = [], set()
    for ev in scoreboard["events"]:
        game = _event(_dict(ev), (season, season_type, week), regular)
        if game and game["event_id"] not in seen:
            seen.add(game["event_id"])
            out.append(game)
    return out[:MAX_GAMES]


def _event(ev, when, regular_weeks):
    """One game, or None for a placeholder or a malformed event. when: (season, season type, week)."""
    eid, comp = ev.get("id"), _dict((_list(ev.get("competitions")) or [None])[0])
    if not (isinstance(eid, str) and EVENT_RE.fullmatch(eid)) or not _same_week(ev, when):
        return None
    sides = {c.get("homeAway"): c for c in _list(comp.get("competitors")) if isinstance(c, dict)}
    away, home = _team(sides.get("away")), _team(sides.get("home"))
    status = _status(_dict(comp.get("status")) or _dict(ev.get("status")))
    if not (away and home and status["status"]) or away["abbr"] == home["abbr"]:
        return None
    if status["status"] != "pre":                     # no score before kickoff: ESPN lists 0 to 0
        away = {**away, "score": _whole(sides["away"].get("score"), 0, SCORE_MAX)}
        home = {**home, "score": _whole(sides["home"].get("score"), 0, SCORE_MAX)}
    kick = _utc(comp.get("date")) or _utc(ev.get("date"))
    season, season_type, week = when
    nfl_week = nflverse_week(season_type, week, regular_weeks=regular_weeks)
    return {"event_id": eid, "season": season, "season_type": season_type, "week": week,
            "game_id": f"{season}_{nfl_week:02d}_{away['nflverse']}_{home['nflverse']}" if nfl_week else None,
            "kickoff": _iso(kick) if kick else None, "time_valid": bool(kick) and comp.get("timeValid") is not False,
            "neutral": comp.get("neutralSite") is True, **status, "away": away, "home": home}


def _same_week(ev, when):
    """False when the event names another season, season type or week than the answer it came in."""
    s, w = _dict(ev.get("season")), _dict(ev.get("week"))
    return all(got is None or got == want for got, want in zip((s.get("year"), s.get("type"), w.get("number")), when))


def _team(competitor):
    """One side of a game from ESPN's competitor; None for a placeholder (TBD, ids -1 and -2) or a malformed team."""
    team = _dict(_dict(competitor).get("team"))
    abbr, tid = team.get("abbreviation"), team.get("id")
    tid = str(tid) if isinstance(tid, int) and not isinstance(tid, bool) else tid
    if not (isinstance(abbr, str) and ABBR_RE.fullmatch(abbr)) or abbr == PLACEHOLDER:
        return None
    if not (isinstance(tid, str) and EVENT_RE.fullmatch(tid)):
        return None
    return {"abbr": abbr, "nflverse": nflverse_abbr(abbr), "name": _text(team.get("displayName"), NAME_MAX) or abbr,
            "short": _text(team.get("shortDisplayName"), SHORT_MAX) or _text(team.get("name"), SHORT_MAX) or abbr,
            "score": None}


def _status(st):
    """pre, in or post (None when ESPN doesn't say), ESPN's short detail ('Final', '12:34 - 2nd', 'Halftime'), whether
    it is over, and the clock and quarter while the clock runs in a quarter (None at halftime or between quarters)."""
    kind = _dict(st.get("type"))
    state = kind.get("state") if kind.get("state") in STATES else None
    running = state == "in" and kind.get("name") == "STATUS_IN_PROGRESS"
    detail = _text(kind.get("shortDetail"), DETAIL_MAX) or _text(kind.get("detail"), DETAIL_MAX)
    return {"status": state, "detail": detail, "completed": kind.get("completed") is True,
            "clock": _text(st.get("displayClock"), CLOCK_MAX) if running else None,
            "period": _whole(st.get("period"), 1, 9) if running else None}


# ---------------------------------------------------------------- the calendar
def parse_calendar(scoreboard):
    """The weeks ESPN's calendar lists for the regular season and the postseason, in order: key ('2-5'), season type,
    week, label ('Week 5', 'Wild Card'), detail ('Oct 7-13'), start and end (UTC). [] when the answer has none."""
    leagues = _list(_dict(scoreboard).get("leagues"))
    out = []
    for part in _list(_dict(leagues[0] if leagues else None).get("calendar")):
        stype = _whole(_dict(part).get("value"), 1, 9)
        for entry in _list(_dict(part).get("entries")) if stype in SEASON_TYPES else []:
            week = _calendar_week(stype, _dict(entry))
            if week and all(w["key"] != week["key"] for w in out):
                out.append(week)
    return out[:MAX_WEEKS]


def _calendar_week(season_type, entry):
    week = _whole(entry.get("value"), 1, WEEK_MAX)
    start, end = _utc(entry.get("startDate")), _utc(entry.get("endDate"))
    if not (week and start and end):
        return None
    return {"key": week_key(season_type, week), "season_type": season_type, "week": week,
            "label": _text(entry.get("label"), LABEL_MAX) or f"Week {week}",
            "detail": _text(entry.get("detail"), LABEL_MAX), "start": _iso(start), "end": _iso(end)}


def current_week(calendar, now):
    """The key of the week `now` falls in (a week's last minute included); before the season its first week, after it
    the last one, and between two weeks the one that just ended. None for an empty calendar."""
    spans = [(w["key"], _utc(w["start"]).timestamp(), _utc(w["end"]).timestamp() + 60) for w in calendar]
    if not spans:
        return None
    hit = next((key for key, start, end in spans if start <= now < end), None)
    if hit or now < spans[0][1]:
        return hit or spans[0][0]
    ended = [key for key, _, end in spans if end <= now]
    return ended[-1] if ended else spans[-1][0]


def week_ttl(games, now):
    """Seconds a cached week stays fresh: None (for good) once every game is final; LIVE_TTL_S while a game is on or
    one kicks off within SOON_S (or should have by now); UPCOMING_TTL_S otherwise, a week with no games yet included."""
    if games and all(g["status"] == "post" and g["completed"] for g in games):
        return None
    for g in games:
        kick = _utc(g["kickoff"]) if g["status"] == "pre" and g["time_valid"] else None
        if g["status"] == "in" or (kick and kick.timestamp() - now <= SOON_S):
            return LIVE_TTL_S
    return UPCOMING_TTL_S


# ---------------------------------------------------------------- a pasted game reference
def parse_game_ref(text):
    """The ESPN game id in a pasted reference: a bare id, or any espn.com NFL game address carrying gameId/<digits> or
    gameId=<digits>. ValueError with a plain reason (and how to find the id) for anything else. The address is only
    read here, never fetched."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"Paste an ESPN game id or the game's espn.com address. {FIND_ID_HELP}")
    ref = text.strip()
    if len(ref) > REF_MAX:
        raise ValueError(f"That's too long for a game id or an espn.com address. {FIND_ID_HELP}")
    if EVENT_RE.fullmatch(ref):
        return ref
    if not ref.isascii() or any(c.isspace() or not c.isprintable() for c in ref) or ("." not in ref and "/" not in ref):
        raise ValueError(f"That isn't an ESPN game id (digits, like 401872980) or an espn.com address. {FIND_ID_HELP}")
    return _id_from_address(ref)


def _id_from_address(ref):
    try:
        parts = urlsplit(ref if "://" in ref else f"https://{ref}")
        port = parts.port
    except ValueError:
        raise ValueError(NOT_ESPN) from None
    host = (parts.hostname or "").lower()
    if (parts.scheme.lower() not in ("http", "https") or not (host == "espn.com" or host.endswith(".espn.com"))
            or parts.username or parts.password or port):
        raise ValueError(NOT_ESPN)
    if LEAGUE not in [s.lower() for s in parts.path.split("/")]:
        raise ValueError(f"That espn.com address isn't an NFL game. {FIND_ID_HELP}")
    ids = set(PATH_ID_RE.findall(parts.path))
    ids |= {v for k, v in parse_qsl(parts.query) if k.lower() == "gameid" and EVENT_RE.fullmatch(v)}
    if len(ids) > 1:
        raise ValueError(f"That address names two games ({', '.join(sorted(ids))[:40]}). Paste one game's address.")
    if not ids:
        raise ValueError(f"That espn.com address has no game id in it. {FIND_ID_HELP}")
    return ids.pop()


# ---------------------------------------------------------------- the betting line, the play-caller table, the words
def espn_line(summary, home, away):
    """(the home team's margin as favorite, the total) from ESPN's pickcenter in a game summary: the first entry whose
    spread, favorite and total add up. None when none does: a line is never guessed."""
    lines = (_pick_line(_dict(pick), home, away) for pick in _list(_dict(summary).get("pickcenter"))[:PICKS_MAX])
    return next((line for line in lines if line), None)


def _pick_line(pick, home, away):
    total = _number(pick.get("overUnder"))
    if total is None or not TOTAL_MIN <= total <= TOTAL_MAX:
        return None
    spread = _number(pick.get("spread"))               # ESPN's spread is the home side's, negative when home is favored
    said = (None if spread is None else (-spread or 0.0), _favorite_margin(pick.get("details"), home, away))
    margins = {m for m in said if m is not None}
    if len(margins) != 1 or abs(next(iter(margins))) > SPREAD_MAX:
        return None
    return margins.pop(), total


def _favorite_margin(details, home, away):
    """'DAL -8.5' -> 8.5 when DAL is home, -8.5 when away; 'EVEN' -> 0.0; None for anything else."""
    text = details.strip().upper() if isinstance(details, str) else ""
    m = FAVORITE_RE.fullmatch(text)
    if text in EVEN_WORDS or not m:
        return 0.0 if text in EVEN_WORDS else None
    points = float(m.group(2))
    if espn_feed.same_team(m.group(1), home):
        return points
    return (-points or 0.0) if espn_feed.same_team(m.group(1), away) else None


def nflverse_line(row, game):
    """(the home team's margin as favorite, the total) from nflverse's schedule row: spread_line is the home side's
    (positive = home favored, as config.py's offense_spread is the offense's). None when the row is missing, names
    other teams, or lacks either number."""
    if not row or (row["away_team"], row["home_team"]) != (game["away"]["nflverse"], game["home"]["nflverse"]):
        return None
    spread, total = row["spread_line"], row["total_line"]
    if spread is None or total is None or abs(spread) > SPREAD_MAX or not TOTAL_MIN <= total <= TOTAL_MAX:
        return None
    return spread, total


def schedule_rows(rows):
    """{ESPN event id: slim row} from nflverse's schedule rows; a row without a usable id or teams is left out."""
    out = {}
    for row in map(_dict, _list(rows)):
        espn, gid, teams = row.get("espn"), row.get("game_id"), (row.get("away_team"), row.get("home_team"))
        if (isinstance(espn, str) and EVENT_RE.fullmatch(espn) and isinstance(gid, str) and GAME_ID_RE.fullmatch(gid)
                and all(isinstance(t, str) and ABBR_RE.fullmatch(t) for t in teams)):
            out[espn] = {"game_id": gid, "away_team": teams[0], "home_team": teams[1],
                         "spread_line": _number(row.get("spread_line")), "total_line": _number(row.get("total_line"))}
    return out


def read_callers(path):
    """The play-caller table's usable rows: season, team, first and last week (the whole season when the table has no
    week columns), play_caller, role and source. A row that doesn't parse is skipped (logged)."""
    try:
        with open(path, newline="", encoding="utf-8") as f:
            raw = [r for _, r in zip(range(CALLER_ROWS_MAX), csv.DictReader(f))]
    except (OSError, UnicodeDecodeError, csv.Error) as ex:
        log.warning("Couldn't read the play-caller table %s (%s); no play-callers listed.", Path(path).name, ex)
        return []
    rows = [_caller_row(r) for r in raw]
    if None in rows:
        log.warning("%s: skipped %d row(s) that don't parse.", Path(path).name, rows.count(None))
    return [r for r in rows if r]


def _caller_row(raw):
    blank = lambda key: raw.get(key) in (None, "")   # noqa: E731
    season = _whole(raw.get("season"), 1990, 2100)
    team = (raw.get("team") or "").strip()
    first = 1 if blank("first_week") else _whole(raw.get("first_week"), 1, WEEK_MAX)
    last = WEEK_MAX if blank("last_week") else _whole(raw.get("last_week"), 1, WEEK_MAX)
    name = (raw.get("play_caller") or "").strip()
    if not (season and ABBR_RE.fullmatch(team) and first and last and first <= last and 0 < len(name) <= CALLER_MAX):
        return None
    return {"season": season, "team": team, "first": first, "last": last, "name": name,
            "role": _text(raw.get("role"), ROLE_MAX), "source": _text(raw.get("source"), SOURCE_MAX)}


def matchup(game):
    """'Buccaneers at Cowboys', or 'Eagles vs Jaguars' at a neutral site."""
    return f"{game['away']['short']} {'vs' if game['neutral'] else 'at'} {game['home']['short']}"


def game_label(game, week_label):
    """'Buccaneers at Cowboys, Week 5, Thu Oct 8': the date on the league's schedule clock, and none while ESPN hasn't
    set the kickoff time."""
    kick = _utc(game["kickoff"]) if game["time_valid"] else None
    local = kick.astimezone(SCHEDULE_ZONE) if kick else None
    day = f"{local:%a} {local:%b} {local.day}" if local else None
    return ", ".join(p for p in (matchup(game), week_label, day) if p)


def _nflverse_schedule(season):
    """nflverse's schedule rows for one season (nflreadpy, imported only when a line is needed)."""
    import nflreadpy as nfl
    return nfl.load_schedules([season]).select(list(SCHEDULE_COLS)).to_dicts()


def _fetched_at(data):
    """When a saved copy was fetched (unix seconds); 0 for a copy that doesn't say (a saved fixture)."""
    at = _number(_dict(data).get("_fetched_at"))
    return at if at is not None else 0.0


def _listed(week, entry, stale, error):
    """A regular-season week is listed when ESPN answered, or failed (its error says so); a postseason week once it has
    games. Offline, a week is listed only when it is saved."""
    if entry is None:
        return week["season_type"] == REGULAR and error is not None
    return week["season_type"] == REGULAR or bool(entry["games"])


def _read_json(path):
    """A saved JSON object, or None (missing, too big or unreadable: logged)."""
    try:
        if not path.is_file() or path.stat().st_size > CACHE_MAX_BYTES:
            return None
        data = json.loads(path.read_text())
    except (OSError, ValueError) as ex:
        log.warning("Couldn't read %s (%s); it will be fetched again.", path.name, ex)
        return None
    return data if isinstance(data, dict) else None


def _write(path, data):
    """Through logos.write_cache (a temp file, then os.replace). A disk that refuses costs only the cache (logged)."""
    try:
        logos.write_cache(path, json.dumps(data).encode())
    except OSError as ex:
        log.warning("Couldn't save %s (%s); it isn't cached.", path.name, ex)


# ---------------------------------------------------------------- the service: the caches, the listing, a picked game
class Games:
    """The season for the picker, cached per week (module docstring), and game_config and callers_for for a picked
    game. Shared by Flask's request threads: the caches sit behind a lock, ESPN is asked outside it, and one listing
    refresh runs at a time. fetch_json, fetch_summary, load_schedule, clock and has_model are injectable (the tests;
    phase 3's model per caller)."""

    def __init__(self, data_dir, *, offline=False, fetch_json=None, fetch_summary=None, load_schedule=None,
                 clock=time.time, fixtures_dir=FIXTURES_DIR, has_model=None, season=SEASON):
        self.data_dir, self.offline, self.season_year = Path(data_dir), bool(offline), season
        self.fetch_json = fetch_json or espn_feed.fetch_json
        self.fetch_summary = fetch_summary or espn_feed.fetch_summary
        self.load_schedule = load_schedule or _nflverse_schedule
        self.clock, self.fixtures_dir = clock, Path(fixtures_dir) if fixtures_dir else None
        self.has_model = has_model or (lambda name: name == CALLER_NAME)
        self._lock, self._refresh = threading.Lock(), threading.Lock()
        self._weeks, self._calendar, self._lines, self._callers = {}, [], None, (None, [])

    # ------------------------------------------------ the listing
    def season(self):
        """GET /api/games: {season, current, offline, weeks}, the current week first, then the calendar's order. A
        postseason week is looked up from POST_LOOKAHEAD_S before it starts and listed once ESPN has teams for it.
        GamesError (503) when ESPN's calendar can't be had."""
        calendar, now = self.calendar(), self.clock()
        wanted = [w for w in calendar if self.offline or w["season_type"] == REGULAR
                  or _utc(w["start"]).timestamp() - POST_LOOKAHEAD_S <= now]
        loaded = self._load_weeks([(w["season_type"], w["week"]) for w in wanted], now)
        current, callers = current_week(calendar, now), self._caller_rows()
        got = [(w, loaded[(w["season_type"], w["week"])]) for w in wanted]
        weeks = [self._week_json(w, *hit, callers, w["key"] == current) for w, hit in got if _listed(w, *hit)]
        weeks.sort(key=lambda w: not w["current"])     # stable: the current week first, the rest in calendar order
        listed = any(w["current"] for w in weeks)
        return {"season": self.season_year, "current": current if listed else None, "offline": self.offline,
                "weeks": weeks}

    def week(self, season_type, week):
        """One week as GET /api/games lists it (never marked current). ValueError for a week no calendar can have."""
        if None in (espn_feed.whole_in(season_type, REGULAR, POSTSEASON), espn_feed.whole_in(week, 1, WEEK_MAX)):
            raise ValueError(f"No such week: {str(season_type)[:4]}-{str(week)[:4]}.")
        key = (season_type, week)
        return self._week_json(self._calendar_week(key), *self._load_week(key, self.clock()), self._caller_rows())

    def calendar(self):
        """The season's weeks (parse_calendar): memory, a saved week's copy, else ESPN's week 1 (kept for good once it
        is final). GamesError (503) when none has it."""
        for path in [] if self._calendar else self._saved_weeks():
            if self._remember_calendar(_read_json(path)):
                break
        if not self._calendar and not self.offline:
            self._load_week((REGULAR, 1), self.clock())
        if not self._calendar:
            raise GamesError(f"Couldn't reach ESPN for the {self.season_year} schedule. Try again in a minute.", 503)
        return self._calendar

    def game(self, event_id):
        """One game of the listing, with each team's play-caller, as fresh as the listing. ValueError for an id that
        isn't one; GamesError 404 with the reason when the listing hasn't got it, 503 when ESPN can't be reached."""
        eid = espn_feed.check_event(event_id)
        hit = next((g for w in self.season()["weeks"] for g in w["games"] if g["event_id"] == eid), None)
        if hit is None:
            raise GamesError(self._not_listed(eid), 404)
        return hit

    # ------------------------------------------------ a picked game
    def game_config(self, event_id, offense):
        """config.GAME for this game from `offense`'s side (ESPN's abbreviation; nflverse's spelling works too): the
        nflverse game id, a label, both teams as ESPN writes them (the feed matches on those), home or away, the line
        from that side (nflverse, else ESPN's odds) and where it came from. Neither has a line: offense_spread and
        total_line are None and line_note says so, never a guess (the engine needs both). ValueError for a team that
        isn't in the game."""
        game = self.game(event_id)
        side = self._side(game, offense)
        row = self._schedule().get(game["event_id"])
        line, source = nflverse_line(row, game), "nflverse"
        if line is None:
            line, source = self._espn_line(game), "espn"
        margin, total = line or (None, None)
        same = row and (row["away_team"], row["home_team"]) == (game["away"]["nflverse"], game["home"]["nflverse"])
        note = (f"No betting line for {matchup(game)} yet: neither nflverse nor ESPN has one, and the model needs the "
                "spread and the total.")
        return {"game_id": row["game_id"] if same else game["game_id"],
                "label": game_label(game, self._label((game["season_type"], game["week"]))),
                "offense": game[side]["abbr"], "opponent": game["home" if side == "away" else "away"]["abbr"],
                "offense_is_home": side == "home",
                "offense_spread": None if margin is None else (margin if side == "home" else (-margin or 0.0)),
                "total_line": total, "espn_event": game["event_id"], "line_source": source if line else None,
                "line_note": None if line else note}

    def callers_for(self, event_id):
        """{ESPN abbreviation: {name, role, source, model} or None} for the game's two teams that week, from the
        play-caller table (the first of CALLER_TABLES that exists). model: whether there is a model of him."""
        game, rows = self.game(event_id), self._caller_rows()
        return {game[side]["abbr"]: self._caller(rows, game, side, full=True) for side in ("away", "home")}

    # ------------------------------------------------ weeks: memory, disk, ESPN
    def _load_weeks(self, keys, now):
        """{key: (entry, stale, error)}: fresh weeks from the cache, the rest from ESPN in parallel (FETCH_WORKERS at a
        time, REFRESH_BUDGET_S in all). A week still on its way then answers stale, or with an error, and lands in the
        cache when it arrives. One refresh at a time: a second request waits, then finds the cache fresh."""
        out = {key: self._from_cache(key, now) for key in keys}
        todo = [key for key, hit in out.items() if hit is None]
        if not todo:
            return out
        with self._refresh:
            pool = ThreadPoolExecutor(max_workers=min(FETCH_WORKERS, len(todo)), thread_name_prefix="espn-week")
            futures = {pool.submit(self._load_week, key, now): key for key in todo}
            done, _ = wait(futures, timeout=REFRESH_BUDGET_S)
            pool.shutdown(wait=False, cancel_futures=True)
        return {**out, **{key: fut.result() if fut in done else self._late(key) for fut, key in futures.items()}}

    def _from_cache(self, key, now):
        """(entry, False, None) when the cache answers (offline: any copy, or None), else None: ask ESPN."""
        cached = self._cached(key)
        if cached and (self.offline or self._fresh(cached, now)):
            return cached, False, None
        return (None, False, None) if self.offline else None

    def _load_week(self, key, now):
        """(entry, stale, error) for one week: the cache when fresh, else ESPN; a failed fetch keeps the last copy
        (stale) or says so."""
        hit = self._from_cache(key, now)
        if hit is not None:
            return hit
        try:
            return self._fetch_week(key, now), False, None
        except (OSError, ValueError, http.client.HTTPException) as ex:
            log.warning("ESPN's %s scoreboard for week %s failed: %s", self.season_year, week_key(*key), ex)
        cached = self._cached(key)
        return (cached, True, None) if cached else (None, False, f"Couldn't get {self._label(key)} from ESPN.")

    def _late(self, key):
        cached = self._cached(key)
        return (cached, True, None) if cached else (None, False, f"ESPN is slow to send {self._label(key)}. Try again.")

    def _fetch_week(self, key, now):
        stype, week = key
        trimmed = trim_scoreboard(self.fetch_json(
            f"{espn_feed.BASE}/scoreboard?dates={self.season_year}&seasontype={stype}&week={week}"))
        entry = {"fetched_at": now, "games": parse_week(trimmed, self.season_year, stype, week)}
        self._remember_calendar(trimmed)
        with self._lock:
            self._weeks[key] = entry
        _write(self.data_dir / "espn" / self._week_name(key), {"_fetched_at": now, **trimmed})
        return entry

    def _cached(self, key):
        """The week from memory, else its saved copy (DATA_DIR/espn, then the fixtures offline); None when neither."""
        with self._lock:
            entry = self._weeks.get(key)
        for data in [] if entry else map(_read_json, (folder / self._week_name(key) for folder in self._folders())):
            try:
                games = parse_week(data, self.season_year, *key) if data else None
            except BadAnswer as ex:
                log.warning("The saved %s isn't that week (%s); it will be fetched again.", self._week_name(key), ex)
                continue
            if games is not None:
                self._remember_calendar(data)
                with self._lock:
                    return self._weeks.setdefault(key, {"fetched_at": _fetched_at(data), "games": games})
        return entry

    @staticmethod
    def _fresh(entry, now):
        ttl, age = week_ttl(entry["games"], now), now - entry["fetched_at"]
        return ttl is None or 0 <= age < ttl

    def _week_json(self, week, entry, stale, error, callers, current=False):
        return {"key": week["key"], "season_type": week["season_type"], "week": week["week"], "label": week["label"],
                "detail": week["detail"], "current": current, "stale": stale, "error": error,
                "games": [self._with_callers(g, callers) for g in (entry["games"] if entry else [])]}

    def _calendar_week(self, key):
        found = next((w for w in self._calendar if (w["season_type"], w["week"]) == key), None)
        return found or {"key": week_key(*key), "season_type": key[0], "week": key[1], "label": f"Week {key[1]}",
                         "detail": None}

    def _label(self, key):
        return self._calendar_week(key)["label"]

    def _remember_calendar(self, data):
        calendar = parse_calendar(data) if data else []
        if calendar:
            with self._lock:
                self._calendar = self._calendar or calendar
        return bool(calendar)

    def _folders(self):
        return [self.data_dir / "espn"] + ([self.fixtures_dir] if self.offline and self.fixtures_dir else [])

    def _week_name(self, key):
        return f"scoreboard_{self.season_year}_{key[0]}_{key[1]:02d}.json"

    def _saved_weeks(self):
        return [p for folder in self._folders() for p in sorted(folder.glob(f"scoreboard_{self.season_year}_*.json"))]

    # ------------------------------------------------ lines, callers, reasons
    def _schedule(self):
        """{ESPN event id: nflverse row}: memory or DATA_DIR/nflverse while fresh (NFLVERSE_TTL_S), else nflverse,
        else the last copy; offline, the saved copies only. {} when there is none."""
        now = self.clock()
        with self._lock:
            kept = self._lines
        kept = kept or self._saved_schedule()
        if kept and (self.offline or 0 <= now - kept["fetched_at"] < NFLVERSE_TTL_S):
            return self._keep_lines(kept)
        if self.offline:
            return {}
        try:
            rows = schedule_rows(self.load_schedule(self.season_year))
        except Exception as ex:      # nflreadpy over the network: any failure only means no fresh copy (logged)
            log.warning("nflverse's %s schedule failed (%s); using %s.", self.season_year, ex,
                        "the last copy" if kept else "ESPN's odds")
            return kept["rows"] if kept else {}
        _write(self.data_dir / "nflverse" / f"schedules_{self.season_year}.json",
               {"_fetched_at": now, "season": self.season_year, "rows": [{"espn": k, **v} for k, v in rows.items()]})
        return self._keep_lines({"fetched_at": now, "rows": rows})

    def _saved_schedule(self):
        paths = [self.data_dir / "nflverse" / f"schedules_{self.season_year}.json"]
        if self.offline and self.fixtures_dir:
            paths.append(self.fixtures_dir / f"nflverse_schedules_{self.season_year}.json")
        for data in filter(None, map(_read_json, paths)):
            rows = schedule_rows(data.get("rows"))
            if rows:
                return {"fetched_at": _fetched_at(data), "rows": rows}
        return None

    def _keep_lines(self, entry):
        with self._lock:
            self._lines = entry
        return entry["rows"]

    def _espn_line(self, game):
        try:
            summary = self.fetch_summary(game["event_id"])
        except (OSError, ValueError, http.client.HTTPException) as ex:
            log.info("No ESPN odds for %s (%s).", game["event_id"], ex)
            return None
        return espn_line(summary, game["home"]["abbr"], game["away"]["abbr"])

    @staticmethod
    def _side(game, offense):
        ok = isinstance(offense, str) and ABBR_RE.fullmatch(offense)
        side = next((s for s in ("away", "home") if ok and espn_feed.same_team(offense, game[s]["abbr"])), None)
        if side is None:
            raise ValueError(f"{str(offense)[:6]!r} isn't playing in {matchup(game)}.")
        return side

    def _with_callers(self, game, rows):
        return {**game, **{side: {**game[side], "caller": self._caller(rows, game, side)} for side in ("away", "home")}}

    def _caller(self, rows, game, side, full=False):
        regular = sum(1 for w in self._calendar if w["season_type"] == REGULAR) or None
        week = nflverse_week(game["season_type"], game["week"], regular_weeks=regular)
        hits = [r for r in rows if week and r["season"] == game["season"] and r["first"] <= week <= r["last"]
                and espn_feed.same_team(r["team"], game[side]["abbr"])]
        if not hits:
            return None
        row = max(hits, key=lambda r: r["first"])      # a change mid-season: the latest row that covers the week
        caller = {"name": row["name"], "role": row["role"], "model": bool(self.has_model(row["name"]))}
        return {**caller, "source": row["source"]} if full else caller

    def _caller_rows(self):
        """The play-caller table's rows, read again whenever the file changes."""
        path = next((p for p in (self.data_dir / n for n in CALLER_TABLES) if p.is_file()), None)
        try:
            stamp = (path, path.stat().st_mtime_ns) if path else None
        except OSError:
            stamp = None
        with self._lock:
            if stamp == self._callers[0]:
                return self._callers[1]
        rows = read_callers(path) if stamp else []
        with self._lock:
            self._callers = (stamp, rows)
        return rows

    def _not_listed(self, eid):
        """Why ESPN game `eid` isn't in the listing, from its summary: another season, the preseason, no such game."""
        try:
            header = _dict(_dict(self.fetch_summary(eid)).get("header"))
        except urllib.error.HTTPError as ex:
            if ex.code == 404:
                return f"ESPN has no game with id {eid}."
            raise GamesError("ESPN wouldn't look that game up just now. Try again in a minute.", 503) from ex
        except FileNotFoundError:
            return f"ESPN game {eid} isn't in the saved weeks, and the app is offline."
        except (OSError, ValueError, http.client.HTTPException) as ex:
            raise GamesError("Couldn't reach ESPN to look that game up. Try again in a minute.", 503) from ex
        season, league = _dict(header.get("season")), _dict(header.get("league")).get("slug")
        if league not in (None, LEAGUE):
            return f"ESPN game {eid} isn't an NFL game."
        if isinstance(season.get("year"), int) and season["year"] != self.season_year:
            return f"ESPN game {eid} is from the {season['year']} season; the picker lists {self.season_year} only."
        if season.get("type") == 1:
            return f"ESPN game {eid} is a preseason game; the picker lists the regular season and the postseason."
        return f"ESPN game {eid} isn't in ESPN's {self.season_year} schedule right now."


_DEFAULT, _DEFAULT_LOCK = {}, threading.Lock()


def default_games():
    """The app's Games (DATA_DIR, offline when SHADOW_ESPN_OFFLINE=1): one per process, so its caches are shared."""
    with _DEFAULT_LOCK:
        if "games" not in _DEFAULT:
            _DEFAULT["games"] = Games(DATA_DIR, offline=ESPN_OFFLINE)
        return _DEFAULT["games"]


def game_config(event_id, offense):
    """Games.game_config on the app's Games (default_games)."""
    return default_games().game_config(event_id, offense)


def callers_for(event_id):
    """Games.callers_for on the app's Games (default_games)."""
    return default_games().callers_for(event_id)

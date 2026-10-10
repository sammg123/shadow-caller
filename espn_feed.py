"""ESPN live play-by-play feed (unofficial public JSON, no key).

Turns each play into what the engine needs: run gap and side, pass depth (air yards when ESPN
gives yards after catch), sack / scramble / incomplete, TD, turnover, penalties that wipe out a
play, punts and field goals. ESPN can't tell play-action, RPO or screen: retag those in the app.

Live polls are checked before anything is applied (v1.4): an answer that isn't a game summary, or a thin one, is a
failed poll that leaves the summary on screen alone (BadSummary), and another matchup's game stops the feed with the
reason (WrongGame). Fetches refuse redirects and answers over 8 MB; a failing feed backs off from 4 s to 30 s.
"""
import json
import logging
import math
import os
import re
import threading
import time
import urllib.request
from datetime import datetime

import logos
from config import DATA_DIR, ESPN_OFFLINE, GAME
from live import parse_clock

log = logging.getLogger(__name__)

BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
RAW_DIR = DATA_DIR / "espn"
SEEN_PATH = DATA_DIR / "feed_seen.json"
USER_AGENT = "Mozilla/5.0 shadow-caller"
MAX_SUMMARY_BYTES = 8 * 1024 * 1024        # a finished game's summary is about 0.7 MB
FETCH_DEADLINE_S = 30                      # the whole download; the timeout is per socket operation
POLL_S, MAX_BACKOFF_S = 4, 30              # live polls: every 4 s, backing off to 30 s while they fail
STATUS_MAX = 200                           # characters of an error kept in the feed's status line
# Gamebook abbreviations in play text -> ESPN abbreviations. A spot that doesn't resolve is never guessed.
TEAM_ALIASES = {"WAS": "WSH", "BLT": "BAL", "HST": "HOU", "ARZ": "ARI", "CLV": "CLE", "LA": "LAR", "JAC": "JAX",
                "SD": "LAC", "OAK": "LV", "STL": "LAR"}


class BadSummary(ValueError):
    """ESPN's answer isn't a game summary the feed can use: a failed poll. The summary on screen stays."""


class WrongGame(ValueError):
    """The summary is another matchup's game: a stale or pasted event id. The live feed never applies it."""

    def __init__(self, message, event_id=None):
        super().__init__(message)
        self.event_id = event_id

GAP_RE = re.compile(r"\b(left end|left tackle|left guard|up the middle|right guard|right tackle|right end)\b", re.I)
PASS_RE = re.compile(r"\bpass (incomplete )?(short|deep)? ?(left|middle|right)?", re.I)
GAP_LEAF = {"left end": "run_edge_left", "left tackle": "run_ot_left", "left guard": "run_inside",
            "up the middle": "run_inside", "right guard": "run_inside", "right tackle": "run_ot_right",
            "right end": "run_edge_right"}
GAIN_RE = re.compile(r"\bfor (?:(-?\d+) (?:yards?|yds?)\b|(no gain))", re.I)
SHORT_GAIN_RE = re.compile(r"\b(-?\d+) yds? (?:pass|rush|run)\b", re.I)    # ESPN's own text: '46 Yd pass from'
GAMEBOOK_RE = re.compile(r"\b[A-Z][a-z]?\.[A-Z]")                          # NFL gamebook names: 'D.Prescott'
REVERSED_RE = re.compile(r"\bplay was REVERSED\.\s*", re.I)
TWO_POINT_RE = re.compile(r"\s*TWO-POINT CONVERSION ATTEMPT\..*?(?:ATTEMPT (?:FAILS|SUCCEEDS)\.?|$)", re.I | re.S)
PEN_RE = re.compile(r"PENALTY on ([A-Z]{2,3})(?:-[^,]*)?, ([^,]+),")
ADMIN_TYPES = ("kickoff", "timeout", "end period", "end of", "two-minute", "coin toss", "extra point",
               "two-point", "conversion")
PASS_TYPES = ("pass reception", "pass incompletion", "passing touchdown", "pass interception")
END_OF_HALF_TYPES = ("end of half", "end of regulation", "end of game")
KICKOFF_RE = re.compile(r"\bkicks (?:onside )?\d+ yards?\b", re.I)
SCORING_SUMMARY_RE = re.compile(r"\b\d+ Yds? (?:pass from|run|rush)\b[^()]*\(", re.I)   # 'X 46 Yd pass from Y (Z Kick)'
SCRAMBLE_RE = re.compile(r"\bscrambles (left end|left tackle|left guard|up the middle|right guard|right tackle|right end)\b",
                         re.I)
EVENT_RE = re.compile(r"[0-9]{1,12}")      # ASCII digits only ('\d' takes Arabic-Indic too): ids reach paths and URLs
ORDER_KEY = "_apply_order"                 # feed_seen.json: games whose id list is in apply order (older files sorted it)
EVENTS_KEY = "_events"                     # feed_seen.json: {game_id: the ESPN event its applied ids came from}
# Air yards of an incompletion, from the gamebook word: median and interquartile range, nflverse 2026 weeks 1 to 5
# (65 games, pass attempts excluding sacks). Hard-coded for v1; build.py can write them into models/profile.json later.
AIR_EST = {"short": {"air": 5, "band": [1, 10], "n": 1049}, "deep": {"air": 23, "band": [19, 32], "n": 461}}
AIR_EST_SOURCE = "nflverse 2026 weeks 1-5 (65 games), pass attempts excluding sacks: median air yards, IQR as the band"


def fetch_json(url, timeout=10):
    """JSON from ESPN: no redirects (a 3xx raises urllib's HTTPError), at most MAX_SUMMARY_BYTES (BadSummary past
    that), the whole download within FETCH_DEADLINE_S."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    deadline = time.monotonic() + FETCH_DEADLINE_S
    with logos.build_opener().open(req, timeout=timeout) as r:
        raw = _read_capped(r, deadline)
    return json.loads(raw.decode("utf-8"))


def _read_capped(resp, deadline):
    chunks, size = [], 0
    while size <= MAX_SUMMARY_BYTES:
        chunk = resp.read1(MAX_SUMMARY_BYTES + 1 - size)
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
        if time.monotonic() > deadline:
            raise TimeoutError(f"ESPN's answer took over {FETCH_DEADLINE_S} s.")
    if size > MAX_SUMMARY_BYTES:
        raise BadSummary(f"ESPN's answer is over {MAX_SUMMARY_BYTES // (1024 * 1024)} MB.")
    return b"".join(chunks)


def _dict(value):
    return value if isinstance(value, dict) else {}


def whole_in(value, lo, hi):
    """value when it is a whole number (never a bool) from lo to hi, else None."""
    return value if isinstance(value, int) and not isinstance(value, bool) and lo <= value <= hi else None


def finite(value):
    """value when it is a finite number (never a bool), else None: a NaN would make JSON no browser reads."""
    ok = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    return value if ok else None


def competitors(summary):
    """header.competitions[0].competitors as a list of dicts, or None when the header doesn't have them."""
    comps = _dict(summary).get("header")
    comps = _dict(comps).get("competitions")
    first = comps[0] if isinstance(comps, list) and comps else None
    teams = _dict(first).get("competitors")
    if not isinstance(teams, list):
        return None
    teams = [c for c in teams if isinstance(c, dict)]
    return teams or None


def check_summary(summary, *, live=False, have_plays=False):
    """The summary when the feed can use it: a dict, with drives a dict when it has drives. A live poll must also
    name the teams (header.competitions[0].competitors), and once plays are applied it must list plays: a poll
    without them is a thin answer, never a reason to forget the game on screen. BadSummary otherwise."""
    if not isinstance(summary, dict):
        raise BadSummary("ESPN's answer isn't a game summary.")
    drives = summary.get("drives")
    if drives is not None and not isinstance(drives, dict):
        raise BadSummary("ESPN's answer has its drives in a shape the feed can't read.")
    if live and competitors(summary) is None:
        raise BadSummary("ESPN's answer doesn't name the teams.")
    if live and have_plays and not iter_drive_plays(summary):
        raise BadSummary("ESPN's answer lists no plays this time.")
    return summary


def same_team(a, b):
    return isinstance(a, str) and isinstance(b, str) and TEAM_ALIASES.get(a, a) == TEAM_ALIASES.get(b, b)


def check_matchup(summary, event_id):
    """WrongGame unless the summary's teams are GAME's offense and opponent (ESPN abbreviations, aliases allowed)."""
    away = home = None
    teams = []
    for c in competitors(summary) or []:
        abbr = _dict(c.get("team")).get("abbreviation")
        abbr = abbr[:6] if isinstance(abbr, str) and abbr.strip() else "?"
        teams.append(abbr)
        if c.get("homeAway") == "home":
            home = abbr
        elif c.get("homeAway") == "away":
            away = abbr
    want = (GAME["offense"], GAME["opponent"])
    if len(teams) == 2 and all(any(same_team(t, w) for t in teams) for w in want):
        return
    if away and home:
        named = f"{away} at {home}"
    else:
        named = " v ".join(teams) if teams else "a game with no teams named"
    raise WrongGame(f"ESPN event {event_id} is {named}, not {want[0]} v {want[1]}.", event_id)


def backoff_s(failures):
    """Seconds to the next live poll after `failures` errors in a row: 4, then 4, 8, 16 and 30 at most."""
    return min(MAX_BACKOFF_S, POLL_S * 2 ** max(0, failures - 1))


def find_event(team_abbr, date=None):
    """ESPN event id for this team's game on date (YYYYMMDD, default today)."""
    date = date or datetime.now().strftime("%Y%m%d")
    sb = fetch_json(f"{BASE}/scoreboard?dates={date}")
    for ev in sb.get("events", []):
        comps = (ev.get("competitions") or [{}])[0].get("competitors", [])
        if any((c.get("team") or {}).get("abbreviation") == team_abbr for c in comps):
            return str(ev["id"]), ev.get("name", "")
    return None, None


def check_event(event_id):
    """The event id as a string, or ValueError: it is used in file names and URLs."""
    eid = str(event_id or "")
    if not EVENT_RE.fullmatch(eid):
        raise ValueError(f"ESPN event ids are digits only, like 401872980 (got '{eid[:20]}').")
    return eid


def fetch_summary(event_id):
    event_id = check_event(event_id)
    if ESPN_OFFLINE:                                   # demos and tests: a saved finished game, no network
        path = RAW_DIR / f"summary_{event_id}_final.json"
        if not path.exists():                          # the file's name, never the server's folders
            raise FileNotFoundError(f"Offline mode: no saved game for ESPN event {event_id} ({path.name}).")
        return json.loads(path.read_text())
    return fetch_json(f"{BASE}/summary?event={event_id}")


def drive_groups(summary):
    """ESPN's drives in order (drives.previous, then drives.current, the drive in progress), dicts only: a null or
    malformed entry in a poll is skipped, never the reason a request fails."""
    drives = _dict(_dict(summary).get("drives"))
    prev = drives.get("previous")
    groups = [d for d in prev if isinstance(d, dict)] if isinstance(prev, list) else []
    cur = drives.get("current")
    if isinstance(cur, dict) and cur.get("plays"):
        groups.append(cur)
    return groups


def _seq_number(p):
    try:
        return int(p.get("sequenceNumber") or 0)
    except (TypeError, ValueError, OverflowError):
        return 0


def iter_drive_plays(summary):
    """All plays in order as (offense_abbr, drive_idx, drive_id, play). drive_idx counts ESPN's drives from 1
    (drives.previous, then drives.current, the drive in progress). Plays that aren't objects are skipped."""
    seen, out = set(), []
    for idx, d in enumerate(drive_groups(summary), start=1):
        team = _dict(d.get("team")).get("abbreviation")
        team = team if isinstance(team, str) else None
        did = str(d["id"]) if isinstance(d.get("id"), (str, int)) and not isinstance(d.get("id"), bool) else None
        plays = d.get("plays")
        for p in plays if isinstance(plays, list) else []:
            if not isinstance(p, dict):
                continue
            pid = str(p.get("id"))
            if pid in seen:
                continue
            seen.add(pid)
            out.append((team, idx, did, p))
    out.sort(key=lambda x: _seq_number(x[3]))
    return out


def iter_plays(summary):
    """All plays in order as (offense_abbr, play). drives.current is the drive in progress."""
    return [(team, p) for team, idx, did, p in iter_drive_plays(summary)]


def _team_id(team, abbr):
    tid = team.get("id")
    if team.get("abbreviation") == abbr and isinstance(tid, (str, int)) and not isinstance(tid, bool):
        return str(tid)
    return None


def team_id(summary, abbr):
    """ESPN team id for an abbreviation, from the drive records (fallback: boxscore, header)."""
    drives = _dict(_dict(summary).get("drives"))
    prev = drives.get("previous") if isinstance(drives.get("previous"), list) else []
    box = _dict(_dict(summary).get("boxscore")).get("teams")
    sources = ([_dict(_dict(d).get("team")) for d in prev + [drives.get("current")]]
               + [_dict(_dict(t).get("team")) for t in (box if isinstance(box, list) else [])]
               + [_dict(c.get("team")) for c in competitors(summary) or []])
    return next((tid for tid in (_team_id(t, abbr) for t in sources) if tid), None)


def _depth(air):
    return "short" if air < 10 else ("mid" if air < 20 else "deep")


def play_text(text):
    """The play as it finally stood: the corrected text after a replay reversal, without the two-point
    try ESPN appends to a touchdown."""
    return TWO_POINT_RE.sub("", REVERSED_RE.split(text)[-1]).strip()


FOUL_MAX = 60                              # characters of a foul's name kept from ESPN's text (G1-12)


def penalty_note(text):
    """'defensive offside on TB' from '...PENALTY on TB-D.Walker, Defensive Offside, 4 yards...'."""
    m = PEN_RE.search(text or "")
    return f"{m.group(2).strip().lower()[:FOUL_MAX]} on {m.group(1)}" if m else None


def _gain(text):
    """First gain in the text ('for 8 yards', 'for no gain', ESPN's '46 Yd pass'), or None."""
    m = GAIN_RE.search(text)
    if m:
        return 0 if m.group(2) else int(m.group(1))
    m = SHORT_GAIN_RE.search(text)
    return int(m.group(1)) if m else None


def _align(text):
    """'S' shotgun, 'U' not shotgun (under center or pistol); None when the text isn't gamebook text."""
    if "shotgun" in text.lower():
        return "S"
    return "U" if GAMEBOOK_RE.search(text) else None


def _call_family(typ, body):
    """'sack', 'scramble', 'pass', 'run' or None (no call: a flag before the snap), from the play
    text before any penalty, falling back to ESPN's play type for its own short text."""
    low = body.lower()
    if not re.search(r"[a-z]", low.replace("shotgun", "").replace("no huddle", "")):
        return None                                                # nothing but a formation tag
    if "sacked" in low or typ.startswith("sack"):
        return "sack"
    if "scrambles" in low:
        return "scramble"
    if re.search(r"\bpass\b", low) or "intercepted" in low or typ.startswith(PASS_TYPES):
        return "pass"
    if GAP_RE.search(low) or typ.startswith("rush") or SHORT_GAIN_RE.search(body):
        return "run"
    if GAMEBOOK_RE.search(body) and GAIN_RE.search(body):       # 'J.Williams to DAL 30 for 2 yards'
        return "run"
    return None


def _yards(p, body, family, incomplete, intercepted):
    """Yards the call gained: the gamebook gain before any fumble (not the return, not the flag)."""
    if incomplete or intercepted:
        return 0
    gain = _gain(re.split(r"\bFUMBLES\b", body)[0])
    if gain is None:
        stat = finite(p.get("statYardage"))
        gain = int(stat) if stat is not None else 0
    return abs(gain) if family == "sack" else gain


def _pass_leaf(p, body, yards, incomplete, intercepted):
    """Depth from air yards (gain minus yards after catch) on a completion, else from the short/deep word.
    Incompletions: 'deep' (15+) is 20+ air yards 70% of the time in 2022-25 nflverse, so deep -> 20+."""
    m = PASS_RE.search(body)
    word = (m.group(2) or "").lower() if m else ""
    yac = finite(p.get("yardsAfterCatch"))
    if not incomplete and not intercepted and yac is not None:
        depth = _depth(yards - int(yac))
        # gamebook 'deep' = 15+ air yards, 'short' = under 15: a whole bucket off means ESPN's YAC is wrong
        if word == "deep" and depth == "short":
            return "dropback_deep"
        if word == "short" and depth == "deep":
            return "dropback_mid"
        return f"dropback_{depth}"
    return f"dropback_{word}" if word else None


def _gap_side(gap):
    """'left' / 'middle' / 'right' from gap words ('left tackle' -> 'left', 'up the middle' -> 'middle')."""
    if not gap:
        return None
    return "middle" if gap == "up the middle" else gap.split()[0]


def _pass_facts(p, body, yards, incomplete, intercepted):
    """Side and gamebook depth word of a pass, and its air yards: exact from yards after catch on a completion,
    the median for the word on an incompletion. An interception's air comes from its spot (timeline.py)."""
    m = PASS_RE.search(body)
    word = ((m.group(2) or "").lower() or None) if m else None
    out = {"lat": ((m.group(3) or "").lower() or None) if m else None, "depth": word}
    yac = finite(p.get("yardsAfterCatch"))
    if not incomplete and not intercepted and yac is not None:
        air = yards - int(yac)
        conflict = (word == "deep" and air < 10) or (word == "short" and air >= 20)   # the same distrust as _pass_leaf
        out.update(air=air, yac=int(yac), air_src="yac_conflict" if conflict else "yac")
    elif not intercepted and word in AIR_EST:
        out.update(air=AIR_EST[word]["air"], air_src="est", air_band=list(AIR_EST[word]["band"]))
    return out


def _turnover(p, typ, low):
    if "isTurnover" in p:
        return bool(p["isTurnover"])
    return "intercepted" in low or "opponent" in typ


def classify(team, p):
    """What happened on this play, in the engine's terms. A field of the wrong type reads as missing."""
    typ = _dict(p.get("type")).get("text")
    typ = typ.lower() if isinstance(typ, str) else ""
    raw = p.get("text") if isinstance(p.get("text"), str) else ""
    text = play_text(raw)
    low = text.lower()
    nullified = "no play" in low
    info = {"id": str(p.get("id")), "team": team, "text": raw, "type": typ, "kind": "skip",
            "leaf": None, "family": None, "outcome": None, "yards": 0, "td": False, "turnover": False,
            "nullified": nullified, "align": _align(raw),
            "lat": None, "gap": None, "depth": None, "air": None, "air_src": None, "air_band": None, "yac": None}
    if (any(k in typ for k in ADMIN_TYPES) or raw.lstrip().upper().startswith("TWO-POINT CONVERSION")
            or KICKOFF_RE.search(text)):
        return info
    if "punt" in typ or re.search(r"\bpunts\b", low):
        info["kind"] = "sync" if nullified else "punt"
        return info
    if "field goal" in typ:
        made = "good" in typ and "no good" not in typ
        info["kind"] = "sync" if nullified else ("fg" if made else "fg_miss")
        return info
    body = re.split(r"\bpenalty on\b", text, maxsplit=1, flags=re.I)[0]
    family = _call_family(typ, body)
    if family is None or any(k in low for k in ("kneels", "spiked", "aborted")) or low.strip(" .") == "team safety":
        info["kind"] = "sync"                      # flag before the snap, kneel, spike, fumbled snap
        return info

    body_low = body.lower()
    gamebook = bool(GAMEBOOK_RE.search(body))      # gamebook text beats ESPN's type, which can lag a reversal
    intercepted = "intercepted" in body_low
    incomplete = family == "pass" and ("incomplete" in body_low or (not gamebook and "incompletion" in typ))
    yards = _yards(p, body, family, incomplete, intercepted)
    if family == "run":
        m = GAP_RE.search(body)
        gap = m.group(1).lower() if m else None
        info.update(family="run", leaf=GAP_LEAF[gap] if gap else None, gap=gap, lat=_gap_side(gap))
    elif family == "pass":
        info.update(family="dropback", leaf=_pass_leaf(p, body, yards, incomplete, intercepted),
                    outcome="incomplete" if incomplete else None, **_pass_facts(p, body, yards, incomplete, intercepted))
    else:
        info.update(family="dropback", outcome=family)
        if family == "scramble":
            m = SCRAMBLE_RE.search(body)
            gap = m.group(1).lower() if m else None
            info.update(gap=gap, lat=_gap_side(gap))
    turnover = not nullified and _turnover(p, typ, low)
    td = (not turnover and not nullified and "touchdown nullified" not in low
          and ("touchdown" in low or (not gamebook and "touchdown" in typ) or bool(SCORING_SUMMARY_RE.search(text))))
    info.update(kind="play", yards=yards, turnover=turnover, td=td)
    return info


def situation(p, which, offense_is_home):
    """Down, distance, ball (distance to the end zone), quarter, clock, score at start or end of a play."""
    st = _dict(p.get(which))
    out = {}
    down, ytg = whole_in(st.get("down"), 1, 4), whole_in(st.get("yardsToEndzone"), 1, 99)
    if down and ytg:
        out.update(down=down, togo=whole_in(st.get("distance"), 1, 99) or 10, yardline_100=ytg)
    q = whole_in(_dict(p.get("period")).get("number"), 1, 5)
    if q:
        out["qtr"] = q
    clk = _dict(p.get("clock")).get("displayValue")
    if which == "start" and isinstance(clk, str) and clk:
        try:
            out["clock"] = parse_clock(clk)
        except ValueError:
            pass
    if which == "end":
        h, a = whole_in(p.get("homeScore"), 0, 999), whole_in(p.get("awayScore"), 0, 999)
        if h is not None and a is not None:
            out["score_off"], out["score_opp"] = (h, a) if offense_is_home else (a, h)
    poss = _dict(st.get("team")).get("id")
    out["_poss_id"] = str(poss) if isinstance(poss, (str, int)) and not isinstance(poss, bool) else None
    return out


class Feed:
    """Polls ESPN and applies new plays to the engine, in order, under the app's lock.

    applied: ESPN play ids in the order they were applied (the timeline's seq); seen is the same ids as a set.
    skipped_ids: the applied ids whose apply failed (this game, since the ids were last loaded or forgotten).
    gen: bumped by invalidate(); a poll fetched under an older gen applies nothing.
    summary: the last ESPN summary applied or loaded (load_summary() falls back to the saved files)."""

    def __init__(self, engine, lock, on_change=None):
        self.engine, self.lock, self.on_change = engine, lock, on_change
        self.event_id = GAME.get("espn_event")
        self.on = False
        self.interval = POLL_S
        self.status = {"state": "off", "detail": "", "last_poll": None, "last_play": None, "plays_logged": 0,
                       "skipped": None}
        self.gen = 0
        self.reload_seen()             # the event its applied ids came from, when the seen file says (v1.4)
        self.summary = None
        self.off_team_id = None
        self._thread = None
        self._wake = threading.Event()  # start and stop cut the wait between polls short
        self.load_summary()

    @property
    def summary(self):
        return self._summary

    @summary.setter
    def summary(self, summary):
        """Set event_id first: a summary only counts for the event it was set under."""
        self._summary, self._summary_event = summary, self.event_id
        if summary:                                    # apply_one needs it to see possession change hands
            self.off_team_id = team_id(summary, GAME["offense"]) or getattr(self, "off_team_id", None)
        self.fix_order(summary)

    def load_summary(self):
        """This game's ESPN summary: memory, then data/espn/summary_<event>.json (the last poll), then the saved
        summary_<event>_final.json. None when there is none. Never touches the network."""
        if self._summary is not None and self._summary_event == self.event_id:
            return self._summary
        eid = str(self.event_id or "")
        if not EVENT_RE.fullmatch(eid):
            return None
        for path in (RAW_DIR / f"summary_{eid}.json", RAW_DIR / f"summary_{eid}_final.json"):
            try:
                s = json.loads(path.read_text()) if path.exists() else None
            except (ValueError, OSError) as ex:
                log.warning("Couldn't read %s (%s); trying the next saved copy.", path.name, ex)
                continue
            if isinstance(s, dict):
                self.summary = s
                return s
        return None

    # -------------------------------------------------- persistence of processed play ids
    def _load_seen(self):
        """(ids in apply order, True if the file is the old string-sorted format, the ESPN event they came from or
        None when the file doesn't say)."""
        if not SEEN_PATH.exists():
            return [], False, None
        try:
            d = json.loads(SEEN_PATH.read_text())
            ids = [str(x) for x in d.get(GAME["game_id"], [])]
            legacy = GAME["game_id"] not in (d.get(ORDER_KEY) or [])
            event = _dict(d.get(EVENTS_KEY)).get(GAME["game_id"])
        except (ValueError, OSError, AttributeError, TypeError) as ex:
            log.warning("Couldn't read %s (%s); ESPN plays already in the log may be logged again.", SEEN_PATH.name,
                        ex)
            return [], False, None
        event = event if isinstance(event, str) and EVENT_RE.fullmatch(event) else None
        return list(dict.fromkeys(ids)), legacy and len(ids) > 1, event

    def reload_seen(self):
        """Read the applied ids from feed_seen.json again (after a backup of it is put back). When there are some,
        the feed follows the event they came from: after a restart the game on screen stays the one they belong to,
        whatever config.py says (v1.4)."""
        self.applied, self._legacy_order, event = self._load_seen()
        if self.applied and event:
            self.event_id = event
        self.seen = set(self.applied)
        self.skipped_ids = []

    def fix_order(self, summary):
        """An old feed_seen.json stored the ids string-sorted: put them back in the order the plays happened."""
        if not getattr(self, "_legacy_order", False) or not summary:
            return
        pos = {str(p.get("id")): i for i, (t, p) in enumerate(iter_plays(summary))}
        order = sorted(self.applied, key=lambda pid: pos.get(pid, len(pos)))
        self._legacy_order = False
        if order != self.applied:
            self.applied = order
            self._bump_epoch()

    def _save_seen(self):
        try:
            d = json.loads(SEEN_PATH.read_text()) if SEEN_PATH.exists() else {}
        except (ValueError, OSError):
            d = {}
        d = d if isinstance(d, dict) else {}
        ordered = d.get(ORDER_KEY) if isinstance(d.get(ORDER_KEY), list) else []
        d[GAME["game_id"]] = list(self.applied)
        d[ORDER_KEY] = sorted(set(ordered) | {GAME["game_id"]})
        events = {k: v for k, v in _dict(d.get(EVENTS_KEY)).items() if k != GAME["game_id"]}
        eid = str(self.event_id or "")
        d[EVENTS_KEY] = {**events, **({GAME["game_id"]: eid} if EVENT_RE.fullmatch(eid) else {})}
        tmp = SEEN_PATH.with_name(SEEN_PATH.name + ".tmp")
        tmp.write_text(json.dumps(d))
        os.replace(tmp, SEEN_PATH)                     # atomic: a crash mid-write can't corrupt it

    def forget(self):
        """No play counts as applied any more (reset, replay, watch). If some did, the engine's undo steps go too:
        one could bring back their rows with their ids forgotten, and the feed would log them all twice (G9)."""
        if self.applied:               # first, so a seen file that can't be saved never leaves a way back
            self.engine.clear_history()
        self.seen, self.applied, self._legacy_order, self.skipped_ids = set(), [], False, []
        self.status.update(skipped=None, plays_logged=0)
        self._save_seen()
        self._bump_epoch()

    def invalidate(self):
        """Drop any poll already in flight: its apply() sees a stale generation and applies nothing."""
        with self.lock:
            self.gen += 1

    def _bump_epoch(self):
        bump = getattr(self.engine, "bump_epoch", None)
        if bump:
            bump()

    # -------------------------------------------------- control
    def resolve_event(self, event_id=None):
        """The event to follow: the id given (checked), else the current one, else today's game for the offense
        from ESPN's scoreboard. That last is a network call of up to 10 s: make it before taking the app's lock."""
        if event_id:
            return check_event(event_id)
        if self.event_id:
            return check_event(self.event_id)
        eid, name = find_event(GAME["offense"])
        if not eid:
            raise ValueError(f"No {GAME['offense']} game on ESPN today. Enter the ESPN event id.")
        return check_event(eid)

    def start(self, event_id=None):
        eid = self.resolve_event(event_id)
        if eid != self.event_id:
            self.invalidate()        # a poll of the old event still in flight must not land as the new one's
            self.event_id = eid
        self.on = True
        self.status.update(state="starting", detail=f"ESPN event {self.event_id}")
        self._wake.set()             # a loop waiting out a backoff polls now
        if not self._thread or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()

    def stop(self):
        self.on = False
        self.status.update(state="off", detail="")
        self._wake.set()

    def _loop(self):
        """Poll while on: every POLL_S, backing off to MAX_BACKOFF_S while polls fail (backoff_s). Another matchup's
        game stops the feed with the reason in its status (WrongGame); anything else is a failed poll. The thread
        decides to end under the lock and lets go of self._thread there, so a start() at that moment (under the same
        lock) starts a new one instead of trusting a thread on its way out."""
        failures = 0
        while True:
            with self.lock:
                if not self.on:
                    if self._thread is threading.current_thread():
                        self._thread = None
                    return
            self._wake.clear()
            try:
                self.poll_once()
                failures = 0
            except WrongGame as ex:
                self._refuse(ex)
                continue
            except Exception as ex:  # network blips, bad answers: keep polling, show the error
                failures += 1
                self.status.update(state="error", detail=f"{type(ex).__name__}: {ex}"[:STATUS_MAX])
            self._wake.wait(backoff_s(failures))

    def _refuse(self, ex):
        """Stop the feed over a WrongGame for the event it still follows. True when it stopped."""
        with self.lock:
            if ex.event_id is not None and ex.event_id != self.event_id:
                return False         # Sam switched events while that poll was out: the new one decides
            self.on = False
            self.status.update(state="error", detail=str(ex)[:STATUS_MAX])
        log.warning("Live feed stopped: %s", ex)
        return True

    def poll_once(self, summary=None):
        """One poll: fetch (the live feed) or take `summary` (a replay), apply the plays not applied yet, then keep
        the summary as summary_<event>.json when new plays arrived. A fetched summary is checked first (BadSummary,
        WrongGame): then nothing is applied and the summary on screen stays."""
        gen, eid = self.gen, self.event_id             # read before the fetch: a replay or watch may start meanwhile,
        fetched = summary is None                      # and switch event_id; this poll stays with its own game's file
        summary = fetch_summary(eid) if fetched else summary
        if gen != self.gen:
            return 0
        if fetched:
            check_summary(summary, live=True, have_plays=bool(self.applied))
            check_matchup(summary, eid)
        before = len(self.applied)
        n = self.apply(summary, gen)
        unsaved = self._keep_raw(eid, summary) if len(self.applied) > before else None
        self.status.update(state="live" if self.on else self.status["state"], last_poll=datetime.now().strftime("%H:%M:%S"),
                           detail=f"ESPN event {eid}" + (f". {unsaved}" if unsaved else ""))
        return n

    @staticmethod
    def _keep_raw(eid, summary):
        """summary_<event>.json, the last poll that brought plays (load_summary reads it after a restart): written
        whole, a temp file then os.replace. A disk that refuses it never stops the feed: the plays are already in.
        Returns what went wrong, or None."""
        path = RAW_DIR / f"summary_{check_event(eid)}.json"
        tmp = path.with_name(path.name + ".tmp")
        try:
            RAW_DIR.mkdir(exist_ok=True)
            tmp.write_text(json.dumps(summary))
            os.replace(tmp, path)
            return None
        except OSError as ex:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            log.warning("Couldn't save %s (%s); the plays were applied.", path.name, ex)
            return f"Couldn't save {path.name}: {ex}"[:STATUS_MAX]

    # -------------------------------------------------- apply plays
    def apply(self, summary, gen=None):
        """Apply every play in the summary not applied yet, in order. gen: the generation read before the fetch;
        when a replay, reset or watch has invalidated it since, nothing is applied (returns 0). A summary the feed
        can't read raises BadSummary before it replaces the one on screen."""
        logged = 0
        with self.lock:              # the replay button and the poll thread must not both apply the same plays
            if gen is not None and gen != self.gen:
                return 0
            check_summary(summary)
            self.summary = summary
            self.off_team_id = team_id(summary, GAME["offense"]) or self.off_team_id
            new = [(t, p) for t, p in iter_plays(summary) if str(p.get("id")) not in self.seen]
            try:
                for team, p in new:
                    logged += self.apply_one(team, p, save=False)
            finally:
                if new:
                    self._save_seen()
        if new and self.on_change:
            self.on_change()
        return logged

    def apply_one(self, team, p, save=True):
        """Apply one ESPN play to the engine, then record its id in apply order and update the status line.
        Never raises: a play that fails is skipped (status 'skipped', its id in skipped_ids, the traceback in the
        server log) but still counts as applied. Returns 1 if it logged a snap that counts. Takes the lock
        (re-entrant), so callers may hold it. Undo can't step back past it, applied or skipped
        (GameEngine.seal_history): its id stays applied, so the feed would never log it again."""
        pid = str(p.get("id"))
        logged = 0
        with self.lock:
            typed_rows = not self.applied and bool(self.engine.state.get("log"))
            try:
                logged = self._apply_one(team, p)
            except Exception as ex:    # one bad play must not stall the feed for the rest of the game
                self.status["skipped"] = f"{str(p.get('text') or '')[:90]} ({str(ex)[:100]})"
                if pid not in self.skipped_ids:
                    self.skipped_ids.append(pid)
                log.exception("ESPN play %s skipped; enter it by hand if it was a %s snap", pid, GAME["offense"])
            self.engine.seal_history()
            if pid not in self.seen:
                if typed_rows:         # the field showed hand-typed plays; from now on it shows ESPN's: new epoch
                    self._bump_epoch()
                self.seen.add(pid)
                self.applied.append(pid)
            self.status["last_play"] = (p.get("text") or "")[:160]
            self.status["plays_logged"] += logged
            if save:
                self._save_seen_safely()
        return logged

    def _save_seen_safely(self):
        try:
            self._save_seen()
        except OSError as ex:
            self.status["detail"] = f"Couldn't save {SEEN_PATH.name}: {ex}"[:STATUS_MAX]
            log.error("Couldn't save %s: %s", SEEN_PATH.name, ex)

    def _apply_one(self, team, p):
        """Apply one ESPN play to the engine. Returns 1 if it logged a snap that counts, else 0."""
        e, home = self.engine, GAME["offense_is_home"]
        info = classify(team, p)
        start, end = situation(p, "start", home), situation(p, "end", home)
        ours = team == GAME["offense"]
        if info["kind"] == "skip":
            self._apply_admin(info, start, end)
            return 0
        logged = 0
        if ours and info["kind"] == "play":
            e.feed_sync(start, offense_ball=True)
            if info["nullified"]:
                note = penalty_note(play_text(info["text"]))
                e.apply_penalty("OFFSET", play={k: info[k] for k in ("leaf", "family", "outcome")},
                                source="espn", note=note, espn_id=info["id"])
            else:
                e.record_play(None, info["yards"], td=info["td"], turnover=info["turnover"],
                              leaf=info["leaf"], family=None if info["leaf"] else info["family"],
                              outcome=info["outcome"], source="espn", feed=info)
                logged = 1
        elif ours and info["kind"] in ("punt", "fg", "fg_miss") and e.state["drive_active"]:
            e.end_drive(info["kind"])
        elif ours and info["kind"] == "sync":
            e.feed_sync(start, offense_ball=True)
        e.feed_sync(end, offense_ball=self._ours(end))
        if ours and info["kind"] == "play" and info["nullified"] and e.state["drive_active"]:
            e.set_message(f"No play: {note or 'flag'}. {e.situation_text()}. His call still counts for scoring.")
        return logged

    def _apply_admin(self, info, start, end):
        """Timeouts, kickoffs, PATs, ends of quarters: clock and score; possession only when it's clean."""
        e = self.engine
        keep = {k: v for k, v in start.items() if k in ("qtr", "clock")}
        keep.update({k: v for k, v in end.items() if k in ("score_off", "score_opp")})
        half_over = any(k in info["type"] for k in END_OF_HALF_TYPES)
        e.feed_sync(keep, offense_ball=False if half_over else None)
        if "kickoff" in info["type"]:
            e.feed_sync({}, offense_ball=False)            # a kickoff always starts a new possession
            if "down" in end:
                e.feed_sync(end, offense_ball=self._ours(end))

    def _ours(self, end):
        """True/False when ESPN clearly says who has the ball next; None when it's unclear (no change)."""
        poss = end.get("_poss_id")
        if not poss or not self.off_team_id:
            return None
        if poss != self.off_team_id:
            return False
        return True if "down" in end else None

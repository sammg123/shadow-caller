"""Field math (data contract A3), the play-text parsers (B6) behind the timeline (spots, penalties, kicks), and the
readers of the summary's header, venue and box score (C2 teams; v1.2 game facts and ESPN's own box score).

Pure: no Flask, no I/O beyond the system's time zone database. x = yards from the caller's own goal line; the caller
attacks left to right. Nothing here reads a score, record, winner or result from the header (E5).
"""
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from espn_feed import FOUL_MAX, TEAM_ALIASES, play_text
from live import fmt_clock, parse_clock

COLOR_RE = re.compile(r"[0-9a-fA-F]{6}")
ABBR_RE = re.compile(r"[A-Z]{2,4}")
SPOT = r"(?:([A-Z]{2,3}) (\d{1,2})|(50))"
SACK_SPOT_RE = re.compile(rf"\bsacked at {SPOT}")
INT_SPOT_RE = re.compile(rf"\bINTERCEPTED by .*?\bat {SPOT}")
RETURN_RE = re.compile(rf"\b(?:to|at) {SPOT} for (?:(-?\d+) yards?|no gain)")
RECOVERY_RE = re.compile(rf"\b(?:RECOVERED|recovered) by ([A-Z]{{2,3}})\b.*?\bat {SPOT}")
KICKOFF_DIST_RE = re.compile(r"\bkicks (?:onside )?(\d+) yards?", re.I)
PUNT_DIST_RE = re.compile(r"\bpunts (\d+) yards?", re.I)
FG_RE = re.compile(r"\b(\d+) yard field goal is (GOOD|No Good|BLOCKED)", re.I)
PEN_HEAD_RE = re.compile(r"PENALTY on ([A-Z]{2,3})(?:-[^,]*)?, ([^,]+),\s*")
NOTE_MAX = 80                              # 'defensive pass interference on TB', capped (G1-12)
PEN_YARDS_RE = re.compile(r"(\d+) yards?, enforced\b\s*")
PEN_SPOT_RE = re.compile(rf"at {SPOT}( - No Play)?")
TIMEOUT_BY_RE = re.compile(r"\bby ([A-Z]{2,3})\b")
PAT_TWO_RE = re.compile(r"TWO-POINT CONVERSION ATTEMPT.*?ATTEMPT (SUCCEEDS|FAILS)", re.I | re.S)
EXTRA_POINT_RE = re.compile(r"extra point is (GOOD|No Good|BLOCKED|Missed)", re.I)


# ---------------------------------------------------------------- A3: field math
def dir_of(team, caller):
    """Attack direction: +1 for the caller (left to right), -1 for the opponent."""
    return 1 if team == caller else -1


def x_from_yardline(yard_line, caller_is_home):
    """ESPN start/end yardLine is measured from the home goal line."""
    return yard_line if caller_is_home else 100 - yard_line


def spot_x(team, n, caller):
    """x of a team's own N yard line ('TB 3' is 97 when DAL is the caller)."""
    return n if team == caller else 100 - n


def x_from_yl100(yl100, team, caller):
    return 50 + dir_of(team, caller) * (50 - yl100)


def yl100_from_x(x, team, caller):
    return 50 - dir_of(team, caller) * (x - 50)


def goal_x(team, caller):
    """The goal line a team scores at."""
    return 100 if dir_of(team, caller) == 1 else 0


def clamp_x(x):
    return None if x is None else max(-10, min(110, x))


def resolve_team(abbr, teams):
    """An abbreviation from play text as one of this game's ESPN abbreviations, else None."""
    if abbr in teams:
        return abbr
    alias = TEAM_ALIASES.get(abbr)
    return alias if alias in teams else None


def text_x(groups, ctx):
    """x of a SPOT match ('TB 24', '50'), or None when the team doesn't resolve."""
    team, n, mid = groups
    if mid:
        return 50
    t = resolve_team(team, ctx["teams"])
    return spot_x(t, int(n), ctx["caller"]) if t else None


def search_x(regex, text, ctx):
    m = regex.search(text)
    return text_x(m.groups()[-3:], ctx) if m else None


def clock_seconds(clock):
    try:
        return parse_clock(clock) if clock else None
    except ValueError:
        return None


def elapsed(qtr, clock_s):
    """Game seconds elapsed at the snap. Overtime periods count 600 s each."""
    if not isinstance(qtr, int) or clock_s is None:
        return None
    if qtr >= 5:
        return 3600 + (qtr - 5) * 600 + 600 - clock_s
    return (qtr - 1) * 900 + 900 - clock_s


# ---------------------------------------------------------------- B6: text facts
def pat_of(text):
    """The try after a touchdown: two_good, two_failed, kick_good or kick_missed; None when the text has none."""
    m = PAT_TWO_RE.search(text)
    if m:
        return "two_good" if m.group(1).upper() == "SUCCEEDS" else "two_failed"
    m = EXTRA_POINT_RE.search(text)
    if m:
        return "kick_good" if m.group(1).upper() == "GOOD" else "kick_missed"
    return None


def mm_ss(text):
    """Seconds of ESPN's '4:09' (a drive's time); None when it isn't one."""
    m = re.fullmatch(r"(\d{1,3}):(\d{2})", str(text or ""))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def down_text(down, togo, yl100, caller, opp):
    """'1st & 4 at TB 4', built like GameEngine.situation_text()."""
    spot = "50" if yl100 == 50 else (f"{caller} {100 - yl100}" if yl100 > 50 else f"{opp} {yl100}")
    return f"{['', '1st', '2nd', '3rd', '4th'][down]} & {'Goal' if togo >= yl100 else togo} at {spot}"


def score_pair(text, caller, opp):
    """{caller: n, opp: m} from a log row's 'n-m' score; None when it isn't one."""
    m = re.fullmatch(r"(\d+)-(\d+)", str(text or ""))
    return {caller: int(m.group(1)), opp: int(m.group(2))} if m else None


def split_body(text):
    """The action before any penalty enforcement, and the whole corrected text ('' for anything but a string)."""
    full = play_text(text if isinstance(text, str) else "")
    return re.split(r"\bPENALTY on\b", full, maxsplit=1, flags=re.I)[0], full


def penalty_of(text, ctx):
    """The first foul in the text: on, foul, yards, at_x, no_play, status, note (B6.8)."""
    m = PEN_HEAD_RE.search(text)
    if not m:
        return None
    on, foul = resolve_team(m.group(1), ctx["teams"]), m.group(2).strip()[:FOUL_MAX]
    rest = text[m.end():]
    out = {"on": on, "foul": foul, "yards": None, "at_x": None, "no_play": False, "status": "enforced",
           "note": f"{foul.lower()} on {m.group(1)}"[:NOTE_MAX]}
    enforced = PEN_YARDS_RE.match(rest)
    if enforced:
        out["yards"] = int(enforced.group(1))
        at = PEN_SPOT_RE.match(rest[enforced.end():])         # 'enforced between downs' has no spot
        if at:
            out.update(at_x=text_x(at.groups()[:3], ctx), no_play=bool(at.group(4)))
    elif re.match(r"declined", rest, re.I):
        out["status"] = "declined"
    if re.search(r"\boffsetting\b", text, re.I):
        out["status"] = "offsetting"
    return out


def kick_facts(kind, team, opp, body, full, x0, ctx):
    """Punt, kickoff and field goal facts (B5), and the kick's dead-ball spot before any enforcement: the end of
    a fumble recovery (its runback included), else the end of the return, else where the kick landed.
    team is the drive owner, which is the receiving team on a kickoff."""
    caller = ctx["caller"]
    by = opp if kind == "kickoff" else team
    kdir = dir_of(by, caller)
    clause = body.split(". ")[0]
    low = body.lower()
    k = {"by": by, "kdir": kdir, "from_x": x0, "dist": None, "land_x": None,
         "ez": bool(re.search(r"\bend zone\b", clause, re.I)), "touchback": "touchback" in low,
         "fair_catch": "fair catch" in low, "downed": "downed by" in low,
         "oob": bool(re.search(r"\bout of bounds\b", clause, re.I)), "muffed": "MUFF" in body,
         "blocked": "BLOCKED" in body, "ret_yards": None, "ret_end_x": None, "fumble_rec": None,
         "penalty": bool(re.search(r"\bPENALTY on\b", full, re.I))}
    if kind in ("fg", "fg_miss"):
        m = FG_RE.search(body)
        post_x = 110 if kdir == 1 else -10
        dist = int(m.group(1)) if m else None
        k.update(dist=dist, good=bool(m and m.group(2).upper() == "GOOD"), post_x=post_x,
                 x_kick=None if dist is None else post_x - kdir * dist)
        return k, None
    m = (KICKOFF_DIST_RE if kind == "kickoff" else PUNT_DIST_RE).search(body)
    if m and x0 is not None:
        k.update(dist=int(m.group(1)), land_x=clamp_x(x0 + kdir * int(m.group(1))))
    after = body[len(clause):]
    ret = RETURN_RE.search(after)
    if ret:
        k.update(ret_end_x=text_x(ret.groups()[:3], ctx), ret_yards=int(ret.group(4)) if ret.group(4) else 0)
    end = k["ret_end_x"] if k["ret_end_x"] is not None else k["land_x"]
    rec = RECOVERY_RE.search(after)
    if rec:
        k["fumble_rec"] = {"team": resolve_team(rec.group(1), ctx["teams"]), "x": text_x(rec.groups()[1:4], ctx)}
        runback = RETURN_RE.search(after[rec.end():])
        end = text_x(runback.groups()[:3], ctx) if runback else k["fumble_rec"]["x"]
    return k, end


# ---------------------------------------------------------------- C2: teams from the summary header
def _dict(value):
    return value if isinstance(value, dict) else {}


# ---------------------------------------------------------------- v1.4 (G1-6): reading a poll that may be malformed
def short(value, cap):
    """A string cut to cap characters, else None."""
    return value[:cap] if isinstance(value, str) else None


def dicts(value):
    """The dicts in a list (a null or malformed entry in a poll is skipped); [] for anything but a list."""
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def all_drives(summary):
    """Every drive record: drives.previous, then drives.current (even before its first play)."""
    drives = _dict(_dict(summary).get("drives"))
    cur = drives.get("current")
    return dicts(drives.get("previous")) + ([cur] if isinstance(cur, dict) else [])


def first_competition(summary):
    comps = _dict(_dict(summary).get("header")).get("competitions")
    return _dict(comps[0]) if isinstance(comps, list) and comps else {}


def hex_color(value):
    return "#" + value.lower() if isinstance(value, str) and COLOR_RE.fullmatch(value) else None


TEAM_TEXT_MAX, ID_MAX = 40, 20       # v1.4 (G1-12): a hostile summary overflowed the band with its team names


def teams_of(summary, game):
    """(teams, team_order) from the summary header: names, colors, logo URLs (C2). Never score, winner, record or
    linescores, which are final in a saved game. Without a summary: GAME, no colors, no logos. Names are text of at
    most TEAM_TEXT_MAX characters."""
    caller, out, order = game["offense"], {}, []
    comps = first_competition(summary).get("competitors")
    comps = [c for c in comps if isinstance(c, dict)] if isinstance(comps, list) else []
    for c in sorted(comps, key=lambda c: c.get("homeAway") != "away"):
        t = _dict(c.get("team"))
        abbr = t.get("abbreviation")
        if not (isinstance(abbr, str) and ABBR_RE.fullmatch(abbr)):
            continue
        tid = t.get("id")
        out[abbr] = {"abbr": abbr, "espn_id": _text(str(tid), ID_MAX) if isinstance(tid, (str, int)) else None,
                     "name": _text(t.get("name"), TEAM_TEXT_MAX), "location": _text(t.get("location"), TEAM_TEXT_MAX),
                     "display_name": _text(t.get("displayName"), TEAM_TEXT_MAX),
                     "home": c.get("homeAway") == "home", "caller": abbr == caller,
                     "side": "left" if abbr == caller else "right", "color": hex_color(t.get("color")),
                     "alt_color": hex_color(t.get("alternateColor")), "logo": f"/api/logo/{abbr}",
                     "logo_dark": f"/api/logo/{abbr}?v=dark"}
        order.append(abbr)
    if len(out) >= 2:
        return out, order
    home, away = (caller, game["opponent"]) if game.get("offense_is_home") else (game["opponent"], caller)
    return {a: {"abbr": a, "espn_id": None, "name": None, "location": None, "display_name": None, "home": a == home,
                "caller": a == caller, "side": "left" if a == caller else "right", "color": None, "alt_color": None,
                "logo": None, "logo_dark": None} for a in (away, home)}, [away, home]


# ---------------------------------------------------------------- v1.2: game facts for the scene
NIGHT_FROM_HOUR = 17               # a kickoff at 5 pm local or later is played under the lights
TEXT_MAX = 120
KICKOFF_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]{1,6})?)?"
                        r"(?:Z|[+-][0-9]{2}:[0-9]{2})")
# A venue's zone from ESPN's address: the main zone of a US state (a split state takes its biggest one), else the
# country's. Anything else is unknown, and an unknown local hour means 'night'.
US_ZONES = {"America/New_York": "CT DC DE FL GA IN KY MA MD ME MI NC NH NJ NY OH PA RI SC VA VT WV",
            "America/Chicago": "AL AR IA IL KS LA MN MO MS ND NE OK SD TN TX WI",
            "America/Denver": "CO ID MT NM UT WY", "America/Phoenix": "AZ", "America/Los_Angeles": "CA NV OR WA",
            "America/Anchorage": "AK", "Pacific/Honolulu": "HI"}
STATE_ZONE = {state: zone for zone, states in US_ZONES.items() for state in states.split()}
COUNTRY_ZONE = {"England": "Europe/London", "United Kingdom": "Europe/London", "Ireland": "Europe/Dublin",
                "Germany": "Europe/Berlin", "Spain": "Europe/Madrid", "France": "Europe/Paris",
                "Brazil": "America/Sao_Paulo", "Australia": "Australia/Melbourne", "Mexico": "America/Mexico_City"}
US_NAMES = (None, "USA", "United States")


def _text(value, cap=TEXT_MAX):
    """ESPN text, trimmed and capped at `cap` characters; None for anything that isn't a non-empty string."""
    return (value.strip()[:cap] or None) if isinstance(value, str) else None


def _flag(key, *sources):
    """The first real boolean (True or False) ESPN gives for `key`; None (unknown) when none does. 'no' or 1 is
    never read as one."""
    return next((s[key] for s in sources if isinstance(s.get(key), bool)), None)


def kickoff_of(value):
    """ESPN's kickoff (header.competitions[0].date, like '2026-10-09T00:15Z') as an aware UTC datetime, or None.
    A time with no zone can't be placed, so it is None too."""
    if not isinstance(value, str) or not KICKOFF_RE.fullmatch(value):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def venue_zone(address):
    """The ZoneInfo of a venue from ESPN's address, or None when it isn't known (or the system has no zone data)."""
    state, country = address.get("state"), address.get("country")
    if country in US_NAMES:                        # a US state code; 'WA' in Australia is never Seattle
        name = STATE_ZONE.get(state) if isinstance(state, str) else None
    else:
        name = COUNTRY_ZONE.get(country) if isinstance(country, str) else None
    if name is None:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def game_facts(summary):
    """Kickoff, venue and a light hint for the scene, from the header date and gameInfo.venue (falling back to the
    header's venue). Nothing that spoils: never a score, record, winner or result. light is 'night' when the local
    kickoff hour is NIGHT_FROM_HOUR or later or isn't known, else 'day'."""
    comp = first_competition(summary)
    venue, other = _dict(_dict(_dict(summary).get("gameInfo")).get("venue")), _dict(comp.get("venue"))
    address = _dict(venue.get("address")) or _dict(other.get("address"))
    kick = kickoff_of(comp.get("date"))
    zone = venue_zone(address) if kick else None
    local = kick.astimezone(zone) if zone else None
    return {"kickoff": kick.strftime("%Y-%m-%dT%H:%M:%SZ") if kick else None,
            "kickoff_local": local.isoformat() if local else None,
            "venue": _text(venue.get("fullName")) or _text(other.get("fullName")), "city": _text(address.get("city")),
            "indoor": _flag("indoor", venue, other), "grass": _flag("grass", venue, other),
            "light": "day" if local and local.hour < NIGHT_FROM_HOUR else "night"}


# ---------------------------------------------------------------- v1.2: ESPN's own box score (C4 shape)
COUNT_RE = re.compile(r"[0-9]{1,5}")
YARDS_RE = re.compile(r"-?[0-9]{1,5}")
PAIR_RE = {"/": re.compile(r"([0-9]{1,4})/([0-9]{1,4})"), "-": re.compile(r"([0-9]{1,4})-([0-9]{1,5})")}
TOP_RE = re.compile(r"([0-9]{1,2}):([0-5][0-9])")


def _number(shown, name, regex=COUNT_RE):
    value = shown[name]
    if not (isinstance(value, str) and regex.fullmatch(value)):
        raise ValueError(f"{name}: {str(value)[:20]!r}")
    return int(value)


def _pair(shown, name, sep):
    m = PAIR_RE[sep].fullmatch(shown[name]) if isinstance(shown[name], str) else None
    if not m:
        raise ValueError(f"{name}: {str(shown[name])[:20]!r}")
    return int(m.group(1)), int(m.group(2))


def _top_seconds(shown):
    m = TOP_RE.fullmatch(shown["possessionTime"]) if isinstance(shown["possessionTime"], str) else None
    if not m:
        raise ValueError(f"possessionTime: {str(shown['possessionTime'])[:20]!r}")
    return int(m.group(1)) * 60 + int(m.group(2))


def espn_team_box(stats):
    """One team's box from ESPN's statistics displayValues, or None if a field is missing or isn't the kind of number
    ESPN prints (KeyError, ValueError): then the derived box is the whole truth, never a mix."""
    shown = {}
    for st in stats if isinstance(stats, list) else []:
        if isinstance(st, dict) and isinstance(st.get("name"), str):
            shown.setdefault(st["name"], st.get("displayValue"))       # interceptions is listed twice
    try:
        comp, att = _pair(shown, "completionAttempts", "/")
        sacks, sack_yds = _pair(shown, "sacksYardsLost", "-")
        third, fourth, pens = (_pair(shown, k, "-") for k in ("thirdDownEff", "fourthDownEff", "totalPenaltiesYards"))
        top_s = _top_seconds(shown)
        return {"plays": _number(shown, "totalOffensivePlays"), "yards": _number(shown, "totalYards", YARDS_RE),
                "rush": {"att": _number(shown, "rushingAttempts"), "yds": _number(shown, "rushingYards", YARDS_RE)},
                "pass": {"comp": comp, "att": att, "net": _number(shown, "netPassingYards", YARDS_RE),
                         "int": _number(shown, "interceptions"), "sacks": sacks, "sack_yds": sack_yds},
                "first_downs": {"total": _number(shown, "firstDowns"), "rush": _number(shown, "firstDownsRushing"),
                                "pass": _number(shown, "firstDownsPassing"), "pen": _number(shown, "firstDownsPenalty")},
                "third": {"conv": third[0], "att": third[1]}, "fourth": {"conv": fourth[0], "att": fourth[1]},
                "turnovers": _number(shown, "turnovers"), "fumbles_lost": _number(shown, "fumblesLost"),
                "penalties": {"n": pens[0], "yds": pens[1]}, "top_s": top_s, "top": fmt_clock(top_s)}
    except (KeyError, ValueError):
        return None


def espn_box(summary, teams):
    """ESPN's own team stats ({abbr: box}, the derived box's shape) for exactly `teams`, or None unless every one of
    them parses. It is the final box in a saved game: the caller decides when it may be shown (never in Watch)."""
    out = {}
    for t in _dict(_dict(summary).get("boxscore")).get("teams") or []:
        abbr = _dict(_dict(t).get("team")).get("abbreviation")
        if isinstance(abbr, str) and abbr in teams and abbr not in out:
            out[abbr] = espn_team_box(t.get("statistics"))
    if sorted(out) != sorted(teams) or any(b is None for b in out.values()):
        return None
    return out

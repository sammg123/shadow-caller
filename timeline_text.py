"""Field math (data contract A3) and the play-text parsers (B6) behind the timeline: spots, penalties, kicks.

Pure: no Flask, no I/O. x = yards from the caller's own goal line; the caller attacks left to right.
"""
import re

from espn_feed import play_text
from live import parse_clock

# Gamebook abbreviations in play text -> ESPN abbreviations. A spot that doesn't resolve is never guessed.
TEAM_ALIASES = {"WAS": "WSH", "BLT": "BAL", "HST": "HOU", "ARZ": "ARI", "CLV": "CLE", "LA": "LAR", "JAC": "JAX",
                "SD": "LAC", "OAK": "LV", "STL": "LAR"}
SPOT = r"(?:([A-Z]{2,3}) (\d{1,2})|(50))"
SACK_SPOT_RE = re.compile(rf"\bsacked at {SPOT}")
INT_SPOT_RE = re.compile(rf"\bINTERCEPTED by .*?\bat {SPOT}")
RETURN_RE = re.compile(rf"\b(?:to|at) {SPOT} for (?:(-?\d+) yards?|no gain)")
RECOVERY_RE = re.compile(rf"\b(?:RECOVERED|recovered) by ([A-Z]{{2,3}})\b.*?\bat {SPOT}")
KICKOFF_DIST_RE = re.compile(r"\bkicks (?:onside )?(\d+) yards?", re.I)
PUNT_DIST_RE = re.compile(r"\bpunts (\d+) yards?", re.I)
FG_RE = re.compile(r"\b(\d+) yard field goal is (GOOD|No Good|BLOCKED)", re.I)
PEN_HEAD_RE = re.compile(r"PENALTY on ([A-Z]{2,3})(?:-[^,]*)?, ([^,]+),\s*")
PEN_YARDS_RE = re.compile(r"(\d+) yards?, enforced\b\s*")
PEN_SPOT_RE = re.compile(rf"at {SPOT}( - No Play)?")
TIMEOUT_BY_RE = re.compile(r"\bby ([A-Z]{2,3})\b")


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
def split_body(text):
    """The action before any penalty enforcement, and the whole corrected text."""
    full = play_text(text or "")
    return re.split(r"\bPENALTY on\b", full, maxsplit=1, flags=re.I)[0], full


def penalty_of(text, ctx):
    """The first foul in the text: on, foul, yards, at_x, no_play, status, note (B6.8)."""
    m = PEN_HEAD_RE.search(text)
    if not m:
        return None
    on, foul = resolve_team(m.group(1), ctx["teams"]), m.group(2).strip()
    rest = text[m.end():]
    out = {"on": on, "foul": foul, "yards": None, "at_x": None, "no_play": False, "status": "enforced",
           "note": f"{foul.lower()} on {m.group(1)}"}
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

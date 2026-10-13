"""What happened on one ESPN play, in the engine's terms (espn_feed re-exports all of it): the run gap and side, the
pass depth (air yards when ESPN gives yards after catch), sack, scramble, incomplete, touchdown, turnover, a flag that
wipes the play out, punts and field goals (classify), and the situation before or after it (situation). Pure: ESPN's
play is read, never trusted (a field of the wrong type reads as missing)."""
import math
import re

from live import parse_clock

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
# Air yards of an incompletion, from the gamebook word: median and interquartile range, nflverse 2026 weeks 1 to 5
# (65 games, pass attempts excluding sacks). Hard-coded for v1; build.py can write them into models/profile.json later.
AIR_EST = {"short": {"air": 5, "band": [1, 10], "n": 1049}, "deep": {"air": 23, "band": [19, 32], "n": 461}}
AIR_EST_SOURCE = "nflverse 2026 weeks 1-5 (65 games), pass attempts excluding sacks: median air yards, IQR as the band"


def _dict(value):
    return value if isinstance(value, dict) else {}


def whole_in(value, lo, hi):
    """value when it is a whole number (never a bool) from lo to hi, else None."""
    return value if isinstance(value, int) and not isinstance(value, bool) and lo <= value <= hi else None


def finite(value):
    """value when it is a finite number (never a bool), else None: a NaN would make JSON no browser reads."""
    ok = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    return value if ok else None


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

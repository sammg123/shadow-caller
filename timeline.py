"""Timeline of every applied play, both teams, for the 3D GameCast (docs/design/data-contract.md, sections A to D).

Pure: no Flask, no I/O (but a log line for a play it can't draw). Everything is derived on request from the ESPN
summary, the feed's applied ids (in apply order) and the engine state. Field frame (A): x = yards from the caller's own
goal line, the caller always attacks left to right, x from ESPN's yardLine (never yardsToEndzone). y is never sent:
there is no player tracking. The caller is GAME's offense; with both sides tracked (the engine's state lists its
`sides`, play-caller-models.md 7) the other offense's snaps are caller snaps too (offense_is_caller, a pred), drawn
right to left. The rows of hand-typed calls (D) and the link to the engine's log (B7) are in timeline_log.py.

v1.4 (G1-6): a poll can be malformed anywhere. Every field is read for the type it should have (a null entry is
skipped, a number that isn't one is unknown), and a row that still can't be built is left out and listed in
`missing`, so one bad play never fails the whole answer.
"""
import logging
import re

from espn_feed import AIR_EST, AIR_EST_SOURCE, _gain, classify, finite, iter_drive_plays, whole_in
from granular import FAMILIES, FAMILY_NAMES, LEAF_FAMILY, LEAF_NAMES, LEAVES
from live import fmt_clock
from timeline_text import (ABBR_RE, INT_SPOT_RE, RETURN_RE, SACK_SPOT_RE, TIMEOUT_BY_RE, _dict, _text, all_drives,
                           clamp_x, clock_seconds, dicts, dir_of, elapsed, espn_box, first_competition, game_facts,
                           goal_x, kick_facts, mm_ss, pat_of, penalty_of, resolve_team, search_x, short, split_body,
                           spot_x, teams_of, text_x, x_from_yardline, x_from_yl100, yl100_from_x)
from timeline_log import (AIR_BUCKET, AIR_BUCKET_SOURCE, is_flag, log_drives, log_rows, log_status, pred_of,
                          same_series)

log = logging.getLogger(__name__)

SCRIMMAGE = ("play", "penalty", "kneel", "spike", "other", "punt", "fg", "fg_miss")   # downs the offense snapped
OFFENSIVE_PLAYS = ("play", "kneel", "spike", "other", "fg", "fg_miss")                 # ESPN's offensivePlays
BOX_PLAYS = ("play", "kneel", "spike")
KICKS = ("kickoff", "punt", "fg", "fg_miss")
ADMIN_WHAT = (("official timeout", "official_timeout"), ("timeout", "timeout"), ("two-minute", "two_minute"),
              ("end of half", "end_half"), ("end of regulation", "end_half"), ("end of game", "end_game"),
              ("end period", "end_period"), ("coin toss", "coin_toss"), ("extra point", "pat"),
              ("two-point", "pat"), ("conversion", "pat"))
FIELD = {"units": "yd", "orientation": "caller_left", "x_min": -10, "x_max": 110, "width": 53.333,
         "goal_lines": [0, 100], "posts_x": [-10, 110], "hash_y": [23.583, 29.75]}
# What a row may carry from ESPN (G1-6, G1-12): text is capped, numbers must be numbers.
PLAY_TEXT_MAX, TYPE_MAX, CLOCK_MAX, WALL_MAX, RESULT_MAX, SCORE_MAX = 400, 40, 8, 40, 40, 999


# ---------------------------------------------------------------- B2-B6: one applied ESPN play as a row
def context(summary, caller, applied=(), tracked=None):
    """Per-game facts every row needs. Reads team names and ids, and win probability of applied plays only (E5).
    tracked: the offenses whose snaps are caller snaps (the caller's alone by default)."""
    comps = dicts(first_competition(summary).get("competitors"))
    ids, teams, home = {}, [], None
    groups = [(_dict(c.get("team")), c.get("homeAway")) for c in comps] + \
        [(_dict(d.get("team")), None) for d in all_drives(summary)]
    for t, side in groups:
        abbr, tid = t.get("abbreviation"), t.get("id")
        if not (isinstance(abbr, str) and ABBR_RE.fullmatch(abbr)):
            continue
        if abbr not in teams:
            teams.append(abbr)
        if isinstance(tid, (str, int)) and not isinstance(tid, bool):
            ids.setdefault(str(tid), abbr)
        if side == "home":
            home = abbr
    if caller not in teams:
        teams.append(caller)
    home = home or caller            # no header: take the caller as home, so x is ESPN's own yardLine
    wanted = set(applied)
    wp = {str(w.get("playId")): finite(w.get("homeWinPercentage")) for w in dicts(_dict(summary).get("winprobability"))
          if str(w.get("playId")) in wanted and finite(w.get("homeWinPercentage")) is not None}
    return {"caller": caller, "teams": teams, "home": home, "caller_is_home": home == caller, "ids": ids, "wp": wp,
            "tracked": tuple(tracked or (caller,))}


def other_team(ctx, team):
    return next((t for t in ctx["teams"] if t != team), None)


def kind_of(info, typ, text):
    """B4 kind from the parser's kind, split: kickoff and admin out of 'skip'; penalty, kneel, spike and other out
    of 'sync'; a punt or field goal wiped out by a flag keeps its kind (result.nullified says so)."""
    low, typ = text.lower(), typ.lower()
    k = info["kind"]
    if k in ("play", "punt", "fg", "fg_miss"):
        return k
    if k == "skip":
        return "kickoff" if "kickoff" in typ or re.search(r"\bkicks (?:onside )?\d+ yards?\b", low) else "admin"
    if "punt" in typ or re.search(r"\bpunts\b", low):
        return "punt"
    if "field goal" in typ or "field goal is" in low:
        return "fg" if re.search(r"field goal is good", low) else "fg_miss"
    if "kneels" in low:
        return "kneel"
    if "spiked" in low:
        return "spike"
    if "penalty on" in low and "aborted" not in low:
        return "penalty"
    return "other"


def admin_of(typ, text, ctx):
    low = typ.lower()
    what = next((w for key, w in ADMIN_WHAT if key in low), "other")
    if what == "other" and text.lstrip().upper().startswith("TWO-POINT CONVERSION"):
        what = "pat"
    m = TIMEOUT_BY_RE.search(text) if what == "timeout" else None
    return {"what": what, "by": resolve_team(m.group(1), ctx["teams"]) if m else None}


DOWN_TEXT_MAX = 40                 # '3rd & Goal at TB 4' and the like


def pre_of(st, x0, team, caller):
    down = whole_in(st.get("down"), 1, 4)
    togo = whole_in(st.get("distance"), 0, 99) if down else None
    yl = yl100_from_x(x0, team, caller)
    return {"down": down, "togo": togo, "yardline_100": yl, "goal_to_go": togo is not None and togo >= yl,
            "text": short(st.get("downDistanceText"), DOWN_TEXT_MAX)}


def post_of(en, ctx):
    """(post, x_next): the next snap after enforcement. Only an end spot with a down of 1 to 4 counts (A3)."""
    down, yl = whole_in(en.get("down"), 1, 4), whole_in(en.get("yardLine"), 0, 100)
    if down is None or yl is None:
        return None, None
    poss = ctx["ids"].get(str(_dict(en.get("team")).get("id")))
    x = x_from_yardline(yl, ctx["caller_is_home"])
    return ({"poss": poss, "down": down, "togo": whole_in(en.get("distance"), 0, 99),
             "yardline_100": yl100_from_x(x, poss, ctx["caller"]) if poss else None,
             "text": short(en.get("downDistanceText"), DOWN_TEXT_MAX)}, x)


def first_down_of(kind, pre, post, team, td, nullified, yards, pen, call):
    """(first_down, fd_by), B6.5."""
    if kind not in ("play", "penalty", "kneel", "spike", "other") or not pre or pre["down"] is None:
        return False, None
    fd = bool(td) or bool(post and post["poss"] == team and post["down"] == 1 and not same_series(pre, post))
    if not fd:
        return False, None
    defense_foul = bool(pen and pen["status"] == "enforced" and pen["on"] not in (None, team))
    fell_short = yards is not None and pre["togo"] is not None and yards < pre["togo"] and not td
    if nullified or kind == "penalty" or (defense_foul and fell_short):
        return True, "penalty"
    passed = call and call["family"] != "run" and call["outcome"] != "scramble"
    return True, "pass" if passed else "rush"


def play_geo(info, body, x0, d, yards, td_x, ctx):
    """(x_catch, x_end, air, air_src, approx) of a snap with a call (B5, B6.2, B6.4)."""
    air, air_src, approx, x_catch = info["air"], info["air_src"], [], None
    m_int = INT_SPOT_RE.search(body)
    if m_int:
        x_catch = text_x(m_int.groups()[-3:], ctx)
        if x_catch is not None and x0 is not None:
            air, air_src = (x_catch - x0) * d, "int_spot"
    elif air is not None and x0 is not None:
        x_catch = x0 + d * air
        if air_src in ("est", "yac_conflict"):
            approx.append("x_catch")
    if td_x is not None:
        x_end = td_x
    elif info["outcome"] == "sack":
        x_end = search_x(SACK_SPOT_RE, body, ctx)
        x_end = x0 + d * yards if x_end is None and x0 is not None else x_end
    elif m_int:
        ret = RETURN_RE.search(body[m_int.end():])
        x_end = text_x(ret.groups()[:3], ctx) if ret else x_catch
    else:
        x_end = None if x0 is None else x0 + d * (yards or 0)
    return x_catch, clamp_x(x_end), air, air_src, approx


def scrimmage_parts(ctx, info, kind, team, opp, body, x0):
    """geo pieces, call and yards for every scrimmage kind that isn't a kick."""
    d = dir_of(team, ctx["caller"])
    if kind == "play":
        yards = -info["yards"] if info["outcome"] == "sack" else info["yards"]
        turnover_td = info["turnover"] and "TOUCHDOWN" in body.upper()
        td_x = goal_x(team, ctx["caller"]) if info["td"] else (goal_x(opp, ctx["caller"]) if turnover_td else None)
        x_catch, x_end, air, air_src, approx = play_geo(info, body, x0, d, yards, td_x, ctx)
        call = {"family": info["family"], "leaf": info["leaf"], "outcome": info["outcome"], "depth": info["depth"],
                "air": air, "air_src": air_src, "air_band": info["air_band"], "yac": info["yac"],
                "align": info["align"]}
        geo = {"x_catch": x_catch, "x_end": x_end, "lat": info["lat"], "gap": info["gap"], "approx": approx}
        return geo, call, yards
    yards = None if kind == "penalty" else _gain(body)
    x_end = x0 if x0 is None or kind == "penalty" else clamp_x(x0 + d * (yards or 0))
    return {"x_catch": None, "x_end": x_end, "lat": None, "gap": None, "approx": []}, None, yards


def turnover_of(kind, info, body, kick):
    """(turnover, turnover_kind). Kicks decide from the text: ESPN's isTurnover is false on a lost kickoff fumble."""
    if kind == "play":
        lost = info["turnover"]
    elif kind in KICKS and kick:
        lost = bool(kick["fumble_rec"] and kick["fumble_rec"]["team"] == kick["by"])
    else:
        lost = False
    if not lost:
        return False, None
    return True, "int" if "INTERCEPTED" in body.upper() else "fumble"


def kick_parts(ctx, row, info, body, full, x0):
    """(geo pieces, kick, td) of a kick. A return TD ends at the returner's goal line."""
    kind, team, opp = row["kind"], row["team"], row["opp"]
    kick, end = kick_facts(kind, team, opp, body, full, x0, ctx)
    returner = team if kind == "kickoff" else opp
    td = "TOUCHDOWN" in body.upper() and not info["nullified"] and kind != "fg"
    geo = {"x_catch": None, "x_end": goal_x(returner, ctx["caller"]) if td else end, "lat": None, "gap": None,
           "approx": []}
    return geo, kick, td


def result_of(row, info, body, full, yards, td, ctx):
    kind, team, pre, post = row["kind"], row["team"], row["pre"], row["post"]
    pen, nullified = penalty_of(full, ctx), info["nullified"]
    turnover, tkind = turnover_of(kind, info, body, row["kick"])
    fd, fd_by = first_down_of(kind, pre, post, team, td, nullified, yards, pen, row["call"])
    downs = (kind == "play" and not nullified and (pre or {}).get("down") == 4 and not td and not turnover
             and bool(post) and post["poss"] not in (None, team))
    return {"yards": yards, "first_down": fd, "fd_by": fd_by, "td": bool(td), "turnover": turnover,
            "turnover_kind": tkind, "downs": downs, "safety": False, "nullified": nullified, "penalty": pen}


_UNDRAWABLE = set()                 # play ids already logged as impossible to draw (one warning each)


def build_row_safely(ctx, team, drive, p):
    """build_row, or None when ESPN's play is malformed in a way nothing reads: the play is left out of the rows (so
    `missing` lists it) and the server log says why, once per play."""
    try:
        return build_row(ctx, team, drive, p)
    except Exception:
        pid = row_id(p)
        if pid not in _UNDRAWABLE and len(_UNDRAWABLE) < 10_000:
            _UNDRAWABLE.add(pid)
            log.warning("ESPN play %s can't be drawn; it is listed in the timeline's missing plays.", pid,
                        exc_info=True)
        return None


def build_row(ctx, team, drive, p):
    """One applied ESPN play as a timeline row (B2), without seq and pred, and before finish_row adds the fields
    that need the previous row (scoring, safety, wp.delta)."""
    caller, info = ctx["caller"], classify(team, p)
    body, full = split_body(p.get("text"))
    typ = _text(_dict(p.get("type")).get("text"), TYPE_MAX) or ""
    kind = kind_of(info, typ, full)
    st, en = _dict(p.get("start")), _dict(p.get("end"))
    qtr = whole_in(_dict(p.get("period")).get("number"), 1, 9)
    clock = short(_dict(p.get("clock")).get("displayValue"), CLOCK_MAX)
    yard_line = whole_in(st.get("yardLine"), 0, 100)
    x0 = None if yard_line is None else x_from_yardline(yard_line, ctx["caller_is_home"])
    row = {"id": row_id(p), "espn_seq": seq_number(p), "src": "espn",
           "drive": drive[0], "drive_id": drive[1], "team": team, "opp": other_team(ctx, team),
           "offense_is_caller": team in ctx["tracked"] and kind in SCRIMMAGE, "kind": kind, "type": typ or None,
           "qtr": qtr, "clock": clock, "clock_s": clock_seconds(clock), "t": elapsed(qtr, clock_seconds(clock)),
           "wall": short(p.get("wallclock"), WALL_MAX), "pre": None, "post": None, "geo": None, "call": None,
           "result": None, "kick": None, "score": score_of(p, ctx), "scoring": None, "wp": wp_of(row_id(p), ctx),
           "text": play_words(p.get("text"))}
    if kind == "admin":
        row["admin"] = admin_of(typ, full, ctx)
        if row["admin"]["what"] not in ("end_period", "end_half", "end_game", "other"):
            row["post"] = post_of(en, ctx)[0]
        return row
    row["post"], x_next = post_of(en, ctx)
    if kind != "kickoff" and x0 is not None:
        row["pre"] = pre_of(st, x0, team, caller)
    if kind in KICKS:
        (geo, row["kick"], td), call, yards = kick_parts(ctx, row, info, body, full, x0), None, None
    else:
        (geo, call, yards), td = scrimmage_parts(ctx, info, kind, team, row["opp"], body, x0), info["td"]
    row["geo"] = {"dir": dir_of(team, caller), "x0": x0, "x_end": geo["x_end"], "x_next": x_next,
                  "x_catch": geo["x_catch"], "lat": geo["lat"], "gap": geo["gap"], "approx": geo["approx"]}
    row["call"] = call
    row["result"] = result_of(row, info, body, full, yards, td, ctx)
    return row


def row_id(p):
    return str(p.get("id"))


def seq_number(p):
    """ESPN's sequenceNumber as an int (it comes as text); 0 when it isn't one."""
    try:
        return int(p.get("sequenceNumber") or 0)
    except (TypeError, ValueError, OverflowError):
        return 0


def play_words(text):
    """ESPN's play text as sent to the page: text only, at most PLAY_TEXT_MAX characters (G1-12)."""
    return text[:PLAY_TEXT_MAX] if isinstance(text, str) else ""


def score_of(p, ctx):
    h, a = whole_in(p.get("homeScore"), 0, SCORE_MAX), whole_in(p.get("awayScore"), 0, SCORE_MAX)
    away = other_team(ctx, ctx["home"])
    if h is None or a is None or away is None:
        return None
    return {ctx["home"]: h, away: a}


def wp_of(pid, ctx):
    home = ctx["wp"].get(pid)
    if home is None:
        return None
    return {"home": home, "caller": home if ctx["caller_is_home"] else round(1 - home, 4), "delta": None}


def scoring_of(r, team, pts):
    """B6.6: the side whose score went up scores, whoever had the ball."""
    up = r["text"].upper()
    if r["kind"] == "fg" and pts == 3:
        typ = "FG"
    elif "SAFETY" in up and pts == 2:
        typ = "SF"
    elif "TOUCHDOWN" in up and pts >= 6:
        typ = "TD"
    elif pts == 2 and team != r["team"]:
        typ = "D2P"
    else:
        typ = "PAT" if pts in (1, 2) else None     # a try ESPN posted as its own play (not seen in 2026 data)
    return {"team": team, "type": typ, "pts": pts, "pat": pat_of(r["text"]) if typ == "TD" else None}


def finish_row(r, prev_score, last_wp):
    """Fields that compare with the previous applied row in ESPN order: scoring, safety, wp.delta."""
    if r["score"] and prev_score:
        ups = [(t, pts - prev_score.get(t, 0)) for t, pts in r["score"].items() if pts > prev_score.get(t, 0)]
        if ups:
            team, pts = max(ups, key=lambda u: u[1])
            r["scoring"] = scoring_of(r, team, pts)
            if r["result"] and r["scoring"]["type"] == "SF":
                r["result"]["safety"] = True
    if r["wp"] and last_wp is not None:
        r["wp"]["delta"] = round(r["wp"]["caller"] - last_wp, 4)


def wp_start(summary):
    """ESPN's opening win probability: the one entry whose playId is no play (B6.7)."""
    ids = {row_id(p) for t, i, d, p in iter_drive_plays(summary)}
    for w in dicts(_dict(summary).get("winprobability")):
        if str(w.get("playId")) not in ids:
            return finite(w.get("homeWinPercentage"))
    return None


def build_timeline(summary, applied, log, caller, cache=None, tracked=None):
    """Rows for the applied ESPN plays in apply order (B1), with pred from the engine log (B7).
    cache: {play id: row} that the caller keeps for one epoch; a row is frozen the first time it is built (F3).
    pred is attached fresh on every call, so a retag shows up while the drawing stays ESPN's.
    tracked: the offenses whose snaps are caller snaps (the caller's alone by default)."""
    cache = {} if cache is None else cache
    ctx = context(summary, caller, applied, tracked)
    plays = {row_id(p): (team, (idx, did), p) for team, idx, did, p in iter_drive_plays(summary)}
    built = []
    for seq, pid in enumerate(applied, start=1):
        r = cache.get(pid)
        if r is None and pid in plays:
            team, drive, p = plays[pid]
            r = build_row_safely(ctx, team, drive, p)
        if r is not None:
            built.append((seq, r))
    wp0 = wp_start(summary)
    prev_score = {t: 0 for t in ctx["teams"]}
    last_wp = None if wp0 is None else (wp0 if ctx["caller_is_home"] else round(1 - wp0, 4))
    for seq, r in sorted(built, key=lambda sr: (sr[1]["espn_seq"], sr[0])):
        if r["id"] not in cache:
            finish_row(r, prev_score, last_wp)
            cache[r["id"]] = r
        prev_score = r["score"] or prev_score
        last_wp = r["wp"]["caller"] if r["wp"] else last_wp
    preds = {r["espn_id"]: pred_of(r) for r in log if r.get("espn_id")}
    return [{"seq": seq, **r, "pred": preds.get(r["id"])} for seq, r in built]


# ---------------------------------------------------------------- C3: drives
def espn_drives(summary):
    return {str(d["id"]): d for d in all_drives(summary)
            if isinstance(d.get("id"), (str, int)) and not isinstance(d.get("id"), bool)}


def ends_possession(r, team):
    if r["kind"] == "admin":
        return r["admin"]["what"] in ("end_half", "end_game")
    if r["scoring"] or (r["kind"] in ("punt", "fg", "fg_miss") and not r["result"]["nullified"]):
        return True
    return bool(r["post"] and r["post"]["poss"] not in (None, team))


def derived_result(rs):
    """A drive result from its rows, for a drive ESPN hasn't closed yet (live) or manual mode."""
    for r in reversed(rs):
        res = r.get("result") or {}
        if r["kind"] == "admin" and r["admin"]["what"] in ("end_half", "end_game"):
            return "END OF GAME" if r["admin"]["what"] == "end_game" else "END OF HALF"
        if r["scoring"] and r["scoring"]["type"] in ("TD", "FG", "SF"):
            return {"SF": "SAFETY"}.get(r["scoring"]["type"], r["scoring"]["type"])
        if r["kind"] == "punt" and not res.get("nullified"):
            return "PUNT"
        if r["kind"] == "fg_miss" and not res.get("nullified"):
            return "MISSED FG"
        if res.get("turnover"):
            return "INT" if res.get("turnover_kind") == "int" else "FUMBLE"
        if res.get("downs"):
            return "DOWNS"
    return None


def final_x(rs, snaps, td, ended, end_x, team, caller):
    """Where the drive's yards are measured to (C3)."""
    last = snaps[-1]
    if td:
        return goal_x(team, caller)
    if not ended:
        return next((r["geo"]["x_next"] for r in reversed(rs) if r["geo"] and r["geo"]["x_next"] is not None),
                    last["geo"]["x_end"])
    res = last["result"]
    if last["kind"] in ("punt", "fg", "fg_miss") or res["turnover"] or res["downs"]:
        return end_x
    if last["kind"] == "penalty" or res["nullified"]:
        return last["geo"]["x_next"] if last["geo"]["x_next"] is not None else last["geo"]["x0"]
    return last["geo"]["x_end"]


def kickoff_spot(kick):
    """Where a drive with no snaps yet starts: the end of the return, else the next spot (a touchback)."""
    if not kick:
        return None
    for x in (kick["kick"]["ret_end_x"], kick["geo"]["x_next"], kick["geo"]["x_end"]):
        if x is not None:
            return x
    return None


def drive_of(idx, rs, later, ed, caller, tracked=None):
    rs = sorted(rs, key=lambda r: r["espn_seq"])
    team = rs[0]["team"]
    snaps = [r for r in rs if r["kind"] in SCRIMMAGE and r["geo"]]
    kick = next((r for r in rs if r["kind"] == "kickoff" and r["kick"]), None)
    start_x = snaps[0]["geo"]["x0"] if snaps else kickoff_spot(kick)
    td = any(r["scoring"] and r["scoring"]["type"] == "TD" and r["scoring"]["team"] == team for r in rs)
    ended = later or any(ends_possession(r, team) for r in rs)
    end_x = goal_x(team, caller) if td else (snaps[-1]["geo"]["x0"] if snaps else start_x)
    x_fin = final_x(rs, snaps, td, ended, end_x, team, caller) if snaps else start_x
    out = {"idx": idx, "id": rs[0]["drive_id"], "team": team, "offense_is_caller": team in (tracked or (caller,)),
           "start": {"qtr": rs[0]["qtr"], "clock": rs[0]["clock"], "x": start_x}, "end": None,
           "plays": sum(1 for r in rs if r["kind"] in OFFENSIVE_PLAYS and not r["result"]["nullified"]),
           "yards": (x_fin - start_x) * dir_of(team, caller) if None not in (x_fin, start_x) else None,
           "time": None, "time_s": None, "result": None, "result_text": None, "complete": ended,
           "seq": [min(r["seq"] for r in rs), max(r["seq"] for r in rs)],
           "engine_drive": next((r["pred"]["engine_drive"] for r in rs if r.get("pred")), None)}
    if ended:                        # ESPN's drive totals are read only once the drive is over (E5)
        over = any(r["kind"] == "admin" and r["admin"]["what"] in ("end_half", "end_game") for r in rs)
        end = _dict(ed.get("end"))
        clock = short(_dict(end.get("clock")).get("displayValue"), CLOCK_MAX)
        out["end"] = {"qtr": whole_in(_dict(end.get("period")).get("number"), 1, 9) or rs[-1]["qtr"],
                      "clock": "0:00" if over or not clock else clock, "x": end_x}
        out["time"] = short(_dict(ed.get("timeElapsed")).get("displayValue"), CLOCK_MAX)
        out["time_s"] = mm_ss(out["time"])
        out["result"] = _text(ed.get("result"), RESULT_MAX) or derived_result(rs)
        out["result_text"] = _text(ed.get("displayResult"), RESULT_MAX) or out["result"]
    return out


def drives(rows, summary, caller, tracked=None):
    """Every drive with an applied row, in ESPN order (C3)."""
    espn, groups = espn_drives(summary), {}
    for r in rows:
        groups.setdefault(r["drive"], []).append(r)
    order = sorted(groups)
    return [drive_of(idx, groups[idx], i < len(order) - 1, espn.get(groups[idx][0]["drive_id"]) or {}, caller, tracked)
            for i, idx in enumerate(order)]


# ---------------------------------------------------------------- C4: box score from rows
def empty_box():
    return {"plays": 0, "yards": 0, "rush": {"att": 0, "yds": 0},
            "pass": {"comp": 0, "att": 0, "net": 0, "int": 0, "sacks": 0, "sack_yds": 0},
            "first_downs": {"total": 0, "rush": 0, "pass": 0, "pen": 0}, "third": {"conv": 0, "att": 0},
            "fourth": {"conv": 0, "att": 0}, "turnovers": 0, "fumbles_lost": 0, "penalties": {"n": 0, "yds": 0},
            "top_s": 0, "top": "0:00"}


def count_snap(b, r, res):
    """Rushes, passes and sacks of one counted row (non-nullified play, kneel, spike)."""
    call, yards = r["call"] or {}, res["yards"] or 0
    if r["kind"] == "kneel" or call.get("family") == "run" or call.get("outcome") == "scramble":
        b["rush"]["att"] += 1
        b["rush"]["yds"] += yards
    elif call.get("outcome") == "sack":
        b["pass"]["sacks"] += 1
        b["pass"]["sack_yds"] -= yards
    else:
        b["pass"]["att"] += 1
        if res["turnover_kind"] == "int":
            b["pass"]["int"] += 1
        elif r["kind"] != "spike" and call.get("outcome") != "incomplete":
            b["pass"]["comp"] += 1
            b["pass"]["net"] += yards
    down = (r["pre"] or {}).get("down")
    if down in (3, 4):
        key = "third" if down == 3 else "fourth"
        b[key]["att"] += 1
        b[key]["conv"] += int(res["first_down"] or res["td"])


def add_to_box(out, r):
    res = r.get("result")
    if not res:
        return
    pen = res["penalty"]
    if pen and pen.get("status") == "enforced" and pen.get("on") in out:
        out[pen["on"]]["penalties"]["n"] += 1
        out[pen["on"]]["penalties"]["yds"] += pen.get("yards") or 0
    if res["turnover"]:
        loser = r["opp"] if r["kind"] == "punt" else r["team"]       # a kick's receiver loses it
        if loser in out:
            out[loser]["turnovers"] += 1
            out[loser]["fumbles_lost"] += int(res["turnover_kind"] == "fumble")
    b = out.get(r["team"])
    if b is None:
        return
    if res["first_down"]:
        b["first_downs"]["total"] += 1
        b["first_downs"][{"penalty": "pen"}.get(res["fd_by"], res["fd_by"])] += 1
    if r["kind"] in BOX_PLAYS and not res["nullified"]:
        count_snap(b, r, res)


def box(rows, drives_, teams):
    """Team stats derived from applied rows (C4). Equal to ESPN's final box score on TB at DAL."""
    out = {t: empty_box() for t in teams}
    for r in rows:
        add_to_box(out, r)
    for d in drives_:
        if d["team"] in out and d["complete"] and d["time_s"]:
            out[d["team"]]["top_s"] += d["time_s"]
    if drives_ and not drives_[-1]["complete"] and drives_[-1]["team"] in out:
        rs = [r for r in rows if r["drive"] == drives_[-1]["idx"] and r["t"] is not None]
        if rs:
            out[drives_[-1]["team"]]["top_s"] += max(0, rows[-1]["t"] - rs[0]["t"]) if rows[-1]["t"] is not None else 0
    for b in out.values():
        b["pass"]["net"] -= b["pass"]["sack_yds"]
        b["plays"] = b["rush"]["att"] + b["pass"]["att"] + b["pass"]["sacks"]
        b["yards"] = b["rush"]["yds"] + b["pass"]["net"]
        b["top"] = fmt_clock(b["top_s"])
    return out


# ---------------------------------------------------------------- C5: status
def half_of(qtr):
    return (1 if qtr <= 2 else 2) if isinstance(qtr, int) and qtr <= 4 else qtr


def ball_of(rows, caller):
    """(poss, down_text, ball_x, ball_kind) from the newest row that says where the ball is."""
    for r in reversed(rows):
        if r["kind"] == "admin" and r["admin"]["what"] in ("end_half", "end_game"):
            return None, None, None, None
        sc = r["scoring"]
        if sc:
            if sc["type"] == "SF":       # the team scored on free-kicks from its own 20
                kicker = next((t for t in (r["score"] or {}) if t != sc["team"]), None)
                return kicker, None, spot_x(kicker, 20, caller) if kicker else None, "kickoff"
            return sc["team"], None, spot_x(sc["team"], 35, caller), "kickoff"
        post = r["post"]
        if post:
            known = post["poss"] and post["yardline_100"] is not None
            x = x_from_yl100(post["yardline_100"], post["poss"], caller) if known else None
            return post["poss"], post["text"], x, "snap"
    return None, None, None, None


def status(rows, caller, teams=()):
    """The game right now, from applied rows only (C5). Never read from ESPN's header."""
    teams = list(teams) or list(dict.fromkeys(t for r in rows for t in (r["team"], r["opp"]) if t))
    if not rows:
        return {"state": "pre", "qtr": None, "clock": None, "poss": None, "score": {t: 0 for t in teams},
                "down_text": None, "ball_x": None, "ball_kind": None, "timeouts": {t: 3 for t in teams},
                "last_seq": 0, "wp_home": None}
    last = rows[-1]
    over = any(r["kind"] == "admin" and r["admin"]["what"] == "end_game" for r in rows)
    poss, text, ball_x, ball_kind = (None, None, None, None) if over else ball_of(rows, caller)
    half = half_of(last["qtr"])
    used = {t: sum(1 for r in rows if r["kind"] == "admin" and r["admin"]["what"] == "timeout"
                   and r["admin"]["by"] == t and half_of(r["qtr"]) == half) for t in teams}
    return {"state": "post" if over else "in", "qtr": last["qtr"], "clock": last["clock"], "poss": poss,
            "score": next((r["score"] for r in reversed(rows) if r["score"]), {t: 0 for t in teams}),
            "down_text": text, "ball_x": ball_x, "ball_kind": ball_kind,
            "timeouts": {t: max(0, 3 - used[t]) for t in teams}, "last_seq": last["seq"],
            "wp_home": next((r["wp"]["home"] for r in reversed(rows) if r["wp"]), None)}


# ---------------------------------------------------------------- A1: field, meta (C2 teams: timeline_text)
def field_of(game, home):
    rest = {k: v for k, v in FIELD.items() if k not in ("units", "orientation")}
    return {"units": FIELD["units"], "orientation": FIELD["orientation"], "left_team": game["offense"],
            "right_team": game["opponent"], "home": home, **rest}


def meta():
    return {"leaves": list(LEAVES), "families": list(FAMILIES), "leaf_names": dict(LEAF_NAMES),
            "family_names": dict(FAMILY_NAMES), "leaf_family": dict(LEAF_FAMILY),
            "air_est": {**{k: dict(v) for k, v in AIR_EST.items()}, "source": AIR_EST_SOURCE},
            "air_bucket": {**{k: dict(v) for k, v in AIR_BUCKET.items()}, "source": AIR_BUCKET_SOURCE}}


# ---------------------------------------------------------------- D: manual mode (its rows and drives: timeline_log)
def tracked_of(state, game):
    """The offenses whose snaps are caller snaps: the engine's sides when it lists them, else GAME's offense."""
    return tuple(state.get("sides") or (game["offense"],))


def log_status_at(rows, game):
    """Manual mode as of an earlier row (until): its clock, the score after it, and the ball where its drive goes on
    (null when the drive ended there). Same keys as log_status."""
    caller, opp = game["offense"], game["opponent"]
    if not rows:
        return {**status([], caller, (opp, caller)), "clock_est": False, "timeouts": None}
    r, post = rows[-1], rows[-1]["post"]
    return {"state": "in", "qtr": r["qtr"], "clock": r["clock"], "clock_est": r["clock_est"],
            "poss": r["team"] if post else None, "score": r["score"], "down_text": post["text"] if post else None,
            "ball_x": r["geo"]["x_next"] if post else None, "ball_kind": "snap" if post else None,
            "timeouts": None, "last_seq": r["seq"], "wp_home": None}


# ---------------------------------------------------------------- C1: the /api/timeline body
def source_of(summary, applied):
    """'espn' once there is a summary and at least one applied play for this game, else 'log' (D)."""
    return "espn" if summary and applied else "log"


def up_to(rows, upto):
    """The rows with seq <= upto; all of them when upto is None."""
    return rows if upto is None else [r for r in rows if r["seq"] <= upto]


def espn_part(summary, applied, log, game, order, *, upto, cache, skipped, tracked=None):
    """Rows, drives, box and status of the ESPN timeline as of seq `upto` (None: now), plus the lists that say what
    can't be drawn: `skipped` (applies that failed; a caller snap among them has no prediction) and `missing`
    (applied ids the summary no longer has: ESPN dropped or re-id'd the play)."""
    caller = game["offense"]
    rows = up_to(build_timeline(summary, applied, log, caller, cache, tracked), upto)
    ds = drives(rows, summary, caller, tracked)
    drawn, failed = {r["id"] for r in rows}, set(skipped)
    return {"rows": rows, "drives": ds, "box": box(rows, ds, order), "status": status(rows, caller, order),
            "wp_start": wp_start(summary),
            "unlinked": [r["seq"] for r in log if not r.get("espn_id") and not is_flag(r)],
            "skipped": [r["seq"] for r in rows if r["id"] in failed],
            "missing": [pid for pid in applied[:upto] if pid not in drawn]}


def log_part(state, game, *, upto):
    """The manual timeline (D) as of seq `upto` (None: now). A drive that goes on past upto is still in progress
    there, and the status is the one right after that row. The box has the tracked offenses."""
    every = log_rows(state, game)
    rows = up_to(every, upto)
    ds = log_drives(rows, state, game, cut={r["drive"] for r in every if upto is not None and r["seq"] > upto})
    bx = {t: {**b, "top_s": None, "top": None} for t, b in box(rows, ds, list(tracked_of(state, game))).items()}
    st = log_status(state, game) if upto is None else log_status_at(rows, game)
    return {"rows": rows, "drives": ds, "box": bx, "status": st, "wp_start": None, "unlinked": [], "skipped": [],
            "missing": []}


def espn_box_now(summary, applied, mode, order):
    """ESPN's own box score (v1.2), only when it can't spoil and counts exactly the plays on the field: never in
    Watch mode, and only once every play the summary has is applied (a watch stopped part way leaves a finished
    game on screen, and its final box would run ahead of the field). None otherwise, or when it doesn't parse."""
    if mode == "watch":
        return None
    have = set(applied)
    if any(row_id(p) not in have for t, i, d, p in iter_drive_plays(summary)):
        return None
    return espn_box(summary, order)


def response(summary, applied, state, game, *, epoch, mode, since=0, until=None, client_epoch=None, cache=None,
             skipped=()):
    """Everything GET /api/timeline?since=&until=&epoch= returns (C1). Pure: reads its inputs, writes only `cache`
    ({play id: frozen row} for this epoch). A missing or different epoch, or since past the end, answers as
    since=0 with reset true; field, teams, team_order, meta and game come only then.
    until (v1.2, ui-architecture Appendix B #8; the caller checks until >= since): the timeline as of that seq.
    n is min(until, applied rows), rows run since < seq <= n, and drives, status and box are as of row n.
    box_espn (v1.2) is ESPN's own box score, sent only by espn_box_now() and never with an until short of now;
    box_source says which box the UI should show. Beyond C1, `skipped` and `missing` (espn_part) say what can't
    be drawn, so nothing fails quietly. The engine's sides (state["sides"], both offenses tracked) are caller rows,
    drives and preds; the field frame stays GAME's offense's."""
    caller, log = game["offense"], state.get("log") or []
    teams, order = teams_of(summary, game)
    source = source_of(summary, applied)
    total = len(applied) if source == "espn" else len(log)
    reset = client_epoch != epoch or since > total
    since = 0 if reset else since
    n = total if until is None else min(until, total)
    upto = None if n == total else n
    part = (espn_part(summary, applied, log, game, order, upto=upto, cache=cache, skipped=skipped,
                      tracked=tracked_of(state, game)) if source == "espn" else log_part(state, game, upto=upto))
    box_espn = espn_box_now(summary, applied, mode, order) if source == "espn" and upto is None else None
    out = {"epoch": epoch, "n": n, "since": since, "reset": reset, "source": source, "mode": mode,
           "rows": [r for r in part["rows"] if r["seq"] > since], "drives": part["drives"], "status": part["status"],
           "box": part["box"], "box_espn": box_espn, "box_source": "espn" if box_espn else "derived",
           **{k: part[k] for k in ("wp_start", "unlinked", "skipped", "missing")}}
    if until is not None:
        out["until"] = n
    if since == 0:
        home = next((t for t, v in teams.items() if v["home"]), caller)
        out.update(field=field_of(game, home), teams=teams, team_order=order, meta=meta(), game=game_facts(summary))
    return out

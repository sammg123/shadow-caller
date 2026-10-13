"""The timeline of hand-typed calls (docs/design/data-contract.md D) and the link from a timeline row to the engine's
log (B7): rows, drives and the status built from GameEngine's log when no ESPN play is applied.

Each logged row is its offense's: the row's `team`, or GAME's offense for a game saved before rows said whose they
were. Rows are drawn in the field frame (A): x is yards from GAME's offense's own goal line, so a row of the other
offense attacks right to left. Pure: no Flask, no I/O.
"""
from granular import FAMILIES, LEAVES
from live import PENALTIES, fmt_clock
from timeline_text import clamp_x, clock_seconds, dir_of, down_text, elapsed, goal_x, score_pair, x_from_yl100

# Manual mode has only the depth bucket: median and IQR of air yards per bucket, nflverse 2026 weeks 1 to 5.
AIR_BUCKET = {"short": {"air": 3, "band": [-1, 5], "n": 2847}, "mid": {"air": 14, "band": [12, 16], "n": 923},
              "deep": {"air": 26, "band": [22, 35], "n": 513}}
AIR_BUCKET_SOURCE = "nflverse 2026 weeks 1-5: median air yards per depth bucket, IQR as the band"
LEAF_SIDE = {"run_ot_left": "left", "run_edge_left": "left", "run_inside": "middle", "run_ot_right": "right",
             "run_edge_right": "right"}
DRIVE_END_RESULT = {"punt": "PUNT", "fg": "FG", "fg_miss": "MISSED FG", "half": "END OF HALF"}


# ---------------------------------------------------------------- B6.5 and B7: shared with the ESPN timeline
def same_series(pre, post):
    """A first down that didn't move the chains: 1st & 8 at the 8 becoming 1st & 4 at the 4 (B6.5)."""
    vals = (pre["togo"], pre["yardline_100"], post["togo"], post["yardline_100"])
    if pre["down"] != 1 or None in vals:
        return False
    return post["togo"] == pre["togo"] - (pre["yardline_100"] - post["yardline_100"])


PRED_KEYS = ("p", "p_league", "p_habits", "flag", "top_leaf", "top_leaf_p")
CALL_KEYS = ("fam_top", "family", "leaf", "outcome", "name", "fam_p", "fam_p_league", "leaf_p", "leaf_p_league",
             "leaf_rank", "leaf_rank_league", "dropback", "success")


def pred_of(r):
    """A log row projected with the same key names, plus top3 and the tree as arrays in canonical order, and whose
    call it was (team, caller)."""
    tree = r.get("tree") or {}
    his_l = tree.get("his_l") or {}
    dist = None
    if all(k in tree for k in ("his_f", "lg_f", "his_l", "lg_l")):
        dist = {k: [tree[k].get(x) for x in (FAMILIES if k.endswith("_f") else LEAVES)]
                for k in ("his_f", "lg_f", "his_l", "lg_l")}
    return {"log_seq": r.get("seq"), "snap": r.get("snap"), "engine_drive": r.get("drive"),
            **{k: r.get(k) for k in PRED_KEYS},
            "top3": sorted(LEAVES, key=lambda k: -his_l.get(k, 0.0))[:3] if his_l else None,
            **{k: r.get(k) for k in CALL_KEYS}, "retagged": bool(r.get("retagged")), "dist": dist,
            "team": r.get("team"), "caller": r.get("caller")}


# ---------------------------------------------------------------- D: rows
def offense_of(r, game):
    """(offense, defense) of a logged row: its team, else GAME's offense (a game saved before rows said so)."""
    team = r.get("team") or game["offense"]
    return team, game["opponent"] if team == game["offense"] else game["offense"]


def log_call(r):
    leaf = r.get("leaf")
    bucket = leaf.split("_")[1] if leaf and leaf.startswith(("dropback_", "pa_")) else None
    est = AIR_BUCKET.get(bucket)
    return {"family": r.get("family"), "leaf": leaf, "outcome": r.get("outcome"), "depth": bucket,
            "air": est["air"] if est else None, "air_src": "bucket" if est else None,
            "air_band": list(est["band"]) if est else None, "yac": None, "align": r.get("align")}


def is_flag(r):
    """A foul typed with no play logged (v1.4, G1-4): a timeline row of kind 'penalty', never a snap."""
    return r.get("kind") == "penalty"


def enforced_spot(r):
    """Where a hand-typed foul put the ball: (down, togo, yardline_100); None when the drive ended there. Only for
    rows that have yardline_after: the others (ESPN's no-plays, games saved before v1.4) take the next row's spot."""
    yl = r["yardline_after"]
    return None if yl is None else (r.get("down_after"), r.get("togo_after"), yl)


def log_pre_post(r, same, team, opp):
    pre = {"down": r["down"], "togo": r["togo"], "yardline_100": r["yardline_100"],
           "goal_to_go": r["togo"] >= r["yardline_100"],
           "text": down_text(r["down"], r["togo"], r["yardline_100"], team, opp)}
    if "yardline_after" in r:
        nxt = enforced_spot(r)
    else:
        nxt = (same["down"], same["togo"], same["yardline_100"]) if same else None
    if nxt is None:
        return pre, None
    down, togo, yl = nxt
    return pre, {"poss": team, "down": down, "togo": togo, "yardline_100": yl,
                 "text": down_text(down, togo, yl, team, opp)}


def log_geo(r, post, call, team, caller):
    """Manual geometry: x0 from the offense's yardline_100, x_end from the yards along its direction, the catch at
    the bucket median (approximate); a pass's side is unknown, a run's side comes from its leaf. x_next is the next
    snap's spot (post): a foul's own enforced spot when it has one."""
    d = dir_of(team, caller)
    x0 = x_from_yl100(r["yardline_100"], team, caller)
    x_next = x_from_yl100(post["yardline_100"], team, caller) if post else None
    if call is None:                              # a flag: the ball walks from the line to the enforced spot
        return {"dir": d, "x0": x0, "x_end": x0, "x_next": x_next, "x_catch": None, "lat": None, "gap": None,
                "approx": []}
    passing = r.get("family") != "run" and r.get("leaf") != "rpo_run"
    x_end = goal_x(team, caller) if r.get("td") else clamp_x(x0 + d * (r.get("yards") or 0))
    return {"dir": d, "x0": x0, "x_end": x_end,
            "x_next": x_next, "x_catch": x0 + d * call["air"] if call["air"] is not None else None,
            "lat": None if passing else LEAF_SIDE.get(r.get("leaf")), "gap": None,
            "approx": (["x_catch"] if call["air"] is not None else []) + (["lat"] if passing else [])}


def foul_words(code):
    """'false start', 'defensive holding', 'unnecessary roughness', 'penalty', 'offsetting penalties': the engine's
    label for the code, lowercased, without its instructions and without 'on defense' or 'on offense' (the row says
    whom it was on)."""
    label = PENALTIES[code][0].split(",")[0] if code in PENALTIES else str(code)
    for side in (" on defense", " on offense"):
        label = label.removesuffix(side)
    return label.lower()


def log_penalty(r, team, opp, x0):
    """result.penalty of a logged row in ESPN's shape (B6.8) when the foul was typed by hand; the engine's code alone
    for an ESPN no-play or a game saved before v1.4."""
    code = r.get("penalty")
    if not code:
        return None
    if "pen_on" not in r:
        return {"code": code}
    on = {"def": opp, "off": team}.get(r["pen_on"])
    return {"code": code, "foul": foul_words(code), "on": on, "yards": r.get("pen_yards"), "at_x": x0,
            "no_play": bool(r.get("nullified")), "status": "offsetting" if code == "OFFSET" else "enforced",
            "note": None}


def log_result(r, pre, post, team, opp, x0):
    flag, td, nul = is_flag(r), bool(r.get("td")), bool(r.get("nullified"))
    yards = None if flag else r.get("yards") or 0
    ended = "yardline_after" in r and r["yardline_after"] is None      # a loss of down on 4th ended the drive
    chains = bool(post and post["down"] == 1 and not same_series(pre, post))
    first = td or (not flag and not nul and yards >= r["togo"]) or chains
    by = None
    if first:
        by = "penalty" if flag or nul or r.get("penalty") else (
            "pass" if r.get("dropback") and r.get("outcome") != "scramble" else "rush")
    turnover = bool(r.get("turnover"))
    return {"yards": yards, "first_down": bool(first), "fd_by": by, "td": td, "turnover": turnover,
            "turnover_kind": r.get("turnover_kind") if turnover else None,
            "downs": ended or (not flag and not first and not nul and r["down"] == 4 and not turnover),
            "safety": False, "nullified": nul, "penalty": log_penalty(r, team, opp, x0)}


def log_row(r, same, nxt, sit, game):
    """One logged snap, or a flag typed with no play, as a row (D). same: the next row in the same drive; nxt: the
    next row at all (its score is its own offense's way round)."""
    caller = game["offense"]
    team, opp = offense_of(r, game)
    flag = is_flag(r)
    call = None if flag else log_call(r)
    pre, post = log_pre_post(r, same, team, opp)
    clock_s = clock_seconds(r.get("clock"))
    after = (score_pair(nxt["score"], *offense_of(nxt, game)) if nxt
             else {caller: sit["score_off"], game["opponent"]: sit["score_opp"]})
    geo = log_geo(r, post, call, team, caller)
    return {"seq": r["seq"], "id": f"log-{r['seq']}", "espn_seq": None, "src": "log", "drive": r["drive"],
            "drive_id": None, "team": team, "opp": opp, "offense_is_caller": True,
            "kind": "penalty" if flag else "play", "type": None,
            "qtr": r["qtr"], "clock": r.get("clock"), "clock_s": clock_s, "t": elapsed(r["qtr"], clock_s),
            "clock_est": bool(r.get("clock_est")), "wall": None, "pre": pre, "post": post,
            "geo": geo, "call": call, "result": log_result(r, pre, post, team, opp, geo["x0"]), "kick": None,
            "score": after, "scoring": {"team": team, "type": "TD", "pts": 7, "pat": None} if r.get("td") else None,
            "wp": None, "text": r.get("feed_text") or r.get("name") or "", "pred": None if flag else pred_of(r)}


def log_rows(state, game):
    log, sit = state.get("log") or [], state["sit"]
    rows = []
    for i, r in enumerate(log):
        nxt = log[i + 1] if i + 1 < len(log) else None
        same = nxt if nxt and nxt["drive"] == r["drive"] else None
        rows.append(log_row(r, same, nxt, sit, game))
    return rows


# ---------------------------------------------------------------- D: drives and the status
def log_drive(idx, rs, state, game, cut=()):
    """cut: drives that go on past the rows given (a response as of an earlier row): still in progress there."""
    last, team = rs[-1], rs[0]["team"]
    res, geo, goal = last["result"], last["geo"], goal_x(team, game["offense"])
    complete = not (state.get("drive_active") and state.get("drive_n") == idx) and idx not in cut
    how = None if idx in cut else (state.get("drive_ends") or {}).get(str(idx))
    result = ("TD" if res["td"] else "TURNOVER" if res["turnover"] else "DOWNS" if res["downs"]
              else DRIVE_END_RESULT.get(how))
    x_final = goal if res["td"] else (geo["x_next"] if geo["x_next"] is not None else geo["x_end"])
    end = {"qtr": last["qtr"], "clock": last["clock"], "x": goal if res["td"] else geo["x0"]} if complete else None
    return {"idx": idx, "id": None, "team": team, "offense_is_caller": True,
            "start": {"qtr": rs[0]["qtr"], "clock": rs[0]["clock"], "x": rs[0]["geo"]["x0"]}, "end": end,
            "plays": sum(1 for r in rs if r["kind"] == "play" and not r["result"]["nullified"]),
            "yards": (x_final - rs[0]["geo"]["x0"]) * dir_of(team, game["offense"]),
            "time": None, "time_s": None, "result": result, "result_text": result, "complete": complete,
            "seq": [rs[0]["seq"], last["seq"]], "engine_drive": idx}


def log_drives(rows, state, game, cut=()):
    """Drives from the engine's drive numbers. Result: TD, TURNOVER or DOWNS from the last row, else how
    end_drive closed it (punt, FG), else null."""
    groups = {}
    for r in rows:
        groups.setdefault(r["drive"], []).append(r)
    return [log_drive(idx, groups[idx], state, game, cut) for idx in sorted(groups)]


def log_status(state, game):
    """Now: the offense on the field is the engine's (`poss` when it tracks other sides than GAME's offense)."""
    s, caller, opp, active = state["sit"], game["offense"], game["opponent"], bool(state.get("drive_active"))
    team = state.get("poss") or caller
    other = opp if team == caller else caller
    return {"state": "in" if state.get("log") else "pre", "qtr": s["qtr"], "clock": fmt_clock(s["clock"]),
            "clock_est": bool(s.get("clock_estimated")), "poss": team if active else None,
            "score": {caller: s["score_off"], opp: s["score_opp"]},
            "down_text": down_text(s["down"], s["togo"], s["yardline_100"], team, other) if active else None,
            "ball_x": x_from_yl100(s["yardline_100"], team, caller) if active else None,
            "ball_kind": "snap" if active else None,
            "timeouts": None, "last_seq": len(state.get("log") or []), "wp_home": None}

"""The analyst's tools (docs/design/analyst.md section 3): pure functions of one snapshot (analyst_snapshot) that the
model calls by name. Arguments are checked strictly (a bad one comes back as an error the model can correct); every
result is compact JSON of at most MAX_RESULT_CHARS, cut to fit when it is a list, with special tokens defused. Every
number is the app's own: the timeline's plays, drives and box score, the engine's metrics() and predict(), the
profile, formatted the way the page formats them. Nothing here can write: a tool sees only the snapshot.
"""
import json
import logging
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
import live
from analyst_snapshot import (SPLITS, TERM_ORDER, VERDICT_WORDS, Caller, Snapshot, after_last_call, came_true, clean,
                              compact, defuse, finite, fixed, grade, his_pct_on, hot_of, int_text,
                              last_call_on_drive, last_call_read, names_player, pct, pct1, plain, qtr_text, red_zone,
                              scoring_text, signed1, situation_text, splits, team_aliases, term_row, tilt_call,
                              tilt_words, verdict_of, when_of, wp_after, x_spot)
from analyst_snapshot import build_snapshot, capture, dump, take_snapshot  # noqa: F401  (app.py's wiring, the tests)
from config import EXPLOSIVE_YARDS, LEAGUE_SEASONS, LEAN, SCRIPT_PLAYS, TILT
from granular import FAMILIES, FAMILY_NAMES, LEAF_NAMES, LEAVES

log = logging.getLogger(__name__)

MAX_RESULT_CHARS = 6000            # one tool result, as the model reads it
LIST_TEXT_MAX = 140                # ESPN's play text in a list row
LIST_DEFAULT, LIST_MAX = 15, 30
TEXT_ARG_MAX = 40
WHEN_RE = re.compile(r"\s*(?:Q([1-4])|(OT)|([2-9])OT)\s*,?\s*(\d{1,2}:\d{2})\s*", re.I)
HOT_WORDS = {"up": "well above the league", "down": "well below the league"}
PHASES = {"pre": "not started", "in": "in progress", "post": "final"}
MODE_WORDS = {"live": "live: ESPN's feed is on", "watch": "a replay on screen", "replay": "rebuilt from ESPN",
              "manual": "entered by hand"}
BLANK_WORDS = frozenset({"", "any", "all", "none", "null"})      # what the model writes to mean "no filter"
ESPN_BLIND = ("ESPN's feed can't tell play-action, screens or RPOs from other passes and runs: in a game read from "
              "ESPN those calls show as dropbacks or runs, so this list can't count them. His usual rates are in "
              "tendencies (play_type_mix).")
NO_PLAYERS = ("No player stats now: they come from ESPN's box score, which the app shows only once every play is in "
              "(never during a replay). ESPN's text of each play (list_plays) names the players on it.")
FOURTH_DOWN = ("4th down: this is the play he'd call if he goes for it. The model has no punt or field-goal class, "
               "so it can't say whether he kicks.")
SCORECARD_NOTE = "Lower log loss is better. One game is a pipeline test, not proof."
HOW_TO_READ = ("Shadow is his model, League the caller-blind baseline. got_pass_or_run_right: the model's pass or "
               "run lean (pass at 50% or more) matched what he called. top_pick_right: the model's most likely "
               "specific play for him was the one he called. in_top_3: the play he called was one of the model's "
               "three most likely for him.")
NO_SNAPS_NOTE = "Scores appear after his first graded snap."
CUT_NOTE = "Cut to fit: ask for fewer plays, or filter them."
TOO_LONG = "That result was too long to send. Ask for less."
TOOL_FAULT = "That lookup failed; the server log has the details. Try another way."


class ArgError(ValueError):
    """Arguments a tool can't take; the model gets the message back as the tool's result."""


# ---------------------------------------------------------------- arguments
@dataclass(frozen=True)
class Param:
    kind: str                                  # integer, string or boolean
    description: str
    choices: tuple | Callable | None = None    # the allowed values, or a function of the snapshot that gives them
    minimum: int | None = None
    maximum: int | None = None
    clamp: bool = False                        # past the maximum reads as the maximum, under the minimum as no bound
    teams: bool = False                        # a team: its name, place or nickname reads as its abbreviation

    def options(self, snap: Snapshot) -> tuple | None:
        return self.choices(snap) if callable(self.choices) else self.choices

    def schema(self, snap: Snapshot) -> dict:
        out: dict[str, object] = {"type": self.kind, "description": self.description}
        options = self.options(snap)
        if options is not None:
            out["enum"] = list(options)
        return {**out, **compact({"minimum": self.minimum, "maximum": self.maximum})}

    def check(self, name: str, value: object, snap: Snapshot) -> object:
        """The value, or None when it reads as left out: null, blank, a word like 'any', 0 for a 1-based filter, a
        clamped number under its minimum (gpt-oss fills in every parameter, and a refusal costs a whole round)."""
        if value is None or self.blank(value, snap):
            return None
        if self.kind == "integer":
            return self.whole(name, value)
        if self.kind == "boolean":
            if isinstance(value, bool):
                return value
            if isinstance(value, str) and value.strip().lower() in ("true", "false"):
                return value.strip().lower() == "true"
            raise ArgError(f"{name} must be true or false.")
        return self.word(name, value, snap)

    def whole(self, name: str, value: object) -> int | None:
        n = None
        if isinstance(value, int) and not isinstance(value, bool):
            n = value
        elif isinstance(value, float) and value.is_integer():
            n = int(value)
        elif isinstance(value, str) and value.strip().isascii() and value.strip().isdigit():
            n = int(value.strip())
        if n is not None and self.clamp and self.minimum is not None and self.maximum is not None:
            return None if n < self.minimum else min(n, self.maximum)
        low = self.minimum if self.minimum is not None else n
        high = self.maximum if self.maximum is not None else n
        if n is None or low is None or high is None or not low <= n <= high:
            raise ArgError(f"{name} must be a whole number from {self.minimum} to {self.maximum}.")
        return n

    def word(self, name: str, value: object, snap: Snapshot) -> str:
        if not isinstance(value, str) or not value.strip() or len(value) > TEXT_ARG_MAX:
            raise ArgError(f"{name} must be short text.")
        options = self.options(snap)
        if options is None:
            return value.strip()
        word = value.strip().lower()
        match = next((o for o in options if o.lower() == word), None) or (
            team_aliases(snap).get(word) if self.teams else None)
        match = match if match in options else None
        if match is None:
            raise ArgError(f"{name} must be one of: {', '.join(options)} (got {value.strip()!r}).")
        return match

    def blank(self, value: object, snap: Snapshot) -> bool:
        if self.kind == "integer" and (self.minimum or 0) >= 1 and not isinstance(value, bool) and value in (0, "0"):
            return True                    # a 1-based filter at 0: gpt-oss's way of leaving it out
        word = value.strip().lower() if isinstance(value, str) else None
        return word in BLANK_WORDS and word not in (o.lower() for o in self.options(snap) or ())


def caller_for(snap: Snapshot, team: str | None) -> Caller:
    """The tracked caller of `team` (checked against the snapshot's callers), else the only one."""
    return next(c for c in snap.callers if team in (None, c.team))


TEAM = Param("string", "A team abbreviation from this game.", lambda s: s.teams, teams=True)
CALLER = Param("string", "The team of the modeled play-caller (leave out: the only one).",
               lambda s: tuple(c.team for c in s.callers), teams=True)


# ---------------------------------------------------------------- game_situation
def game_situation(snap: Snapshot) -> dict:
    st = snap.status
    clock, estimated = clock_now(snap)
    out = {"game": snap.game.get("label"), "phase": PHASES.get(str(st.get("state")), "not started"),
           "mode": MODE_WORDS.get(snap.mode, snap.mode)}
    if snap.watch:
        out["watch"] = {"state": snap.watch["state"], "at_play": snap.watch["idx"], "of": snap.watch["total"]}
    return {**out, "quarter": qtr_text(st.get("qtr")) or None, "clock": clock, "clock_estimated": estimated,
            "score": dict(st.get("score") or {}), "teams": {t: snap.team_names.get(t, t) for t in snap.teams},
            "possession": st.get("poss"), "situation": st.get("down_text"),
            "timeouts": dict(st["timeouts"]) if st.get("timeouts") else None,
            "espn_win_probability": wp_after(snap, st.get("wp_home")),
            "callers": [caller_now(snap, c) for c in snap.callers]}


def clock_now(snap: Snapshot) -> tuple:
    """The scoreboard's clock: while his drive is on, the engine's (ESPN's at his last snap less its runoff
    estimate, flagged as estimated); otherwise the timeline's (model/vm-scoreboard.js engineClock)."""
    st = snap.status
    on = next((c for c in snap.callers if c.on_field), None)
    if snap.source == "espn" and st.get("state") != "post" and on and on.sit.get("qtr") == st.get("qtr"):
        return live.fmt_clock(on.sit["clock"]), bool(on.sit.get("clock_estimated"))
    return st.get("clock"), bool(st.get("clock_est"))


def caller_now(snap: Snapshot, c: Caller) -> dict:
    out = {"name": c.name, "team": c.team, "has_ball": c.on_field,
           "next_call": next_call(snap, c, c.prediction) if c.on_field and c.prediction else None}
    if out["next_call"] is None:
        out["next_call_note"] = off_field_note(snap, c)
    return {**out, "previous_call": previous_call(snap, c), "so_far": so_far(c)}


def off_field_note(snap: Snapshot, c: Caller) -> str:
    state, poss = snap.status.get("state"), snap.status.get("poss")
    if state == "post":
        return "The game is over."
    if poss and poss != c.team:
        return f"{poss} has the ball. His next call comes when {c.team} gets it back."
    return f"{c.team} isn't on the field. His next call comes when {c.team} gets the ball."


def next_call(snap: Snapshot, c: Caller, p: Mapping) -> dict:
    """The card's NEXT CALL: p is engine.predict() for the snap about to happen."""
    sit = c.sit
    opp = str(next((t for t in snap.teams if t != c.team), snap.game.get("opponent")))
    picks = [pick(t) for t in p["top"]]
    out = {"snap": p["snap_next"], "situation": situation_text(sit["down"], sit["togo"], sit["yardline_100"],
                                                               c.team, opp),
           "top_pick": picks[0], "then": picks[1:], "pass_chance": pct(p["p"]), "run_chance": pct(1 - p["p"]),
           "league_pass_chance": pct(p["p_league"]), "tilt": tilt_words(p["flag"]),
           "tilt_points": signed1(100 * (p["p"] - p["p_league"])),
           "habits_pass_points": signed1(100 * (p["p_habits"] - p["p_league"])),
           "play_types": [play_type(f["name"], f["p"], f["p_league"], f.get("hot")) for f in p["families"]],
           **memory_view(p["memory_parts"], p["script"])}
    return {**out, "fourth_down": FOURTH_DOWN} if sit.get("down") == 4 else out


def pick(t: Mapping) -> dict:
    return {"play": t["name"], "chance": pct(t["p"]), "league_chance": pct(t["p_league"])}


def play_type(name: str, his: float, league: float, hot: str | None) -> dict:
    return compact({"type": name, "chance": pct(his), "league_chance": pct(league),
                    "vs_league": HOT_WORDS.get(hot or "")})


def memory_view(parts: tuple | None, script: bool) -> dict:
    if script:
        return {"memory_note": f"Opening script: memory switches on after snap {SCRIPT_PLAYS}."}
    if parts is None:
        return {"memory_note": "This snap's memory terms weren't kept."}
    return {"memory": [{"term": m["term"], "pass_points": signed1(m["pts"])} for m in parts]}


def previous_call(snap: Snapshot, c: Caller) -> dict | None:
    """His most recent call: what he called, what happened, the verdict (the card's PREVIOUS PLAY)."""
    last = next((p for p in reversed(snap.plays) if p["pred"] and p["team"] == c.team), None)
    if last is None:
        return None
    pred = last["pred"]
    called = last["play"] + (", TD" if last["td"] else "") + (", turnover" if last["turnover"] else "")
    return compact({"seq": last["seq"], "when": last["when"], "situation": last["situation"], "called": called,
                    "result": last["result"], **grade(pred)})


def so_far(c: Caller) -> dict:
    """His night (the card's tally and LAST 6): top picks and top-3 hits of his calls, his last six verdicts."""
    m, g = c.metrics, c.metrics.get("granular") or {}
    snaps = [r for r in c.log if live.is_snap(r)]
    recent = [VERDICT_WORDS[k] for k in (verdict_of(r)[0] for r in snaps[-6:]) if k]
    out = {"calls": m.get("n", 0)}
    if g.get("leaf_n"):
        out.update(top_picks=f"{g['leaf_top1']} of {g['leaf_n']}", in_top_3=f"{g['leaf_top3']} of {g['leaf_n']}")
    return {**out, "last_6": recent}


# ---------------------------------------------------------------- list_plays
ZONES = {"own_territory": lambda p: p["yardline_100"] > 50, "opponent_territory": lambda p: p["yardline_100"] < 50,
         "red_zone": lambda p: p["yardline_100"] <= 20, "goal_to_go": lambda p: bool(p["goal_to_go"]),
         "backed_up": lambda p: p["yardline_100"] >= 90}
PLAY_TYPES = {
    "run": lambda p: p["kind"] == "play" and p["dropback"] == 0,
    "pass": lambda p: p["kind"] == "play" and p["dropback"] == 1,
    "dropback": lambda p: p["family"] == "dropback", "play_action": lambda p: p["family"] == "pa",
    "screen": lambda p: p["family"] == "screen", "rpo": lambda p: p["family"] == "rpo",
    "sack": lambda p: p["outcome"] == "sack", "scramble": lambda p: p["outcome"] == "scramble",
    "punt": lambda p: p["kind"] == "punt", "field_goal": lambda p: p["kind"] in ("fg", "fg_miss"),
    "kickoff": lambda p: p["kind"] == "kickoff", "penalty": lambda p: bool(p["flag"]) or p["kind"] == "penalty",
    "kneel": lambda p: p["kind"] == "kneel", "timeout": lambda p: p["kind"] == "timeout"}
RESULTS = {
    "first_down": lambda p: p["first_down"] and not p["nullified"],
    "touchdown": lambda p: (p["scoring"] or {}).get("type") == "TD", "turnover": lambda p: bool(p["turnover"]),
    "explosive": lambda p: p["kind"] == "play" and not p["nullified"] and (p["yards"] or 0) >= EXPLOSIVE_YARDS,
    "negative": lambda p: p["kind"] == "play" and not p["nullified"] and (p["yards"] or 0) < 0,
    "incomplete": lambda p: p["outcome"] == "incomplete", "scoring": lambda p: bool(p["scoring"]),
    "no_play": lambda p: p["nullified"] or p["kind"] == "penalty",
    "interception": lambda p: p["turnover"] == "int", "fumble": lambda p: p["turnover"] == "fumble"}
VERDICTS = {"top_pick": ("top1",), "top_3": ("top1", "top3"), "miss": ("miss",)}
TILT_FLAGS, LEAN_FLAGS = ("TILT PASS", "TILT RUN"), ("lean pass", "lean run")       # the engine's flags
TILTS = {"tilt": TILT_FLAGS, "lean": LEAN_FLAGS, "tilt_or_lean": TILT_FLAGS + LEAN_FLAGS}
HALVES = {1: (1, 2), 2: (3, 4)}
BLIND_TYPES = ("play_action", "screen", "rpo")


def surprise(p: Mapping) -> float:
    """His chance on what he called (the specific play's, else the play type's): lower is a bigger surprise."""
    pred = p["pred"]
    for key in ("leaf_p", "fam_p"):
        if finite(pred.get(key)):
            return pred[key]
    return 2.0


SORTS = {"surprise": (lambda p: bool(p["pred"]), surprise),
         "yards": (lambda p: finite(p["yards"]), lambda p: -p["yards"]),
         "win_prob_swing": (lambda p: finite((p["wp"] or {}).get("delta")), lambda p: -abs(p["wp"]["delta"]))}


def list_plays(snap: Snapshot, team=None, his_calls_only=False, down=None, yards_to_go_min=None,
               yards_to_go_max=None, yards_gained_min=None, quarter=None, half=None, field_zone=None, play_type=None,
               result=None, verdict=None, tilt=None, player=None, sort="game_order", limit=LIST_DEFAULT) -> dict:
    if None not in (yards_to_go_min, yards_to_go_max) and yards_to_go_min > yards_to_go_max:
        raise ArgError("yards_to_go_min can't be more than yards_to_go_max.")
    tests = [t for t in (
        team and (lambda p: p["team"] == team), (his_calls_only or verdict or tilt) and (lambda p: bool(p["pred"])),
        down and (lambda p: p["down"] == down), quarter and (lambda p: p["qtr"] == quarter),
        half and (lambda p: p["qtr"] in HALVES[half]),
        yards_to_go_min and (lambda p: finite(p["togo"]) and p["togo"] >= yards_to_go_min),
        yards_to_go_max and (lambda p: finite(p["togo"]) and p["togo"] <= yards_to_go_max),
        yards_gained_min and (lambda p: p["kind"] == "play" and not p["nullified"] and finite(p["yards"])
                              and p["yards"] >= yards_gained_min),
        field_zone and (lambda p: finite(p["yardline_100"]) and ZONES[field_zone](p)),
        play_type and PLAY_TYPES.get(play_type), result and RESULTS.get(result),
        verdict and (lambda p: verdict_of(p["pred"])[0] in VERDICTS[verdict]),
        tilt and (lambda p: (p["pred"] or {}).get("flag") in TILTS[tilt]),
        player and (lambda p: names_player(p["text"], player))) if t]
    rows = [p for p in snap.plays if all(t(p) for t in tests)]
    if sort in SORTS:
        keep, key = SORTS[sort]
        rows = sorted((p for p in rows if keep(p)), key=lambda p: (key(p), p["seq"]))
    shown = rows[:limit]
    out = {"matched": len(rows), "shown": len(shown)}
    sums = totals(rows)
    note = ESPN_BLIND if play_type in BLIND_TYPES and snap.source == "espn" else None
    return {**out, **({"totals": sums} if sums else {}), **({"data_note": note} if note else {}),
            "plays": [row_of(p) for p in shown]}


def totals(rows: list) -> dict:
    """The counting the model shouldn't do, over every matched play: snaps that stood and their yards, no-plays,
    first downs, touchdowns, turnovers, pass and run calls (no-plays included), and for his calls how many were the
    model's top pick or in its top 3 and how many tilts and leans came true."""
    plays = [p for p in rows if p["kind"] in ("play", "kneel", "spike", "penalty")]
    if not plays:
        return {}
    stood = [p for p in plays if p["kind"] != "penalty" and not p["nullified"]]
    gains = [p["yards"] for p in stood if finite(p["yards"])]
    calls = [p["dropback"] for p in plays if p["kind"] == "play" and p["dropback"] in (0, 1)]
    ranks = [p["pred"]["leaf_rank"] for p in plays if p["pred"] and isinstance(p["pred"].get("leaf_rank"), int)]
    tags = [tilt_call(p["pred"]) for p in plays if p["pred"]]
    out = {"snaps": len(stood), "no_plays": len(plays) - len(stood), "yards": sum(gains),
           "yards_per_snap": fixed(sum(gains) / len(gains), 1) if gains else None,
           "first_downs": sum(1 for p in stood if p["first_down"]),
           "touchdowns": sum(1 for p in plays if (p["scoring"] or {}).get("type") == "TD"),
           "turnovers": sum(1 for p in plays if p["turnover"]),
           "explosive": sum(1 for y in gains if y >= EXPLOSIVE_YARDS), "negative": sum(1 for y in gains if y < 0),
           "pass_calls": calls.count(1) if calls else None, "run_calls": calls.count(0) if calls else None,
           "pass_rate": pct(calls.count(1) / len(calls)) if calls else None,
           "tilts_came_true": came_true(tags, "Tilts"), "leans_came_true": came_true(tags, "Leans")}
    if ranks:
        out.update(his_calls=sum(1 for p in plays if p["pred"]), top_pick_right=f"{ranks.count(1)} of {len(ranks)}",
                   in_top_3=f"{sum(1 for r in ranks if r <= 3)} of {len(ranks)}")
    return compact(out)


def row_of(p: Mapping) -> dict:
    return compact({"seq": p["seq"], "when": p["when"], "team": p["team"], "situation": p["situation"],
                    "play": p["play"], "side": p["side"], "result": p["result"],
                    "first_down": p["first_down"] and not p["nullified"], "scoring": scoring_text(p["scoring"]),
                    "flag": p["flag"], "his_call": grade(p["pred"]) if p["pred"] else None,
                    "espn": clean(p["text"], LIST_TEXT_MAX)})


# ---------------------------------------------------------------- play_detail
def play_detail(snap: Snapshot, seq=None, when=None) -> dict:
    if seq is not None:
        p = next((p for p in snap.plays if p["seq"] == seq), None)
        if p is None:
            seqs = [p["seq"] for p in snap.plays]
            raise ArgError(f"No play with seq {seq}." + (f" This game's plays run from seq {seqs[0]} to {seqs[-1]}."
                                                          if seqs else " No plays yet."))
        return detail(snap, p)
    if when is None:
        raise ArgError("Give the play's seq or when (like Q3 2:52).")
    m = WHEN_RE.fullmatch(when)
    if not m:
        raise ArgError("Write when like Q3 2:52 (or OT 4:10).")
    qtr = int(m.group(1)) if m.group(1) else 5 if m.group(2) else 4 + int(m.group(3))
    found = [p for p in snap.plays if p["qtr"] == qtr and p["clock"] == m.group(4)]
    real = [p for p in found if p["kind"] != "timeout"] or found
    if not real:
        raise ArgError(f"No play at {when_of(qtr, m.group(4))}.")
    if len(real) == 1:
        return detail(snap, real[0])
    return {"plays": [row_of(p) for p in real],
            "note": f"Several plays at {when_of(qtr, m.group(4))}: ask for one by its seq."}


def detail(snap: Snapshot, p: Mapping) -> dict:
    wp = p["wp"] or {}
    out = compact({
        "seq": p["seq"], "when": p["when"], "team": p["team"], "opponent": p["opp"], "situation": p["situation"],
        "after": p["after"], "play": p["play"], "side": p["side"], "result": p["result"], "yards": p["yards"],
        "first_down": p["first_down"] and not p["nullified"], "touchdown": p["td"], "turnover": p["turnover"],
        "flag": p["flag"], "scoring": scoring_text(p["scoring"]), "score_after": dict(p["score"] or {}),
        "espn_win_probability": wp_after(snap, wp.get("home")),
        "espn_win_prob_change": f"{signed1(100 * wp['delta'])} pts for {snap.game['offense']}"
        if finite(wp.get("delta")) else None,
        "espn": p["text"]})
    return {**out, "model": model_view(snap, p)} if p["pred"] else out


def model_view(snap: Snapshot, p: Mapping) -> dict:
    """The model's prediction before one of his snaps, and how it graded."""
    pred = p["pred"]
    c = next((x for x in snap.callers if x.team == p["team"]), None)
    key, rank = verdict_of(pred)
    out = {"caller": c.name if c else None, "snap": pred.get("snap"), "pass_chance": pct(pred.get("p")),
           "league_pass_chance": pct(pred.get("p_league")),
           "habits_pass_points": signed1(100 * (pred["p_habits"] - pred["p_league"]))
           if finite(pred.get("p_habits")) and finite(pred.get("p_league")) else None,
           "tilt": tilt_words(pred.get("flag")),
           "tilt_points": signed1(100 * (pred["p"] - pred["p_league"])) if finite(pred.get("p")) else None,
           **distribution(pred.get("dist")), "called": called_view(pred), "verdict": VERDICT_WORDS.get(key or ""),
           "retagged": bool(pred.get("retagged")),
           "no_play": "Wiped out by a flag: graded, but not part of his in-game memory." if p["nullified"] else None}
    snap_n = pred.get("snap")
    script = isinstance(snap_n, int) and snap_n <= SCRIPT_PLAYS
    parts = c.memory_parts.get(pred.get("log_seq")) if c else None
    before = last_call_on_drive(snap, c, pred.get("log_seq")) if c and parts else None
    return compact({**out, **(memory_view(parts, script) if c and c.memory_parts else {}),
                    "his_last_call_on_this_drive": before, "memory_read": last_call_read(c, parts, before)})


def distribution(dist: Mapping | None) -> dict:
    """His top 3 specific plays and the five play types, his % and the league's, from the stored tree."""
    if not dist:
        return {}
    his_l, lg_l = dict(zip(LEAVES, dist["his_l"])), dict(zip(LEAVES, dist["lg_l"]))
    his_f, lg_f = dict(zip(FAMILIES, dist["his_f"])), dict(zip(FAMILIES, dist["lg_f"]))
    top = sorted(LEAVES, key=lambda k: -his_l[k])[:3]
    return {"top_3": [{"play": LEAF_NAMES[k], "chance": pct(his_l[k]), "league_chance": pct(lg_l[k])} for k in top],
            "play_types": [play_type(FAMILY_NAMES[f], his_f[f], lg_f[f], hot_of(his_f[f], lg_f[f]))
                           for f in sorted(FAMILIES, key=lambda f: -his_f[f])]}


def called_view(pred: Mapping) -> dict:
    if finite(pred.get("leaf_p")):
        return {"play": pred.get("name"), "chance": pct1(pred["leaf_p"]),
                "league_chance": pct1(pred.get("leaf_p_league")), "rank": pred.get("leaf_rank"),
                "league_rank": pred.get("leaf_rank_league")}
    return compact({"play": pred.get("name"), "type": FAMILY_NAMES.get(pred.get("family") or ""),
                    "chance": his_pct_on(pred), "league_chance": pct1(pred.get("fam_p_league"))})


# ---------------------------------------------------------------- scorecard
def scorecard(snap: Snapshot, team=None, split="none") -> dict:
    c = caller_for(snap, team)
    m = c.metrics
    head = {"caller": c.name, "team": c.team, "snaps": m.get("n", 0)}
    if not m.get("n"):
        return {**head, "shadow_v_league": [], "note": NO_SNAPS_NOTE}
    g = m.get("granular") or {}
    out = {**head, "shadow_v_league": pairs(m)}
    if g.get("leaf_n"):
        out["specific_play"] = {"snaps": g["leaf_n"], "top_pick_right": f"{g['leaf_top1']} of {g['leaf_n']}",
                                "in_top_3": f"{g['leaf_top3']} of {g['leaf_n']}",
                                "league_in_top_3": f"{g['leaf_top3_league']} of {g['leaf_n']}",
                                "shadow_log_loss": fixed(g["leaf_logloss"], 2),
                                "league_log_loss": fixed(g["leaf_logloss_league"], 2)}
    if g.get("fam_n"):
        out["play_type"] = {"snaps": g["fam_n"], "most_likely_type_right": f"{g['fam_top_hits']} of {g['fam_n']}",
                            "shadow_log_loss": fixed(g["fam_logloss"], 2),
                            "league_log_loss": fixed(g["fam_logloss_league"], 2)}
    out["pass_run"] = {"snaps": m["n"], "shadow_log_loss": fixed(m["logloss_model"], 3),
                       "league_log_loss": fixed(m["logloss_league"], 3),
                       "shadow_got_pass_or_run_right": pct(m["acc_model"]),
                       "league_got_pass_or_run_right": pct(m["acc_league"]),
                       "tilts_that_came_true": f"{m['tilt_hits']} of {m['tilt_n']}" if m["tilt_n"] else "0",
                       "his_pass_rate": pct(m["dropback_rate"])}
    if split in SPLITS:
        out[f"by_{split}"] = splits(c, split)
    return {**out, "how_to_read": HOW_TO_READ, "note": SCORECARD_NOTE}


def pairs(m: Mapping) -> list:
    """SHADOW v LEAGUE (model/vm-scorecard.js comparisonPairs): the leader is decided by what the screen shows."""
    g, n = m.get("granular") or {}, m["n"]
    out = [pair("Run/pass right", m["acc_model"], m["acc_league"], pct, "higher", n)]
    if g.get("leaf_n"):
        out.append(pair("Play in top 3", g["leaf_top3"], g["leaf_top3_league"], lambda v: f"{v} of {g['leaf_n']}",
                        "higher", g["leaf_n"]))
    out.append(pair("Pass vs run log loss", m["logloss_model"], m["logloss_league"], lambda v: fixed(v, 3), "lower", n))
    if g.get("fam_n"):
        out.append(pair("Play type log loss", g["fam_logloss"], g["fam_logloss_league"], lambda v: fixed(v, 2),
                        "lower", g["fam_n"]))
    if g.get("leaf_n"):
        out.append(pair("Specific play log loss", g["leaf_logloss"], g["leaf_logloss_league"], lambda v: fixed(v, 2),
                        "lower", g["leaf_n"]))
    return out


def pair(measure: str, shadow: float, league: float, shown: Callable, better: str, snaps: int) -> dict:
    a, b = shown(shadow), shown(league)
    leader = "Even" if a == b else "Shadow leads" if (better == "higher") == (shadow > league) else "League leads"
    return {"measure": measure, "shadow": a, "league": b, "leader": leader, "better": better, "snaps": snaps}



# ---------------------------------------------------------------- box score and drives
def box_score(snap: Snapshot) -> dict:
    source = "ESPN's box score" if snap.box_source == "espn" else "counted from the plays so far"
    zones = red_zone(snap)
    out = {"source": source, "teams": {t: {**team_box(b), "red_zone": zones.get(t)} for t, b in snap.box.items()},
           **({"players": [{"team": t, "stat": s, **line} for t, cats in snap.players.items()
                           for s, lines in cats.items() for line in lines]} if snap.players else
              {"players_note": NO_PLAYERS})}
    if snap.source == "log":
        out["note"] = f"Plays typed by hand: only {snap.game['offense']}'s snaps are counted."
    return out


def team_box(b: Mapping) -> dict:
    r, p, f, pen = b["rush"], b["pass"], b["first_downs"], b["penalties"]
    return {"plays": b["plays"], "yards": b["yards"], "rush": {"attempts": r["att"], "yards": r["yds"]},
            "pass": {"completions": p["comp"], "attempts": p["att"], "net_yards": p["net"], "interceptions": p["int"],
                     "sacked": p["sacks"], "sack_yards": p["sack_yds"]},
            "first_downs": {"total": f["total"], "rush": f["rush"], "pass": f["pass"], "penalty": f["pen"]},
            "third_down": f"{b['third']['conv']} of {b['third']['att']}",
            "fourth_down": f"{b['fourth']['conv']} of {b['fourth']['att']}", "turnovers": b["turnovers"],
            "fumbles_lost": b["fumbles_lost"], "penalties": {"count": pen["n"], "yards": pen["yds"]},
            "time_of_possession": b.get("top")}


def drives(snap: Snapshot, team=None) -> dict:
    rows = [d for d in snap.drives if team in (None, d["team"])]
    return {"count": len(rows), "drives": [drive_row(snap, d) for d in rows]}


def drive_row(snap: Snapshot, d: Mapping) -> dict:
    start = d["start"] or {}
    spot = x_spot(snap, start.get("x"))
    return compact({"n": d["idx"], "team": d["team"],
                    "start": when_of(start.get("qtr"), start.get("clock")) + (f" at {spot}" if spot else ""),
                    "plays": d["plays"], "yards": round(d["yards"]) if finite(d["yards"]) else None,
                    "time": d["time"], "result": d["result_text"] or ("in progress" if not d["complete"] else None),
                    "seqs": list(d["seq"])})


# ---------------------------------------------------------------- the caller and the model
def tendencies(snap: Snapshot, team=None) -> dict:
    c = caller_for(snap, team)
    prof, gran = c.profile, c.profile.get("granular") or {}
    coefs = prof.get("coefs") or {}
    keys = [k for k in TERM_ORDER if k in coefs] + sorted(k for k in coefs if k not in TERM_ORDER)
    snaps = [r for r in c.log if live.is_snap(r)]
    sp = (gran.get("cv") or {}).get("specific_play") or {}
    return compact({
        "caller": c.name, "team": c.team, "based_on": based_on(prof),
        "terms": [term_row(k, coefs[k]) for k in keys],
        "scale": "Each estimate is added to the league baseline's log-odds of a pass; means says what its sign does. "
                 "The overall lean applies on every snap and a situation's term adds to it there, so on early downs "
                 "his lean is the two together. sure: the 90% interval excludes zero.",
        "after_his_last_call": after_last_call(coefs),
        "play_type_mix": [{"type": FAMILY_NAMES[f], "his_rate": pct(v["his"]),
                           "league_expected": pct(v["league_expected"])}
                          for f, v in ((f, (gran.get("family_rates") or {}).get(f)) for f in FAMILIES) if v],
        "pass_rate": {"his_rate": pct((prof.get("dropback_rate") or {}).get("actual")),
                      "league_expected": pct((prof.get("dropback_rate") or {}).get("league_expected"))},
        "pass_rate_by_down": [{"down": d["down"], "snaps": d["n"], "his_rate": pct(d["actual"]),
                               "league_expected": pct(d["league_expected"])} for d in prof.get("by_down") or ()],
        "held_out": (f"Held-out check: his top pick for the specific play was right {pct(sp.get('top1_his'))} of the "
                     f"time; the actual play was in his top 3 {pct(sp.get('top3_his'))} of the time "
                     f"({int_text(sp.get('n'))} snaps).") if sp else None,
        "tonight": {"calls": len(snaps), "by_play_type": tonight_mix(snaps),
                    "his_pass_rate": pct(c.metrics.get("dropback_rate"))}})


def tonight_mix(snaps: list) -> dict:
    counts: dict[str, int] = {}
    for r in snaps:
        name = FAMILY_NAMES.get(r.get("family") or "") or ("Pass, type unknown" if r.get("dropback")
                                                          else "Run, type unknown")
        counts = {**counts, name: counts.get(name, 0) + 1}
    return counts


def based_on(prof: Mapping) -> str:
    seasons = list(prof.get("seasons") or [])
    years = f"{seasons[0]} to {seasons[-1]}" if len(seasons) > 1 else ", ".join(map(str, seasons))
    return f"{int_text(prof.get('n_snaps'))} snaps, {prof.get('n_games')} games ({years})"


def caller_profile(snap: Snapshot, team=None) -> dict:
    c = caller_for(snap, team)
    p = c.profile
    cv, s1 = p.get("cv_logloss") or {}, p.get("stage1_check") or {}
    sp = ((p.get("granular") or {}).get("cv") or {}).get("specific_play") or {}
    return {"name": c.name, "team": c.team, "seasons": list(p.get("seasons") or ()), "snaps_modeled": p.get("n_snaps"),
            "games_modeled": p.get("n_games"), "built": str(p.get("built_at") or "")[:10] or None,
            "memory": {"learning_rate": p.get("alpha"), "opening_script_snaps": SCRIPT_PLAYS},
            "held_out_log_loss": {"league_baseline": fixed(cv.get("league_baseline"), 3),
                                  "his_habits": fixed(cv.get("habits"), 3),
                                  "habits_plus_memory": fixed(cv.get("habits_plus_memory"), 3),
                                  "nflfastr_xpass": fixed(cv.get("nflfastr_xpass_reference"), 3)},
            "stage1_holdout": {"season": s1.get("test_season"), "snaps": s1.get("n"),
                               "baseline": fixed(s1.get("logloss_ours"), 3),
                               "nflfastr_xpass": fixed(s1.get("logloss_nflfastr_xpass"), 3)},
            "specific_play_held_out": {"top_pick": pct(sp.get("top1_his")), "top_3": pct(sp.get("top3_his")),
                                       "snaps": sp.get("n")},
            "note": "Held-out numbers are cross-validated by game on his own past games; lower log loss is better."}


def model_explainer(snap: Snapshot) -> dict:
    """How the model works (README.md, PRODUCT.md, live.py, features.py, build.py), with this caller's numbers."""
    c = snap.callers[0]
    p = c.profile
    cv, s1 = p.get("cv_logloss") or {}, p.get("stage1_check") or {}
    return {"explainer": " ".join((
        f"Shadow Play-Caller predicts {c.name}'s next call ({c.team}) before every snap, in three layers.",
        f"1. League baseline: a gradient-boosted model trained on nflverse play-by-play from {LEAGUE_SEASONS[0]} to "
        f"{LEAGUE_SEASONS[-1]}, every team except {p.get('team') or c.team}, gives the league's chance of a pass (a "
        "dropback) in the exact situation: down, distance, field position, goal to go, score, quarter, time left in "
        "the half and the game, home or away, the pregame spread and total, and the two-minute mark. It never knows "
        f"who calls the plays. On the {s1.get('test_season')} season, held out, its log loss was "
        f"{fixed(s1.get('logloss_ours'), 3)} against {fixed(s1.get('logloss_nflfastr_xpass'), 3)} for nflfastR's "
        "pass model.",
        f"2. His habits: a logistic model fit to his {based_on(p)} adds his own terms on top of the baseline: an "
        "overall lean, early downs, 3rd & 4+, trailing by 9+ and the red zone. A ridge penalty pulls every term "
        "toward zero, so a habit has to be real to move the number.",
        "3. In-game memory: the model tracks what has been working tonight, a running success score for his passes "
        f"and for his runs, updated after each of his calls with learning rate {p.get('alpha')}, plus whether he "
        "repeats or switches from his last call, and what he does after a failed play, a 20+ yard gain or a sack. "
        f"Memory stays off for his first {SCRIPT_PLAYS} snaps (the opening script), and the last-call terms reset "
        "at every new drive. Those terms are signed by his last call: a negative stickiness term means he tends to "
        "switch (after a pass he leans run). A play is a success when it gains 40% of the distance on 1st down, 60% "
        "on 2nd and all of it on 3rd or 4th; a touchdown is a success and a turnover a failure. A snap wiped out by "
        "a flag is graded but stays out of his memory.",
        "Play types: league models trained on FTN charting split the call into five play types (run, dropback "
        "pass, play-action, screen, RPO) and 14 specific plays (run gap and side, pass depth by air yards: short "
        "0-9, intermediate 10-19, deep 20+, RPO handed off or thrown), each adjusted to his habits and shrunk "
        "toward the league; his memory shifts pass against run inside them.",
        "Grading: every one of his snaps is graded against what ESPN's feed says he called: run or pass called "
        "right (a pass chance of 50% or more means pass), the play type, and the specific play's rank (top pick, "
        "in his top 3, or a miss), with log loss for his model (Shadow) and the league baseline (League) side by "
        "side. Lower log loss is better, and one game is a small sample.",
        f"Tilt: the tag compares his pass chance with the league's in the same spot: {round(TILT * 100)} points or "
        f"more is a tilt, {round(LEAN * 100)} points or more a lean, and under that he calls it like the league "
        "does. Arrows mark play types at least 4 points and 30% above or below the league.",
        "Limits: ESPN's free feed can't see play-action, screens or RPOs, so those calls are graded as ESPN "
        "describes them (a dropback by depth, or a run). There is no player tracking, so routes, formations and "
        "personnel aren't known. The model has no punt or field-goal class: on 4th down the call is the play he'd "
        "run if he goes for it. Held out on his own past games, cross-validated by game, the league baseline's log "
        f"loss was {fixed(cv.get('league_baseline'), 3)}, his habits {fixed(cv.get('habits'), 3)} and habits plus "
        f"memory {fixed(cv.get('habits_plus_memory'), 3)}."))}


# ---------------------------------------------------------------- the registry and the dispatcher
@dataclass(frozen=True)
class Tool:
    name: str
    label: str                     # what the page shows while it runs
    description: str
    params: Mapping
    run: Callable


TOOLS = (
    Tool("game_situation", "Checking the game situation",
         "The game right now: phase, quarter and clock, score, who has the ball, down and distance, timeouts, ESPN's "
         "win probability; for the modeled play-caller, his next call when his offense has the ball (top picks with "
         "his and the league's %, pass vs run, the tilt, the memory terms), his previous call graded and his night "
         "so far. Use it first for anything about now.", {}, game_situation),
    Tool("list_plays", "Looking through the plays",
         "Find plays so far, both teams, in game order. Filters combine; leave out the ones you don't need. totals "
         "count every match, not only the rows shown: take counts and rates (passes and runs, yards, first downs, "
         "tilts that came true) from totals, never by counting rows. Each row: seq (for play_detail), when (quarter "
         "and clock: cite plays this way), the team with the ball, the situation before the snap, the play, the "
         "result, ESPN's text, and for the modeled play-caller's calls the model's grade and any tilt.",
         {"team": Param("string", "Only plays where this team had the ball (a timeout: the team that called it).",
                        TEAM.choices, teams=True),
          "his_calls_only": Param("boolean", "Only snaps called by the modeled play-caller, each graded."),
          "down": Param("integer", "Down before the snap.", minimum=1, maximum=4),
          "yards_to_go_min": Param("integer", "Fewest yards to go for a first down before the snap (not yards "
                                   "gained).", minimum=1, maximum=99, clamp=True),
          "yards_to_go_max": Param("integer", "Most yards to go for a first down before the snap, like 3 for 3rd "
                                   "and short.", minimum=1, maximum=99, clamp=True),
          "yards_gained_min": Param("integer", "Only plays that gained at least this many yards.", minimum=1,
                                    maximum=99, clamp=True),
          "quarter": Param("integer", "Quarter: 1 to 4, 5 for overtime.", minimum=1, maximum=5),
          "half": Param("integer", "1: the first half (Q1 and Q2); 2: the second half (Q3 and Q4).", minimum=1,
                        maximum=2),
          "field_zone": Param("string", "Where the snap was, for the team with the ball: own side of midfield, the "
                              "opponent's side, inside the opponent's 20, goal to go, inside its own 10.",
                              tuple(ZONES)),
          "play_type": Param("string", "run (handed off or kept), pass (any dropback: sacks and scrambles too), "
                             "plain dropback, play_action, screen, rpo, sack, scramble, punt, field_goal, kickoff, "
                             "penalty (any flag), kneel, timeout. ESPN can't see play-action, screens or RPOs.",
                             tuple(PLAY_TYPES)),
          "result": Param("string", "explosive is a gain of 20+ yards; negative lost yards; no_play was wiped out by "
                          "a flag; interception and fumble are the turnovers.", tuple(RESULTS)),
          "verdict": Param("string", "His calls by grade: top_pick (his most likely specific play), top_3 (one of "
                           "his three most likely, top picks included), miss.", tuple(VERDICTS)),
          "tilt": Param("string", "His calls where the card's tag fired before the snap: tilt (his pass chance 15+ "
                        "points off the league's), lean (8 to 15 points), tilt_or_lean. A tag helped when it came "
                        "true (tilt_came_true; totals count them).", tuple(TILTS)),
          "player": Param("string", "Only plays whose ESPN text names this player: a last name, like Pickens."),
          "sort": Param("string", "game_order (default); surprise: the model's biggest misses first (his least "
                        "expected calls); yards: most gained first; win_prob_swing: biggest swing first.",
                        ("game_order", *SORTS)),
          "limit": Param("integer", f"Most rows to return (default {LIST_DEFAULT}, at most {LIST_MAX}); matched says "
                         "how many there are.", minimum=1, maximum=LIST_MAX, clamp=True)}, list_plays),
    Tool("play_detail", "Reading one play",
         "One play in full: before and after, what happened, the flag, the score and win probability; for the "
         "modeled play-caller's snaps, the model's prediction before the snap: pass vs run against the league, the "
         "tilt, his habits' and memory's pass points (with his last call on the drive, which the memory reacts to), "
         "his top 3 plays, the five play types, his and the league's % on what he called, the ranks and the "
         "verdict. Use it for why the model leaned the way it did on a play.",
         {"seq": Param("integer", "The play's seq from another tool.", minimum=1, maximum=9999),
          "when": Param("string", "Quarter and clock, like Q3 2:52 or OT 4:10, when you don't have the seq.")},
         play_detail),
    Tool("scorecard", "Checking the scorecard",
         "How the model is doing tonight: Shadow (the model of the play-caller) against League (the caller-blind "
         "baseline) on every scorecard measure, with the specific play, play type and pass vs run numbers. "
         "split adds the same numbers, and his pass rate, per down, quarter or half.",
         {"team": CALLER, "split": Param("string", "none (default), down, quarter or half.",
                                         ("none", *SPLITS))},
         scorecard),
    Tool("box_score", "Reading the box score",
         "Both teams' box score so far: plays, yards, rushing, passing, interceptions, sacks, first downs, 3rd and "
         "4th down, red zone trips and touchdowns, turnovers, penalties, time of possession; and players' passing, "
         "rushing and receiving lines when ESPN's box score is shown.", {}, box_score),
    Tool("drives", "Looking at the drives",
         "Every drive so far: who had it, when and where it started, plays, yards, time, how it ended, the seqs it "
         "spans.", {"team": TEAM}, drives),
    Tool("tendencies", "Checking his tendencies",
         "The modeled play-caller's habits from his past games against the league: his pass rate by down and his "
         "play-type mix next to what the league would call in the same spots (the plainest comparison), every term "
         "of his model with its 90% interval and what it means, including the memory: what's been working, repeat "
         "or switch from his last call, after a failed play, a 20+ yard gain or a sack (after_his_last_call adds "
         "them up); the held-out check, and his calls by play type tonight.", {"team": CALLER}, tendencies),
    Tool("caller_profile", "Reading the play-caller's profile",
         "Who the modeled play-caller is and what his model is built on: team, seasons, snaps and games, when it "
         "was built, the memory settings and the held-out evidence.", {"team": CALLER}, caller_profile),
    Tool("model_explainer", "Reading how the model works",
         "How the model works, in plain words: the league baseline, his habits, the in-game memory, play types, "
         "grading, the tilt and the limits of ESPN's free data.", {}, model_explainer),
)
TOOLS_BY_NAME = {t.name: t for t in TOOLS}


@dataclass(frozen=True)
class ToolResult:
    name: str
    label: str | None              # None for a tool that doesn't exist
    text: str                      # what the model reads: compact JSON, defused, at most MAX_RESULT_CHARS
    seqs: tuple                    # the plays the result names, in order (citations)
    ok: bool


def schemas(snap: Snapshot) -> list:
    """The tools in Ollama's format, with the teams and callers of this snapshot in their enums."""
    return [{"type": "function", "function": {
        "name": t.name, "description": t.description,
        "parameters": {"type": "object", "properties": {k: p.schema(snap) for k, p in t.params.items()},
                       "required": []}}} for t in TOOLS]


def run_tool(snap: Snapshot, name: object, args: object) -> ToolResult:
    """One tool call: arguments checked, the tool run, the result encoded and cut to fit. Never raises."""
    tool = TOOLS_BY_NAME.get(name) if isinstance(name, str) else None
    if tool is None:
        known = ", ".join(TOOLS_BY_NAME)
        return failed(str(name)[:40], None, f"There is no tool named {str(name)[:40]!r}. Tools: {known}.")
    try:
        result = tool.run(snap, **checked(tool, args, snap))
    except ArgError as e:
        return failed(tool.name, tool.label, str(e))
    except Exception:
        log.exception("Analyst tool %s failed with %r", tool.name, args)
        return failed(tool.name, tool.label, TOOL_FAULT)
    text, kept = fit(result)
    return ToolResult(tool.name, tool.label, text, tuple(seqs_in(kept)), "error" not in kept)


def checked(tool: Tool, args: object, snap: Snapshot) -> dict:
    if not isinstance(args, Mapping):
        raise ArgError("The arguments must be a JSON object.")
    args = {k: v for k, v in args.items() if not (isinstance(k, str) and not k.strip())}    # gpt-oss's {"": ""}
    unknown = [k for k in args if k not in tool.params]
    if unknown:
        takes = ", ".join(tool.params) or "no arguments"
        raise ArgError(f"Unknown argument {str(unknown[0])[:40]!r}: {tool.name} takes {takes}.")
    values = ((k, tool.params[k].check(k, v, snap)) for k, v in args.items())
    return {k: v for k, v in values if v is not None}              # left out: the tool's own default


def failed(name: str, label: str | None, message: str) -> ToolResult:
    return ToolResult(name, label, encode({"error": message}), (), False)


def encode(result: object) -> str:
    """Compact JSON the model reads, with the chat format's special tokens defused."""
    return defuse(json.dumps(result, ensure_ascii=False, separators=(",", ":"), default=plain))


def fit(result: dict) -> tuple:
    """(text, result) at most MAX_RESULT_CHARS long: the longest list is cut a row at a time, and says so."""
    text = encode(result)
    while len(text) > MAX_RESULT_CHARS:
        lists = [k for k, v in result.items() if isinstance(v, (list, tuple)) and v]
        if not lists:
            return encode({"error": TOO_LONG}), {"error": TOO_LONG}
        key = max(lists, key=lambda k: len(encode(result[k])))
        rows = list(result[key])[:-1]
        result = {**result, key: rows, "cut": True, "note": CUT_NOTE, **({"shown": len(rows)} if "shown" in result
                                                                           else {})}
        text = encode(result)
    return text, result


def seqs_in(value: object) -> list:
    """Every play seq a result names, in order."""
    if isinstance(value, Mapping):
        own = [value["seq"]] if isinstance(value.get("seq"), int) else []
        return own + [s for k, v in value.items() if k != "seq" for s in seqs_in(v)]
    if isinstance(value, (list, tuple)):
        return [s for v in value for s in seqs_in(v)]
    return []

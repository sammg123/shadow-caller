"""The analyst's snapshot of the game (docs/design/analyst.md section 2): private, read-only copies taken under the
app's LOCK, then derived without it the way the app derives them, plus the page's own formatting and grading rules.

capture() runs under LOCK and only copies (about 10 ms). build_snapshot() derives everything else with no lock held:
timeline.response() for the plays, drives, box score and status (the same function as /api/timeline), the engine's
own metrics() and predict() for the scorecard and the next call. In a watch, the engine and feed.applied hold only the
plays shown so far and the summary is only read through the timeline, so the snapshot never knows what comes next.
ESPN's text is kept as data: control characters stripped and length capped here, special tokens defused when a tool
result is encoded (defuse). The counting the tools hand the model (red zone trips, metrics by half, his last call on a
drive) and the profile's terms in words live here too, so the model never has to count.
"""
import copy
import json
import math
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, fields, is_dataclass
from types import MappingProxyType, SimpleNamespace
from typing import Any, TypeGuard, cast

import live
import timeline
from config import EXPLOSIVE_YARDS, SCRIPT_PLAYS
from features import MEMORY_COLS, logit, memory_values, sigmoid
from granular import FAMILIES, FAMILY_NAMES, LEAF_NAMES, leaf_is_dropback

PLAY_TEXT_MAX = 400                # ESPN's play text kept per play
NAME_MAX = 80
PLAYER_NAME_MAX = 40
PLAYER_STATS = {"passing": 2, "rushing": 6, "receiving": 8}    # ESPN's player box: the categories read, lines kept
STAT_MAX = 12                      # characters per stat
CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
VERDICT_WORDS = {"top1": "top pick", "top3": "in his top 3", "miss": "miss"}
TILT_WORDS = {"no edge": "Like the league", "lean pass": "Leans pass", "lean run": "Leans run",
              "TILT PASS": "Tilts pass", "TILT RUN": "Tilts run"}
KIND_NAMES = {"kickoff": "Kickoff", "punt": "Punt", "fg": "Field goal", "fg_miss": "Field goal",
              "penalty": "Penalty, no snap", "kneel": "Kneel", "spike": "Spike", "other": "Other snap",
              "timeout": "Timeout"}


# ---------------------------------------------------------------- formatting, as the page does it (model/format.js)
def finite(x: object) -> TypeGuard[float]:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def js_round(x: float) -> int:
    """JavaScript's Math.round: halves go up."""
    return math.floor(x + 0.5)


def pct(x: object) -> str | None:
    """0.4562 -> '46%'."""
    return f"{js_round(x * 100)}%" if finite(x) else None


def pct1(x: object) -> str | None:
    """One decimal under 10%, else whole: 0.0494 -> '4.9%', 0.14 -> '14%'."""
    if finite(x):
        v = x * 100
        return f"{v:.1f}%" if v < 9.95 else f"{js_round(v)}%"
    return None


def fixed(x: object, dp: int) -> str | None:
    return f"{x:.{dp}f}" if finite(x) else None


def signed1(x: object) -> str | None:
    """Always one decimal with a sign: 16.5 -> '+16.5', -0.04 -> '+0.0'."""
    if finite(x):
        return f"{js_round(x * 10) / 10 or 0.0:+.1f}"
    return None


def signed_int(n: object) -> str:
    return (f"+{n}" if n > 0 else str(n)) if finite(n) else ""


def int_text(n: object) -> str | None:
    return f"{js_round(n):,}" if finite(n) else None


def qtr_text(qtr: object) -> str:
    """1 -> 'Q1', 5 -> 'OT', 6 -> '2OT'."""
    if not isinstance(qtr, int) or isinstance(qtr, bool) or qtr < 1:
        return ""
    return f"Q{qtr}" if qtr <= 4 else ("OT" if qtr == 5 else f"{qtr - 4}OT")


def when_of(qtr: object, clock: object) -> str:
    q = qtr_text(qtr)
    return f"{q} {clock}" if q and isinstance(clock, str) and clock else q


def spot_text(yl100: object, own: str, opp: str) -> str | None:
    """A spot from the team with the ball: 70 -> 'DAL 30', 8 -> 'TB 8', 50 -> '50'."""
    if not finite(yl100):
        return None
    if yl100 == 50:
        return "50"
    return f"{own} {100 - yl100:g}" if yl100 > 50 else f"{opp} {yl100:g}"


def situation_text(down: object, togo: object, yl100: object, own: str, opp: str) -> str | None:
    """'1st & 10 at DAL 25'; 'Goal' when the distance reaches the goal line."""
    if isinstance(down, int) and 1 <= down <= 4 and finite(togo) and finite(yl100):
        dist = "Goal" if togo >= yl100 else f"{togo:g}"
        return f"{('1st', '2nd', '3rd', '4th')[down - 1]} & {dist} at {spot_text(yl100, own, opp)}"
    return None


def clean(text: object, cap: int) -> str:
    """ESPN's text as data: no control characters or em dashes, whitespace collapsed, at most cap characters."""
    if not isinstance(text, str):
        return ""
    t = " ".join(CONTROL_RE.sub(" ", text).replace("\u2014", "-").split())
    return t if len(t) <= cap else t[:cap - 3].rstrip() + "..."


def defuse(text: str) -> str:
    """gpt-oss's chat format is built from tokens like <|start|> and <|end|>, and Ollama tokenizes the rendered prompt,
    so text carrying one could forge a message. Every '<|' and '|>' loses its bar, until none is left."""
    while "<|" in text or "|>" in text:
        text = text.replace("<|", "<").replace("|>", ">")
    return text


def compact(d: Mapping) -> dict:
    """The keys that say something: no None, False or empty text or lists. A 0 stays (0 yards is a fact)."""
    return {k: v for k, v in d.items()
            if not (v is None or v is False or (isinstance(v, (str, list, tuple, Mapping)) and not v))}


def wp_after(snap: "Snapshot", home: object) -> dict | None:
    """ESPN's home win probability as the page rounds it, and the rest for the other team (the two add to 100%)."""
    away = next((t for t in snap.teams if t != snap.home), None)
    if finite(home) and snap.home and away:
        shown = js_round(home * 100)
        return {snap.home: f"{shown}%", away: f"{100 - shown}%"}
    return None


def x_spot(snap: "Snapshot", x: object) -> str | None:
    """A spot in the timeline's field frame (x = yards from the offense's own goal line in the game settings)."""
    if finite(x):
        yl = round(min(100.0, max(0.0, x)))
        return spot_text(100 - yl, snap.game["offense"], snap.game["opponent"])
    return None


def hot_of(p: float, pl: float) -> str:
    """The engine's arrow rule (live.GameEngine._hot)."""
    return live.GameEngine._hot(p, pl) if finite(p) and finite(pl) else ""


# ---------------------------------------------------------------- the snapshot
def freeze(value: object) -> Any:
    """Read-only all the way down: mappings become MappingProxyType, lists tuples."""
    if isinstance(value, Mapping):
        return MappingProxyType({k: freeze(v) for k, v in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(freeze(v) for v in value)
    return value


def plain(value: object) -> object:
    """json.dumps' fallback for the snapshot's read-only types."""
    if isinstance(value, MappingProxyType):
        return dict(value)
    if is_dataclass(value):
        return {f.name: getattr(value, f.name) for f in fields(value)}
    raise TypeError(f"{type(value).__name__} isn't JSON")


@dataclass(frozen=True)
class Caller:
    """One tracked play-caller: his model and his night so far."""
    name: str
    team: str
    profile: Mapping
    log: tuple                     # engine log rows: his snaps, each with the prediction stored before it
    metrics: Mapping               # engine.metrics(): the scorecard's numbers
    prediction: Mapping | None     # engine.predict() while his offense has the ball
    on_field: bool
    sit: Mapping                   # the engine's situation
    memory_parts: Mapping          # log seq -> the memory terms that moved that snap (memory_parts())


@dataclass(frozen=True)
class Snapshot:
    """The game as the analyst sees it (docs/design/analyst.md section 2)."""
    game: Mapping                  # config.GAME
    mode: str                      # live, watch, replay or manual
    source: str                    # espn (both teams) or log (his typed snaps)
    teams: tuple                   # away, home
    home: str | None
    team_names: Mapping
    status: Mapping                # the timeline status (C5)
    plays: tuple                   # play_record() of every applied play but admin rows (timeouts stay), seq order
    drives: tuple
    box: Mapping                   # ESPN's box score when the app shows it, else the one counted from the plays
    box_source: str
    callers: tuple                 # one Caller today; two when both sides are tracked
    watch: Mapping | None          # state, idx, total while a watch session is on
    players: Mapping | None = None     # ESPN's player box ({team: {category: [line]}}), only with ESPN's box


def dump(snap: Snapshot) -> str:
    """The whole snapshot as JSON (tests compare it before and after the tools run)."""
    return json.dumps(plain(snap), default=plain, sort_keys=True)


def capture(engine, feed, game: Mapping, *, mode: str, watch: Mapping | None = None) -> dict:
    """Under the app's LOCK: private copies of everything the tools read (about 10 ms). Nothing is derived here."""
    state = copy.deepcopy(engine.state)
    return {"state": state, "summary": copy.deepcopy(feed.load_summary()), "applied": list(feed.applied),
            "skipped": list(feed.skipped_ids), "prediction": engine.predict() if state.get("drive_active") else None,
            "metrics": engine.metrics(), "profile": copy.deepcopy(engine.profile), "game": copy.deepcopy(dict(game)),
            "mode": mode, "epoch": engine.epoch(), "watch": copy.deepcopy(watch) if watch else None}


def take_snapshot(engine, feed, lock, game: Mapping, *, mode: Callable[[], str],
                  watch: Callable[[], Mapping | None] = lambda: None) -> Snapshot:
    """The analyst's snapshot: copies under `lock` (mode() and watch() are read there too), derived without it."""
    with lock:
        raw = capture(engine, feed, game, mode=mode(), watch=watch())
    return build_snapshot(raw)


def build_snapshot(raw: dict) -> Snapshot:
    """Everything the tools read, derived from capture()'s copies with the app's own functions."""
    game, state, watch = raw["game"], raw["state"], raw["watch"]
    body = timeline.response(raw["summary"], raw["applied"], state, game, epoch=raw["epoch"], mode=raw["mode"],
                             cache={}, skipped=raw["skipped"])
    teams = body.get("teams") or {}
    return Snapshot(
        game=freeze(game), mode=raw["mode"], source=body["source"], teams=tuple(body.get("team_order") or ()),
        home=next((t for t, v in teams.items() if v.get("home")), None),
        team_names=freeze({t: clean(v.get("display_name"), NAME_MAX) or t for t, v in teams.items()}),
        status=freeze(body["status"]),
        plays=freeze([play_record(r) for r in body["rows"] if r["kind"] != "admin" or is_timeout(r)]),
        drives=freeze(body["drives"]), box=freeze(body["box_espn"] or body["box"]), box_source=body["box_source"],
        callers=(caller_of(raw),),
        watch=freeze({k: watch.get(k) for k in ("state", "idx", "total")}) if watch else None,
        players=freeze(player_lines(raw["summary"], body.get("team_order") or ())) if body["box_espn"] else None)


def player_lines(summary: object, teams: tuple) -> dict:
    """ESPN's player box for these teams (passing, rushing, receiving), as data: each line the player's name and
    ESPN's labeled stats, cleaned and capped. Read only when the app shows ESPN's box score, so it never spoils."""
    groups = [g for g in as_list(as_map(as_map(summary).get("boxscore")).get("players")) if isinstance(g, Mapping)]
    return {t: {str(s["name"]): stat_lines(s) for g in groups if as_map(g.get("team")).get("abbreviation") == t
                for s in as_list(g.get("statistics")) if isinstance(s, Mapping) and str(s.get("name")) in PLAYER_STATS}
            for t in teams}


def stat_lines(stat: Mapping) -> list:
    labels = [clean(x, STAT_MAX) for x in as_list(stat.get("labels"))]
    athletes = [a for a in as_list(stat.get("athletes")) if isinstance(a, Mapping)][:PLAYER_STATS[str(stat["name"])]]
    return [{"player": clean(as_map(a.get("athlete")).get("displayName"), PLAYER_NAME_MAX),
             **dict(zip(labels, (clean(str(v), STAT_MAX) for v in as_list(a.get("stats"))), strict=False))}
            for a in athletes]


def as_map(x: object) -> Mapping:
    return x if isinstance(x, Mapping) else {}


def as_list(x: object) -> list:
    return list(x) if isinstance(x, (list, tuple)) else []


def caller_of(raw: dict) -> Caller:
    """The engine's play-caller: the profile's name, the game's offense (the team the timeline calls the caller)."""
    state, profile = raw["state"], raw["profile"]
    return Caller(name=str(profile.get("caller") or "the play-caller"), team=raw["game"]["offense"],
                  profile=freeze(profile), log=freeze(state.get("log") or []), metrics=freeze(raw["metrics"]),
                  prediction=freeze(raw["prediction"]) if raw["prediction"] else None,
                  on_field=bool(state.get("drive_active")), sit=freeze(state["sit"]),
                  memory_parts=freeze(memory_parts(state.get("log") or [], profile)))


def is_timeout(row: Mapping) -> bool:
    return row["kind"] == "admin" and (row.get("admin") or {}).get("what") == "timeout"


def memory_parts(log_rows: list, profile: Mapping) -> dict:
    """{log seq: [{term, pts}] or None}: the in-game memory terms that moved each logged snap's pass chance, rebuilt
    the way live.GameEngine built them before the snap (_predict, then record_play's update): the value gap replayed
    from q0 with learning rate alpha over his snaps that stood, the previous call reset at each drive, and the terms
    added in MEMORY_COLS order from logit(p_habits). None for a row too old to say; {} for a profile without the
    memory terms (a run/pass-only model)."""
    coefs = profile.get("coefs") or {}
    if not (all(c in coefs for c in MEMORY_COLS) and finite(profile.get("alpha")) and finite(profile.get("q0"))):
        return {}
    w, alpha = {c: coefs[c]["est"] for c in MEMORY_COLS}, profile["alpha"]
    out, qp, qr, prev, drive = {}, profile["q0"], profile["q0"], None, object()
    for r in (r for r in log_rows if live.is_snap(r)):
        if r.get("drive") != drive:
            prev, drive = None, r.get("drive")
        out[r.get("seq")] = parts_at(r, prev, qp - qr, w, coefs)
        if r.get("nullified") or r.get("success") not in (0, 1):
            continue                                   # a flag wiped it out: scored, never remembered
        if r.get("dropback"):
            qp += alpha * (r["success"] - qp)
        else:
            qr += alpha * (r["success"] - qr)
        prev = {"type": 1 if r.get("dropback") else -1, "success": r["success"],
                "explosive": int((r.get("yards") or 0) >= EXPLOSIVE_YARDS), "sack": int(r.get("outcome") == "sack")}
    return out


def parts_at(row: Mapping, prev: dict | None, dq: float, w: Mapping, coefs: Mapping) -> list | None:
    if not (finite(row.get("p_habits")) and isinstance(row.get("snap"), int)):
        return None
    mem = memory_values(row["snap"], prev, dq, SCRIPT_PLAYS)
    z, parts = float(logit(row["p_habits"])), []
    for c in MEMORY_COLS:
        if abs(mem[c]) > 1e-9:
            before = float(sigmoid(z))
            z += w[c] * mem[c]
            parts.append({"term": coefs[c]["label"], "pts": round(100 * (float(sigmoid(z)) - before), 1)})
    return parts


# ---------------------------------------------------------------- one play, compact
def play_record(row: Mapping) -> dict:
    """A timeline row (ESPN's or a typed one) as the facts the tools use."""
    pre, res, call, pred = row["pre"] or {}, row["result"] or {}, row["call"] or {}, row["pred"]
    timeout = is_timeout(row)
    team = (row.get("admin") or {}).get("by") if timeout else row["team"]
    return {
        "seq": row["seq"], "qtr": row["qtr"], "clock": row["clock"], "when": when_of(row["qtr"], row["clock"]),
        "kind": "timeout" if timeout else row["kind"], "team": team,
        "opp": row["opp"] if team == row["team"] else row["team"],      # a timeout: the team that didn't call it
        "down": pre.get("down"), "togo": pre.get("togo"), "yardline_100": pre.get("yardline_100"),
        "goal_to_go": pre.get("goal_to_go"), "situation": pre.get("text"), "after": (row["post"] or {}).get("text"),
        "play": play_name(row), "side": (row["geo"] or {}).get("lat"), "result": result_word(row),
        "yards": res.get("yards"), "first_down": bool(res.get("first_down")), "td": bool(res.get("td")),
        "turnover": res.get("turnover_kind") or bool(res.get("turnover")), "nullified": bool(res.get("nullified")),
        "flag": penalty_text(res.get("penalty")), "scoring": row["scoring"], "score": row["score"], "wp": row["wp"],
        "family": call.get("family"), "leaf": call.get("leaf"), "outcome": call.get("outcome"),
        "dropback": pred["dropback"] if pred else call_dropback(call) if call else None,
        "text": clean(row["text"], PLAY_TEXT_MAX), "pred": pred,
    }


def call_dropback(call: Mapping) -> int | None:
    """Pass (1) or run (0) the way the engine decides it (live.GameEngine._resolve_call)."""
    if call.get("outcome"):
        return 1
    if call.get("leaf") in LEAF_NAMES:
        return leaf_is_dropback(call["leaf"])
    if call.get("family") in FAMILIES:
        return int(call["family"] in ("dropback", "pa", "screen"))
    return None


def play_name(row: Mapping) -> str:
    """His call as the engine named it; another snap from its family and leaf; else the kind of play."""
    pred, call = row["pred"], row["call"]
    if pred and pred.get("name"):
        return clean(pred["name"], NAME_MAX)
    if row["kind"] == "play" and call:
        name = LEAF_NAMES.get(call.get("leaf") or "") or FAMILY_NAMES.get(call.get("family") or "") or "Snap"
        return f"{name}, {call['outcome']}" if call.get("outcome") else name
    return KIND_NAMES.get("timeout" if is_timeout(row) else row["kind"], "Snap")


def result_word(row: Mapping) -> str:
    """The field's result word (model/format.js resultText): '+8', 'INC', 'TD', 'INT', 'FLAG', 'PUNT 53'."""
    res, kind = row["result"] or {}, row["kind"]
    if kind == "admin":
        return ""
    if res.get("nullified") or kind == "penalty":
        return "FLAG"
    if res.get("safety"):
        return "SAFETY"
    if (row["scoring"] or {}).get("type") == "TD":
        return f"{turnover_word(res)} TD" if res.get("turnover") else "TD"
    if kind in ("kickoff", "punt", "fg", "fg_miss"):
        return kick_word(row, res)
    if res.get("turnover"):
        return turnover_word(res)
    if (row["call"] or {}).get("outcome") == "incomplete":
        return "INC"
    return "SPIKE" if kind == "spike" else signed_int(res.get("yards"))


def turnover_word(res: Mapping) -> str:
    return {"int": "INT", "fumble": "FUMBLE"}.get(str(res.get("turnover_kind")), "TURNOVER")


def kick_word(row: Mapping, res: Mapping) -> str:
    kick, kind = row["kick"] or {}, row["kind"]
    dist = f" {kick['dist']}" if finite(kick.get("dist")) else ""
    if kind == "fg":
        return f"FG{dist} GOOD"
    if kind == "fg_miss":
        return "FG BLOCKED" if kick.get("blocked") else "FG MISSED"
    if res.get("turnover"):
        return "FUMBLE"
    if kick.get("blocked"):
        return "PUNT BLOCKED" if kind == "punt" else "KICK BLOCKED"
    if kind == "punt":
        return f"PUNT{dist}"
    return "TOUCHBACK" if kick.get("touchback") else f"KICKOFF{dist}"


def penalty_text(pen: Mapping | None) -> str | None:
    """'Defensive Offside on TB, 4 yds, no play'."""
    if not pen:
        return None
    foul = clean(pen.get("foul") or pen.get("code") or "Penalty", 60)
    parts = [f"{foul} on {pen['on']}" if pen.get("on") else foul]
    if finite(pen.get("yards")):
        parts.append(f"{pen['yards']} yds")
    if pen.get("no_play"):
        parts.append("no play")
    if pen.get("status") not in (None, "enforced"):
        parts.append(str(pen["status"]))
    return ", ".join(parts)


def scoring_text(sc: Mapping | None) -> str | None:
    return f"{sc['team']} {sc.get('type') or 'score'} +{sc.get('pts')}" if sc else None


# ---------------------------------------------------------------- grades (model/verdict.js, model/vm-log.js)
def verdict_of(pred: Mapping | None) -> tuple[str | None, int | None]:
    """(top1 | top3 | miss | None, rank): the specific play's rank when it has one, else the play type, else pass vs
    run, like the page's verdictOf. 'In his top 3' is only ever claimed for a specific play."""
    if not pred:
        return None, None
    rank = pred.get("leaf_rank")
    if isinstance(rank, int) and not isinstance(rank, bool) and rank > 0:
        return ("top1" if rank == 1 else "top3" if rank <= 3 else "miss"), rank
    if pred.get("family") and pred.get("fam_top"):
        return ("top1" if pred["fam_top"] == pred["family"] else "miss"), None
    if finite(pred.get("p")) and pred.get("dropback") in (0, 1):
        return ("top1" if (pred["p"] >= 0.5) == (pred["dropback"] == 1) else "miss"), None
    return None, None


def his_pct_on(pred: Mapping) -> str | None:
    """His chance on what he called, as the play log shows it: the specific play's, else the play type's."""
    return pct1(pred["leaf_p"]) if finite(pred.get("leaf_p")) else pct1(pred.get("fam_p"))


def grade(pred: Mapping) -> dict:
    """A listed call's grade: the verdict, the rank of what he called, the model's chance on it, its top pick."""
    key, rank = verdict_of(pred)
    top = pred.get("top_leaf")
    return compact({"verdict": VERDICT_WORDS.get(key or ""), "rank": rank, "model_chance": his_pct_on(pred),
                    "model_top_pick": f"{LEAF_NAMES.get(top, top)} {pct(pred.get('top_leaf_p'))}" if top else None,
                    **tilt_call(pred)})


def tilt_call(pred: Mapping) -> dict:
    """The card's tag before the snap when it fired (a tilt or a lean), and whether he called it its way: the
    engine's rule for a tilt that came true (live.GameEngine.metrics), applied to leans too."""
    flag = str(pred.get("flag") or "")
    if flag in ("", "no edge") or pred.get("dropback") not in (0, 1):
        return {}
    went_its_way = flag.lower().endswith("pass") == bool(pred["dropback"])
    return {"tilt": tilt_words(flag), "tilt_came_true": "yes" if went_its_way else "no"}


def tilt_words(flag: object) -> str | None:
    """The card's words for the engine's flag; 'no edge' means he calls it like the league, never that the model
    has no edge."""
    return TILT_WORDS.get(str(flag)) or (str(flag).capitalize() if flag else None)


# ---------------------------------------------------------------- counts the tools read (the model shouldn't count)
def came_true(tags: list, word: str) -> str | None:
    """'1 of 2': of the calls the card tagged this way (Tilts or Leans), how many he called its way."""
    hits = [t["tilt_came_true"] for t in tags if t.get("tilt", "").startswith(word)]
    return f"{hits.count('yes')} of {len(hits)}" if hits else None


RED_ZONE_KINDS = ("play", "kneel", "spike", "penalty", "fg", "fg_miss")


def red_zone(snap: Snapshot) -> dict:
    """Per team: trips (drives with a snap inside the opponent's 20, flags included, the way ESPN counts them) and
    how many ended in a touchdown or a field goal."""
    trips = [d for d in snap.drives if any(p["kind"] in RED_ZONE_KINDS and finite(p["yardline_100"])
                                           and p["yardline_100"] <= 20 for p in drive_plays(snap, d))]
    return {t: {"trips": sum(1 for d in trips if d["team"] == t),
                "touchdowns": sum(1 for d in trips if d["team"] == t and scored(snap, d, "TD")),
                "field_goals": sum(1 for d in trips if d["team"] == t and scored(snap, d, "FG"))} for t in snap.teams}


def drive_plays(snap: Snapshot, d: Mapping) -> list:
    seqs = list(d.get("seq") or ())
    return [p for p in snap.plays if p["team"] == d["team"] and seqs[0] <= p["seq"] <= seqs[-1]] if seqs else []


def scored(snap: Snapshot, d: Mapping, kind: str) -> bool:
    return any((p["scoring"] or {}).get("team") == d["team"] and p["scoring"].get("type") == kind
               for p in drive_plays(snap, d))


def last_call_on_drive(snap: Snapshot, c: Caller, log_seq: object) -> dict | None:
    """His last call that stood earlier on this drive: the one the memory's last-call terms react to (the row
    memory_parts remembers as the previous call)."""
    snaps = [r for r in c.log if live.is_snap(r)]
    at = next((i for i, r in enumerate(snaps) if r.get("seq") == log_seq), None)
    if at is None:
        return None
    kept = [r for r in snaps[:at] if r.get("drive") == snaps[at].get("drive") and not r.get("nullified")
            and r.get("success") in (0, 1)]
    if not kept:
        return None
    last = kept[-1]
    p = next((x for x in snap.plays if (x["pred"] or {}).get("log_seq") == last.get("seq")), None)
    return compact({"when": p["when"] if p else None, "play": p["play"] if p else None,
                    "result": p["result"] if p else None, "pass_or_run": "pass" if last.get("dropback") else "run",
                    "worked": "yes" if last["success"] else "no"})


def last_call_read(c: Caller | None, parts: list | None, before: Mapping | None) -> str | None:
    """The stickiness term at one snap in words: its label says repeat, but its sign here says which way he went."""
    label = (((c.profile.get("coefs") or {}).get("last") or {}).get("label")) if c else None
    pts = next((m["pts"] for m in parts or () if m["term"] == label), None)
    if not (before and finite(pts) and pts):
        return None
    toward = "pass" if pts > 0 else "run"
    how = "repeating" if toward == before["pass_or_run"] else "switching from"
    return (f"His last call on this drive was a {before['pass_or_run']}, so the stickiness term ({signed1(pts)} pass "
            f"points) moved this snap toward {toward}: {how} that call.")


def team_aliases(snap: Snapshot) -> dict:
    """'tampa bay', 'buccaneers' or 'tampa bay buccaneers' -> 'TB', from the snapshot's team names; a name two teams
    share (two from Los Angeles) stays out."""
    pairs = [(a, t) for t, name in snap.team_names.items() for a in name_aliases(str(name))]
    return {a: t for a, t in pairs if sum(1 for b, _ in pairs if b == a) == 1}


def name_aliases(name: str) -> set:
    words = name.lower().split()
    return {" ".join(words), " ".join(words[:-1]), words[-1]} - {""} if words else set()


NAME_SUFFIXES = frozenset({"jr", "sr", "ii", "iii", "iv", "v"})


def names_player(text: object, player: str) -> bool:
    """Whether ESPN's play text names this player, by his last name ('George Pickens' and 'G.Pickens' both look
    for pickens as a word)."""
    words = [w for w in re.findall(r"[a-z][a-z'-]*", player.lower()) if w not in NAME_SUFFIXES]
    return bool(words) and isinstance(text, str) and re.search(rf"\b{re.escape(words[-1])}\b", text.lower()) is not None


def half_name(qtr: object) -> str | None:
    if not isinstance(qtr, int) or isinstance(qtr, bool) or qtr < 1:
        return None
    return "1st half" if qtr <= 2 else "2nd half" if qtr <= 4 else "OT"


SPLITS = {"down": lambda r: r.get("down") if isinstance(r.get("down"), int) else None,
          "quarter": lambda r: qtr_text(r.get("qtr")) or None, "half": lambda r: half_name(r.get("qtr"))}


def splits(c: Caller, by: str) -> list:
    """The engine's own metrics() on his snaps of each down (in order), quarter or half (in game order)."""
    key = SPLITS[by]
    snaps = [dict(r) for r in c.log if live.is_snap(r)]
    seen = [v for v in (key(r) for r in snaps) if v is not None]
    return [split_row(by, v, [r for r in snaps if key(r) == v])
            for v in (sorted(set(seen)) if by == "down" else dict.fromkeys(seen))]


def split_row(by: str, value: object, rows: list) -> dict:
    # metrics() reads only self.state["log"]: a stand-in holding this slice gets the engine's own numbers
    m = live.GameEngine.metrics(cast(live.GameEngine, SimpleNamespace(state={"log": rows})))
    g = m.get("granular") or {}
    passes = sum(1 for r in rows if r.get("dropback") == 1)
    return compact({by: value, "snaps": m["n"], "his_passes": f"{passes} of {m['n']}",
                    "his_pass_rate": pct(m["dropback_rate"]), "shadow_got_pass_or_run_right": pct(m["acc_model"]),
                    "league_got_pass_or_run_right": pct(m["acc_league"]), "top_pick_right": leaf_count(g, "leaf_top1"),
                    "in_top_3": leaf_count(g, "leaf_top3"), "league_in_top_3": leaf_count(g, "leaf_top3_league"),
                    "shadow_pass_run_log_loss": fixed(m["logloss_model"], 3),
                    "league_pass_run_log_loss": fixed(m["logloss_league"], 3)})


def leaf_count(g: Mapping, key: str) -> str | None:
    return f"{g[key]} of {g['leaf_n']}" if g.get("leaf_n") else None


# ---------------------------------------------------------------- the profile's terms, in words
TERM_ORDER = ("intercept", "early_down", "third_long", "trailing9", "red_zone", "dq", "last", "last_fail",
              "explosive_prev", "sack_prev")
SITUATIONS = {"early_down": "on 1st and 2nd down", "third_long": "on 3rd & 4+", "trailing9": "when trailing by 9+",
              "red_zone": "in the red zone"}
# (above zero, below zero): the overall lean applies on every snap and a situation's term adds to it there. The
# memory terms (features.memory_values): last, last_fail and explosive_prev are multiplied by his last call (+1 pass,
# -1 run) and the last two add to the stickiness term, dq is passes' running success minus runs', sack_prev unsigned.
TERM_MEANS = {
    "intercept": ("overall, more pass than the league calls in the same spots",
                  "overall, more run than the league calls in the same spots"),
    **{k: (f"{s}, more pass than his overall lean", f"{s}, less pass than his overall lean")
       for k, s in SITUATIONS.items()},
    "dq": ("leans toward whatever has been working tonight: pass when his passes have succeeded more than his runs",
           "leans away from whatever has been working tonight"),
    "last": ("repeats his last call: after a pass he leans pass, after a run he leans run",
             "switches from his last call: after a pass he leans run, after a run he leans pass"),
    "last_fail": ("after a failed play, pulls back toward repeating that kind of call (adds to the stickiness term)",
                  "after a failed play, pushes further toward switching (adds to the stickiness term)"),
    "explosive_prev": ("after a 20+ yard gain, pulls back toward repeating it (adds to the stickiness term)",
                       "after a 20+ yard gain, pushes further toward switching (adds to the stickiness term)"),
    "sack_prev": ("after a sack, leans pass", "after a sack, leans run"),
}


def after_last_call(coefs: Mapping) -> list | None:
    """The stickiness the model adds after each kind of previous call on the drive (features.memory_values): the
    last-call term, plus the failed-play or the 20+ yard term when it applies, added up (not any one term's
    estimate). Below zero he switches."""
    if not all(k in coefs for k in ("last", "last_fail", "explosive_prev")):
        return None
    last = coefs["last"]["est"]
    added = [(after, last + coefs[k]["est"]) for after, k in (("a failed play", "last_fail"),
                                                               ("a 20+ yard gain", "explosive_prev"))]
    return [{"after": "a call that worked", "added_up": round(last, 2), "means": stick_words(last)},
            *({"after": after, "added_up": round(v, 2), "means": stick_words(v, last)} for after, v in added)]


def stick_words(v: float, base: float | None = None) -> str:
    way = "repeats that kind of call" if v > 0 else "switches to the other kind"
    if base is None or (v > 0) != (base > 0):
        return way
    return f"{way}, {'more' if abs(v) > abs(base) else 'less'} than after a call that worked"


def term_row(key: str, c: Mapping) -> dict:
    above, below = TERM_MEANS.get(key, ("leans pass", "leans run"))
    return {"term": c.get("label"), "group": c.get("group"), "means": above if c["est"] >= 0 else below,
            "estimate": round(c["est"], 2), "interval_90": [round(c["lo"], 2), round(c["hi"], 2)],
            "sure": c["lo"] > 0 or c["hi"] < 0}

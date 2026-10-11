"""Playback over one game's ESPN play list (docs/design/restructure-v2.md sections 5 and 9): the pace of each play
(data contract E3), which plays the field draws (back and forward move by them), the progress bar's marks, and the
game's status from ESPN's header. Pure.

Pacing: seconds before each row at 1x, divided by the speed (Watch then multiplies by SHADOW_WATCH_SCALE). A caller
snap never comes sooner than its CALLER_FLOOR_S after the row before it (6 s below 4x, 4.8 s at 4x, 3.6 s above), so
the next call and its shadow plays stay on the field long enough to read (v1.4, G1-1).

idx is the Watch engine's counter, the ESPN plays applied (0 to total), so a seek to a mark's idx shows it: a drive or
quarter mark sits just before its first play (the play before it is the newest one drawn, and the next call is up),
a score mark just after the scoring play (the score is on the board). The marks span the whole game, future scores
included: Sam's progress bar asks for them (restructure-v2 overrides the data contract's E5 here).
"""
from collections.abc import Sequence
from typing import NamedTuple

import timeline
from espn_feed import classify, iter_drive_plays, whole_in
from timeline_text import _dict, _text, first_competition, short, split_body

# E3, seconds before a row at 1x. TB at DAL: 60 caller snaps, 78 opponent snaps, 18 kicks, 23 + 4 admin = 857 s.
PACE = {"caller_snap": 7.0, "snap": 4.0, "kick": 5.0, "admin": 1.0, "admin_end": 3.0}
# The least time before a caller snap, in seconds at that speed (before SHADOW_WATCH_SCALE): the play before it (1 to
# 1.7 s), what the page keeps for the next call (anim-queue.js CALL_RESERVE_MS: the verdict's beat, 1.5 s below 4x
# and 0.6 s from 4x, the call's fade-in, then 2 s of it fully lit up to 4x and 1 s above) and the page's poll.
# TB at DAL runs 9.6 minutes at 2x, 6.6 at 4x and 4.3 at 10x (14:17 at 1x, as before).
CALLER_FLOOR_S = {"slow": 6.0, "demo": 4.8, "fast": 3.6}
DEMO_SPEED = 4.0                                     # below it the slow floor, above it the fast one
SNAP_KINDS = ("play", "penalty", "kneel", "spike", "other")
END_ADMIN = ("end_period", "end_half", "end_game")
STATES = ("pre", "in", "post")
LIVE = ("pre", "in")               # not over: Go Live follows it (before kickoff too, so plays log as they come)
DETAIL_MAX = 40                    # ESPN's short detail: 'Final', '7:31 - 3rd'
CLOCK_MAX = 8
LAST_REGULATION_QTR = 4
SEP = " · "


# ---------------------------------------------------------------- E3: pacing
def pace_of(team: str | None, p: dict, caller: str) -> tuple[str, float]:
    """(pace, seconds before this row at 1x) for one ESPN play; pace is a PACE key."""
    info = classify(team, p)
    typ = (p.get("type") or {}).get("text") or ""
    kind = timeline.kind_of(info, typ, split_body(p.get("text"))[1])
    if kind in SNAP_KINDS:
        pace = "caller_snap" if team == caller else "snap"
    elif kind in timeline.KICKS:
        pace = "kick"
    else:
        what = next((w for key, w in timeline.ADMIN_WHAT if key in typ.lower()), "other")
        pace = "admin_end" if what in END_ADMIN else "admin"
    return pace, PACE[pace]


def pace_plan(plays: Sequence[tuple], caller: str) -> list[tuple[str, float]]:
    """[(pace, seconds at 1x)] for (team, play) pairs, in apply order."""
    return [pace_of(team, p, caller) for team, p in plays]


def delay_s(pace: str, seconds: float, speed: float) -> float:
    """Seconds before a row at `speed`, before SHADOW_WATCH_SCALE: its pace divided by the speed, and never under the
    caller-snap floor before a caller snap."""
    wait = seconds / speed
    if pace != "caller_snap":
        return wait
    band = "demo" if speed == DEMO_SPEED else "slow" if speed < DEMO_SPEED else "fast"
    return max(wait, CALLER_FLOOR_S[band])


# ---------------------------------------------------------------- the game's play list
class Mark(NamedTuple):
    """A tick on the progress bar. kind: drive, quarter or score; team is None for a quarter."""
    idx: int
    kind: str
    team: str | None
    label: str


class Game(NamedTuple):
    """status: pre, in, post or None (ESPN didn't say); detail: ESPN's short detail or None."""
    status: str | None
    detail: str | None


class PlayMap(NamedTuple):
    """One game's plays in apply order: their ESPN ids, whether each draws on the field, the marks and the status."""
    ids: tuple[str, ...]
    drawn: tuple[bool, ...]
    marks: tuple[Mark, ...]
    game: Game | None


def play_map(summary: object, caller: str) -> PlayMap:
    """The game's plays as the timeline draws them: a play draws when its row can be built (the timeline lists the
    others as missing) and isn't an admin row (timeouts, ends of quarters: B5, they draw nothing)."""
    plays = iter_drive_plays(summary)
    ids = tuple(timeline.row_id(p) for _, _, _, p in plays)
    rows = {r["id"]: r for r in timeline.build_timeline(summary, ids, [], caller)} if ids else {}
    drawn = tuple(i in rows and rows[i]["kind"] != "admin" for i in ids)
    return PlayMap(ids, drawn, marks_of(plays, rows), game_of(summary))


def marks_of(plays: Sequence[tuple], rows: dict) -> tuple[Mark, ...]:
    """Quarter and drive starts at the idx before their first play, scores at the idx after the scoring play: in idx
    order, as the plays come."""
    out, last_qtr, last_drive = [], None, None
    for i, (team, drive, _, p) in enumerate(plays):
        qtr = whole_in(_dict(p.get("period")).get("number"), 1, 9)
        if qtr is not None and qtr != last_qtr:
            out.append(Mark(i, "quarter", None, quarter_name(qtr)))
        if drive != last_drive and team:
            clock = short(_dict(p.get("clock")).get("displayValue"), CLOCK_MAX)
            out.append(Mark(i, "drive", team, SEP.join(x for x in (f"{team} ball", when(qtr, clock)) if x)))
        last_qtr, last_drive = qtr or last_qtr, drive
        scoring = (rows.get(timeline.row_id(p)) or {}).get("scoring")
        if scoring and scoring.get("team"):
            out.append(Mark(i + 1, "score", scoring["team"], f"{scoring['type'] or 'Score'} {scoring['team']}"))
    return tuple(out)


def quarter_name(qtr: int) -> str:
    """1 -> 'Q1', 5 -> 'OT', 6 -> '2OT' (format.js qtrText)."""
    if qtr <= LAST_REGULATION_QTR:
        return f"Q{qtr}"
    return "OT" if qtr == LAST_REGULATION_QTR + 1 else f"{qtr - LAST_REGULATION_QTR}OT"


def when(qtr: int | None, clock: str | None) -> str:
    """'Q1 12:04', or as much of it as ESPN gave."""
    return " ".join(x for x in (quarter_name(qtr) if qtr else None, clock) if x)


def game_of(summary: object) -> Game | None:
    """The game's status from ESPN's header (header.competitions[0].status.type): pre, in or post, and its short
    detail ('Final'). None when there is no summary."""
    if not isinstance(summary, dict):
        return None
    st = _dict(_dict(first_competition(summary).get("status")).get("type"))
    state = st.get("state")
    detail = _text(st.get("shortDetail"), DETAIL_MAX) or _text(st.get("detail"), DETAIL_MAX)
    return Game(state if state in STATES else None, detail)


def is_live(game: Game | None) -> bool:
    """A game ESPN says isn't over: in progress, or not started yet."""
    return game is not None and game.status in LIVE


# ---------------------------------------------------------------- one drawn play back or forward
def position(applied: Sequence[str], ids: Sequence[str]) -> int:
    """How many of the game's plays are on screen: the applied ids when they are its first plays in order, else 0
    (another game, or a typed one)."""
    n = len(applied)
    return n if n <= len(ids) and tuple(applied) == tuple(ids[:n]) else 0


def back_target(drawn: Sequence[bool], k: int) -> int:
    """With k plays on screen: just after the drawn play before the newest drawn one, or kickoff (0) when there is
    none."""
    shown = [i for i in range(min(k, len(drawn))) if drawn[i]]
    return shown[-2] + 1 if len(shown) > 1 else 0


def forward_target(drawn: Sequence[bool], k: int) -> int:
    """With k plays on screen: just after the next play that draws, or the end when no play left draws."""
    nxt = next((i for i in range(k, len(drawn)) if drawn[i]), None)
    return len(drawn) if nxt is None else nxt + 1

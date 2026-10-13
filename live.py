"""Live game engine: holds the situation, each tracked play-caller's in-game memory, every prediction and its result.

By default it tracks GAME's offense on tonight's build in models/, exactly as it always has. It can instead run on
play-caller bundles and track one or both offenses of the game (play-caller-models.md 7): the team with the ball
predicts with its own caller's model and memory, and a team nobody tracks gets no prediction. Calls and retags are in
live_calls.py, fouls in live_flags.py, the shorthand line in live_shorthand.py, the archive and the scorecard in
live_archive.py, the sides' models in live_sides.py.

The game file keeps today's shape while the engine tracks GAME's offense alone. Tracking other sides it adds `sides`
(the teams, in the order given), `poss` (the team whose drive is on, or was last) and keeps `mem` per team.
"""
import threads  # noqa: F401  (first: pins OpenMP/BLAS before numpy and sklearn load)
import copy
import json
import logging
import os
import re
import secrets
from datetime import datetime
from types import MappingProxyType

import numpy as np

from callers import ModelVersionError  # noqa: F401  (app.py catches it from here: models/ or a caller's bundle)
from config import DB_PATH, EXPLOSIVE_YARDS, GAME, LEAN, MODEL_DIR, SCRIPT_PLAYS, STATE_PATH, TILT
from features import HABIT_COLS, MEMORY_COLS, base_row, habit_values, logit, memory_values, sigmoid, visible_success
from granular import FAMILIES, FAMILY_NAMES, LEAF_FAMILY, LEAF_NAMES, LEAVES, TAP_CYCLES, predict_tree
from live_archive import ArchiveMixin, csv_cell, is_snap, scorecard  # noqa: F401  (csv_cell, is_snap: re-exported)
from live_calls import CallsMixin
from live_flags import PEN_SHORT, PENALTIES, TOGO_MAX, FlagsMixin  # noqa: F401  (the tables: re-exported)
from live_shorthand import ShorthandMixin, parse_clock  # noqa: F401  (parse_clock: re-exported)
from live_sides import make_sides, side_game, side_sit, track_key

log = logging.getLogger(__name__)

HOT_PTS, HOT_RATIO = 0.04, 1.3
YARDS_MAX = 100                    # a play gains or loses at most this (G1-9: the API took -999999999999)
SCORE_MAX = 199
FEED_TEXT_MAX = 400                # ESPN's play text kept on a log row (G1-12)
TURNOVER_KINDS = (None, "int", "fumble")
BOOT_ID = secrets.token_hex(2)     # new on every server start; the first half of the timeline epoch
HISTORY_STEPS = 200                # undo steps kept in memory
DRIVE_ENDS = {"punt": "Punt.", "fg": "Field goal good (+3).", "fg_miss": "Field goal missed.", "half": "End of half."}
ESPN_UNDO_FLOOR = ("Undo can't take back a play ESPN logged: the feed would never log it again. Retag the last play "
                   "with A, N, O or P, or type the fix.")


class UndoRefused(ValueError):
    """An undo that would step back past a play ESPN applied (the feed, a replay or a watch). The app answers 409."""


SAFE_NAME_RE = re.compile(r"[A-Za-z0-9_]{1,40}")
MAX_SAME_SECOND = 99               # copies kept aside in one second are named -2 to -99


def file_safe(text):
    """`text` when it can sit in a file name as it is (letters, digits, underscores, 40 at most), else 'unknown'."""
    return text if isinstance(text, str) and SAFE_NAME_RE.fullmatch(text) else "unknown"


def keep_aside(kind, why):
    """Copy the game file to live_state.<kind>-<time>.json before anything can write over it ('xb': never over an
    older copy; another in the same second gets -2, -3 ...). Returns the copy's name, or None if it couldn't be made
    (the warning in the server log says why)."""
    stamp = f"{datetime.now():%Y%m%d-%H%M%S}"
    try:
        data = STATE_PATH.read_bytes()
        for n in range(1, MAX_SAME_SECOND + 1):
            dest = STATE_PATH.with_name(f"live_state.{kind}-{stamp}{'' if n == 1 else f'-{n}'}.json")
            try:
                f = open(dest, "xb")
            except FileExistsError:
                continue
            try:
                with f:
                    f.write(data)
            except OSError:
                dest.unlink(missing_ok=True)       # never half a copy
                raise
            log.warning("%s: kept a copy as %s; starting a fresh %s game.", why, dest.name, GAME["game_id"])
            return dest.name
        raise OSError(f"{MAX_SAME_SECOND} copies named live_state.{kind}-{stamp} already")
    except OSError as err:
        log.warning("%s, and no copy of it could be kept (%s).", why, err)
        return None


def sides_for(game, caller=None, callers=None):
    """The sides an engine runs on for `game` (live_sides.make_sides on models/, read at call time): what the
    constructor and reload make, and what a game switch makes for the new game before it leaves the one on screen."""
    return make_sides(game, MODEL_DIR, caller, callers)


def fmt_clock(sec):
    sec = max(0, int(round(sec)))
    return f"{sec // 60}:{sec % 60:02d}"


class GameEngine(CallsMixin, FlagsMixin, ShorthandMixin, ArchiveMixin):
    def __init__(self, caller=None, callers=None):
        """caller: one play-caller's bundle (callers.load_caller) for GAME's offense. callers: {team: bundle} for one
        or both teams of GAME, in the order the sides are listed (away, then home). Neither: tonight's build in
        models/ for GAME's offense, exactly as before. ValueError for anything else, before anything is read;
        FileNotFoundError or ModelVersionError when models/ is missing or was built with another scikit-learn."""
        self._use(sides_for(GAME, caller, callers))
        self.history = []
        self.undo_floor = None             # why an undo with no steps left is refused (ESPN plays behind it), or None
        self.epoch_n = 0
        self._batching = False             # command(): one checkpoint and one save for the whole line
        self.kept_aside = None             # the old game file _load copied aside, named once in the message
        self.state = self._open()
        self._version = self.state.get("version", 0)

    def _use(self, sides):
        """Run on these sides (live_sides.Side, in the order listed) from now on. The first side's models stay
        reachable as profile, stage1, G, w, alpha and q0, as before: GAME's offense's when it is tracked."""
        self.models = MappingProxyType({s.team: s for s in sides})
        self.sides = tuple(self.models)
        self.per_side = self.sides != (GAME["offense"],)
        self.track = track_key(self.sides)
        lead = self.models[self._lead()]
        self.profile, self.stage1, self.G = lead.profile, lead.stage1, lead.granular
        self.w, self.alpha, self.q0 = dict(lead.w), lead.alpha, lead.q0
        self._pred_memo = None

    def reload(self, caller=None, callers=None, *, sides=None):
        """Switch to another track in place (the app's feed and watch keep this engine): its play-callers' models,
        taken as the constructor takes them (nothing changes when that fails), or `sides` made for GAME ahead of time
        (sides_for: a game switch loads them before it leaves the game on screen, and puts the old ones back with no
        load at all), then its game at STATE_PATH, read now (the app points it at the track's folder first), or a
        fresh game. Undo steps go, the timeline epoch changes, and the version keeps going up."""
        self._use(sides_for(GAME, caller, callers) if sides is None else sides)
        self.clear_history()
        self.state = self._open()
        self.bump_epoch()

    def _open(self):
        state = self._load() or self._fresh()
        if self.kept_aside:
            state["message"] = f"Kept the old game file as {self.kept_aside}. {state['message']}"
        return state

    @property
    def version(self):
        """The newest version saved (or loaded). It only goes up, also across an undo, a reset, a replay or a watch
        that swaps in an older or fresh game, so another window that compares versions sees every change (G8).
        Lock-free readers (/api/version) never see it drop, not even while a reset is half done."""
        return max(self._version, self.state.get("version", 0))

    # ------------------------------------------------------------ timeline epoch
    def epoch(self):
        """Opaque id of the current timeline: '<boot>-<n>'. It changes when the drawn plays stop being
        append-only (reset, forget, replay, watch start or restore, an undo that takes a drawn row or prediction
        away, a server restart)."""
        return f"{BOOT_ID}-{self.epoch_n}"

    def bump_epoch(self):
        self.epoch_n += 1
        return self.epoch()

    # ------------------------------------------------------------ sides
    def _lead(self):
        """The side listed first in the view (profile, memory between drives): GAME's offense when tracked."""
        return GAME["offense"] if GAME["offense"] in self.models else self.sides[0]

    def _ball_team(self):
        """The tracked offense whose drive is on, or was last (the lead side before any drive)."""
        return (self.state.get("poss") or self._lead()) if self.per_side else self.sides[0]

    def _tracked(self, team):
        if team not in self.models:
            raise ValueError(f"{str(team)[:8]} isn't a side this engine tracks ({', '.join(self.sides)}).")
        return team

    def _other(self, team):
        return GAME["opponent"] if team == GAME["offense"] else GAME["offense"]

    def _mem(self, team=None):
        return self.state["mem"][team or self._ball_team()] if self.per_side else self.state["mem"]

    def _whose(self, team=None):
        """What every caller row and prediction carries: the offense and its play-caller."""
        team = team or self._ball_team()
        return {"team": team, "caller": self.models[team].caller}

    def _start_drive(self, team):
        """A drive of `team` (a tracked side) starts: the next engine drive number, no previous call on it."""
        self.state["drive_active"] = True
        self.state["drive_n"] += 1
        if self.per_side:
            self.state["poss"] = team
        self._mem(team)["prev"] = None

    def _stop_drive(self):
        """The drive on the field ends: its team's previous call is forgotten."""
        self.state["drive_active"] = False
        self._mem()["prev"] = None

    def _add_points(self, team, pts):
        key = "score_off" if team == GAME["offense"] else "score_opp"
        self.state["sit"][key] += pts

    def _who(self):
        """'DAL', or 'TB or DAL' with both sides: the offenses a drive can belong to."""
        return " or ".join(self.sides)

    def _waiting(self):
        return f"Waiting for the next {self.sides[0]} drive." if len(self.sides) == 1 else "Waiting for the next drive."

    def tracked(self):
        """[{team, caller, slug}] for every tracked side, in the order listed: /api/state's tracked."""
        return [{"team": t, "caller": s.caller, "slug": s.slug} for t, s in self.models.items()]

    # ------------------------------------------------------------ state
    def _fresh(self):
        state = {
            "game": GAME,
            "sit": {"down": 1, "togo": 10, "yardline_100": 75, "qtr": 1, "clock": 900,
                    "score_off": 0, "score_opp": 0, "clock_estimated": False},
            "drive_active": False,
            "drive_n": 0,
            "mem": self._fresh_mem(),
            "log": [],
            "message": (f"Set the start of {self.sides[0]}'s first drive." if len(self.sides) == 1
                        else "Set the start of the first drive."),
        }
        return {**state, "sides": list(self.sides), "poss": None} if self.per_side else state

    def _fresh_mem(self):
        def start(side):
            return {"snap_n": 0, "qp": side.q0, "qr": side.q0, "prev": None}
        if self.per_side:
            return {t: start(s) for t, s in self.models.items()}
        return start(self.models[self.sides[0]])

    def _load(self):
        """The saved game, or None (no file, or not this game). The fresh game's first save would destroy whatever
        else the file holds, so it is copied aside first and named in the message: a file that can't be read as
        live_state.unreadable-<time>.json, another game's (every new matchup in config.py) or one with no game in
        it as live_state.other-<game_id>-<time>.json, this game tracked from other sides as
        live_state.sides-<game_id>-<time>.json."""
        self.kept_aside = None
        if not STATE_PATH.exists():
            return None
        try:
            s = json.loads(STATE_PATH.read_text())
        except (OSError, ValueError) as ex:
            self.kept_aside = keep_aside("unreadable", f"Couldn't read {STATE_PATH.name} ({ex})")
            return None
        game = s.get("game") if isinstance(s, dict) else None
        gid = game.get("game_id") if isinstance(game, dict) else None
        if gid != GAME["game_id"]:
            what = f"the {gid} game" if isinstance(gid, str) else "no game this app can read"
            self.kept_aside = keep_aside(f"other-{file_safe(gid)}", f"{STATE_PATH.name} holds {what}"[:160])
            return None
        if not self._fits(s):
            self.kept_aside = keep_aside(f"sides-{file_safe(gid)}", f"{STATE_PATH.name} tracks other sides")
            return None
        return self._upgrade(s)

    def _fits(self, s):
        """Whether a saved game tracks this engine's sides: today's shape for GAME's offense alone, else the same sides
        (in any order) with a memory for each."""
        saved, mem = s.get("sides"), s.get("mem")
        if not self.per_side:
            return saved is None and isinstance(mem, dict)
        return (isinstance(saved, list) and sorted(map(str, saved)) == sorted(self.sides) and isinstance(mem, dict)
                and all(isinstance(mem.get(t), dict) for t in self.sides) and s.get("poss") in (None, *self.sides))

    def _upgrade(self, s):
        """A game saved by an older build: its log rows have no seq (the timeline's key; seq has always been the
        1-based log position) and no team or caller (in today's shape every row is the one side's). Filled in here
        and saved with the next change."""
        if not isinstance(s.get("log"), list):
            return s
        side = None if self.per_side else self.models[self.sides[0]]
        whose = {} if side is None else {"team": side.team, "caller": side.caller}
        return {**s, "log": [_upgraded(i, r, whose) for i, r in enumerate(s["log"], start=1)]}

    def _save(self):
        """Write the whole file, then swap it in (os.replace): a save cut short leaves the last good game, never
        half of one. Watch mode and replays save about twice a play. Each save takes a new version, one above any
        this engine has used, even if the write then fails (a number is never handed out twice). Inside a shorthand
        line nothing is written: command() saves once, at the end."""
        if self._batching:
            return
        self._version = self.version + 1
        self.state["version"] = self._version
        tmp = STATE_PATH.with_name(STATE_PATH.name + ".tmp")
        try:
            tmp.write_text(json.dumps(self.state, indent=1))
            os.replace(tmp, STATE_PATH)
        except OSError:
            tmp.unlink(missing_ok=True)
            raise

    def _db_path(self):
        return DB_PATH                     # read at call time: tests sandbox live.DB_PATH

    def _checkpoint(self):
        if self._batching:
            return
        self.history.append(copy.deepcopy(self.state))
        self.history = self.history[-HISTORY_STEPS:]

    def clear_history(self):
        """Drop every undo step: the game on screen was replaced or its ESPN ids forgotten (a reset of an ESPN game,
        a watch starting or putting the game back). U then says 'Nothing to undo.'"""
        self.history, self.undo_floor = [], None

    def history_kept(self):
        """The undo steps and the floor behind them, as they stand: a game switch keeps them to give back."""
        return tuple(self.history), self.undo_floor

    def restore_history(self, kept):
        """Undo steps from history_kept, back as they were (a game switch that failed reloaded this game)."""
        steps, floor = kept
        self.history, self.undo_floor = list(steps), floor

    def seal_history(self, reason=ESPN_UNDO_FLOOR):
        """ESPN just applied a play (the feed, a replay or a watch). An undo step from before it would take its row
        out of the log, or roll back its clock, score and drive, while its id stays applied, and the feed would never
        log it again. So undo stops here: the steps behind are dropped and U past this point is refused with
        `reason`. Changes Sam makes after it (a retag, a typed fix) can still be undone."""
        self.history, self.undo_floor = [], reason

    def undo(self):
        """One step back. Refused (UndoRefused) when the only way back crosses a play ESPN applied; with no steps
        and nothing behind them, the message says there is nothing to undo."""
        if not self.history:
            if self.undo_floor:
                raise UndoRefused(self.undo_floor)
            self.state["message"] = "Nothing to undo."
            return
        had_rows = bool(self.state["log"])
        self.state = self.history.pop()
        self.state["message"] = "Undid the last action."
        self._save()
        if had_rows:
            self._db_delete_after(len(self.state["log"]))

    def reset(self):
        self._checkpoint()
        self.state = self._fresh()
        self._db_delete_after(0)
        self.bump_epoch()
        self._save()

    # ------------------------------------------------------------ prediction
    def predict(self, team=None):
        """The prediction for the next snap of `team` (by default the tracked offense with the ball, or that had it
        last), from its play-caller's model and in-game memory; it says whose it is (team, caller). Memoized on what
        _predict reads (the team, the situation, memory and GAME as that offense sees them), so an undo back to an
        older state can never get a stale answer. Returns a fresh copy each time; callers may change it."""
        team = self._ball_team() if team is None else self._tracked(team)
        sit, mem, game = side_sit(self.state["sit"], GAME, team), self._mem(team), side_game(GAME, team)
        key = json.dumps([team, sit, mem, game], sort_keys=True, default=str)
        if self._pred_memo is None or self._pred_memo[0] != key:
            self._pred_memo = (key, self._predict(team, sit, mem, game))
        return copy.deepcopy(self._pred_memo[1])

    def _predict(self, team, s, m, game):
        side = self.models[team]
        p0 = float(side.stage1.predict_proba(np.array([base_row(s, game)]))[0, 1])
        h = habit_values(s["down"], s["togo"], s["score_off"] - s["score_opp"], s["yardline_100"])
        snap_next = m["snap_n"] + 1
        mem = memory_values(snap_next, m["prev"], m["qp"] - m["qr"], SCRIPT_PLAYS)
        z0 = float(logit(p0))
        z_h = z0 + sum(side.w[c] * h[c] for c in HABIT_COLS)
        p_h = float(sigmoid(z_h))
        parts, z = [], z_h
        for c in MEMORY_COLS:
            dz = side.w[c] * mem[c]
            if abs(mem[c]) > 1e-9:
                before = float(sigmoid(z))
                z += dz
                parts.append({"term": side.profile["coefs"][c]["label"],
                              "pts": round(100 * (float(sigmoid(z)) - before), 1)})
        p = float(sigmoid(z))
        gap = p - p0
        if abs(gap) >= TILT:
            flag = "TILT PASS" if gap > 0 else "TILT RUN"
        elif abs(gap) >= LEAN:
            flag = "lean pass" if gap > 0 else "lean run"
        else:
            flag = "no edge"
        (lf, ll), (hf, hl) = predict_tree(side.granular, s, game, float(logit(p) - logit(p_h)))
        families = []
        for f in FAMILIES:
            leaves = [{"key": k, "name": LEAF_NAMES[k], "p": float(hl[k]), "p_league": float(ll[k]),
                       "hot": self._hot(hl[k], ll[k])}
                      for k in LEAVES if LEAF_FAMILY[k] == f]
            leaves.sort(key=lambda x: -x["p"])
            families.append({"key": f, "name": FAMILY_NAMES[f], "p": float(hf[f]), "p_league": float(lf[f]),
                             "hot": self._hot(hf[f], lf[f]), "leaves": leaves})
        families.sort(key=lambda x: -x["p"])
        ranked = sorted(LEAVES, key=lambda k: -hl[k])
        return {
            "p": p, "p_league": p0, "p_habits": p_h, "gap": gap, "flag": flag,
            "memory_parts": parts, "script": snap_next <= SCRIPT_PLAYS,
            "snap_next": snap_next,
            "value_gap": m["qp"] - m["qr"],
            "families": families,
            "top": [{"key": k, "name": LEAF_NAMES[k], "family": FAMILY_NAMES[LEAF_FAMILY[k]],
                     "p": float(hl[k]), "p_league": float(ll[k])} for k in ranked[:3]],
            "_tree": {"his_f": {k: float(v) for k, v in hf.items()}, "lg_f": {k: float(v) for k, v in lf.items()},
                      "his_l": {k: float(v) for k, v in hl.items()}, "lg_l": {k: float(v) for k, v in ll.items()},
                      "rank": ranked},
            **self._whose(team),
        }

    @staticmethod
    def _hot(p, pl):
        if p - pl >= HOT_PTS and p >= HOT_RATIO * pl:
            return "up"
        if pl - p >= HOT_PTS and pl >= HOT_RATIO * p:
            return "down"
        return ""

    # ------------------------------------------------------------ actions
    def set_situation(self, down=None, togo=None, yardline_100=None, qtr=None, clock=None,
                      score_off=None, score_opp=None, spot=None, team=None):
        """Any field can be set alone. Setting down, distance or field position while no tracked offense is on the
        field starts a drive there: `team`'s (by default the offense with the ball, or GAME's). Scores are GAME's
        offense's and its opponent's."""
        side = self._tracked(team) if team else self._ball_team() if self.state["drive_active"] else self._lead()
        if spot not in (None, ""):
            yardline_100 = self._parse_spot(spot, side)
        if down is not None and not 1 <= int(down) <= 4:
            raise ValueError("Down must be 1 to 4")
        if qtr is not None and not 1 <= int(qtr) <= 5:
            raise ValueError("Quarter must be 1 to 4 (5 = overtime)")
        if yardline_100 is not None and not 1 <= int(yardline_100) <= 99:
            raise ValueError("Ball must be between the goal lines")
        goal = isinstance(togo, str) and togo.strip().upper() in ("G", "GOAL")
        if togo is not None and not goal:
            togo = int(togo)
            if not 1 <= togo <= TOGO_MAX:
                raise ValueError(f"To go must be from 1 to {TOGO_MAX}")
        for score in (score_off, score_opp):
            if score is not None and not 0 <= int(score) <= SCORE_MAX:
                raise ValueError(f"A score must be from 0 to {SCORE_MAX}")
        self._checkpoint()
        if self.state["drive_active"] and side != self._ball_team():
            self._stop_drive()
        s = self.state["sit"]
        starting = not self.state["drive_active"] and any(v is not None for v in (down, togo, yardline_100))
        if yardline_100 is not None:
            s["yardline_100"] = int(yardline_100)
        if down is not None:
            s["down"] = int(down)
        if goal:
            s["togo"] = s["yardline_100"]
        elif togo is not None:
            s["togo"] = togo
        if qtr is not None:
            s["qtr"] = int(qtr)
        if clock is not None:
            s["clock"] = int(clock)
            s["clock_estimated"] = False
        if score_off is not None:
            s["score_off"] = max(0, int(score_off))
        if score_opp is not None:
            s["score_opp"] = max(0, int(score_opp))
        if starting:
            if down is None:
                s["down"] = 1
            if togo is None:
                s["togo"] = 10
            self._start_drive(side)
        s["togo"] = max(1, min(s["togo"], s["yardline_100"]))
        self.state["message"] = (f"Drive {self.state['drive_n']} started." if starting else "Saved.")
        self._save()

    def new_drive(self, yardline_100, qtr=None, clock=None, score_off=None, score_opp=None, team=None):
        """A drive of `team` (by default GAME's offense, or the one side tracked) starts at yardline_100."""
        side = self._tracked(team) if team else self._lead()
        if not 1 <= int(yardline_100) <= 99:
            raise ValueError("Ball must be between the goal lines")
        self._checkpoint()
        s = self.state["sit"]
        s.update({"down": 1, "yardline_100": int(yardline_100)})
        s["togo"] = min(10, s["yardline_100"])
        if qtr is not None:
            s["qtr"] = int(qtr)
        if clock is not None:
            s["clock"] = int(clock)
            s["clock_estimated"] = False
        if score_off is not None:
            s["score_off"] = int(score_off)
        if score_opp is not None:
            s["score_opp"] = int(score_opp)
        if self.state["drive_active"]:
            self._stop_drive()
        self._start_drive(side)
        self.state["message"] = f"Drive {self.state['drive_n']} started."
        self._save()

    def end_drive(self, how):
        """punt, fg, fg_miss or half. A field goal adds 3 for the offense with the ball, so it needs a drive (G22: it
        used to score off the field); the other ends are harmless without one."""
        if not isinstance(how, str) or how not in DRIVE_ENDS:
            raise ValueError("A drive ends with punt, fg, fg_miss or half.")
        if how == "fg" and not self.state["drive_active"]:
            off, opp = GAME["offense"], GAME["opponent"]
            raise ValueError(f"No {self._who()} drive in progress, so there's no field goal to add. "
                             f"To fix the score, type it like '{off} 3 {opp} 0'.")
        self._checkpoint()
        if how == "fg":
            self._add_points(self._ball_team(), 3)
        if self.state["drive_active"]:     # how the drive ended, for the timeline (punts and FGs log no snap)
            self.state.setdefault("drive_ends", {})[str(self.state["drive_n"])] = how
        self._stop_drive()
        self.state["message"] = f"{DRIVE_ENDS[how]} {self._waiting()}"
        self._save()

    def add_score(self, team, pts):
        """team 'off' or 'opp': GAME's offense or its opponent."""
        self._checkpoint()
        key = "score_off" if team == "off" else "score_opp"
        self.state["sit"][key] = max(0, self.state["sit"][key] + int(pts))
        self._save()

    def feed_sync(self, sit, offense_ball=None, team=None):
        """Apply the situation from the live feed without an undo step (scores are GAME's offense's and its
        opponent's). offense_ball True: `team` (by default GAME's offense, or the one side tracked) has the ball: a
        tracked team's drive starts or goes on there, ending another's; a team nobody tracks ends the drive on the
        field. False: `team` (by default whoever has it) doesn't have the ball, so its drive ends. None leaves
        possession alone."""
        s = self.state["sit"]
        for k in ("qtr", "clock", "score_off", "score_opp"):
            if sit.get(k) is not None:
                s[k] = int(sit[k])
        if sit.get("clock") is not None:
            s["clock_estimated"] = False
        if offense_ball is True:
            self._ball_to(team or self._lead(), sit)
        elif offense_ball is False and self.state["drive_active"] and team in (None, self._ball_team()):
            self._stop_drive()
        self._save()

    def _ball_to(self, team, sit):
        """`team` has the ball, with the down, distance and spot in `sit` (ESPN's, from its side)."""
        if team not in self.models:
            if self.state["drive_active"]:
                self._stop_drive()
            return
        if self.state["drive_active"] and self._ball_team() != team:
            self._stop_drive()
        if not self.state["drive_active"]:
            self._start_drive(team)
            self.state["message"] = f"Drive {self.state['drive_n']} started (ESPN)."
        s = self.state["sit"]
        for k in ("down", "togo", "yardline_100"):
            if sit.get(k) is not None:
                s[k] = int(sit[k])
        s["togo"] = max(1, min(s["togo"], s["yardline_100"]))

    def _sit_fields(self, team=None):
        team = team or self._ball_team()
        s, m = self.state["sit"], self._mem(team)
        own = side_sit(s, GAME, team)
        return {"seq": len(self.state["log"]) + 1, "snap": m["snap_n"] + 1, "drive": self.state["drive_n"],
                "time": datetime.now().strftime("%H:%M:%S"), "qtr": s["qtr"], "clock": fmt_clock(s["clock"]),
                "down": s["down"], "togo": s["togo"], "yardline_100": s["yardline_100"],
                "score": f"{own['score_off']}-{own['score_opp']}", "clock_est": bool(s.get("clock_estimated"))}

    def record_play(self, call=None, yards=0, td=False, turnover=False, penalty=False,
                    leaf=None, family=None, outcome=None, source="manual", feed=None, turnover_kind=None):
        """Granular: leaf (e.g. 'run_edge_left', 'pa_deep') and/or family ('run','dropback','pa','screen','rpo'),
        outcome None/'sack'/'scramble'/'incomplete'. Legacy: call R (run), P (pass), SC (scramble), S (sack).
        penalty=True: replay the down, nothing else changes (use apply_penalty for yardage).
        turnover_kind: 'int' or 'fumble' when it is known (shorthand I, INT, F; v1.4), kept on the row.
        The play is the offense with the ball's: its caller's prediction, its memory, its points."""
        if turnover_kind not in TURNOVER_KINDS:
            raise ValueError("A turnover is an int or a fumble.")
        if not self.state["drive_active"]:
            raise ValueError(f"No {self._who()} drive in progress. Start a new drive first.")
        if penalty:
            return self.apply_penalty("OFFSET")
        family, leaf, outcome, dropback, code, name = self._resolve_call(call, leaf, family, outcome)
        yards = int(yards)
        if not -YARDS_MAX <= yards <= YARDS_MAX:
            raise ValueError(f"Yards must be from -{YARDS_MAX} to {YARDS_MAX}.")
        self._checkpoint()
        team = self._ball_team()
        s, m = self.state["sit"], self._mem(team)
        pred = self.predict(team)
        if outcome == "sack":
            yards = -abs(yards)
        if outcome == "incomplete":
            yards = 0
        if s["yardline_100"] - yards <= 0 and not turnover:
            td = True
            yards = s["yardline_100"]
        success = visible_success(s["down"], s["togo"], yards, td, turnover)
        row = {**self._sit_fields(team), **self._pred_fields(pred, family, leaf),
               "call": code, "dropback": dropback, "yards": yards, "success": success,
               "td": bool(td), "turnover": bool(turnover), "turnover_kind": turnover_kind if turnover else None,
               "family": family, "leaf": leaf, "outcome": outcome, "name": name,
               "nullified": False, "penalty": None, "source": source,
               "depth": leaf.split("_")[1] if leaf and leaf.startswith(("dropback_", "pa_")) else None,
               "feed_text": (feed or {}).get("text")[:FEED_TEXT_MAX] if (feed or {}).get("text") else None,
               "align": (feed or {}).get("align"),
               "espn_id": (feed or {}).get("id"), **self._whose(team)}
        self.state["log"].append(row)
        self._db_insert(row)

        # memory update: he sees the result of the call he made
        key = "qp" if dropback else "qr"
        m[key] += self.models[team].alpha * (success - m[key])
        m["snap_n"] += 1
        m["prev"] = {"type": 1 if dropback else -1, "success": success,
                     "explosive": int(yards >= EXPLOSIVE_YARDS), "sack": int(outcome == "sack")}

        # clock estimate (correct it from the broadcast when you can); an incompletion stops it
        if outcome == "incomplete":
            run_off = 6
        elif s["clock"] > 120 or s["qtr"] in (1, 3):
            run_off = 30 if dropback else 34
        else:
            run_off = 7
        s["clock"] = max(0, s["clock"] - run_off)
        s["clock_estimated"] = True
        self._advance(team, yards, td, turnover)
        self._save()

    def _advance(self, team, yards, td, turnover):
        """Down, distance and field position after a logged play, or the end of the drive."""
        s, m = self.state["sit"], self._mem(team)
        if td:
            self._add_points(team, 7)
            self.state["drive_active"] = False
            m["prev"] = None
            self.state["message"] = "Touchdown, +7 (PAT assumed; fix the score if needed). Waiting for the next drive."
        elif turnover:
            self.state["drive_active"] = False
            m["prev"] = None
            self.state["message"] = f"Turnover. {self._waiting()}"
        else:
            s["yardline_100"] = min(99, s["yardline_100"] - yards)
            if yards >= s["togo"]:
                s["down"], s["togo"] = 1, min(10, s["yardline_100"])
                self.state["message"] = "First down."
            elif s["down"] == 4:
                self.state["drive_active"] = False
                m["prev"] = None
                self.state["message"] = f"Turnover on downs. {self._waiting()}"
            else:
                s["down"] += 1
                s["togo"] -= yards
                self.state["message"] = "Logged."

    def situation_text(self):
        """'1st & 4 at TB 4', from the offense with the ball's side."""
        s = self.state["sit"]
        tg = "Goal" if s["togo"] >= s["yardline_100"] else s["togo"]
        return f"{['', '1st', '2nd', '3rd', '4th'][s['down']]} & {tg} at {self._spot_text(s['yardline_100'])}"

    def set_message(self, text):
        self.state["message"] = text
        self._save()

    def _spot_text(self, yl):
        if yl == 50:
            return "50"
        offense = self._ball_team()
        return f"{offense} {100 - yl}" if yl > 50 else f"{self._other(offense)} {yl}"

    # ------------------------------------------------------------ scoring and the view
    def metrics(self, team=None):
        """The scorecard (live_archive.scorecard) of `team`'s play-caller, or of every tracked snap when team is None:
        the one caller's when one side is tracked, as always."""
        if team is not None:
            self._tracked(team)
        return scorecard([r for r in self.state["log"] if team is None or r.get("team") == team])

    def _memory(self, team):
        m = self._mem(team)
        return {"snap_n": m["snap_n"], "value_gap": m["qp"] - m["qr"], "prev": m["prev"], "script_plays": SCRIPT_PLAYS}

    def view(self):
        """The state body. poss and prediction: the tracked offense with the ball and its next call (null between its
        drives; sit's down, distance and spot are its own). memory: that offense's (the one that had it last between
        drives). profile: the lead side's (GAME's offense's when it is tracked). tracked: every side with its caller,
        his scorecard, his profile and his memory, in the order listed."""
        s = self.state
        pred = self.predict() if s["drive_active"] else None
        if pred:
            pred.pop("_tree", None)
        return {
            "game": GAME, "sit": {**s["sit"], "clock_str": fmt_clock(s["sit"]["clock"])},
            "drive_active": s["drive_active"], "drive_n": s["drive_n"],
            "poss": self._ball_team() if s["drive_active"] else None, "prediction": pred,
            "keys": {k: [{"leaf": x, "name": LEAF_NAMES[x]} for x in v] for k, v in TAP_CYCLES.items()},
            "penalties": {c: {"label": v[0], "against": v[1], "yards": v[2], "first": v[3], "lod": v[4],
                              "presnap": v[5]} for c, v in PENALTIES.items()},
            "leaf_names": LEAF_NAMES, "family_names": FAMILY_NAMES,
            "log": [{k: v for k, v in r.items() if k != "tree"} for r in reversed(s["log"]) if is_snap(r)],
            "metrics": self.metrics(), "version": self.version,
            "message": s.get("message", ""), "profile": self.profile,
            "memory": self._memory(self._ball_team()),
            "tracked": [{**entry, "metrics": self.metrics(entry["team"]), "profile": self.models[entry["team"]].profile,
                         "memory": self._memory(entry["team"])} for entry in self.tracked()],
        }


def _upgraded(i, r, whose):
    """Log row i (1-based) of an older file, with its seq and, when it has none, whose call it was."""
    if not isinstance(r, dict):
        return r
    fill = {**({"seq": i} if r.get("seq") is None else {}), **(whose if r.get("team") is None else {})}
    return {**r, **fill} if fill else r

"""Live game engine: holds the situation, his in-game memory, every prediction and its result."""
import threads  # noqa: F401  (first: pins OpenMP/BLAS before numpy and sklearn load)
import copy
import json
import logging
import os
import re
import secrets
from datetime import datetime

import duckdb
import joblib
import numpy as np

from config import (DB_PATH, EXPLOSIVE_YARDS, GAME, LEAN, MODEL_DIR, SCRIPT_PLAYS,
                    STATE_PATH, TILT)
from features import (HABIT_COLS, MEMORY_COLS, base_row, habit_values, log_loss, logit,
                      memory_values, sigmoid, visible_success)
from granular import (FAMILIES, FAMILY_NAMES, LEAF_FAMILY, LEAF_NAMES, LEAVES, SHORTHAND,
                      TAP_CYCLES, leaf_is_dropback, predict_tree)

log = logging.getLogger(__name__)

HOT_PTS, HOT_RATIO = 0.04, 1.3
BOOT_ID = secrets.token_hex(2)     # new on every server start; the first half of the timeline epoch
OUTCOME_NAMES = {"sack": "sack", "scramble": "scramble", "incomplete": "incomplete"}
HISTORY_STEPS = 200                # undo steps kept in memory
DRIVE_END_MESSAGES = {"punt": "Punt. Waiting for the next Dallas drive.",          # FI #86, #87: kept word for word
                      "fg": "Field goal good (+3). Waiting for the next Dallas drive.",
                      "fg_miss": "Field goal missed. Waiting for the next Dallas drive.",
                      "half": "End of half. Waiting for the next Dallas drive."}
ESPN_UNDO_FLOOR = ("Undo can't take back a play ESPN logged: the feed would never log it again. Retag the last play "
                   "with A, N, O or P, or type the fix.")


class UndoRefused(ValueError):
    """An undo that would step back past a play ESPN applied (the feed, a replay or a watch). The app answers 409."""

# code: (label, against 'def'/'off'/None, yards | 'spot' | 'box', auto first down, loss of down, pre-snap)
PENALTIES = {
    "OFFSIDE": ("Offside / encroachment / neutral zone", "def", 5, False, False, True),
    "DH": ("Defensive holding", "def", 5, True, False, False),
    "IC": ("Illegal contact", "def", 5, True, False, False),
    "DPI": ("Defensive pass interference", "def", "spot", True, False, False),
    "RTP": ("Roughing the passer", "def", 15, True, False, False),
    "URD": ("Unnecessary roughness on defense", "def", 15, True, False, False),
    "FM": ("Face mask", "def", 15, True, False, False),
    "12D": ("Too many men on defense", "def", 5, False, False, True),
    "FS": ("False start", "off", 5, False, False, True),
    "DOG": ("Delay of game", "off", 5, False, False, True),
    "ILF": ("Illegal formation / shift", "off", 5, False, False, False),
    "OH": ("Offensive holding", "off", 10, False, False, False),
    "OPI": ("Offensive pass interference", "off", 10, False, False, False),
    "IBB": ("Illegal block in the back", "off", 10, False, False, False),
    "IG": ("Intentional grounding", "off", 10, False, True, False),
    "URO": ("Unnecessary roughness on offense", "off", 15, False, False, False),
    "OFFSET": ("Offsetting penalties, replay the down", None, 0, False, False, False),
    "OTHER_D": ("Penalty on defense", "def", "box", False, False, False),
    "OTHER_O": ("Penalty on offense", "off", "box", False, False, False),
}
PEN_SHORT = {"OFF": "OFFSIDE", "ENC": "OFFSIDE", "NZI": "OFFSIDE", "DH": "DH", "IC": "IC", "DPI": "DPI",
             "PI": "DPI", "RTP": "RTP", "URD": "URD", "UR": "URD", "FM": "FM", "12": "12D", "FS": "FS",
             "DOG": "DOG", "DELAY": "DOG", "ILF": "ILF", "OH": "OH", "HOLD": "OH", "OPI": "OPI",
             "IBB": "IBB", "IG": "IG", "URO": "URO", "OFFSET": "OFFSET"}


def fmt_clock(sec):
    sec = max(0, int(round(sec)))
    return f"{sec // 60}:{sec % 60:02d}"


def parse_clock(text):
    """Accepts 8:41, 8.41, 841, 1500, or whole minutes like 12."""
    t = str(text).strip()
    m = re.fullmatch(r"(\d{1,2})[:.](\d{2})", t)
    if m:
        mins, secs = int(m.group(1)), int(m.group(2))
    elif re.fullmatch(r"\d{3,4}", t):
        mins, secs = int(t[:-2]), int(t[-2:])
    elif re.fullmatch(r"\d{1,2}", t):
        mins, secs = int(t), 0
    else:
        raise ValueError(f"Clock like 8:41 or 841, got '{text}'")
    if secs >= 60 or mins * 60 + secs > 900:
        raise ValueError(f"'{text}' isn't a game clock (max 15:00)")
    return mins * 60 + secs


class GameEngine:
    def __init__(self):
        import sklearn
        self.profile = json.loads((MODEL_DIR / "profile.json").read_text())
        if self.profile.get("sklearn") != sklearn.__version__:
            raise RuntimeError("Model was built with a different scikit-learn version")
        self.stage1 = joblib.load(MODEL_DIR / "stage1.joblib")
        self.G = joblib.load(MODEL_DIR / "granular.joblib")
        self.w = {c: v["est"] for c, v in self.profile["coefs"].items()}
        self.alpha = self.profile["alpha"]
        self.q0 = self.profile["q0"]
        self.history = []
        self.undo_floor = None             # why an undo with no steps left is refused (ESPN plays behind it), or None
        self.epoch_n = 0
        self._pred_memo = None
        self._batching = False             # command(): one checkpoint and one save for the whole line
        self.state = self._load() or self._fresh()
        self._version = self.state.get("version", 0)

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

    # ------------------------------------------------------------ state
    def _fresh(self):
        return {
            "game": GAME,
            "sit": {"down": 1, "togo": 10, "yardline_100": 75, "qtr": 1, "clock": 900,
                    "score_off": 0, "score_opp": 0, "clock_estimated": False},
            "drive_active": False,
            "drive_n": 0,
            "mem": {"snap_n": 0, "qp": self.q0, "qr": self.q0, "prev": None},
            "log": [],
            "message": "Set the start of Dallas's first drive.",
        }

    def _load(self):
        """The saved game, or None (no file, or another game's). A file that can't be read is copied aside first
        (live_state.unreadable-<time>.json): the fresh game's first save would otherwise destroy what is left."""
        if not STATE_PATH.exists():
            return None
        try:
            s = json.loads(STATE_PATH.read_text())
        except (OSError, ValueError) as ex:
            self._keep_unreadable(ex)
            return None
        game = s.get("game") if isinstance(s, dict) else None
        if not isinstance(game, dict) or game.get("game_id") != GAME["game_id"]:
            return None
        return self._upgrade(s)

    @staticmethod
    def _upgrade(s):
        """A game saved by an older build: its log rows have no seq (the timeline's key). seq has always been the
        1-based log position, so it is filled in here and saved with the next change."""
        for i, r in enumerate(s.get("log") or [], start=1):
            if isinstance(r, dict) and r.get("seq") is None:
                r["seq"] = i
        return s

    @staticmethod
    def _keep_unreadable(ex):
        dest = STATE_PATH.with_name(f"live_state.unreadable-{datetime.now():%Y%m%d-%H%M%S}.json")
        try:
            with open(dest, "xb") as f:            # x: never over an older copy
                f.write(STATE_PATH.read_bytes())
            log.warning("Couldn't read %s (%s). Kept a copy as %s; starting a fresh game.", STATE_PATH.name, ex,
                        dest.name)
        except OSError as err:
            log.warning("Couldn't read %s (%s) or keep a copy of it (%s).", STATE_PATH.name, ex, err)

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

    def _checkpoint(self):
        if self._batching:
            return
        self.history.append(copy.deepcopy(self.state))
        self.history = self.history[-HISTORY_STEPS:]

    def clear_history(self):
        """Drop every undo step: the game on screen was replaced or its ESPN ids forgotten (a reset of an ESPN game,
        a watch starting or putting the game back). U then says 'Nothing to undo.'"""
        self.history, self.undo_floor = [], None

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
        last = self.state["log"][-1]["snap"] if self.state["log"] else None
        self.state = self.history.pop()
        self.state["message"] = "Undid the last action."
        self._save()
        if last is not None:
            self._db_delete_after(len(self.state["log"]))

    def reset(self):
        self._checkpoint()
        self.state = self._fresh()
        self._db_delete_after(0)
        self.bump_epoch()
        self._save()

    # ------------------------------------------------------------ prediction
    def predict(self):
        """The prediction for the current situation and memory. Memoized per state version: the key is the content
        predict() reads (sit, mem, GAME), so an undo back to an older state can never get a stale answer.
        Returns a fresh copy each time; callers may change it."""
        key = json.dumps([self.state["sit"], self.state["mem"], GAME], sort_keys=True, default=str)
        if self._pred_memo is None or self._pred_memo[0] != key:
            self._pred_memo = (key, self._predict())
        return copy.deepcopy(self._pred_memo[1])

    def _predict(self):
        s, m = self.state["sit"], self.state["mem"]
        p0 = float(self.stage1.predict_proba(np.array([base_row(s, GAME)]))[0, 1])
        h = habit_values(s["down"], s["togo"], s["score_off"] - s["score_opp"], s["yardline_100"])
        snap_next = m["snap_n"] + 1
        mem = memory_values(snap_next, m["prev"], m["qp"] - m["qr"], SCRIPT_PLAYS)
        z0 = float(logit(p0))
        z_h = z0 + sum(self.w[c] * h[c] for c in HABIT_COLS)
        p_h = float(sigmoid(z_h))
        parts, z = [], z_h
        for c in MEMORY_COLS:
            dz = self.w[c] * mem[c]
            if abs(mem[c]) > 1e-9:
                before = float(sigmoid(z))
                z += dz
                parts.append({"term": self.profile["coefs"][c]["label"], "pts": round(100 * (float(sigmoid(z)) - before), 1)})
        p = float(sigmoid(z))
        gap = p - p0
        if abs(gap) >= TILT:
            flag = "TILT PASS" if gap > 0 else "TILT RUN"
        elif abs(gap) >= LEAN:
            flag = "lean pass" if gap > 0 else "lean run"
        else:
            flag = "no edge"
        (lf, ll), (hf, hl) = predict_tree(self.G, s, GAME, float(logit(p) - logit(p_h)))
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
                      score_off=None, score_opp=None, spot=None):
        """Any field can be set alone. Setting down, distance or field position while Dallas
        is off the field starts a new drive there."""
        if spot not in (None, ""):
            yardline_100 = self._parse_spot(spot)
        if down is not None and not 1 <= int(down) <= 4:
            raise ValueError("Down must be 1 to 4")
        if qtr is not None and not 1 <= int(qtr) <= 5:
            raise ValueError("Quarter must be 1 to 4 (5 = overtime)")
        if yardline_100 is not None and not 1 <= int(yardline_100) <= 99:
            raise ValueError("Ball must be between the goal lines")
        goal = isinstance(togo, str) and togo.strip().upper() in ("G", "GOAL")
        if togo is not None and not goal:
            togo = int(togo)
            if togo < 1:
                raise ValueError("To go must be at least 1")
        self._checkpoint()
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
            self.state["drive_active"] = True
            self.state["drive_n"] += 1
            self.state["mem"]["prev"] = None
        s["togo"] = max(1, min(s["togo"], s["yardline_100"]))
        self.state["message"] = (f"Drive {self.state['drive_n']} started." if starting else "Saved.")
        self._save()

    def new_drive(self, yardline_100, qtr=None, clock=None, score_off=None, score_opp=None):
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
        self.state["drive_active"] = True
        self.state["drive_n"] += 1
        self.state["mem"]["prev"] = None
        self.state["message"] = f"Drive {self.state['drive_n']} started."
        self._save()

    def end_drive(self, how):
        """punt, fg, fg_miss or half. A field goal adds 3, so it needs a drive (G22: it used to score off the field);
        the other ends are harmless without one."""
        if not isinstance(how, str) or how not in DRIVE_END_MESSAGES:
            raise ValueError("A drive ends with punt, fg, fg_miss or half.")
        if how == "fg" and not self.state["drive_active"]:
            off, opp = GAME["offense"], GAME["opponent"]
            raise ValueError(f"No {off} drive in progress, so there's no field goal to add. "
                             f"To fix the score, type it like '{off} 3 {opp} 0'.")
        self._checkpoint()
        s = self.state["sit"]
        if how == "fg":
            s["score_off"] += 3
        if self.state["drive_active"]:     # how the drive ended, for the timeline (punts and FGs log no snap)
            self.state.setdefault("drive_ends", {})[str(self.state["drive_n"])] = how
        self.state["drive_active"] = False
        self.state["mem"]["prev"] = None
        self.state["message"] = DRIVE_END_MESSAGES[how]
        self._save()

    def add_score(self, team, pts):
        self._checkpoint()
        key = "score_off" if team == "off" else "score_opp"
        self.state["sit"][key] = max(0, self.state["sit"][key] + int(pts))
        self._save()

    def _resolve_call(self, call, leaf, family, outcome):
        """Normalise what was entered into (family, leaf, outcome, dropback, legacy call)."""
        pass_flag = None
        if call:
            call = call.upper()
            legacy = {"R": ("run", None, None), "P": (None, None, None),
                      "SC": ("dropback", None, "scramble"), "S": ("dropback", None, "sack")}
            if call not in legacy:
                raise ValueError("Call must be R, P, SC or S.")
            family, leaf, outcome = (family or legacy[call][0]), (leaf or legacy[call][1]), (outcome or legacy[call][2])
            pass_flag = call != "R"
        if leaf is not None and leaf not in LEAF_FAMILY:
            raise ValueError(f"Unknown play '{leaf}'")
        if leaf is not None:
            family = LEAF_FAMILY[leaf]
        if family is not None and family not in FAMILIES:
            raise ValueError(f"Unknown play type '{family}'")
        if outcome not in OUTCOME_NAMES and outcome is not None:
            raise ValueError("Outcome must be sack, scramble or incomplete")
        if outcome == "incomplete":
            if leaf == "rpo_run" or (family == "rpo" and leaf is None):
                family, leaf = "rpo", "rpo_throw"
            elif family == "run":
                family, leaf = "dropback", None          # depth unknown; P/A first to keep it
        elif outcome:                                    # sack or scramble
            if family in ("run", "screen") or leaf == "rpo_run":
                family, leaf = "dropback", None
            leaf = None                                  # the depth of the called route is unknown
        if outcome:
            dropback = 1
        elif leaf:
            dropback = leaf_is_dropback(leaf)
        elif family is not None:
            dropback = int(family in ("dropback", "pa", "screen"))
        elif pass_flag is not None:
            dropback = int(pass_flag)
        else:
            raise ValueError("Pick what he called first.")
        name = LEAF_NAMES[leaf] if leaf else (FAMILY_NAMES[family] if family else ("Pass" if dropback else "Run"))
        if outcome:
            name += f", {OUTCOME_NAMES[outcome]}"
        code = call or ("S" if outcome == "sack" else "SC" if outcome == "scramble" else ("P" if dropback else "R"))
        return family, leaf, outcome, dropback, code, name

    def _pred_fields(self, pred, family, leaf):
        T = pred["_tree"]
        return {
            "p": round(pred["p"], 4), "p_league": round(pred["p_league"], 4),
            "p_habits": round(pred["p_habits"], 4), "flag": pred["flag"],
            "top_leaf": T["rank"][0], "top_leaf_p": round(T["his_l"][T["rank"][0]], 4),
            "fam_p": round(T["his_f"][family], 4) if family else None,
            "fam_p_league": round(T["lg_f"][family], 4) if family else None,
            "fam_top": max(T["his_f"], key=T["his_f"].get),
            "leaf_p": round(T["his_l"][leaf], 4) if leaf else None,
            "leaf_p_league": round(T["lg_l"][leaf], 4) if leaf else None,
            "leaf_rank": (T["rank"].index(leaf) + 1) if leaf else None,
            "leaf_rank_league": (sorted(LEAVES, key=lambda k: -T["lg_l"][k]).index(leaf) + 1) if leaf else None,
            "tree": {k: {kk: round(vv, 5) for kk, vv in T[k].items()} for k in ("his_l", "lg_l", "his_f", "lg_f")},
        }

    def _rescore(self, row, family, leaf):
        """Recompute a logged row's scoring fields from its stored prediction tree after a retag."""
        T = row["tree"]
        rank = sorted(LEAVES, key=lambda k: -T["his_l"][k])
        rank_l = sorted(LEAVES, key=lambda k: -T["lg_l"][k])
        row.update({
            "family": family, "leaf": leaf,
            "fam_p": T["his_f"][family] if family else None, "fam_p_league": T["lg_f"][family] if family else None,
            "leaf_p": T["his_l"][leaf] if leaf else None, "leaf_p_league": T["lg_l"][leaf] if leaf else None,
            "leaf_rank": rank.index(leaf) + 1 if leaf else None,
            "leaf_rank_league": rank_l.index(leaf) + 1 if leaf else None,
        })

    def retag_last(self, key):
        """Fix the play type ESPN can't see on the last logged play: A play-action, N screen, O RPO,
        P plain dropback, K/J/L run gap. Never flips run vs pass, so his memory is unchanged."""
        key = key.upper()
        rows = [r for r in self.state["log"] if not r.get("nullified") and r.get("tree")]
        if not rows:
            raise ValueError("No logged play to retag yet.")
        r = rows[-1]
        drop, depth, out = r["dropback"], r.get("depth"), r.get("outcome")
        if drop:
            target = {"A": ("pa", f"pa_{depth}" if depth and not out else None),
                      "P": ("dropback", f"dropback_{depth}" if depth and not out else None),
                      "N": ("screen", "screen"),
                      "O": ("rpo", "rpo_throw")}.get(key)
            if key == "N" and out in ("sack", "scramble"):
                target = None
        else:
            target = {"O": ("rpo", "rpo_run"), "K": ("run", "run_inside"), "R": ("run", "run_inside"),
                      "J": ("run", "run_edge_left" if r.get("leaf") == "run_ot_left" else "run_ot_left"),
                      "L": ("run", "run_edge_right" if r.get("leaf") == "run_ot_right" else "run_ot_right")}.get(key)
        if not target:
            raise ValueError(f"{key} doesn't fit a {'pass' if drop else 'run'}.")
        self._checkpoint()
        family, leaf = target
        self._rescore(r, family, leaf)
        name = LEAF_NAMES[leaf] if leaf else FAMILY_NAMES[family]
        if out:
            name += f", {OUTCOME_NAMES[out]}"
        r["name"] = name
        r["retagged"] = True
        self.state["message"] = f"Last play retagged: {name}."
        self._save()

    def feed_sync(self, sit, offense_ball=None):
        """Apply situation from the live feed without an undo step. offense_ball True starts or keeps
        a drive; False ends it (other team has the ball); None leaves drive status alone."""
        s = self.state["sit"]
        for k in ("qtr", "clock", "score_off", "score_opp"):
            if sit.get(k) is not None:
                s[k] = int(sit[k])
        if sit.get("clock") is not None:
            s["clock_estimated"] = False
        if offense_ball is True:
            if not self.state["drive_active"]:
                self.state["drive_active"] = True
                self.state["drive_n"] += 1
                self.state["mem"]["prev"] = None
                self.state["message"] = f"Drive {self.state['drive_n']} started (ESPN)."
            for k in ("down", "togo", "yardline_100"):
                if sit.get(k) is not None:
                    s[k] = int(sit[k])
            s["togo"] = max(1, min(s["togo"], s["yardline_100"]))
        elif offense_ball is False and self.state["drive_active"]:
            self.state["drive_active"] = False
            self.state["mem"]["prev"] = None
        self._save()

    def _sit_fields(self):
        s, m = self.state["sit"], self.state["mem"]
        return {"seq": len(self.state["log"]) + 1, "snap": m["snap_n"] + 1, "drive": self.state["drive_n"],
                "time": datetime.now().strftime("%H:%M:%S"), "qtr": s["qtr"], "clock": fmt_clock(s["clock"]),
                "down": s["down"], "togo": s["togo"], "yardline_100": s["yardline_100"],
                "score": f"{s['score_off']}-{s['score_opp']}", "clock_est": bool(s.get("clock_estimated"))}

    def record_play(self, call=None, yards=0, td=False, turnover=False, penalty=False,
                    leaf=None, family=None, outcome=None, source="manual", feed=None):
        """Granular: leaf (e.g. 'run_edge_left', 'pa_deep') and/or family ('run','dropback','pa','screen','rpo'),
        outcome None/'sack'/'scramble'/'incomplete'. Legacy: call R (run), P (pass), SC (scramble), S (sack).
        penalty=True: replay the down, nothing else changes (use apply_penalty for yardage)."""
        if not self.state["drive_active"]:
            raise ValueError("No Dallas drive in progress. Start a new drive first.")
        if penalty:
            return self.apply_penalty("OFFSET")
        family, leaf, outcome, dropback, code, name = self._resolve_call(call, leaf, family, outcome)
        self._checkpoint()
        s, m = self.state["sit"], self.state["mem"]
        pred = self.predict()
        yards = int(yards)
        if outcome == "sack":
            yards = -abs(yards)
        if outcome == "incomplete":
            yards = 0
        if s["yardline_100"] - yards <= 0 and not turnover:
            td = True
            yards = s["yardline_100"]
        success = visible_success(s["down"], s["togo"], yards, td, turnover)
        row = {**self._sit_fields(), **self._pred_fields(pred, family, leaf),
               "call": code, "dropback": dropback, "yards": yards, "success": success,
               "td": bool(td), "turnover": bool(turnover),
               "family": family, "leaf": leaf, "outcome": outcome, "name": name,
               "nullified": False, "penalty": None, "source": source,
               "depth": leaf.split("_")[1] if leaf and leaf.startswith(("dropback_", "pa_")) else None,
               "feed_text": (feed or {}).get("text"), "align": (feed or {}).get("align"),
               "espn_id": (feed or {}).get("id")}
        self.state["log"].append(row)
        self._db_insert(row)

        # memory update: he sees the result of the call he made
        key = "qp" if dropback else "qr"
        m[key] += self.alpha * (success - m[key])
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

        # advance down, distance and field position
        if td:
            s["score_off"] += 7
            self.state["drive_active"] = False
            m["prev"] = None
            self.state["message"] = "Touchdown, +7 (PAT assumed; fix the score if needed). Waiting for the next drive."
        elif turnover:
            self.state["drive_active"] = False
            m["prev"] = None
            self.state["message"] = "Turnover. Waiting for the next Dallas drive."
        else:
            s["yardline_100"] = min(99, s["yardline_100"] - yards)
            if yards >= s["togo"]:
                s["down"], s["togo"] = 1, min(10, s["yardline_100"])
                self.state["message"] = "First down."
            elif s["down"] == 4:
                self.state["drive_active"] = False
                m["prev"] = None
                self.state["message"] = "Turnover on downs. Waiting for the next Dallas drive."
            else:
                s["down"] += 1
                s["togo"] -= yards
                self.state["message"] = "Logged."
        self._save()

    def apply_penalty(self, code, yards=None, auto_first=None, play=None, source="manual", note=None, espn_id=None):
        """Enforce a foul from where the ball is now.
        play = {'leaf'/'family'/'outcome'} when the call was already picked: that snap is logged as
        nullified (counts for scoring the prediction, not for his in-game memory). Pre-snap fouls ignore it.
        yards: distance past the line for DPI, or the yardage for OTHER_D / OTHER_O.
        espn_id: the ESPN play a nullified call came from (the timeline's join key)."""
        code = code.upper()
        if code not in PENALTIES:
            raise ValueError(f"Unknown penalty '{code}'")
        if not self.state["drive_active"]:
            raise ValueError("No Dallas drive in progress. Type the ball spot first.")
        label, against, pen_yds, first, lod, presnap = PENALTIES[code]
        if code in ("OTHER_D", "OTHER_O"):
            label = f"Penalty on {GAME['opponent'] if against == 'def' else GAME['offense']}"
            first = bool(auto_first) if against == "def" else False
        if pen_yds in ("spot", "box"):
            if yards in (None, "") or int(yards) <= 0:
                raise ValueError("Type the yards first: how far past the line for DPI, or the penalty yardage.")
            pen_yds = int(yards)
        rec = None
        if play and not presnap and any(play.get(k) for k in ("leaf", "family", "outcome", "call")):
            rec = self._resolve_call(play.get("call"), play.get("leaf"), play.get("family"), play.get("outcome"))
        self._checkpoint()
        s = self.state["sit"]
        yl, togo, down = s["yardline_100"], s["togo"], s["down"]
        goal_to_go = togo >= yl

        if rec:
            family, leaf, outcome, dropback, callcode, name = rec
            pred = self.predict()
            row = {**self._sit_fields(), **self._pred_fields(pred, family, leaf),
                   "call": callcode, "dropback": dropback, "yards": 0, "success": None, "td": False,
                   "turnover": False, "family": family, "leaf": leaf, "outcome": outcome,
                   "name": f"{name} (no play" + (f": {note}" if note else f": {label.lower()}" if against else ", flag") + ")",
                   "nullified": True, "penalty": code, "source": source, "espn_id": espn_id}
            self.state["log"].append(row)
            self._db_insert(row)

        if against is None:
            msg = label
        elif code == "DPI":
            new_yl = max(1, yl - pen_yds)
            s["yardline_100"] = new_yl
            s["down"], s["togo"] = 1, min(10, new_yl)
            msg = f"{label}: ball at the spot, {pen_yds} yards, automatic first down"
        elif against == "def":
            dist = pen_yds if pen_yds <= yl / 2 else yl / 2
            new_yl = max(1, int(round(yl - dist)))
            gained = yl - new_yl
            s["yardline_100"] = new_yl
            if first or gained >= togo:
                s["down"], s["togo"] = 1, min(10, new_yl)
            else:
                s["togo"] = new_yl if goal_to_go else togo - gained
            half = " (half the distance)" if dist < pen_yds else ""
            msg = f"{label}: {gained} yards{half}" + (", automatic first down" if first else "")
        else:
            room = 100 - yl
            dist = pen_yds if pen_yds <= room / 2 else room / 2
            new_yl = min(99, int(round(yl + dist)))
            lost = new_yl - yl
            s["yardline_100"] = new_yl
            s["togo"] = new_yl if goal_to_go else togo + lost
            half = " (half the distance)" if dist < pen_yds else ""
            msg = f"{label}: back {lost} yards{half}"
            if lod:
                msg += ", loss of down"
                if down == 4:
                    self.state["drive_active"] = False
                    self.state["mem"]["prev"] = None
                    self.state["message"] = msg + ". Turnover on downs."
                    self._save()
                    return
                s["down"] = down + 1
        s["togo"] = max(1, min(s["togo"], s["yardline_100"]))
        self.state["message"] = f"{msg}. {self.situation_text()}." + \
            (" His call still counts for scoring." if rec else "")
        self._save()

    def situation_text(self):
        """'1st & 4 at TB 4'."""
        s = self.state["sit"]
        tg = "Goal" if s["togo"] >= s["yardline_100"] else s["togo"]
        return f"{['', '1st', '2nd', '3rd', '4th'][s['down']]} & {tg} at {self._spot_text(s['yardline_100'])}"

    def set_message(self, text):
        self.state["message"] = text
        self._save()

    def _spot_text(self, yl):
        if yl == 50:
            return "50"
        return f"{GAME['offense']} {100 - yl}" if yl > 50 else f"{GAME['opponent']} {yl}"

    # ------------------------------------------------------------ shorthand
    def command(self, text):
        """Shorthand, segments split by '|':
        'P 8 | 2&2 D44'   'R -2'   'S 7'   'SC 6'   'P 35 TD'   'R 3 F' (fumble lost)   'I' (interception)
        'X' (penalty, no play)   'new D25'   'DAL 14 TB 10'   'Q2 1:58'   'punt' / 'fg' / 'fg miss'
        All or nothing, on disk too: the segments write nothing (one checkpoint, one save at the end), so a bad
        segment, or a save that fails, leaves the game, the file and the archive as they were."""
        self._checkpoint()          # one undo reverts the whole line
        before = copy.deepcopy(self.state)
        try:
            self._batching = True
            try:
                self._command(text)
            finally:
                self._batching = False
            self._save()
        except Exception:
            self.state = before
            self.history.pop()
            self._db_delete_after(len(self.state["log"]))
            raise

    def _command(self, text):
        off, opp = GAME["offense"], GAME["opponent"]
        done = []
        for seg in [x.strip() for x in text.split("|") if x.strip()]:
            u = seg.upper()
            toks = u.split()
            if u in ("PUNT", "FG", "FG MISS", "HALF"):
                self.end_drive({"PUNT": "punt", "FG": "fg", "FG MISS": "fg_miss", "HALF": "half"}[u])
                done.append(u.lower())
                continue
            if toks[0] == "NEW":
                yl = self._parse_spot(" ".join(toks[1:]))
                self.new_drive(yl)
                done.append(f"new drive at {seg[4:].strip()}")
                continue
            if toks[0] in ("X", "FLAG"):
                args = toks[1:]
                num_tok = next((int(t) for t in args if re.fullmatch(r"\d+", t)), None)
                if not args:
                    self.apply_penalty("OFFSET")
                elif args[0] in (off, opp):
                    self.apply_penalty("OTHER_O" if args[0] == off else "OTHER_D", yards=num_tok,
                                       auto_first=("1ST" in args or "AUTO" in args))
                elif args[0] in PEN_SHORT:
                    self.apply_penalty(PEN_SHORT[args[0]], yards=num_tok)
                else:
                    raise ValueError(f"Unknown flag '{args[0]}'. Try X DH, X FS, X OH, X DPI 25, X {opp} 5")
                done.append(self.state["message"])
                continue
            if toks[0] == "I":
                self.record_play("P", 0, turnover=True)
                done.append("interception")
                continue
            if toks[0] in SHORTHAND or toks[0] in ("SC", "S"):
                yards = 0
                for t in toks[1:]:
                    if re.fullmatch(r"[+-]?\d+", t):
                        yards = int(t)
                extra = dict(td="TD" in toks[1:], turnover="F" in toks[1:] or "INT" in toks[1:])
                if toks[0] in ("SC", "S"):
                    self.record_play(toks[0], yards, **extra)
                else:
                    self.record_play(None, yards, leaf=SHORTHAND[toks[0]],
                                     outcome="incomplete" if "INC" in toks[1:] else None, **extra)
                done.append(seg)
                continue
            mq = re.fullmatch(r"Q([1-5])\s+(\d{1,2}:\d{2})", u)
            if mq:
                self.set_situation(qtr=int(mq.group(1)), clock=parse_clock(mq.group(2)))
                done.append(seg)
                continue
            ms = re.fullmatch(rf"{off}\s+(\d+)\s+{opp}\s+(\d+)", u) or re.fullmatch(rf"{opp}\s+(\d+)\s+{off}\s+(\d+)", u)
            if ms:
                a, b = int(ms.group(1)), int(ms.group(2))
                so, sp = (a, b) if u.startswith(off) else (b, a)
                self.set_situation(score_off=so, score_opp=sp)
                done.append(seg)
                continue
            md = re.fullmatch(r"([1-4])\s*&\s*(\d+|G)\s+(.+)", u)
            if md:
                yl = self._parse_spot(md.group(3))
                togo = yl if md.group(2) == "G" else int(md.group(2))
                self.set_situation(down=int(md.group(1)), togo=togo, yardline_100=yl)
                done.append(seg)
                continue
            raise ValueError(f"Didn't understand '{seg}'")
        self.state["message"] = "Done: " + ", ".join(done)

    def _parse_spot(self, text):
        """'D44' / 'DAL 44' = offense's own 44; 'T30' / 'TB 30' = opponent's 30; '50' = midfield;
        a bare number keeps the current side of the field."""
        t = str(text).replace(" ", "").upper()
        if t == "50":
            return 50
        if re.fullmatch(r"\d{1,2}", t):
            yd = int(t)
            if not 1 <= yd <= 50:
                raise ValueError("Yard line must be 1 to 50")
            return 100 - yd if self.state["sit"]["yardline_100"] > 50 else yd
        m = re.fullmatch(r"([A-Z]+)(\d{1,2})", t)
        if not m:
            raise ValueError(f"Field position like D44 or T30, got '{text}'")
        side, yd = m.group(1), int(m.group(2))
        if not 1 <= yd <= 50:
            raise ValueError("Yard line must be 1 to 50")
        off, opp = GAME["offense"], GAME["opponent"]
        if off.startswith(side) and not opp.startswith(side):
            return 100 - yd
        if opp.startswith(side):
            return yd
        raise ValueError(f"Field side '{side}' isn't {off} or {opp}")

    # ------------------------------------------------------------ scoring
    def metrics(self):
        log = self.state["log"]
        if not log:
            return {"n": 0}
        y = np.array([r["dropback"] for r in log], float)
        p = np.array([r["p"] for r in log])
        p0 = np.array([r["p_league"] for r in log])
        flagged = [r for r in log if r["flag"].startswith("TILT")]
        hits = sum(1 for r in flagged if (r["flag"] == "TILT PASS") == bool(r["dropback"]))
        fam = [r for r in log if r.get("fam_p") is not None]
        leaf = [r for r in log if r.get("leaf_rank") is not None]
        g = {"fam_n": len(fam), "leaf_n": len(leaf)}
        if fam:
            g.update({
                "fam_logloss": float(-np.mean([np.log(max(r["fam_p"], 1e-9)) for r in fam])),
                "fam_logloss_league": float(-np.mean([np.log(max(r["fam_p_league"], 1e-9)) for r in fam])),
                "fam_top_hits": sum(1 for r in fam if r["fam_top"] == r["family"]),
            })
        if leaf:
            g.update({
                "leaf_top1": sum(1 for r in leaf if r["leaf_rank"] == 1),
                "leaf_top3": sum(1 for r in leaf if r["leaf_rank"] <= 3),
                "leaf_top3_league": sum(1 for r in leaf if r["leaf_rank_league"] <= 3),
                "leaf_logloss": float(-np.mean([np.log(max(r["leaf_p"], 1e-9)) for r in leaf])),
                "leaf_logloss_league": float(-np.mean([np.log(max(r["leaf_p_league"], 1e-9)) for r in leaf])),
            })
        return {
            "n": len(log),
            "logloss_model": log_loss(y, p), "logloss_league": log_loss(y, p0),
            "brier_model": float(np.mean((p - y) ** 2)), "brier_league": float(np.mean((p0 - y) ** 2)),
            "acc_model": float(np.mean((p >= 0.5) == y)), "acc_league": float(np.mean((p0 >= 0.5) == y)),
            "dropback_rate": float(y.mean()),
            "tilt_n": len(flagged), "tilt_hits": hits,
            "granular": g,
        }

    def view(self):
        s = self.state
        pred = self.predict() if s["drive_active"] else None
        if pred:
            pred.pop("_tree", None)
        return {
            "game": GAME, "sit": {**s["sit"], "clock_str": fmt_clock(s["sit"]["clock"])},
            "drive_active": s["drive_active"], "drive_n": s["drive_n"],
            "prediction": pred,
            "keys": {k: [{"leaf": x, "name": LEAF_NAMES[x]} for x in v] for k, v in TAP_CYCLES.items()},
            "penalties": {c: {"label": v[0], "against": v[1], "yards": v[2], "first": v[3], "lod": v[4],
                              "presnap": v[5]} for c, v in PENALTIES.items()},
            "leaf_names": LEAF_NAMES, "family_names": FAMILY_NAMES,
            "log": [{k: v for k, v in r.items() if k != "tree"} for r in reversed(s["log"])],
            "metrics": self.metrics(), "version": self.version,
            "message": s.get("message", ""), "profile": self.profile,
            "memory": {"snap_n": s["mem"]["snap_n"], "value_gap": s["mem"]["qp"] - s["mem"]["qr"],
                       "prev": s["mem"]["prev"], "script_plays": SCRIPT_PLAYS},
        }

    # ------------------------------------------------------------ storage
    def _db(self):
        con = duckdb.connect(str(DB_PATH))
        con.execute("""CREATE TABLE IF NOT EXISTS live_log (
            game_id VARCHAR, snap INTEGER, drive INTEGER, logged_at VARCHAR, qtr INTEGER, clock VARCHAR,
            down INTEGER, togo INTEGER, yardline_100 INTEGER, score VARCHAR, p DOUBLE, p_league DOUBLE,
            p_habits DOUBLE, flag VARCHAR, call VARCHAR, dropback INTEGER, yards INTEGER, success INTEGER,
            td BOOLEAN, turnover BOOLEAN)""")
        for col, typ in self.EXTRA_DB_COLS:
            con.execute(f"ALTER TABLE live_log ADD COLUMN IF NOT EXISTS {col} {typ}")
        return con

    BASE_DB_COLS = ["snap", "drive", "time", "qtr", "clock", "down", "togo", "yardline_100", "score",
                    "p", "p_league", "p_habits", "flag", "call", "dropback", "yards", "success", "td", "turnover"]
    EXTRA_DB_COLS = [("family", "VARCHAR"), ("leaf", "VARCHAR"), ("outcome", "VARCHAR"), ("name", "VARCHAR"),
                     ("top_leaf", "VARCHAR"), ("top_leaf_p", "DOUBLE"), ("fam_p", "DOUBLE"),
                     ("fam_p_league", "DOUBLE"), ("leaf_p", "DOUBLE"), ("leaf_p_league", "DOUBLE"),
                     ("leaf_rank", "INTEGER"), ("leaf_rank_league", "INTEGER"),
                     ("seq", "INTEGER"), ("nullified", "BOOLEAN"), ("penalty", "VARCHAR")]

    def _db_insert(self, r):
        try:
            con = self._db()
            names = ["game_id", "snap", "drive", "logged_at"] + self.BASE_DB_COLS[3:] + [c for c, _ in self.EXTRA_DB_COLS]
            vals = [GAME["game_id"], r["snap"], r["drive"], r["time"]] + [r.get(c) for c in self.BASE_DB_COLS[3:]] \
                + [r.get(c) for c, _ in self.EXTRA_DB_COLS]
            con.execute(f"INSERT INTO live_log ({', '.join(names)}) VALUES ({', '.join('?' * len(vals))})", vals)
            con.close()
        except Exception as e:  # the JSON state file is the source of truth; never block the UI
            print("DuckDB write skipped:", e)

    def _db_delete_after(self, n_keep):
        try:
            con = self._db()
            con.execute("DELETE FROM live_log WHERE game_id = ? AND (seq > ? OR (seq IS NULL AND snap > ?))",
                        [GAME["game_id"], n_keep, n_keep])
            con.close()
        except Exception as e:
            print("DuckDB delete skipped:", e)

    def export_csv(self):
        cols = self.BASE_DB_COLS + [c for c, _ in self.EXTRA_DB_COLS]
        cell = lambda v: "" if v is None else str(v).replace(",", ";")
        lines = [",".join(cols)] + [",".join(cell(r.get(c)) for c in cols) for r in self.state["log"]]
        return "\n".join(lines) + "\n"

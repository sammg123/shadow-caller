"""The shorthand line typed during a game ('P 8 | 2&2 D44', 'R -2', 'new D25', 'DAL 14 TB 10', 'Q2 1:58', 'punt'):
manual entry, which the GameCast no longer offers but the backend still takes; and the clock parser the feed and the
app share. Field spots are the offense with the ball's ('D44' is its own 44); scores are typed GAME's way round."""
import copy
import re

from config import GAME
from granular import SHORTHAND
from live_flags import PEN_SHORT

MAX_QUARTER_S = 900


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
    if secs >= 60 or mins * 60 + secs > MAX_QUARTER_S:
        raise ValueError(f"'{text}' isn't a game clock (max 15:00)")
    return mins * 60 + secs


class ShorthandMixin:
    """GameEngine's shorthand line. The engine provides state, history, _batching, the actions (end_drive,
    new_drive, apply_penalty, record_play, set_situation), _checkpoint(), _save(), _db_delete_after() and the
    possession helpers (_lead, _ball_team, _other)."""

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
                yl = self._parse_spot(" ".join(toks[1:]), self._lead())    # new_drive's team
                self.new_drive(yl)
                done.append(f"new drive at {seg[4:].strip()}")
                continue
            if toks[0] in ("X", "FLAG"):
                self._flag(toks[1:])
                done.append(self.state["message"])
                continue
            if toks[0] == "I":
                self.record_play("P", 0, turnover=True, turnover_kind="int")
                done.append("interception")
                continue
            if toks[0] in SHORTHAND or toks[0] in ("SC", "S"):
                self._play(toks)
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

    def _flag(self, args):
        """'X', 'X DH', 'X DPI 25', 'X TB 5 1ST': a foul on the offense with the ball or on its defense."""
        offense = self._ball_team()
        defense = self._other(offense)
        num_tok = next((int(t) for t in args if re.fullmatch(r"\d+", t)), None)
        if not args:
            self.apply_penalty("OFFSET")
        elif args[0] in (offense, defense):
            self.apply_penalty("OTHER_O" if args[0] == offense else "OTHER_D", yards=num_tok,
                               auto_first=("1ST" in args or "AUTO" in args))
        elif args[0] in PEN_SHORT:
            self.apply_penalty(PEN_SHORT[args[0]], yards=num_tok)
        else:
            raise ValueError(f"Unknown flag '{args[0]}'. Try X DH, X FS, X OH, X DPI 25, X {defense} 5")

    def _play(self, toks):
        """'P 8', 'R -2 F', 'S 7', 'SC 6', 'P 35 TD', 'P 0 INT', 'D INC': a call and what came of it."""
        yards = 0
        for t in toks[1:]:
            if re.fullmatch(r"[+-]?\d+", t):
                yards = int(t)
        kind = "int" if "INT" in toks[1:] else "fumble" if "F" in toks[1:] else None
        extra = dict(td="TD" in toks[1:], turnover=kind is not None, turnover_kind=kind)
        if toks[0] in ("SC", "S"):
            self.record_play(toks[0], yards, **extra)
        else:
            self.record_play(None, yards, leaf=SHORTHAND[toks[0]],
                             outcome="incomplete" if "INC" in toks[1:] else None, **extra)

    def _parse_spot(self, text, team=None):
        """'D44' / 'DAL 44' = the offense's own 44 (`team`, by default the one with the ball); 'T30' / 'TB 30' = its
        opponent's 30; '50' = midfield; a bare number keeps the current side of the field."""
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
        off = team or self._ball_team()
        opp = self._other(off)
        if off.startswith(side) and not opp.startswith(side):
            return 100 - yd
        if opp.startswith(side):
            return yd
        raise ValueError(f"Field side '{side}' isn't {off} or {opp}")

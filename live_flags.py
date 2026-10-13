"""Fouls: the penalty table and how the engine enforces a flag from where the ball is, on the offense with the ball's
side of the field. A flag that wipes out a picked call logs that call as a nullified snap (scored, never part of his
in-game memory); a flag typed with no play becomes a flag row of its own (kind 'penalty': a timeline row, never a
snap: metrics, the play log and the archive skip it)."""

TOGO_MAX = 99                      # to go, and the yards of a foul typed by hand, at most

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


class FlagsMixin:
    """GameEngine's fouls. The engine provides state, the possession helpers (_ball_team, _other, _whose, _who,
    _stop_drive), predict(), _resolve_call(), _sit_fields(), _pred_fields(), _checkpoint(), _save(), _db_insert() and
    situation_text()."""

    def apply_penalty(self, code, yards=None, auto_first=None, play=None, source="manual", note=None, espn_id=None):
        """Enforce a foul from where the ball is now.
        play = {'leaf'/'family'/'outcome'} when the call was already picked: that snap is logged as
        nullified (counts for scoring the prediction, not for his in-game memory). Pre-snap fouls ignore it.
        yards: distance past the line for DPI, or the yardage for OTHER_D / OTHER_O.
        espn_id: the ESPN play a nullified call came from (the timeline's join key).
        v1.4 (G1-4): a foul typed by hand records what it did, so the field can draw it: a no-play row gets its
        enforced spot, and a flag with no play logged (pre-snap, or after a play that stands) becomes a flag row of
        its own (kind 'penalty': a timeline row, never a snap: metrics, the play log and the archive skip it)."""
        code = code.upper()
        if code not in PENALTIES:
            raise ValueError(f"Unknown penalty '{code}'")
        if not self.state["drive_active"]:
            raise ValueError(f"No {self._who()} drive in progress. Type the ball spot first.")
        label, against, pen_yds, first, lod, presnap = self._penalty_terms(code, yards, auto_first)
        rec = None
        if play and not presnap and any(play.get(k) for k in ("leaf", "family", "outcome", "call")):
            rec = self._resolve_call(play.get("call"), play.get("leaf"), play.get("family"), play.get("outcome"))
        self._checkpoint()
        before = self._sit_fields()
        row = self._no_play_row(rec, code, label, against, note, source, espn_id) if rec else None
        msg, ended = self._enforce(code, label, against, pen_yds, first, lod)
        if not ended:
            s = self.state["sit"]
            s["togo"] = max(1, min(s["togo"], s["yardline_100"]))
        if source == "manual":                     # ESPN's own spots come from the feed, not from this engine
            facts = self._flag_facts(before, against, ended)
            if row is not None:
                row.update(facts)
            else:
                fields = {k: v for k, v in before.items() if k != "snap"}      # a flag is not a snap
                self.state["log"].append({**fields, "kind": "penalty", "penalty": code, "name": msg[:160],
                                          "nullified": presnap, "source": source, **facts, **self._whose()})
        if ended:
            self.state["message"] = msg + ". Turnover on downs."
        else:
            self.state["message"] = f"{msg}. {self.situation_text()}." + \
                (" His call still counts for scoring." if rec else "")
        self._save()

    def _penalty_terms(self, code, yards, auto_first):
        """(label, against, yards, first down, loss of down, pre-snap) of a known foul, its yards checked."""
        label, against, pen_yds, first, lod, presnap = PENALTIES[code]
        if code in ("OTHER_D", "OTHER_O"):
            offense = self._ball_team()
            label = f"Penalty on {self._other(offense) if against == 'def' else offense}"
            first = bool(auto_first) if against == "def" else False
        if pen_yds in ("spot", "box"):
            if yards in (None, "") or int(yards) <= 0:
                raise ValueError("Type the yards first: how far past the line for DPI, or the penalty yardage.")
            pen_yds = int(yards)
            if pen_yds > TOGO_MAX:
                raise ValueError(f"Penalty yards must be from 1 to {TOGO_MAX}.")
        return label, against, pen_yds, first, lod, presnap

    def _no_play_row(self, rec, code, label, against, note, source, espn_id):
        """The picked call a flag wiped out, logged as a nullified snap (scored, not remembered)."""
        family, leaf, outcome, dropback, callcode, name = rec
        pred = self.predict()
        row = {**self._sit_fields(), **self._pred_fields(pred, family, leaf),
               "call": callcode, "dropback": dropback, "yards": 0, "success": None, "td": False,
               "turnover": False, "family": family, "leaf": leaf, "outcome": outcome,
               "name": f"{name} (no play" + (f": {note}" if note else f": {label.lower()}" if against else ", flag") + ")",
               "nullified": True, "penalty": code, "source": source, "espn_id": espn_id, **self._whose()}
        self.state["log"].append(row)
        self._db_insert(row)
        return row

    def _flag_facts(self, before, against, ended):
        """What a hand-typed foul did: who it was on, the yards walked, and the snap after it (None when the drive
        ended there)."""
        s = self.state["sit"]
        return {"pen_on": against, "pen_yards": abs(before["yardline_100"] - s["yardline_100"]) if against else None,
                "yardline_after": None if ended else s["yardline_100"], "down_after": None if ended else s["down"],
                "togo_after": None if ended else s["togo"]}

    def _enforce(self, code, label, against, pen_yds, first, lod):
        """Move the ball for a foul. (message, True when a loss of down on 4th ended the drive)."""
        s = self.state["sit"]
        yl, togo, down = s["yardline_100"], s["togo"], s["down"]
        goal_to_go = togo >= yl
        if against is None:
            return label, False
        if code == "DPI":
            new_yl = max(1, yl - pen_yds)
            s["yardline_100"] = new_yl
            s["down"], s["togo"] = 1, min(10, new_yl)
            return f"{label}: ball at the spot, {pen_yds} yards, automatic first down", False
        if against == "def":
            dist = pen_yds if pen_yds <= yl / 2 else yl / 2
            new_yl = max(1, int(round(yl - dist)))
            gained = yl - new_yl
            s["yardline_100"] = new_yl
            if first or gained >= togo:
                s["down"], s["togo"] = 1, min(10, new_yl)
            else:
                s["togo"] = new_yl if goal_to_go else togo - gained
            half = " (half the distance)" if dist < pen_yds else ""
            return f"{label}: {gained} yards{half}" + (", automatic first down" if first else ""), False
        room = 100 - yl
        dist = pen_yds if pen_yds <= room / 2 else room / 2
        new_yl = min(99, int(round(yl + dist)))
        lost = new_yl - yl
        s["yardline_100"] = new_yl
        s["togo"] = new_yl if goal_to_go else togo + lost
        half = " (half the distance)" if dist < pen_yds else ""
        msg = f"{label}: back {lost} yards{half}" + (", loss of down" if lod else "")
        if lod and down == 4:
            self._stop_drive()
            return msg, True
        if lod:
            s["down"] = down + 1
        return msg, False

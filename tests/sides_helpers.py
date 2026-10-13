"""Helpers for the engine's play-caller tests (tests/test_engine_*.py): a fingerprint of everything the engine
computes on a game (tests/fixtures/engine_default_tb_dal.json holds the Oct 12 engine's), and an ESPN driver that
applies the saved game to an engine tracking one or two offenses the way the feed does (espn_feed.Feed._apply_one and
_apply_admin), naming the team that has the ball on every change of possession (play-caller-models.md 7)."""
import hashlib
import json

from helpers import FIXTURES  # (helpers also puts ROOT on sys.path)

import config
from espn_feed import (END_OF_HALF_TYPES, classify, competitors, iter_plays, penalty_note, play_text, situation,
                       team_id)

GOLDEN = FIXTURES / "engine_default_tb_dal.json"
CONTRACT_KEYS = ("team", "caller")      # what the play-caller wiring adds to every caller row and prediction
CLOCK_KEYS = ("time",)                  # the wall-clock time a row was logged
DIGEST_CHARS = 16


def digest(value):
    """A short sha256 of the value's canonical JSON: floats as Python writes them, so equal means bit for bit."""
    text = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()[:DIGEST_CHARS]


def without(d, keys):
    return {k: v for k, v in d.items() if k not in keys}


def fingerprint(engine, feed, summary):
    """Apply the game one play at a time (as Watch does) and hash every prediction made while his offense had the
    ball (full precision, as predict() returns it) and every log row (but the wall-clock time); the final situation,
    memory, drives and scorecard as they are."""
    preds = []
    for team, p in iter_plays(summary):
        feed.apply_one(team, p)
        if engine.state["drive_active"]:
            preds.append(digest(without(engine.predict(), CONTRACT_KEYS)))
    s = engine.state
    return {"predictions": preds,
            "rows": [digest(without(r, CLOCK_KEYS + CONTRACT_KEYS)) for r in s["log"]],
            "sit": s["sit"], "mem": s["mem"], "drive_n": s["drive_n"], "drive_active": s["drive_active"],
            "drive_ends": s.get("drive_ends"), "metrics": engine.metrics()}


# ---------------------------------------------------------------- the saved game, either side or both
class SideDriver:
    """Applies ESPN plays to an engine the way espn_feed.Feed does, for every offense the engine tracks
    (engine.sides): a tracked team's snaps are logged with its own model, another team's are not, and the team that
    has the ball after a play is named (feed_sync's `team`)."""

    def __init__(self, engine, summary):
        self.engine, self.summary = engine, summary
        teams = [c["team"]["abbreviation"] for c in competitors(summary)]
        self.ids = {tid: t for t in teams if (tid := team_id(summary, t))}
        self.predictions = []           # (ESPN play id, the drive's team, predict()) before every tracked snap

    def apply(self, n=None):
        """Apply the first n plays (every play by default). Returns the number of snaps logged that count."""
        return sum(self.apply_one(team, p) for team, p in iter_plays(self.summary)[:n])

    def apply_one(self, team, p):
        e, home = self.engine, config.GAME["offense_is_home"]
        info = classify(team, p)
        start, end = situation(p, "start", home), situation(p, "end", home)
        ours = team in e.sides
        if info["kind"] == "skip":
            self._admin(info, start, end)
            return 0
        logged = 0
        if ours and info["kind"] == "play":
            e.feed_sync(start, offense_ball=True, team=team)
            self.predictions.append((info["id"], team, e.predict()))
            if info["nullified"]:
                note = penalty_note(play_text(info["text"]))
                e.apply_penalty("OFFSET", play={k: info[k] for k in ("leaf", "family", "outcome")}, source="espn",
                                note=note, espn_id=info["id"])
            else:
                e.record_play(None, info["yards"], td=info["td"], turnover=info["turnover"], leaf=info["leaf"],
                              family=None if info["leaf"] else info["family"], outcome=info["outcome"],
                              source="espn", feed=info)
                logged = 1
        elif ours and info["kind"] in ("punt", "fg", "fg_miss") and e.state["drive_active"]:
            e.end_drive(info["kind"])
        elif ours and info["kind"] == "sync":
            e.feed_sync(start, offense_ball=True, team=team)
        e.feed_sync(end, **self.ball(end))
        return logged

    def _admin(self, info, start, end):
        """Timeouts, kickoffs, tries, ends of quarters: clock and score; possession only when it's clean."""
        e = self.engine
        keep = {k: v for k, v in start.items() if k in ("qtr", "clock")}
        keep.update({k: v for k, v in end.items() if k in ("score_off", "score_opp")})
        half_over = any(k in info["type"] for k in END_OF_HALF_TYPES)
        e.feed_sync(keep, offense_ball=False if half_over else None)
        if "kickoff" in info["type"]:
            e.feed_sync({}, offense_ball=False)
            if "down" in end:
                e.feed_sync(end, **self.ball(end))

    def ball(self, end):
        """Who has the ball after the play: a tracked team with a down to play starts or keeps its drive, any other
        team ends the drive on the field, and nothing changes when ESPN doesn't say."""
        team = self.ids.get(end.get("_poss_id"))
        if team is None:
            return {"offense_ball": None}
        if team not in self.engine.sides:
            return {"offense_ball": False}
        return {"offense_ball": True, "team": team} if "down" in end else {"offense_ball": None}

"""Shared fixtures: the real ESPN game file (2026_05_TB_DAL), nflverse's play-by-play for the same game
as ground truth, and a sandboxed engine that never touches data/live_state.json or data/shadow.duckdb."""
import csv
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FIXTURES = ROOT / "tests" / "fixtures"
ESPN_EVENT = "401872980"
ESPN_FILE = ROOT / "data" / "espn" / f"summary_{ESPN_EVENT}_final.json"
NFLVERSE_FILE = FIXTURES / "nflverse_2026_05_TB_DAL.csv"

# The game in the saved file. Tests pin it so a new matchup in config.py doesn't break them.
TEST_GAME = {
    "game_id": "2026_05_TB_DAL", "label": "Buccaneers at Cowboys (test)", "offense": "DAL", "opponent": "TB",
    "offense_is_home": True, "offense_spread": 8.5, "total_line": 48.5, "espn_event": ESPN_EVENT,
}


def _num(v):
    if v in ("", None):
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


@pytest.fixture(scope="session")
def summary():
    return json.loads(ESPN_FILE.read_text())


@pytest.fixture(scope="session")
def nflverse():
    """nflverse rows keyed by NFL play_id (ESPN play id = event id + play_id)."""
    with NFLVERSE_FILE.open() as f:
        rows = list(csv.DictReader(f))
    text_cols = {"time", "posteam", "play_type", "td_team", "run_location", "run_gap"}
    return {str(int(float(r["play_id"]))): {k: (v or None) if k in text_cols else _num(v) for k, v in r.items()}
            for r in rows}


def nfl_id(play):
    return str(play["id"])[len(ESPN_EVENT):]


def scrimmage(r):
    """nflverse row is a real snap with a call to score (run/pass, or a run/pass wiped out by a flag)."""
    if r["play_type"] in ("run", "pass"):
        return not (r["qb_kneel"] or r["qb_spike"] or r["two_point_attempt"])
    return r["play_type"] == "no_play" and bool(r["pass"] or r["rush"])


@pytest.fixture(scope="module")
def sandbox(tmp_path_factory):
    """Patch every path the engine and feed write to, and pin GAME to the test game."""
    import config
    import espn_feed
    import live
    tmp = tmp_path_factory.mktemp("shadow")
    mp = pytest.MonkeyPatch()
    for k, v in TEST_GAME.items():
        mp.setitem(config.GAME, k, v)
    mp.setattr(live, "STATE_PATH", tmp / "live_state.json")
    mp.setattr(live, "DB_PATH", tmp / "shadow.duckdb")
    mp.setattr(espn_feed, "SEEN_PATH", tmp / "feed_seen.json")
    mp.setattr(espn_feed, "RAW_DIR", tmp / "espn")
    yield tmp
    mp.undo()


@pytest.fixture(scope="module")
def make_feed(sandbox):
    """Fresh engine + feed in the sandbox."""
    import threading
    import live
    from espn_feed import Feed

    def make():
        for p in sandbox.glob("*.json"):
            p.unlink()
        e = live.GameEngine()
        e.reset()
        return e, Feed(e, threading.RLock())
    return make

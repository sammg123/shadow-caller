"""Shared fixtures: the real ESPN game file (2026_05_TB_DAL), nflverse's play-by-play for the same game
as ground truth, and a sandboxed engine that never touches data/live_state.json or data/shadow.duckdb."""
import csv
import json

import pytest

from helpers import ESPN_FILE, NFLVERSE_FILE, TEST_GAME, _num  # noqa: F401  (helpers also puts ROOT on sys.path)


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

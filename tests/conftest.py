"""Shared fixtures: the real ESPN game file (2026_05_TB_DAL), nflverse's play-by-play for the same game
as ground truth, and a sandboxed engine that never touches data/live_state.json or data/shadow.duckdb."""
import csv
import hashlib
import json
import subprocess
import sys
import time

import pytest

from helpers import ESPN_FILE, NFLVERSE_FILE, ROOT, TEST_GAME, _free_port, _get, _num  # noqa: F401  (helpers also puts ROOT on sys.path)

LIVE_GAME_FILES = (ROOT / "data" / "live_state.json", ROOT / "data" / "feed_seen.json")


def _digests():
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None for p in LIVE_GAME_FILES}


@pytest.fixture(scope="session", autouse=True)
def test_suite_never_touches_the_live_game():
    """Data contract G39: the sha256 of data/live_state.json and data/feed_seen.json (when present) is the same
    before and after the whole run."""
    before = _digests()
    yield
    after = _digests()
    assert after == before, f"The test run changed the live game files: {before} -> {after}"


@pytest.fixture(scope="session")
def server(tmp_path_factory):
    """The app on a sandboxed copy of the data (offline, saved game) on a free port. Never the live game.
    Server output goes to a log file: a pipe nobody reads would fill up and stall the server."""
    port = _free_port()
    data = tmp_path_factory.mktemp("sandbox")
    log_path = tmp_path_factory.mktemp("sandbox-log") / "server.log"
    log = log_path.open("w")
    proc = subprocess.Popen([sys.executable, "scripts/sandbox.py", "--port", str(port), "--data", str(data)],
                            cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, text=True)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(240):
            try:
                _get(base + "/api/version")
                break
            except Exception:
                if proc.poll() is not None:
                    raise RuntimeError("sandbox server exited:\n" + log_path.read_text())
                time.sleep(0.25)
        else:
            raise RuntimeError("sandbox server did not start:\n" + log_path.read_text())
        yield {"base": base, "data": data, "port": port, "log": log_path}
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()


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

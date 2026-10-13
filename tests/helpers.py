"""Shared test constants and helpers (fixtures live in conftest.py)."""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _throwaway_data_dir():
    """A test process never defaults to the real data/ (data contract G39). config.py reads SHADOW_DATA_DIR at import,
    so every app module a test imports lands in this throwaway copy of the read-only inputs unless the test points it
    somewhere on purpose. The live game, the feed ids, the watch session and the archive are never copied."""
    import atexit
    import os
    import shutil
    import tempfile
    if os.environ.get("SHADOW_DATA_DIR"):
        return
    real = ROOT / "data"
    tmp = Path(tempfile.mkdtemp(prefix="shadow-test-data-"))
    for name in ("play_callers.csv", "play_callers_2024_2026.csv"):
        if (real / name).is_file():
            shutil.copy(real / name, tmp / name)
    (tmp / "espn").mkdir()
    for saved in (real / "espn").glob("*_final.json"):
        shutil.copy(saved, tmp / "espn" / saved.name)
    if (real / "logos").is_dir():
        shutil.copytree(real / "logos", tmp / "logos")
    os.environ["SHADOW_DATA_DIR"] = str(tmp)
    atexit.register(shutil.rmtree, tmp, True)


_throwaway_data_dir()

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


def nfl_id(play):
    return str(play["id"])[len(ESPN_EVENT):]


def scrimmage(r):
    """nflverse row is a real snap with a call to score (run/pass, or a run/pass wiped out by a flag)."""
    if r["play_type"] in ("run", "pass"):
        return not (r["qb_kneel"] or r["qb_spike"] or r["two_point_attempt"])
    return r["play_type"] == "no_play" and bool(r["pass"] or r["rush"])


# ---------------------------------------------------------------- HTTP against a sandboxed server (API and e2e tests)
EVENT = ESPN_EVENT


def _free_port():
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url, timeout=2):
    import urllib.request
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode())


def get(url, timeout=30):
    return _get(url, timeout=timeout)


def post(base, path, body=None):
    import urllib.request
    req = urllib.request.Request(base + path, data=json.dumps(body or {}).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def request_json(url, timeout=30):
    """(status, parsed body) of a GET, including 4xx answers (urlopen raises on those)."""
    import urllib.error
    import urllib.request
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


# The keys a log row had before rows carried seq, espn_id, clock_est and nullified: the shape of the game file the
# Oct 8 build wrote (data/live_state.json). A file like that must still load and draw.
LEGACY_ROW_KEYS = ("call", "clock", "down", "drive", "dropback", "fam_p", "fam_p_league", "fam_top", "family", "flag",
                   "leaf", "leaf_p", "leaf_p_league", "leaf_rank", "leaf_rank_league", "name", "outcome", "p",
                   "p_habits", "p_league", "qtr", "score", "snap", "success", "td", "time", "togo", "top_leaf",
                   "top_leaf_p", "turnover", "yardline_100", "yards")


def legacy_game(state):
    """A game state as the Oct 8 build saved it: no version, no drive_ends, log rows with LEGACY_ROW_KEYS only."""
    old = {k: v for k, v in state.items() if k not in ("version", "drive_ends")}
    old["log"] = [{k: r[k] for k in LEGACY_ROW_KEYS} for r in state["log"]]
    return old

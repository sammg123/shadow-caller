"""Shared test constants and helpers (fixtures live in conftest.py)."""
import csv
import json
import sys
from pathlib import Path

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


def nfl_id(play):
    return str(play["id"])[len(ESPN_EVENT):]


def scrimmage(r):
    """nflverse row is a real snap with a call to score (run/pass, or a run/pass wiped out by a flag)."""
    if r["play_type"] in ("run", "pass"):
        return not (r["qb_kneel"] or r["qb_spike"] or r["two_point_attempt"])
    return r["play_type"] == "no_play" and bool(r["pass"] or r["rush"])

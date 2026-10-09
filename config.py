"""Settings for the Shadow Play-Caller app. Edit GAME and the play-caller table for a new matchup.

Environment overrides (tests and demos run on a copy, never the live game): SHADOW_DATA_DIR, SHADOW_PORT,
SHADOW_ESPN_OFFLINE=1 (read data/espn/summary_<event>_final.json instead of calling ESPN), SHADOW_NO_BROWSER=1.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("SHADOW_DATA_DIR") or ROOT / "data")
MODEL_DIR = ROOT / "models"
DB_PATH = DATA_DIR / "shadow.duckdb"
CALLERS_CSV = DATA_DIR / "play_callers.csv"
STATE_PATH = DATA_DIR / "live_state.json"

# League seasons used for the caller-blind baseline (2026 = weeks published so far).
LEAGUE_SEASONS = list(range(2018, 2027))

# Whose brain we are modelling tonight. Snaps are selected through play_callers.csv.
CALLER_NAME = "Brian Schottenheimer"

# Tonight's game, from the offense's point of view.
GAME = {
    "game_id": "2026_05_TB_DAL",
    "label": "Buccaneers at Cowboys, Thursday Night Football, Oct 8",
    "offense": "DAL",
    "opponent": "TB",
    "offense_is_home": True,
    "offense_spread": 8.5,   # positive = offense favored (closing line from nflverse schedules)
    "total_line": 48.5,
    "espn_event": "401872980",   # ESPN game id; leave "" to find today's game automatically
}

SCRIPT_PLAYS = 15        # opening-script snaps: memory terms switched off
EXPLOSIVE_YARDS = 20
TILT = 0.15              # |p - league| at or above this -> TILT flag
LEAN = 0.08              # |p - league| at or above this -> lean flag
PORT = int(os.environ.get("SHADOW_PORT") or 5050)
ESPN_OFFLINE = os.environ.get("SHADOW_ESPN_OFFLINE") == "1"

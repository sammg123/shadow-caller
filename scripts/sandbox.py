"""Run the app on a throwaway copy of the data, for demos and UI testing. Never touches data/live_state.json.

    .venv/bin/python scripts/sandbox.py --port 5061              # new temp data dir, saved ESPN game, offline
    .venv/bin/python scripts/sandbox.py --data /tmp/x --online   # reuse a dir, call the real ESPN
"""
import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REAL_DATA = (ROOT / "data").resolve()


def prepare(data_dir):
    data_dir = Path(data_dir).resolve()
    if data_dir == REAL_DATA or REAL_DATA in data_dir.parents:
        sys.exit("Refusing to run the sandbox on the real data folder (that's the live game). Pick another --data.")
    (data_dir / "espn").mkdir(parents=True, exist_ok=True)
    shutil.copy(ROOT / "data" / "play_callers.csv", data_dir / "play_callers.csv")
    for saved in (ROOT / "data" / "espn").glob("*_final.json"):
        if not (data_dir / "espn" / saved.name).exists():
            shutil.copy(saved, data_dir / "espn" / saved.name)
    (data_dir / "logos").mkdir(exist_ok=True)
    for logo in (ROOT / "data" / "logos").glob("*.png"):     # team logos, filled once online by logos.py
        if logo.is_file() and not (data_dir / "logos" / logo.name).exists():
            shutil.copy(logo, data_dir / "logos" / logo.name)
    return data_dir


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=5061)
    ap.add_argument("--data", help="data folder to use (default: a new temp folder)")
    ap.add_argument("--online", action="store_true", help="call the real ESPN instead of the saved games")
    ap.add_argument("--dry-run", action="store_true", help="prepare the folder, print the settings, don't serve")
    a = ap.parse_args()
    data_dir = prepare(a.data or tempfile.mkdtemp(prefix="shadow-sandbox-"))
    env = {**os.environ, "SHADOW_DATA_DIR": str(data_dir), "SHADOW_PORT": str(a.port), "SHADOW_NO_BROWSER": "1",
           "SHADOW_ESPN_OFFLINE": "" if a.online else "1"}
    print(json.dumps({"data_dir": str(data_dir), "port": a.port, "url": f"http://127.0.0.1:{a.port}",
                      "offline": not a.online}), flush=True)
    if a.dry_run:
        return
    os.execve(sys.executable, [sys.executable, str(ROOT / "app.py")], env)


if __name__ == "__main__":
    main()

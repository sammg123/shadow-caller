"""Build the fixtures the JS unit tests load (docs/design/ui-architecture.md, section 7.1). Never touches the live game.

    .venv/bin/python scripts/capture_ui_fixtures.py rows              # tests/fixtures/timeline_contract_rows.json
    .venv/bin/python scripts/capture_ui_fixtures.py states --port 5241  # state_*.json from a new offline sandbox

`rows` is pure: it runs timeline.response over the saved TB at DAL game with every play applied, keeps the rows
the data contract quotes (B2, B5, G) in consecutive blocks, adds the snapshots at n = 104 and n = 183, and puts the
contract's B2 prediction on seq 2. `states` starts scripts/sandbox.py on its own temp data folder (offline, saved
game), sets each FI 6.1 precondition through the API, saves GET /api/state, then stops only that sandbox.
"""
from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
SAVED_GAME = ROOT / "data" / "espn" / "summary_401872980_final.json"
EVENT_ID = "401872980"
ROW_BLOCKS = ((1, 15), (41, 44), (85, 88), (100, 108), (112, 115), (159, 162), (183, 183))
SNAPSHOT_AT = (104, 183)
READY_TRIES, READY_WAIT_S = 160, 0.25
FEED_WAIT_S, FEED_POLL_S, FEED_LOG_ROWS = 30.0, 0.5, 59
HTTP_TIMEOUT_S = 60

# data-contract.md B2: the engine's prediction for the first DAL snap (log seq 1), quoted verbatim.
B2_PRED: dict[str, Any] = {
    "log_seq": 1, "snap": 1, "engine_drive": 1,
    "p": 0.4562, "p_league": 0.4624, "p_habits": 0.4562, "flag": "no edge",
    "top_leaf": "run_inside", "top_leaf_p": 0.2733, "top3": ["run_inside", "pa_short", "dropback_short"],
    "fam_top": "run",
    "family": "dropback", "leaf": "dropback_short", "outcome": "incomplete",
    "name": "Short (0–9 air yds), incomplete",
    "fam_p": 0.1781, "fam_p_league": 0.2004, "leaf_p": 0.14, "leaf_p_league": 0.1566,
    "leaf_rank": 3, "leaf_rank_league": 2, "dropback": 1, "success": 0, "retagged": False,
    "dist": {
        "his_f": [0.51834, 0.1781, 0.22386, 0.02782, 0.05187],
        "lg_f": [0.51724, 0.20045, 0.19354, 0.03468, 0.0541],
        "his_l": [0.27331, 0.08495, 0.04348, 0.05108, 0.06552, 0.14003, 0.02377, 0.01431, 0.15806, 0.04823,
                  0.01758, 0.02782, 0.03759, 0.01428],
        "lg_l": [0.24098, 0.06767, 0.05743, 0.06359, 0.08757, 0.15658, 0.02996, 0.0139, 0.12557, 0.04805,
                 0.01992, 0.03468, 0.03726, 0.01684],
    },
}


def write_json(name: str, body: Any) -> Path:
    path = FIXTURES / name
    path.write_text(json.dumps(body, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


# ---------------------------------------------------------------- rows (pure, no server)
def timeline_response(summary: dict, applied: list[str]) -> dict:
    sys.path.insert(0, str(ROOT))
    import timeline  # noqa: E402  (backend module, read only)
    from config import GAME  # noqa: E402
    return timeline.response(summary, applied, {"log": []}, GAME, epoch="contract-1", mode="replay", since=0)


def contract_rows() -> dict:
    sys.path.insert(0, str(ROOT))
    from espn_feed import iter_drive_plays  # noqa: E402
    summary = json.loads(SAVED_GAME.read_text(encoding="utf-8"))
    applied = [str(p.get("id")) for _team, _idx, _did, p in iter_drive_plays(summary)]
    full = timeline_response(summary, applied)
    keep = {seq for lo, hi in ROW_BLOCKS for seq in range(lo, hi + 1)}
    rows = [{**r, "pred": B2_PRED} if r["seq"] == 2 else r for r in full["rows"] if r["seq"] in keep]
    snapshots = {}
    for n in SNAPSHOT_AT:
        part = timeline_response(summary, applied[:n])
        snapshots[str(n)] = {k: part[k] for k in ("drives", "status", "box", "unlinked")}
    head = {k: v for k, v in full.items() if k != "rows"}
    return {**head, "rows": rows, "snapshots": snapshots,
            "provenance": "timeline.response over data/espn/summary_401872980_final.json, every play applied; "
                          "rows kept in blocks " + ", ".join(f"{a}-{b}" for a, b in ROW_BLOCKS)
                          + "; pred on seq 2 quoted from data-contract.md B2; snapshots = responses at n 104, 183"}


# ---------------------------------------------------------------- states (sandbox over HTTP)
def call(base: str, path: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method="GET" if body is None else "POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:     # 400 and 409 carry a JSON body with "error"
        return json.loads(e.read().decode())


def port_answers(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def start_sandbox(port: int) -> tuple[subprocess.Popen, str]:
    if port_answers(port):        # the live app (5050) or another server: its /api/version would pass for the sandbox
        raise RuntimeError(f"Port {port} is already in use; pick a free one (the live app runs on 5050).")
    proc = subprocess.Popen([sys.executable, "scripts/sandbox.py", "--port", str(port)], cwd=ROOT,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f"http://127.0.0.1:{port}"
    for _ in range(READY_TRIES):
        if proc.poll() is not None:
            raise RuntimeError("sandbox exited:\n" + (proc.stdout.read() if proc.stdout else ""))
        try:
            call(base, "/api/version")
            if proc.poll() is not None:   # it answered, but not from the sandbox we started: never reset that game
                raise RuntimeError("sandbox exited:\n" + (proc.stdout.read() if proc.stdout else ""))
            return proc, base
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(READY_WAIT_S)
    proc.terminate()
    raise RuntimeError("sandbox did not start")


def fresh(base: str) -> None:
    call(base, "/api/feed", {"on": False})
    call(base, "/api/reset", {})


def wait_for_feed(base: str) -> dict:
    deadline = time.monotonic() + FEED_WAIT_S
    while time.monotonic() < deadline:
        state = call(base, "/api/state")
        if len(state.get("log") or []) >= FEED_LOG_ROWS:
            return state
        time.sleep(FEED_POLL_S)
    raise RuntimeError(f"feed did not log {FEED_LOG_ROWS} rows within {FEED_WAIT_S} s")


def state_fresh(base: str) -> dict:
    fresh(base)
    return call(base, "/api/state")


def state_drive_d25(base: str) -> dict:
    fresh(base)
    call(base, "/api/command", {"text": "new D25"})
    return call(base, "/api/state")


def state_final(base: str) -> dict:
    call(base, "/api/feed", {"on": False})
    call(base, "/api/feed/replay", {"event_id": EVENT_ID})
    return call(base, "/api/state")


def state_feed_on(base: str) -> dict:
    fresh(base)
    call(base, "/api/feed", {"on": True, "event_id": EVENT_ID})
    return wait_for_feed(base)


STATE_STEPS: tuple[tuple[str, Callable[[str], dict]], ...] = (
    ("state_fresh.json", state_fresh),
    ("state_drive_d25.json", state_drive_d25),
    ("state_final.json", state_final),
    ("state_feed_on.json", state_feed_on),
)


def capture_states(base: str) -> list[Path]:
    written = [write_json(name, take(base)) for name, take in STATE_STEPS]
    call(base, "/api/feed", {"on": False})
    return written


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("what", choices=("rows", "states"))
    ap.add_argument("--port", type=int, default=5241, help="sandbox port for `states` (use a free one, 5200-5299)")
    a = ap.parse_args()
    FIXTURES.mkdir(parents=True, exist_ok=True)
    if a.what == "rows":
        print(write_json("timeline_contract_rows.json", contract_rows()))
        return
    proc, base = start_sandbox(a.port)
    try:
        for path in capture_states(base):
            print(path)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()

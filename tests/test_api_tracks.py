"""Per-game state over HTTP (game-picker.md 4 and 5; restructure-v2.md 11) on sandboxed servers (offline, saved games,
temp data folders; never the live game): GET /api/callers, /api/state's track and tracked, POST /api/game/select
behind the app's gate, and today's game adopted on a restart: copied once, the old files never written again, and
the next restart opening the same track."""
import hashlib
import json
import os
import subprocess
import sys

import pytest
from helpers import EVENT, ROOT, get, post
from test_api_safety import JSON, call, own_server, send

SEEN_TB_AT_DAL = {"event_id": EVENT, "sides": ["DAL"], "label": "TB at DAL"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def old_files(data):
    return {p.name: sha(p) for p in sorted(data.iterdir()) if p.is_file() and not p.name.startswith("shadow.duckdb")}


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("tracks") / "data"
    data.mkdir()
    with own_server(data) as s:
        yield s


# ---------------------------------------------------------------- the picker's reads
def test_callers_lists_every_play_caller_with_the_reason_a_model_is_missing(server):
    status, raw = call(server["base"], "/api/callers", method="GET")
    body = json.loads(raw)
    assert status == 200 and isinstance(body["callers"], list) and body["callers"]
    built = [c for c in body["callers"] if c["status"] == "built"]
    skipped = [c for c in body["callers"] if c["status"] != "built"]
    assert built and all(c["slug"] and c["name"] for c in built)
    assert skipped and all(c["reason"] for c in skipped), "the picker says why a side can't be shadowed"
    assert "stints" not in body["callers"][0], "only what the picker reads"


def test_callers_sits_behind_the_host_gate(server):
    status, _ = call(server["base"], "/api/callers", method="GET", headers={"Host": "rebound.example"})
    assert status == 400


def test_the_listing_shows_which_sides_have_a_model(server):
    """games.Games with the models' hook (game-picker.md 5.7): a side is modelled when its caller's bundle is built."""
    week = next(w for w in get(server["base"] + "/api/games")["weeks"] if w["key"] == "2-5")
    sides = {g["event_id"]: {g[s]["abbr"]: (g[s]["caller"] or {}).get("model") for s in ("away", "home")}
             for g in week["games"]}
    assert sides[EVENT] == {"TB": True, "DAL": True}
    assert sides["401872981"] == {"PHI": False, "JAX": True}, "Mannion: too few games for a model"


def test_the_state_names_the_game_and_its_play_caller(server):
    state = get(server["base"] + "/api/state")
    assert state["track"] == SEEN_TB_AT_DAL
    assert [{k: t[k] for k in ("team", "caller", "slug")} for t in state["tracked"]] == [
        {"team": "DAL", "caller": "Brian Schottenheimer", "slug": "brian-schottenheimer"}]


# ---------------------------------------------------------------- POST /api/game/select: the gate and the checks
@pytest.mark.parametrize("headers, status", [({"Content-Type": "text/plain"}, 415), ({}, 415),
                                             ({**JSON, "Origin": "http://evil.example"}, 403),
                                             ({**JSON, "Host": "rebound.example"}, 400)])
def test_select_sits_behind_the_apps_gate(server, headers, status):
    body = json.dumps({"event_id": EVENT, "sides": ["DAL"]}).encode()
    assert call(server["base"], "/api/game/select", data=body, headers=headers)[0] == status
    assert get(server["base"] + "/api/state")["track"] == SEEN_TB_AT_DAL


@pytest.mark.parametrize("body, status, says", [
    ({"event_id": EVENT}, 400, "sides"),
    ({"event_id": EVENT, "sides": ["DAL"], "x": 1}, 400, "Unknown field"),
    ({"event_id": EVENT, "sides": "DAL"}, 400, "list"),
    ({"event_id": EVENT, "sides": ["NYG"]}, 400, "isn't playing"),
    ({"event_id": "123", "sides": ["DAL"]}, 404, "123"),
    ({"event_id": "401872981", "sides": ["PHI"]}, 409, "Only 4 games"),          # PHI's caller: too few games
])
def test_select_refuses_with_the_reason_and_changes_nothing(server, body, status, says):
    before = get(server["base"] + "/api/state")
    got, answer = send(server["base"], "/api/game/select", body)
    assert got == status and says in answer["error"], answer
    assert answer["track"] == before["track"] and "sit" in answer, "the state body, like every POST"
    assert not (server["data"] / "games").exists()


def test_a_pick_opens_its_own_track_and_a_restart_reopens_it(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    with own_server(data) as s:
        status, answer = send(s["base"], "/api/game/select", {"event_id": EVENT, "sides": ["TB", "DAL"]})
        assert status == 200, answer
        assert answer["track"] == {"event_id": EVENT, "sides": ["TB", "DAL"], "label": "TB at DAL"}
        assert [t["team"] for t in answer["tracked"]] == ["TB", "DAL"]
        assert all(t["profile"]["caller"] == t["caller"] and "n" in t["metrics"] for t in answer["tracked"])
        assert answer["watch"]["state"] == "paused" and answer["watch"]["idx"] == 0, "a finished game opens at kickoff"
        seeked = send(s["base"], "/api/watch/seek", {"idx": 60})[1]
        assert {r["team"] for r in seeked["log"]} == {"TB", "DAL"}, "both offenses' calls, each his own"
        assert json.loads((data / "games" / "index.json").read_text())["current"] == {"event_id": EVENT,
                                                                                        "sides": ["TB", "DAL"]}
        other = {"event_id": "401872981"}                    # PHI at JAX: a game of its own, never this track's
        for path, body in (("/api/feed/replay", other), ("/api/watch/start", other), ("/api/watch/stop", {}),
                           ("/api/feed", {"on": True, **other})):
            status, answer = send(s["base"], path, body)
            assert path == "/api/watch/stop" or (status == 409 and "game picker" in answer["error"]), (path, answer)
        assert not list((data / "games").glob("401872981*")), "another game is never written into this track"
        status, answer = send(s["base"], "/api/game/select", {"event_id": EVENT, "sides": ["DAL"]})
        assert status == 200 and answer["track"] == SEEN_TB_AT_DAL and answer["watch"]["idx"] == 0
        status, answer = send(s["base"], "/api/game/select", {"event_id": EVENT, "sides": ["TB", "DAL"]})
        assert status == 200 and answer["watch"]["idx"] == 0, "back on the game it left, opened at kickoff"
    with own_server(data) as s:
        state = get(s["base"] + "/api/state")
        assert state["track"]["sides"] == ["TB", "DAL"] and [t["team"] for t in state["tracked"]] == ["TB", "DAL"]
    assert sorted(p.name for p in (data / "games" / EVENT).iterdir()) == ["DAL", "DAL+TB", "game.json"]


# ---------------------------------------------------------------- today's game, adopted on a restart
def test_a_restart_adopts_todays_game_and_never_writes_the_old_files_again(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    with own_server(data) as s:                                      # the app before per-game folders: a typed game
        post(s["base"], "/api/command", {"text": "new D25"})
        typed = post(s["base"], "/api/play", {"leaf": "run_inside", "yards": 4})["log"]
    assert typed and (data / "live_state.json").exists() and not (data / "games").exists()
    before = old_files(data)
    with own_server(data) as s:                                      # the first start of this build
        state = get(s["base"] + "/api/state")
        assert state["track"] == SEEN_TB_AT_DAL and state["log"] == typed
        folder = data / "games" / EVENT / "DAL"
        assert (folder / "live_state.json").read_bytes() == (data / "live_state.json").read_bytes()
        opened = post(s["base"], "/api/open")
        assert opened["watch"]["state"] == "paused" and opened["log"] == []
        post(s["base"], "/api/watch/seek", {"idx": 40})
        kept = list(folder.glob("live_state.backup-*.json"))
        assert len(kept) == 1 and json.loads(kept[0].read_text())["log"] == json.loads(
            (data / "live_state.json").read_text())["log"], "the typed game is backed up in its track"
    assert old_files(data) == before, "the data folder's own game files are never written again"
    index = json.loads((data / "games" / "index.json").read_text())
    assert index["adopted"]["sha256"] == before["live_state.json"]
    with own_server(data) as s:                                      # the next start: the same track, not adopted again
        state = get(s["base"] + "/api/state")
        assert state["track"] == SEEN_TB_AT_DAL and state["watch"]["state"] == "error", "the cut-short watch is back"
    assert json.loads((data / "games" / "index.json").read_text()) == index
    assert old_files(data) == before


IMPORT_ONLY = """
import app
print("TRACK", app.SWITCH.track, "STATE", app.live.STATE_PATH.name)
"""


def test_importing_the_app_never_adopts(tmp_path):
    """Only the server's own start adopts (python app.py: start.sh and scripts/sandbox.py). Importing the app (a test,
    a REPL, a tool) leaves the data folder exactly as it was: it can never copy a game the running app still writes."""
    data = tmp_path / "data"
    data.mkdir()
    with own_server(data) as s:                                      # the app before per-game folders: a typed game
        post(s["base"], "/api/command", {"text": "new D25"})
        post(s["base"], "/api/play", {"leaf": "run_inside", "yards": 4})
    before = old_files(data)
    env = {**os.environ, "SHADOW_DATA_DIR": str(data), "SHADOW_ESPN_OFFLINE": "1", "SHADOW_NO_BROWSER": "1"}
    proc = subprocess.run([sys.executable, "-c", IMPORT_ONLY], cwd=ROOT, env=env, capture_output=True, text=True,
                          timeout=240, check=False)
    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
    assert "TRACK None STATE live_state.json" in proc.stdout, "on the data folder, as before"
    assert not (data / "games").exists(), "an import never adopts"
    assert old_files(data) == before


def test_a_game_it_cant_adopt_runs_on_the_data_folder_as_before(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    (data / "live_state.json").write_text(json.dumps({"game": {"game_id": "2026_01_XX_YY"}, "log": []}))
    with own_server(data) as s:
        assert get(s["base"] + "/api/state")["track"] == SEEN_TB_AT_DAL
        assert "wasn't adopted" in s["log"].read_text()
    assert not (data / "games").exists()

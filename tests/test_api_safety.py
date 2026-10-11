"""Guards around the live game over HTTP, on sandboxed servers (offline, the saved TB at DAL game, temp data folders;
never the live game): only this machine's own page may change the game, a reset keeps a copy, an undo never takes an
ESPN play back out, a game file from an older build still serves its timeline, and a watch survives a server kill."""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager

import pytest
from helpers import EVENT, ROOT, _free_port, _get, get, legacy_game, post, request_json

JSON = {"Content-Type": "application/json"}
SESSION = ("playing", "paused", "done", "error")


def call(base, path, method="POST", data=b"{}", headers=None):
    """(status, body bytes) of a request sent with exactly these headers, 4xx and 5xx answers included."""
    req = urllib.request.Request(base + path, data=data if method == "POST" else None, method=method,
                                 headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def send(base, path, body):
    status, raw = call(base, path, data=json.dumps(body).encode(), headers=JSON)
    return status, json.loads(raw.decode())


def wait_until(cond, timeout=30.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.1)
    return cond()


@contextmanager
def own_server(data):
    """The app on its own data folder (offline, saved game), for a test that puts a file in place before the app
    starts, or that kills it. Stops only the process it started."""
    port = _free_port()
    log_path = data.parent / f"server-{port}.log"
    with log_path.open("w") as log:
        proc = subprocess.Popen([sys.executable, "scripts/sandbox.py", "--port", str(port), "--data", str(data)],
                                cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, text=True)
        base = f"http://127.0.0.1:{port}"
        try:
            for _ in range(240):
                if proc.poll() is not None:
                    raise RuntimeError("sandbox server exited:\n" + log_path.read_text())
                try:
                    _get(base + "/api/version")
                    break
                except OSError:
                    time.sleep(0.25)
            else:
                raise RuntimeError("sandbox server did not start:\n" + log_path.read_text())
            yield {"base": base, "proc": proc, "data": data, "log": log_path, "port": port}
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()


@pytest.fixture
def srv(server):
    """The shared sandbox server; a watch session a test leaves behind is stopped, with the game put back."""
    yield server
    if get(server["base"] + "/api/watch")["state"] in SESSION:
        send(server["base"], "/api/watch/stop", {"restore": True})


def typed_game(base):
    post(base, "/api/reset")
    post(base, "/api/command", {"text": "new D25"})
    return post(base, "/api/play", {"leaf": "run_inside", "yards": 4})


def test_only_this_machines_page_can_change_the_game(srv):
    """A page on another site can't send JSON without asking first (and is refused), and a DNS name rebound to
    127.0.0.1 isn't this app's name: none of them can reset the game or start a watch over it."""
    base, port = srv["base"], srv["port"]
    before = typed_game(base)["log"]
    refused = [
        ("/api/reset", {"Content-Type": "text/plain"}, 415),                      # a cross-site form or beacon
        ("/api/watch/start", {"Content-Type": "text/plain"}, 415),
        ("/api/reset", {}, 415),
        ("/api/reset", {**JSON, "Origin": "http://evil.example"}, 403),           # another site's page
        ("/api/reset", {**JSON, "Origin": "null"}, 403),
        ("/api/reset", {**JSON, "Host": f"evil.example:{port}"}, 400),            # a rebinding DNS name
    ]
    for path, headers, status in refused:
        assert call(base, path, headers=headers)[0] == status, (path, headers)
    assert call(base, "/api/state", "GET", headers={"Host": f"evil.example:{port}"})[0] == 400
    assert get(base + "/api/state")["log"] == before and get(base + "/api/watch")["state"] not in SESSION
    for host in (f"127.0.0.1:{port}", f"localhost:{port}"):                  # this machine's page, by either name
        headers = {**JSON, "Host": host, "Origin": f"http://{host}"}
        assert call(base, "/api/feed", data=b'{"on": false}', headers=headers)[0] == 200
        assert call(base, "/api/state", "GET", headers={"Host": host})[0] == 200
    big = b'{"text": "' + b"x" * 70_000 + b'"}'
    assert call(base, "/api/command", data=big, headers=JSON)[0] == 413
    assert get(base + "/api/state")["log"] == before


def test_reset_keeps_a_copy_of_the_game(srv):
    base, data = srv["base"], srv["data"]
    typed_game(base)
    game = json.loads((data / "live_state.json").read_text())
    before = set(data.glob("live_state.backup-*.json"))
    out = post(base, "/api/reset")
    made = set(data.glob("live_state.backup-*.json")) - before
    assert out["log"] == [] and len(made) == 1
    assert json.loads(made.pop().read_text())["log"] == game["log"]


def test_undo_never_takes_an_espn_play_back_out(srv):
    """U after a watched (or fed) play used to take its row out of the log while its id stayed applied, so it was
    never logged again and the field showed a snap with no prediction. Now that undo is refused (409, the reason in
    `error`) and nothing changes; a retag made after the last ESPN play can still be undone."""
    base = srv["base"]
    post(base, "/api/reset")
    status, out = send(base, "/api/watch/start", {"event_id": EVENT, "speed": 0.5, "from_seq": 2})
    assert status == 200
    assert wait_until(lambda: get(base + "/api/version")["timeline_n"] == 2)     # the kickoff and DAL's first snap
    send(base, "/api/watch/stop", {})                                            # keep the watched game
    v = get(base + "/api/version")
    status, out = send(base, "/api/undo", {})
    assert status == 409 and "ESPN" in out["error"] and len(out["log"]) == 1
    after = get(base + "/api/version")
    assert (after["epoch"], after["version"], after["timeline_n"]) == (v["epoch"], v["version"], 2)
    assert get(f"{base}/api/timeline?since=0&epoch={after['epoch']}")["rows"][1]["pred"] is not None
    assert send(base, "/api/retag", {"key": "A"})[1]["log"][0]["family"] == "pa"
    status, out = send(base, "/api/undo", {})
    assert status == 200 and out["log"][0]["family"] == "dropback" and out["version"] > after["version"]


def test_a_game_file_from_an_older_build_serves_its_timeline(server, tmp_path):
    """data/live_state.json from the Oct 8 build has log rows without seq: /api/timeline answered 500 on it."""
    base = server["base"]
    typed_game(base)
    post(base, "/api/play", {"leaf": "dropback_short", "yards": 7})
    state = json.loads((server["data"] / "live_state.json").read_text())
    data = tmp_path / "data"
    data.mkdir()
    (data / "live_state.json").write_text(json.dumps(legacy_game(state)))
    with own_server(data) as s:
        v = get(s["base"] + "/api/version")
        status, body = request_json(s["base"] + "/api/timeline?since=0")
        assert status == 200 and (body["source"], body["n"], v["timeline_n"]) == ("log", 2, 2)
        assert [r["id"] for r in body["rows"]] == ["log-1", "log-2"] and body["rows"][1]["pred"]["log_seq"] == 2


def test_a_new_matchup_keeps_the_old_game_file(tmp_path):
    """G1-3: config.py names a new game per matchup. The first change of the new game used to write over the old
    game's file with no copy; now a byte-identical copy is kept and the new game starts empty."""
    data = tmp_path / "data"
    data.mkdir()
    old = {"game": {"game_id": "2026_04_DAL_PHI", "offense": "DAL"}, "log": [{"seq": n, "snap": n} for n in range(1, 60)],
           "sit": {"down": 1}, "version": 400}
    raw = json.dumps(old).encode()
    (data / "live_state.json").write_bytes(raw)
    with own_server(data) as s:
        kept = list(data.glob("live_state.other-2026_04_DAL_PHI-*.json"))
        assert len(kept) == 1 and kept[0].read_bytes() == raw
        assert kept[0].name in get(s["base"] + "/api/state")["message"]              # the page says where it went
        out = post(s["base"], "/api/command", {"text": "new D25"})
        assert out["log"] == [] and out["drive_active"] is True
        assert json.loads((data / "live_state.json").read_text())["game"]["game_id"] != "2026_04_DAL_PHI"
        assert kept[0].read_bytes() == raw and len(list(data.glob("live_state.other-*.json"))) == 1
        assert kept[0].name in s["log"].read_text()                                 # and so does the server log


def test_a_watch_survives_a_server_kill(tmp_path):
    """SIGKILL mid-watch leaves the watched game in the files. After the restart the session is back, as an error
    that says what happened, and Stop still puts the real game back."""
    data = tmp_path / "data"
    data.mkdir()
    with own_server(data) as s:
        mine = typed_game(s["base"])
        assert send(s["base"], "/api/watch/start", {"event_id": EVENT, "speed": 0.5, "from_seq": 3})[0] == 200
        assert wait_until(lambda: get(s["base"] + "/api/version")["timeline_n"] == 3)
        s["proc"].kill()
        s["proc"].wait(timeout=10)
    with own_server(data) as s:
        base = s["base"]
        w = get(base + "/api/watch")
        assert w["state"] == "error" and "restart" in w["error"] and w["backup"]["state"]
        assert get(base + "/api/state")["timeline"]["source"] == "espn"         # the files hold the watched game
        status, out = send(base, "/api/watch/stop", {"restore": True})
        assert status == 200 and out["log"] == mine["log"] and out["watch"]["state"] == "stopped"
    with own_server(data) as s:                                                  # and it stays put back
        assert get(s["base"] + "/api/watch")["state"] == "idle"
        assert get(s["base"] + "/api/state")["log"] == mine["log"]


# ---------------------------------------------------------------- v1.4: the live feed, headers, errors (G1-2, 7, 9, 11)
FOREIGN = "401872111"


def plant_foreign_game(data):
    """A saved game whose header names NYG at PHI: what a stale or pasted ESPN event id brings (offline mode reads
    data/espn/summary_<event>_final.json)."""
    from helpers import ESPN_FILE
    s = json.loads(ESPN_FILE.read_text())
    for c in s["header"]["competitions"][0]["competitors"]:
        c["team"]["abbreviation"] = "PHI" if c["homeAway"] == "home" else "NYG"
    (data / "espn").mkdir(parents=True, exist_ok=True)
    (data / "espn" / f"summary_{FOREIGN}_final.json").write_text(json.dumps(s))


def names(log):
    return [(r["seq"], r["name"], r["yards"]) for r in log]


def test_the_live_feed_refuses_another_matchup_and_backs_up_first(tmp_path):
    """G1-2: the ESPN live key with another game's id used to log that whole game over the live one, with no copy.
    Now /api/feed checks the teams first: 400 with the reason, the game and the situation as they were, a backup
    kept. The right matchup still comes on, after a backup of the typed game it is about to add to."""
    data = tmp_path / "data"
    data.mkdir()
    plant_foreign_game(data)
    with own_server(data) as s:
        base = s["base"]
        mine = post(base, "/api/command", {"text": "new D25 | K 4 | Q2 11:11 | DAL 14 TB 10"})
        backups = set(data.glob("live_state.backup-*.json"))
        status, out = send(base, "/api/feed", {"on": True, "event_id": FOREIGN})
        assert status == 400 and out["error"] == f"ESPN event {FOREIGN} is NYG at PHI, not DAL v TB."
        assert (out["log"], out["sit"]) == (mine["log"], mine["sit"])
        assert out["feed"]["on"] is False and out["feed"]["state"] == "error"
        made = set(data.glob("live_state.backup-*.json")) - backups
        assert len(made) == 1 and names(json.loads(made.pop().read_text())["log"]) == names(mine["log"])
        time.sleep(1.0)
        assert get(base + "/api/state")["log"] == mine["log"]                     # nothing lands later either
        backups = set(data.glob("live_state.backup-*.json"))
        status, out = send(base, "/api/feed", {"on": True, "event_id": EVENT})      # TB at DAL: this game
        assert status == 200 and out["feed"]["on"] is True and "backed up" in out["message"]
        made = set(data.glob("live_state.backup-*.json")) - backups
        assert len(made) == 1 and names(json.loads(made.pop().read_text())["log"]) == names(mine["log"])
        assert send(base, "/api/feed", {"on": False})[0] == 200


SECURITY_HEADERS = {"Content-Security-Policy": "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*",
                    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
                    "Cross-Origin-Opener-Policy": "same-origin"}


def head_of(base, path, headers=None):
    req = urllib.request.Request(base + path, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers)


@pytest.mark.parametrize("path", ["/", "/report", "/static/js/main.js", "/api/state", "/api/version", "/api/logo/ZZZ"])
def test_no_other_site_can_frame_the_page(srv, path):
    """G1-7: a page on another site could frame the app invisibly and click 'ESPN live'. Only this machine's own
    pages may frame it now, and nothing may be sniffed into another type."""
    status, headers = head_of(srv["base"], path)
    assert status in (200, 404), path
    for name, value in SECURITY_HEADERS.items():
        assert headers.get(name) == value, (path, name)


@pytest.mark.parametrize("path", ["/", "/report", "/static/js/main.js", "/api/logo/DAL", "/api/export.csv",
                                  "/api/state"])
def test_a_rebound_dns_name_gets_nothing(srv, path):
    status, raw = call(srv["base"], path, "GET", headers={"Host": f"evil.example:{srv['port']}"})
    assert status == 400 and b"export" not in raw and b"<html" not in raw.lower(), path


def test_bad_bodies_get_json_errors_and_numbers_are_range_checked(srv):
    """G1-9: a list body, an empty body or a broken one is a 400 with JSON the page can show (it used to be an HTML
    500 or 400, which the page read as 'Can't reach the app server'); absurd numbers are refused."""
    base = srv["base"]
    before = typed_game(base)
    for path, data in [("/api/situation", b"[1, 2]"), ("/api/play", b""), ("/api/penalty", b"{not json"),
                       ("/api/retag", b'"A"'), ("/api/command", b"null"), ("/api/drive", b"[]"),
                       ("/api/score", b"7"), ("/api/feed", b"[true]"), ("/api/feed/replay", b"{")]:
        status, raw = call(base, path, data=data, headers=JSON)
        body = json.loads(raw.decode())
        assert status == 400 and body["error"] and "sit" in body, (path, data)
    for path, body, words in [("/api/play", {"leaf": "run_inside", "yards": -999999999999}, "-100 to 100"),
                              ("/api/play", {"leaf": "run_inside", "yards": 1e999}, "Yards"),
                              ("/api/play", {"leaf": "run_inside", "yards": "8"}, "Yards"),
                              ("/api/situation", {"down": 7}, "Down"), ("/api/situation", {"togo": 150}, "o go"),
                              ("/api/situation", {"clock": "99:99"}, "clock"),
                              ("/api/situation", {"qtr": "inf"}, "number"),
                              ("/api/retag", {"key": 5}, "key"), ("/api/penalty", {"yards": 5}, "code"),
                              ("/api/score", {"team": "x", "pts": 3}, "team"),
                              ("/api/drive", {"yard": 500}, "yard")]:
        status, out = send(base, path, body)
        assert status == 400 and words in out["error"], (path, body, out["error"])
    assert get(base + "/api/state")["log"] == before["log"]
    assert b'"error"' in call(base, "/api/nowhere", "GET")[1]                  # Flask's own 404 is JSON too


def test_an_error_nobody_planned_for_is_a_500_with_its_traceback_in_the_log(srv):
    """G1-9: routes used to turn any exception into a 400 with str(e) and log nothing (an engine KeyError showed a
    toast of '0'). Now only request errors are 400s; the rest is a 500 with the traceback in the server log."""
    base, data = srv["base"], srv["data"]
    deep = data / "espn" / "summary_401872002_final.json"
    deep.write_text("[" * 100_000 + "]" * 100_000)                 # valid JSON nothing can read: RecursionError
    try:
        status, out = send(base, "/api/feed/replay", {"event_id": "401872002"})
    finally:
        deep.unlink()
    assert status == 500 and "server log" in out["error"] and "sit" in out
    assert wait_until(lambda: "RecursionError" in srv["log"].read_text(), 5)


def test_a_replay_says_when_there_was_no_game_to_back_up(tmp_path):
    """G1-11: the replay message claimed 'Old game backed up in data/.' even when nothing was backed up."""
    data = tmp_path / "data"
    data.mkdir()
    with own_server(data) as s:
        out = post(s["base"], "/api/feed/replay", {"event_id": EVENT})
        assert "No earlier game to back up" in out["message"] and not list(data.glob("live_state.backup-*.json"))
        out = post(s["base"], "/api/feed/replay", {"event_id": EVENT})
        kept = sorted(p.name for p in data.glob("live_state.backup-*.json"))
        assert len(kept) == 1 and kept[0] in out["message"] and out["feed"]["plays_logged"] == 55


# ---------------------------------------------------------------- G1-13: no surprise model rebuild mid-game
START_WITH = """
import sys
sys.path.insert(0, {root!r})
import build
import live
calls = []
build.main = lambda: calls.append("built")
real = live.GameEngine
fails = iter([{fail!r}])


def engine():
    kind = next(fails, None)
    if kind == "missing":
        raise FileNotFoundError("models/stage1.joblib")
    if kind == "version":
        raise live.ModelVersionError("Model was built with a different scikit-learn version (1.8.0)")
    if kind == "broken":
        raise EOFError("a model file is cut short")
    return real()


live.GameEngine = engine
try:
    import app  # noqa: F401
    print("STARTED", calls)
except SystemExit as e:
    print("EXIT", calls, e)
except EOFError as e:
    print("RAISED", calls, e)
"""


@pytest.mark.parametrize("fail, in_progress, want", [
    ("missing", False, "STARTED ['built']"),          # a fresh setup: build, then start
    ("version", False, "STARTED ['built']"),          # a new scikit-learn and no game: rebuild
    ("version", True, "EXIT []"),                      # mid-game: never rebuild, say what to run
    ("missing", True, "EXIT []"),
    ("broken", False, "RAISED []"),                    # anything else is a broken setup: no rebuild, the error stands
])
def test_models_are_rebuilt_only_when_no_game_is_in_progress(tmp_path, fail, in_progress, want):
    """G1-13: any error loading the models used to start a rebuild (about 30 s online, a crash offline), even the
    restart in the middle of a game after a pip upgrade."""
    data = tmp_path / "data"
    data.mkdir()
    if in_progress:
        (data / "live_state.json").write_text(json.dumps({"game": {"game_id": "x"}, "log": [{"seq": 1}], "drive_n": 1}))
    env = {**os.environ, "SHADOW_DATA_DIR": str(data), "SHADOW_ESPN_OFFLINE": "1", "SHADOW_NO_BROWSER": "1"}
    out = subprocess.run([sys.executable, "-c", START_WITH.format(root=str(ROOT), fail=fail)], cwd=tmp_path, env=env,
                         capture_output=True, text=True, timeout=120)
    assert out.stdout.strip().splitlines()[-1].startswith(want), out.stdout + out.stderr
    if want.startswith(("EXIT", "RAISED")):
        assert "python build.py" in out.stdout

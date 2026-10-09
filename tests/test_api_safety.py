"""Guards around the live game over HTTP, on sandboxed servers (offline, the saved TB at DAL game, temp data folders;
never the live game): only this machine's own page may change the game, a reset keeps a copy, an undo that takes an
ESPN row's prediction away starts a new timeline, a game file from an older build still serves its timeline, and a
watch survives a server kill."""
import json
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
            yield {"base": base, "proc": proc, "data": data, "log": log_path}
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


def test_undo_that_takes_away_an_espn_rows_prediction_starts_a_new_timeline(srv):
    """A cached row would keep the prediction the undo removed (a ghost): a new epoch makes the client redraw."""
    base = srv["base"]
    post(base, "/api/reset")
    status, out = send(base, "/api/watch/start", {"event_id": EVENT, "speed": 0.5, "from_seq": 2})
    assert status == 200
    assert wait_until(lambda: get(base + "/api/version")["timeline_n"] == 2)     # the kickoff and DAL's first snap
    send(base, "/api/watch/stop", {})                                            # keep the watched game
    v = get(base + "/api/version")
    assert get(f"{base}/api/timeline?since=0")["rows"][1]["pred"] is not None
    post(base, "/api/undo")
    after = get(base + "/api/version")
    assert after["epoch"] != v["epoch"] and after["timeline_n"] == 2
    assert get(f"{base}/api/timeline?since=0&epoch={after['epoch']}")["rows"][1]["pred"] is None


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

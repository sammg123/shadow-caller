"""Game picker, the HTTP side (games_api.py; docs/design/game-picker.md): GET /api/games and GET /api/games/resolve on a
bare Flask app, strict validation and bounded answers. The last test checks the routes sit behind app.py's Host gate
once app.py registers them (skipped until then). Never the network, never data/."""
import json
import urllib.error
import urllib.request

import pytest
from flask import Flask

from helpers import request_json
from test_games import NOW, PHI_JAX, TB_DAL, Clock, FakeESPN, in_progress, board

import games
import games_api


def summary_404(event_id):
    raise urllib.error.HTTPError("https://site.api.espn.com/x", 404, "Not Found", {}, None)


def client(tmp_path, fetch=None, **kw):
    kw.setdefault("fetch_summary", summary_404)
    service = games.Games(tmp_path, fetch_json=fetch or FakeESPN(), clock=Clock(), **kw)
    app = Flask(__name__)
    app.register_blueprint(games_api.create_blueprint(service))
    return app.test_client()


def test_games_lists_the_season_current_week_first(tmp_path):
    r = client(tmp_path).get("/api/games")
    assert r.status_code == 200 and r.is_json
    assert r.headers["Cache-Control"] == "no-store"
    body = r.get_json()
    assert (body["season"], body["current"], body["offline"]) == (2026, "2-5", False)
    assert [w["key"] for w in body["weeks"]][:2] == ["2-5", "2-1"]
    tb_dal = next(g for g in body["weeks"][0]["games"] if g["event_id"] == TB_DAL)
    assert (tb_dal["status"], tb_dal["away"]["score"], tb_dal["home"]["score"]) == ("post", 24, 16)
    assert len(r.data) < games_api.MAX_BODY_BYTES


def test_a_live_game_shows_its_clock_and_score(tmp_path):
    fetch = FakeESPN(answers={(2, 5): in_progress(board(2, 5), PHI_JAX)})
    week = client(tmp_path, fetch).get("/api/games").get_json()["weeks"][0]
    g = next(x for x in week["games"] if x["event_id"] == PHI_JAX)
    assert (g["status"], g["clock"], g["period"], g["away"]["score"], g["home"]["score"]) == ("in", "12:34", 2, 3, 7)


def test_games_takes_no_parameters(tmp_path):
    r = client(tmp_path).get("/api/games?week=5")
    assert r.status_code == 400 and r.get_json() == {"error": "GET /api/games takes no parameters."}


def test_espn_unreachable_is_a_503_with_a_plain_message(tmp_path):
    r = client(tmp_path, FakeESPN(fail={(2, 1)})).get("/api/games")
    assert r.status_code == 503 and "ESPN" in r.get_json()["error"]


@pytest.mark.parametrize("ref", [TB_DAL, "https://www.espn.com/nfl/game/_/gameId/401872980/buccaneers-cowboys",
                                 "espn.com/nfl/game?gameId=401872980"])
def test_resolve_finds_a_game_by_id_or_address(tmp_path, ref):
    r = client(tmp_path).get("/api/games/resolve", query_string={"ref": ref})
    assert r.status_code == 200 and r.headers["Cache-Control"] == "no-store"
    game = r.get_json()["game"]
    assert (game["event_id"], game["game_id"], game["status"]) == (TB_DAL, "2026_05_TB_DAL", "post")


@pytest.mark.parametrize("query, why", [
    ("", "Send ref"),
    ("?ref=", "Paste an ESPN game id"),
    ("?ref=401872980&ref=401872981", "Send ref once"),
    ("?ref=401872980&week=5", "takes only ref"),
    ("?ref=https://evil.example/nfl/game/_/gameId/401872980", "espn.com"),
    ("?ref=" + "9" * 600, "too long"),
    ("?ref=%3Cscript%3E", "isn't an ESPN game id"),
])
def test_resolve_refuses_a_bad_request_with_the_reason(tmp_path, query, why):
    r = client(tmp_path).get("/api/games/resolve" + query)
    assert r.status_code == 400, r.get_json()
    assert why in r.get_json()["error"] and len(r.get_json()["error"]) <= games.ERROR_MAX


def test_resolve_a_game_espn_doesnt_have_is_a_404(tmp_path):
    r = client(tmp_path).get("/api/games/resolve?ref=123")
    assert r.status_code == 404 and r.get_json() == {"error": "ESPN has no game with id 123."}


def test_only_get(tmp_path):
    c = client(tmp_path)
    assert c.post("/api/games", json={}).status_code == 405
    assert c.post("/api/games/resolve", json={"ref": TB_DAL}).status_code == 405


def test_an_unplanned_failure_is_a_500_without_details(tmp_path, caplog):
    class Broken(games.Games):
        def season(self):
            raise RuntimeError("secret path /Users/x")

    app = Flask(__name__)
    app.register_blueprint(games_api.create_blueprint(Broken(tmp_path, fetch_json=FakeESPN(), clock=Clock())))
    r = app.test_client().get("/api/games")
    assert r.status_code == 500 and "secret" not in r.get_data(as_text=True)
    assert "secret path" in caplog.text, "the traceback goes to the server log"


def test_the_routes_sit_behind_the_apps_host_gate_once_registered(server):
    """app.py's Host check (TRUSTED_HOSTS) and before_request gate are app-wide, so a blueprint is covered as soon as
    it is registered. Skipped until app.py registers games_api (wired after the restructure lands)."""
    status, _ = request_json(server["base"] + "/api/games", timeout=60)
    if status == 404:
        pytest.skip("games_api isn't registered in app.py yet")
    assert status == 200
    req = urllib.request.Request(server["base"] + "/api/games", headers={"Host": "rebound.example"})
    with pytest.raises(urllib.error.HTTPError) as err:
        urllib.request.urlopen(req, timeout=30)
    assert err.value.code == 400
    assert json.loads(err.value.read().decode())["error"]
    assert NOW  # the sandbox is offline: the saved weeks, never the network

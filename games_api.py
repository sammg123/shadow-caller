"""The game picker's two calls (docs/design/game-picker.md 2), as a Flask Blueprint that app.py registers:

    GET /api/games                     200 {season, current, offline, weeks}: the season's weeks, the current one
                                       first, each game with its status, score and each team's play-caller. 400 for
                                       any parameter; 503 when ESPN's calendar can't be had.
    GET /api/games/resolve?ref=<text>  200 {game}: one game from an ESPN game id or the game's espn.com address. 400
                                       with the reason for anything else; 404 when the listing hasn't got it (the
                                       reason says why); 503 when ESPN can't be reached.

Both are read-only GETs. app.py's gate is app-wide, so it covers them as soon as they are registered: Flask's Host
check (TRUSTED_HOSTS) refuses a DNS name rebound to 127.0.0.1, and own_page_json_only lets GET through by design (it
guards the calls that change the game). Every answer is JSON with Cache-Control: no-store (a live game's clock
moves), its size bounded by games.py's caps (MAX_WEEKS weeks of at most MAX_GAMES games, every string capped).
"""
import logging

from flask import Blueprint, jsonify, request

import games

log = logging.getLogger(__name__)

SERVER_FAULT = "Something went wrong on the server; the server log has the details."
MAX_BODY_BYTES = 1024 * 1024               # the most a listing can weigh under games.py's caps is about half this


def create_blueprint(service):
    """GET /api/games and GET /api/games/resolve over a games.Games (one per app, so its caches are shared)."""
    bp = Blueprint("games", __name__)

    @bp.get("/api/games")
    def season():
        if request.args:
            return _error("GET /api/games takes no parameters.", 400)
        return _answer(service.season)

    @bp.get("/api/games/resolve")
    def resolve():
        refs = request.args.getlist("ref")
        if set(request.args) - {"ref"}:
            return _error("GET /api/games/resolve takes only ref.", 400)
        if not refs:
            return _error("Send ref: an ESPN game id or the game's espn.com address.", 400)
        if len(refs) > 1:
            return _error("Send ref once.", 400)
        return _answer(lambda: {"game": service.game(games.parse_game_ref(refs[0]))})

    return bp


def _answer(action):
    """The action's answer as JSON; its refusal as {error} with the right status (GamesError's own, 400 for a bad
    value); anything nobody planned for is a 500 with the traceback in the server log and nothing about it sent."""
    try:
        body = action()
    except games.GamesError as e:
        log.info("%s %s refused: %s", request.method, request.path, e)
        return _error(str(e), e.status)
    except ValueError as e:
        log.info("%s %s refused: %s", request.method, request.path, e)
        return _error(str(e), 400)
    except Exception:
        log.exception("%s %s failed", request.method, request.path)
        return _error(SERVER_FAULT, 500)
    resp = jsonify(body)
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _error(message, status):
    resp = jsonify({"error": str(message)[:games.ERROR_MAX]})
    resp.status_code = status
    resp.headers["Cache-Control"] = "no-store"
    return resp

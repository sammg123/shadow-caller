"""Localhost server for the Shadow Play-Caller.  Run:  python app.py  then open http://localhost:5050

Every POST answers with the state body (the UI re-renders from it), plus `error` when it is refused: 400 for a
request the game can't take, 409 when the game's state refuses it, and 500, with the traceback in the server log,
for anything nobody planned for (v1.4). Error pages are JSON too, and only this machine's own pages may frame it.
"""
import threads  # noqa: F401  (first: pins OpenMP/BLAS before numpy and sklearn load)
import functools
import json
import logging
import math
import os
import re
import threading
import urllib.error
import webbrowser
from threading import Timer

from flask import Flask, Response, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

import logos
import timeline
import watch
from config import DATA_DIR, ESPN_OFFLINE, GAME, PORT, ROOT, STATE_PATH, WATCH_SCALE
from live import GameEngine, ModelVersionError, UndoRefused, parse_clock

if __name__ == "__main__":       # the server log: request refusals (info), warnings, and tracebacks of real faults
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = Flask(__name__, static_folder=str(ROOT / "static"))
LOCK = threading.RLock()
log = logging.getLogger("app")
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
# Only this machine's own page drives the app. A Host other than its own names is a DNS name rebound to 127.0.0.1
# (Flask answers 400), and the biggest real body is a shorthand line, far under 64 KB (413 above it).
app.config.update(TRUSTED_HOSTS=["127.0.0.1", "localhost"], MAX_CONTENT_LENGTH=64 * 1024)
# v1.4 (G1-7): no other site may frame the page (a hidden frame could click 'ESPN live'). Sam's own preview tools on
# other local ports still may, so frame-ancestors rather than X-Frame-Options, which can't say that.
SECURITY_HEADERS = {
    "Content-Security-Policy": "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
}
SERVER_FAULT = "Something went wrong on the server; the server log has the details."
ERROR_MAX = 300                    # characters of an error message sent back
YARDS_MIN, YARDS_MAX = -100, 100
SCORE_MAX, SCORE_STEP_MAX = 199, 99
TEXT_FIELD_MAX = 40                # a call, leaf, family, outcome, side, team or drive end
COMMAND_MAX = 500


# ---------------------------------------------------------------- the engine (G1-13: no surprise rebuild mid-game)
def game_in_progress():
    """True when data/live_state.json holds a game with plays or a drive: a model rebuild must not run under it."""
    try:
        s = json.loads(STATE_PATH.read_text())
    except (OSError, ValueError):
        return False
    return isinstance(s, dict) and (bool(s.get("log")) or bool(s.get("drive_active")) or bool(s.get("drive_n")))


def _load_engine():
    """The engine. Missing models, or models built with another scikit-learn, are rebuilt (about 30 s and ESPN data)
    only when no game is in progress: a rebuild mid-game would change his predictions, and fails offline. Anything
    else is a broken setup: the message says to run build.py, and the error stands."""
    try:
        return GameEngine()
    except (FileNotFoundError, ModelVersionError) as e:
        if game_in_progress():
            raise SystemExit(f"Can't load the models ({e}). A game is in progress in {STATE_PATH.name}, so they were "
                             "not rebuilt: run  python build.py  when you're ready, then start the app again.") from e
        print(f"Models missing or built elsewhere ({e}). Building now, about 30 seconds...")
        import build
        build.main()
        return GameEngine()
    except Exception as e:
        print(f"Couldn't load the models ({type(e).__name__}: {e}). Run  python build.py  to rebuild them.")
        raise


engine = _load_engine()

import espn_feed  # noqa: E402  (needs the engine)
from espn_feed import Feed  # noqa: E402

feed = Feed(engine, LOCK)
WATCH = watch.Watch(feed, LOCK, pace_scale=WATCH_SCALE)   # "Watch this game"; while a session is on, mode is "watch"
SINCE_RE = re.compile(r"[0-9]{1,9}")         # ASCII digits only: '\d' takes Arabic-Indic and fullwidth digits too
_ROWS = {"epoch": None, "cache": {}}           # timeline rows frozen per epoch (data contract F3)


def logo_summary():
    """The current game's ESPN summary for the logo route: memory, then the saved files. Under LOCK, because loading
    a file sets feed.summary."""
    with LOCK:
        return feed.load_summary()


logos.register(app, logo_summary, lambda: (GAME["offense"], GAME["opponent"]), DATA_DIR, ESPN_OFFLINE)


def timeline_source():
    return timeline.source_of(feed.summary, feed.applied)


def timeline_mode():
    if WATCH.state in watch.SESSION:
        return "watch"
    if feed.on:
        return "live"
    return "replay" if timeline_source() == "espn" else "manual"


def timeline_pointer():
    """{n, epoch, source, mode}: O(1) and lock-free, for /api/state and /api/version."""
    source = timeline_source()
    n = len(feed.applied) if source == "espn" else len(engine.state.get("log") or [])
    return {"n": n, "epoch": engine.epoch(), "source": source, "mode": timeline_mode()}


def view():
    v = engine.view()
    v["feed"] = {**feed.status, "on": feed.on, "event_id": feed.event_id}
    v["timeline"] = timeline_pointer()
    v["watch"] = WATCH.snapshot()
    return v


def ok():
    with LOCK:
        return jsonify(view())


def fail(e, status=400):
    """The state body plus the error, like every POST answers (the UI re-renders from it)."""
    with LOCK:
        v = view()
    v["error"] = str(e)[:ERROR_MAX]
    return jsonify(v), status


# ---------------------------------------------------------------- answers (G1-9)
CLIENT_ERRORS = (ValueError, FileNotFoundError, urllib.error.URLError, TimeoutError)


def state_call(action):
    """Run a POST's action and answer like every POST: the state body, or it plus the error. 400 for a request the
    game can't take (a bad value, no saved game, ESPN unreachable), 409 when the game's state refuses it (an undo
    past ESPN, a watch on screen); a KeyError or TypeError is a 400 too, with its traceback in the server log in
    case it isn't the request's fault. Anything else is a 500 with its traceback in the server log. An action may
    return its own response."""
    try:
        answer = action()
        return ok() if answer is None else answer
    except watch.WatchError as e:
        return fail(e, e.status)
    except UndoRefused as e:
        return fail(e, 409)
    except HTTPException:              # Flask's own answers (a body over the size limit): let Flask send them
        raise
    except CLIENT_ERRORS as e:         # a bad value or id, no saved game or one that can't be read, ESPN unreachable
        log.info("%s %s refused: %s", request.method, request.path, e)
        return fail(e)
    except KeyError as e:
        log.warning("%s %s refused: missing %r", request.method, request.path, e.args[0] if e.args else e,
                    exc_info=True)
        return fail(f"That request is missing {str(e.args[0] if e.args else e)[:40]!r}.")
    except TypeError as e:
        log.warning("%s %s refused: %s", request.method, request.path, e, exc_info=True)
        return fail(f"That request has a value of the wrong type ({e}).")
    except Exception:
        log.exception("%s %s failed", request.method, request.path)
        return fail(SERVER_FAULT, 500)


def answers_with_state(route):
    """A POST route in state_call's shape: it changes the game, the answer is the state body."""
    @functools.wraps(route)
    def wrapped(*args, **kwargs):
        return state_call(lambda: route(*args, **kwargs))
    return wrapped


def json_object():
    """The request's JSON object. ValueError (a 400) for an empty body, one that isn't JSON or isn't an object."""
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        raise ValueError("Send a JSON object.")
    return d


def number(value, what):
    """An int from a JSON number or the text of one ('14', '2.0'; a fraction is cut off, as typed boxes always
    were). ValueError for anything else: text that isn't a number, NaN, infinity, true or false."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"{what} must be a number.")
    try:
        return int(float(value)) if isinstance(value, str) else int(value)
    except (ValueError, OverflowError):
        raise ValueError(f"'{str(value)[:20]}' isn't a number ({what}).") from None


def whole(value, what, lo, hi):
    """A JSON whole number from lo to hi (a typed box sends text: those go through number())."""
    ok_type = isinstance(value, int) or (isinstance(value, float) and math.isfinite(value) and value.is_integer())
    if isinstance(value, bool) or not ok_type or not lo <= value <= hi:
        raise ValueError(f"{what} must be a whole number from {lo} to {hi}.")
    return int(value)


def in_range(value, what, lo, hi):
    n = number(value, what)
    if not lo <= n <= hi:
        raise ValueError(f"{what} must be from {lo} to {hi}.")
    return n


def text(d, key, what=None, required=False):
    """A short text field: None when absent (or null), else a string of at most TEXT_FIELD_MAX characters."""
    value = d.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > TEXT_FIELD_MAX:
        raise ValueError(f"Send {what or key} as text.")
    return value.strip()


def flag(d, key):
    """A yes/no field: absent or null is no."""
    value = d.get(key)
    if value is None:
        return False
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be true or false.")
    return value


@app.errorhandler(HTTPException)
def http_error(e):
    """Flask's own answers (404, 405, 413, a Host that isn't this machine's) as JSON the page can read."""
    return jsonify({"error": str(e.description or e.name)[:ERROR_MAX]}), e.code


@app.errorhandler(Exception)
def server_error(e):
    """A GET that failed in a way nobody planned for: the traceback in the server log, JSON for the page."""
    log.exception("%s %s failed", request.method, request.path)
    return jsonify({"error": SERVER_FAULT}), 500


@app.before_request
def own_page_json_only():
    """A page on another site can POST text/plain or a form to localhost without asking first, and the routes'
    get_json(force=True) would read it: anything that changes the game must be JSON (cross-site JSON needs a CORS
    preflight this app never grants, 415 otherwise), and an Origin, when sent, must be this app's own (403). An
    oversized body is refused before anything reads it (413; the routes would turn a late 413 into a 400)."""
    if (request.content_length or 0) > app.config["MAX_CONTENT_LENGTH"]:
        return jsonify({"error": "That request is too big."}), 413
    if request.method in SAFE_METHODS:
        return None
    origin = request.headers.get("Origin")
    if origin is not None and origin != request.host_url.rstrip("/"):
        return jsonify({"error": "This app only takes changes from its own page."}), 403
    if not request.is_json:
        return jsonify({"error": "Send JSON (Content-Type: application/json)."}), 415
    return None


@app.after_request
def security_headers(resp):
    for name, value in SECURITY_HEADERS.items():
        resp.headers.setdefault(name, value)
    return resp


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/state")
def state():
    return ok()


@app.get("/api/version")
def version():
    tl = timeline_pointer()
    return jsonify({"version": engine.version, "epoch": tl["epoch"], "timeline_n": tl["n"],
                    "feed": {**feed.status, "on": feed.on}, "watch": WATCH.brief()})


def timeline_args(args):
    """(since, until, error) from the query: ASCII whole numbers; until is optional and never before since."""
    since, until = args.get("since", "0"), args.get("until")
    if not SINCE_RE.fullmatch(since):
        return None, None, "since must be a whole number"
    if until is None:
        return int(since), None, None
    if not SINCE_RE.fullmatch(until):
        return None, None, "until must be a whole number"
    if int(until) < int(since):
        return None, None, "until can't be before since"
    return int(since), int(until), None


@app.get("/api/timeline")
def timeline_rows():
    """Every applied play, both teams (data contract C1). ?since=n returns rows after n; a missing or stale
    ?epoch= answers as since=0 with reset true. ?until=m (v1.2) answers as of row m: rows up to m, and drives,
    status and box as they stood after it, so a batch of rows can be shown one row at a time."""
    since, until, error = timeline_args(request.args)
    if error:
        return jsonify({"error": error}), 400
    with LOCK:
        epoch = engine.epoch()
        if _ROWS["epoch"] != epoch:
            _ROWS.update(epoch=epoch, cache={})
        body = timeline.response(feed.load_summary(), feed.applied, engine.state, GAME, epoch=epoch,
                                 mode=timeline_mode(), since=since, until=until,
                                 client_epoch=request.args.get("epoch"), cache=_ROWS["cache"],
                                 skipped=feed.skipped_ids)
    return jsonify(body)


# ---------------------------------------------------------------- manual entry
@app.post("/api/situation")
@answers_with_state
def situation():
    d = {k: (v.strip() if isinstance(v, str) else v) for k, v in json_object().items()}
    d = {k: v for k, v in d.items() if v not in (None, "")}

    def num(key):
        return number(d[key], key) if key in d else None

    yl = None
    if d.get("side") and d.get("yard") is not None:
        yd = in_range(d["yard"], "The yard line", 1, 50)
        yl = 100 - yd if d["side"] == "own" else yd
    togo = d.get("togo")
    if togo is not None and str(togo).upper() not in ("G", "GOAL"):
        togo = num("togo")
    spot = d.get("spot")
    if spot is not None and not isinstance(spot, str):
        raise ValueError("Send the spot as text, like DAL 25.")
    with LOCK:
        engine.set_situation(down=num("down"), togo=togo, yardline_100=yl, qtr=num("qtr"),
                             clock=parse_clock(d["clock"]) if "clock" in d else None,
                             score_off=num("score_off"), score_opp=num("score_opp"), spot=spot)


@app.post("/api/play")
@answers_with_state
def play():
    d = json_object()
    yards = whole(d.get("yards", 0), "Yards", YARDS_MIN, YARDS_MAX)
    with LOCK:
        engine.record_play(text(d, "call"), yards, td=flag(d, "td"), turnover=flag(d, "turnover"),
                           penalty=flag(d, "penalty"), leaf=text(d, "leaf"), family=text(d, "family"),
                           outcome=text(d, "outcome"))


def play_picked(d):
    """The call a flag wipes out (POST /api/penalty's `play`), as text fields only; None when there is none."""
    picked = d.get("play")
    if picked is None:
        return None
    if not isinstance(picked, dict):
        raise ValueError("Send the play as an object (leaf, family, outcome).")
    return {k: text(picked, k) for k in ("call", "leaf", "family", "outcome")}


@app.post("/api/penalty")
@answers_with_state
def penalty():
    d = json_object()
    code = text(d, "code", "the penalty code", required=True)
    yards = None if d.get("yards") in (None, "") else in_range(d["yards"], "Yards", 1, 99)
    with LOCK:
        engine.apply_penalty(code, yards=yards, auto_first=flag(d, "auto_first"), play=play_picked(d))


@app.post("/api/retag")
@answers_with_state
def retag():
    key = json_object().get("key")
    if not (isinstance(key, str) and len(key.strip()) == 1):
        raise ValueError("Send the retag key: one letter, like A.")
    with LOCK:
        engine.retag_last(key.strip())


@app.post("/api/drive")
@answers_with_state
def drive():
    d = json_object()
    end = text(d, "end", "how the drive ended")
    if end:
        with LOCK:
            engine.end_drive(end)
        return
    yd = in_range(d.get("yard"), "The yard line", 1, 50)
    side = text(d, "side") or "own"
    yl = 100 - yd if side == "own" else yd
    scores = {k: in_range(d[k], k, 0, SCORE_MAX) for k in ("score_off", "score_opp") if d.get(k) is not None}
    qtr = in_range(d["qtr"], "The quarter", 1, 5) if d.get("qtr") is not None else None
    with LOCK:
        engine.new_drive(yl, qtr=qtr, clock=parse_clock(d["clock"]) if d.get("clock") else None, **scores)


@app.post("/api/score")
@answers_with_state
def score():
    d = json_object()
    team = text(d, "team", required=True)
    if team not in ("off", "opp"):
        raise ValueError("The team must be off or opp.")
    pts = in_range(d.get("pts"), "Points", -SCORE_STEP_MAX, SCORE_STEP_MAX)
    with LOCK:
        engine.add_score(team, pts)


@app.post("/api/command")
@answers_with_state
def command():
    line = json_object().get("text")
    if not isinstance(line, str) or not line.strip() or len(line) > COMMAND_MAX:
        raise ValueError(f"Send the shorthand line as text (at most {COMMAND_MAX} characters).")
    with LOCK:
        engine.command(line)


@app.post("/api/undo")
@answers_with_state
def undo():
    """One step back. Never past a play ESPN applied (the feed, a replay or a watch): its id stays applied, so the
    feed would never log it again. That undo is refused with 409 and the reason; nothing changes."""
    with LOCK:
        rows = len(engine.state.get("log") or [])
        manual = timeline_source() == "log" and bool(engine.history)
        engine.undo()
        if manual or len(engine.state.get("log") or []) != rows:
            engine.bump_epoch()        # rows the client drew changed under it (a typed row and its pred)


@app.post("/api/reset")
@answers_with_state
def reset():
    with LOCK:
        WATCH.require_idle("resetting the game")
        try:
            watch.backup_game()        # first, like a replay: a reset (or a stray one) never loses the game
        except OSError as e:
            log.exception("Reset refused: the game couldn't be backed up")
            return fail(f"Couldn't keep a copy of the game, so nothing was reset ({e}).", 500)
        feed.stop()
        feed.invalidate()              # a live poll in flight can't land in the fresh game (data contract E2.4)
        engine.reset()
        feed.forget()
    return None


# ---------------------------------------------------------------- the ESPN feed (G1-2, G1-11)
def preflight(eid):
    """The summary the live feed would see first, fetched before taking LOCK (up to 10 s). None when ESPN can't be
    reached or doesn't answer with a game summary now: the feed's own polls retry, and check, those."""
    try:
        return espn_feed.check_summary(espn_feed.fetch_summary(eid), live=True)
    except (OSError, ValueError) as e:
        log.info("Live feed: no summary for ESPN event %s yet (%s); its polls will check it.", eid, e)
        return None


def backup_before_feed(eid):
    """Under LOCK: copy the game aside before the live feed adds to it, when it follows another event than the one
    its applied plays came from, or when the game has typed plays and nothing from ESPN yet. The copy's name or
    None."""
    typed_only = bool(engine.state.get("log")) and not feed.applied
    if eid == feed.event_id and not typed_only:
        return None
    kept = watch.backup_game()["state"]
    return kept.name if kept else None


@app.post("/api/feed")
@answers_with_state
def feed_control():
    """The ESPN live key. Turning it on checks the event first: another matchup's game is a 400 with the reason
    (ESPN event X is NYG at PHI, not DAL v TB) and never touches the game."""
    d = json_object()
    on = d.get("on")
    if not isinstance(on, bool):
        raise ValueError("Send on: true or false.")
    if not on:
        with LOCK:
            feed.stop()
            engine.state["message"] = "ESPN live feed off. Enter plays by hand."
        return
    WATCH.require_idle("turning the live feed on")             # before any network call
    eid = feed.resolve_event(d.get("event_id") or None)        # today's game can take a 10 s call: not under LOCK
    first = preflight(eid)
    with LOCK:                     # atomic with /api/watch/start: the live feed never comes on during a watch
        WATCH.require_idle("turning the live feed on")
        try:
            kept = backup_before_feed(eid)
        except OSError as e:
            log.exception("Live feed refused: the game couldn't be backed up")
            return fail(f"Couldn't keep a copy of the game, so the live feed stayed off ({e}).", 500)
        if first is not None:
            try:
                espn_feed.check_matchup(first, eid)
            except espn_feed.WrongGame as e:
                feed.stop()
                feed.status.update(state="error", detail=str(e)[:espn_feed.STATUS_MAX])
                raise
        feed.start(eid)
        engine.state["message"] = ("ESPN live feed on." + (f" Your game was backed up first ({kept})." if kept else "")
                                   + " Plays log themselves; retag play-action, screen or RPO.")


@app.post("/api/feed/replay")
@answers_with_state
def feed_replay():
    """Rebuild a whole game from ESPN: backs up the game file and the applied ids, clears them, applies every play.
    The live feed stops first, so a poll already in flight can't land in the rebuilt game (data contract E6)."""
    d = json_object()
    eid = str(d.get("event_id") or feed.event_id or "")
    if not eid:
        raise ValueError("Enter the ESPN event id to replay.")
    WATCH.require_idle("replaying a game")
    summary = espn_feed.fetch_summary(eid)
    with LOCK:
        WATCH.require_idle("replaying a game")
        kept = watch.backup_game()["state"]
        was_on = feed.on
        feed.stop()
        feed.invalidate()
        engine.reset()
        feed.forget()
        feed.event_id = eid
        n = feed.poll_once(summary)
        engine.state["message"] = replay_message(eid, n, len(feed.skipped_ids), was_on, kept)
        engine._save()


def replay_message(eid, n, skipped, was_on, kept):
    return (f"Replayed ESPN game {eid}: {n} {engine.profile['team']} plays logged."
            + (f" {skipped} plays couldn't be applied (the server log says why); type any of his by hand." if skipped
               else "")
            + (" The live feed is off." if was_on else "")
            + (f" Your old game is backed up as {kept.name}." if kept else " No earlier game to back up."))


# ---------------------------------------------------------------- Watch this game (data contract E1)
def watch_body():
    """The request's JSON, None when there is no body. A body that doesn't parse is a 400, never 'no fields': a
    cut-off stop {"restore": true} must not read as keeping the watched game."""
    raw = request.get_data(cache=True, as_text=True)
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except ValueError:
        raise watch.WatchError("That request body isn't valid JSON.", 400) from None


def watch_action(method):
    """pause, resume and step: no fields, then the action."""
    def run():
        watch.parse_empty(watch_body())
        method()
    return state_call(run)


@app.get("/api/watch")
def watch_state():
    return jsonify(WATCH.snapshot())


@app.post("/api/watch/start")
def watch_start():
    def start():
        eid, speed, from_seq = watch.parse_start(watch_body(), feed.event_id or GAME.get("espn_event"))
        WATCH.check_can_start()        # before loading a game it couldn't use
        WATCH.start(eid, watch.load_game(eid), speed=speed, from_seq=from_seq)
    return state_call(start)


@app.post("/api/watch/pause")
def watch_pause():
    return watch_action(WATCH.pause)


@app.post("/api/watch/resume")
def watch_resume():
    return watch_action(WATCH.resume)


@app.post("/api/watch/step")
def watch_step():
    return watch_action(WATCH.step)


@app.post("/api/watch/speed")
def watch_speed():
    return state_call(lambda: WATCH.set_speed(watch.parse_speed(watch_body())))


@app.post("/api/watch/stop")
def watch_stop():
    return state_call(lambda: WATCH.stop(restore=watch.parse_stop(watch_body())))


@app.get("/api/export.csv")
def export():
    with LOCK:
        csv = engine.export_csv()
    return Response(csv, mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=shadow_caller_log.csv"})


if __name__ == "__main__":
    url = f"http://localhost:{PORT}"
    print(f"\n  Shadow Play-Caller running at {url}\n")
    if not os.environ.get("SHADOW_NO_BROWSER"):
        Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)

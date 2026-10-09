"""Localhost server for the Shadow Play-Caller.  Run:  python app.py  then open http://localhost:5050"""
import json
import logging
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
from config import DATA_DIR, ESPN_OFFLINE, GAME, PORT, ROOT, WATCH_SCALE
from live import GameEngine, UndoRefused, parse_clock

app = Flask(__name__, static_folder=str(ROOT / "static"))
LOCK = threading.RLock()
log = logging.getLogger("app")
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
# Only this machine's own page drives the app. A Host other than its own names is a DNS name rebound to 127.0.0.1
# (Flask answers 400), and the biggest real body is a shorthand line, far under 64 KB (413 above it).
app.config.update(TRUSTED_HOSTS=["127.0.0.1", "localhost"], MAX_CONTENT_LENGTH=64 * 1024)


def _load_engine():
    try:
        return GameEngine()
    except Exception as e:
        print(f"Models missing or built elsewhere ({e}). Building now, about 30 seconds...")
        import build
        build.main()
        return GameEngine()


engine = _load_engine()

from espn_feed import Feed  # noqa: E402  (needs the engine)

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
    v["error"] = str(e)
    return jsonify(v), status


def locked(fn):
    with LOCK:
        fn()


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


@app.post("/api/situation")
def situation():
    d = {k: (v.strip() if isinstance(v, str) else v) for k, v in request.get_json(force=True).items()}
    d = {k: v for k, v in d.items() if v not in (None, "")}

    def num(key):
        if key not in d:
            return None
        try:
            return int(float(d[key]))
        except ValueError:
            raise ValueError(f"'{d[key]}' isn't a number")

    try:
        yl = None
        if d.get("side") and d.get("yard") is not None:
            yd = int(d["yard"])
            yl = 100 - yd if d["side"] == "own" else yd
        togo = d.get("togo")
        if togo is not None and str(togo).upper() not in ("G", "GOAL"):
            togo = num("togo")
        locked(lambda: engine.set_situation(
            down=num("down"), togo=togo, yardline_100=yl, qtr=num("qtr"),
            clock=parse_clock(d["clock"]) if "clock" in d else None,
            score_off=num("score_off"), score_opp=num("score_opp"), spot=d.get("spot")))
        return ok()
    except Exception as e:
        return fail(e)


@app.post("/api/play")
def play():
    d = request.get_json(force=True)
    try:
        locked(lambda: engine.record_play(d.get("call"), d.get("yards", 0), td=bool(d.get("td")),
                                          turnover=bool(d.get("turnover")), penalty=bool(d.get("penalty")),
                                          leaf=d.get("leaf"), family=d.get("family"), outcome=d.get("outcome")))
        return ok()
    except Exception as e:
        return fail(e)


@app.post("/api/penalty")
def penalty():
    d = request.get_json(force=True)
    try:
        locked(lambda: engine.apply_penalty(d["code"], yards=d.get("yards"), auto_first=d.get("auto_first"),
                                            play=d.get("play")))
        return ok()
    except Exception as e:
        return fail(e)


@app.post("/api/retag")
def retag():
    try:
        locked(lambda: engine.retag_last(request.get_json(force=True)["key"]))
        return ok()
    except Exception as e:
        return fail(e)


@app.post("/api/drive")
def drive():
    d = request.get_json(force=True)
    try:
        if d.get("end"):
            locked(lambda: engine.end_drive(d["end"]))
        else:
            yd = int(d["yard"])
            yl = 100 - yd if d.get("side", "own") == "own" else yd
            locked(lambda: engine.new_drive(yl, qtr=d.get("qtr"),
                                            clock=parse_clock(d["clock"]) if d.get("clock") else None,
                                            score_off=d.get("score_off"), score_opp=d.get("score_opp")))
        return ok()
    except Exception as e:
        return fail(e)


@app.post("/api/score")
def score():
    d = request.get_json(force=True)
    try:
        locked(lambda: engine.add_score(d["team"], d["pts"]))
        return ok()
    except Exception as e:
        return fail(e)


@app.post("/api/command")
def command():
    try:
        locked(lambda: engine.command(request.get_json(force=True)["text"]))
        return ok()
    except Exception as e:
        return fail(e)


@app.post("/api/undo")
def undo():
    """One step back. Never past a play ESPN applied (the feed, a replay or a watch): its id stays applied, so the
    feed would never log it again. That undo is refused with 409 and the reason; nothing changes."""
    def do():
        rows = len(engine.state.get("log") or [])
        manual = timeline_source() == "log" and bool(engine.history)
        engine.undo()
        if manual or len(engine.state.get("log") or []) != rows:
            engine.bump_epoch()        # rows the client drew changed under it (a typed row and its pred)
    try:
        locked(do)
        return ok()
    except UndoRefused as e:
        return fail(e, 409)


@app.post("/api/reset")
def reset():
    def do():
        WATCH.require_idle("resetting the game")
        watch.backup_game()            # first, like a replay: a reset (or a stray one) never loses the game
        feed.stop()
        feed.invalidate()              # a live poll in flight can't land in the fresh game (data contract E2.4)
        engine.reset()
        feed.forget()
    try:
        locked(do)
        return ok()
    except watch.WatchError as e:
        return fail(e, e.status)
    except OSError as e:
        log.exception("Reset refused: the game couldn't be backed up")
        return fail(f"Couldn't keep a copy of the game, so nothing was reset ({e}).", 500)


@app.post("/api/feed")
def feed_control():
    d = request.get_json(force=True)
    try:
        eid = None
        if d.get("on"):
            WATCH.require_idle("turning the live feed on")         # before any network call
            eid = feed.resolve_event(d.get("event_id") or None)    # today's game can take a 10 s call: not under LOCK
        with LOCK:                     # atomic with /api/watch/start: the live feed never comes on during a watch
            if d.get("on"):
                WATCH.require_idle("turning the live feed on")
                feed.start(eid)
            else:
                feed.stop()
            engine.state["message"] = ("ESPN live feed on. Plays log themselves; retag play-action, screen or RPO."
                                       if feed.on else "ESPN live feed off. Enter plays by hand.")
        return ok()
    except watch.WatchError as e:
        return fail(e, e.status)
    except Exception as e:
        return fail(e)


@app.post("/api/feed/replay")
def feed_replay():
    """Rebuild a whole game from ESPN: backs up the game file and the applied ids, clears them, applies every play.
    The live feed stops first, so a poll already in flight can't land in the rebuilt game (data contract E6)."""
    d = request.get_json(force=True)
    try:
        from espn_feed import fetch_summary
        eid = str(d.get("event_id") or feed.event_id or "")
        if not eid:
            raise ValueError("Enter the ESPN event id to replay.")
        WATCH.require_idle("replaying a game")
        summary = fetch_summary(eid)
        with LOCK:
            WATCH.require_idle("replaying a game")
            watch.backup_game()
            was_on = feed.on
            feed.stop()
            feed.invalidate()
            engine.reset()
            feed.forget()
            feed.event_id = eid
            n = feed.poll_once(summary)
            engine.state["message"] = replay_message(eid, n, len(feed.skipped_ids), was_on)
            engine._save()
        return ok()
    except watch.WatchError as e:
        return fail(e, e.status)
    except Exception as e:
        return fail(e)


def replay_message(eid, n, skipped, was_on):
    return (f"Replayed ESPN game {eid}: {n} {engine.profile['team']} plays logged."
            + (f" {skipped} plays couldn't be applied (the server log says why); type any of his by hand." if skipped
               else "")
            + (" The live feed is off." if was_on else "") + " Old game backed up in data/.")


# ---------------------------------------------------------------- Watch this game (data contract E1)
CLIENT_ERRORS = (ValueError, FileNotFoundError, urllib.error.URLError, TimeoutError)


def watch_call(action):
    """Run a watch action and answer like every other POST: the state body, or it plus the error (400 or 409). An
    error nobody planned for is a 500 with its traceback in the server log, not a 400 that hides it."""
    try:
        action()
        return ok()
    except watch.WatchError as e:
        return fail(e, e.status)
    except HTTPException:              # Flask's own answers (a body over the size limit): let Flask send them
        raise
    except CLIENT_ERRORS as e:         # a bad id, no saved game or one that can't be read, ESPN unreachable
        return fail(e)
    except Exception:
        log.exception("Watch request failed")
        return fail("Something went wrong on the server; the server log has the details.", 500)


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
    return watch_call(run)


@app.get("/api/watch")
def watch_state():
    return jsonify(WATCH.snapshot())


@app.post("/api/watch/start")
def watch_start():
    def start():
        eid, speed, from_seq = watch.parse_start(watch_body(), feed.event_id or GAME.get("espn_event"))
        WATCH.check_can_start()        # before loading a game it couldn't use
        WATCH.start(eid, watch.load_game(eid), speed=speed, from_seq=from_seq)
    return watch_call(start)


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
    return watch_call(lambda: WATCH.set_speed(watch.parse_speed(watch_body())))


@app.post("/api/watch/stop")
def watch_stop():
    return watch_call(lambda: WATCH.stop(restore=watch.parse_stop(watch_body())))


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

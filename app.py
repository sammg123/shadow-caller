"""Localhost server for the Shadow Play-Caller.  Run:  python app.py  then open http://localhost:5050"""
import json
import os
import shutil
import threading
import webbrowser
from datetime import datetime
from threading import Timer

from flask import Flask, Response, jsonify, request, send_from_directory

from config import DATA_DIR, PORT, ROOT, STATE_PATH
from live import GameEngine, parse_clock

app = Flask(__name__, static_folder=str(ROOT / "static"))
LOCK = threading.RLock()


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


def view():
    v = engine.view()
    v["feed"] = {**feed.status, "on": feed.on, "event_id": feed.event_id}
    return v


def ok():
    with LOCK:
        return jsonify(view())


def fail(e):
    with LOCK:
        v = view()
    v["error"] = str(e)
    return jsonify(v), 400


def locked(fn):
    with LOCK:
        fn()


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/state")
def state():
    return ok()


@app.get("/api/version")
def version():
    return jsonify({"version": engine.state.get("version", 0), "feed": {**feed.status, "on": feed.on}})


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
    locked(engine.undo)
    return ok()


@app.post("/api/reset")
def reset():
    def do():
        engine.reset()
        feed.forget()
    locked(do)
    return ok()


@app.post("/api/feed")
def feed_control():
    d = request.get_json(force=True)
    try:
        if d.get("on"):
            feed.start(d.get("event_id") or None)
        else:
            feed.stop()
        with LOCK:
            engine.state["message"] = ("ESPN live feed on. Plays log themselves; retag play-action, screen or RPO."
                                       if feed.on else "ESPN live feed off. Enter plays by hand.")
        return ok()
    except Exception as e:
        return fail(e)


@app.post("/api/feed/replay")
def feed_replay():
    """Rebuild a whole game from ESPN: backs up the current game file, clears it, applies every play."""
    d = request.get_json(force=True)
    try:
        from espn_feed import fetch_summary
        eid = str(d.get("event_id") or feed.event_id or "")
        if not eid:
            raise ValueError("Enter the ESPN event id to replay.")
        summary = fetch_summary(eid)
        with LOCK:
            if STATE_PATH.exists():
                shutil.copy(STATE_PATH, DATA_DIR / f"live_state.backup-{datetime.now():%Y%m%d-%H%M%S}.json")
            engine.reset()
            feed.forget()
            feed.event_id = eid
            n = feed.poll_once(summary)
            engine.state["message"] = f"Replayed ESPN game {eid}: {n} {engine.profile['team']} plays logged. Old game backed up in data/."
            engine._save()
        return ok()
    except Exception as e:
        return fail(e)


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

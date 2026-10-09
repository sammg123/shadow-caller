"""Watch mode (docs/design/data-contract.md section E): replay a saved or finished ESPN game into the engine one play
per tick, paced for a demo, through the same Feed.apply_one path as the live feed.

Threading (E2). LOCK is app.LOCK, the RLock every engine mutation takes; cv guards this object's own fields.
  1. Lock order is always LOCK, then cv. The thread waits on cv without LOCK and holds LOCK only while it applies
     one play. pause, resume and set_speed take cv alone; start, step and stop take LOCK first.
  2. Every session has a token. Before it applies anything the thread re-reads token, state and idx under LOCK, so
     a stop, a step or a new session in between can never make it apply a play twice or into the wrong game.
  3. start backs up the game file and the applied ids, then resets, in one LOCK block; stop(restore=True) puts both
     back. Until Stop, a session (playing, paused, done or error) owns the screen: reset, replay and the live feed
     wait for Stop, and watching again from done or error keeps the first restore point.
  4. The thread is a daemon, so a server restart ends it, but the restore point is also in SESSION_FILE: the
     session comes back as 'error' and Stop can still put the game back (data contract E2.7 said idle; that
     stranded the real game in a backup nothing pointed at).
Pacing (E3): seconds before each row at 1x, divided by the speed, times SHADOW_WATCH_SCALE (config.WATCH_SCALE).
"""
import json
import logging
import math
import os
import re
import shutil
import threading
import time
from datetime import datetime

import espn_feed
import live
import timeline
from config import GAME
from timeline_text import split_body

log = logging.getLogger(__name__)

ACTIVE = ("playing", "paused")                       # the thread is applying plays, or will on resume
SESSION = ("playing", "paused", "done", "error")     # a watched game is on screen and can still be put back
# E3, seconds before a row at 1x. TB at DAL: 60 caller snaps, 78 opponent snaps, 18 kicks, 23 + 4 admin = 857 s.
PACE = {"caller_snap": 7.0, "snap": 4.0, "kick": 5.0, "admin": 1.0, "admin_end": 3.0}
SNAP_KINDS = ("play", "penalty", "kneel", "spike", "other")
END_ADMIN = ("end_period", "end_half", "end_game")
SPEED_MIN, SPEED_MAX, DEFAULT_SPEED = 0.5, 10.0, 4.0
EVENT_ID_RE = re.compile(r"[0-9]{6,12}")             # ASCII digits: the id ends up in file names and URLs
START_KEYS, SPEED_KEYS, STOP_KEYS = ("event_id", "speed", "from_seq"), ("speed",), ("restore",)
MAX_SAME_SECOND = 99                                 # backups made in one second are named -2 to -99
MAX_SKIPS_IN_A_ROW = 3                               # plays the feed couldn't apply, in a row, before a watch gives up
SESSION_FILE = "watch_session.json"                  # next to live_state.json while there is a game to put back
BACKUP_NAMES = {"state": re.compile(r"live_state\.backup-[0-9-]{1,40}\.json"),    # what SESSION_FILE may name
                "seen": re.compile(r"feed_seen\.json\.backup-[0-9-]{1,40}")}
RESTARTED = "The app restarted during a watch, so the watched game is still loaded. Stop puts your game back."


class WatchError(Exception):
    """A watch request that isn't valid (status 400) or that the session's state doesn't allow (409)."""

    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------- E3: pacing
def pace_of(team, p, caller):
    """(kind, seconds before this row at 1x) for one ESPN play."""
    info = espn_feed.classify(team, p)
    typ = (p.get("type") or {}).get("text") or ""
    kind = timeline.kind_of(info, typ, split_body(p.get("text"))[1])
    if kind in SNAP_KINDS:
        return kind, PACE["caller_snap"] if team == caller else PACE["snap"]
    if kind in timeline.KICKS:
        return kind, PACE["kick"]
    what = next((w for key, w in timeline.ADMIN_WHAT if key in typ.lower()), "other")
    return kind, PACE["admin_end"] if what in END_ADMIN else PACE["admin"]


def pace_plan(plays, caller):
    """[(kind, seconds at 1x)] for (team, play) pairs, in apply order."""
    return [pace_of(team, p, caller) for team, p in plays]


# ---------------------------------------------------------------- E1: request bodies (validated at the HTTP boundary)
def body_of(raw, allowed=()):
    """A JSON request body as a dict holding only `allowed` keys. No body counts as {}."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise WatchError("Send a JSON object.", 400)
    extra = sorted(str(k) for k in raw if k not in allowed)
    if extra:
        raise WatchError(f"Unknown field '{extra[0][:20]}'. This takes {', '.join(allowed) or 'no fields'}.", 400)
    return raw


def event_arg(value, default=None):
    """The ESPN event id: 6 to 12 digits, as a string or a JSON number. Missing or '' means `default`."""
    if value is None or value == "":
        value = default
    if isinstance(value, int) and not isinstance(value, bool):
        value = str(value)
    if value is None or value == "":
        raise WatchError("Enter the ESPN event id to watch.", 400)
    if not isinstance(value, str) or not EVENT_ID_RE.fullmatch(value):
        raise WatchError(f"ESPN event ids are 6 to 12 digits, like 401872980 (got '{str(value)[:20]}').", 400)
    return value


def speed_arg(value):
    """A playback speed from 0.5 to 10 (NaN and infinity fail the range test)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not SPEED_MIN <= value <= SPEED_MAX:
        raise WatchError(f"Speed must be a number from {SPEED_MIN:g} to {SPEED_MAX:g}.", 400)
    return float(value)


def from_seq_arg(value):
    """Plays to apply at once before the pacing starts: a whole number from 0 (the top is checked in start())."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise WatchError("from_seq must be a whole number of plays, 0 or more.", 400)
    return value


def parse_start(raw, default_event):
    """(event_id, speed, from_seq) from a POST /api/watch/start body."""
    d = body_of(raw, START_KEYS)
    return (event_arg(d.get("event_id"), default_event), speed_arg(d.get("speed", DEFAULT_SPEED)),
            from_seq_arg(d.get("from_seq", 0)))


def parse_speed(raw):
    d = body_of(raw, SPEED_KEYS)
    if "speed" not in d:
        raise WatchError(f"Send the speed, from {SPEED_MIN:g} to {SPEED_MAX:g}.", 400)
    return speed_arg(d["speed"])


def parse_stop(raw):
    """restore, default false."""
    restore = body_of(raw, STOP_KEYS).get("restore", False)
    if not isinstance(restore, bool):
        raise WatchError("restore must be true or false.", 400)
    return restore


def parse_empty(raw):
    """pause, resume and step take no fields."""
    body_of(raw)


# ---------------------------------------------------------------- files
def load_game(event_id):
    """The summary to watch: the saved finished game (espn/summary_<event>_final.json) when there is one, so a demo
    needs no network, else ESPN. Offline without a saved game: FileNotFoundError, the app's 'no saved game' text."""
    eid = espn_feed.check_event(event_id)
    saved = espn_feed.RAW_DIR / f"summary_{eid}_final.json"
    summary = json.loads(saved.read_text()) if saved.exists() else espn_feed.fetch_summary(eid)
    if not isinstance(summary, dict):
        raise WatchError(f"ESPN game {eid} isn't a game summary.", 400)
    return summary


def backup_game(stamp=None):
    """Copy live_state.json and feed_seen.json aside before a watch or a replay resets the game (E2.5, E6).
    {"state": path or None, "seen": path or None}: None when there was no such file. A backup is never overwritten;
    another one in the same second gets -2, -3 and so on. Paths are read at call time (tests sandbox them)."""
    stamp = stamp or datetime.now().strftime("%Y%m%d-%H%M%S")
    return {"state": _copy_aside(live.STATE_PATH, f"live_state.backup-{stamp}", ".json"),
            "seen": _copy_aside(espn_feed.SEEN_PATH, f"feed_seen.json.backup-{stamp}", "")}


def _copy_aside(src, stem, suffix):
    try:
        data = src.read_bytes()
    except FileNotFoundError:
        return None
    for n in range(1, MAX_SAME_SECOND + 1):
        dest = src.with_name(f"{stem}{'' if n == 1 else f'-{n}'}{suffix}")
        try:
            with open(dest, "xb") as f:                  # x: fail rather than overwrite an older backup
                f.write(data)
            return dest
        except FileExistsError:
            continue
        except OSError:
            dest.unlink(missing_ok=True)                 # never leave half a backup behind
            raise
    raise WatchError(f"Too many backups named {stem}; move some out of {src.parent}.")


def _put_files_back(pairs):
    """Copy each (backup, target): every copy goes to a temp file first, then os.replace, so a failed copy changes
    nothing and nobody reads half a file."""
    staged = []
    try:
        for backup, target in pairs:
            tmp = target.with_name(f".{target.name}.restoring")
            shutil.copyfile(backup, tmp)
            staged.append((tmp, target))
        for tmp, target in staged:
            os.replace(tmp, target)
    finally:
        for tmp, _ in staged:
            tmp.unlink(missing_ok=True)


def _resync_archive(engine):
    """The DuckDB live_log holds the restored game's rows again (the watch's reset deleted them)."""
    engine._db_delete_after(0)
    for row in engine.state.get("log") or []:
        engine._db_insert(row)


def check_backups(files):
    """Both backups must be there and readable before anything is put back: a damaged one used to come back as an
    empty game and report success. WatchError (409) names the file; nothing has changed yet."""
    for key, path in files.items():
        if path is None:
            continue
        try:
            d = json.loads(path.read_text())
        except FileNotFoundError:
            raise WatchError(f"The backup {path.name} is missing.") from None
        except (OSError, ValueError) as ex:
            raise WatchError(f"The backup {path.name} can't be read ({ex}). It is still in the data folder.") from None
        game = d.get("game") if isinstance(d, dict) else None
        if not isinstance(d, dict) or (key == "state" and (game or {}).get("game_id") != GAME["game_id"]):
            raise WatchError(f"The backup {path.name} isn't a saved {GAME['game_id']} game.")


# ---------------------------------------------------------------- the session file (survives a restart)
def session_path():
    """Read at call time, like the backups: tests sandbox live.STATE_PATH."""
    return live.STATE_PATH.with_name(SESSION_FILE)


def save_session(restore, watching, started_at):
    """What stop(restore=True) needs after a restart, written whole (temp file, then os.replace)."""
    path = session_path()
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps({"game_id": GAME["game_id"], "watching": watching, "started_at": started_at,
                               "event_id": restore["event_id"], "feed_was_on": restore["feed_was_on"],
                               "backup": {k: (p.name if p else None) for k, p in restore["files"].items()}}))
    os.replace(tmp, path)


def drop_session():
    try:
        session_path().unlink(missing_ok=True)
    except OSError as ex:                          # a stale file would offer an old game back after a restart
        log.error("Couldn't remove %s (%s): delete it by hand before restarting the app.", SESSION_FILE, ex)


def load_session():
    """(restore, saved fields) of a session a restart cut short, or None. A file that can't be read, belongs to
    another game or names anything but this app's backups is left alone."""
    path = session_path()
    try:
        saved = json.loads(path.read_text())
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as ex:
        log.warning("Couldn't read %s (%s): a watch cut short by a restart can't be undone from the app.", path.name, ex)
        return None
    if not isinstance(saved, dict) or saved.get("game_id") != GAME["game_id"]:
        return None
    names = saved.get("backup") if isinstance(saved.get("backup"), dict) else {}
    homes = {"state": live.STATE_PATH, "seen": espn_feed.SEEN_PATH}
    files = {}
    for key, pattern in BACKUP_NAMES.items():
        name = names.get(key)
        if name is not None and not (isinstance(name, str) and pattern.fullmatch(name)):
            log.warning("%s names %r as a backup; ignoring the file.", path.name, str(name)[:60])
            return None
        files[key] = homes[key].with_name(name) if name else None
    event_id = saved.get("event_id")
    restore = {"files": files, "feed_was_on": saved.get("feed_was_on") is True, "summary": None, "status": None,
               "event_id": event_id if isinstance(event_id, str) and espn_feed.EVENT_RE.fullmatch(event_id) else None}
    return restore, saved


# ---------------------------------------------------------------- E2: the session
class Watch:
    """Replays a saved or finished ESPN game into the engine, one play per tick."""

    def __init__(self, feed, lock, pace_scale=1.0):
        if not (isinstance(pace_scale, (int, float)) and 0 < pace_scale < math.inf):
            raise ValueError(f"pace_scale must be a positive number, got {pace_scale!r}")
        self.feed, self.lock, self.engine, self.scale = feed, lock, feed.engine, float(pace_scale)
        self.cv = threading.Condition()           # guards the fields below; never held while touching the engine
        self.state, self.queue, self.plan, self.idx, self.token = "idle", [], [], 0, 0
        self.event_id, self.speed, self.ff_until, self.started_at = None, None, 0, None
        self.feed_was_on, self.backup, self.error = False, None, None
        self._due = self._due_idx = self._left = None   # monotonic deadline of play _due_idx; seconds left if paused
        self.skipped = self._in_a_row = 0         # plays the feed couldn't apply this session; how many just now
        self._restore = None                      # what stop(restore=True) puts back
        self._thread = None
        self._reload_session()

    def _reload_session(self):
        """A session the last server run didn't end: the files hold the watched game. It comes back as 'error' with
        its restore point, so Stop can still put the real game back."""
        found = load_session()
        if not found:
            return
        restore, saved = found
        watching, started = saved.get("watching"), saved.get("started_at")
        self.state, self.error, self._restore = "error", RESTARTED, restore
        self.event_id = watching if isinstance(watching, str) and EVENT_ID_RE.fullmatch(watching) else None
        self.started_at = started if isinstance(started, str) and len(started) <= 32 else None
        self.feed_was_on = restore["feed_was_on"]
        self.backup = {k: (p.name if p else None) for k, p in restore["files"].items()}

    # ------------------------------------------------ reading (cv only, never LOCK: /api/version stays lock-free)
    def active(self):
        with self.cv:
            return self.state in ACTIVE

    def require_idle(self, doing):
        """WatchError(409) while a session owns the screen. Playing or paused, `doing` would race the watch thread;
        done or error, it would replace the watched game, and a later Stop would put an old game back over it."""
        with self.cv:
            if self.state in SESSION:
                raise WatchError(f"Stop the watch before {doing}. Stop puts your own game back.")

    def check_can_start(self):
        """WatchError(409) while a watch is playing or paused. Returns the restore point a new session keeps: the
        one behind the watched game on screen (done or error), else None and the new session backs up."""
        with self.cv:
            if self.state in ACTIVE:
                raise WatchError(f"A watch is already {self.state}. Stop it before starting another.")
            return self._restore if self.state in ("done", "error") else None

    def snapshot(self):
        """The watch object of /api/state and GET /api/watch (E1)."""
        with self.cv:
            return {**self._brief(), "next_kind": self._next_kind(), "ff_until": self.ff_until,
                    "started_at": self.started_at, "feed_was_on": self.feed_was_on,
                    "backup": dict(self.backup) if self.backup else None}

    def brief(self):
        """The small watch object of /api/version (E4), polled every 250 ms while playing."""
        with self.cv:
            return self._brief()

    def join(self, timeout=None):
        """Wait for the session's thread to end. True once no watch thread is running."""
        t = self._thread
        if t is not None:
            t.join(timeout)
        return t is None or not t.is_alive()

    def _brief(self):
        return {"state": self.state, "event_id": self.event_id, "speed": self.speed, "idx": self.idx,
                "total": len(self.queue), "next_at": self._next_at(), "skipped": self.skipped, "error": self.error}

    def _next_at(self):
        """Server epoch milliseconds when the next play lands; None unless playing."""
        if self.state != "playing" or self.idx >= len(self.queue):
            return None
        left = self._remaining()
        return int((time.time() + (self._delay(self.idx) if left is None else left)) * 1000)

    def _next_kind(self):
        return self.plan[self.idx][0] if self.state in ACTIVE and self.idx < len(self.plan) else None

    def _remaining(self):
        """Seconds until play idx is due, once the thread has started its wait; else None."""
        if self._due is None or self._due_idx != self.idx:
            return None
        return max(0.0, self._due - time.monotonic())

    def _delay(self, i):
        """Seconds to wait before play i: none while fast-forwarding to from_seq, else its pace (E3)."""
        if i < self.ff_until:
            return 0.0
        return self.plan[i][1] * self.scale / self.speed

    def _nothing_to(self, verb):
        said = {"idle": "there's no watch", "done": "the watch has finished", "stopped": "the watch was stopped",
                "error": "the watch stopped with an error"}.get(self.state, f"the watch is {self.state}")
        return f"Nothing to {verb}: {said}."

    # ------------------------------------------------ start (LOCK, then cv)
    def start(self, event_id, summary, speed=DEFAULT_SPEED, from_seq=0):
        """Back up the game, reset, and play `summary` from its first play (E2.4, E2.5). Arguments come checked by
        the parse_* helpers. WatchError: 409 while a watch is playing or paused, 400 for a game it can't play.
        From done or error the screen holds a watched game: it isn't backed up, and Stop keeps meaning the game
        from before the first watch."""
        queue = espn_feed.iter_plays(summary)
        self._check_game(event_id, summary, queue, from_seq)
        plan = pace_plan(queue, GAME["offense"])
        with self.lock:
            carried = self.check_can_start()
            started_at = datetime.now().isoformat(timespec="seconds")
            restore = self._backup_and_reset(event_id, summary, speed, carried, started_at)
            with self.cv:
                self.token += 1
                self.state, self.error, self.event_id, self.speed = "playing", None, event_id, float(speed)
                self.queue, self.plan, self.idx, self.ff_until = queue, plan, 0, from_seq
                self._due = self._due_idx = self._left = None
                self.skipped = self._in_a_row = 0
                self.started_at = started_at
                self.feed_was_on, self._restore = restore["feed_was_on"], restore
                self.backup = {k: (p.name if p else None) for k, p in restore["files"].items()}
                token = self.token
                self.cv.notify_all()              # an older session's thread, if still waiting, sees it is over
            self._thread = threading.Thread(target=self._run, args=(token,), name=f"watch-{token}", daemon=True)
            self._thread.start()

    @staticmethod
    def _check_game(event_id, summary, queue, from_seq):
        caller = GAME["offense"]
        if not queue:
            raise WatchError(f"ESPN game {event_id} has no plays yet.", 400)
        if espn_feed.team_id(summary, caller) is None:
            raise WatchError(f"ESPN game {event_id} isn't a {caller} game, so there are no calls to predict.", 400)
        if from_seq > len(queue):
            raise WatchError(f"from_seq {from_seq} is past the end: this game has {len(queue)} plays.", 400)

    def _backup_and_reset(self, event_id, summary, speed, carried, started_at):
        """Under LOCK: back up (or keep the restore point `carried` from the session on screen) and note it in the
        session file, then stop the live feed, reset the engine and the feed and load this game. Returns what
        stop(restore=True) needs to put the old game back."""
        feed, engine = self.feed, self.engine
        version = engine.state.get("version", 0)
        restore = carried or {"files": backup_game(),           # first: if it fails, nothing has changed yet
                              "feed_was_on": feed.on, "event_id": feed.event_id, "summary": feed.load_summary(),
                              "status": dict(feed.status)}
        save_session(restore, event_id, started_at)            # before the reset: a restart finds the way back
        feed.stop()
        feed.invalidate()                         # a live poll already in flight now applies nothing
        engine.reset()
        engine.history = []                       # U can't step back into half of the old game
        feed.forget()
        feed.event_id = event_id
        feed.summary = summary                    # the setter also learns the caller's ESPN team id
        feed.status.update(last_play=None, plays_logged=0, skipped=None)
        engine.bump_epoch()
        engine.state["version"] = max(engine.state.get("version", 0), version)   # versions only go up
        engine.set_message(f"Watching ESPN game {event_id} at {speed:g}x. Your game is backed up; Stop puts it back.")
        return restore

    # ------------------------------------------------ the thread
    def _run(self, token):
        try:
            while self._tick(token):
                pass
        except Exception as ex:                   # never leave a session 'playing' with no thread behind it
            log.exception("Watch stopped by an error")
            with self.cv:
                if self.token == token:
                    self.state, self.error = "error", f"{type(ex).__name__}: {ex}"
                    self._due = self._left = None
                    self.cv.notify_all()

    def _tick(self, token):
        """Wait for the next play's turn, then apply it. False once this session's thread has nothing left to do."""
        with self.cv:
            while self.token == token and self.state == "paused":
                self.cv.wait()
            if self.token != token or self.state != "playing":
                return False
            i = self.idx
            if i >= len(self.queue):
                self._finish()
                return False
            left = self._wait_left(i)
            if left > 0:
                self.cv.wait(timeout=left)        # pause, stop, step and a speed change wake it early: look again
                return True
        with self.lock:                           # LOCK for one play, never during a wait
            with self.cv:
                if self.token != token or self.state != "playing" or self.idx != i:
                    return True
            self._apply(i)
        return True

    def _wait_left(self, i):
        """Seconds until play i is due; its wait starts the first time this is asked."""
        now = time.monotonic()
        if self._due is None or self._due_idx != i:
            self._due, self._due_idx = now + self._delay(i), i
        return self._due - now

    def _apply(self, i):
        """Apply play i and count it. The caller holds LOCK, not cv. A play the feed skips is counted; a run of
        MAX_SKIPS_IN_A_ROW (a full disk fails every play) ends the session in error rather than a hollow 'done'."""
        team, p = self.queue[i]
        before = len(self.feed.skipped_ids)
        self.feed.apply_one(team, p)              # never raises; records the id in apply order and saves the file
        failed = len(self.feed.skipped_ids) > before
        with self.cv:
            self.idx = i + 1
            self._due = self._left = None
            self.skipped += int(failed)
            self._in_a_row = self._in_a_row + 1 if failed else 0
            if self._in_a_row >= MAX_SKIPS_IN_A_ROW:
                self.state = "error"
                self.error = (f"{self._in_a_row} plays in a row couldn't be applied, so the watch stopped (last: "
                              f"{self.feed.status.get('skipped')}). Your game is backed up; Stop puts it back.")
            elif self.idx >= len(self.queue):
                self._finish()
            self.cv.notify_all()

    def _finish(self):
        self.state = "done"
        self._due = self._left = None
        self.cv.notify_all()

    # ------------------------------------------------ pause, resume, speed (cv only)
    def pause(self):
        """playing to paused, keeping the time left on the current wait. Idempotent; 409 with no session."""
        with self.cv:
            if self.state == "playing":
                self._left, self._due = self._remaining(), None
                self.state = "paused"
                self.cv.notify_all()
            elif self.state != "paused":
                raise WatchError(self._nothing_to("pause"))

    def resume(self):
        """paused to playing; the wait goes on from where it paused. Idempotent; 409 with no session."""
        with self.cv:
            if self.state == "paused":
                if self._left is not None and self._due_idx == self.idx:
                    self._due = time.monotonic() + self._left
                self._left = None
                self.state = "playing"
                self.cv.notify_all()
            elif self.state != "playing":
                raise WatchError(self._nothing_to("resume"))

    def set_speed(self, speed):
        """A new speed, now: the time left on the current wait is rescaled (E1). Kept as the choice while idle."""
        with self.cv:
            old, self.speed = self.speed, float(speed)
            if old:
                if self._due is not None:
                    now = time.monotonic()
                    self._due = now + max(0.0, self._due - now) * old / self.speed
                if self._left is not None:
                    self._left *= old / self.speed
            self.cv.notify_all()

    # ------------------------------------------------ step, stop (LOCK, then cv)
    def step(self):
        """Apply exactly one play now. Only while paused: 409 otherwise."""
        with self.lock:
            with self.cv:
                if self.state != "paused":
                    raise WatchError("Pause the watch before stepping one play." if self.state == "playing"
                                     else self._nothing_to("step"))
                i = self.idx
            self._apply(i)

    def stop(self, restore=False):
        """End the session. restore=True puts the pre-watch game back (E2.6). 409 when there is no session. If
        putting it back fails, the session is left in 'error' so it can be tried again."""
        with self.lock:
            with self.cv:
                if self.state not in SESSION:
                    raise WatchError(self._nothing_to("stop"))
                self.token += 1                   # the thread sees it under LOCK and applies nothing more
                self.state, self.error = "stopped", None
                self._due = self._left = None
                self.cv.notify_all()
            if not restore:
                kept = (self.backup or {}).get("state")
                self._end_session()
                self.engine.set_message("Stopped watching. The watched game stays loaded" +
                                        (f"; your game is backed up as {kept}." if kept else "."))
                return
            try:
                self._put_back()
            except Exception as ex:
                with self.cv:
                    self.state, self.error = "error", f"Couldn't put your game back: {ex}"
                raise
            self._end_session()

    def _end_session(self):
        """Nothing left to put back: drop the restore point (and the old summary it holds) and the session file."""
        self._restore = None
        drop_session()

    def _put_back(self):
        """Under LOCK: the live feed stops and a poll in flight is dropped, both backups are checked, then go back
        atomically; the engine, the applied ids, the event and its summary are reloaded from them, the epoch changes
        and the live feed restarts if it was on. No backup (a fresh install) means a fresh game; a damaged one is a
        WatchError, never a fresh game."""
        r, feed, engine = self._restore, self.feed, self.engine
        feed.stop()
        feed.invalidate()
        files = r["files"]
        check_backups(files)
        version = engine.state.get("version", 0)
        _put_files_back([(files[k], path) for k, path in (("state", live.STATE_PATH), ("seen", espn_feed.SEEN_PATH))
                         if files[k] is not None])
        state = engine._load() if files["state"] else engine._fresh()
        if state is None:
            raise WatchError(f"The backup {files['state'].name} couldn't be loaded.")
        engine.state, engine.history = state, []
        if files["seen"]:
            feed.reload_seen()
        else:
            feed.forget()                         # no applied ids before the watch
        feed.event_id = r["event_id"]
        feed.summary = r["summary"]               # after reload_seen: the setter fixes a legacy id order
        feed.status.update(r["status"] or {})
        engine.bump_epoch()
        engine.state["version"] = max(engine.state.get("version", 0), version)
        engine.set_message("Stopped watching. Your game is back.")
        _resync_archive(engine)
        if r["feed_was_on"]:
            feed.start(r["event_id"])

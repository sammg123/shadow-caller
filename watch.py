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
  5. Playback (restructure-v2 sections 5 and 9): seek rebuilds the game from kickoff and applies its first n plays at
     once under one LOCK block (the live feed stopped and its poll in flight dropped first), then the session holds
     there with its thread waiting. A session's first rebuild backs the game up like start; later ones keep its
     restore point. back and forward move by plays the field draws; Go Live ends the session keeping the game.
Pacing (E3) is playback.pace_plan and playback.delay_s, times SHADOW_WATCH_SCALE (config.WATCH_SCALE). The watch
object names the pace of the row it waits on (next_kind), so the page can leave that time to the call.
"""
import json
import logging
import math
import os
import re
import shutil
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import espn_feed
import live
import playback
from config import GAME
from playback import delay_s, pace_plan
from watch_args import (DEFAULT_SPEED, EVENT_ID_RE, SEEK_KEYS, SPEED_KEYS, SPEED_MAX, SPEED_MIN,  # noqa: F401
                        START_KEYS, STOP_KEYS, WatchError, body_of, event_arg, from_seq_arg, parse_empty, parse_seek,
                        parse_speed, parse_start, parse_stop, speed_arg)   # (E1: app.py and the tests read them here)
from watch_session import BACKUP_NAMES, SESSION_FILE, drop_session, load_session, save_session, session_path

log = logging.getLogger(__name__)

ACTIVE = ("playing", "paused")                       # the thread is applying plays, or will on resume
SESSION = ("playing", "paused", "done", "error")     # a watched game is on screen and can still be put back
MAX_SAME_SECOND = 99                                 # backups made in one second are named -2 to -99
KEEP_BACKUPS = 20                                    # of each file: older backups go (prune_backups)
BACKUP_STAMP_RE = re.compile(r"\.backup-([0-9]{8}-[0-9]{6})(?:-([0-9]{1,2}))?(?:\.json)?$")
MAX_SKIPS_IN_A_ROW = 3                               # plays the feed couldn't apply, in a row, before a watch gives up
# restructure-v2 sections 2 and 5: the page's top bar has Reset and Go Live (no Stop), and both rebuild from an error
RESTARTED = ("The app restarted during a watch, so the watched game is still loaded. Reset takes it back to kickoff, "
             "Go Live to the latest play.")
# A session's own fields (everything _clear resets, and its speed): what a game switch parks and puts back
SESSION_FIELDS = ("state", "queue", "plan", "idx", "event_id", "ff_until", "started_at", "feed_was_on", "backup", "error",
                  "_due", "_due_idx", "_left", "skipped", "_in_a_row", "_restore", "summary", "_map", "speed")


@dataclass(frozen=True)
class Parked:
    """A session a game switch stepped aside (Watch.leave): its fields as they stood, and its session file, which stays
    in its track's folder until the switch is done."""
    fields: dict
    session: Path


def where(n, total):
    """The game's message after a rebuild: where it stands."""
    return "At kickoff." if n == 0 else f"After play {n} of {total}."


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
    another one in the same second gets -2, -3 and so on. Then only the newest KEEP_BACKUPS of each file stay
    (prune_backups). Paths are read at call time (tests sandbox them)."""
    stamp = stamp or datetime.now().strftime("%Y%m%d-%H%M%S")
    made = {"state": _copy_aside(live.STATE_PATH, f"live_state.backup-{stamp}", ".json"),
            "seen": _copy_aside(espn_feed.SEEN_PATH, f"feed_seen.json.backup-{stamp}", "")}
    prune_backups()
    return made


def _copy_aside(src, stem, suffix):
    """src copied to <stem><suffix>, or <stem>-<n><suffix> past every copy made in the same second, so the newest
    backup always sorts last (backup_order)."""
    try:
        data = src.read_bytes()
    except FileNotFoundError:
        return None
    taken = [backup_order(p)[1] for p in src.parent.glob(f"{stem}*{suffix}") if backup_order(p)[0] == stem[-15:]]
    for n in range(max(taken, default=0) + 1, MAX_SAME_SECOND + 1):
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


def backup_order(path):
    """(stamp, n) of a backup's name, oldest first: live_state.backup-20261009-211000-2.json is (that stamp, 2)."""
    m = BACKUP_STAMP_RE.search(path.name)
    return (m.group(1), int(m.group(2) or 1)) if m else ("", 0)


def prune_backups(keep=None):
    """Only the newest `keep` (KEEP_BACKUPS) backups of each file stay; one the session file names never goes (Stop
    puts it back). A session file that can't be read stops the pruning: nothing is removed blind."""
    keep = KEEP_BACKUPS if keep is None else keep
    try:
        saved = json.loads(session_path().read_text())
    except FileNotFoundError:
        saved = {}
    except (OSError, ValueError) as ex:
        log.warning("Couldn't read %s (%s): no backups were removed.", SESSION_FILE, ex)
        return
    named = saved.get("backup") if isinstance(saved, dict) and isinstance(saved.get("backup"), dict) else {}
    needed = {v for v in named.values() if isinstance(v, str)}
    for key, home in (("state", live.STATE_PATH), ("seen", espn_feed.SEEN_PATH)):
        found = [p for p in home.parent.glob(f"{home.name.split('.')[0]}*") if BACKUP_NAMES[key].fullmatch(p.name)]
        for old in sorted(found, key=backup_order, reverse=True)[keep:]:
            if old.name in needed:
                continue
            try:
                old.unlink()
            except OSError as ex:
                log.warning("Couldn't remove the old backup %s (%s).", old.name, ex)


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


# ---------------------------------------------------------------- E2: the session
class Watch:
    """Replays a saved or finished ESPN game into the engine, one play per tick."""

    def __init__(self, feed, lock, pace_scale=1.0):
        if not (isinstance(pace_scale, (int, float)) and 0 < pace_scale < math.inf):
            raise ValueError(f"pace_scale must be a positive number, got {pace_scale!r}")
        self.feed, self.lock, self.scale = feed, lock, float(pace_scale)
        self.cv = threading.Condition()           # guards the fields below; never held while touching the engine
        self.token, self.speed, self._thread = 0, None, None
        self._clear()
        self._reload_session()

    @property
    def engine(self):
        """The engine on screen: the feed's (a game switch reloads it in place, switch.py)."""
        return self.feed.engine

    def _clear(self):
        """No session: every field as a watch that never started has it (the speed and the token carry on)."""
        self.state, self.queue, self.plan, self.idx = "idle", [], [], 0
        self.event_id, self.ff_until, self.started_at = None, 0, None
        self.feed_was_on, self.backup, self.error = False, None, None
        self._due = self._due_idx = self._left = None   # monotonic deadline of play _due_idx; seconds left if paused
        self.skipped = self._in_a_row = 0         # plays the feed couldn't apply this session; how many just now
        self._restore = None                      # what stop(restore=True) puts back
        self.summary = None                       # the session's game: seek, back and forward rebuild from it
        self._map = None                          # (a summary, its playback.PlayMap): worked out once per summary

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

    def in_session(self):
        """A session (playing, paused, done or error) owns the screen."""
        with self.cv:
            return self.state in SESSION

    def snapshot(self):
        """The watch object of /api/state and GET /api/watch (E1), with the progress bar's marks and the status of the
        game on screen (restructure-v2 section 9): the session's, or the live feed's after Go Live."""
        with self.cv:
            pm = self._play_map(self.feed.summary)
            return {**self._brief(), "ff_until": self.ff_until, "started_at": self.started_at,
                    "feed_was_on": self.feed_was_on, "backup": dict(self.backup) if self.backup else None,
                    "marks": [m._asdict() for m in pm.marks] if pm else [],
                    "game": pm.game._asdict() if pm and pm.game else None}

    def session_game(self):
        """(event, summary) of the session's game, which seek, back and forward rebuild: (its event, None) when a
        restart left it unloaded, (None, None) with no session. The caller loads what is missing, outside LOCK."""
        with self.cv:
            return (self.event_id, self.summary) if self.state in SESSION else (None, None)

    def _play_map(self, summary):
        """playback.play_map of summary, worked out once per summary object (each live poll brings a new one; a whole
        game takes about 5 ms). None when there is no summary."""
        if summary is None:
            return None
        with self.cv:
            if self._map is None or self._map[0] is not summary:
                self._map = (summary, playback.play_map(summary, GAME["offense"]))
            return self._map[1]

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
        """next_kind (v1.4) is the pace of the row the session waits on: caller_snap while the next call is up."""
        return {"state": self.state, "event_id": self.event_id, "speed": self.speed, "idx": self.idx,
                "total": len(self.queue), "next_at": self._next_at(), "next_kind": self._next_kind(),
                "skipped": self.skipped, "error": self.error}

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
        return self._pace_s(i, self.speed) * self.scale

    def _pace_s(self, i, speed):
        """Seconds before play i at `speed`, before the scale (delay_s)."""
        pace, seconds = self.plan[i]
        return delay_s(pace, seconds, speed)

    def _rescale(self, old):
        """What a speed change does to the time left on the current wait: the new pace over the old one for the play
        waited on (old / new speed, unless a caller snap's floor is in play)."""
        i = self._due_idx
        if i is None or not 0 <= i < len(self.plan):
            return old / self.speed
        before = self._pace_s(i, old)
        return self._pace_s(i, self.speed) / before if before > 0 else 1.0

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
        plan = pace_plan(queue, self.engine.sides)       # each tracked offense's snaps are caller snaps
        with self.lock:
            carried = self.check_can_start()
            started_at = datetime.now().isoformat(timespec="seconds")
            restore = self._backup_and_reset(event_id, summary, speed, carried, started_at)
            self._open_session("playing", (event_id, summary, queue, plan), restore, started_at, float(speed),
                               at=0, ff_until=from_seq)

    def _open_session(self, state, game, restore, started_at, speed, at, ff_until):
        """Under LOCK, the game just reset and its first `at` plays applied: the session's fields for `game` (event,
        summary, queue, plan), then its thread, waiting while paused (none once done: nothing is left to play)."""
        event_id, summary, queue, plan = game
        with self.cv:
            self.token += 1
            self.state, self.error, self.event_id, self.speed = state, None, event_id, speed
            self.queue, self.plan, self.idx, self.ff_until, self.summary = queue, plan, at, ff_until, summary
            self._due = self._due_idx = self._left = None
            self.skipped, self._in_a_row = len(self.feed.skipped_ids), 0
            self.started_at = started_at
            self.feed_was_on, self._restore = restore["feed_was_on"], restore
            self.backup = {k: (p.name if p else None) for k, p in restore["files"].items()}
            token = self.token
            self.cv.notify_all()                  # an older session's thread, if still waiting, sees it is over
        if state != "done":
            self._thread = threading.Thread(target=self._run, args=(token,), name=f"watch-{token}", daemon=True)
            self._thread.start()

    @staticmethod
    def _check_game(event_id, summary, queue, n, what="from_seq"):
        caller = GAME["offense"]
        if not queue:
            raise WatchError(f"ESPN game {event_id} has no plays yet.", 400)
        if espn_feed.team_id(summary, caller) is None:
            raise WatchError(f"ESPN game {event_id} isn't a {caller} game, so there are no calls to predict.", 400)
        if n > len(queue):
            raise WatchError(f"{what} {n} is past the end: this game has {len(queue)} plays.", 400)

    def _backup_and_reset(self, event_id, summary, speed, carried, started_at):
        """Under LOCK: back up (or keep the restore point `carried` from the session on screen) and note it in the
        session file, then stop the live feed, reset the engine and the feed and load this game. Returns what
        stop(restore=True) needs to put the old game back."""
        feed, engine = self.feed, self.engine
        restore = carried or {"files": backup_game(),           # first: if it fails, nothing has changed yet
                              "feed_was_on": feed.on, "event_id": feed.event_id, "summary": feed.load_summary(),
                              "status": dict(feed.status)}
        save_session(restore, event_id, started_at)            # before the reset: a restart finds the way back
        feed.stop()
        feed.invalidate()                         # a live poll already in flight now applies nothing
        engine.reset()                            # versions only go up across it (GameEngine.version)
        engine.clear_history()                    # U can't step back into half of the old game
        feed.forget()
        feed.event_id = event_id
        feed.summary = summary                    # the setter also learns the caller's ESPN team id
        feed.status.update(last_play=None, plays_logged=0, skipped=None)
        engine.bump_epoch()
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
                              f"{self.feed.status.get('skipped')}). Your game is backed up. Reset or Go Live tries "
                              "again.")
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
                ratio = self._rescale(old)
                if self._due is not None:
                    now = time.monotonic()
                    self._due = now + max(0.0, self._due - now) * ratio
                if self._left is not None:
                    self._left *= ratio
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
        """Nothing left to put back: drop the restore point (and the old summary it holds), the session's game and the
        session file."""
        self._restore = self.summary = None
        drop_session()

    # ------------------------------------------------ a game switch (switch.py; LOCK, then cv)
    def leave(self):
        """Before the game on screen switches: the thread applies nothing more and a session steps aside, nothing of it
        lost (its restore point, its file in its track's folder). Returns it parked, or None with no session: a switch
        that fails brings it back (come_back), one that goes through ends it (end_parked)."""
        with self.lock:
            with self.cv:
                parked = (Parked({k: getattr(self, k) for k in SESSION_FIELDS}, session_path())
                          if self.state in SESSION else None)
                self.token += 1
                self.state, self.error, self._due, self._left = "idle", None, None, None
                self.cv.notify_all()
            return parked

    def come_back(self, parked):
        """After a switch that failed (the game on screen is back): the parked session is back exactly as it stood,
        where it was, its speed and its restore point, its file never having left its folder; a playing or paused one
        gets its thread again. None: nothing to bring back."""
        if parked is None:
            return
        with self.lock:
            with self.cv:
                self.token += 1
                for name, value in parked.fields.items():
                    setattr(self, name, value)
                token, active = self.token, self.state in ACTIVE
                self.cv.notify_all()
            if active:
                self._thread = threading.Thread(target=self._run, args=(token,), name=f"watch-{token}", daemon=True)
                self._thread.start()

    @staticmethod
    def end_parked(parked):
        """After a switch that went through: the parked session ends the way Go Live ends one (nothing is put back,
        its game and its backups stay in its own track's folder): its session file goes."""
        if parked is not None:
            drop_session(parked.session)

    def enter(self):
        """After the switch: nothing of the old game is left here, then a session the new track's files hold (a restart
        cut it short) comes back as 'error' with its restore point, as at a start."""
        with self.lock:
            with self.cv:
                self.token += 1
                self._clear()
                self.cv.notify_all()
            self._reload_session()

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
        _put_files_back([(files[k], path) for k, path in (("state", live.STATE_PATH), ("seen", espn_feed.SEEN_PATH))
                         if files[k] is not None])
        state = engine._load() if files["state"] else engine._fresh()
        if state is None:
            raise WatchError(f"The backup {files['state'].name} couldn't be loaded.")
        engine.state = state                      # an older version: the next save still takes a newer one
        engine.clear_history()
        if files["seen"]:
            feed.reload_seen()
        else:
            feed.forget()                         # no applied ids before the watch
        feed.event_id = r["event_id"]
        feed.summary = r["summary"]               # after reload_seen: the setter fixes a legacy id order
        feed.status.update(r["status"] or {})
        engine.bump_epoch()
        engine.set_message("Stopped watching. Your game is back.")
        _resync_archive(engine)
        if r["feed_was_on"]:
            feed.start(r["event_id"])

    # ------------------------------------------------ playback: seek, back, forward, Go Live (LOCK, then cv)
    def seek(self, n, event_id, summary):
        """Rebuild the game from kickoff with its first n plays applied at once, then hold there: paused, or done when
        n is the total (restructure-v2 section 9). From any state. WatchError(400) for a game it can't play or n past
        the end. Paused or done at n of this game already: nothing changes."""
        queue = espn_feed.iter_plays(summary)
        self._check_game(event_id, summary, queue, n, "idx")
        plan = pace_plan(queue, self.engine.sides)       # each tracked offense's snaps are caller snaps
        with self.lock:
            with self.cv:
                if self.state in ("paused", "done") and (self.event_id, self.idx, len(self.queue)) == \
                        (event_id, n, len(queue)):
                    return
            restore, started_at, speed = self._rebuild(event_id, summary, queue[:n], where(n, len(queue)))
            self._open_session("done" if n == len(queue) else "paused", (event_id, summary, queue, plan), restore,
                               started_at, speed, at=n, ff_until=n)

    def back(self, event_id, summary):
        """One drawn play back: a rebuild to just after the drawn play before the newest one on screen (kickoff when
        there is none), paused. From any state: with no session, the game on screen counts. 409 at kickoff."""
        with self.lock:
            pm, k = self._on_screen(event_id, summary)
            if k == 0:
                raise WatchError("Already at kickoff.")
            self.seek(playback.back_target(pm.drawn, k), event_id, summary)

    def forward(self, event_id, summary):
        """One drawn play forward: plays up to and including the next one that draws, then paused (done at the end).
        A playing or paused session on this game moves on from where it stands, as step does; anything else is a
        rebuild that lands there. 409 at the last play (live, the newest one)."""
        with self.lock:
            pm, k = self._on_screen(event_id, summary)
            if k >= len(pm.ids):
                raise WatchError("Already at the last play.")
            target = playback.forward_target(pm.drawn, k)
            if not self._step_to(summary, target):
                self.seek(target, event_id, summary)

    def go_live(self, event_id, summary):
        """Under the caller's LOCK block, which turns the live feed on next: the game in progress on screen with every
        ESPN play so far, and no session (restructure-v2 section 9). This game's plays on screen stay and the rest
        follow them; anything else is rebuilt from kickoff first (backed up like start, or keeping a session's
        restore point). The session ends keeping the game: nothing to put back."""
        queue = espn_feed.iter_plays(summary)
        message = f"Live: ESPN game {event_id}, every play so far is in."
        with self.lock:
            k = self._on_screen(event_id, summary)[1]
            self._rebuild(event_id, summary, queue[k:], message, on_top=k > 0)
            with self.cv:
                self.token += 1
                self.state, self.error, self.event_id = "stopped", None, event_id
                self.queue, self.idx, self._due, self._left = queue, len(queue), None, None
                self.cv.notify_all()
            self._end_session()

    def _on_screen(self, event_id, summary):
        """Under LOCK: the game's play map, and how many of its plays are on screen (none of another event's)."""
        pm = self._play_map(summary)
        return pm, playback.position(self.feed.applied, pm.ids) if self.feed.event_id == event_id else 0

    def _step_to(self, summary, target):
        """Under LOCK: a playing or paused session on summary pauses and applies its plays up to target, one at a time
        as step does. False when there is no such session."""
        with self.cv:
            if self.state not in ACTIVE or self.summary is not summary:
                return False
            self.state, self._due, self._left = "paused", None, None
            self.cv.notify_all()
        for i in range(self.idx, target):
            self._apply(i)
            if self.state != "paused":            # the end, a run of skips, or a resume meanwhile
                break
        return True

    def _rebuild(self, event_id, summary, plays, message, on_top=False):
        """Under LOCK: the session's thread stops, the game is reset (backed up first, unless a session's restore point
        is kept: a burst of seeks never prunes the real game's backup away) and `plays` are applied at once; on_top,
        they follow the plays on screen instead, with no reset. Returns (restore, started_at, speed). One that fails
        part way leaves an error session keeping the restore point."""
        with self.cv:
            carried = self._restore if self.state in SESSION else None
            speed = self.speed or DEFAULT_SPEED
            started_at = (carried and self.started_at) or datetime.now().isoformat(timespec="seconds")
            self.token += 1                       # a running thread applies nothing more: it re-reads it under LOCK
            self.cv.notify_all()
        try:
            if on_top:
                restore, self.feed.summary = carried, summary
            else:
                restore = self._backup_and_reset(event_id, summary, speed, carried, started_at)
            self._apply_at_once(plays, message)
        except Exception as ex:
            self._rebuild_failed(event_id, carried, ex)
            raise
        return restore, started_at, speed

    def _rebuild_failed(self, event_id, carried, ex):
        """An error session keeping the restore point it had, or the one the session file names by now. With neither,
        the first backup failed and nothing changed."""
        restore = carried or (load_session() or (None,))[0]
        if restore is None:
            return
        with self.cv:
            self.state, self.error, self.event_id = "error", f"Couldn't rebuild the game: {ex}", event_id
            self._restore, self._due, self._left = restore, None, None
            self.backup = {k: (p.name if p else None) for k, p in restore["files"].items()}
            self.cv.notify_all()

    def _apply_at_once(self, plays, message):
        """Under LOCK: plays applied with no pacing, the game file saved once at the end rather than about twice a play
        (150 plays take about 0.6 s, not 1.1), the applied ids with the last play, and `message` on screen."""
        engine, last = self.engine, len(plays) - 1
        engine._batching = True                   # GameEngine.command's switch: _save and _checkpoint wait for it
        try:
            for i, (team, p) in enumerate(plays):
                self.feed.apply_one(team, p, save=i == last)
            engine.state["message"] = message
        finally:
            engine._batching = False
        engine._save()

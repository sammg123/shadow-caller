"""The watch session file, data/watch_session.json (data contract E2.7). Written whenever a watch, a seek or Go Live
resets the game and removed when the session ends, it names the backups Stop puts back: a session a server restart
cut short comes back as 'error' with its restore point, instead of stranding the real game in a backup nothing points
at. Paths are read at call time (tests sandbox live.STATE_PATH)."""
import json
import logging
import os
import re

import espn_feed
import live
from config import GAME

log = logging.getLogger(__name__)

SESSION_FILE = "watch_session.json"                  # next to live_state.json while there is a game to put back
BACKUP_NAMES = {"state": re.compile(r"live_state\.backup-[0-9-]{1,40}\.json"),    # what SESSION_FILE may name
                "seen": re.compile(r"feed_seen\.json\.backup-[0-9-]{1,40}")}


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

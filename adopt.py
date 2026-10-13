"""Adopting today's game into per-game folders (docs/design/game-picker.md 4; restructure-v2.md 11 decision 3).

Before phase 2 one game lived in DATA_DIR itself (live_state.json, feed_seen.json, watch_session.json and the watch's
backups). On the first start with per-game folders, before the engine is made (so before anything can write), that
game becomes the track games/<event>/<offense>/, by copy, never by move:

1. Only when DATA_DIR/live_state.json exists and games/index.json doesn't. The event: feed_seen.json's record of it,
   else the game file's own, else config.GAME's when its game_id is this one. No event: no adoption.
2. The game file as it is; feed_seen.json cut to this game; watch_session.json when it names this game, with the
   backups it names; every other backup of this game. Each is written into a staging folder inside games/.
3. game.json: the track's config is the game file's own block (the line he graded with), plus the event, on the
   model it was graded with (models/, 'default').
4. Every copy is checked by sha256 against its source; the staged game moves into place in one rename; index.json is
   written last (its existence marks a finished adoption). Any failure removes what this run made and leaves DATA_DIR
   exactly as it was: the app then runs on DATA_DIR as before.
5. The app never writes the old files again: they stay as Sam's safety copy.
"""
import hashlib
import json
import logging
import re
import shutil
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import callers
import tracks

log = logging.getLogger(__name__)

SESSION_FILE = "watch_session.json"
ORDER_KEY, EVENTS_KEY = "_apply_order", "_events"          # espn_feed.Feed's keys in feed_seen.json
BACKUPS = {"state": re.compile(r"live_state\.backup-[0-9-]{1,40}\.json"),    # watch_session.BACKUP_NAMES
           "seen": re.compile(r"feed_seen\.json\.backup-[0-9-]{1,40}")}
GAME_ID_RE = re.compile(r"[0-9A-Za-z_]{1,40}")
STAGING_PREFIX = ".adopting-"


class Unadoptable(Exception):
    """A reason not to adopt (nothing written yet): the app stays on DATA_DIR, as before."""


@dataclass(frozen=True)
class Outcome:
    adopted: bool
    message: str
    track: tracks.Track | None = None
    quiet: bool = False            # nothing to adopt: no game file, or adopted already


@dataclass(frozen=True)
class Copy:
    """One file the adoption writes: its name in the track's folder, its bytes, and the source they came from (the
    source's sha256 when it was read: it must still match when the copies are checked)."""
    name: str
    data: bytes
    source: Path
    source_sha: str


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def adopt(data_dir: Path | str, default_game: Mapping, caller_name: str) -> Outcome:
    """Adopt DATA_DIR's game when it hasn't been (module docstring). Never raises: the outcome says what happened."""
    data = Path(data_dir)
    root = tracks.games_dir(data)
    if (root / tracks.INDEX_FILE).exists():
        return Outcome(False, "Games already live in per-game folders (games/index.json): nothing to adopt.",
                       quiet=True)
    if not (data / tracks.STATE_FILE).is_file():
        return Outcome(False, "No live_state.json in the data folder: nothing to adopt.", quiet=True)
    try:
        track, about, copies = plan(data, default_game, caller_name)
    except Unadoptable as ex:
        return Outcome(False, str(ex))
    except (OSError, ValueError) as ex:
        return Outcome(False, f"Today's game wasn't adopted: its files couldn't be read ({ex}).")
    try:
        place(data, track, about, copies)
    except Unadoptable as ex:
        return Outcome(False, str(ex))
    except Exception as ex:                    # anything at all: what this run made is gone, the app stays on data/
        log.warning("Adoption failed", exc_info=True)
        return Outcome(False, f"Today's game wasn't adopted, so the app stays on the data folder ({ex}).")
    return Outcome(True, f"Adopted today's game as games/{track.event_id}/{track.key} ({len(copies)} files, each "
                         "checked against its source).", track)


# ---------------------------------------------------------------- what to copy (reads only)
def plan(data: Path, default_game: Mapping, caller_name: str) -> tuple[tracks.Track, dict, list[Copy]]:
    raw = (data / tracks.STATE_FILE).read_bytes()
    game = game_block(json.loads(raw))
    seen_path = data / tracks.SEEN_FILE
    seen_raw = seen_path.read_bytes() if seen_path.is_file() else None
    seen = parse_seen(seen_raw)
    event = event_of(game, seen, json.loads(raw), default_game)
    off, opp = game["offense"], game["opponent"]
    track = tracks.make_track(event, [off], {off: {**game, "espn_event": event}},
                              {off: {"name": caller_name, "slug": callers.slugify(caller_name)}}, model="default")
    about = {"label": game.get("label"), "away": opp if game["offense_is_home"] else off,
             "home": off if game["offense_is_home"] else opp}
    copies = [Copy(tracks.STATE_FILE, raw, data / tracks.STATE_FILE, sha256(raw))]
    if seen_raw is not None:
        copies.append(Copy(tracks.SEEN_FILE, seen_for(seen, seen_raw, game["game_id"]), seen_path, sha256(seen_raw)))
    return track, about, copies + session_copies(data, game["game_id"])


def game_block(state: object) -> dict:
    """The game file's own game: the config it was played with. Unadoptable when it doesn't hold one."""
    game = state.get("game") if isinstance(state, dict) else None
    if not isinstance(game, dict):
        raise Unadoptable("Today's game wasn't adopted: live_state.json holds no game.")
    ok = (isinstance(game.get("game_id"), str) and GAME_ID_RE.fullmatch(game["game_id"])
          and all(isinstance(game.get(k), str) and tracks.SIDE_RE.fullmatch(game[k]) for k in ("offense", "opponent"))
          and isinstance(game.get("offense_is_home"), bool)
          and all(isinstance(game.get(k), (int, float)) and not isinstance(game.get(k), bool)
                  for k in tracks.NUMBER_KEYS))
    if not ok:
        raise Unadoptable("Today's game wasn't adopted: live_state.json's game is missing its teams or its line.")
    return game


def parse_seen(raw: bytes | None) -> dict | None:
    """feed_seen.json as a dict, or None when there is none or it can't be read (then it is copied as it is)."""
    if raw is None:
        return None
    try:
        seen = json.loads(raw)
    except ValueError:
        return None
    return seen if isinstance(seen, dict) else None


def event_of(game: Mapping, seen: Mapping | None, state: Mapping, default_game: Mapping) -> str:
    """The ESPN event of the game: the feed's record of it, the game file's, else config.GAME's for this game."""
    gid = game["game_id"]
    events = (seen or {}).get(EVENTS_KEY)
    found = [(events or {}).get(gid) if isinstance(events, dict) else None, game.get("espn_event"),
             state.get("espn_event"), default_game.get("espn_event") if default_game.get("game_id") == gid else None]
    event = next((e for e in found if isinstance(e, str) and tracks.EVENT_RE.fullmatch(e)), None)
    if event is None:
        raise Unadoptable(f"Today's game ({gid}) wasn't adopted: no ESPN event is recorded for it, so the app stays "
                          "on the data folder as before.")
    return event


def seen_for(seen: dict | None, raw: bytes, gid: str) -> bytes:
    """feed_seen.json cut to this game: its id list, its place in the apply order, its event. As it is when it can't
    be read (the feed reads it the same way it does today)."""
    if seen is None:
        return raw
    order, events = seen.get(ORDER_KEY), seen.get(EVENTS_KEY)
    out = {gid: seen[gid]} if gid in seen else {}
    if isinstance(order, list) and gid in order:
        out[ORDER_KEY] = [gid]
    if isinstance(events, dict) and gid in events:
        out[EVENTS_KEY] = {gid: events[gid]}
    return json.dumps(out).encode()


def session_copies(data: Path, gid: str) -> list[Copy]:
    """watch_session.json when it names this game, and every backup of this game (the session's among them)."""
    out = []
    session_path = data / SESSION_FILE
    raw = session_path.read_bytes() if session_path.is_file() else None
    session = parse_seen(raw)
    if session is not None and session.get("game_id") == gid:
        out.append(Copy(SESSION_FILE, raw, session_path, sha256(raw)))
    for path in sorted(data.iterdir()):
        if path.is_file() and is_backup_of(path, gid):
            body = path.read_bytes()
            out.append(Copy(path.name, body, path, sha256(body)))
    return out


def is_backup_of(path: Path, gid: str) -> bool:
    """A watch backup holding this game: a game file whose game is this one, or applied ids that list it."""
    if not any(p.fullmatch(path.name) for p in BACKUPS.values()):
        return False
    try:
        body = json.loads(path.read_bytes())
    except (OSError, ValueError):
        return False
    if not isinstance(body, dict):
        return False
    if BACKUPS["state"].fullmatch(path.name):
        return isinstance(body.get("game"), dict) and body["game"].get("game_id") == gid
    return gid in body


# ---------------------------------------------------------------- writing it (a staging folder, then one rename)
def place(data: Path, track: tracks.Track, about: Mapping, copies: list[Copy]) -> None:
    """Stage, check, move into place, then the index. Whatever fails, what this run made goes."""
    root = tracks.games_dir(data)
    target = tracks.event_dir(data, track.event_id)
    if target.exists():
        raise Unadoptable(f"Today's game wasn't adopted: games/{track.event_id} is already there but games/index.json "
                          "isn't (an adoption was cut short). Move data/games aside to adopt again.")
    made_root = not root.exists()
    stage, moved = None, False
    try:
        root.mkdir(exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=STAGING_PREFIX, dir=root))
        staged = stage / track.event_id
        tracks.write_bytes_whole(staged / tracks.GAME_FILE,
                                 tracks.json_bytes(tracks.game_doc(track, about, {track.key: track.entry()})))
        for c in copies:
            tracks.write_bytes_whole(staged / track.key / c.name, c.data)
        check(staged / track.key, copies)
        staged.rename(target)
        moved = True
        stage.rmdir()
        stage = None
        tracks.write_index(data, index_of(track, copies))
    except BaseException:
        if stage is not None:
            shutil.rmtree(stage, ignore_errors=True)
        if moved:
            shutil.rmtree(target, ignore_errors=True)
        if made_root and root.is_dir() and not any(root.iterdir()):
            root.rmdir()
        raise


def check(folder: Path, copies: list[Copy]) -> None:
    """Every staged copy holds exactly the bytes meant for it, and every source is unchanged since it was read."""
    for c in copies:
        if sha256((folder / c.name).read_bytes()) != sha256(c.data):
            raise OSError(f"the copy of {c.name} doesn't match what was read")
        if sha256(c.source.read_bytes()) != c.source_sha:
            raise OSError(f"{c.source.name} changed while it was being copied")


def index_of(track: tracks.Track, copies: list[Copy]) -> dict:
    return {"version": tracks.INDEX_VERSION, "current": {"event_id": track.event_id, "sides": list(track.sides)},
            "adopted": {"from": tracks.STATE_FILE, "sha256": copies[0].source_sha, "at": tracks.now_text(),
                        "files": {c.name: sha256(c.data) for c in copies}}}

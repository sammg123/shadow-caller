"""Per-game state (docs/design/game-picker.md 4; restructure-v2.md 11): every game, and every set of sides tracked in
it, has a folder of its own, so switching games never touches another game's files.

    DATA_DIR/games/index.json            {"version", "current": {"event_id", "sides"}, "adopted": {...}}
    DATA_DIR/games/<event>/game.json     {"event_id", "label", "away", "home", "created_at", "tracks": {key: entry}}
    DATA_DIR/games/<event>/<key>/        live_state.json, feed_seen.json, watch_session.json and the watch's backups
    DATA_DIR/games/shadow.duckdb.kept-<time>   the call log archive, copied before a run first changed it (archive_keep)

A track is (event, sides); its key is the sides sorted and joined by '+' ('DAL', 'DAL+TB'). Its entry in game.json
is made once and never rewritten, so its line stays what it was when the track was first made (TB at DAL keeps 8.5
and 48.5): the sides (away then home), its config (config.GAME for it), each side's play-caller, and the model it runs
on: 'default' (models/, what GameEngine() loads: the adopted game keeps the model it was graded with) or 'callers'
(each side's bundle in models/callers). Every file is written whole: a temp file, flushed, then os.replace.
"""
import json
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from types import MappingProxyType
from typing import Any

import callers

GAMES_DIR, INDEX_FILE, GAME_FILE = "games", "index.json", "game.json"
STATE_FILE, SEEN_FILE = "live_state.json", "feed_seen.json"
INDEX_VERSION = 1
MODELS = ("default", "callers")
MAX_SIDES = 2
EVENT_RE = re.compile(r"[0-9]{1,12}")           # ASCII only: event ids and team abbreviations become folder names
SIDE_RE = re.compile(r"[A-Z]{2,4}")
TEXT_KEYS = ("game_id", "offense", "opponent", "espn_event")
NUMBER_KEYS = ("offense_spread", "total_line")
SIDES_HELP = 'sides must be a list of one or two different team abbreviations, like ["DAL"] or ["TB", "DAL"].'


# ---------------------------------------------------------------- names and folders
def check_event(event_id: object) -> str:
    """An ESPN event id: a string of ASCII digits (it names a folder). ValueError otherwise."""
    if not (isinstance(event_id, str) and EVENT_RE.fullmatch(event_id)):
        raise ValueError(f"ESPN event ids are digits only, like 401872980 (got '{str(event_id)[:20]}').")
    return event_id


def check_sides(sides: object) -> tuple[str, ...]:
    """One or two different team abbreviations (ASCII capitals: they name folders). Every side is checked to be one
    before they are compared (a dict or a list can't go in a set)."""
    if not isinstance(sides, (list, tuple)):
        raise ValueError(SIDES_HELP)
    out = tuple(sides)
    if not (1 <= len(out) <= MAX_SIDES and all(isinstance(s, str) and SIDE_RE.fullmatch(s) for s in out)
            and len(set(out)) == len(out)):
        raise ValueError(SIDES_HELP)
    return out


def track_key(sides: Sequence[str]) -> str:
    """'DAL'; 'DAL+TB' for both sides, whatever order they came in."""
    return "+".join(sorted(check_sides(sides)))


def games_dir(data_dir: Path | str) -> Path:
    return Path(data_dir) / GAMES_DIR


def event_dir(data_dir: Path | str, event_id: str) -> Path:
    return games_dir(data_dir) / check_event(event_id)


def track_dir(data_dir: Path | str, event_id: str, sides: Sequence[str]) -> Path:
    return event_dir(data_dir, event_id) / track_key(sides)


def state_paths(data_dir: Path | str, track: "Track") -> tuple[Path, Path]:
    """The track's game file and its applied ESPN ids: live.STATE_PATH and espn_feed.SEEN_PATH while it is open."""
    folder = track_dir(data_dir, track.event_id, track.sides)
    return folder / STATE_FILE, folder / SEEN_FILE


# ---------------------------------------------------------------- read-only values
def freeze(value: object) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({k: freeze(v) for k, v in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(freeze(v) for v in value)
    return value


def thaw(value: object) -> Any:
    """Plain JSON types again (dicts and lists), a fresh copy."""
    if isinstance(value, Mapping):
        return {k: thaw(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [thaw(v) for v in value]
    return value


# ---------------------------------------------------------------- a track
@dataclass(frozen=True)
class Track:
    """One game and the sides tracked in it; game is its config (config.GAME), frozen when the track was made."""
    event_id: str
    sides: tuple
    game: Mapping
    callers: Mapping               # team -> {"name", "slug"}
    model: str = "callers"
    created_at: str | None = None

    @property
    def key(self) -> str:
        return track_key(self.sides)

    def config(self) -> dict:
        """config.GAME for this track, as a fresh plain dict."""
        return thaw(self.game)

    def entry(self) -> dict:
        """The track's entry in game.json."""
        return {"sides": list(self.sides), "game": self.config(), "callers": thaw(self.callers), "model": self.model,
                "created_at": self.created_at}


def make_track(event_id: str, sides: Sequence[str], configs: Mapping, named: Mapping, *, model: str = "callers",
               created_at: str | None = None) -> Track:
    """A new track from each side's config (games.Games.game_config) and play-caller ({name, slug}). The sides go away
    then home. One side keeps its config; both sides take the home side's (its offense is the home team) plus every
    side's own in by_side (its spread from its own side; the total is shared). ValueError for a config the engine
    can't use."""
    order = tuple(sorted(check_sides(sides), key=lambda s: bool(configs[s]["offense_is_home"])))
    key = track_key(order)
    if len(order) == 1:
        game = {**configs[order[0]], "sides": list(order), "track": key}
    else:
        game = {**configs[order[-1]], "sides": list(order), "track": key,
                "by_side": {s: dict(configs[s]) for s in order}}
    who = {s: {"name": str(named[s]["name"]), "slug": str(named[s]["slug"])} for s in order}
    return from_entry(event_id, {"sides": list(order), "game": game, "callers": who, "model": model,
                                 "created_at": created_at or now_text()})


def from_entry(event_id: str, entry: object) -> Track:
    """A track from its game.json entry. ValueError, with the reason, for an entry that doesn't hold one."""
    if not isinstance(entry, Mapping):
        raise ValueError("A track in game.json isn't an object.")
    sides, game, who = check_sides(entry.get("sides")), entry.get("game"), entry.get("callers")
    name = track_key(sides)
    if not isinstance(game, Mapping) or not isinstance(who, Mapping):
        raise ValueError(f"Track {name} in game.json has no game or play-callers.")
    bad = [k for k in TEXT_KEYS if not isinstance(game.get(k), str)]
    bad += [k for k in NUMBER_KEYS if isinstance(game.get(k), bool) or not isinstance(game.get(k), (int, float))]
    bad += [] if isinstance(game.get("offense_is_home"), bool) else ["offense_is_home"]
    if bad or game["offense"] not in sides or game["espn_event"] != check_event(event_id):
        raise ValueError(f"Track {name} in game.json has a config the engine can't use ({', '.join(bad[:3])}).")
    if not all(isinstance(who.get(s), Mapping) and isinstance(who[s].get("name"), str)
               and callers.is_slug(who[s].get("slug")) for s in sides):
        raise ValueError(f"Track {name} in game.json doesn't name every side's play-caller.")
    if entry.get("model") not in MODELS:
        raise ValueError(f"Track {name} in game.json names no model it runs on.")
    created = entry.get("created_at")
    return Track(event_id, sides, freeze(game), freeze({s: who[s] for s in sides}), entry["model"],
                 created if isinstance(created, str) else None)


# ---------------------------------------------------------------- files
def now_text() -> str:
    return datetime.now().isoformat(timespec="seconds")


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=1) + "\n").encode()


def read_json(path: Path) -> Any:
    """The file's JSON, or None when there is no file. ValueError, naming the file, when it can't be read."""
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as ex:
        raise ValueError(f"{path.name} in {path.parent.name} can't be read ({ex}).") from None


def write_bytes_whole(path: Path, data: bytes) -> bytes:
    """Written whole: a temp file (flushed to disk), then os.replace. Returns the bytes written. Whatever stops it (an
    OSError, Ctrl-C), the temp file goes with it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return data


def write_whole(path: Path, value: object) -> bytes:
    return write_bytes_whole(path, json_bytes(value))


def read_game_file(data_dir: Path | str, event_id: str) -> dict | None:
    path = event_dir(data_dir, event_id) / GAME_FILE
    doc = read_json(path)
    if doc is not None and not (isinstance(doc, dict) and isinstance(doc.get("tracks"), dict)):
        raise ValueError(f"{GAME_FILE} of ESPN game {event_id} has no tracks.")
    return doc


def load_track(data_dir: Path | str, event_id: str, sides: Sequence[str]) -> Track | None:
    """The track as it was made, or None when it hasn't been. ValueError for a game file that can't be read."""
    doc = read_game_file(data_dir, event_id)
    entry = doc["tracks"].get(track_key(sides)) if doc else None
    return None if entry is None else from_entry(event_id, entry)


def game_doc(track: Track, about: Mapping, tracks: Mapping) -> dict:
    """game.json for a game: its label and teams, when it was first made, and its tracks."""
    return {"event_id": track.event_id, "label": about.get("label"), "away": about.get("away"),
            "home": about.get("home"), "created_at": about.get("created_at") or now_text(), "tracks": dict(tracks)}


def save_track(data_dir: Path | str, track: Track, about: Mapping) -> bool:
    """Write the track into its game's game.json unless it is there already (its config stays frozen). about: the
    game's label, away and home, for a new file. True when it was written."""
    doc = read_game_file(data_dir, track.event_id)
    if doc and track.key in doc["tracks"]:
        from_entry(track.event_id, doc["tracks"][track.key])        # one that can't be read is an error, not a new line
        return False
    tracks = {**(doc["tracks"] if doc else {}), track.key: track.entry()}
    write_whole(event_dir(data_dir, track.event_id) / GAME_FILE,
                {**doc, "tracks": tracks} if doc else game_doc(track, about, tracks))
    return True


def forget_track(data_dir: Path | str, track: Track) -> None:
    """Take back a track just made (a switch that failed before it opened): its entry goes, and game.json with the
    last one. Its folder and the game's go only when empty."""
    doc = read_game_file(data_dir, track.event_id)
    if not doc or track.key not in doc["tracks"]:
        return
    path = event_dir(data_dir, track.event_id) / GAME_FILE
    left = {k: v for k, v in doc["tracks"].items() if k != track.key}
    if left:
        write_whole(path, {**doc, "tracks": left})
    else:
        path.unlink()
    for folder in (track_dir(data_dir, track.event_id, track.sides), event_dir(data_dir, track.event_id)):
        if folder.is_dir() and not any(folder.iterdir()):
            folder.rmdir()


def read_index(data_dir: Path | str) -> dict | None:
    index = read_json(games_dir(data_dir) / INDEX_FILE)
    if index is not None and not isinstance(index, dict):
        raise ValueError(f"{INDEX_FILE} isn't an object.")
    return index


def write_index(data_dir: Path | str, index: Mapping) -> bytes:
    return write_whole(games_dir(data_dir) / INDEX_FILE, dict(index))


def set_current(data_dir: Path | str, track: Track) -> None:
    """index.json names this track, so a restart opens it again; the rest of the index stays."""
    index = read_index(data_dir) or {"version": INDEX_VERSION}
    write_index(data_dir, {**index, "current": {"event_id": track.event_id, "sides": list(track.sides)}})


def current(data_dir: Path | str) -> Track | None:
    """The track index.json names, or None with no index, or one that names none (config.GAME on data/, as before
    phase 2). ValueError when the index can't be read or names a track its game file doesn't have."""
    index = read_index(data_dir)
    now = index.get("current") if index else None
    if now is None:
        return None
    if not isinstance(now, Mapping):
        raise ValueError(f"{INDEX_FILE} names no current game.")
    found = load_track(data_dir, check_event(now.get("event_id")), check_sides(now.get("sides")))
    if found is None:
        raise ValueError(f"{INDEX_FILE} names a game ({now.get('event_id')}) whose {GAME_FILE} doesn't have it.")
    return found


# ---------------------------------------------------------------- what /api/state says
def matchup_text(away: str, home: str, neutral: object = False) -> str:
    """'TB at DAL', or 'PHI vs JAX' at a neutral site: games.matchup's words, in abbreviations."""
    return f"{away} {'vs' if neutral is True else 'at'} {home}"


def matchup_of(game: Mapping) -> str:
    """'TB at DAL', from the config's offense, opponent and home side; 'PHI vs JAX' when the config says the game is at
    a neutral site (games.Games.game_config; a config frozen before it said so reads at)."""
    off, opp = game["offense"], game["opponent"]
    away, home = (opp, off) if game.get("offense_is_home") else (off, opp)
    return matchup_text(away, home, game.get("neutral"))


def track_view(track: Track | None, game: Mapping | None = None, event_id: str | None = None) -> dict:
    """/api/state's track: {event_id, sides, label}. No track (data/ as before phase 2): the game on screen, from
    config.GAME's side."""
    if track is not None:
        return {"event_id": track.event_id, "sides": list(track.sides), "label": matchup_of(track.game)}
    return {"event_id": event_id or game.get("espn_event") or None, "sides": [game["offense"]],
            "label": matchup_of(game)}


def tracked_view(track: Track | None, game: Mapping | None = None, caller: str | None = None) -> list:
    """/api/state's tracked: [{team, caller, slug}], one per side tracked, away then home. No track: config.GAME's
    offense and the engine's caller."""
    if track is not None:
        return [{"team": s, "caller": track.callers[s]["name"], "slug": track.callers[s]["slug"]} for s in track.sides]
    return [{"team": game["offense"], "caller": caller, "slug": callers.slugify(caller) if caller else None}]

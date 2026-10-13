"""Picking a game (docs/design/game-picker.md 4; restructure-v2.md 11): POST /api/game/select's body, the plan made
before the lock, the switch under it, and the start that opens the current track.

The plan (no lock; it may wait on ESPN): the game from the listing; each side named as ESPN names it; the track as it
was frozen when it was made, else a new one from each side's play-caller (the play-caller table, then the models'
index: a caller with no built model is refused with the index's reason) and today's line; each side's model loaded
(about half a second each); ESPN's game, which says whether it is live.

The switch (under the app's LOCK). First the new track is made ready while the game on screen stays as it is: the
track is written into game.json unless it is there (its line stays frozen) and its models are loaded; a failure there
changes nothing on screen. Then the old game is left: the live feed stops and a poll in flight is dropped, a watch
session steps aside (Watch.leave: its restore point and its file stay); live.STATE_PATH and espn_feed.SEEN_PATH point
at the track's folder and config.GAME becomes its config, in place; the engine reloads in place on the track's models
and game (GameEngine.reload: the app's feed and Watch keep the one engine; its epoch changes and its version keeps
going up); the feed and the Watch follow it; index.json names it; then it opens the way POST /api/open opens a game.
Only then, when nothing can fail any more, does the old session end the way Go Live ends one (its file goes; its game
and backups stay in its own folder). Anything that fails puts every one of those back, the old session included,
exactly as it stood, and the half-made track goes: never a half switch.
"""
import copy
import logging
import shutil
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import adopt
import callers
import espn_feed
import live
import playback
import tracks
import watch

log = logging.getLogger(__name__)

SELECT_KEYS = ("event_id", "sides")
LOAD_ERRORS = (FileNotFoundError, live.ModelVersionError, callers.CallerNotFound, callers.ModelVersionError)


class SwitchError(Exception):
    """A pick the app can't open: 409 by default (no model, no line, a model that won't load), 500 when a switch broke
    part way (everything was put back)."""

    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------- the body
def parse_select(body: object) -> tuple[str, tuple[str, ...]]:
    """(event_id, sides) from POST /api/game/select's body. ValueError, with the reason, for anything else."""
    if not isinstance(body, dict):
        raise ValueError('Send a JSON object: {"event_id": "401872980", "sides": ["DAL"]}.')
    extra = sorted(str(k) for k in body if k not in SELECT_KEYS)
    if extra:
        raise ValueError(f"Unknown field '{extra[0][:20]}'. This takes event_id and sides.")
    if "event_id" not in body:
        raise ValueError("Send event_id: the ESPN game id, like 401872980.")
    if "sides" not in body:
        raise ValueError(f"Send sides. {tracks.SIDES_HELP}")
    return tracks.check_event(body["event_id"]), tracks.check_sides(body["sides"])


# ---------------------------------------------------------------- the plan (no lock)
@dataclass(frozen=True)
class Plan:
    track: tracks.Track
    about: Mapping                 # the game's label, away and home, for a new game.json
    models: Mapping                # team -> callers.CallerModel; empty on the default model (models/)
    summary: Mapping               # ESPN's game, for the open
    live: bool                     # in progress or not started: it opens live
    is_new: bool                   # game.json had no entry for it when the plan was made


def plan_select(event_id: str, sides: Sequence[str], *, data_dir: Path | str, games, index: Sequence[Mapping],
                load_caller: Callable, load_game: Callable) -> Plan:
    """Everything a switch needs, fetched and checked before the lock. games: a games.Games; index: the models' index
    entries (callers.list_callers(include_unbuilt=True)); load_caller(slug) and load_game(event_id) load a bundle and
    ESPN's game. ValueError (400) for a team that isn't playing; GamesError (404, 503) from the listing; SwitchError
    (409) for no play-caller, no built model, no line, a model that won't load or a game that was postponed."""
    game = games.game(event_id)
    if game.get("status") == "post" and not game.get("completed"):
        raise SwitchError("That game was postponed or canceled: there is nothing to open.")
    order = espn_sides(game, sides)
    try:
        track = tracks.load_track(data_dir, event_id, order)
    except ValueError as ex:                   # the app's own file, not the request: a 500 that says which
        raise SwitchError(f"That game's saved tracks can't be read ({ex}).", 500) from ex
    is_new = track is None
    if is_new:
        named = callers_of(games.callers_for(event_id), order, index)
        track = tracks.make_track(event_id, order, line_configs(games, event_id, order), named)
    models = load_models(track, load_caller)
    summary = load_game(event_id)
    is_live = playback.is_live(playback.game_of(summary))
    espn_feed.check_summary(summary, live=is_live)
    about = {"label": track.game.get("label"), "away": game["away"]["abbr"], "home": game["home"]["abbr"]}
    return Plan(track, about, models, summary, is_live, is_new)


def espn_sides(game: Mapping, sides: Sequence[str]) -> tuple[str, ...]:
    """The sides as ESPN names them (the feed matches on those; nflverse's LA is LAR), away then home. ValueError for
    a team that isn't playing."""
    teams = {s: game[s]["abbr"] for s in ("away", "home")}
    found = []
    for side in sides:
        hit = next((abbr for abbr in teams.values() if espn_feed.same_team(side, abbr)), None)
        if hit is None:
            raise ValueError(f"{side} isn't playing in "
                             f"{tracks.matchup_text(teams['away'], teams['home'], game.get('neutral'))}.")
        found.append(hit)
    if len(set(found)) != len(found):
        raise ValueError(tracks.SIDES_HELP)
    return tuple(t for t in teams.values() if t in found)


def callers_of(table: Mapping, sides: Sequence[str], index: Sequence[Mapping]) -> dict:
    """{side: {name, slug}} for each side's play-caller that week. SwitchError (409) when the table names nobody, or
    the models' index has no built model of him (its reason when it says one)."""
    out = {}
    for side in sides:
        row = table.get(side)
        if not row:
            raise SwitchError(f"{side}'s play-caller isn't in the play-caller table yet, so there is no model to "
                              "shadow.")
        name = row["name"]
        entry = next((c for c in index if c.get("name") == name), None)
        if entry is None:
            raise SwitchError(f"No model for {side}'s play-caller ({name}) yet: scripts/build_callers.py hasn't "
                              "built one.")
        if entry.get("status") != "built" or not callers.is_slug(entry.get("slug")):
            why = entry.get("reason") or entry.get("error") or f"his model is {entry.get('status') or 'missing'}."
            raise SwitchError(f"No model for {side}'s play-caller ({name}) yet: {why}")
        out[side] = {"name": name, "slug": entry["slug"]}
    return out


_built: tuple = (None, frozenset())     # (the models' index's mtime, the callers it has a built model of)


def has_built_model(name: str) -> bool:
    """Whether `name` (as the play-caller table spells him) has a built model: the picker's has_model hook
    (game-picker.md 5.7). The index is read again only when it changes: the listing asks for every side of every game.
    An index that can't be read means no models (logged once per change)."""
    global _built
    try:
        stamp = (callers.CALLERS_DIR / callers.INDEX_FILE).stat().st_mtime_ns
    except OSError:
        stamp = None
    seen = _built
    if stamp != seen[0]:
        try:
            names = frozenset(c.get("name") for c in callers.list_callers()) if stamp else frozenset()
        except ValueError as ex:
            log.warning("The play-caller models' index can't be read (%s): no game shows a model.", ex)
            names = frozenset()
        seen = _built = (stamp, names)
    return name in seen[1]


def line_configs(games, event_id: str, sides: Sequence[str]) -> dict:
    """config.GAME from each side (games.Games.game_config). SwitchError (409) with its note when there is no line:
    the engine needs the spread and the total, and a line is never guessed."""
    configs = {s: games.game_config(event_id, s) for s in sides}
    for c in configs.values():
        if c["offense_spread"] is None or c["total_line"] is None:
            raise SwitchError(c.get("line_note") or "No betting line for that game yet.")
    return configs


def load_models(track: tracks.Track, load_caller: Callable) -> dict:
    """Each side's bundle ({} on the default model). SwitchError (409) with the reason when one won't load."""
    if track.model == "default":
        return {}
    try:
        return {s: load_caller(track.callers[s]["slug"]) for s in track.sides}
    except (callers.CallerNotFound, callers.ModelVersionError, ValueError) as ex:
        raise SwitchError(f"Can't load the play-caller model for that game: {ex}") from ex


# ---------------------------------------------------------------- the switch (under LOCK)
def engine_args(models: Mapping) -> dict:
    """GameEngine's (and its reload's) arguments for a track's models: none for models/, one caller's bundle, or one
    per side, away then home (play-caller-models.md 7)."""
    if not models:
        return {}
    if len(models) == 1:
        return {"caller": next(iter(models.values()))}
    return {"callers": dict(models)}


def sides_of(track: tracks.Track, models: Mapping) -> tuple:
    """The engine's sides for the track (live.sides_for on its config: models/ is read here on the default model),
    made before the game on screen is left. SwitchError (409) with the reason when a model won't load."""
    try:
        return live.sides_for(track.config(), **engine_args(models))
    except LOAD_ERRORS as ex:
        raise SwitchError(f"Can't load the play-caller model for that game: {ex}") from ex


def failed(ex: Exception) -> Exception:
    """What a failed switch answers: the error itself when it says what was wrong (SwitchError, WatchError,
    ValueError), else a 500 that says the game on screen is still open."""
    if isinstance(ex, (SwitchError, watch.WatchError, ValueError)):
        return ex
    return SwitchError(f"Couldn't switch to that game ({ex}); the game you were on is still open.", 500)


@dataclass(frozen=True)
class Kept:
    """What a switch changes, as it was before: put back when the switch fails."""
    paths: tuple
    game: dict
    event_id: str | None
    summary: object
    team_ids: dict
    status: dict
    feed_on: bool
    track: tracks.Track | None
    models: dict
    sides: tuple                   # the engine's sides (live_sides.Side): put back with no model load at all
    undo: tuple                    # its undo steps and their floor (GameEngine.history_kept)
    index: bytes | None
    had_games: bool


class Switch:
    """The track on screen and the switch between tracks, over the app's own parts: its LOCK, config.GAME, the feed
    (whose engine reloads in place) and the Watch. open_game(event_id, summary, live) opens the game under LOCK the way
    POST /api/open does. track is None while the app runs on DATA_DIR itself (no index.json yet), as before phase 2;
    models are the track's bundles ({} on models/)."""

    def __init__(self, data_dir: Path | str, *, lock, game: dict, feed, watch, open_game: Callable,
                 track: tracks.Track | None = None, models: Mapping | None = None):
        self.data_dir, self.lock, self.game, self.feed, self.watch = Path(data_dir), lock, game, feed, watch
        self._open = open_game
        self.track, self.models = track, dict(models or {})

    def select(self, plan: Plan) -> bool:
        """Switch to the plan's track and open it. False when it is the track on screen already (nothing changes).
        SwitchError, WatchError or ValueError when it fails, after everything was put back."""
        with self.lock:
            if self.track is not None and (self.track.event_id, self.track.key) == (plan.track.event_id,
                                                                                    plan.track.key):
                return False
            kept = self._kept()
            made, sides = self._ready(plan, kept)
            parked = None
            try:
                parked = self._leave()
                self._enter(plan.track, plan.models, sides)
                tracks.set_current(self.data_dir, plan.track)
                self._open(plan.track.event_id, plan.summary, plan.live)
            except Exception as ex:
                log.warning("Switching to %s %s failed; putting the game on screen back", plan.track.event_id,
                            plan.track.key, exc_info=True)
                self._put_back(kept, plan.track, made, parked)
                err = failed(ex)
                if err is ex:
                    raise
                raise err from ex
            self.watch.end_parked(parked)          # nothing can fail now: the old session ends keeping its game
        return True

    def _ready(self, plan: Plan, kept: Kept) -> tuple[bool, tuple]:
        """The new track made ready while the game on screen stays as it is: its entry in game.json (its line frozen)
        and its models, loaded. (whether the entry is new, the engine's sides). A failure leaves the game on screen
        untouched and takes back the entry it made."""
        made = False
        try:
            made = tracks.save_track(self.data_dir, plan.track, plan.about)
            return made, sides_of(plan.track, plan.models)
        except Exception as ex:
            log.warning("Getting %s %s ready failed; the game on screen was never left", plan.track.event_id,
                        plan.track.key, exc_info=True)
            if made:
                attempt("remove the half-made track", lambda: drop_track(self.data_dir, plan.track))
            if not kept.had_games:
                attempt("remove the games folder", lambda: rmdir_empty(tracks.games_dir(self.data_dir)))
            err = failed(ex)
            if err is ex:
                raise
            raise err from ex

    def _kept(self) -> Kept:
        feed, index = self.feed, tracks.games_dir(self.data_dir) / tracks.INDEX_FILE
        return Kept((live.STATE_PATH, espn_feed.SEEN_PATH), copy.deepcopy(dict(self.game)), feed.event_id,
                    feed.summary, dict(feed.team_ids), dict(feed.status), feed.on, self.track, dict(self.models),
                    tuple(feed.engine.models.values()), feed.engine.history_kept(),
                    index.read_bytes() if index.exists() else None, tracks.games_dir(self.data_dir).exists())

    def _leave(self):
        """The game on screen stops changing: the feed off (a poll in flight lands nowhere), the session stepped aside
        (Watch.leave). Returns the parked session (None without one)."""
        self.feed.stop()
        self.feed.invalidate()
        return self.watch.leave()

    def _enter(self, track: tracks.Track, models: Mapping, sides: tuple) -> None:
        point_at(self.data_dir, track, self.game)
        try:
            self.feed.engine.reload(sides=sides)
        except LOAD_ERRORS as ex:
            raise SwitchError(f"Can't load the play-caller model for that game: {ex}") from ex
        self._show(track.event_id, None)
        self.track, self.models = track, dict(models)

    def _show(self, event_id: str | None, summary: object) -> None:
        """The feed on event_id's applied ids and summary (the engine's game just reloaded), the Watch on the track's
        session file."""
        feed = self.feed
        feed.event_id, feed.team_ids = event_id, {}
        feed.reload_seen()
        feed.event_id = event_id
        feed.summary = summary
        if summary is None:
            feed.load_summary()
        feed.status.update(state="off", detail="", last_poll=None, last_play=None, plays_logged=0, skipped=None)
        self.watch.enter()

    def _put_back(self, kept: Kept, track: tracks.Track, made: bool, parked) -> None:
        """Everything as it was before the switch, the old session too: back where it stood, with its restore point
        (Watch.come_back). The steps that touch files are tried one by one, so one that fails never stops the rest (the
        server log says what)."""
        attempt("stop the feed", self.feed.stop)
        attempt("end the new session", lambda: self._end_session(restore=not made))
        live.STATE_PATH, espn_feed.SEEN_PATH = kept.paths
        self.game.clear()
        self.game.update(kept.game)
        attempt("reload the game on screen", lambda: self._reload_kept(kept))
        self._show(kept.event_id, kept.summary)
        attempt("bring its watch session back", lambda: self.watch.come_back(parked))
        self.feed.team_ids = kept.team_ids
        self.feed.status.update(kept.status)
        self.track, self.models = kept.track, kept.models
        attempt("put index.json back", lambda: restore_index(self.data_dir, kept.index))
        if made:
            attempt("remove the half-made track", lambda: drop_track(self.data_dir, track))
        if not kept.had_games:
            attempt("remove the games folder", lambda: rmdir_empty(tracks.games_dir(self.data_dir)))
        if kept.feed_on:
            attempt("turn the live feed back on", lambda: self.feed.start(kept.event_id))

    def _reload_kept(self, kept: Kept) -> None:
        """The engine back on the game on screen: its models as they were (nothing loaded), its game from its file,
        its undo steps."""
        engine = self.feed.engine
        engine.reload(sides=kept.sides)
        engine.restore_history(kept.undo)

    def _end_session(self, restore: bool) -> None:
        """A session the failed open started: its game put back from its backup on a track made before (restore),
        else stepped aside (its file stays in its folder; a track this switch made goes with its folder)."""
        if restore and self.watch.in_session():
            try:
                self.watch.stop(restore=True)
                return
            except Exception:
                log.warning("Couldn't put the track's game back after a failed switch", exc_info=True)
        self.watch.leave()


def attempt(what: str, step: Callable) -> None:
    try:
        step()
    except Exception:
        log.exception("Putting the game back after a failed switch: couldn't %s", what)


def restore_index(data_dir: Path, kept: bytes | None) -> None:
    path = tracks.games_dir(data_dir) / tracks.INDEX_FILE
    now = path.read_bytes() if path.exists() else None
    if now == kept:
        return
    if kept is None:
        path.unlink()
    else:
        tracks.write_bytes_whole(path, kept)


def drop_track(data_dir: Path, track: tracks.Track) -> None:
    """A track this switch made: its folder (everything in it came from this switch) and its game.json entry."""
    folder = tracks.track_dir(data_dir, track.event_id, track.sides)
    if folder.is_dir():
        shutil.rmtree(folder)
    tracks.forget_track(data_dir, track)


def rmdir_empty(folder: Path) -> None:
    if folder.is_dir() and not any(folder.iterdir()):
        folder.rmdir()


# ---------------------------------------------------------------- the start
def point_at(data_dir: Path | str, track: tracks.Track, game: dict) -> None:
    """The track's folder holds the game: live.STATE_PATH and espn_feed.SEEN_PATH point there (the watch's session
    file and backups follow them), and config.GAME is its config, set in place (every module holds that one dict)."""
    state, seen = tracks.state_paths(data_dir, track)
    state.parent.mkdir(parents=True, exist_ok=True)
    live.STATE_PATH, espn_feed.SEEN_PATH = state, seen
    game.clear()
    game.update(track.config())


def startup(data_dir: Path | str, game: dict, caller_name: str, *, adopting: bool) -> tracks.Track | None:
    """Before the engine is made: today's game adopted when it hasn't been (adopting: only the server's own start, app.py
    run as a script; an import of the app never copies anything), then the track index.json names opened (paths and
    config.GAME). None without an index: the app runs on DATA_DIR as before. SystemExit when the index can't be read:
    the app never guesses which game to write to."""
    if adopting:
        outcome = adopt.adopt(data_dir, game, caller_name)
        log.log(logging.INFO if outcome.adopted or outcome.quiet else logging.WARNING, "%s", outcome.message)
    try:
        track = tracks.current(data_dir)
    except ValueError as ex:
        raise SystemExit(f"Can't open the current game: {ex} Move {tracks.games_dir(data_dir) / tracks.INDEX_FILE} "
                         "aside to start on the data folder again.") from ex
    if track is not None:
        point_at(data_dir, track, game)
    return track

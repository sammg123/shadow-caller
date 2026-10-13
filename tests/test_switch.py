"""Picking a game (switch.py; docs/design/game-picker.md 4, restructure-v2.md 11): POST /api/game/select's validation,
the plan made before the lock (the game, each side's play-caller and model, the line), and the switch under it, with
the app's real engine, feed and Watch on a temp data folder. A track's line is frozen when it is made; switching back
and forth never touches another track's files or the old data/ files; any failure puts everything back. The engine
is the real one, reloading in place on the real bundles in models/callers (each loaded once here)."""
import copy
import hashlib
import json
import os
import shutil
import threading

import pytest

import callers
import config
import espn_feed
import games
import live
import live_sides
import switch
import tracks
import watch
from helpers import ESPN_FILE, TEST_GAME
from test_games import PHI_JAX, TB_DAL, Clock, FakeESPN, board
from test_games_config import SCHEDULE, schedule, summaries

TABLE = ("season,team,first_week,last_week,play_caller,role,source\n"
         "2026,DAL,1,22,Brian Schottenheimer,HC,a\n2026,TB,1,22,Zac Robinson,OC,b\n"
         "2026,PHI,1,22,Sean Mannion,OC,c\n2026,LA,1,22,Sean McVay,HC,d\n")
SKIPPED = "Only 4 games (228 snaps) in the data; a model needs at least 5 games and 200 snaps."
INDEX = [{"name": "Brian Schottenheimer", "slug": "brian-schottenheimer", "status": "built"},
         {"name": "Zac Robinson", "slug": "zac-robinson", "status": "built"},
         {"name": "Sean McVay", "slug": "sean-mcvay", "status": "built"},
         {"name": "Sean Mannion", "slug": "sean-mannion", "status": "skipped", "reason": SKIPPED}]
BUF_LAR = "401872994"


BUNDLES = {}


def fake_load(slug):
    """callers.load_caller over the real bundles, each loaded once (about half a second each)."""
    entry = next((c for c in INDEX if c["slug"] == slug and c["status"] == "built"), None)
    if entry is None:
        raise callers.CallerNotFound(f"No complete model for '{slug}'.")
    if slug not in BUNDLES:
        BUNDLES[slug] = callers.load_caller(slug)
    return BUNDLES[slug]


def saved_game(event_id):
    return json.loads(ESPN_FILE.read_text())


def digests(folder):
    return {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file()}


class Rig:
    """The app's parts on a temp data folder: the engine on screen, the feed, the Watch and the switch."""

    def __init__(self, data, service):
        self.data, self.service, self.lock = data, service, threading.RLock()
        self.engine = live.GameEngine()
        self.feed = espn_feed.Feed(self.engine, self.lock)
        self.watch = watch.Watch(self.feed, self.lock, pace_scale=0.001)
        self.fail_open = self.after_open = None
        self.switch = switch.Switch(data, lock=self.lock, game=config.GAME, feed=self.feed, watch=self.watch,
                                    open_game=self.open_game)

    def open_game(self, event_id, summary, is_live):
        """app.show_game for a finished game: paused at kickoff unless a session is on."""
        if self.fail_open:
            raise self.fail_open
        if not (self.watch.in_session() or self.feed.on):
            self.watch.seek(0, event_id, summary)
        if self.after_open:
            raise self.after_open

    def plan(self, event_id, sides, **kw):
        kw.setdefault("index", INDEX)
        return switch.plan_select(event_id, sides, data_dir=self.data, games=self.service, load_caller=fake_load,
                                  load_game=saved_game, **kw)

    def select(self, event_id, sides):
        return self.switch.select(self.plan(event_id, sides))


@pytest.fixture
def rig(tmp_path, monkeypatch):
    data = tmp_path / "data"
    (data / "espn").mkdir(parents=True)
    shutil.copy(ESPN_FILE, data / "espn" / ESPN_FILE.name)
    (data / "play_callers_2024_2026.csv").write_text(TABLE)
    monkeypatch.setattr(live, "STATE_PATH", data / "live_state.json")
    monkeypatch.setattr(live, "DB_PATH", data / "shadow.duckdb")
    monkeypatch.setattr(espn_feed, "SEEN_PATH", data / "feed_seen.json")
    monkeypatch.setattr(espn_feed, "RAW_DIR", data / "espn")
    saved = copy.deepcopy(config.GAME)
    config.GAME.clear()
    config.GAME.update(TEST_GAME)
    service = games.Games(data, fetch_json=FakeESPN(), clock=Clock(), load_schedule=schedule(),
                          fetch_summary=summaries({}))
    r = Rig(data, service)
    yield r
    r.watch.stop() if r.watch.in_session() else None
    r.watch.join(5)
    config.GAME.clear()
    config.GAME.update(saved)


# ---------------------------------------------------------------- the body
@pytest.mark.parametrize("body", [{"event_id": TB_DAL, "sides": ["DAL"]}, {"sides": ["TB", "DAL"], "event_id": TB_DAL}])
def test_a_select_body_is_an_event_and_one_or_two_sides(body):
    assert switch.parse_select(body) == (TB_DAL, tuple(body["sides"]))


@pytest.mark.parametrize("body, says", [
    (None, "JSON object"), ([], "JSON object"), ({"event_id": TB_DAL}, "sides"), ({"sides": ["DAL"]}, "event_id"),
    ({"event_id": TB_DAL, "sides": ["DAL"], "speed": 2}, "Unknown field"), ({"event_id": 401872980, "sides": ["DAL"]},
                                                                             "digits"),
    ({"event_id": "40187298x", "sides": ["DAL"]}, "digits"), ({"event_id": "", "sides": ["DAL"]}, "digits"),
    ({"event_id": TB_DAL, "sides": "DAL"}, "list"), ({"event_id": TB_DAL, "sides": []}, "list"),
    ({"event_id": TB_DAL, "sides": ["DAL", "DAL"]}, "different"),
    ({"event_id": TB_DAL, "sides": ["A", "B", "C"]}, "two"),
    ({"event_id": TB_DAL, "sides": [1]}, "abbreviations"), ({"event_id": TB_DAL, "sides": ["dal"]}, "abbreviations"),
    ({"event_id": TB_DAL, "sides": ["../x"]}, "abbreviations"),
    ({"event_id": TB_DAL, "sides": [{"team": "DAL"}]}, "abbreviations"),
    ({"event_id": TB_DAL, "sides": [["DAL"], "TB"]}, "abbreviations")])
def test_anything_else_is_refused_with_the_reason(body, says):
    with pytest.raises(ValueError) as err:
        switch.parse_select(body)
    assert says in str(err.value)


# ---------------------------------------------------------------- the plan (no lock): the game, the callers, the line
def test_a_new_track_takes_each_sides_play_caller_and_todays_line(rig):
    plan = rig.plan(TB_DAL, ["DAL"])
    assert (plan.track.key, plan.track.model, plan.is_new) == ("DAL", "callers", True)
    assert dict(plan.track.callers["DAL"]) == {"name": "Brian Schottenheimer", "slug": "brian-schottenheimer"}
    assert (plan.track.game["offense_spread"], plan.track.game["total_line"]) == (9.5, 49.5)
    assert set(plan.models) == {"DAL"} and plan.models["DAL"].slug == "brian-schottenheimer"
    assert plan.live is False and plan.summary["header"]


def test_both_sides_go_away_then_home_and_load_both_models(rig):
    plan = rig.plan(TB_DAL, ["DAL", "TB"])
    assert plan.track.sides == ("TB", "DAL") and plan.track.key == "DAL+TB"
    assert {t: m.slug for t, m in plan.models.items()} == {"TB": "zac-robinson", "DAL": "brian-schottenheimer"}


def test_a_side_is_named_as_espn_names_it(rig):
    """nflverse's spelling of a team picks ESPN's (the feed matches on ESPN's abbreviations): LA is LAR."""
    plan = rig.plan(BUF_LAR, ["LA"])
    assert plan.track.sides == ("LAR",) and plan.track.game["offense"] == "LAR"
    assert dict(plan.track.callers["LAR"]) == {"name": "Sean McVay", "slug": "sean-mcvay"}


def test_a_team_that_isnt_playing_is_a_400(rig):
    with pytest.raises(ValueError) as err:
        rig.plan(TB_DAL, ["PHI"])
    assert str(err.value) == "PHI isn't playing in TB at DAL."
    with pytest.raises(ValueError) as err:
        rig.plan(PHI_JAX, ["DAL"])
    assert str(err.value) == "DAL isn't playing in PHI vs JAX.", "London: a neutral site says vs"


def test_a_side_without_a_built_model_is_refused_with_the_indexs_reason(rig):
    with pytest.raises(switch.SwitchError) as err:
        rig.plan(PHI_JAX, ["PHI"])
    assert err.value.status == 409 and "Sean Mannion" in str(err.value) and SKIPPED in str(err.value)


def test_a_side_nobody_in_the_table_calls_for_is_refused(rig):
    with pytest.raises(switch.SwitchError) as err:
        rig.plan(PHI_JAX, ["JAX"])
    assert err.value.status == 409 and "play-caller table" in str(err.value)


def test_a_caller_the_index_doesnt_know_is_refused(rig):
    with pytest.raises(switch.SwitchError) as err:
        rig.plan(TB_DAL, ["DAL"], index=INDEX[1:])
    assert err.value.status == 409 and "Brian Schottenheimer" in str(err.value)


def test_a_model_that_wont_load_is_a_409(rig):
    def broken(slug):
        raise callers.ModelVersionError("built with scikit-learn 1.0")
    with pytest.raises(switch.SwitchError) as err:
        switch.plan_select(TB_DAL, ["DAL"], data_dir=rig.data, games=rig.service, index=INDEX, load_caller=broken,
                           load_game=saved_game)
    assert err.value.status == 409 and "scikit-learn" in str(err.value)


def test_a_game_with_no_line_is_refused_with_the_note(rig):
    rows = [{**r, "spread_line": None, "total_line": None} if r["espn"] == TB_DAL else r for r in SCHEDULE]
    service = games.Games(rig.data, fetch_json=FakeESPN(), clock=Clock(), load_schedule=schedule(rows),
                          fetch_summary=summaries({}))
    with pytest.raises(switch.SwitchError) as err:
        switch.plan_select(TB_DAL, ["DAL"], data_dir=rig.data, games=service, index=INDEX, load_caller=fake_load,
                           load_game=saved_game)
    assert err.value.status == 409 and "No betting line" in str(err.value)


def test_a_postponed_game_has_nothing_to_open(rig):
    week = board(2, 5)
    game = next(e for e in week["events"] if e["id"] == TB_DAL)
    game["competitions"][0]["status"] = {"type": {"name": "STATUS_POSTPONED", "state": "post", "completed": False,
                                                  "shortDetail": "Postponed", "detail": "Postponed"}}
    service = games.Games(rig.data, fetch_json=FakeESPN(answers={(2, 5): week}), clock=Clock(),
                          load_schedule=schedule(), fetch_summary=summaries({}))
    with pytest.raises(switch.SwitchError) as err:
        switch.plan_select(TB_DAL, ["DAL"], data_dir=rig.data, games=service, index=INDEX, load_caller=fake_load,
                           load_game=saved_game)
    assert err.value.status == 409 and "postponed" in str(err.value)


def test_two_spellings_of_one_team_are_one_side(rig):
    with pytest.raises(ValueError):
        rig.plan(BUF_LAR, ["LA", "LAR"])


def test_a_game_espn_doesnt_list_is_a_404(rig):
    service = games.Games(rig.data, fetch_json=FakeESPN(), clock=Clock(), load_schedule=schedule(),
                          fetch_summary=summaries({"123": {"header": {"season": {"year": 2025}}}}))
    with pytest.raises(games.GamesError) as err:
        switch.plan_select("123", ["DAL"], data_dir=rig.data, games=service, index=INDEX, load_caller=fake_load,
                           load_game=saved_game)
    assert err.value.status == 404


def test_a_saved_game_file_it_cant_read_is_a_500_that_says_so(rig):
    (rig.data / "games" / TB_DAL).mkdir(parents=True)
    (rig.data / "games" / TB_DAL / "game.json").write_text("{cut off")
    with pytest.raises(switch.SwitchError) as err:
        rig.plan(TB_DAL, ["DAL"])
    assert err.value.status == 500 and "game.json" in str(err.value)


# ---------------------------------------------------------------- the switch
def test_selecting_a_game_opens_its_own_track(rig):
    epoch, version = rig.engine.epoch(), rig.engine.version
    assert rig.select(TB_DAL, ["DAL"]) is True
    folder = rig.data / "games" / TB_DAL / "DAL"
    assert live.STATE_PATH == folder / "live_state.json" and espn_feed.SEEN_PATH == folder / "feed_seen.json"
    assert rig.feed.engine is rig.engine and rig.watch.engine is rig.engine, "the app keeps its one engine"
    assert rig.engine.epoch() != epoch and rig.engine.version > version
    assert config.GAME == {**rig.switch.track.config()} and config.GAME["offense_spread"] == 9.5
    assert (rig.feed.event_id, rig.watch.snapshot()["state"], rig.watch.snapshot()["idx"]) == (TB_DAL, "paused", 0)
    assert (folder / "live_state.json").exists() and (folder / "watch_session.json").exists()
    assert tracks.read_index(rig.data)["current"] == {"event_id": TB_DAL, "sides": ["DAL"]}
    assert rig.engine.sides == ("DAL",) and rig.engine.models["DAL"].slug == "brian-schottenheimer"
    assert rig.engine.models["DAL"].profile is fake_load("brian-schottenheimer").profile, "on the track's bundle"


def test_the_data_folders_own_game_files_are_never_written_after_a_switch(rig):
    rig.watch.seek(40, TB_DAL, saved_game(TB_DAL))                 # a game on data/, as before phase 2
    rig.watch.stop()
    old = {n: (rig.data / n).read_bytes() for n in ("live_state.json", "feed_seen.json")}
    rig.select(TB_DAL, ["DAL"])
    rig.watch.seek(60, TB_DAL, saved_game(TB_DAL))
    rig.select(TB_DAL, ["TB", "DAL"])
    rig.watch.seek(20, TB_DAL, saved_game(TB_DAL))
    assert {n: (rig.data / n).read_bytes() for n in old} == old
    assert not (rig.data / "watch_session.json").exists()


def test_a_tracks_line_is_frozen_when_it_is_first_made(rig):
    rig.select(TB_DAL, ["DAL"])
    moved = [{**r, "spread_line": 3.0, "total_line": 41.0} if r["espn"] == TB_DAL else r for r in SCHEDULE]
    rig.service = games.Games(rig.data / "elsewhere", fetch_json=FakeESPN(), clock=Clock(),
                              load_schedule=schedule(moved), fetch_summary=summaries({}))
    (rig.data / "elsewhere").mkdir()
    shutil.copy(rig.data / "play_callers_2024_2026.csv", rig.data / "elsewhere")
    rig.select(TB_DAL, ["TB", "DAL"])                                # a new track: today's (moved) line
    assert (config.GAME["offense_spread"], config.GAME["total_line"]) == (3.0, 41.0)
    rig.select(TB_DAL, ["DAL"])                                      # the first track: its frozen line
    assert (config.GAME["offense_spread"], config.GAME["total_line"]) == (9.5, 49.5)


def test_both_sides_share_one_state_with_each_sides_line(rig):
    rig.select(TB_DAL, ["TB", "DAL"])
    assert live.STATE_PATH.parent.name == "DAL+TB"
    assert (config.GAME["sides"], config.GAME["offense"], config.GAME["track"]) == (["TB", "DAL"], "DAL", "DAL+TB")
    assert {s: c["offense_spread"] for s, c in config.GAME["by_side"].items()} == {"TB": -9.5, "DAL": 9.5}
    assert rig.engine.sides == ("TB", "DAL") and rig.engine.state["sides"] == ["TB", "DAL"]


def test_switching_back_and_forth_never_touches_the_other_tracks_files(rig):
    game = saved_game(TB_DAL)
    rig.select(TB_DAL, ["DAL"])
    rig.watch.seek(50, TB_DAL, game)
    dal = rig.data / "games" / TB_DAL / "DAL"
    rig.select(TB_DAL, ["TB", "DAL"])
    kept = digests(dal)
    rig.watch.seek(80, TB_DAL, game)
    rig.watch.forward(TB_DAL, game)
    assert digests(dal) == kept, "DAL's track is never touched while DAL+TB is on screen"
    both = rig.data / "games" / TB_DAL / "DAL+TB"
    rig.select(TB_DAL, ["DAL"])
    kept_both = digests(both)
    rig.watch.seek(10, TB_DAL, game)
    assert digests(both) == kept_both
    assert sorted(json.loads((rig.data / "games" / TB_DAL / "game.json").read_text())["tracks"]) == ["DAL", "DAL+TB"]


def test_a_switch_ends_the_old_session_keeping_its_game(rig):
    rig.select(TB_DAL, ["DAL"])
    rig.watch.seek(30, TB_DAL, saved_game(TB_DAL))
    dal = rig.data / "games" / TB_DAL / "DAL"
    rig.select(TB_DAL, ["TB", "DAL"])
    assert not (dal / "watch_session.json").exists()
    assert len(json.loads((dal / "feed_seen.json").read_text())["2026_05_TB_DAL"]) == 30
    rig.select(TB_DAL, ["DAL"])                     # opened again at kickoff: the game at play 30 is backed up first
    rig.select(TB_DAL, ["TB", "DAL"])
    kept = list(dal.glob("live_state.backup-*.json"))
    assert len(kept) == 1 and len(json.loads(kept[0].read_text())["log"]) > 0, "its backup stays in its own folder"
    for key in ("DAL", "DAL+TB"):
        for backup in (rig.data / "games" / TB_DAL / key).glob("live_state.backup-*.json"):
            assert json.loads(backup.read_text())["game"]["track"] == key, "each folder backs up its own game"


def test_the_track_on_screen_again_changes_nothing(rig):
    rig.select(TB_DAL, ["DAL"])
    rig.watch.seek(12, TB_DAL, saved_game(TB_DAL))
    epoch, engine = rig.engine.epoch(), rig.engine
    assert rig.select(TB_DAL, ["DAL"]) is False
    assert (rig.engine, rig.engine.epoch(), rig.watch.snapshot()["idx"]) == (engine, epoch, 12)


def test_a_track_left_mid_watch_comes_back_with_its_session(rig):
    """A session file a track kept (a restart cut its watch short) comes back as an error session with its restore
    point, the way a restart brings it back."""
    rig.select(TB_DAL, ["DAL"])
    rig.watch.seek(5, TB_DAL, saved_game(TB_DAL))
    session = (live.STATE_PATH.parent / "watch_session.json").read_bytes()
    rig.select(TB_DAL, ["TB", "DAL"])
    (rig.data / "games" / TB_DAL / "DAL" / "watch_session.json").write_bytes(session)
    rig.select(TB_DAL, ["DAL"])
    assert rig.watch.snapshot()["state"] == "error" and "restarted" in rig.watch.snapshot()["error"]


# ---------------------------------------------------------------- never a half switch
def snapshot_of(rig):
    """Everything a switch changes: the paths, GAME, the engine's sides, models and game, the feed, the index."""
    e = rig.engine
    return {"paths": (live.STATE_PATH, espn_feed.SEEN_PATH), "game": copy.deepcopy(dict(config.GAME)),
            "engine": (e.sides, [m.slug for m in e.models.values()], copy.deepcopy(e.state["log"]),
                       e.state["sit"], e.state["mem"]), "feed_engine": rig.feed.engine is e and rig.watch.engine is e,
            "event": rig.feed.event_id, "applied": list(rig.feed.applied), "track": rig.switch.track,
            "index": (rig.data / "games" / "index.json").read_bytes()
            if (rig.data / "games" / "index.json").exists() else None}


@pytest.mark.parametrize("where", ["engine", "open", "index"])
def test_a_switch_that_fails_puts_everything_back(rig, monkeypatch, where):
    rig.select(TB_DAL, ["DAL"])
    rig.watch.seek(25, TB_DAL, saved_game(TB_DAL))
    rig.watch.stop()
    before = snapshot_of(rig)
    dal = digests(rig.data / "games" / TB_DAL / "DAL")
    if where == "engine":
        real = rig.engine.reload
        calls = []

        def broken_once(**kw):                    # the new track's models fail; putting the old one back works
            calls.append(kw)
            if len(calls) == 1:
                raise RuntimeError("bundle broken")
            return real(**kw)
        monkeypatch.setattr(rig.engine, "reload", broken_once)
    elif where == "open":
        rig.fail_open = watch.WatchError("ESPN game 401872980 has no plays yet.", 400)
    else:
        monkeypatch.setattr(switch.tracks, "set_current", lambda *_: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(Exception) as err:
        rig.select(TB_DAL, ["TB", "DAL"])
    assert getattr(err.value, "status", None) in (400, 409, 500)
    assert snapshot_of(rig) == before
    assert digests(rig.data / "games" / TB_DAL / "DAL") == dal
    assert not (rig.data / "games" / TB_DAL / "DAL+TB").exists(), "the half-made track is gone"
    assert list(json.loads((rig.data / "games" / TB_DAL / "game.json").read_text())["tracks"]) == ["DAL"]
    assert rig.engine.epoch() != "" and rig.watch.engine is rig.engine


def test_a_failed_open_puts_an_existing_tracks_game_back(rig):
    """The open had backed the track's game up and reset it when something broke: the game is put back from that
    backup, so a failed switch never costs a track its game."""
    game = saved_game(TB_DAL)
    rig.select(TB_DAL, ["DAL"])
    rig.watch.seek(30, TB_DAL, game)
    rig.select(TB_DAL, ["TB", "DAL"])
    dal = rig.data / "games" / TB_DAL / "DAL"

    def the_game():
        s = json.loads((dal / "live_state.json").read_text())
        return {k: s[k] for k in ("log", "sit", "mem", "drive_n", "drive_active")}
    kept = the_game()
    rig.after_open = RuntimeError("the page's open broke")
    with pytest.raises(switch.SwitchError) as err:
        rig.select(TB_DAL, ["DAL"])
    assert err.value.status == 500
    assert the_game() == kept and len(kept["log"]) > 0 and not (dal / "watch_session.json").exists()
    assert rig.switch.track.key == "DAL+TB" and live.STATE_PATH.parent.name == "DAL+TB"


def test_a_model_that_wont_load_at_the_switch_is_a_409_and_changes_nothing(rig, monkeypatch):
    rig.select(TB_DAL, ["DAL"])
    before = snapshot_of(rig)
    real, calls = rig.engine.reload, []

    def stale(**kw):
        calls.append(kw)
        if len(calls) == 1:
            raise callers.ModelVersionError("built with another scikit-learn")
        return real(**kw)
    monkeypatch.setattr(rig.engine, "reload", stale)
    with pytest.raises(switch.SwitchError) as err:
        rig.select(TB_DAL, ["TB", "DAL"])
    assert err.value.status == 409 and "scikit-learn" in str(err.value)
    assert snapshot_of(rig) == before


# ---------------------------------------------------------------- a failed pick leaves the old track exactly as it was
def session_of(rig):
    """The session on screen as Reset and Stop see it: its state, where it stands, its restore point, its file."""
    w = rig.watch.snapshot()
    path = live.STATE_PATH.with_name("watch_session.json")
    return {"state": w["state"], "idx": w["idx"], "event": w["event_id"], "backup": w["backup"],
            "file": path.read_bytes() if path.exists() else None, "folder": path.parent.name}


def watching_both_sides(rig):
    """The adopted game (models/, the way Sam graded it), then both sides picked and watched: a session paused at play
    30 whose restore point is the both-sides game at kickoff, backed up in its own folder."""
    live.GameEngine()._save()                                          # a game on data/, as before phase 2
    rig.switch.track = switch.startup(rig.data, config.GAME, "Brian Schottenheimer", adopting=True)
    rig.engine.reload()
    rig.select(TB_DAL, ["TB", "DAL"])
    rig.watch.stop()                                                   # its game at kickoff stays, saved
    rig.watch.seek(20, TB_DAL, saved_game(TB_DAL))                     # a new session backs that game up first
    rig.watch.seek(30, TB_DAL, saved_game(TB_DAL))
    now = session_of(rig)
    assert (now["state"], now["idx"], now["folder"]) == ("paused", 30, "DAL+TB") and now["file"]
    assert (live.STATE_PATH.parent / now["backup"]["state"]).is_file(), "a real restore point"
    return now


def sandboxed(rig):
    """Every path the game writes is still the temp data folder's (never data/)."""
    for path in (live.STATE_PATH, live.DB_PATH, espn_feed.SEEN_PATH, espn_feed.RAW_DIR):
        assert rig.data in path.parents, f"{path} is outside the temp data folder"


def can_reset_and_stop(rig, before):
    """Reset (a seek to 0) keeps the session's restore point; Stop puts the game from before the watch back."""
    sandboxed(rig)
    rig.watch.seek(0, TB_DAL, saved_game(TB_DAL))
    w = rig.watch.snapshot()
    assert (w["state"], w["idx"], w["backup"]) == ("paused", 0, before["backup"])
    rig.watch.stop(restore=True)
    assert rig.watch.snapshot()["state"] == "stopped" and not live.STATE_PATH.with_name("watch_session.json").exists()
    assert rig.engine.state["log"] == [] and rig.engine.state["sides"] == ["TB", "DAL"], "the game at kickoff"


def test_a_pick_whose_model_wont_load_keeps_the_session_and_its_restore_point(rig):
    """Back to the adopted game when models/ no longer loads (rebuilt with another scikit-learn): the model is loaded
    before the game on screen is left, so the pick is a 409 and nothing was left: the session, its file and its
    restore point stay, and Reset and Stop work."""
    before = watching_both_sides(rig)
    shown = snapshot_of(rig)

    def stale(team, model_dir):
        raise callers.ModelVersionError("built with scikit-learn 1.0")
    with pytest.MonkeyPatch.context() as mp:        # its own patch only: the rig's temp paths stay patched
        mp.setattr(live_sides, "default_side", stale)
        with pytest.raises(switch.SwitchError) as err:
            rig.select(TB_DAL, ["DAL"])
    assert err.value.status == 409 and "scikit-learn" in str(err.value)
    assert session_of(rig) == before and snapshot_of(rig) == shown
    can_reset_and_stop(rig, before)


@pytest.mark.parametrize("where", ["before_open", "after_open"])
def test_a_pick_that_fails_after_leaving_brings_the_session_back(rig, where):
    """The open breaks after the game on screen was left (before the new game's session started, or after): the old
    session comes back exactly where it stood, with its file and its restore point; Reset and Stop work."""
    before = watching_both_sides(rig)
    shown = snapshot_of(rig)
    if where == "before_open":
        rig.fail_open = OSError("disk full")
    else:
        rig.after_open = RuntimeError("the page's open broke")
    with pytest.raises(switch.SwitchError):
        rig.select(TB_DAL, ["DAL"])
    assert session_of(rig) == before and snapshot_of(rig) == shown
    can_reset_and_stop(rig, before)


def test_a_failed_pick_keeps_the_games_undo_steps(rig):
    """A game typed on its track keeps its undo steps through a pick that fails after leaving it."""
    rig.select(TB_DAL, ["DAL"])
    rig.watch.stop()                                                   # the game at kickoff, no session
    rig.engine.new_drive(75)
    rig.engine.record_play(None, 3, leaf="run_inside")
    steps = len(rig.engine.history)
    assert steps == 2
    rig.fail_open = OSError("disk full")
    with pytest.raises(switch.SwitchError):
        rig.select(TB_DAL, ["TB", "DAL"])
    assert len(rig.engine.history) == steps
    sandboxed(rig)
    rig.engine.undo()
    assert rig.engine.state["log"] == [] and rig.engine.state["drive_active"] is True


def test_a_playing_session_plays_on_after_a_failed_pick(rig):
    """Playing when the pick failed: it comes back playing, on its own thread, and plays to the end of the game with
    the restore point it had."""
    before = watching_both_sides(rig)
    rig.watch.resume()
    rig.fail_open = OSError("disk full")
    with pytest.raises(switch.SwitchError):
        rig.select(TB_DAL, ["DAL"])
    assert rig.watch.join(10) or rig.watch.snapshot()["state"] == "done"
    w = rig.watch.snapshot()
    assert (w["state"], w["idx"], w["total"], w["backup"]) == ("done", 183, 183, before["backup"])
    assert session_of(rig)["file"] == before["file"], "its session file, as it was"


def test_a_pick_that_goes_through_ends_the_old_session_and_only_then(rig):
    """The old session's file goes once the new game is open, not before: a switch that went through leaves no session
    behind in the old folder, and the old game stays as it was on screen (Go Live's way)."""
    before = watching_both_sides(rig)
    rig.select(TB_DAL, ["DAL"])
    both = rig.data / "games" / TB_DAL / "DAL+TB"
    assert not (both / "watch_session.json").exists() and (both / before["backup"]["state"]).is_file()
    assert len(json.loads((both / "feed_seen.json").read_text())["2026_05_TB_DAL"]) == 30


def test_the_live_feed_comes_back_on_after_a_failed_switch(rig, monkeypatch):
    rig.select(TB_DAL, ["DAL"])
    started = []
    monkeypatch.setattr(rig.feed, "start", lambda event_id=None: started.append(event_id))
    rig.feed.on = True                                    # following the game live (no poll thread here)
    rig.fail_open = OSError("disk full")
    with pytest.raises(switch.SwitchError):
        rig.select(TB_DAL, ["TB", "DAL"])
    assert started == [TB_DAL]


def test_a_failed_first_switch_leaves_the_data_folder_as_it_was(rig):
    rig.watch.seek(10, TB_DAL, saved_game(TB_DAL))
    rig.watch.stop()
    before = snapshot_of(rig)
    files = {n: h for n, h in digests(rig.data).items() if "/" not in n}      # the game's own files (no caches)
    rig.fail_open = OSError("disk full")
    with pytest.raises(Exception):
        rig.select(TB_DAL, ["DAL"])
    assert snapshot_of(rig) == before
    assert {n: h for n, h in digests(rig.data).items() if "/" not in n} == files
    assert not (rig.data / "games").exists()


def test_a_failed_switch_back_to_an_existing_track_keeps_it(rig):
    rig.select(TB_DAL, ["DAL"])
    rig.select(TB_DAL, ["TB", "DAL"])
    rig.fail_open = RuntimeError("boom")
    with pytest.raises(switch.SwitchError) as err:
        rig.select(TB_DAL, ["DAL"])
    assert err.value.status == 500 and "boom" in str(err.value)
    assert (rig.data / "games" / TB_DAL / "DAL" / "live_state.json").exists(), "a track made before stays"
    assert rig.switch.track.key == "DAL+TB" and live.STATE_PATH.parent.name == "DAL+TB"


# ---------------------------------------------------------------- a restart opens the current track
def test_a_restart_opens_the_track_index_json_names(rig):
    rig.select(TB_DAL, ["TB", "DAL"])
    for k in list(config.GAME):
        config.GAME[k] = None
    track = switch.startup(rig.data, config.GAME, "Brian Schottenheimer", adopting=True)
    assert track.key == "DAL+TB" and config.GAME == track.config()
    assert live.STATE_PATH == rig.data / "games" / TB_DAL / "DAL+TB" / "live_state.json"
    assert espn_feed.SEEN_PATH == live.STATE_PATH.with_name("feed_seen.json")


def test_a_first_start_adopts_todays_game_then_opens_it(rig):
    state = live.GameEngine()
    state._save()                                                      # a game on data/, as before phase 2
    track = switch.startup(rig.data, config.GAME, "Brian Schottenheimer", adopting=True)
    assert (track.key, track.model) == ("DAL", "default")
    assert live.STATE_PATH == rig.data / "games" / TB_DAL / "DAL" / "live_state.json"
    assert live.STATE_PATH.read_bytes() == (rig.data / "live_state.json").read_bytes()


def test_a_start_that_isnt_the_servers_never_adopts(rig):
    """Only the server's own start adopts (app.py run as a script: start.sh, scripts/sandbox.py). An import of the app
    (a test, a REPL, a tool) leaves the data folder exactly as it was and runs on it, as before phase 2."""
    live.GameEngine()._save()                                          # a game on data/, as before phase 2
    before, path = digests(rig.data), live.STATE_PATH
    assert switch.startup(rig.data, config.GAME, "Brian Schottenheimer", adopting=False) is None
    assert not (rig.data / "games").exists() and digests(rig.data) == before
    assert live.STATE_PATH == path and config.GAME == TEST_GAME


def test_a_start_that_isnt_the_servers_still_opens_the_current_track(rig):
    rig.select(TB_DAL, ["TB", "DAL"])
    before = digests(rig.data)
    track = switch.startup(rig.data, config.GAME, "Brian Schottenheimer", adopting=False)
    assert track.key == "DAL+TB" and live.STATE_PATH.parent.name == "DAL+TB"
    assert digests(rig.data) == before, "it only reads"


def test_the_adopted_game_keeps_the_model_it_was_graded_with(rig):
    """The adopted track runs on models/ (the Oct 8 build he was graded with, lambda 3), never the bundle rebuilt
    since (lambda 10, which saw this game): opened at a start, and again after another track."""
    live.GameEngine()._save()                                          # a game on data/, as before phase 2
    track = switch.startup(rig.data, config.GAME, "Brian Schottenheimer", adopting=True)
    rig.engine.reload()
    rig.switch.track = track
    assert rig.engine.profile["lambda"] == 3.0
    rig.select(TB_DAL, ["TB", "DAL"])
    assert rig.engine.models["DAL"].profile["lambda"] == 10.0
    rig.select(TB_DAL, ["DAL"])
    assert (rig.switch.track.model, rig.engine.sides, rig.engine.profile["lambda"]) == ("default", ("DAL",), 3.0)
    assert config.GAME["offense_spread"] == 8.5, "the line he graded with"


def test_without_an_index_the_app_stays_on_the_data_folder(rig):
    path = live.STATE_PATH
    assert switch.startup(rig.data, config.GAME, "Brian Schottenheimer", adopting=True) is None
    assert live.STATE_PATH == path and config.GAME == TEST_GAME


def test_an_index_it_cant_read_stops_the_start(rig):
    (rig.data / "games").mkdir()
    (rig.data / "games" / "index.json").write_text("{cut off")
    with pytest.raises(SystemExit) as err:
        switch.startup(rig.data, config.GAME, "Brian Schottenheimer", adopting=False)
    assert "index.json" in str(err.value)


# ---------------------------------------------------------------- the picker's has_model hook
def test_has_built_model_reads_the_index_again_only_when_it_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(callers, "CALLERS_DIR", tmp_path)
    monkeypatch.setattr(switch, "_built", (None, frozenset()))
    index = tmp_path / "index.json"
    assert switch.has_built_model("Brian Schottenheimer") is False, "nothing built yet"
    index.write_text(json.dumps({"callers": INDEX}))
    reads = []
    real = callers.list_callers
    monkeypatch.setattr(callers, "list_callers", lambda *a, **k: reads.append(1) or real(*a, **k))
    assert [switch.has_built_model(n) for n in ("Brian Schottenheimer", "Sean Mannion", "Nobody")] == [
        True, False, False]
    assert len(reads) == 1, "one read for any number of questions"
    index.write_text(json.dumps({"callers": INDEX[1:]}))
    stat = index.stat()
    os.utime(index, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    assert switch.has_built_model("Brian Schottenheimer") is False and len(reads) == 2


def test_an_index_it_cant_read_shows_no_models(tmp_path, monkeypatch):
    monkeypatch.setattr(callers, "CALLERS_DIR", tmp_path)
    monkeypatch.setattr(switch, "_built", (None, frozenset()))
    (tmp_path / "index.json").write_text("{cut off")
    assert switch.has_built_model("Brian Schottenheimer") is False

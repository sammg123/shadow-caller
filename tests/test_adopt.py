"""Adopting today's game into per-game folders (adopt.py; docs/design/game-picker.md 4): copies of a realistic data
folder in a temp dir, never data/. Copy, never move; every copy checked by sha256; index.json written last; any
failure leaves the data folder exactly as it was (and the app on it, as before); a second start never adopts twice."""
import hashlib
import json
import shutil
from pathlib import Path

import pytest

import adopt
import tracks

EVENT, GID = "401872980", "2026_05_TB_DAL"
OTHER_GID = "2026_04_DAL_CHI"
CALLER = "Brian Schottenheimer"
# config.GAME as the app has it: the default game the adoption falls back on for the event
DEFAULT = {"game_id": GID, "label": "Buccaneers at Cowboys, Thursday Night Football, Oct 8", "offense": "DAL",
           "opponent": "TB", "offense_is_home": True, "offense_spread": 8.5, "total_line": 48.5, "espn_event": EVENT}
# the game block Sam's data/live_state.json holds: the line as he graded it, written before config had espn_event
PLAYED = {k: v for k, v in DEFAULT.items() if k != "espn_event"}
ROW = {"seq": 1, "snap": 1, "drive": 1, "qtr": 1, "clock": "14:21", "down": 1, "togo": 10, "yardline_100": 75,
       "p": 0.55, "p_league": 0.52, "p_habits": 0.54, "flag": "no edge", "call": "P", "dropback": 1, "yards": 8,
       "success": 1, "td": False, "turnover": False, "source": "manual"}
STATE_BACKUP, SEEN_BACKUP = "live_state.backup-20261009-211000.json", "feed_seen.json.backup-20261009-211000"


def state_of(game, rows=3):
    return {"game": game, "sit": {"down": 2, "togo": 3, "yardline_100": 10, "qtr": 1, "clock": 600, "score_off": 0,
                                  "score_opp": 0, "clock_estimated": False},
            "drive_active": True, "drive_n": 1, "mem": {"snap_n": rows, "qp": 0.6, "qr": 0.54, "prev": None},
            "log": [{**ROW, "seq": i, "snap": i} for i in range(1, rows + 1)], "message": "2nd & 3 at TB 10."}


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(value if isinstance(value, bytes) else json.dumps(value, indent=1).encode())


def data_folder(root, *, game=PLAYED, seen=False, session=False):
    """A data folder shaped like Sam's: the game file, the play-caller tables, ESPN's saved game, a logo, the DuckDB
    archive; with seen, feed_seen.json for this game and an older one; with session, a watch cut short by a restart
    (its session file and the backups it names) plus older backups of this game and of another one."""
    data = root / "data"
    write(data / "live_state.json", state_of(game))
    write(data / "play_callers.csv", b"season,team,play_caller\n2026,DAL,Brian Schottenheimer\n")
    write(data / "play_callers_2024_2026.csv", b"season,team,first_week,last_week,play_caller,role,source\n")
    write(data / "espn" / f"summary_{EVENT}_final.json", {"header": {}})
    write(data / "logos" / "dal.png", b"\x89PNG fake")
    write(data / "shadow.duckdb", b"DUCK" * 64)
    if seen:
        write(data / "feed_seen.json", {GID: ["4018729801", "4018729802"], OTHER_GID: ["4018720001"],
                                        "_apply_order": [GID, OTHER_GID],
                                        "_events": {GID: EVENT, OTHER_GID: "4018720"}})
    if session:
        write(data / "watch_session.json", {"game_id": GID, "watching": EVENT, "started_at": "2026-10-09T21:10:00",
                                            "event_id": EVENT, "feed_was_on": False,
                                            "backup": {"state": STATE_BACKUP, "seen": SEEN_BACKUP}})
        write(data / STATE_BACKUP, state_of(game, rows=7))
        write(data / SEEN_BACKUP, {GID: ["4018729801"], "_apply_order": [GID], "_events": {GID: EVENT}})
        write(data / "live_state.backup-20261009-200000.json", state_of(game, rows=5))      # an older one of this game
        write(data / "live_state.backup-20261001-200000.json", state_of({**PLAYED, "game_id": OTHER_GID}))
        write(data / "live_state.unreadable-20261009-190000.json", b"{cut off")
    return data


def outside_games(data):
    """sha256 of every file in the data folder outside games/ (what adoption must never change)."""
    return {str(p.relative_to(data)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(data.rglob("*"))
            if p.is_file() and "games" not in p.relative_to(data).parts}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(data, game=DEFAULT):
    return adopt.adopt(data, game, CALLER)


# ---------------------------------------------------------------- Sam's data today: a hand-typed game, nothing else
def test_todays_game_is_copied_into_its_own_track(tmp_path):
    data = data_folder(tmp_path)
    before = outside_games(data)
    out = run(data)
    assert out.adopted, out.message
    folder = data / "games" / EVENT / "DAL"
    assert (folder / "live_state.json").read_bytes() == (data / "live_state.json").read_bytes()
    assert sorted(p.name for p in folder.iterdir()) == ["live_state.json"]
    assert outside_games(data) == before, "copy, never move: data/ is exactly as it was"


def test_the_adopted_track_keeps_the_line_he_graded_and_the_model_it_was_graded_with(tmp_path):
    data = data_folder(tmp_path)
    track = run(data).track
    game = track.config()
    assert (game["offense_spread"], game["total_line"], game["espn_event"]) == (8.5, 48.5, EVENT)
    assert (track.sides, track.model, dict(track.callers["DAL"])) == (
        ("DAL",), "default", {"name": CALLER, "slug": "brian-schottenheimer"})
    doc = json.loads((data / "games" / EVENT / "game.json").read_text())
    assert (doc["away"], doc["home"], doc["label"]) == ("TB", "DAL", PLAYED["label"])
    assert tracks.current(data) == track, "index.json names it, so the app opens it"


def test_index_is_written_last_and_records_what_was_copied(tmp_path):
    data = data_folder(tmp_path)
    run(data)
    index = json.loads((data / "games" / "index.json").read_text())
    assert index["version"] == 1 and index["current"] == {"event_id": EVENT, "sides": ["DAL"]}
    adopted = index["adopted"]
    assert adopted["from"] == "live_state.json" and adopted["sha256"] == sha(data / "live_state.json")
    assert adopted["files"] == {"live_state.json": sha(data / "live_state.json")}
    assert not list((data / "games").glob(".adopting-*")) and not list((data / "games").rglob("*.tmp"))


# ---------------------------------------------------------------- with the live feed's ids and a watch cut short
def test_feed_seen_is_filtered_to_this_game(tmp_path):
    data = data_folder(tmp_path, seen=True)
    assert run(data).adopted
    seen = json.loads((data / "games" / EVENT / "DAL" / "feed_seen.json").read_text())
    assert seen == {GID: ["4018729801", "4018729802"], "_apply_order": [GID], "_events": {GID: EVENT}}


def test_a_watch_session_comes_with_every_backup_of_this_game(tmp_path):
    data = data_folder(tmp_path, seen=True, session=True)
    before = outside_games(data)
    out = run(data)
    assert out.adopted, out.message
    folder = data / "games" / EVENT / "DAL"
    copied = sorted(p.name for p in folder.iterdir())
    assert copied == sorted(["live_state.json", "feed_seen.json", "watch_session.json", STATE_BACKUP, SEEN_BACKUP,
                             "live_state.backup-20261009-200000.json"])
    for name in ("watch_session.json", STATE_BACKUP, SEEN_BACKUP, "live_state.backup-20261009-200000.json"):
        assert sha(folder / name) == sha(data / name), name
    files = json.loads((data / "games" / "index.json").read_text())["adopted"]["files"]
    assert set(files) == set(copied) and all(files[n] == sha(folder / n) for n in copied)
    assert outside_games(data) == before


def test_a_session_of_another_game_stays_behind(tmp_path):
    data = data_folder(tmp_path, seen=True, session=True)
    write(data / "watch_session.json", {"game_id": OTHER_GID, "backup": {"state": STATE_BACKUP, "seen": None}})
    assert run(data).adopted
    assert not (data / "games" / EVENT / "DAL" / "watch_session.json").exists()


# ---------------------------------------------------------------- the event
def test_the_event_comes_from_the_feeds_record_first(tmp_path):
    data = data_folder(tmp_path, seen=True)
    out = run(data, {**DEFAULT, "game_id": "2026_06_DAL_WAS", "espn_event": "401873000"})
    assert out.adopted and out.track.event_id == EVENT


def test_then_from_the_game_file_itself(tmp_path):
    data = data_folder(tmp_path, game={**PLAYED, "espn_event": "401872999"})
    out = run(data, {**DEFAULT, "game_id": "2026_06_DAL_WAS"})
    assert out.adopted and out.track.event_id == "401872999"


def test_no_event_anywhere_means_no_adoption_and_nothing_changes(tmp_path):
    data = data_folder(tmp_path)
    before = outside_games(data)
    out = run(data, {**DEFAULT, "game_id": "2026_06_DAL_WAS", "espn_event": "401873000"})
    assert not out.adopted and "event" in out.message
    assert not (data / "games").exists() and outside_games(data) == before


@pytest.mark.parametrize("raw", [b"{cut off", b"[]", json.dumps({"game": {"game_id": GID}}).encode(),
                                 json.dumps({"game": {**PLAYED, "offense": "../x"}}).encode()])
def test_a_game_file_it_cant_read_is_left_alone(tmp_path, raw):
    data = data_folder(tmp_path)
    write(data / "live_state.json", raw)
    before = outside_games(data)
    out = run(data)
    assert not out.adopted and out.message
    assert not (data / "games").exists() and outside_games(data) == before


def test_nothing_to_adopt_without_a_game_file(tmp_path):
    data = data_folder(tmp_path)
    (data / "live_state.json").unlink()
    out = run(data)
    assert not out.adopted and not (data / "games").exists()


# ---------------------------------------------------------------- never twice, never half
def test_a_second_start_never_adopts_twice(tmp_path):
    data = data_folder(tmp_path, seen=True, session=True)
    assert run(data).adopted
    games = {str(p): p.read_bytes() for p in (data / "games").rglob("*") if p.is_file()}
    write(data / "live_state.json", state_of(PLAYED, rows=9))         # the old file changes: still never adopted again
    out = run(data)
    assert not out.adopted and "index.json" in out.message
    assert {str(p): p.read_bytes() for p in (data / "games").rglob("*") if p.is_file()} == games


@pytest.mark.parametrize("fail_at", [1, 3, 5])
def test_a_failure_halfway_leaves_the_data_folder_exactly_as_it_was(tmp_path, monkeypatch, fail_at):
    data = data_folder(tmp_path, seen=True, session=True)
    before = outside_games(data)
    real, calls = tracks.write_bytes_whole, []

    def flaky(path, raw):
        calls.append(path)
        if len(calls) == fail_at:
            raise OSError("disk full")
        return real(path, raw)
    monkeypatch.setattr(adopt.tracks, "write_bytes_whole", flaky)
    out = run(data)
    assert not out.adopted and "disk full" in out.message
    assert not (data / "games").exists() and outside_games(data) == before


def test_a_copy_that_doesnt_match_its_source_is_a_failure(tmp_path, monkeypatch):
    data = data_folder(tmp_path, seen=True, session=True)
    before = outside_games(data)
    real = tracks.write_bytes_whole

    def bit_flip(path, raw):
        return real(path, raw[:-1] + b"X" if path.name == STATE_BACKUP else raw)
    monkeypatch.setattr(adopt.tracks, "write_bytes_whole", bit_flip)
    out = run(data)
    assert not out.adopted and STATE_BACKUP in out.message
    assert not (data / "games").exists() and outside_games(data) == before


def test_an_index_that_cant_be_written_takes_the_whole_adoption_back(tmp_path, monkeypatch):
    data = data_folder(tmp_path, seen=True)
    before = outside_games(data)

    def refuse(*_):
        raise OSError("read-only file system")
    monkeypatch.setattr(adopt.tracks, "write_index", refuse)
    out = run(data)
    assert not out.adopted and "read-only" in out.message
    assert not (data / "games").exists() and outside_games(data) == before


def test_an_interrupt_while_the_index_is_written_takes_the_whole_adoption_back(tmp_path, monkeypatch):
    """Ctrl-C at the start, as the index is swapped in: its temp file goes too, so data/ is exactly as it was."""
    data = data_folder(tmp_path, seen=True, session=True)
    before = outside_games(data)
    real_replace = adopt.tracks.os.replace

    def interrupted(src, dst):
        if Path(dst).name == "index.json":
            raise KeyboardInterrupt
        return real_replace(src, dst)
    monkeypatch.setattr(adopt.tracks.os, "replace", interrupted)
    with pytest.raises(KeyboardInterrupt):
        run(data)
    assert not (data / "games").exists() and outside_games(data) == before


def test_an_adoption_cut_short_before_its_index_is_never_built_over(tmp_path):
    data = data_folder(tmp_path)
    run(data)
    (data / "games" / "index.json").unlink()                     # as if the app died just before writing it
    kept = {str(p): p.read_bytes() for p in (data / "games").rglob("*") if p.is_file()}
    out = run(data)
    assert not out.adopted and "data/games" in out.message
    assert {str(p): p.read_bytes() for p in (data / "games").rglob("*") if p.is_file()} == kept


def test_an_existing_games_folder_is_kept_when_adoption_fails(tmp_path, monkeypatch):
    """games/ made by a pick in an earlier run (no index yet) stays as it was when this adoption fails."""
    data = data_folder(tmp_path)
    write(data / "games" / "401873000" / "game.json", {"tracks": {}})
    monkeypatch.setattr(adopt.tracks, "write_index", lambda *_: (_ for _ in ()).throw(OSError("nope")))
    assert not run(data).adopted
    assert sorted(str(p.relative_to(data)) for p in (data / "games").rglob("*")) == [
        "games/401873000", "games/401873000/game.json"]


def test_adoption_runs_on_a_copy_of_the_real_layout_without_touching_the_original(tmp_path):
    """The real data folder's layout (its files' names), copied: the original is never opened for writing."""
    from helpers import ROOT
    real = ROOT / "data"
    copy = tmp_path / "data"
    shutil.copytree(real, copy, ignore=shutil.ignore_patterns("shadow.duckdb*", "logos", "games", "nflverse"))
    if not (copy / "live_state.json").exists():
        pytest.skip("no live game in data/ to rehearse on")
    before = outside_games(copy)
    out = run(copy)
    assert out.adopted, out.message
    assert outside_games(copy) == before
    assert (copy / "games" / out.track.event_id / out.track.key / "live_state.json").read_bytes() == \
        (copy / "live_state.json").read_bytes()

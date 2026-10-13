"""The call log archive's safety copy (live_archive.py, archive_keep.py; docs/design/game-picker.md 4): before a run
first changes what data/shadow.duckdb held (its columns, or a row another run wrote), one copy of the file is kept,
checked byte for byte; when no copy can be made the run leaves the file exactly as it was; and no reset, replay or
watch ever deletes the rows a game was graded with before tracks existed. Every test runs on a temp archive built in
the shape the Oct 8 build left Sam's (its 32 columns, Dallas's live-graded calls), never on data/."""
import hashlib
import logging

import duckdb
import pytest
from helpers import TEST_GAME

import config
import espn_feed
import live

GID = TEST_GAME["game_id"]
# The Oct 8 build's live_log: its CREATE TABLE, then its 12 extra columns (no seq, nullified, penalty, team, caller or
# track yet). data/shadow.duckdb has exactly these 32 columns and Dallas's first seven calls of TB at DAL.
OLD_TABLE = """CREATE TABLE live_log (game_id VARCHAR, snap INTEGER, drive INTEGER, logged_at VARCHAR, qtr INTEGER,
    clock VARCHAR, down INTEGER, togo INTEGER, yardline_100 INTEGER, score VARCHAR, p DOUBLE, p_league DOUBLE,
    p_habits DOUBLE, flag VARCHAR, call VARCHAR, dropback INTEGER, yards INTEGER, success INTEGER, td BOOLEAN,
    turnover BOOLEAN, family VARCHAR, leaf VARCHAR, outcome VARCHAR, name VARCHAR, top_leaf VARCHAR, top_leaf_p DOUBLE,
    fam_p DOUBLE, fam_p_league DOUBLE, leaf_p DOUBLE, leaf_p_league DOUBLE, leaf_rank INTEGER,
    leaf_rank_league INTEGER)"""
LIVE_NIGHT = 7


def live_night_row(snap):
    """One of Dallas's calls as the live feed archived it on Oct 8 (the values are the archive's own kinds)."""
    return (GID, snap, 1 + snap // 4, f"19:{16 + snap}:{10 + snap:02d}", 1, f"{15 - snap}:00", 1 + snap % 3, 10, 75 - snap,
            "0-0", 0.448 + snap / 100, 0.4542, 0.448, "no edge", "P" if snap % 2 else "R", snap % 2, snap, snap % 2,
            False, False, "dropback", "dropback_short", None, "Short (0–9 air yds)", "dropback_short", 0.31, 0.39,
            0.42, 0.31, 0.33, 1 + snap % 5, 2)


def old_archive(path):
    """The archive as the Oct 8 build left it: its old shape and the live-night rows."""
    con = duckdb.connect(str(path))
    try:
        con.execute(OLD_TABLE)
        con.executemany(f"INSERT INTO live_log VALUES ({', '.join('?' * 32)})",
                        [live_night_row(n) for n in range(1, LIVE_NIGHT + 1)])
    finally:
        con.close()
    return path


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def by_track(db):
    con = duckdb.connect(str(db))
    try:
        return dict(con.execute("SELECT track, count(*) FROM live_log WHERE game_id = ? GROUP BY ALL", [GID]).fetchall())
    finally:
        con.close()


def columns(db):
    con = duckdb.connect(str(db))
    try:
        return {c for (c,) in con.execute("SELECT column_name FROM information_schema.columns "
                                          "WHERE table_name = 'live_log'").fetchall()}
    finally:
        con.close()


def copies(folder):
    return sorted((folder / "games").glob("shadow.duckdb.kept-*"))


def two_calls(e):
    e.new_drive(75)
    e.record_play(None, 3, leaf="run_inside")
    e.record_play(None, 7, leaf="dropback_short")


@pytest.fixture
def archive(tmp_path, monkeypatch):
    """A data folder holding tonight's archive the way the Oct 8 build left it, and the adopted track's game folder
    (the engine on models/, as the first start after adoption runs it)."""
    for k, v in TEST_GAME.items():
        monkeypatch.setitem(config.GAME, k, v)
    track = tmp_path / "track"
    track.mkdir()
    monkeypatch.setattr(live, "STATE_PATH", track / "live_state.json")
    monkeypatch.setattr(espn_feed, "SEEN_PATH", track / "feed_seen.json")
    monkeypatch.setattr(espn_feed, "RAW_DIR", tmp_path / "espn")
    monkeypatch.setattr(live, "DB_PATH", old_archive(tmp_path / "shadow.duckdb"))
    return tmp_path


def test_the_first_change_keeps_one_checked_copy_and_the_live_night_rows(archive, caplog):
    """The first page load after the restart resets the adopted game to kickoff: before the archive gains its columns
    a copy of it is kept in games/ (byte for byte, named in the log with its sha256), its live-night rows stay, and
    the replay's rows go in beside them under the track."""
    db = archive / "shadow.duckdb"
    original = db.read_bytes()
    caplog.set_level(logging.INFO)
    e = live.GameEngine()
    e.reset()
    kept = copies(archive)
    assert len(kept) == 1 and kept[0].read_bytes() == original
    said = [r.getMessage() for r in caplog.records if kept[0].name in r.getMessage()]
    assert len(said) == 1 and hashlib.sha256(original).hexdigest() in said[0]
    assert {"seq", "team", "caller", "track"} <= columns(db), "the archive is in this build's shape now"
    assert by_track(db) == {None: LIVE_NIGHT}, "the reset never deletes the live-night rows"
    two_calls(e)
    assert by_track(db) == {None: LIVE_NIGHT, "DAL": 2}, "the replay's rows beside them, under the track"
    e.undo()
    assert by_track(db) == {None: LIVE_NIGHT, "DAL": 1}, "an undo takes out its own row"
    e.reset()
    assert by_track(db) == {None: LIVE_NIGHT} and len(copies(archive)) == 1, "one copy a run"
    assert kept[0].read_bytes() == original, "the copy is never written again"


def test_each_run_keeps_a_copy_before_it_deletes_rows_another_run_wrote(archive):
    first = live.GameEngine()
    first.reset()
    two_calls(first)
    before = (archive / "shadow.duckdb").read_bytes()
    second = live.GameEngine()                                         # the next start of the app
    two_calls(second)                                                  # new rows change nothing that was there
    assert len(copies(archive)) == 1
    second.reset()                                                     # first's two rows go: a copy first
    kept = copies(archive)
    assert len(kept) == 2 and kept[-1].read_bytes() != before, "taken after second's own rows went in"
    assert by_track(archive / "shadow.duckdb") == {None: LIVE_NIGHT}
    con = duckdb.connect(str(kept[-1]))
    try:
        assert con.execute("SELECT count(*) FROM live_log WHERE track = 'DAL'").fetchone()[0] == 4
    finally:
        con.close()


def test_when_no_copy_can_be_made_the_archive_is_left_as_it_was(archive, caplog):
    """The copy can't be written (games/ is a file here; a full disk is the same): the run never changes the archive,
    says once in the log that its archive is off, and the game itself carries on (the game file records every
    play)."""
    (archive / "games").write_text("not a folder")
    db = archive / "shadow.duckdb"
    before = sha(db)
    caplog.set_level(logging.INFO)
    e = live.GameEngine()
    e.reset()
    two_calls(e)
    e.undo()
    e.reset()
    two_calls(e)
    assert sha(db) == before and columns(db) == columns(archive / "shadow.duckdb") and "track" not in columns(db)
    off = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(off) == 1 and "archive is off" in off[0].getMessage() and "shadow.duckdb" in off[0].getMessage()
    assert len(e.state["log"]) == 2 and live.STATE_PATH.exists()


def test_a_copy_that_doesnt_match_is_never_kept(archive, monkeypatch):
    """The check fails (the bytes on disk aren't the file's): the copy goes and the archive stays as it was."""
    import archive_keep
    db = archive / "shadow.duckdb"
    before = sha(db)
    real = archive_keep.sha256
    seen = []

    def flaky(data):
        seen.append(len(data))
        return real(data) if len(seen) == 1 else "0" * 64          # the copy reads back wrong
    monkeypatch.setattr(archive_keep, "sha256", flaky)
    e = live.GameEngine()
    e.reset()
    assert sha(db) == before and copies(archive) == []


def test_a_fresh_install_makes_its_archive_without_a_copy(tmp_path, monkeypatch):
    for k, v in TEST_GAME.items():
        monkeypatch.setitem(config.GAME, k, v)
    monkeypatch.setattr(live, "STATE_PATH", tmp_path / "live_state.json")
    monkeypatch.setattr(live, "DB_PATH", tmp_path / "shadow.duckdb")
    e = live.GameEngine()
    e.reset()
    two_calls(e)
    assert by_track(tmp_path / "shadow.duckdb") == {"DAL": 2} and not (tmp_path / "games").exists()

"""The engine's record of logged snaps: the scorecard over them (GameEngine.metrics), DuckDB's live_log (one row per
snap and its prediction) and the CSV export.

Every tracked game shares data/shadow.duckdb, and two tracks of one game (game-picker.md 4: 'DAL', 'DAL+TB') share its
game_id, so each row carries its track and every delete names it: a reset of one track never touches another's rows.
Rows written before tracks existed have track NULL: the game as it was graded live (the adopted game's live night).
No reset, replay or watch ever deletes them; the adopted track's own rows go in beside them under its track. Before a
run first changes what the file held (its columns, or a row another run wrote), one checked copy of it is kept, and
when none can be, the run leaves the file alone (archive_keep.py).
"""
import csv
import io
import logging
from pathlib import Path

import duckdb
import numpy as np

from archive_keep import Keeper
from config import GAME
from features import log_loss

log = logging.getLogger("live")

FORMULA_START = ("=", "+", "-", "@", "\t", "\r")   # a spreadsheet reads a text cell starting so as a formula
FLOOR = 1e-9                                         # the play-type log losses never take log(0)
TOP3 = 3


def is_snap(row):
    """A log row the model is scored on: every row but a flag typed with no play (kind 'penalty', v1.4)."""
    return row.get("kind") != "penalty"


def csv_cell(value):
    """One CSV cell: '' for None, numbers as Python writes them, text with a formula's first character defused."""
    if value is None:
        return ""
    if isinstance(value, str):
        return "'" + value if value.startswith(FORMULA_START) else value
    return str(value)


def _mean_loss(rows, key):
    return float(-np.mean([np.log(max(r[key], FLOOR)) for r in rows]))


def granular_card(rows):
    """The play-type layers: family log loss and top hits; the specific play's top pick, top 3 and log loss."""
    fam = [r for r in rows if r.get("fam_p") is not None]
    leaf = [r for r in rows if r.get("leaf_rank") is not None]
    g = {"fam_n": len(fam), "leaf_n": len(leaf)}
    if fam:
        g.update({"fam_logloss": _mean_loss(fam, "fam_p"), "fam_logloss_league": _mean_loss(fam, "fam_p_league"),
                  "fam_top_hits": sum(1 for r in fam if r["fam_top"] == r["family"])})
    if leaf:
        g.update({"leaf_top1": sum(1 for r in leaf if r["leaf_rank"] == 1),
                  "leaf_top3": sum(1 for r in leaf if r["leaf_rank"] <= TOP3),
                  "leaf_top3_league": sum(1 for r in leaf if r["leaf_rank_league"] <= TOP3),
                  "leaf_logloss": _mean_loss(leaf, "leaf_p"), "leaf_logloss_league": _mean_loss(leaf, "leaf_p_league")})
    return g


def scorecard(rows):
    """The model against the league on these logged rows (flags typed with no play are not snaps): pass-or-run log
    loss, Brier and accuracy, the tilts that came true, and the play-type layers. {"n": 0} with no snap."""
    snaps = [r for r in rows if is_snap(r)]
    if not snaps:
        return {"n": 0}
    y = np.array([r["dropback"] for r in snaps], float)
    p = np.array([r["p"] for r in snaps])
    p0 = np.array([r["p_league"] for r in snaps])
    flagged = [r for r in snaps if r["flag"].startswith("TILT")]
    hits = sum(1 for r in flagged if (r["flag"] == "TILT PASS") == bool(r["dropback"]))
    return {
        "n": len(snaps),
        "logloss_model": log_loss(y, p), "logloss_league": log_loss(y, p0),
        "brier_model": float(np.mean((p - y) ** 2)), "brier_league": float(np.mean((p0 - y) ** 2)),
        "acc_model": float(np.mean((p >= 0.5) == y)), "acc_league": float(np.mean((p0 >= 0.5) == y)),
        "dropback_rate": float(y.mean()),
        "tilt_n": len(flagged), "tilt_hits": hits,
        "granular": granular_card(snaps),
    }


class ArchiveMixin:
    """GameEngine's DuckDB archive and CSV export. The engine provides _db_path() (live.DB_PATH, read at call time:
    tests sandbox it), state and track (its sides sorted and joined by '+'). One engine is one run of the app: its
    Keeper for each archive file holds the run's copy and the rows it wrote."""

    BASE_DB_COLS = ["snap", "drive", "time", "qtr", "clock", "down", "togo", "yardline_100", "score",
                    "p", "p_league", "p_habits", "flag", "call", "dropback", "yards", "success", "td", "turnover"]
    EXTRA_DB_COLS = [("family", "VARCHAR"), ("leaf", "VARCHAR"), ("outcome", "VARCHAR"), ("name", "VARCHAR"),
                     ("top_leaf", "VARCHAR"), ("top_leaf_p", "DOUBLE"), ("fam_p", "DOUBLE"),
                     ("fam_p_league", "DOUBLE"), ("leaf_p", "DOUBLE"), ("leaf_p_league", "DOUBLE"),
                     ("leaf_rank", "INTEGER"), ("leaf_rank_league", "INTEGER"),
                     ("seq", "INTEGER"), ("nullified", "BOOLEAN"), ("penalty", "VARCHAR"),
                     ("team", "VARCHAR"), ("caller", "VARCHAR")]
    TRACK_COL = ("track", "VARCHAR")         # in the archive only: the CSV is one track's already
    TABLE = """CREATE TABLE IF NOT EXISTS live_log (
            game_id VARCHAR, snap INTEGER, drive INTEGER, logged_at VARCHAR, qtr INTEGER, clock VARCHAR,
            down INTEGER, togo INTEGER, yardline_100 INTEGER, score VARCHAR, p DOUBLE, p_league DOUBLE,
            p_habits DOUBLE, flag VARCHAR, call VARCHAR, dropback INTEGER, yards INTEGER, success INTEGER,
            td BOOLEAN, turnover BOOLEAN)"""
    COLUMNS_SQL = "SELECT column_name FROM information_schema.columns WHERE table_name = 'live_log'"
    # The track's rows past the first n log rows: what an undo, a fix, a reset or a replay takes out. Never a row from
    # before tracks (track NULL), which equals no track.
    AFTER = "game_id = ? AND track = ? AND (seq > ? OR (seq IS NULL AND snap > ?))"

    def _keeper(self):
        """This run's Keeper for the archive file it writes now (live.DB_PATH, read at call time)."""
        path = Path(self._db_path())
        keepers = self.__dict__.setdefault("_keepers", {})
        if str(path) not in keepers:
            keepers[str(path)] = Keeper(path)
        return keepers[str(path)]

    def _missing(self, con):
        """(the columns live_log lacks in this build's shape, whether it has no table yet): every extra column then."""
        have = {c for (c,) in con.execute(self.COLUMNS_SQL).fetchall()}
        return [(c, t) for c, t in [*self.EXTRA_DB_COLS, self.TRACK_COL] if c not in have], not have

    @staticmethod
    def _change(con, missing, no_table, keeper, rows_going):
        """What is about to change in what the file held, in words, or None: its shape, or rows another run wrote."""
        if no_table:
            return "the call log table is added to it"
        if missing:
            return f"its call log gains the columns {', '.join(c for c, _ in missing)}"
        if rows_going is not None and keeper.others_in(rows_going(con)):
            return "a reset or a replay deletes rows an earlier run wrote"
        return None

    def _db(self, rows_going=None):
        """A connection to the archive, live_log in this build's shape, or None while the archive is off for this run.
        Before the run first changes what the file held (its shape, or rows_going(con): the keys of the rows about to
        be deleted, when another run wrote one of them), the Keeper keeps a checked copy of it; when it can't, nothing
        here touches the file. A file this run made needs no copy."""
        keeper = self._keeper()
        if keeper.off:
            return None
        existed = keeper.path.is_file()
        con = duckdb.connect(str(keeper.path))
        try:
            missing, no_table = self._missing(con)
            why = self._change(con, missing, no_table, keeper, rows_going) if existed and not keeper.kept else None
            if why:
                con.close()                    # nothing changed yet: the file is copied as it stands
                if not keeper.keep(why):
                    return None
                con = duckdb.connect(str(keeper.path))
            if missing:
                con.execute(self.TABLE)
                for col, typ in missing:
                    con.execute(f"ALTER TABLE live_log ADD COLUMN IF NOT EXISTS {col} {typ}")
            return con
        except BaseException:
            con.close()
            raise

    def _db_insert(self, r):
        if not is_snap(r):                 # the archive holds snaps and their predictions only
            return
        try:
            con = self._db()
            if con is None:                # the archive is off for this run (archive_keep.py): the game file has it
                return
            cols = self.BASE_DB_COLS[3:] + [c for c, _ in self.EXTRA_DB_COLS]
            names = ["game_id", "snap", "drive", "logged_at", *cols, self.TRACK_COL[0]]
            vals = [GAME["game_id"], r["snap"], r["drive"], r["time"], *(r.get(c) for c in cols), self.track]
            try:
                con.execute(f"INSERT INTO live_log ({', '.join(names)}) VALUES ({', '.join('?' * len(vals))})", vals)
            finally:
                con.close()
            self._keeper().wrote((GAME["game_id"], self.track, r.get("seq"), r["snap"]))
        except Exception as e:  # the JSON state file is the source of truth; never block the UI
            log.warning("DuckDB write skipped: %s", e)

    def _db_delete_after(self, n_keep):
        """Drop this track's archived rows past the first n_keep log rows. Rows from before tracks (track NULL: a game
        graded live before this build) are never deleted."""
        args = [GAME["game_id"], self.track, n_keep, n_keep]

        def going(con):
            return con.execute(f"SELECT game_id, track, seq, snap FROM live_log WHERE {self.AFTER}", args).fetchall()
        try:
            con = self._db(rows_going=going)
            if con is None:
                return
            keeper = self._keeper()
            try:
                gone = going(con) if keeper.kept is None else ()
                con.execute(f"DELETE FROM live_log WHERE {self.AFTER}", args)
            finally:
                con.close()
            keeper.dropped(gone)
        except Exception as e:
            log.warning("DuckDB delete skipped: %s", e)

    def export_csv(self):
        """The log as CSV (csv module: a comma or a line break stays inside its quoted cell). A text cell that starts
        like a formula (= + - @ tab CR) gets a leading apostrophe; numbers are written as numbers."""
        cols = self.BASE_DB_COLS + [c for c, _ in self.EXTRA_DB_COLS]
        out = io.StringIO()
        w = csv.writer(out, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
        w.writerow(cols)
        w.writerows([csv_cell(r.get(c)) for c in cols] for r in self.state["log"] if is_snap(r))
        return out.getvalue()

"""One checked copy of the call log archive (data/shadow.duckdb) before a run first changes what was in it
(docs/design/game-picker.md 4).

Every tracked game shares the archive, and this build changes it in ways the builds before it never did: it adds
columns (team, caller, track) to a file they made, and a reset or a replay deletes the track's rows before it writes
them again. So before a run (a server start: its one engine) first changes the archive's columns, or deletes a row the
run didn't write itself, the file is copied once into the games folder beside the tracks
(games/shadow.duckdb.kept-<time>), checked byte for byte (sha256) against the file, never pruned, and named in the
server log. Writing new rows needs no copy: it changes nothing that was there. A copy that can't be made or checked
turns the archive off for the run: nothing in the file changes, the game files (the source of truth) still record
every play, and the log says so once.
"""
import hashlib
import logging
import os
from collections import Counter
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path

import tracks

log = logging.getLogger(__name__)

KEPT_MARK = ".kept-"               # shadow.duckdb.kept-20261013-201500: never pruned (the watch prunes its backups only)
MAX_SAME_SECOND = 99               # copies kept in one second are named -2 to -99


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def copy_checked(src: Path, folder: Path) -> tuple[Path, str]:
    """src copied into folder as <name>.kept-<time> ('xb': never over another copy; another in the same second gets
    -2, -3 ...), flushed to disk, then read back: the copy must hold exactly the file's bytes, and the file must not
    have changed meanwhile. Returns (the copy, its sha256). OSError, with nothing left behind, otherwise."""
    data = src.read_bytes()
    digest = sha256(data)
    folder.mkdir(parents=True, exist_ok=True)
    stamp = f"{datetime.now():%Y%m%d-%H%M%S}"
    for n in range(1, MAX_SAME_SECOND + 1):
        dest = folder / f"{src.name}{KEPT_MARK}{stamp}{'' if n == 1 else f'-{n}'}"
        try:
            f = open(dest, "xb")
        except FileExistsError:
            continue
        try:
            with f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            if sha256(dest.read_bytes()) != digest:
                raise OSError(f"the copy {dest.name} doesn't match {src.name}")
            if sha256(src.read_bytes()) != digest:
                raise OSError(f"{src.name} changed while it was being copied")
        except BaseException:
            dest.unlink(missing_ok=True)              # never half a copy, or one that doesn't match
            raise
        return dest, digest
    raise OSError(f"{MAX_SAME_SECOND} copies named {src.name}{KEPT_MARK}{stamp} already")


class Keeper:
    """One run's promise for one archive file: the copy it made (kept), or why the archive is off (off), and the rows
    it wrote itself that are still there, by (game_id, track, seq, snap), until it has a copy."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.kept: Path | None = None
        self.off: str | None = None
        self.written: Counter = Counter()

    def wrote(self, key: tuple) -> None:
        if self.kept is None:
            self.written[key] += 1

    def dropped(self, keys: Iterable[tuple]) -> None:
        if self.kept is None:
            self.written.subtract(keys)
            self.written = +self.written                 # no zero or negative counts

    def others_in(self, keys: Iterable[tuple]) -> bool:
        """Whether rows with these keys include one this run didn't write (a key there more often than it wrote it)."""
        return any(n > self.written[k] for k, n in Counter(keys).items())

    def keep(self, why: str) -> bool:
        """Copy the file once, before the run changes it (`why`: what is about to change). True when the archive may
        change (copied now or earlier in the run), False when it is off for the run (the copy failed: logged once)."""
        if self.kept is not None:
            return True
        if self.off is not None:
            return False
        folder = tracks.games_dir(self.path.parent)
        try:
            self.kept, digest = copy_checked(self.path, folder)
        except OSError as ex:
            self.off = str(ex)
            log.error("Couldn't keep a copy of %s before %s (%s), so this run leaves it exactly as it is: the call log "
                      "archive is off until the app starts again. The game files still record every play.",
                      self.path.name, why, ex)
            return False
        self.written = Counter()
        log.info("Kept a copy of %s as %s/%s before %s (sha256 %s, checked byte for byte).", self.path.name,
                 folder.name, self.kept.name, why, digest)
        return True

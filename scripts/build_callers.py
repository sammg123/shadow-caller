"""Build a model for every play-caller in a sourced table: one bundle per caller, and an index of them all.

    .venv/bin/python scripts/build_callers.py                            # every caller in the default table
    .venv/bin/python scripts/build_callers.py --only "Brian Schottenheimer"
    .venv/bin/python scripts/build_callers.py --jobs 3 --force           # rebuild them all, three workers

The table (default data/play_callers_2024_2026.csv, else data/play_callers.csv) has one row per stint:
season,team,first_week,last_week,play_caller,role,source and optionally confidence,note. It is checked before
anything is pulled: nflverse team codes, whole weeks 1 to 22, and inside a team-season the stints start at week 1
and run on without gaps or overlaps. nflverse play-by-play and FTN charting are pulled once into cache/pbp.duckdb
(reused for a day; --refresh pulls again), never data/shadow.duckdb. Each caller gets models/callers/<slug>/
(stage1.joblib, granular.joblib, profile.json) from all his stints. His baseline never sees a snap of any team he
called for; callers who share that exclusion share one stage 1 fit. models/callers/index.json lists every caller in
the table: built (with his held-out log loss against the league's), skipped (too few snaps, and why) or failed.
A bundle that is already up to date (same stints, same pull, same scikit-learn) is kept unless --force.
Never writes models/stage1.joblib, models/granular.joblib or models/profile.json.
"""
from __future__ import annotations

import argparse
import csv
import functools
import hashlib
import json
import multiprocessing
import os
import shutil
import sys
import time
import traceback
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import groupby
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import duckdb  # noqa: E402
import joblib  # noqa: E402
import polars as pl  # noqa: E402
import sklearn  # noqa: E402
from threadpoolctl import threadpool_limits  # noqa: E402

import build  # noqa: E402
import build_granular  # noqa: E402
from callers import BUNDLE_FILES, INDEX_FILE, slugify  # noqa: E402
from config import DATA_DIR, DB_PATH, LEAGUE_SEASONS, MODEL_DIR  # noqa: E402

DEFAULT_TABLES = ("play_callers_2024_2026.csv", "play_callers.csv")
CACHE_PATH = ROOT / "cache" / "pbp.duckdb"
OUT_DIR = MODEL_DIR / "callers"
CACHE_MAX_AGE = timedelta(hours=24)
REQUIRED = ("season", "team", "first_week", "last_week", "play_caller", "role", "source")
MAX_WEEK = 22                    # nflverse numbers the postseason on: weeks 19 to 22
NFL_TEAMS = frozenset("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LA LAC LV MIA MIN NE NO NYG "
                      "NYJ PHI PIT SEA SF TB TEN WAS".split())
TEAM_HINTS = {"LAR": "LA", "STL": "LA", "OAK": "LV", "SD": "LAC", "WSH": "WAS", "JAC": "JAX", "ARZ": "ARI",
              "BLT": "BAL", "CLV": "CLE", "HST": "HOU", "KAN": "KC", "NOR": "NO", "SFO": "SF", "TAM": "TB",
              "GNB": "GB", "NWE": "NE"}
CONFIDENCE_RANK = {"low": 0, "medium": 1, "high": 2}
MIN_GAMES = build.N_FOLDS        # every cross-validation fold holds out at least one of his games
MIN_SNAPS = 200
MIN_CHARTED = 100                # his snaps with FTN charting, for the play-type adjustments
BUILD_VERSION = 1                # bump when a bundle's contents change: every bundle is then out of date
STATUSES = ("built", "skipped", "failed", "not built")


# ---------------------------------------------------------------- the table
@dataclass(frozen=True)
class Stint:
    line: int
    season: int
    team: str
    first_week: int
    last_week: int
    caller: str
    role: str
    source: str
    confidence: str = ""
    note: str = ""

    def as_dict(self):
        return {"season": self.season, "team": self.team, "first_week": self.first_week,
                "last_week": self.last_week, "role": self.role, "confidence": self.confidence or None,
                "source": self.source}


@dataclass(frozen=True)
class Caller:
    name: str
    slug: str
    stints: tuple             # his Stints, by season and week

    @property
    def teams(self):
        return tuple(sorted({s.team for s in self.stints}))

    @property
    def seasons(self):
        return tuple(sorted({s.season for s in self.stints}))

    @property
    def latest(self):
        return self.stints[-1]

    @property
    def role(self):
        return self.latest.role

    @property
    def confidence(self):
        return weakest([s.confidence for s in self.stints])

    def rows(self):
        """His stints as build.caller_snaps reads them."""
        return pl.DataFrame({"season": [s.season for s in self.stints], "team": [s.team for s in self.stints],
                             "first_week": [s.first_week for s in self.stints],
                             "last_week": [s.last_week for s in self.stints],
                             "play_caller": [self.name] * len(self.stints)})


class TableError(ValueError):
    def __init__(self, path, problems):
        self.problems = tuple(problems)
        super().__init__(f"{path}: {len(self.problems)} problem(s) in the play-caller table, nothing was built:\n"
                         + "\n".join(f"  - {p}" for p in self.problems))


def weakest(values):
    """The least sure of his stints' confidences (low < medium < high); other text: the latest stint's."""
    given = [v for v in values if v]
    if not given:
        return None
    if all(v.lower() in CONFIDENCE_RANK for v in given):
        return min((v.lower() for v in given), key=CONFIDENCE_RANK.get)
    return given[-1]


def default_table(data_dir=DATA_DIR):
    """The researched 2024 to 2026 table when it exists, else tonight's short one."""
    found = [data_dir / n for n in DEFAULT_TABLES if (data_dir / n).exists()]
    return found[0] if found else data_dir / DEFAULT_TABLES[-1]


def read_table(path, teams=NFL_TEAMS, seasons=tuple(LEAGUE_SEASONS), max_week=MAX_WEEK):
    """Every stint in the table, or TableError listing every problem (with its line) when anything is off."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        header = [h.strip() for h in reader.fieldnames or []]
        missing = [c for c in REQUIRED if c not in header]
        if missing:
            raise TableError(path, [f"missing column(s): {', '.join(missing)} (the header needs "
                                    f"{', '.join(REQUIRED)})"])
        parsed = [_parse_row(raw, reader.line_num, teams, seasons, max_week) for raw in reader]
    stints = tuple(s for s, _ in parsed if s is not None)
    problems = [p for _, ps in parsed for p in ps] + _coverage_problems(stints) + _slug_problems(stints)
    if not parsed:
        problems = [*problems, "the table has no rows"]
    if problems:
        raise TableError(path, problems)
    return stints


def _whole(text):
    return int(text) if text.isascii() and text.isdigit() else None


def _parse_row(raw, line, teams, seasons, max_week):
    row = {k.strip(): (v or "").strip() for k, v in raw.items() if isinstance(k, str)}
    season, first, last = (_whole(row[k]) for k in ("season", "first_week", "last_week"))
    team, name = row["team"], row["play_caller"]
    checks = [
        (bool(raw.get(None)), "more values than columns (quote a field that has a comma in it)"),
        (season is None, f"season '{row['season']}' is not a whole number"),
        (season is not None and season not in seasons,
         f"season {season} is outside the data ({seasons[0]} to {seasons[-1]})"),
        (team not in teams, f"team '{team}' is not an nflverse team code{_team_hint(team, teams)}"),
        (first is None or last is None or not 1 <= first <= last <= max_week,
         f"weeks {row['first_week']} to {row['last_week']} are not a range inside 1 to {max_week}"),
        (not name, "no play_caller"),
    ]
    problems = [f"line {line}: {msg}" for bad, msg in checks if bad]
    if problems:
        return None, problems
    return Stint(line, season, team, first, last, name, row["role"], row["source"], row.get("confidence", ""),
                 row.get("note", "")), []


def _team_hint(team, teams):
    guess = TEAM_HINTS.get(team.upper()) or (team.upper() if team.upper() in teams else None)
    return f" (did you mean {guess}?)" if guess else ""


def _coverage_problems(stints):
    """Inside a team-season the stints start at week 1 and follow each other without gaps or overlaps."""
    problems = []
    ordered = sorted(stints, key=lambda s: (s.team, s.season, s.first_week, s.last_week))
    for (team, season), group in groupby(ordered, key=lambda s: (s.team, s.season)):
        rows = list(group)
        if rows[0].first_week > 1:
            problems.append(f"{team} {season}: nobody calls weeks 1 to {rows[0].first_week - 1} "
                            f"(before line {rows[0].line})")
        for a, b in zip(rows, rows[1:]):
            if b.first_week <= a.last_week:
                problems.append(f"{team} {season}: lines {a.line} and {b.line} overlap in weeks {b.first_week} "
                                f"to {min(a.last_week, b.last_week)}")
            elif b.first_week > a.last_week + 1:
                problems.append(f"{team} {season}: nobody calls weeks {a.last_week + 1} to {b.first_week - 1} "
                                f"(between lines {a.line} and {b.line})")
    return problems


def _slug_problems(stints):
    """Two spellings of one name would share a folder: refuse them."""
    slugs, problems = [], []
    for name in sorted({s.caller for s in stints}):
        try:
            slugs.append((slugify(name), name))
        except ValueError as e:
            problems.append(str(e))
    for slug, group in groupby(sorted(slugs), key=lambda t: t[0]):
        names = [n for _, n in group]
        if len(names) > 1:
            problems.append(f"names {' and '.join(repr(n) for n in names)} make the same slug '{slug}': "
                            "use one spelling")
    return problems


def group_callers(stints):
    """One Caller per play_caller name, with all his stints, sorted by name."""
    ordered = sorted(stints, key=lambda s: (s.caller, s.season, s.first_week))
    found = (Caller(name, slugify(name), tuple(g)) for name, g in groupby(ordered, key=lambda s: s.caller))
    return tuple(sorted(found, key=lambda c: c.name.casefold()))


def exclusion_groups(callers):
    """Callers who called for the same set of teams share one baseline that never saw any of those teams."""
    ordered = sorted(callers, key=lambda c: (c.teams, c.name.casefold()))
    return {teams: tuple(g) for teams, g in groupby(ordered, key=lambda c: c.teams)}


def select(callers, wanted):
    """--only: names or slugs (any case) -> their slugs. None when everyone is wanted."""
    if not wanted:
        return None
    slugs = {c.slug for c in callers}
    found = {w: _slug_or_none(w) for w in wanted}
    missing = [w for w, slug in found.items() if slug not in slugs]
    if missing:
        raise ValueError(f"Not in the table: {', '.join(missing)}. It has {len(callers)} callers, for example "
                         f"{', '.join(c.name for c in callers[:6])}.")
    return frozenset(found.values())


def _slug_or_none(text):
    try:
        return slugify(text)
    except ValueError:
        return None


# ---------------------------------------------------------------- where things go
def _inside(path, folder):
    path, folder = Path(path).resolve(), Path(folder).resolve()
    return path == folder or folder in path.parents


def check_cache_path(path):
    if Path(path).resolve() == DB_PATH.resolve() or any(_inside(path, d) for d in (ROOT / "data", DATA_DIR)):
        raise ValueError(f"Refusing to use {path} as the cache: it is in the app's data folder, next to the live "
                         "game and data/shadow.duckdb. Pick another --cache (default cache/pbp.duckdb).")
    return Path(path)


def check_out_dir(path):
    data = (ROOT / "data", DATA_DIR)
    if Path(path).resolve() == MODEL_DIR.resolve() or any(_inside(path, d) or _inside(d, path) for d in data):
        raise ValueError(f"Refusing to write bundles into {path}: models/ keeps tonight's live models at its top "
                         "level and data/ holds the live game. Use models/callers (the default) or another folder.")
    return Path(path)


# ---------------------------------------------------------------- the nflverse cache
def _request(seasons=LEAGUE_SEASONS):
    return {"seasons": list(seasons), "ftn_seasons": list(build_granular.FTN_SEASONS)}


def pull_cache(path, log=build.step):
    """Download nflverse play-by-play and FTN charting once into the cache (written aside, then swapped in)."""
    request = _request()
    log(f"Pulling nflverse play-by-play {request['seasons'][0]}-{request['seasons'][-1]} and FTN charting into {path}")
    raw = build.load_raw_pbp(request["seasons"])
    ftn = build_granular.load_ftn(request["ftn_seasons"])
    meta = {"source": "nflverse", "pulled_at": datetime.now().isoformat(timespec="seconds"), "request": request,
            "seasons": sorted(set(raw["season"].to_list())), "pbp_rows": raw.height, "ftn_rows": ftn.height}
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    _remove_db(tmp)
    con = duckdb.connect(str(tmp))
    try:
        for name, df in (("pbp", raw), ("ftn", ftn)):
            con.register("tmp_df", df.to_arrow())
            con.execute(f"CREATE TABLE {name} AS SELECT * FROM tmp_df")
            con.unregister("tmp_df")
        con.execute("CREATE TABLE meta (json VARCHAR)")
        con.execute("INSERT INTO meta VALUES (?)", [json.dumps(meta)])
    finally:
        con.close()
    _remove_db(path, keep_main=True)
    os.replace(tmp, path)
    log(f"Cached {raw.height:,} play-by-play rows and {ftn.height:,} charted snaps")
    return meta


def _remove_db(path, keep_main=False):
    """A DuckDB file and its write-ahead log (a stale .wal would be replayed into the new file)."""
    Path(f"{path}.wal").unlink(missing_ok=True)
    if not keep_main:
        Path(path).unlink(missing_ok=True)


def cache_meta(path, log=build.step):
    """What the cache holds and when it was pulled, or None when there is no readable cache."""
    if not Path(path).exists():
        return None
    try:
        con = duckdb.connect(str(path), read_only=True)
        try:
            (text,) = con.execute("SELECT json FROM meta").fetchone()
        finally:
            con.close()
        return json.loads(text)
    except (duckdb.Error, TypeError, ValueError) as e:
        log(f"The cache {path} can't be read ({type(e).__name__}: {e}); pulling again")
        return None


def ensure_cache(path, refresh=False, log=build.step):
    """The cache's meta, pulling first when there is none, it is a day old, it was asked for other seasons, or
    --refresh."""
    meta = None if refresh else cache_meta(path, log)
    if _fresh(meta):
        log(f"Using the nflverse pull from {meta['pulled_at']} in {path} (--refresh pulls again)")
        return meta
    return pull_cache(path, log)


def _fresh(meta):
    """A cache pulled under a day ago for the seasons this build asks for."""
    try:
        age = datetime.now() - datetime.fromisoformat(meta["pulled_at"])
    except (TypeError, KeyError, ValueError):
        return False
    return meta.get("request") == _request() and age < CACHE_MAX_AGE


@functools.lru_cache(maxsize=1)
def load_cache(path, pulled_at):
    """(prepared run/pass snaps, labelled charted snaps) from the cache; pulled_at keys the memo."""
    con = duckdb.connect(path, read_only=True)
    try:
        raw, ftn = con.execute("SELECT * FROM pbp").pl(), con.execute("SELECT * FROM ftn").pl()
    finally:
        con.close()
    plays = build.prepare_plays(raw)
    return plays, build_granular.label(plays, ftn)


# ---------------------------------------------------------------- what to build
@dataclass(frozen=True)
class Screen:
    snaps: int
    games: int
    charted: int
    reason: str | None


def screen(caller, plays, charted):
    """His snap, game and charted counts, and why he can't be fit (None when he can)."""
    keys = build.caller_snaps(plays, caller.rows()).select(["game_id", "play_id"])
    n, games = keys.height, keys["game_id"].n_unique()
    n_charted = charted.join(keys, on=["game_id", "play_id"], how="semi").height
    reason = None
    if games < MIN_GAMES or n < MIN_SNAPS:
        reason = (f"Only {_plural(games, 'game')} ({_plural(n, 'snap')}) in the data; a model needs at least "
                  f"{MIN_GAMES} games and {MIN_SNAPS} snaps.")
    elif n_charted < MIN_CHARTED:
        reason = (f"Only {n_charted} of his snaps have FTN charting yet; the play-type model needs "
                  f"{MIN_CHARTED}.")
    return Screen(n, games, n_charted, reason)


def _plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


def fingerprint(caller, meta):
    """Same stints, same pull, same scikit-learn and build version: the bundle on disk is up to date."""
    payload = {"stints": [[s.season, s.team, s.first_week, s.last_week] for s in caller.stints],
               "pulled_at": meta["pulled_at"], "request": meta["request"], "sklearn": sklearn.__version__,
               "version": BUILD_VERSION}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def bundle_profile(out_dir, slug):
    """The profile of a complete bundle on disk, else None."""
    folder = Path(out_dir) / slug
    if not all((folder / f).is_file() for f in BUNDLE_FILES):
        return None
    try:
        profile = json.loads((folder / "profile.json").read_text())
        _ = (profile["cv_logloss"]["league_baseline"], profile["cv_logloss"]["habits_plus_memory"],
             profile["granular"]["cv"]["specific_play"]["logloss_his"], profile["n_snaps"], profile["n_games"],
             profile["seasons"], profile["built_at"])
    except (ValueError, KeyError, TypeError):
        return None                     # not one this script can read: it is rebuilt on the next run
    return profile


def plan(callers, screens, fps, out_dir, force, only):
    """(callers to build, callers whose bundle is already up to date), among the selected, fittable ones."""
    todo, current = [], []
    for c in callers:
        if (only and c.slug not in only) or screens[c.slug].reason:
            continue
        prof = bundle_profile(out_dir, c.slug)
        fresh = not force and prof is not None and (prof.get("build") or {}).get("fingerprint") == fps[c.slug]
        (current if fresh else todo).append(c)
    return todo, current


# ---------------------------------------------------------------- building (in a worker)
@dataclass(frozen=True)
class GroupJob:
    exclude: tuple
    callers: tuple
    fingerprints: tuple
    cache: str
    meta: dict
    out_dir: str
    threads: int


@dataclass(frozen=True)
class Shared:
    stage1: object
    check: dict
    league: tuple
    n_train: int
    seconds: float


def _logger(tag):
    return lambda msg: build.step(f"[{tag}] {msg}")


def build_group(job):
    """One exclusion group: the shared stage 1 and league play-type fits, then each caller's own. Never raises:
    every caller comes back as a result, built or failed with the reason."""
    log = _logger("+".join(job.exclude))
    with threadpool_limits(limits=job.threads):
        try:
            plays, charted = load_cache(job.cache, job.meta["pulled_at"])
            t0 = time.perf_counter()
            s1, check = build.fit_stage1(plays, job.exclude, log)
            league = build_granular.league_models(charted, job.exclude, log)
            shared = Shared(s1, check, league, build.league_rows(plays, job.exclude).height, time.perf_counter() - t0)
        except Exception as e:  # noqa: BLE001  (reported per caller, in the index)
            log(f"FAILED the shared fits: {type(e).__name__}: {e}\n{traceback.format_exc()}")
            return [_failed(c, e) for c in job.callers]
        pairs = zip(job.callers, job.fingerprints, strict=True)
        return [_build_one(job, c, fp, plays, charted, shared) for c, fp in pairs]


def _failed(caller, e):
    return {"slug": caller.slug, "status": "failed", "reason": f"{type(e).__name__}: {e}"[:300]}


def _build_one(job, caller, fp, plays, charted, shared):
    log = _logger(caller.slug)
    t0 = time.perf_counter()
    try:
        snaps = build.caller_snaps(plays, caller.rows())
        stage2, _ = build.stage2(shared.stage1, snaps, caller.name, log)
        G, granular = build_granular.fit_caller(charted, snaps, shared.league, log)
        seconds = {"own": round(time.perf_counter() - t0, 1), "shared": round(shared.seconds, 1),
                   "shared_by": len(job.callers)}
        base = build.finish_profile(stage2, caller.latest.team, shared.check, granular)
        write_bundle(Path(job.out_dir), caller.slug, shared.stage1, G,
                     _with_extras(base, caller, job, shared.n_train, fp, seconds))
        log(f"Saved {caller.slug}/ ({seconds['own']}s of his own, {seconds['shared']}s shared by {len(job.callers)})")
        return {"slug": caller.slug, "status": "built", "seconds": seconds}
    except Exception as e:  # noqa: BLE001  (reported in the index; the other callers still build)
        log(f"FAILED: {type(e).__name__}: {e}\n{traceback.format_exc()}")
        return _failed(caller, e)


def _with_extras(base, caller, job, n_train, fp, seconds):
    """profile.json: the live schema first (the engine and the UI read it), then what a bundle adds."""
    return {**base, "slug": caller.slug, "teams": list(caller.teams),
            "stints": [s.as_dict() for s in caller.stints],
            "baseline": {"excluded_teams": list(job.exclude), "n_train": n_train,
                         "note": "Trained on every team except these, in every season: none of his snaps."},
            "data": {k: job.meta[k] for k in ("source", "pulled_at", "seasons")},
            "build": {"version": BUILD_VERSION, "fingerprint": fp, "seconds": seconds}}


def write_bundle(out_dir, slug, stage1, G, profile):
    """Write the three files into a temp folder, then swap it in, so a reader never sees half a bundle."""
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp, old, final = (out_dir / f".{slug}.tmp-{os.getpid()}", out_dir / f".{slug}.old-{os.getpid()}",
                       out_dir / slug)
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    try:
        joblib.dump(stage1, tmp / "stage1.joblib")
        joblib.dump(G, tmp / "granular.joblib")
        (tmp / "profile.json").write_text(json.dumps(profile, indent=2))
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)     # never leave half a bundle behind; the old one stays
        raise
    if final.exists() and not _is_bundle(final):
        shutil.rmtree(tmp, ignore_errors=True)
        raise ValueError(f"Refusing to replace {final}: it holds files that are not a caller bundle.")
    shutil.rmtree(old, ignore_errors=True)
    if final.exists():
        os.replace(final, old)
    os.replace(tmp, final)
    shutil.rmtree(old, ignore_errors=True)


def _is_bundle(folder):
    """A folder this script wrote (its three files, or some of them; Finder's .DS_Store is allowed)."""
    return folder.is_dir() and {p.name for p in folder.iterdir()} <= {*BUNDLE_FILES, ".DS_Store"}


def make_jobs(todo, fps, screens, cache, meta, out_dir, threads):
    """One job per exclusion group, the most snaps first so the longest groups start early."""
    jobs = [GroupJob(teams, group, tuple(fps[c.slug] for c in group), str(cache), meta, str(out_dir), threads)
            for teams, group in exclusion_groups(todo).items()]
    return sorted(jobs, key=lambda j: (-sum(screens[c.slug].snaps for c in j.callers), j.exclude))


def run_groups(jobs, workers):
    """Yield (job, results) as each group finishes: in this process, or in `workers` spawned processes."""
    if workers <= 1 or len(jobs) <= 1:
        for job in jobs:
            yield job, build_group(job)
        return
    ctx = multiprocessing.get_context("spawn")
    with ProcessPoolExecutor(max_workers=min(workers, len(jobs)), mp_context=ctx) as pool:
        futures = {pool.submit(build_group, job): job for job in jobs}
        for fut in as_completed(futures):
            try:
                yield futures[fut], fut.result()
            except Exception as e:  # noqa: BLE001  (a worker that died: its callers fail, the rest go on)
                yield futures[fut], [_failed(c, e) for c in futures[fut].callers]


# ---------------------------------------------------------------- the index
def index_entry(caller, scr, profile, fp, result):
    """One line of index.json, from the table, his screen, his bundle on disk and this run's result."""
    base = {"name": caller.name, "slug": caller.slug, "teams": list(caller.teams), "seasons": list(caller.seasons),
            "role": caller.role, "confidence": caller.confidence,
            "stints": [s.as_dict() for s in caller.stints]}
    counts = {"snaps": scr.snaps, "games": scr.games}
    failed = result is not None and result["status"] == "failed"
    if scr.reason:
        return {**base, "status": "skipped", **counts, "reason": scr.reason}
    if profile is None:
        reason = result["reason"] if failed else "Not built yet (run without --only)."
        return {**base, "status": "failed" if failed else "not built", **counts, "reason": reason}
    cv, sp = profile["cv_logloss"], profile["granular"]["cv"]["specific_play"]
    entry = {**base, "status": "built", "seasons": profile["seasons"], "snaps": profile["n_snaps"],
             "games": profile["n_games"],
             "logloss": {"league": cv["league_baseline"], "his": cv["habits_plus_memory"]},
             "specific_play": {"league": sp["logloss_league"], "his": sp["logloss_his"], "top1": sp["top1_his"],
                               "top3": sp["top3_his"]},
             "built_at": profile["built_at"], "up_to_date": (profile.get("build") or {}).get("fingerprint") == fp,
             "seconds": (profile.get("build") or {}).get("seconds")}
    return {**entry, "up_to_date": False, "error": result["reason"]} if failed else entry


def write_index(out_dir, callers, screens, fps, results, meta, table):
    entries = [index_entry(c, screens[c.slug], bundle_profile(out_dir, c.slug), fps[c.slug], results.get(c.slug))
               for c in callers]
    index = {"built_at": datetime.now().isoformat(timespec="seconds"), "table": _shown(table),
             "data": {k: meta[k] for k in ("source", "pulled_at", "seasons")}, "sklearn": sklearn.__version__,
             "counts": {s: sum(e["status"] == s for e in entries) for s in STATUSES}, "callers": entries}
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir / f".{INDEX_FILE}.tmp-{os.getpid()}"
    tmp.write_text(json.dumps(index, indent=2))
    os.replace(tmp, out_dir / INDEX_FILE)
    return index


def _shown(path):
    path = Path(path).resolve()
    return str(path.relative_to(ROOT)) if ROOT in path.parents else str(path)


def summary(index, wall, workers, threads, out_dir):
    """The run in a few lines: counts, then every caller with his held-out log loss against the league's."""
    counts = ", ".join(f"{n} {s}" for s, n in index["counts"].items() if n)
    lines = [f"Done in {wall:.0f}s ({workers} worker(s) x {threads} thread(s)): {counts}. "
             f"Index: {_shown(out_dir)}/index.json",
             f"  {'caller':<28}{'status':<10}{'snaps':>6}{'games':>6}{'league':>9}{'his':>8}{'gain':>8}{'own s':>7}"]
    for e in index["callers"]:
        ll, sec = e.get("logloss"), e.get("seconds") or {}
        nums = (f"{ll['league']:>9.4f}{ll['his']:>8.4f}{ll['league'] - ll['his']:>+8.4f}{sec.get('own', 0):>7.1f}"
                if ll else f"  {e.get('reason', '')}")
        lines.append(f"  {e['name'][:27]:<28}{e['status']:<10}{e['snaps']:>6}{e['games']:>6}{nums}")
    return "\n".join(lines)


# ---------------------------------------------------------------- the command line
def _positive(text):
    if not (text.isascii() and text.isdigit()) or int(text) < 1:
        raise argparse.ArgumentTypeError(f"needs a whole number of 1 or more, got '{text}'")
    return int(text)


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--table", help="the play-caller table (default: data/play_callers_2024_2026.csv if it exists, "
                                    "else data/play_callers.csv)")
    ap.add_argument("--only", action="append", metavar="NAME", help="build only this caller, by name or slug "
                                                                    "(repeat for more)")
    ap.add_argument("--jobs", type=_positive, default=2, help="parallel workers (default 2: the machine is shared)")
    ap.add_argument("--threads", type=_positive, help="threads per worker (default: half the cores, split "
                                                      "between the workers)")
    ap.add_argument("--force", action="store_true", help="rebuild bundles that are already up to date")
    ap.add_argument("--refresh", action="store_true", help="pull nflverse again even if the cache is under a day old")
    ap.add_argument("--cache", default=str(CACHE_PATH), help="the nflverse cache (default cache/pbp.duckdb)")
    ap.add_argument("--out", default=str(OUT_DIR), help="where bundles and index.json go (default models/callers)")
    return ap.parse_args(argv)


def _setup(args):
    """(cache, out folder, table, callers, selected slugs), or ValueError / TableError for bad input."""
    cache, out_dir = check_cache_path(Path(args.cache)), check_out_dir(Path(args.out))
    table = Path(args.table) if args.table else default_table()
    if not table.is_file():
        raise ValueError(f"No play-caller table at {table}.")
    callers = group_callers(read_table(table))
    return cache, out_dir, table, callers, select(callers, args.only)


def main(argv=None):
    args = parse_args(argv)
    t0 = time.perf_counter()
    try:
        cache, out_dir, table, callers, only = _setup(args)
    except (ValueError, OSError) as e:
        print(e, file=sys.stderr)
        return 2
    try:
        meta = ensure_cache(cache, args.refresh)
    except Exception as e:  # noqa: BLE001  (network, nflverse or disk: say so plainly, build nothing)
        print(f"Couldn't pull nflverse data into {cache} ({type(e).__name__}: {e}). Nothing was built.",
              file=sys.stderr)
        return 1
    plays, charted = load_cache(str(cache), meta["pulled_at"])
    screens = {c.slug: screen(c, plays, charted) for c in callers}
    fps = {c.slug: fingerprint(c, meta) for c in callers}
    todo, current = plan(callers, screens, fps, out_dir, args.force, only)
    groups = len(exclusion_groups(todo))
    workers = min(args.jobs, groups) if groups > 1 else 1
    threads = args.threads or max(1, (os.cpu_count() or 2) // 2 // workers)
    skipped = sum(1 for c in callers if (not only or c.slug in only) and screens[c.slug].reason)
    picked = f"; --only picked {len(only)}" if only else ""
    build.step(f"Building {len(todo)} of {len(callers)} callers ({len(current)} up to date, {skipped} skipped for "
               f"too little data{picked}) in {groups} group(s), {workers} worker(s) x {threads} thread(s)")
    results = {}
    for _, res in run_groups(make_jobs(todo, fps, screens, cache, meta, out_dir, threads), workers):
        results = {**results, **{r["slug"]: r for r in res}}
        write_index(out_dir, callers, screens, fps, results, meta, table)
    index = write_index(out_dir, callers, screens, fps, results, meta, table)
    print(summary(index, time.perf_counter() - t0, workers, threads, out_dir), flush=True)
    return 1 if any(r["status"] == "failed" for r in results.values()) else 0


if __name__ == "__main__":
    sys.exit(main())

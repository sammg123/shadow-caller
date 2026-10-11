"""Pull NFL data, store it in DuckDB, and fit both stages.

Run once before the game (takes a minute or two):  python build.py
Writes data/shadow.duckdb, models/stage1.joblib and models/profile.json.

Every step takes the caller, his table rows, the output folder and the DuckDB file as arguments; main() passes
tonight's (config.py). scripts/build_callers.py uses the same steps to build a model for every play-caller in a table.
"""
import json
import time
from datetime import datetime

import duckdb
import joblib
import nflreadpy as nfl
import numpy as np
import polars as pl
from sklearn.ensemble import HistGradientBoostingClassifier

from config import (CALLERS_CSV, CALLER_NAME, DB_PATH, EXPLOSIVE_YARDS, LEAGUE_SEASONS, MODEL_DIR,
                    SCRIPT_PLAYS)
from features import (BASE_FEATURES, HABIT_COLS, LABELS, MEMORY_COLS, STAGE2_COLS,
                      fit_offset_ridge, habit_values, log_loss, logit, memory_values,
                      sigmoid, visible_success)

PBP_COLS = [
    "game_id", "play_id", "season", "week", "posteam", "defteam", "home_team", "drive",
    "down", "ydstogo", "yardline_100", "score_differential", "qtr",
    "half_seconds_remaining", "game_seconds_remaining", "qb_dropback", "qb_scramble",
    "play_type", "yards_gained", "first_down", "touchdown", "td_team", "sack",
    "interception", "fumble_lost", "spread_line", "total_line", "xpass", "epa",
    "qb_kneel", "qb_spike", "two_point_attempt", "run_location", "run_gap", "air_yards",
]
ALPHAS = [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]
LAMBDAS = [1.0, 3.0, 10.0, 30.0, 100.0]
N_FOLDS = 5
N_BOOT = 300
TEST_SEASON = 2025       # stage 1's held-out season: trained on the seasons before it


def step(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


# ---------------------------------------------------------------- data
def load_raw_pbp(seasons):
    """nflverse play-by-play for `seasons`, the columns the build uses."""
    return nfl.load_pbp(seasons).select(PBP_COLS)


def prepare_plays(raw):
    """Real run/pass snaps (no kneels, spikes or two-point tries) with the derived columns, in game order."""
    return (
        raw.filter(
            pl.col("play_type").is_in(["run", "pass"])
            & (pl.col("qb_kneel") == 0) & (pl.col("qb_spike") == 0)
            & pl.col("down").is_not_null() & pl.col("ydstogo").is_not_null()
            & pl.col("yardline_100").is_not_null()
            & pl.col("score_differential").is_not_null()
            & pl.col("half_seconds_remaining").is_not_null()
            & pl.col("qb_dropback").is_not_null()
            & pl.col("spread_line").is_not_null()
            & (pl.col("two_point_attempt").fill_null(0) == 0)
        )
        .with_columns(
            is_home=(pl.col("posteam") == pl.col("home_team")).cast(pl.Float64),
            goal_to_go=(pl.col("ydstogo") >= pl.col("yardline_100")).cast(pl.Float64),
            two_min=(pl.col("half_seconds_remaining") <= 120).cast(pl.Float64),
            off_td=((pl.col("touchdown") == 1) & (pl.col("td_team") == pl.col("posteam"))).cast(pl.Int8),
            turnover=((pl.col("interception") == 1) | (pl.col("fumble_lost") == 1)).cast(pl.Int8),
        )
        .with_columns(
            posteam_spread=pl.when(pl.col("is_home") == 1)
            .then(pl.col("spread_line")).otherwise(-pl.col("spread_line")),
        )
        .sort(["game_id", "play_id"])
    )


def pull_plays(db_path, seasons=LEAGUE_SEASONS, log=step):
    """Download, prepare and store the league's snaps in db_path (table plays)."""
    log(f"Downloading play-by-play {seasons[0]}-{seasons[-1]} from nflverse")
    plays = prepare_plays(load_raw_pbp(seasons))
    db_path.parent.mkdir(exist_ok=True)
    store(db_path, "plays", plays)
    log(f"Stored {plays.height:,} run/pass snaps in {db_path.name}")
    return plays


def store(db_path, name, df):
    con = duckdb.connect(str(db_path))
    con.register("tmp_df", df.to_arrow())
    con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM tmp_df")
    con.close()


# ---------------------------------------------------------------- the caller
def caller_rows(table, caller):
    """His rows of the play-caller table (a CSV path): season, team, first_week, last_week, ..."""
    rows = pl.read_csv(table).filter(pl.col("play_caller") == caller)
    if rows.height == 0:
        raise SystemExit(f"No rows for {caller} in {table}")
    return rows


def caller_teams(rows):
    """Every team he called plays for in his rows: his baseline is trained without any of them."""
    return tuple(sorted(set(rows["team"].to_list())))


def latest_team(rows):
    """The team of his most recent stint (the profile's team)."""
    return rows.sort(["season", "first_week"])["team"][-1]


def caller_snaps(plays, rows):
    """His snaps: the run/pass snaps inside his rows' team, season and week ranges, with visible success."""
    parts = []
    for r in rows.iter_rows(named=True):
        parts.append(plays.filter(
            (pl.col("season") == r["season"]) & (pl.col("posteam") == r["team"])
            & (pl.col("week") >= r["first_week"]) & (pl.col("week") <= r["last_week"])
        ))
    snaps = pl.concat(parts).sort(["game_id", "play_id"])
    succ = [
        visible_success(d, t, y if y is not None else 0, td == 1, to == 1)
        for d, t, y, td, to in zip(snaps["down"], snaps["ydstogo"], snaps["yards_gained"],
                                   snaps["off_td"], snaps["turnover"])
    ]
    return snaps.with_columns(success=pl.Series(succ, dtype=pl.Int8))


# ---------------------------------------------------------------- stage 1
def league_rows(plays, exclude):
    """The caller-blind league: every snap except those of the excluded teams (his teams, every season)."""
    return plays.filter(~pl.col("posteam").is_in(list(exclude)))


def _stage1_model():
    return HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.06, max_leaf_nodes=48, min_samples_leaf=80,
        l2_regularization=1.0, early_stopping=True, validation_fraction=0.1,
        random_state=7,
    )


def fit_stage1(plays, exclude, log=step, test_season=TEST_SEASON):
    """The caller-blind baseline, fit on every team except `exclude`, and its check on a held-out season.
    Returns (model fit on every season, check)."""
    league = league_rows(plays, exclude)
    log(f"Stage 1: caller-blind baseline on {league.height:,} snaps (all teams except {', '.join(exclude)})")
    tr = league.filter(pl.col("season") < test_season)
    te = league.filter((pl.col("season") == test_season) & pl.col("xpass").is_not_null())
    m = _stage1_model().fit(tr.select(BASE_FEATURES).to_numpy(), tr["qb_dropback"].to_numpy())
    p_te = m.predict_proba(te.select(BASE_FEATURES).to_numpy())[:, 1]
    y_te = te["qb_dropback"].to_numpy()
    check = {
        "test_season": test_season,
        "n": int(te.height),
        "logloss_ours": log_loss(y_te, p_te),
        "logloss_nflfastr_xpass": log_loss(y_te, te["xpass"].to_numpy()),
        "logloss_constant": log_loss(y_te, np.full_like(p_te, y_te.mean())),
    }
    log(f"  {test_season} holdout log loss: ours {check['logloss_ours']:.4f} | nflfastR xpass "
        f"{check['logloss_nflfastr_xpass']:.4f} | constant {check['logloss_constant']:.4f}")
    final = _stage1_model().fit(league.select(BASE_FEATURES).to_numpy(), league["qb_dropback"].to_numpy())
    return final, check


def stage1(plays, exclude, out_dir, log=step):
    """fit_stage1, saved as out_dir/stage1.joblib."""
    final, check = fit_stage1(plays, exclude, log)
    out_dir.mkdir(exist_ok=True)
    joblib.dump(final, out_dir / "stage1.joblib")
    return final, check


# ---------------------------------------------------------------- stage 2
def memory_matrix(snaps, alpha, q0):
    rows = []
    games, drives = snaps["game_id"].to_list(), snaps["drive"].to_list()
    drop, succ = snaps["qb_dropback"].to_list(), snaps["success"].to_list()
    yards, sack = snaps["yards_gained"].to_list(), snaps["sack"].to_list()
    cur_game = None
    for i in range(len(games)):
        if games[i] != cur_game:
            cur_game, qp, qr, n, prev, cur_drive = games[i], q0, q0, 0, None, None
        if drives[i] != cur_drive:
            prev, cur_drive = None, drives[i]
        n += 1
        mem = memory_values(n, prev, qp - qr, SCRIPT_PLAYS)
        rows.append([mem[c] for c in MEMORY_COLS])
        r = succ[i]
        if drop[i] == 1:
            qp += alpha * (r - qp)
        else:
            qr += alpha * (r - qr)
        prev = {"type": 1 if drop[i] == 1 else -1, "success": r,
                "explosive": int((yards[i] or 0) >= EXPLOSIVE_YARDS), "sack": int(sack[i] == 1)}
    return np.array(rows, dtype=float)


def habit_matrix(snaps):
    rows = []
    for d, t, s, yl in zip(snaps["down"], snaps["ydstogo"], snaps["score_differential"],
                           snaps["yardline_100"]):
        h = habit_values(int(d), t, s, yl)
        rows.append([h[c] for c in HABIT_COLS])
    return np.array(rows, dtype=float)


def _game_folds(games, rng):
    uniq = np.unique(games)
    fold_of_game = dict(zip(rng.permutation(uniq), np.arange(len(uniq)) % N_FOLDS))
    return uniq, np.array([fold_of_game[g] for g in games])


def _cv_search(H, snaps, y, off, fold, q0):
    """Cross-validated log loss of his habits alone, and the best (log loss, alpha, lambda) with memory."""
    def cv(X, lam):
        p = np.empty_like(y)
        for k in range(N_FOLDS):
            tr, te = fold != k, fold == k
            w = fit_offset_ridge(X[tr], y[tr], off[tr], lam)
            p[te] = sigmoid(off[te] + X[te] @ w)
        return log_loss(y, p)

    habit_ll, habit_lam = min((cv(H, lam), lam) for lam in LAMBDAS)
    best = None
    for a in ALPHAS:
        X = np.hstack([H, memory_matrix(snaps, a, q0)])
        for lam in LAMBDAS:
            ll = cv(X, lam)
            if best is None or ll < best[0]:
                best = (ll, a, lam)
    return habit_ll, best


def _bootstrap(X, y, off, lam, games, uniq, rng):
    """90% intervals for every term from N_BOOT resamples of whole games."""
    idx_by_game = {g: np.where(games == g)[0] for g in uniq}
    boots = []
    for _ in range(N_BOOT):
        pick = rng.choice(uniq, size=len(uniq), replace=True)
        ix = np.concatenate([idx_by_game[g] for g in pick])
        boots.append(fit_offset_ridge(X[ix], y[ix], off[ix], lam))
    boots = np.array(boots)
    return np.percentile(boots, 5, axis=0), np.percentile(boots, 95, axis=0)


def _by_down(snaps, y, p0):
    out = []
    for d in (1, 2, 3, 4):
        m = snaps["down"].to_numpy() == d
        if m.sum():
            out.append({"down": d, "n": int(m.sum()), "actual": float(y[m].mean()),
                        "league_expected": float(p0[m].mean())})
    return out


def stage2(stage1_model, snaps, caller, log=step):
    """His habits and in-game memory on top of the baseline. Returns (profile, his snaps with p0 and p_full)."""
    y = snaps["qb_dropback"].to_numpy().astype(float)
    p0 = stage1_model.predict_proba(snaps.select(BASE_FEATURES).to_numpy())[:, 1]
    off = logit(p0)
    H = habit_matrix(snaps)
    q0 = float(snaps["success"].mean())
    games = np.array(snaps["game_id"].to_list())
    rng = np.random.default_rng(11)
    uniq, fold = _game_folds(games, rng)
    log(f"Stage 2: {caller}, {len(y):,} snaps in {len(uniq)} games")

    base_ll = log_loss(y, p0)
    habit_ll, (full_ll, alpha, lam) = _cv_search(H, snaps, y, off, fold, q0)
    log(f"  CV log loss: league baseline {base_ll:.4f} | + habits {habit_ll:.4f} | "
        f"+ memory {full_ll:.4f}  (alpha={alpha}, lambda={lam})")

    X = np.hstack([H, memory_matrix(snaps, alpha, q0)])
    w = fit_offset_ridge(X, y, off, lam)
    log(f"  Bootstrapping {N_BOOT} game resamples for 90% intervals")
    lo, hi = _bootstrap(X, y, off, lam, games, uniq, rng)

    xp = snaps["xpass"].to_numpy()
    ok = ~np.isnan(xp)
    profile = {
        "caller": caller,
        "seasons": sorted(set(snaps["season"].to_list())),
        "n_snaps": int(len(y)), "n_games": int(len(uniq)),
        "alpha": alpha, "lambda": lam, "q0": q0,
        "coefs": {c: {"est": float(w[i]), "lo": float(lo[i]), "hi": float(hi[i]),
                      "label": LABELS[c], "group": "habit" if c in HABIT_COLS else "memory"}
                  for i, c in enumerate(STAGE2_COLS)},
        "cv_logloss": {"league_baseline": base_ll, "habits": habit_ll, "habits_plus_memory": full_ll,
                       "nflfastr_xpass_reference": log_loss(y[ok], xp[ok]) if ok.any() else None},
        "dropback_rate": {"actual": float(y.mean()), "league_expected": float(p0.mean())},
        "by_down": _by_down(snaps, y, p0),
    }
    scored = snaps.with_columns(p0=pl.Series(p0), p_full=pl.Series(sigmoid(off + X @ w)))
    return profile, scored


# ---------------------------------------------------------------- the whole build
def finish_profile(profile, team, check, granular):
    """The stage 2 profile plus the rest of profile.json, in the order the app has always written it."""
    import sklearn
    return {**profile, "team": team, "stage1_check": check, "granular": granular,
            "built_at": datetime.now().isoformat(timespec="seconds"), "sklearn": sklearn.__version__}


def build(caller, table, out_dir, db_path, seasons=LEAGUE_SEASONS, log=step):
    """Pull the data and fit every model for `caller` (his rows of `table`): out_dir gets stage1.joblib,
    granular.joblib and profile.json; db_path gets the plays and caller_snaps tables. Returns the profile."""
    from build_granular import build_granular
    t0 = time.time()
    plays = pull_plays(db_path, seasons, log)
    rows = caller_rows(table, caller)
    snaps = caller_snaps(plays, rows)
    teams = caller_teams(rows)
    s1, check = stage1(plays, teams, out_dir, log)
    profile, scored = stage2(s1, snaps, caller, log)
    store(db_path, "caller_snaps", scored)
    granular = build_granular(plays, snaps, teams, out_dir, log=log)
    profile = finish_profile(profile, latest_team(rows), check, granular)
    (out_dir / "profile.json").write_text(json.dumps(profile, indent=2))
    log(f"Done in {time.time() - t0:.0f}s. Profile saved to {out_dir.name}/profile.json")
    return profile


def main():
    profile = build(CALLER_NAME, CALLERS_CSV, MODEL_DIR, DB_PATH)
    print("\nCaller terms (logit scale, 90% interval):")
    for v in profile["coefs"].values():
        print(f"  {v['label']:<34} {v['est']:+.3f}  [{v['lo']:+.3f}, {v['hi']:+.3f}]")


if __name__ == "__main__":
    main()

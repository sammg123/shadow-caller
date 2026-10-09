"""Pull NFL data, store it in DuckDB, and fit both stages.

Run once before the game (takes a minute or two):  python build.py
Writes data/shadow.duckdb, models/stage1.joblib and models/profile.json.
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

from config import (CALLERS_CSV, CALLER_NAME, DATA_DIR, DB_PATH, EXPLOSIVE_YARDS,
                    LEAGUE_SEASONS, MODEL_DIR, SCRIPT_PLAYS)
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


def step(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


# ---------------------------------------------------------------- data
def pull_plays():
    step(f"Downloading play-by-play {LEAGUE_SEASONS[0]}-{LEAGUE_SEASONS[-1]} from nflverse")
    pbp = nfl.load_pbp(LEAGUE_SEASONS).select(PBP_COLS)
    plays = (
        pbp.filter(
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
    DATA_DIR.mkdir(exist_ok=True)
    _store("plays", plays)
    step(f"Stored {plays.height:,} run/pass snaps in {DB_PATH.name}")
    return plays


def _store(name, df):
    con = duckdb.connect(str(DB_PATH))
    con.register("tmp_df", df.to_arrow())
    con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM tmp_df")
    con.close()


# ---------------------------------------------------------------- stage 1
def stage1(plays, caller_team):
    league = plays.filter(pl.col("posteam") != caller_team)
    step(f"Stage 1: caller-blind baseline on {league.height:,} snaps (all teams except {caller_team})")

    def model():
        return HistGradientBoostingClassifier(
            max_iter=400, learning_rate=0.06, max_leaf_nodes=48, min_samples_leaf=80,
            l2_regularization=1.0, early_stopping=True, validation_fraction=0.1,
            random_state=7,
        )

    test_season = 2025
    tr = league.filter(pl.col("season") < test_season)
    te = league.filter((pl.col("season") == test_season) & pl.col("xpass").is_not_null())
    m = model().fit(tr.select(BASE_FEATURES).to_numpy(), tr["qb_dropback"].to_numpy())
    p_te = m.predict_proba(te.select(BASE_FEATURES).to_numpy())[:, 1]
    y_te = te["qb_dropback"].to_numpy()
    check = {
        "test_season": test_season,
        "n": int(te.height),
        "logloss_ours": log_loss(y_te, p_te),
        "logloss_nflfastr_xpass": log_loss(y_te, te["xpass"].to_numpy()),
        "logloss_constant": log_loss(y_te, np.full_like(p_te, y_te.mean())),
    }
    step(f"  2025 holdout log loss: ours {check['logloss_ours']:.4f} | nflfastR xpass "
         f"{check['logloss_nflfastr_xpass']:.4f} | constant {check['logloss_constant']:.4f}")

    final = model().fit(league.select(BASE_FEATURES).to_numpy(), league["qb_dropback"].to_numpy())
    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump(final, MODEL_DIR / "stage1.joblib")
    return final, check


# ---------------------------------------------------------------- stage 2
def caller_snaps(plays):
    callers = pl.read_csv(CALLERS_CSV).filter(pl.col("play_caller") == CALLER_NAME)
    if callers.height == 0:
        raise SystemExit(f"No rows for {CALLER_NAME} in {CALLERS_CSV}")
    parts = []
    for r in callers.iter_rows(named=True):
        parts.append(plays.filter(
            (pl.col("season") == r["season"]) & (pl.col("posteam") == r["team"])
            & (pl.col("week") >= r["first_week"]) & (pl.col("week") <= r["last_week"])
        ))
    team = callers["team"][0]
    snaps = pl.concat(parts).sort(["game_id", "play_id"])
    succ = [
        visible_success(d, t, y if y is not None else 0, td == 1, to == 1)
        for d, t, y, td, to in zip(snaps["down"], snaps["ydstogo"], snaps["yards_gained"],
                                   snaps["off_td"], snaps["turnover"])
    ]
    snaps = snaps.with_columns(success=pl.Series(succ, dtype=pl.Int8))
    return team, snaps


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


def stage2(stage1_model, snaps):
    y = snaps["qb_dropback"].to_numpy().astype(float)
    p0 = stage1_model.predict_proba(snaps.select(BASE_FEATURES).to_numpy())[:, 1]
    off = logit(p0)
    H = habit_matrix(snaps)
    q0 = float(snaps["success"].mean())
    games = np.array(snaps["game_id"].to_list())
    uniq = np.unique(games)
    rng = np.random.default_rng(11)
    fold_of_game = dict(zip(rng.permutation(uniq), np.arange(len(uniq)) % N_FOLDS))
    fold = np.array([fold_of_game[g] for g in games])
    step(f"Stage 2: {CALLER_NAME}, {len(y):,} snaps in {len(uniq)} games")

    def cv(X, lam):
        p = np.empty_like(y)
        for k in range(N_FOLDS):
            tr, te = fold != k, fold == k
            w = fit_offset_ridge(X[tr], y[tr], off[tr], lam)
            p[te] = sigmoid(off[te] + X[te] @ w)
        return log_loss(y, p)

    base_ll = log_loss(y, p0)
    habit_ll, habit_lam = min((cv(H, lam), lam) for lam in LAMBDAS)
    best = None
    for a in ALPHAS:
        X = np.hstack([H, memory_matrix(snaps, a, q0)])
        for lam in LAMBDAS:
            ll = cv(X, lam)
            if best is None or ll < best[0]:
                best = (ll, a, lam)
    full_ll, alpha, lam = best
    step(f"  CV log loss: league baseline {base_ll:.4f} | + habits {habit_ll:.4f} | "
         f"+ memory {full_ll:.4f}  (alpha={alpha}, lambda={lam})")

    X = np.hstack([H, memory_matrix(snaps, alpha, q0)])
    w = fit_offset_ridge(X, y, off, lam)

    step(f"  Bootstrapping {N_BOOT} game resamples for 90% intervals")
    idx_by_game = {g: np.where(games == g)[0] for g in uniq}
    boots = []
    for _ in range(N_BOOT):
        pick = rng.choice(uniq, size=len(uniq), replace=True)
        ix = np.concatenate([idx_by_game[g] for g in pick])
        boots.append(fit_offset_ridge(X[ix], y[ix], off[ix], lam))
    boots = np.array(boots)
    lo, hi = np.percentile(boots, 5, axis=0), np.percentile(boots, 95, axis=0)

    xp = snaps["xpass"].to_numpy()
    ok = ~np.isnan(xp)
    by_down = []
    for d in (1, 2, 3, 4):
        m = snaps["down"].to_numpy() == d
        if m.sum():
            by_down.append({"down": d, "n": int(m.sum()), "actual": float(y[m].mean()),
                            "league_expected": float(p0[m].mean())})
    profile = {
        "caller": CALLER_NAME,
        "seasons": sorted(set(snaps["season"].to_list())),
        "n_snaps": int(len(y)), "n_games": int(len(uniq)),
        "alpha": alpha, "lambda": lam, "q0": q0,
        "coefs": {c: {"est": float(w[i]), "lo": float(lo[i]), "hi": float(hi[i]),
                      "label": LABELS[c], "group": "habit" if c in HABIT_COLS else "memory"}
                  for i, c in enumerate(STAGE2_COLS)},
        "cv_logloss": {"league_baseline": base_ll, "habits": habit_ll, "habits_plus_memory": full_ll,
                       "nflfastr_xpass_reference": log_loss(y[ok], xp[ok]) if ok.any() else None},
        "dropback_rate": {"actual": float(y.mean()), "league_expected": float(p0.mean())},
        "by_down": by_down,
    }
    out = snaps.with_columns(p0=pl.Series(p0), p_full=pl.Series(sigmoid(off + X @ w)))
    _store("caller_snaps", out)
    return profile


def main():
    t0 = time.time()
    plays = pull_plays()
    team, snaps = caller_snaps(plays)
    s1, check = stage1(plays, team)
    profile = stage2(s1, snaps)
    profile["team"] = team
    profile["stage1_check"] = check
    from build_granular import build_granular
    profile["granular"] = build_granular(plays, snaps, team, log=step)
    profile["built_at"] = datetime.now().isoformat(timespec="seconds")
    import sklearn
    profile["sklearn"] = sklearn.__version__
    (MODEL_DIR / "profile.json").write_text(json.dumps(profile, indent=2))
    step(f"Done in {time.time() - t0:.0f}s. Profile saved to models/profile.json")
    print("\nCaller terms (logit scale, 90% interval):")
    for c, v in profile["coefs"].items():
        print(f"  {v['label']:<34} {v['est']:+.3f}  [{v['lo']:+.3f}, {v['hi']:+.3f}]")


if __name__ == "__main__":
    main()

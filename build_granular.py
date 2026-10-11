"""Build the granular call model (play type -> specific play). Called from build.py; also runnable alone.

The league models (play type, run gap and side, pass depth) are fit on every team except the caller's, so callers
who share that exclusion can share them (scripts/build_callers.py does); his adjustments are fit on his snaps only.
"""
import json

import joblib
import nflreadpy as nfl
import numpy as np
import polars as pl
from sklearn.ensemble import HistGradientBoostingClassifier

from features import BASE_FEATURES
from granular import (DEPTHS, FAMILIES, LEAVES, RUN_LEAVES, depth_of, depth_x, fam_x,
                      fit_softmax_offset, mlogloss, run_leaf, run_x, softmax)

FTN_SEASONS = [2022, 2023, 2024, 2025, 2026]
FTN_COLS = ["nflverse_game_id", "nflverse_play_id", "is_rpo", "is_play_action", "is_screen_pass"]
LAMBDAS = [1.0, 3.0, 10.0, 30.0, 100.0]
N_FOLDS = 5
EPS = 1e-12
FAM_IDX = {f: i for i, f in enumerate(FAMILIES)}
RUN_IDX = {k: i for i, k in enumerate(RUN_LEAVES)}
DEPTH_IDX = {d: i for i, d in enumerate(DEPTHS)}
LEAF_IDX = {k: i for i, k in enumerate(LEAVES)}


def load_ftn(seasons=FTN_SEASONS):
    """FTN charting from nflverse: the play-action, screen and RPO flags of every charted snap."""
    return nfl.load_ftn_charting(seasons).select(FTN_COLS)


def label(plays, ftn=None):
    """Charted snaps with their play type (family) and specific play (leaf). ftn: load_ftn()'s frame, else pulled."""
    ftn = (load_ftn() if ftn is None else ftn).select(FTN_COLS).with_columns(
        pl.col("nflverse_play_id").cast(pl.Float64))
    df = plays.filter(pl.col("season") >= FTN_SEASONS[0]).join(
        ftn, left_on=["game_id", "play_id"], right_on=["nflverse_game_id", "nflverse_play_id"], how="inner")
    fam, leaf = [], []
    for r in df.select(["is_rpo", "is_screen_pass", "is_play_action", "qb_dropback",
                        "air_yards", "run_location", "run_gap"]).iter_rows():
        rpo, scr, pa, drop, air, loc, gap = r
        if rpo:
            fam.append("rpo"); leaf.append("rpo_throw" if drop == 1 else "rpo_run")
        elif scr:
            fam.append("screen"); leaf.append("screen")
        elif pa:
            d = depth_of(air)
            fam.append("pa"); leaf.append(f"pa_{d}" if d else None)
        elif drop == 1:
            d = depth_of(air)
            fam.append("dropback"); leaf.append(f"dropback_{d}" if d else None)
        else:
            fam.append("run"); leaf.append(run_leaf(loc, gap))
    return df.with_columns(family=pl.Series(fam), leaf=pl.Series(leaf, dtype=pl.Utf8),
                           is_pa=(pl.col("is_play_action").fill_null(False)).cast(pl.Float64))


def hgb():
    return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=32,
                                          min_samples_leaf=100, l2_regularization=1.0,
                                          early_stopping=True, validation_fraction=0.1, random_state=7)


def league_models(df, exclude, log):
    """Caller-blind play type (A), run gap and side (B) and pass depth (C) models on every team except `exclude`,
    plus the league's RPO throw rate."""
    lg = df.filter(~pl.col("posteam").is_in(list(exclude)))
    A = hgb().fit(lg.select(BASE_FEATURES).to_numpy(), np.array([FAM_IDX[f] for f in lg["family"]]))

    runs = lg.filter((pl.col("family") == "run") & pl.col("leaf").is_not_null())
    B = hgb().fit(runs.select(BASE_FEATURES).to_numpy(), np.array([RUN_IDX[k] for k in runs["leaf"]]))

    passes = lg.filter(pl.col("family").is_in(["dropback", "pa"]) & pl.col("leaf").is_not_null())
    XC = np.hstack([passes.select(BASE_FEATURES).to_numpy(), passes["is_pa"].to_numpy()[:, None]])
    C = hgb().fit(XC, np.array([DEPTH_IDX[k.split("_")[1]] for k in passes["leaf"]]))

    rpo = lg.filter(pl.col("family") == "rpo")
    rpo_throw = float((rpo["leaf"] == "rpo_throw").mean())
    log(f"  League: {lg.height:,} charted snaps; {runs.height:,} runs with gap; {passes.height:,} passes with depth; "
        f"RPO thrown {rpo_throw:.0%}")
    return A, B, C, rpo_throw


# ---------------------------------------------------------------- his adjustments
def _design(his, league):
    """His design matrices, labels and league probabilities for the three levels (A play type, B run, C depth),
    plus the league's predictions on every one of his snaps (the leaf check reads them row by row)."""
    A, B, C, _ = league
    base = his.select(BASE_FEATURES).to_numpy()
    sv = list(zip(his["down"].to_list(), his["ydstogo"].to_list(),
                  his["score_differential"].to_list(), his["yardline_100"].to_list()))
    run_m = (his["family"] == "run").to_numpy() & his["leaf"].is_not_null().to_numpy()
    pas_m = his["family"].is_in(["dropback", "pa"]).to_numpy() & his["leaf"].is_not_null().to_numpy()
    sub = his.filter(pl.Series(pas_m))
    ispa = sub["is_pa"].to_numpy()
    PB_all = B.predict_proba(base)
    PCd_all = C.predict_proba(np.hstack([base, np.zeros((len(base), 1))]))
    PCp_all = C.predict_proba(np.hstack([base, np.ones((len(base), 1))]))
    PA0 = A.predict_proba(base)
    return {
        "sv": sv, "run_m": run_m, "pas_m": pas_m,
        "XA": np.array([fam_x(int(d), t, s, y) for d, t, s, y in sv]),
        "yA": np.array([FAM_IDX[f] for f in his["family"]]), "PA0": PA0,
        "XB": np.array([run_x(int(d), t, s, y) for (d, t, s, y), m in zip(sv, run_m) if m]),
        "yB": np.array([RUN_IDX[k] for k in his.filter(pl.Series(run_m))["leaf"]]), "PB0": PB_all[run_m],
        "XC": np.array([depth_x(int(d), t, s, y, p) for (d, t, s, y), p in
                        zip([v for v, m in zip(sv, pas_m) if m], ispa)]),
        "yC": np.array([DEPTH_IDX[k.split("_")[1]] for k in sub["leaf"]]),
        "PC0": np.where(ispa[:, None] == 1, PCp_all[pas_m], PCd_all[pas_m]),
        "PB_all": PB_all, "PCd_all": PCd_all, "PCp_all": PCp_all,
    }


def _folds(his):
    games = np.array(his["game_id"].to_list())
    uniq = np.unique(games)
    rng = np.random.default_rng(11)
    fold_of = dict(zip(rng.permutation(uniq), np.arange(len(uniq)) % N_FOLDS))
    return np.array([fold_of[g] for g in games])


def _cv_pick(X, y, P0, fmask):
    best = None
    for lam in LAMBDAS:
        P = np.empty_like(P0)
        for k in range(N_FOLDS):
            tr, te = fmask != k, fmask == k
            if te.sum() == 0:
                continue
            W = fit_softmax_offset(X[tr], y[tr], np.log(P0[tr] + EPS), lam)
            P[te] = softmax(np.log(P0[te] + EPS) + X[te] @ W)
        ll = mlogloss(P, y)
        if best is None or ll < best[0]:
            best = (ll, lam, P)
    return best


def _leaf_probs(PAx, PBx, PCdx, PCpx, rthrow):
    L = np.zeros(len(LEAVES))
    fam = dict(zip(FAMILIES, PAx))
    for i, k in enumerate(RUN_LEAVES):
        L[LEAF_IDX[k]] = fam["run"] * PBx[i]
    for i, d in enumerate(DEPTHS):
        L[LEAF_IDX[f"dropback_{d}"]] = fam["dropback"] * PCdx[i]
        L[LEAF_IDX[f"pa_{d}"]] = fam["pa"] * PCpx[i]
    L[LEAF_IDX["screen"]] = fam["screen"]
    L[LEAF_IDX["rpo_run"]] = fam["rpo"] * (1 - rthrow)
    L[LEAF_IDX["rpo_throw"]] = fam["rpo"] * rthrow
    return L


def _specific_play_cv(his, d, fold, lams, rpo_league, rpo_his):
    """Leaf-level CV check (no in-game memory): the rank of the actual specific play, league vs his."""
    lamA, lamB, lamC = lams
    leaf_known = his["leaf"].is_not_null().to_numpy()
    leaves = his["leaf"].to_list()
    fb, fc = fold[d["run_m"]], fold[d["pas_m"]]
    ll_league, ll_his, top1_l, top1_h, top3_h = [], [], 0, 0, 0
    for k in range(N_FOLDS):
        te = fold == k
        if te.sum() == 0:
            continue
        WA = fit_softmax_offset(d["XA"][~te], d["yA"][~te], np.log(d["PA0"][~te] + EPS), lamA)
        WB = fit_softmax_offset(d["XB"][fb != k], d["yB"][fb != k], np.log(d["PB0"][fb != k] + EPS), lamB)
        WC = fit_softmax_offset(d["XC"][fc != k], d["yC"][fc != k], np.log(d["PC0"][fc != k] + EPS), lamC)
        for i in np.where(te & leaf_known)[0]:
            dn, t, s, y = d["sv"][i]
            a0, b0, cd0, cp0 = d["PA0"][i], d["PB_all"][i], d["PCd_all"][i], d["PCp_all"][i]
            Ll = _leaf_probs(a0, b0, cd0, cp0, rpo_league)
            Lh = _leaf_probs(softmax(np.log(a0 + EPS) + fam_x(int(dn), t, s, y) @ WA),
                             softmax(np.log(b0 + EPS) + run_x(int(dn), t, s, y) @ WB),
                             softmax(np.log(cd0 + EPS) + depth_x(int(dn), t, s, y, 0) @ WC),
                             softmax(np.log(cp0 + EPS) + depth_x(int(dn), t, s, y, 1) @ WC), rpo_his)
            j = LEAF_IDX[leaves[int(i)]]
            ll_league.append(-np.log(max(Ll[j], 1e-9))); ll_his.append(-np.log(max(Lh[j], 1e-9)))
            top1_l += int(np.argmax(Ll) == j); top1_h += int(np.argmax(Lh) == j)
            top3_h += int(j in np.argsort(-Lh)[:3])
    nl = len(ll_his)
    return {"n": nl, "logloss_league": float(np.mean(ll_league)), "logloss_his": float(np.mean(ll_his)),
            "top1_his": top1_h / nl, "top1_league": top1_l / nl, "top3_his": top3_h / nl}


def fit_caller(df, snaps, league, log=print):
    """His adjustments on top of the league models, from his charted snaps. Returns (G for granular.joblib, summary)."""
    A, B, C, rpo_league = league
    his = df.join(snaps.select(["game_id", "play_id"]), on=["game_id", "play_id"], how="semi").sort(
        ["game_id", "play_id"])
    d, fold = _design(his, league), _folds(his)
    llA, lamA, _ = _cv_pick(d["XA"], d["yA"], d["PA0"], fold)
    llB, lamB, _ = _cv_pick(d["XB"], d["yB"], d["PB0"], fold[d["run_m"]])
    llC, lamC, _ = _cv_pick(d["XC"], d["yC"], d["PC0"], fold[d["pas_m"]])
    log(f"  Play type CV log loss: league {mlogloss(d['PA0'], d['yA']):.4f} -> his {llA:.4f} (lambda {lamA})")
    log(f"  Run gap/side CV log loss: league {mlogloss(d['PB0'], d['yB']):.4f} -> his {llB:.4f} (lambda {lamB})")
    log(f"  Pass depth CV log loss: league {mlogloss(d['PC0'], d['yC']):.4f} -> his {llC:.4f} (lambda {lamC})")

    W_A = fit_softmax_offset(d["XA"], d["yA"], np.log(d["PA0"] + EPS), lamA)
    W_B = fit_softmax_offset(d["XB"], d["yB"], np.log(d["PB0"] + EPS), lamB)
    W_C = fit_softmax_offset(d["XC"], d["yC"], np.log(d["PC0"] + EPS), lamC)

    rp = his.filter(pl.col("family") == "rpo")
    rpo_his = (int((rp["leaf"] == "rpo_throw").sum()) + 20 * rpo_league) / (rp.height + 20)
    sp = _specific_play_cv(his, d, fold, (lamA, lamB, lamC), rpo_league, rpo_his)
    log(f"  Specific play CV ({sp['n']} snaps): log loss league {sp['logloss_league']:.3f} -> his "
        f"{sp['logloss_his']:.3f}; top pick right {sp['top1_his']:.0%} (league {sp['top1_league']:.0%}); "
        f"actual play in his top 3 {sp['top3_his']:.0%}")

    G = {"A_league": A, "B_league": B, "C_league": C, "W_A": W_A, "W_B": W_B, "W_C": W_C,
         "rpo_throw_league": rpo_league, "rpo_throw_his": float(rpo_his)}
    summary = {
        "n_snaps": int(his.height),
        "family_rates": {f: {"his": float(np.mean(d["yA"] == i)), "league_expected": float(d["PA0"][:, i].mean())}
                         for i, f in enumerate(FAMILIES)},
        "cv": {"family": {"league": mlogloss(d["PA0"], d["yA"]), "his": llA, "lambda": lamA},
               "run_gap": {"league": mlogloss(d["PB0"], d["yB"]), "his": llB, "lambda": lamB, "n": int(len(d["yB"]))},
               "pass_depth": {"league": mlogloss(d["PC0"], d["yC"]), "his": llC, "lambda": lamC,
                              "n": int(len(d["yC"]))},
               "specific_play": sp},
        "rpo_throw": {"his": float(rpo_his), "league": rpo_league, "his_n": int(rp.height)},
    }
    return G, summary


def build_granular(plays, snaps, exclude, out_dir, log=print, ftn=None):
    """Label the charted snaps, fit the league models without `exclude` and his adjustments; save
    out_dir/granular.joblib and return the summary for profile.json."""
    log("Granular: downloading FTN charting 2022-2026 and labelling play types")
    df = label(plays, ftn)
    G, summary = fit_caller(df, snaps, league_models(df, exclude, log), log)
    joblib.dump(G, out_dir / "granular.joblib")
    return summary


if __name__ == "__main__":
    import build
    from config import CALLER_NAME, CALLERS_CSV, DB_PATH, MODEL_DIR
    plays = build.pull_plays(DB_PATH)
    rows = build.caller_rows(CALLERS_CSV, CALLER_NAME)
    s = build_granular(plays, build.caller_snaps(plays, rows), build.caller_teams(rows), MODEL_DIR)
    prof_path = MODEL_DIR / "profile.json"
    prof = json.loads(prof_path.read_text())
    prof["granular"] = s
    prof_path.write_text(json.dumps(prof, indent=2))

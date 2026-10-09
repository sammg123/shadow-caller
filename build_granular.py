"""Build the granular call model (play type -> specific play). Called from build.py; also runnable alone."""
import json

import joblib
import nflreadpy as nfl
import numpy as np
import polars as pl
from sklearn.ensemble import HistGradientBoostingClassifier

from config import MODEL_DIR
from features import BASE_FEATURES
from granular import (DEPTHS, FAMILIES, LEAVES, RUN_LEAVES, depth_of, depth_x, fam_x,
                      fit_softmax_offset, mlogloss, run_leaf, run_x, softmax)

FTN_SEASONS = [2022, 2023, 2024, 2025, 2026]
LAMBDAS = [1.0, 3.0, 10.0, 30.0, 100.0]
N_FOLDS = 5


def label(plays):
    ftn = (nfl.load_ftn_charting(FTN_SEASONS)
           .select(["nflverse_game_id", "nflverse_play_id", "is_rpo", "is_play_action", "is_screen_pass"])
           .with_columns(pl.col("nflverse_play_id").cast(pl.Float64)))
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


def league_models(df, team, log):
    lg = df.filter(pl.col("posteam") != team)
    fam_idx = {f: i for i, f in enumerate(FAMILIES)}
    XA = lg.select(BASE_FEATURES).to_numpy()
    yA = np.array([fam_idx[f] for f in lg["family"]])
    A = hgb().fit(XA, yA)

    runs = lg.filter((pl.col("family") == "run") & pl.col("leaf").is_not_null())
    run_idx = {k: i for i, k in enumerate(RUN_LEAVES)}
    B = hgb().fit(runs.select(BASE_FEATURES).to_numpy(), np.array([run_idx[k] for k in runs["leaf"]]))

    passes = lg.filter(pl.col("family").is_in(["dropback", "pa"]) & pl.col("leaf").is_not_null())
    d_idx = {d: i for i, d in enumerate(DEPTHS)}
    XC = np.hstack([passes.select(BASE_FEATURES).to_numpy(), passes["is_pa"].to_numpy()[:, None]])
    C = hgb().fit(XC, np.array([d_idx[k.split("_")[1]] for k in passes["leaf"]]))

    rpo = lg.filter(pl.col("family") == "rpo")
    rpo_throw = float((rpo["leaf"] == "rpo_throw").mean())
    log(f"  League: {lg.height:,} charted snaps; {runs.height:,} runs with gap; {passes.height:,} passes with depth; "
        f"RPO thrown {rpo_throw:.0%}")
    return A, B, C, rpo_throw


def build_granular(plays, snaps_team, team, log=print):
    log("Granular: downloading FTN charting 2022-2026 and labelling play types")
    df = label(plays)
    A, B, C, rpo_league = league_models(df, team, log)

    his = df.filter(pl.col("posteam") == team).join(
        snaps_team.select(["game_id", "play_id"]), on=["game_id", "play_id"], how="semi").sort(["game_id", "play_id"])
    n = his.height
    base = his.select(BASE_FEATURES).to_numpy()
    sv = list(zip(his["down"].to_list(), his["ydstogo"].to_list(),
                  his["score_differential"].to_list(), his["yardline_100"].to_list()))
    fam_idx = {f: i for i, f in enumerate(FAMILIES)}
    yA = np.array([fam_idx[f] for f in his["family"]])
    XA = np.array([fam_x(int(d), t, s, y) for d, t, s, y in sv])
    PA0 = A.predict_proba(base)

    run_m = (his["family"] == "run").to_numpy() & his["leaf"].is_not_null().to_numpy()
    run_idx = {k: i for i, k in enumerate(RUN_LEAVES)}
    yB = np.array([run_idx[k] for k in his.filter(pl.Series(run_m))["leaf"]])
    XB = np.array([run_x(int(d), t, s, y) for (d, t, s, y), m in zip(sv, run_m) if m])
    PB0 = B.predict_proba(base[run_m])

    pas_m = his["family"].is_in(["dropback", "pa"]).to_numpy() & his["leaf"].is_not_null().to_numpy()
    d_idx = {d: i for i, d in enumerate(DEPTHS)}
    sub = his.filter(pl.Series(pas_m))
    yC = np.array([d_idx[k.split("_")[1]] for k in sub["leaf"]])
    ispa = sub["is_pa"].to_numpy()
    XC = np.array([depth_x(int(d), t, s, y, p) for (d, t, s, y), p in
                   zip([v for v, m in zip(sv, pas_m) if m], ispa)])
    PC0 = C.predict_proba(np.hstack([base[pas_m], ispa[:, None]]))

    games = np.array(his["game_id"].to_list())
    uniq = np.unique(games)
    rng = np.random.default_rng(11)
    fold_of = dict(zip(rng.permutation(uniq), np.arange(len(uniq)) % N_FOLDS))
    fold = np.array([fold_of[g] for g in games])

    def cv_pick(X, y, P0, fmask):
        best = None
        for lam in LAMBDAS:
            P = np.empty_like(P0)
            for k in range(N_FOLDS):
                tr, te = fmask != k, fmask == k
                if te.sum() == 0:
                    continue
                W = fit_softmax_offset(X[tr], y[tr], np.log(P0[tr] + 1e-12), lam)
                P[te] = softmax(np.log(P0[te] + 1e-12) + X[te] @ W)
            ll = mlogloss(P, y)
            if best is None or ll < best[0]:
                best = (ll, lam, P)
        return best

    llA, lamA, PA_cv = cv_pick(XA, yA, PA0, fold)
    llB, lamB, PB_cv = cv_pick(XB, yB, PB0, fold[run_m])
    llC, lamC, PC_cv = cv_pick(XC, yC, PC0, fold[pas_m])
    log(f"  Play type CV log loss: league {mlogloss(PA0, yA):.4f} -> his {llA:.4f} (lambda {lamA})")
    log(f"  Run gap/side CV log loss: league {mlogloss(PB0, yB):.4f} -> his {llB:.4f} (lambda {lamB})")
    log(f"  Pass depth CV log loss: league {mlogloss(PC0, yC):.4f} -> his {llC:.4f} (lambda {lamC})")

    W_A = fit_softmax_offset(XA, yA, np.log(PA0 + 1e-12), lamA)
    W_B = fit_softmax_offset(XB, yB, np.log(PB0 + 1e-12), lamB)
    W_C = fit_softmax_offset(XC, yC, np.log(PC0 + 1e-12), lamC)

    rp = his.filter(pl.col("family") == "rpo")
    k_thr = int((rp["leaf"] == "rpo_throw").sum())
    rpo_his = (k_thr + 20 * rpo_league) / (rp.height + 20)

    # leaf-level CV check (no in-game memory): rank of the actual specific play
    leaf_known = his["leaf"].is_not_null().to_numpy()
    leaf_idx = {k: i for i, k in enumerate(LEAVES)}

    def leaf_probs(PAx, PBx, PCdx, PCpx, rthrow):
        L = np.zeros(len(LEAVES))
        fam = dict(zip(FAMILIES, PAx))
        for i, k in enumerate(RUN_LEAVES):
            L[leaf_idx[k]] = fam["run"] * PBx[i]
        for i, d in enumerate(DEPTHS):
            L[leaf_idx[f"dropback_{d}"]] = fam["dropback"] * PCdx[i]
            L[leaf_idx[f"pa_{d}"]] = fam["pa"] * PCpx[i]
        L[leaf_idx["screen"]] = fam["screen"]
        L[leaf_idx["rpo_run"]] = fam["rpo"] * (1 - rthrow)
        L[leaf_idx["rpo_throw"]] = fam["rpo"] * rthrow
        return L

    ll_league, ll_his, top1_l, top1_h, top3_h = [], [], 0, 0, 0
    for k in range(N_FOLDS):
        tr, te = fold != k, fold == k
        if te.sum() == 0:
            continue
        WA = fit_softmax_offset(XA[tr], yA[tr], np.log(PA0[tr] + 1e-12), lamA)
        rtr, rte = run_m & tr, run_m & te
        WB = fit_softmax_offset(np.array([run_x(int(d), t, s, y) for (d, t, s, y), m in zip(sv, rtr) if m]),
                                np.array([run_idx[x] for x, m in zip(his["leaf"].to_list(), rtr) if m]),
                                np.log(B.predict_proba(base[rtr]) + 1e-12), lamB)
        ptr = pas_m & tr
        WC = fit_softmax_offset(
            np.array([depth_x(int(d), t, s, y, p) for (d, t, s, y), m, p in
                      zip(sv, ptr, his["is_pa"].to_list()) if m]),
            np.array([d_idx[x.split("_")[1]] for x, m in zip(his["leaf"].to_list(), ptr) if m]),
            np.log(C.predict_proba(np.hstack([base[ptr], his["is_pa"].to_numpy()[ptr][:, None]])) + 1e-12), lamC)
        for i in np.where(te & leaf_known)[0]:
            d, t, s, y = sv[i]
            b = base[i:i + 1]
            a0 = A.predict_proba(b)[0]; b0 = B.predict_proba(b)[0]
            cd0 = C.predict_proba(np.hstack([b, [[0.0]]]))[0]; cp0 = C.predict_proba(np.hstack([b, [[1.0]]]))[0]
            Ll = leaf_probs(a0, b0, cd0, cp0, rpo_league)
            Lh = leaf_probs(softmax(np.log(a0 + 1e-12) + fam_x(int(d), t, s, y) @ WA),
                            softmax(np.log(b0 + 1e-12) + run_x(int(d), t, s, y) @ WB),
                            softmax(np.log(cd0 + 1e-12) + depth_x(int(d), t, s, y, 0) @ WC),
                            softmax(np.log(cp0 + 1e-12) + depth_x(int(d), t, s, y, 1) @ WC), rpo_his)
            j = leaf_idx[his["leaf"][int(i)]]
            ll_league.append(-np.log(max(Ll[j], 1e-9))); ll_his.append(-np.log(max(Lh[j], 1e-9)))
            top1_l += int(np.argmax(Ll) == j); top1_h += int(np.argmax(Lh) == j)
            top3_h += int(j in np.argsort(-Lh)[:3])
    nl = len(ll_his)
    log(f"  Specific play CV ({nl} snaps): log loss league {np.mean(ll_league):.3f} -> his {np.mean(ll_his):.3f}; "
        f"top pick right {top1_h / nl:.0%} (league {top1_l / nl:.0%}); actual play in his top 3 {top3_h / nl:.0%}")

    fam_rates = {f: {"his": float(np.mean(yA == i)), "league_expected": float(PA0[:, i].mean())}
                 for i, f in enumerate(FAMILIES)}
    G = {"A_league": A, "B_league": B, "C_league": C, "W_A": W_A, "W_B": W_B, "W_C": W_C,
         "rpo_throw_league": rpo_league, "rpo_throw_his": float(rpo_his)}
    joblib.dump(G, MODEL_DIR / "granular.joblib")
    summary = {
        "n_snaps": int(n), "family_rates": fam_rates,
        "cv": {"family": {"league": mlogloss(PA0, yA), "his": llA, "lambda": lamA},
               "run_gap": {"league": mlogloss(PB0, yB), "his": llB, "lambda": lamB, "n": int(len(yB))},
               "pass_depth": {"league": mlogloss(PC0, yC), "his": llC, "lambda": lamC, "n": int(len(yC))},
               "specific_play": {"n": nl, "logloss_league": float(np.mean(ll_league)),
                                 "logloss_his": float(np.mean(ll_his)), "top1_his": top1_h / nl,
                                 "top1_league": top1_l / nl, "top3_his": top3_h / nl}},
        "rpo_throw": {"his": float(rpo_his), "league": rpo_league, "his_n": int(rp.height)},
    }
    return summary


if __name__ == "__main__":
    import build
    plays = build.pull_plays()
    team, snaps = build.caller_snaps(plays)
    s = build_granular(plays, snaps, team)
    prof_path = MODEL_DIR / "profile.json"
    prof = json.loads(prof_path.read_text())
    prof["granular"] = s
    prof_path.write_text(json.dumps(prof, indent=2))

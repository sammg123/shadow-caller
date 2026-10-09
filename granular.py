"""Granular call model: play type (family) first, then the specific play underneath.

Families: Run, Dropback, Play-action, Screen, RPO.
Specific plays: run gap and side, pass depth (air yards), RPO outcome.
Each level = caller-blind league model, then his own adjustment shrunk toward the league.
"""
import numpy as np
from scipy.optimize import minimize

from features import BASE_FEATURES, base_row

FAMILIES = ["run", "dropback", "pa", "screen", "rpo"]
FAMILY_NAMES = {"run": "Run", "dropback": "Dropback pass", "pa": "Play-action",
                "screen": "Screen", "rpo": "RPO"}
PASS_FAMILIES = ("dropback", "pa", "screen")

RUN_LEAVES = ["run_inside", "run_ot_left", "run_edge_left", "run_ot_right", "run_edge_right"]
DEPTHS = ["short", "mid", "deep"]
LEAF_NAMES = {
    "run_inside": "Inside run (A/B gap)",
    "run_ot_left": "Off-tackle left",
    "run_edge_left": "Outside left (edge)",
    "run_ot_right": "Off-tackle right",
    "run_edge_right": "Outside right (edge)",
    "dropback_short": "Short (0–9 air yds)",
    "dropback_mid": "Intermediate (10–19)",
    "dropback_deep": "Deep shot (20+)",
    "pa_short": "PA short (0–9)",
    "pa_mid": "PA intermediate (10–19)",
    "pa_deep": "PA deep shot (20+)",
    "screen": "Screen",
    "rpo_run": "RPO, handed off or kept",
    "rpo_throw": "RPO, thrown",
}
LEAF_FAMILY = {**{k: "run" for k in RUN_LEAVES},
               **{f"dropback_{d}": "dropback" for d in DEPTHS},
               **{f"pa_{d}": "pa" for d in DEPTHS},
               "screen": "screen", "rpo_run": "rpo", "rpo_throw": "rpo"}
LEAVES = list(LEAF_NAMES)

# Keyboard taps (tap again to cycle) and shorthand codes -> leaf
TAP_CYCLES = {
    "K": ["run_inside"], "R": ["run_inside"],
    "J": ["run_ot_left", "run_edge_left"],
    "L": ["run_ot_right", "run_edge_right"],
    "P": ["dropback_short", "dropback_mid", "dropback_deep"],
    "A": ["pa_short", "pa_mid", "pa_deep"],
    "N": ["screen"],
    "O": ["rpo_run", "rpo_throw"],
}
SHORTHAND = {}
for key, cyc in TAP_CYCLES.items():
    for i, leaf in enumerate(cyc):
        SHORTHAND.setdefault(key * (i + 1), leaf)


def leaf_is_dropback(leaf):
    return int(LEAF_FAMILY[leaf] in PASS_FAMILIES or leaf == "rpo_throw")


def depth_of(air):
    if air is None or (isinstance(air, float) and np.isnan(air)):
        return None
    return "short" if air < 10 else ("mid" if air < 20 else "deep")


def run_leaf(loc, gap):
    if loc is None:
        return None
    if loc == "middle" or gap == "guard":
        return "run_inside"
    side = "left" if loc == "left" else "right"
    return f"run_edge_{side}" if gap == "end" else f"run_ot_{side}"


# ---------------------------------------------------------------- caller adjustment features
def fam_x(down, togo, score_diff, yl):
    return np.array([1.0, float(down in (1, 2)), float(down == 3 and togo >= 4),
                     float(yl <= 20), float(score_diff <= -9), float(togo <= 2)])


def run_x(down, togo, score_diff, yl):
    return np.array([1.0, float(togo <= 2), float(yl <= 20)])


def depth_x(down, togo, score_diff, yl, is_pa):
    return np.array([1.0, float(is_pa), float(down == 3 and togo >= 4), float(yl <= 20)])


# ---------------------------------------------------------------- softmax with offset
def softmax(z):
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def fit_softmax_offset(X, y, logp0, lam):
    """Multinomial logistic: z = log p_league + X W, L2 on W (shrinks toward the league)."""
    n, f = X.shape
    k = logp0.shape[1]
    Y = np.zeros((n, k))
    Y[np.arange(n), y] = 1

    def obj(wflat):
        W = wflat.reshape(f, k)
        P = softmax(logp0 + X @ W)
        nll = -np.sum(np.log(P[np.arange(n), y] + 1e-12))
        grad = X.T @ (P - Y) + lam * W
        return nll + 0.5 * lam * np.sum(W * W), grad.ravel()

    res = minimize(obj, np.zeros(f * k), jac=True, method="L-BFGS-B")
    return res.x.reshape(f, k)


def mlogloss(P, y):
    return float(-np.mean(np.log(np.clip(P[np.arange(len(y)), y], 1e-9, 1))))


# ---------------------------------------------------------------- live prediction
def _sit_vals(sit):
    return int(sit["down"]), float(sit["togo"]), float(sit["score_off"] - sit["score_opp"]), float(sit["yardline_100"])


def predict_tree(G, sit, game, memory_shift=0.0):
    """Returns league and caller trees: {family: p}, {leaf: p}. memory_shift = logit shift on pass vs run
    (from the in-game memory model), applied inside the non-RPO mass."""
    row = np.array([base_row(sit, game)])
    d, togo, sd, yl = _sit_vals(sit)

    pA = G["A_league"].predict_proba(row)[0]
    pB = G["B_league"].predict_proba(row)[0]
    pC_drop = G["C_league"].predict_proba(np.hstack([row, [[0.0]]]))[0]
    pC_pa = G["C_league"].predict_proba(np.hstack([row, [[1.0]]]))[0]
    rpo_league = G["rpo_throw_league"]

    def tree(pA, pB, pCd, pCp, rpo_throw):
        fam = dict(zip(FAMILIES, pA))
        leaf = {}
        for i, k in enumerate(RUN_LEAVES):
            leaf[k] = fam["run"] * pB[i]
        for i, dpt in enumerate(DEPTHS):
            leaf[f"dropback_{dpt}"] = fam["dropback"] * pCd[i]
            leaf[f"pa_{dpt}"] = fam["pa"] * pCp[i]
        leaf["screen"] = fam["screen"]
        leaf["rpo_run"] = fam["rpo"] * (1 - rpo_throw)
        leaf["rpo_throw"] = fam["rpo"] * rpo_throw
        return fam, leaf

    league = tree(pA, pB, pC_drop, pC_pa, rpo_league)

    # his adjustment
    hA = softmax(np.log(pA + 1e-12) + fam_x(d, togo, sd, yl) @ G["W_A"])
    hB = softmax(np.log(pB + 1e-12) + run_x(d, togo, sd, yl) @ G["W_B"])
    hCd = softmax(np.log(pC_drop + 1e-12) + depth_x(d, togo, sd, yl, 0) @ G["W_C"])
    hCp = softmax(np.log(pC_pa + 1e-12) + depth_x(d, togo, sd, yl, 1) @ G["W_C"])

    # in-game memory: shift pass-vs-run odds inside the non-RPO mass
    fam = dict(zip(FAMILIES, hA))
    m = 1 - fam["rpo"]
    pas = sum(fam[f] for f in PASS_FAMILIES)
    if m > 1e-6 and 0 < pas < m:
        s = pas / m
        s2 = 1 / (1 + np.exp(-(np.log(s / (1 - s)) + memory_shift)))
        for f in PASS_FAMILIES:
            fam[f] *= s2 / s
        fam["run"] *= (1 - s2) / (1 - s)
    hA2 = np.array([fam[f] for f in FAMILIES])
    his = tree(hA2, hB, hCd, hCp, G["rpo_throw_his"])
    return league, his

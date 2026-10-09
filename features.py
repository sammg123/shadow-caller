"""Feature definitions shared by the offline build and the live engine.

Stage 1 (league baseline) uses only what you can read off the broadcast:
down, distance, field position, score, quarter, clock, plus pregame line and venue.
Stage 2 (caller model) adds his habits and his in-game memory.
"""
import numpy as np
from scipy.optimize import minimize

BASE_FEATURES = [
    "down", "ydstogo", "yardline_100", "goal_to_go", "score_differential", "qtr",
    "half_seconds_remaining", "game_seconds_remaining", "is_home", "posteam_spread",
    "total_line", "two_min",
]

HABIT_COLS = ["intercept", "early_down", "third_long", "trailing9", "red_zone"]
MEMORY_COLS = ["dq", "last", "last_fail", "explosive_prev", "sack_prev"]
STAGE2_COLS = HABIT_COLS + MEMORY_COLS

LABELS = {
    "intercept": "Overall lean",
    "early_down": "Early downs (1st/2nd)",
    "third_long": "3rd & 4+",
    "trailing9": "Trailing by 9+",
    "red_zone": "Red zone",
    "dq": "Value gap (what's been working)",
    "last": "Repeat last call (stickiness)",
    "last_fail": "After a failed play",
    "explosive_prev": "After a 20+ yard gain",
    "sack_prev": "After a sack",
}


def clock_to_seconds(qtr, clock_sec):
    """Quarter + seconds left in quarter -> (half_seconds_remaining, game_seconds_remaining)."""
    qtr = int(qtr)
    if qtr >= 5:  # overtime
        return float(clock_sec), float(clock_sec)
    half = clock_sec + (900 if qtr in (1, 3) else 0)
    game = clock_sec + (4 - qtr) * 900
    return float(half), float(game)


def base_row(sit, game):
    """One Stage 1 feature row from a live situation dict."""
    half, gsec = clock_to_seconds(sit["qtr"], sit["clock"])
    togo = float(sit["togo"])
    yl = float(sit["yardline_100"])
    return [
        float(sit["down"]), togo, yl, float(togo >= yl),
        float(sit["score_off"] - sit["score_opp"]), float(sit["qtr"]),
        half, gsec, float(game["offense_is_home"]), float(game["offense_spread"]),
        float(game["total_line"]), float(half <= 120),
    ]


def visible_success(down, togo, yards, td=False, turnover=False):
    """Success as a coach sees it: 40% of distance on 1st, 60% on 2nd, all of it on 3rd/4th."""
    if turnover:
        return 0
    if td or yards >= togo:
        return 1
    need = {1: 0.4, 2: 0.6}.get(int(down), 1.0) * togo
    return int(yards >= need)


def habit_values(down, togo, score_diff, yardline_100):
    return {
        "intercept": 1.0,
        "early_down": float(down in (1, 2)),
        "third_long": float(down == 3 and togo >= 4),
        "trailing9": float(score_diff <= -9),
        "red_zone": float(yardline_100 <= 20),
    }


def memory_values(snap_n, prev, dq, script_plays):
    """prev = previous snap on the same drive (or None). Memory is off during the opening script."""
    on = 0.0 if snap_n <= script_plays else 1.0
    if prev is None:
        last = last_fail = expl = sack = 0.0
    else:
        last = float(prev["type"])                    # +1 dropback, -1 run
        last_fail = last * (1 - prev["success"])
        expl = last * float(prev["explosive"])
        sack = float(prev["sack"])
    return {
        "dq": on * dq,
        "last": on * last,
        "last_fail": on * last_fail,
        "explosive_prev": on * expl,
        "sack_prev": on * sack,
    }


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def sigmoid(z):
    return 1 / (1 + np.exp(-z))


def fit_offset_ridge(X, y, offset, lam):
    """Logistic regression with a fixed offset and an L2 penalty that shrinks every
    caller term toward 0, i.e. toward the league baseline."""
    n, k = X.shape

    def f(w):
        z = offset + X @ w
        p = sigmoid(z)
        eps = 1e-9
        nll = -np.sum(y * np.log(p + eps) + (1 - y) * np.log(1 - p + eps))
        grad = X.T @ (p - y) + lam * w
        return nll + 0.5 * lam * w @ w, grad

    res = minimize(f, np.zeros(k), jac=True, method="L-BFGS-B")
    return res.x


def log_loss(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))

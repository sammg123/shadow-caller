"""How the model works, in plain words, with one tracked play-caller's numbers (the analyst's model_explainer tool;
docs/design/analyst.md 3). Drawn from README.md, PRODUCT.md, live.py, features.py and build.py."""
from analyst_snapshot import Snapshot, based_on, caller_for, fixed
from config import LEAGUE_SEASONS, LEAN, SCRIPT_PLAYS, TILT


def model_explainer(snap: Snapshot, team: str | None = None) -> dict:
    """How the model works, with the numbers of `team`'s play-caller (left out: the one whose offense has the ball,
    else the first)."""
    c = caller_for(snap, team)
    p = c.profile
    cv, s1 = p.get("cv_logloss") or {}, p.get("stage1_check") or {}
    return {"explainer": " ".join((
        f"Shadow Play-Caller predicts {c.name}'s next call ({c.team}) before every snap, in three layers.",
        f"1. League baseline: a gradient-boosted model trained on nflverse play-by-play from {LEAGUE_SEASONS[0]} to "
        f"{LEAGUE_SEASONS[-1]}, every team except {p.get('team') or c.team}, gives the league's chance of a pass (a "
        "dropback) in the exact situation: down, distance, field position, goal to go, score, quarter, time left in "
        "the half and the game, home or away, the pregame spread and total, and the two-minute mark. It never knows "
        f"who calls the plays. On the {s1.get('test_season')} season, held out, its log loss was "
        f"{fixed(s1.get('logloss_ours'), 3)} against {fixed(s1.get('logloss_nflfastr_xpass'), 3)} for nflfastR's "
        "pass model.",
        f"2. His habits: a logistic model fit to his {based_on(p)} adds his own terms on top of the baseline: an "
        "overall lean, early downs, 3rd & 4+, trailing by 9+ and the red zone. A ridge penalty pulls every term "
        "toward zero, so a habit has to be real to move the number.",
        "3. In-game memory: the model tracks what has been working tonight, a running success score for his passes "
        f"and for his runs, updated after each of his calls with learning rate {p.get('alpha')}, plus whether he "
        "repeats or switches from his last call, and what he does after a failed play, a 20+ yard gain or a sack. "
        f"Memory stays off for his first {SCRIPT_PLAYS} snaps (the opening script), and the last-call terms reset "
        "at every new drive. Those terms are signed by his last call: a negative stickiness term means he tends to "
        "switch (after a pass he leans run). A play is a success when it gains 40% of the distance on 1st down, 60% "
        "on 2nd and all of it on 3rd or 4th; a touchdown is a success and a turnover a failure. A snap wiped out by "
        "a flag is graded but stays out of his memory.",
        "Play types: league models trained on FTN charting split the call into five play types (run, dropback "
        "pass, play-action, screen, RPO) and 14 specific plays (run gap and side, pass depth by air yards: short "
        "0-9, intermediate 10-19, deep 20+, RPO handed off or thrown), each adjusted to his habits and shrunk "
        "toward the league; his memory shifts pass against run inside them.",
        "Grading: every one of his snaps is graded against what ESPN's feed says he called: run or pass called "
        "right (a pass chance of 50% or more means pass), the play type, and the specific play's rank (top pick, "
        "in his top 3, or a miss), with log loss for his model (Shadow) and the league baseline (League) side by "
        "side. Lower log loss is better, and one game is a small sample.",
        f"Tilt: the tag compares his pass chance with the league's in the same spot: {round(TILT * 100)} points or "
        f"more is a tilt, {round(LEAN * 100)} points or more a lean, and under that he calls it like the league "
        "does. Arrows mark play types at least 4 points and 30% above or below the league.",
        "Limits: ESPN's free feed can't see play-action, screens or RPOs, so those calls are graded as ESPN "
        "describes them (a dropback by depth, or a run). There is no player tracking, so routes, formations and "
        "personnel aren't known. The model has no punt or field-goal class: on 4th down the call is the play he'd "
        "run if he goes for it. Held out on his own past games, cross-validated by game, the league baseline's log "
        f"loss was {fixed(cv.get('league_baseline'), 3)}, his habits {fixed(cv.get('habits'), 3)} and habits plus "
        f"memory {fixed(cv.get('habits_plus_memory'), 3)}."))}

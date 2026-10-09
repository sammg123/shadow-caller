"""ESPN parser checked play by play against nflverse for TB at DAL, Oct 8 2026 (ESPN event 401872980),
plus real plays from other 2026 games for cases this game didn't have."""
import pytest
from helpers import nfl_id, scrimmage

from espn_feed import classify, iter_plays, situation
from granular import depth_of, run_leaf


def nv_family(r):
    if r["sack"]:
        return "sack"
    if r["qb_scramble"]:
        return "scramble"
    return "pass" if r["pass"] else "run"


def our_family(info):
    if info["outcome"] in ("sack", "scramble"):
        return info["outcome"]
    return "pass" if info["family"] == "dropback" else "run"


@pytest.fixture(scope="module")
def pairs(summary, nflverse):
    """(team, espn play, classify(), start situation, nflverse row) for every ESPN play nflverse also has."""
    out = []
    for team, p in iter_plays(summary):
        r = nflverse.get(nfl_id(p))
        if r is not None:
            out.append((team, p, classify(team, p), situation(p, "start", True), r))
    return out


@pytest.fixture(scope="module")
def snaps(pairs):
    return [x for x in pairs if scrimmage(x[4])]


@pytest.fixture(scope="module")
def live_snaps(snaps):
    """Snaps that stood (no 'No Play' flag)."""
    return [x for x in snaps if x[4]["play_type"] != "no_play"]


# ---------------------------------------------------------------- coverage of the file
def test_every_espn_play_with_a_call_matches_an_nflverse_play(summary, nflverse):
    plays = iter_plays(summary)
    assert len(plays) == 183
    unmatched = [p["text"] for t, p in plays if nfl_id(p) not in nflverse]
    assert all("timeout" in u.lower() or "two-minute" in u.lower() for u in unmatched)


def test_every_snap_is_logged_as_a_play(snaps):
    missed = [(p["clock"]["displayValue"], p["text"]) for t, p, info, st, r in snaps if info["kind"] != "play"]
    assert missed == []
    assert len(snaps) == 129


def test_nothing_else_is_logged_as_a_play(pairs):
    extra = [p["text"] for t, p, info, st, r in pairs if info["kind"] == "play" and not scrimmage(r)]
    assert extra == []


# ---------------------------------------------------------------- situation
def test_start_down_distance_and_spot_match_nflverse(snaps):
    bad = [(p["text"], st) for t, p, info, st, r in snaps
           if (st.get("down"), st.get("togo"), st.get("yardline_100")) != (r["down"], r["ydstogo"], r["yardline_100"])]
    assert bad == []


def test_possession_team_id_is_the_offense(summary, snaps):
    ids = {"DAL": "6", "TB": "27"}
    bad = [p["text"] for t, p, info, st, r in snaps if st["_poss_id"] != ids[r["posteam"]]]
    assert bad == []


def test_quarter_and_clock_are_the_snap_time(snaps):
    def secs(t):
        m, s = t.split(":")
        return int(m) * 60 + int(s)
    for t, p, info, st, r in snaps:
        assert st["qtr"] == r["qtr"]
        if not info["td"]:      # ESPN stamps scoring plays with the clock after the play
            assert st["clock"] == secs(r["time"]), p["text"]
        else:
            assert 0 <= secs(r["time"]) - st["clock"] <= 10


def test_score_after_every_play_matches_nflverse(pairs):
    checked = 0
    for t, p, info, st, r in pairs:
        if r["touchdown"]:          # ESPN folds the PAT into the TD play; nflverse has it as its own row
            continue
        end = situation(p, "end", offense_is_home=True)
        assert (end["score_off"], end["score_opp"]) == (r["total_home_score"], r["total_away_score"]), p["text"]
        checked += 1
    assert checked > 150
    final = situation(pairs[-1][1], "end", offense_is_home=True)
    assert (final["score_off"], final["score_opp"]) == (16, 24)


# ---------------------------------------------------------------- what he called
def test_run_pass_sack_scramble_match_nflverse(live_snaps):
    bad = [(p["text"], our_family(info), nv_family(r)) for t, p, info, st, r in live_snaps
           if our_family(info) != nv_family(r)]
    assert bad == []


def test_run_gap_and_side_match_nflverse(live_snaps):
    runs = [x for x in live_snaps if nv_family(x[4]) == "run"]
    bad = [(p["text"], info["leaf"]) for t, p, info, st, r in runs
           if info["leaf"] != run_leaf(r["run_location"], r["run_gap"])]
    assert bad == []
    assert len(runs) == 45


def test_completed_pass_depth_matches_nflverse_air_yards(live_snaps):
    comps = [x for x in live_snaps if x[4]["complete_pass"]]
    bad = [(p["text"], info["leaf"], r["air_yards"]) for t, p, info, st, r in comps
           if info["leaf"] != f"dropback_{depth_of(r['air_yards'])}"]
    assert bad == []
    assert len(comps) == 43


def test_incomplete_pass_depth_comes_from_the_short_deep_word(live_snaps):
    """ESPN has no air yards on incompletions, only short (<15) / deep (15+). 2022-25 nflverse: 'deep'
    incompletions are 20+ air yards 70% of the time, so deep -> 20+ and short -> 0-9 are the best single guesses."""
    incs = [x for x in live_snaps if nv_family(x[4]) == "pass" and not x[4]["complete_pass"]]
    for t, p, info, st, r in incs:
        word = "deep" if " deep " in p["text"] else "short"
        assert info["leaf"] == f"dropback_{word}", p["text"]
    hits = sum(info["leaf"] == f"dropback_{depth_of(r['air_yards'])}" for t, p, info, st, r in incs)
    assert (hits, len(incs)) == (18, 24)


def test_shotgun_alignment_matches_nflverse(snaps):
    bad = [(p["text"], info["align"]) for t, p, info, st, r in snaps
           if info["align"] != ("S" if r["shotgun"] else "U")]
    assert bad == []


def test_no_play_flags_match_nflverse(snaps):
    bad = [p["text"] for t, p, info, st, r in snaps if info["nullified"] != (r["play_type"] == "no_play")]
    assert bad == []
    assert sum(info["nullified"] for t, p, info, st, r in snaps) == 11


# ---------------------------------------------------------------- result of the play
def test_touchdowns_and_turnovers_match_nflverse(live_snaps):
    for t, p, info, st, r in live_snaps:
        assert info["td"] == bool(r["touchdown"] and r["td_team"] == r["posteam"]), p["text"]
        assert info["turnover"] == bool(r["interception"] or r["fumble_lost"]), p["text"]


def test_yards_match_nflverse(live_snaps):
    for t, p, info, st, r in live_snaps:
        if r["interception"]:
            assert info["yards"] == 0, p["text"]          # not the return
        elif r["sack"]:
            assert info["yards"] == -r["yards_gained"], p["text"]
        else:
            assert info["yards"] == r["yards_gained"], p["text"]


def test_dallas_two_point_try_does_not_hide_the_touchdown_pass(pairs):
    td = next(x for x in pairs if "TWO-POINT" in x[1]["text"])
    info = td[2]
    assert (info["kind"], info["family"], info["leaf"], info["td"]) == ("play", "dropback", "dropback_mid", True)
    assert info["yards"] == 18


def test_kneels_and_admin_plays_are_not_calls(pairs):
    for t, p, info, st, r in pairs:
        if r["qb_kneel"] or r["qb_spike"]:
            assert info["kind"] == "sync"
        if r["play_type"] in ("kickoff", "extra_point"):
            assert info["kind"] == "skip"
        if r["play_type"] == "punt":
            assert info["kind"] == "punt"
        if r["play_type"] == "field_goal":
            assert info["kind"] == "fg"


def test_presnap_flag_without_a_player_is_not_a_call(pairs):
    dog = next(x for x in pairs if "Delay of Game" in x[1]["text"])
    assert dog[2]["kind"] == "sync"


# ---------------------------------------------------------------- real plays from other 2026 games
def play(text, typ, yards=0, yac=None, turnover=False, start=None):
    p = {"id": "1", "text": text, "type": {"text": typ}, "statYardage": yards, "isTurnover": turnover,
         "period": {"number": 2}, "clock": {"displayValue": "5:00"}, "homeScore": 0, "awayScore": 0,
         "start": start or {"down": 2, "distance": 8, "yardsToEndzone": 40, "team": {"id": "6"}}, "end": {}}
    if yac is not None:
        p["yardsAfterCatch"] = yac
    return p


def test_strip_sack_lost_is_a_turnover_not_an_offensive_td():
    # 2026_02_PIT_NE: defense returned it for a TD
    info = classify("PIT", play("(Shotgun) A.Rodgers sacked at PIT 21 for -9 yards (C.Barmore). FUMBLES (C.Barmore) "
                                "[C.Barmore], RECOVERED by NE-E.Ponder at PIT 19. E.Ponder for 19 yards, TOUCHDOWN.",
                                "Sack Opp Fumble Recovery", yards=10, turnover=True))
    assert (info["outcome"], info["turnover"], info["td"], info["yards"]) == ("sack", True, False, 9)


def test_fumble_lost_after_a_catch_is_a_turnover():
    # 2026_01_SF_LA
    info = classify("LA", play("(No Huddle, Shotgun) M.Stafford pass short middle to T.Higbee to LA 44 for 5 yards "
                               "(F.Warner; D.Greenlaw). FUMBLES (F.Warner), RECOVERED by SF-K.White at LA 43.",
                               "Fumble Recovery (Opponent)", yards=0, turnover=True))
    assert (info["family"], info["turnover"], info["yards"]) == ("dropback", True, 5)


def test_own_fumble_recovery_is_not_a_turnover():
    # 2026_01_BUF_HOU: run gained 12, recovery advanced it
    info = classify("BUF", play("J.Cook left guard to BUF 16 for 12 yards (D.Stingley). FUMBLES (D.Stingley), "
                                "recovered by BUF-O.Torrence at BUF 19.", "Fumble Recovery (Own)", yards=15))
    assert (info["leaf"], info["turnover"], info["yards"]) == ("run_inside", False, 12)


def test_interception_logs_zero_yards_not_the_return():
    # 2026_01_NE_SEA
    info = classify("NE", play("D.Maye pass deep left intended for R.Doubs INTERCEPTED by N.Pritchett (R.Thomas) at SEA 3. "
                               "N.Pritchett to SEA 33 for 30 yards (J.Wilson).", "Pass Interception Return",
                               yards=30, turnover=True))
    assert (info["leaf"], info["turnover"], info["yards"], info["td"]) == ("dropback_deep", True, 0, False)


def test_replay_reversal_uses_the_corrected_play():
    # 2026_01_DAL_NYG: TD overturned, ball at the 1
    info = classify("DAL", play("(Shotgun) J.Williams right tackle for 1 yard, TOUCHDOWN.The Replay Official reviewed the "
                                "runner broke the plane ruling, and the play was REVERSED.(Shotgun) J.Williams right "
                                "tackle to NYG 1 for no gain (T.Edmunds).", "Rush", yards=0))
    assert (info["leaf"], info["td"], info["yards"]) == ("run_ot_right", False, 0)


def test_reversal_that_removes_a_no_play_flag_keeps_the_play():
    # 2026_03_LAC_BUF: flag stays but is now enforced after the run, so the snap counts
    info = classify("BUF", play("(Shotgun) J.Allen scrambles right end to LAC 32 for 8 yards (A.Mesidor; C.Hart). FUMBLES "
                                "(A.Mesidor), RECOVERED by LAC-T.Tuipulotu at LAC 27.PENALTY on LAC-R.Shelley, Defensive "
                                "Holding, 5 yards, enforced at LAC 40 - No Play.The Replay Official reviewed the runner was "
                                "not down by contact ruling, and the play was REVERSED.(Shotgun) J.Allen scrambles right "
                                "end to LAC 32 for 8 yards (C.Hart; A.Mesidor).PENALTY on LAC-R.Shelley, Defensive Holding, "
                                "5 yards, enforced at LAC 32.", "Penalty", yards=13))
    assert (info["kind"], info["outcome"], info["nullified"], info["turnover"], info["yards"]) == \
        ("play", "scramble", False, False, 8)


def test_two_point_try_after_a_touchdown_run_keeps_the_run():
    # 2026_01_GB_MIN: the conversion was a pass
    info = classify("MIN", play("A.Jones left end for 3 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. C.Wentz pass to "
                                "J.Jefferson is complete. ATTEMPT SUCCEEDS.", "Rushing Touchdown", yards=3))
    assert (info["kind"], info["leaf"], info["td"], info["yards"]) == ("play", "run_edge_left", True, 3)


def test_two_point_try_on_its_own_is_skipped():
    # 2026_02_NO_BAL
    info = classify("NO", play("TWO-POINT CONVERSION ATTEMPT. T.Shough is sacked. ATTEMPT FAILS.\nPENALTY on BLT-J.Hawkins, "
                               "Defensive Holding, 1 yard, enforced at BLT 2 - No Play.", "Penalty"))
    assert info["kind"] == "skip"


def test_touchdown_wiped_out_by_a_spot_foul_is_a_play_but_not_a_touchdown():
    # 2026_03_LAC_BUF: holding enforced at the spot, so the snap stands (nflverse: pass, no TD)
    info = classify("BUF", play("(Shotgun) J.Allen pass short left to T.Johnson for 43 yards, TOUCHDOWN NULLIFIED by Penalty "
                                "[J.Eboigbe].PENALTY on BUF-D.Knox, Offensive Holding, 10 yards, enforced at LAC 14.",
                                "Pass Reception", yards=9, yac=22))
    assert (info["kind"], info["nullified"], info["td"], info["family"], info["yards"]) == \
        ("play", False, False, "dropback", 43)


def test_kickoff_wiped_out_by_a_flag_is_not_a_run():
    # 2026_03_CAR_CLE: ESPN typed it 'Penalty'
    info = classify("CLE", play("R.Fitzgerald kicks 61 yards from CAR 35 to CLV 4. M.Corley to CLV 21 for 17 yards (T.Incoom)."
                                "PENALTY on CAR-T.Incoom, Illegal Formation, 5 yards, enforced at CAR 35 - No Play.",
                                "Penalty", yards=17))
    assert info["kind"] == "skip"


def test_shotgun_is_read_from_before_the_replay_reversal():
    # 2026_01_NO_DET: the corrected text drops '(Shotgun)'; the fumble after the catch stands
    info = classify("DET", play("(Shotgun) J.Goff pass short right to J.Gibbs to NO 40 for 4 yards (V.Broughton).New Orleans "
                                "challenged, and the play was REVERSED. J.Goff pass short right to J.Gibbs to NO 40 for 4 "
                                "yards, FUMBLES (V.Broughton), RECOVERED by NO-V.Broughton at NO 40.",
                                "Fumble Recovery (Opponent)", yards=0, yac=2, turnover=True))
    assert (info["align"], info["turnover"], info["yards"], info["leaf"]) == ("S", True, 4, "dropback_short")


def test_espn_scoring_summary_text_is_a_touchdown():
    # 2026_03_SEA_WAS: ESPN typed it 'Fumble Recovery (Own)'
    info = classify("SEA", play("Eric Saubert 13 Yd pass from Sam Darnold (Jason Myers Kick)", "Fumble Recovery (Own)",
                                yards=13, yac=5))
    assert (info["family"], info["td"]) == ("dropback", True)


def test_espn_short_text_falls_back_to_the_play_type():
    # ESPN sometimes posts its own short text before the gamebook text arrives
    inc = classify("SEA", play("Drew Lock Incomplete Pass, Intended For Jaxon Smith-Njigba", "Pass Incompletion"))
    assert (inc["kind"], inc["family"], inc["outcome"], inc["align"]) == ("play", "dropback", "incomplete", None)
    comp = classify("KC", play("Daniel Jones Pass Complete for 48 Yds to Laquon Treadwell", "Pass Reception",
                               yards=48, yac=20))
    assert (comp["leaf"], comp["yards"]) == ("dropback_deep", 48)
    td = classify("CLE", play("Denzel Boston 46 Yd pass from Deshaun Watson (Andre Szmyt Kick).", "Passing Touchdown",
                              yards=46, yac=10))
    assert (td["leaf"], td["td"], td["yards"]) == ("dropback_deep", True, 46)
    run = classify("DAL", play("Javonte Williams 3 Yd Rush", "Rush", yards=3))
    assert (run["family"], run["leaf"], run["yards"]) == ("run", None, 3)


def test_team_safety_placeholder_is_not_a_pass():
    # 2026_02_LV_LAC: ESPN typed it 'Pass Incompletion'
    assert classify("LV", play("Team Safety", "Pass Incompletion"))["kind"] == "sync"


def test_punt_wiped_out_by_a_flag_is_not_a_punt():
    info = classify("DAL", play("B.Anger punts 50 yards to TB 20, Center-T.Sieg. PENALTY on TB-X.Player, Defensive Offside, "
                                "5 yards, enforced at DAL 30 - No Play.", "Penalty"))
    assert info["kind"] == "sync"


def test_muffed_punt_recovered_by_the_punting_team_is_still_a_punt():
    # 2026_04_DEN_SF
    info = classify("SF", play("C.Waitman punts 61 yards to DEN 28, Center-J.Weeks. M.Mims to DEN 29 for 1 yard (S.Neal). "
                               "FUMBLES (S.Neal), RECOVERED by SF-S.Neal at DEN 28.", "Muffed Punt Recovery (Opponent)"))
    assert info["kind"] == "punt"


def test_aborted_snap_is_not_a_call():
    info = classify("DET", play("J.Goff FUMBLES (Aborted) at DET 31, recovered by DET-J.Williams at DET 25. J.Williams "
                                "to DET 32 for 7 yards (D.Godchaux).", "Fumble Recovery (Own)", yards=1))
    assert info["kind"] == "sync"


def test_completion_depth_trusts_the_deep_word_when_yac_is_impossible():
    # 2026_01_CHI_CAR: ESPN put all 51 yards after the catch on a 'deep' throw (nflverse air yards 43)
    info = classify("CAR", play("B.Young pass deep left to J.Coker for 51 yards, TOUCHDOWN. R.Fitzgerald extra point is "
                                "GOOD, Center-J.Jansen, Holder-S.Martin.", "Passing Touchdown", yards=51, yac=51))
    assert info["leaf"] == "dropback_deep"


def test_penalty_note_without_a_player():
    from espn_feed import penalty_note
    assert penalty_note("(Field Goal formation) PENALTY on TB, Delay of Game, 5 yards, enforced at DAL 43 - No Play.") \
        == "delay of game on TB"
    assert penalty_note("J.Williams left tackle to TB 7 for 1 yard (Y.Diaby; E.Simmons).PENALTY on TB-D.Walker, "
                        "Defensive Offside, 4 yards, enforced at TB 8 - No Play.") == "defensive offside on TB"


def test_reversal_wins_over_a_stale_espn_play_type():
    # ESPN can leave the original type on a reversed play
    info = classify("DAL", play("D.Prescott pass incomplete short left to C.Lamb.Dallas challenged the incomplete pass ruling, "
                                "and the play was REVERSED. D.Prescott pass short left to C.Lamb to DAL 40 for 10 yards "
                                "(J.Parrish).", "Pass Incompletion", yards=0, yac=3))
    assert (info["outcome"], info["yards"], info["leaf"]) == (None, 10, "dropback_short")
    td = classify("DAL", play("(Shotgun) J.Williams right tackle for 1 yard, TOUCHDOWN.The Replay Official reviewed the "
                              "runner broke the plane ruling, and the play was REVERSED.(Shotgun) J.Williams right tackle "
                              "to NYG 1 for no gain (T.Edmunds).", "Rushing Touchdown"))
    assert td["td"] is False


def test_empty_corrected_text_is_not_a_call():
    info = classify("DAL", play("Dallas challenged, and the play was REVERSED. TWO-POINT CONVERSION ATTEMPT. D.Prescott pass "
                                "to C.Lamb is complete. ATTEMPT SUCCEEDS.", "Pass Reception"))
    assert info["kind"] == "sync"


def test_field_goal_no_good_is_a_miss():
    info = classify("DAL", play("B.Aubrey 58 yard field goal is No Good, Wide Right, Center-T.Sieg, Holder-B.Anger.",
                                "Field Goal No Good"))
    assert info["kind"] == "fg_miss"

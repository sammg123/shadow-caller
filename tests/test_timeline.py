"""Timeline contract (docs/design/data-contract.md, section G tests 1-22, 24, 25) on the real TB at DAL game,
plus the feed and engine plumbing it needs. Pure: builds the timeline from feed.apply(summary) in the sandbox
and never starts Flask. Real ESPN ids and values throughout."""
import copy
import json
import logging
import threading

import pytest
from helpers import TEST_GAME, legacy_game

import espn_feed
import live
import timeline as tl
from espn_feed import Feed, classify, iter_drive_plays, iter_plays

TB_GAME = {**TEST_GAME, "offense": "TB", "opponent": "DAL", "offense_is_home": False}


def build(feed, engine, game=TEST_GAME, **kw):
    kw.setdefault("epoch", "test-1")
    kw.setdefault("client_epoch", kw["epoch"])
    kw.setdefault("mode", "replay")
    return tl.response(feed.summary, feed.applied, engine.state, game, **kw)


def row(rows, pid):
    return next(r for r in rows if r["id"] == pid)


def espn_play(summary, pid):
    return next(p for t, p in iter_plays(summary) if str(p["id"]) == pid)


@pytest.fixture(scope="module")
def game(make_feed, summary):
    e, feed = make_feed()
    feed.apply(summary)
    return e, feed


@pytest.fixture(scope="module")
def full(game):
    return build(*reversed(game))


@pytest.fixture(scope="module")
def rows(full):
    return full["rows"]


@pytest.fixture(scope="module")
def partial(make_feed, summary):
    """First 104 plays applied one at a time, as Watch mode does, with the whole game's summary in memory."""
    e, feed = make_feed()
    feed.summary = summary
    for team, p in iter_plays(summary)[:104]:
        feed.apply_one(team, p)
    return build(feed, e)


# ---------------------------------------------------------------- 1-5: rows, order, field frame
def test_timeline_has_every_applied_play_in_order(full, rows):
    assert full["n"] == len(rows) == 183 and full["source"] == "espn"
    assert [r["seq"] for r in rows] == list(range(1, 184))
    assert all(a["espn_seq"] < b["espn_seq"] for a, b in zip(rows, rows[1:]))
    kinds = {}
    for r in rows:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    assert kinds == {"play": 129, "admin": 27, "kickoff": 9, "penalty": 7, "punt": 7, "fg": 2, "kneel": 2}
    assert sum(r["offense_is_caller"] for r in rows) == 64
    assert sum(r["team"] == "DAL" for r in rows if r["kind"] == "play") == 59


def test_first_dallas_snap_starts_at_x30(rows):
    r = row(rows, "40187298068")
    assert (r["seq"], r["drive"], r["drive_id"], r["src"], r["team"], r["opp"]) == (2, 1, "4018729801", "espn", "DAL", "TB")
    assert (r["kind"], r["type"], r["qtr"], r["clock"], r["clock_s"], r["t"]) == ("play", "Pass Incompletion", 1, "14:54", 894, 6)
    assert r["pre"] == {"down": 1, "togo": 10, "yardline_100": 70, "goal_to_go": False, "text": "1st & 10 at DAL 30"}
    assert r["post"] == {"poss": "DAL", "down": 2, "togo": 10, "yardline_100": 70, "text": "2nd & 10 at DAL 30"}
    assert r["geo"] == {"dir": 1, "x0": 30, "x_end": 30, "x_next": 30, "x_catch": 35, "lat": "middle", "gap": None,
                        "approx": ["x_catch"]}
    assert r["call"] == {"family": "dropback", "leaf": "dropback_short", "outcome": "incomplete", "depth": "short",
                         "air": 5, "air_src": "est", "air_band": [1, 10], "yac": None, "align": "U"}
    assert r["result"] == {"yards": 0, "first_down": False, "fd_by": None, "td": False, "turnover": False,
                           "turnover_kind": None, "downs": False, "safety": False, "nullified": False, "penalty": None}
    assert (r["kick"], r["scoring"], r["score"]) == (None, None, {"DAL": 0, "TB": 0})
    assert r["wp"] == {"home": 0.864, "caller": 0.864, "delta": -0.0092}
    assert r["wall"] == "2026-10-09T00:16:31Z"
    assert r["text"] == "D.Prescott pass incomplete short middle to B.Spann-Ford (C.Rozeboom)."


def test_first_tampa_snap_runs_right_to_left(rows):
    r = row(rows, "401872980390")
    assert (r["team"], r["offense_is_caller"], r["geo"]["dir"], r["geo"]["x0"], r["geo"]["x_end"]) == ("TB", False, -1, 73, 70)
    assert (r["call"]["air"], r["call"]["air_src"], r["call"]["yac"], r["geo"]["lat"]) == (-1, "yac", 4, "left")
    assert (r["geo"]["x_catch"], r["geo"]["approx"], r["pred"]) == (74, [], None)


def test_x_equals_espn_yardline_with_home_caller_on_the_left(game, rows, summary):
    plays = {str(p["id"]): p for t, p in iter_plays(summary)}
    scrimmage = [r for r in rows if r["kind"] != "admin"]
    assert len(scrimmage) == 156
    assert all(r["geo"]["x0"] == plays[r["id"]]["start"]["yardLine"] for r in scrimmage)
    e, feed = game
    flipped = build(feed, e, game=TB_GAME)["rows"]
    assert all(r["geo"]["x0"] == 100 - plays[r["id"]]["start"]["yardLine"] for r in flipped if r["kind"] != "admin")
    assert row(flipped, "401872980390")["geo"]["x0"] == 27 and row(flipped, "40187298068")["geo"]["x0"] == 70
    assert row(flipped, "401872980390")["geo"]["dir"] == 1 and row(flipped, "401872980390")["offense_is_caller"]


def test_home_punts_ignore_yards_to_endzone(rows):
    punts = [row(rows, pid) for pid in ("4018729801082", "4018729801339", "4018729801749")]
    assert [r["geo"]["x0"] for r in punts] == [44, 53, 18]
    assert [r["pre"]["yardline_100"] for r in punts] == [56, 47, 82]
    assert all(r["kind"] == "punt" and r["offense_is_caller"] for r in punts)


# ---------------------------------------------------------------- 6-12: what happened on the play
def test_completion_air_and_yac(rows):
    r = row(rows, "401872980185")
    assert (r["call"]["air"], r["call"]["yac"], r["call"]["air_src"], r["geo"]["x_catch"]) == (21, 0, "yac", 92)
    r = row(rows, "4018729801915")
    assert (r["geo"]["x0"], r["call"]["air"], r["call"]["yac"], r["geo"]["x_catch"], r["geo"]["x_end"]) == (13, 39, 9, 52, 61)
    assert sum(r["call"] is not None and r["call"]["air_src"] == "yac" for r in rows) == 43
    assert not any(r["call"] and r["call"]["air_src"] == "yac_conflict" for r in rows)


def test_incompletion_air_is_a_labelled_estimate(rows):
    r = row(rows, "4018729801059")
    assert (r["call"]["depth"], r["call"]["air"], r["call"]["air_band"], r["geo"]["lat"]) == ("deep", 23, [19, 32], "left")
    assert "x_catch" in r["geo"]["approx"] and r["geo"]["x_catch"] == 67
    assert sum(r["call"] is not None and r["call"]["air_src"] == "est" for r in rows) == 27


def test_interception_spot_gives_air_and_return(rows):
    r = row(rows, "4018729802466")
    assert (r["call"]["air"], r["call"]["air_src"], r["geo"]["x_catch"], r["geo"]["x_end"], r["geo"]["x_next"]) == \
        (3, "int_spot", 76, 75, 75)
    assert (r["result"]["turnover"], r["result"]["turnover_kind"], r["result"]["yards"]) == (True, "int", 0)
    r = row(rows, "4018729804123")
    assert (r["call"]["air"], r["geo"]["x_catch"]) == (12, 88)
    assert sum(r["call"] is not None and r["call"]["air_src"] == "int_spot" for r in rows) == 2


def test_run_gap_side_and_length(rows):
    r = row(rows, "401872980163")
    assert (r["geo"]["gap"], r["geo"]["lat"], r["geo"]["x0"], r["geo"]["x_end"], r["call"]["air"]) == ("up the middle", "middle", 50, 71, None)
    r = row(rows, "4018729802242")
    assert (r["team"], r["geo"]["gap"], r["geo"]["lat"], r["geo"]["dir"], r["geo"]["x0"], r["geo"]["x_end"]) == \
        ("TB", "left tackle", "left", -1, 86, 14)
    assert r["result"]["yards"] == 72
    r = row(rows, "401872980442")
    assert (r["call"]["outcome"], r["geo"]["lat"], r["geo"]["gap"]) == ("scramble", "right", "right end")


def test_sack_is_negative_and_uses_the_sack_spot(rows):
    r = row(rows, "4018729802713")
    assert (r["result"]["yards"], r["geo"]["x0"], r["geo"]["x_end"], r["geo"]["lat"]) == (-11, 37, 48, None)
    assert r["call"]["outcome"] == "sack"


def test_no_play_ghost_and_enforcement(rows):
    r = row(rows, "401872980210")
    assert r["result"]["nullified"] and r["kind"] == "play" and r["offense_is_caller"]
    assert (r["geo"]["x0"], r["geo"]["x_end"], r["geo"]["x_next"]) == (92, 93, 96)
    assert r["result"]["penalty"] == {"on": "TB", "foul": "Defensive Offside", "yards": 4, "at_x": 92, "no_play": True,
                                      "status": "enforced", "note": "defensive offside on TB"}
    assert r["result"]["first_down"] is False and r["pre"]["goal_to_go"] is True


def test_flag_on_a_play_that_stands(rows):
    r = row(rows, "4018729801359")
    assert r["result"]["nullified"] is False
    assert (r["geo"]["x_end"], r["geo"]["x_next"], r["result"]["first_down"], r["result"]["fd_by"]) == (88, 73, True, "penalty")
    assert r["result"]["penalty"]["on"] == "DAL" and r["result"]["penalty"]["no_play"] is False


# ---------------------------------------------------------------- 13-16: kicks, scoring, win probability
def test_kickoff_return_touchback_and_fumble(rows):
    r = row(rows, "40187298040")
    assert (r["seq"], r["team"], r["kind"], r["pre"], r["offense_is_caller"]) == (1, "DAL", "kickoff", None, False)
    assert (r["geo"]["dir"], r["geo"]["x0"], r["geo"]["x_end"], r["geo"]["x_next"]) == (1, 65, 30, 30)
    k = r["kick"]
    assert {key: k[key] for key in ("by", "kdir", "from_x", "dist", "land_x", "ez", "touchback", "ret_yards",
                                     "ret_end_x", "fumble_rec")} == \
        {"by": "TB", "kdir": -1, "from_x": 65, "dist": 62, "land_x": 3, "ez": False, "touchback": False,
         "ret_yards": 27, "ret_end_x": 30, "fumble_rec": None}
    r = row(rows, "4018729803781")
    assert (r["seq"], r["team"], r["geo"]["dir"], r["geo"]["x0"], r["geo"]["x_end"], r["geo"]["x_next"]) == (161, "TB", -1, 35, 100, 65)
    assert (r["kick"]["by"], r["kick"]["kdir"], r["kick"]["dist"], r["kick"]["land_x"], r["kick"]["ez"], r["kick"]["touchback"]) == \
        ("DAL", 1, 65, 100, True, True)
    r = row(rows, "4018729802667")
    assert (r["seq"], r["team"], r["geo"]["x0"], r["geo"]["x_end"], r["geo"]["x_next"]) == (113, "DAL", 65, 37, 37)
    assert (r["kick"]["dist"], r["kick"]["land_x"], r["kick"]["ret_yards"], r["kick"]["ret_end_x"], r["kick"]["fumble_rec"]) == \
        (61, 4, 24, 28, {"team": "TB", "x": 37})
    assert (r["result"]["turnover"], r["result"]["turnover_kind"], r["result"]["yards"]) == (True, "fumble", None)
    assert (r["wp"]["home"], r["wp"]["delta"]) == (0.2403, -0.1154)


def test_punt_kick_fields(rows):
    r = row(rows, "4018729801082")
    assert (r["seq"], r["pre"]["text"], r["geo"]["x_end"], r["geo"]["x_next"]) == (43, "4th & 10 at DAL 44", 97, 97)
    k = r["kick"]
    assert (k["by"], k["kdir"], k["dist"], k["land_x"], k["oob"], k["ret_end_x"], k["fair_catch"]) == ("DAL", 1, 53, 97, True, None, False)
    r = row(rows, "4018729801749")
    assert (r["kick"]["land_x"], r["kick"]["ret_yards"], r["kick"]["ret_end_x"], r["geo"]["x_next"]) == (64, 12, 52, 52)
    assert row(rows, "4018729801339")["kick"]["fair_catch"] is True


def test_field_goal_kick_spots(rows):
    r = row(rows, "4018729802060")
    assert (r["geo"]["x0"], r["geo"]["x_next"], r["kick"]["x_kick"], r["kick"]["post_x"], r["kick"]["good"]) == (77, None, 69, 110, True)
    assert (r["kick"]["dist"], r["score"], r["post"]) == (41, {"DAL": 10, "TB": 7}, None)
    r = row(rows, "4018729802919")
    assert (r["geo"]["x0"], r["kick"]["x_kick"], r["kick"]["post_x"], r["kick"]["kdir"]) == (23, 31, -10, -1)


def test_scoring_rows_and_points(rows, summary):
    scored = [r for r in rows if r["scoring"]]
    assert [r["id"] for r in scored] == [str(sp["id"]) for sp in summary["scoringPlays"]]
    assert row(rows, "401872980322")["scoring"] == {"team": "DAL", "type": "TD", "pts": 7, "pat": "kick_good"}
    r = row(rows, "4018729803742")
    assert r["scoring"] == {"team": "DAL", "type": "TD", "pts": 6, "pat": "two_failed"}
    assert r["score"] == {"DAL": 16, "TB": 24}
    assert row(rows, "4018729802060")["scoring"] == {"team": "DAL", "type": "FG", "pts": 3, "pat": None}
    assert row(rows, "401872980889")["scoring"]["team"] == "TB"
    assert row(rows, "401872980322")["geo"]["x_end"] == 100 and row(rows, "401872980889")["geo"]["x_end"] == 0


def test_win_probability_after_every_play(full, rows):
    assert all(isinstance(r["wp"]["home"], float) for r in rows)
    assert full["wp_start"] == 0.8619
    r = row(rows, "4018729802466")
    assert (r["wp"]["home"], r["wp"]["caller"], r["wp"]["delta"]) == (0.6324, 0.6324, -0.1132)
    assert rows[-1]["wp"]["home"] == 0.0
    assert rows[0]["wp"]["delta"] == round(0.8732 - 0.8619, 4)


def test_admin_rows(rows):
    admin = [r for r in rows if r["kind"] == "admin"]
    whats = {}
    for r in admin:
        whats[r["admin"]["what"]] = whats.get(r["admin"]["what"], 0) + 1
    assert whats == {"official_timeout": 15, "timeout": 6, "end_period": 2, "two_minute": 2, "end_half": 1, "end_game": 1}
    assert row(rows, "401872980778")["admin"] == {"what": "timeout", "by": "DAL"}
    assert all(r["pre"] is None and r["geo"] is None and r["call"] is None and not r["offense_is_caller"] for r in admin)


# ---------------------------------------------------------------- 17-19: drives, box score, status
def test_drives_match_espn(full, summary):
    drives = full["drives"]
    assert len(drives) == 21 and [d["idx"] for d in drives] == list(range(1, 22))
    assert sum(d["team"] == "DAL" for d in drives) == 10
    espn = summary["drives"]["previous"]
    for d, ed in zip(drives, espn):
        assert d["id"] == ed["id"] and d["complete"]
        if ed["offensivePlays"]:
            assert (d["start"]["x"], d["end"]["x"], d["yards"], d["plays"]) == \
                (ed["start"]["yardLine"], ed["end"]["yardLine"], ed["yards"], ed["offensivePlays"]), ed["description"]
    assert [d["result"] for d in drives] == ["TD", "TD"] + ["PUNT"] * 6 + ["FG", "END OF HALF", "TD", "INT", "TD", "FUMBLE",
                                                                         "FG", "DOWNS", "DOWNS", "TD", "PUNT", "INT", "END OF GAME"]
    d14 = drives[13]
    assert (d14["plays"], d14["yards"], d14["start"]["x"], d14["end"]["x"]) == (0, 0, 28, 28)
    assert drives[0] == {"idx": 1, "id": "4018729801", "team": "DAL", "offense_is_caller": True,
                         "start": {"qtr": 1, "clock": "15:00", "x": 30}, "end": {"qtr": 1, "clock": "10:51", "x": 100},
                         "plays": 9, "yards": 70, "time": "4:09", "time_s": 249, "result": "TD", "result_text": "Touchdown",
                         "complete": True, "seq": [1, 13], "engine_drive": 1}
    assert drives[9]["end"]["clock"] == "0:00" and drives[1]["engine_drive"] is None


BOX = {
    "DAL": {"plays": 55, "yards": 366, "rush": {"att": 13, "yds": 50},
            "pass": {"comp": 24, "att": 42, "net": 316, "int": 2, "sacks": 0, "sack_yds": 0},
            "first_downs": {"total": 20, "rush": 5, "pass": 12, "pen": 3},
            "third": {"conv": 4, "att": 10}, "fourth": {"conv": 0, "att": 1},
            "turnovers": 3, "fumbles_lost": 1, "penalties": {"n": 7, "yds": 57}, "top_s": 1239, "top": "20:39"},
    "TB": {"plays": 65, "yards": 419, "rush": {"att": 39, "yds": 241},
           "pass": {"comp": 19, "att": 25, "net": 178, "int": 0, "sacks": 1, "sack_yds": 11},
           "first_downs": {"total": 24, "rush": 10, "pass": 10, "pen": 4},
           "third": {"conv": 7, "att": 13}, "fourth": {"conv": 0, "att": 1},
           "turnovers": 0, "fumbles_lost": 0, "penalties": {"n": 14, "yds": 92}, "top_s": 2361, "top": "39:21"},
}


def test_box_score_matches_espn_final(full, summary):
    assert full["box"] == BOX
    for t in summary["boxscore"]["teams"]:
        stats = {s["name"]: s["displayValue"] for s in t["statistics"]}
        b = full["box"][t["team"]["abbreviation"]]
        assert stats["totalYards"] == str(b["yards"]) and stats["totalOffensivePlays"] == str(b["plays"])
        assert (stats["rushingYards"], stats["rushingAttempts"]) == (str(b["rush"]["yds"]), str(b["rush"]["att"]))
        assert stats["netPassingYards"] == str(b["pass"]["net"])
        assert stats["completionAttempts"] == f"{b['pass']['comp']}/{b['pass']['att']}"
        assert stats["sacksYardsLost"] == f"{b['pass']['sacks']}-{b['pass']['sack_yds']}"
        fd = b["first_downs"]
        assert (stats["firstDowns"], stats["firstDownsPassing"], stats["firstDownsRushing"], stats["firstDownsPenalty"]) == \
            (str(fd["total"]), str(fd["pass"]), str(fd["rush"]), str(fd["pen"]))
        assert stats["thirdDownEff"] == f"{b['third']['conv']}-{b['third']['att']}"
        assert stats["fourthDownEff"] == f"{b['fourth']['conv']}-{b['fourth']['att']}"
        assert (stats["turnovers"], stats["fumblesLost"]) == (str(b["turnovers"]), str(b["fumbles_lost"]))
        assert stats["totalPenaltiesYards"] == f"{b['penalties']['n']}-{b['penalties']['yds']}"
        assert stats["possessionTime"] == b["top"]


def test_status_mid_game_and_final(full, partial):
    assert partial["status"] == {"state": "in", "qtr": 3, "clock": "10:51", "poss": "TB", "score": {"DAL": 10, "TB": 14},
                                 "down_text": "1st & 10 at TB 25", "ball_x": 75, "ball_kind": "snap",
                                 "timeouts": {"DAL": 3, "TB": 3}, "last_seq": 104, "wp_home": 0.6324}
    assert full["status"] == {"state": "post", "qtr": 4, "clock": "0:00", "poss": None, "score": {"DAL": 16, "TB": 24},
                              "down_text": None, "ball_x": None, "ball_kind": None,
                              "timeouts": {"DAL": 1, "TB": 2}, "last_seq": 183, "wp_home": 0.0}


def test_status_after_a_score_is_a_kickoff(game):
    e, feed = game
    after_td = build(feed, e)["rows"][:12]
    st = tl.status(after_td, TEST_GAME["offense"])
    assert (st["ball_kind"], st["ball_x"], st["poss"], st["down_text"]) == ("kickoff", 35, "DAL", None)


# ---------------------------------------------------------------- 20-22: engine link, retag, no spoilers
def test_caller_rows_link_to_the_engine_log(game, rows):
    e = game[0]
    linked = [r for r in rows if r["pred"]]
    assert len(linked) == 59 and [r["pred"]["log_seq"] for r in linked] == list(range(1, 60))
    assert all(r["espn_id"] for r in e.state["log"]) and full_unlinked(rows) == 0
    nulls = [r["id"] for r in linked if r["result"]["nullified"]]
    assert nulls == ["401872980210", "401872980265", "4018729801640", "4018729803985"]
    p = row(rows, "40187298068")["pred"]
    assert (p["p"], p["p_league"], p["p_habits"], p["flag"], p["snap"], p["engine_drive"]) == (0.4562, 0.4624, 0.4562, "no edge", 1, 1)
    assert (p["top3"], p["leaf_rank"], p["fam_p"], p["family"], p["leaf"]) == \
        (["run_inside", "pa_short", "dropback_short"], 3, 0.1781, "dropback", "dropback_short")
    assert len(p["dist"]["his_f"]) == 5 and len(p["dist"]["lg_l"]) == 14 and p["dist"]["his_f"][1] == 0.1781
    assert p["retagged"] is False and "tree" not in p


def full_unlinked(rows):
    return sum(1 for r in rows if r["kind"] == "play" and r["offense_is_caller"] and not r["pred"])


def test_retag_changes_pred_not_geometry(game):
    e, feed = game
    pid = e.state["log"][-1]["espn_id"]
    before = row(build(feed, e)["rows"], pid)
    e.retag_last("A")
    try:
        after = row(build(feed, e)["rows"], pid)
        assert (before["pred"]["family"], after["pred"]["family"], after["pred"]["retagged"]) == ("dropback", "pa", True)
        assert after["geo"] == before["geo"] and after["call"] == before["call"]
    finally:
        e.undo()


def test_partial_game_has_no_spoilers(partial):
    assert partial["n"] == 104 and len(partial["rows"]) == 104
    assert len(partial["drives"]) == 12
    d12 = partial["drives"][-1]
    assert (d12["idx"], d12["result"], d12["complete"]) == (12, "INT", True)
    assert (partial["box"]["DAL"]["yards"], partial["box"]["TB"]["yards"]) == (187, 241)
    assert partial["status"]["state"] != "post"
    assert max(r["seq"] for r in partial["rows"]) == 104


# ---------------------------------------------------------------- 24-25: legacy seen file, manual mode
def test_legacy_sorted_seen_file_is_reordered(game, sandbox, summary):
    import espn_feed
    e, feed = game
    ids = [str(p["id"]) for t, p in iter_plays(summary)]
    espn_feed.SEEN_PATH.write_text(json.dumps({TEST_GAME["game_id"]: sorted(ids)}))
    legacy = Feed(e, threading.RLock())
    assert legacy.applied != ids                    # string order, not the order the plays happened
    before = e.epoch()
    legacy.summary = summary
    assert e.epoch() != before                      # the rows changed order: a client must redraw from scratch
    rows = build(legacy, e)["rows"]
    assert [r["id"] for r in rows] == ids and [r["seq"] for r in rows] == list(range(1, 184))
    assert legacy.applied == ids


def test_seen_file_keeps_apply_order(make_feed, summary):
    import espn_feed
    e, feed = make_feed()
    plays = iter_plays(summary)
    late = plays[5]
    for team, p in plays[:5] + plays[6:9] + [late]:      # a play ESPN inserted late arrives last
        feed.apply_one(team, p)
    order = [str(p["id"]) for t, p in plays[:5] + plays[6:9] + [late]]
    assert feed.applied == order
    again = Feed(e, threading.RLock())
    assert again.applied == order and again.seen == set(order)
    stored = json.loads(espn_feed.SEEN_PATH.read_text())
    assert stored[TEST_GAME["game_id"]] == order
    again.summary = summary
    rows = build(again, e)["rows"]
    assert [r["id"] for r in rows] == order and rows[-1]["seq"] == 9


def test_manual_mode_rows_from_the_log(make_feed):
    e, feed = make_feed()
    e.command("new D25")
    e.record_play(None, 6, leaf="run_ot_left")
    e.record_play(None, 8, leaf="dropback_short")
    e.record_play(None, 0, leaf="dropback_deep", outcome="incomplete")
    out = build(feed, e, mode="manual")
    assert (out["source"], out["n"], out["unlinked"]) == ("log", 3, [])
    rows = out["rows"]
    assert [r["src"] for r in rows] == ["log"] * 3 and [r["id"] for r in rows] == ["log-1", "log-2", "log-3"]
    assert all(r["geo"]["x0"] == 100 - r["pre"]["yardline_100"] for r in rows)
    assert [r["geo"]["x0"] for r in rows] == [25, 31, 39]
    run, short, deep = rows
    assert (run["geo"]["lat"], run["geo"]["x_end"], run["geo"]["x_next"], run["post"]["down"]) == ("left", 31, 31, 2)
    assert (short["call"]["air"], short["call"]["air_src"], short["call"]["depth"], short["geo"]["x_catch"]) == (3, "bucket", "short", 34)
    assert short["geo"]["approx"] == ["x_catch", "lat"] and short["geo"]["lat"] is None
    assert (short["result"]["first_down"], short["wp"], short["espn_seq"], short["type"], short["wall"]) == (True, None, None, None, None)
    assert (deep["call"]["air"], deep["call"]["air_band"], deep["geo"]["x_end"], deep["geo"]["x_next"], deep["post"]) == (26, [22, 35], 39, None, None)
    assert run["pred"]["log_seq"] == 1 and run["pred"]["family"] == "run"
    assert out["drives"][0]["team"] == "DAL" and out["drives"][0]["result"] is None and out["drives"][0]["plays"] == 3
    assert out["teams"]["DAL"]["color"] is None and out["status"]["state"] == "in"


def test_a_game_saved_by_an_older_build_still_draws(make_feed, summary):
    """data/live_state.json was written before log rows had a seq: its timeline must build, not answer 500."""
    e, feed = make_feed()
    e.command("new D25")
    e.record_play(None, 4, leaf="run_inside")
    e.record_play(None, 7, leaf="dropback_short")
    live.STATE_PATH.write_text(json.dumps(legacy_game(e.state)))
    old = live.GameEngine()
    assert [r["seq"] for r in old.state["log"]] == [1, 2]                      # the 1-based log position, as always
    out = tl.response(None, [], old.state, TEST_GAME, epoch="e", client_epoch="e", mode="manual")
    assert [r["id"] for r in out["rows"]] == ["log-1", "log-2"] and [r["pred"]["log_seq"] for r in out["rows"]] == [1, 2]
    espn = tl.response(summary, ["40187298040"], old.state, TEST_GAME, epoch="e", mode="replay")
    assert (espn["source"], espn["n"], espn["unlinked"]) == ("espn", 1, [1, 2])  # typed rows that aren't on the field


def test_manual_drive_ends_and_touchdown(make_feed):
    e, feed = make_feed()
    e.command("new T20")
    e.record_play(None, 3, leaf="run_inside")
    e.end_drive("punt")
    e.command("new T10")
    e.record_play(None, 10, leaf="pa_mid")
    assert e.state["drive_ends"] == {"1": "punt"}
    out = build(feed, e, mode="manual")
    assert [d["result"] for d in out["drives"]] == ["PUNT", "TD"]
    td = out["rows"][-1]
    assert (td["geo"]["x_end"], td["result"]["td"], td["scoring"]) == (100, True, {"team": "DAL", "type": "TD", "pts": 7, "pat": None})


# ---------------------------------------------------------------- since / epoch slicing (the HTTP test pins the wiring)
def test_since_returns_only_new_rows_and_extras_only_on_reset(game):
    e, feed = game
    out = build(feed, e, since=100)
    assert ([r["seq"] for r in out["rows"]], out["reset"], out["since"]) == (list(range(101, 184)), False, 100)
    assert "teams" not in out and "field" not in out and "meta" not in out and len(out["drives"]) == 21
    wrong = build(feed, e, since=100, client_epoch="old")
    assert wrong["reset"] and wrong["since"] == 0 and len(wrong["rows"]) == 183 and "teams" in wrong
    past = build(feed, e, since=500)
    assert past["reset"] and len(past["rows"]) == 183
    first = build(feed, e, since=0, client_epoch=None)
    assert first["reset"] and first["field"] == {"units": "yd", "orientation": "caller_left", "left_team": "DAL",
                                                 "right_team": "TB", "home": "DAL", "x_min": -10, "x_max": 110,
                                                 "width": 53.333, "goal_lines": [0, 100], "posts_x": [-10, 110],
                                                 "hash_y": [23.583, 29.75]}
    assert first["team_order"] == ["TB", "DAL"]
    assert first["teams"]["DAL"] == {"abbr": "DAL", "espn_id": "6", "name": "Cowboys", "location": "Dallas",
                                     "display_name": "Dallas Cowboys", "home": True, "caller": True, "side": "left",
                                     "color": "#002a5c", "alt_color": "#b0b7bc", "logo": "/api/logo/DAL",
                                     "logo_dark": "/api/logo/DAL?v=dark"}
    assert first["meta"]["families"] == ["run", "dropback", "pa", "screen", "rpo"] and len(first["meta"]["leaves"]) == 14
    assert first["meta"]["air_est"]["short"]["air"] == 5 and first["epoch"] == "test-1" and first["mode"] == "replay"
    json.dumps(first)                                    # plain JSON, nothing numpy


def test_rows_are_frozen_per_epoch_but_pred_is_live(game):
    e, feed = game
    cache = {}
    one = build(feed, e, cache=cache)["rows"]
    assert len(cache) == 183
    cache["40187298068"]["text"] = "frozen"
    two = build(feed, e, cache=cache)["rows"]
    assert row(two, "40187298068")["text"] == "frozen" and row(two, "40187298068")["pred"] == row(one, "40187298068")["pred"]


def test_applied_plays_missing_from_the_summary_are_listed(game, summary):
    """ESPN can drop or re-id a play after it was applied: the row can't be drawn, and the response says which."""
    e, feed = game
    gone = "4018729801082"                                    # DAL's first punt, seq 43
    trimmed = copy.deepcopy(summary)
    for d in trimmed["drives"]["previous"]:
        d["plays"] = [p for p in d["plays"] if str(p["id"]) != gone]
    out = tl.response(trimmed, feed.applied, e.state, TEST_GAME, epoch="m", mode="replay")
    assert (out["n"], len(out["rows"]), out["missing"]) == (183, 182, [gone])
    assert 43 not in [r["seq"] for r in out["rows"]]
    assert build(feed, e)["missing"] == [] and build(feed, e)["skipped"] == []


def test_a_skipped_play_is_logged_with_its_traceback_and_listed(make_feed, summary, monkeypatch, caplog):
    """A play the feed can't apply is skipped, never silently: the server log gets the traceback, and the timeline
    names its row (a caller snap left without a prediction)."""
    e, feed = make_feed()
    plays = iter_plays(summary)
    bad = str(plays[1][1]["id"])                              # DAL's first snap, seq 2
    real = feed._apply_one

    def flaky(team, p):
        if str(p["id"]) == bad:
            raise RuntimeError("bad play")
        return real(team, p)
    monkeypatch.setattr(feed, "_apply_one", flaky)
    feed.summary = summary
    with caplog.at_level(logging.ERROR, logger="espn_feed"):
        for team, p in plays[:3]:
            feed.apply_one(team, p)
    assert feed.skipped_ids == [bad] and feed.applied == [str(p["id"]) for t, p in plays[:3]]
    logged = [r for r in caplog.records if bad in r.getMessage()]
    assert logged and logged[0].exc_info and "bad play" in str(logged[0].exc_info[1])
    out = tl.response(feed.summary, feed.applied, e.state, TEST_GAME, epoch="s", mode="live", skipped=feed.skipped_ids)
    assert out["skipped"] == [2] and row(out["rows"], bad)["pred"] is None
    feed.forget()
    assert feed.skipped_ids == []


# ---------------------------------------------------------------- feed plumbing
def test_classify_keeps_old_keys_and_adds_side_depth_air_gap(summary):
    p = espn_play(summary, "40187298068")
    info = classify("DAL", p)
    assert (info["kind"], info["family"], info["leaf"], info["outcome"], info["yards"]) == ("play", "dropback", "dropback_short", "incomplete", 0)
    assert (info["lat"], info["depth"], info["air"], info["air_src"], info["air_band"], info["yac"], info["gap"]) == \
        ("middle", "short", 5, "est", [1, 10], None, None)
    info = classify("TB", espn_play(summary, "401872980390"))
    assert (info["lat"], info["air"], info["air_src"], info["yac"]) == ("left", -1, "yac", 4)
    info = classify("TB", espn_play(summary, "401872980442"))
    assert (info["outcome"], info["lat"], info["gap"], info["air"]) == ("scramble", "right", "right end", None)
    info = classify("TB", espn_play(summary, "4018729802242"))
    assert (info["leaf"], info["lat"], info["gap"]) == ("run_ot_left", "left", "left tackle")
    info = classify("DAL", espn_play(summary, "4018729802466"))
    assert (info["lat"], info["depth"], info["air"], info["air_src"]) == ("middle", "short", None, None)


def test_iter_drive_plays_carries_the_drive(summary):
    plays = iter_drive_plays(summary)
    assert len(plays) == 183
    assert [(t, i, d, str(p["id"])) for t, i, d, p in plays[:2]] == \
        [("DAL", 1, "4018729801", "40187298040"), ("DAL", 1, "4018729801", "40187298068")]
    assert plays[-1][:3] == ("TB", 21, "40187298021")
    assert [(t, str(p["id"])) for t, i, d, p in plays] == [(t, str(p["id"])) for t, p in iter_plays(summary)]


def test_stale_generation_applies_nothing(make_feed, summary):
    e, feed = make_feed()
    gen = feed.gen
    feed.invalidate()
    assert feed.gen == gen + 1
    assert feed.apply(summary, gen) == 0 and e.state["log"] == [] and feed.applied == []
    assert feed.apply(summary, feed.gen) == 55


def test_apply_one_never_raises(make_feed, summary, monkeypatch):
    e, feed = make_feed()
    team, p = iter_plays(summary)[1]

    def boom(*a, **k):
        raise RuntimeError("bad play")
    monkeypatch.setattr(feed, "_apply_one", boom)
    assert feed.apply_one(team, p) == 0
    assert feed.applied == [str(p["id"])] and "bad play" in feed.status["skipped"]


def test_summary_loader_memory_then_live_file_then_final(make_feed, sandbox, summary):
    import espn_feed
    e, feed = make_feed()
    feed.summary = None
    assert feed.load_summary() is None
    (espn_feed.RAW_DIR).mkdir(exist_ok=True)
    final = espn_feed.RAW_DIR / f"summary_{TEST_GAME['espn_event']}_final.json"
    live = espn_feed.RAW_DIR / f"summary_{TEST_GAME['espn_event']}.json"
    try:
        final.write_text(json.dumps({"drives": {"previous": []}, "which": "final"}))
        assert feed.load_summary()["which"] == "final"
        feed.summary = None
        live.write_text(json.dumps({"which": "live"}))
        assert feed.load_summary()["which"] == "live"
        feed.summary = summary
        assert feed.load_summary() is summary
        live.write_text("{not json")
        feed.summary = None
        assert feed.load_summary()["which"] == "final"      # a corrupt live file falls through
        feed.summary, feed.event_id = None, "../../etc"
        assert feed.load_summary() is None
    finally:
        for f in (final, live):
            f.unlink(missing_ok=True)


def test_forget_and_reset_change_the_epoch(make_feed):
    e, feed = make_feed()
    first = e.epoch()
    feed.forget()
    second = e.epoch()
    e.reset()
    assert len({first, second, e.epoch()}) == 3
    assert first.split("-")[0] == e.epoch().split("-")[0]       # same boot id


def test_typed_plays_then_the_feed_start_a_new_timeline_once(make_feed, summary):
    """The field drew hand-typed rows; the first ESPN play switches it to ESPN's rows (B1), and only the first."""
    e, feed = make_feed()
    e.command("new D25")
    e.record_play(None, 4, leaf="run_inside")
    typed = e.epoch()
    feed.summary = summary
    plays = iter_plays(summary)
    feed.apply_one(*plays[0])
    switched = e.epoch()
    feed.apply_one(*plays[1])
    assert switched != typed and e.epoch() == switched


def test_following_another_event_drops_polls_in_flight(make_feed, monkeypatch):
    """A poll of the old event that lands after the switch would be saved as the new event's summary."""
    e, feed = make_feed()
    monkeypatch.setattr(feed, "_loop", lambda: None)            # no poll thread in a unit test
    feed.event_id = "401872980"
    gen = feed.gen
    feed.start("401872980")                                     # the same event: a poll in flight still counts
    assert feed.gen == gen and feed.on
    feed.start("401872999")
    assert feed.gen == gen + 1 and feed.event_id == "401872999"
    feed.stop()


def test_resolving_the_event_needs_no_lock_and_checks_the_id(make_feed, monkeypatch):
    """/api/feed resolves the event (today's game can take a 10 s scoreboard call) before it takes the app's lock."""
    e, feed = make_feed()
    calls = []
    monkeypatch.setattr(espn_feed, "find_event", lambda team, date=None: calls.append(team) or ("401872980", "x"))
    feed.event_id = None
    assert feed.resolve_event(None) == "401872980" and calls == ["DAL"]
    assert feed.resolve_event("401872999") == "401872999" and feed.event_id is None   # resolving changes nothing
    feed.event_id = "401872981"
    assert feed.resolve_event("") == "401872981" and calls == ["DAL"]
    monkeypatch.setattr(espn_feed, "find_event", lambda team, date=None: (None, None))
    feed.event_id = None
    for bad in (None, "../x"):
        with pytest.raises(ValueError):
            feed.resolve_event(bad)


def test_event_ids_are_ascii_digits_only():
    assert espn_feed.check_event("401872980") == "401872980" and espn_feed.check_event(401872980) == "401872980"
    for bad in ("٤٠١٨٧٢٩٨٠", "４０１８７２９８０", "401872980\n", "", "../1"):     # Arabic-Indic and fullwidth digits too
        with pytest.raises(ValueError):
            espn_feed.check_event(bad)


# ---------------------------------------------------------------- engine plumbing
def test_log_rows_carry_espn_id_and_clock_estimate(game):
    e = game[0]
    assert all(r["espn_id"] for r in e.state["log"])
    nulls = [r for r in e.state["log"] if r["nullified"]]
    assert [r["espn_id"] for r in nulls] == ["401872980210", "401872980265", "4018729801640", "4018729803985"]
    assert all(r["clock_est"] is False for r in e.state["log"])          # ESPN gives every clock


def test_manual_rows_mark_an_estimated_clock(make_feed):
    e, feed = make_feed()
    e.command("new D25")
    e.record_play(None, 4, leaf="run_inside")
    e.record_play(None, 4, leaf="run_inside")
    assert [r["clock_est"] for r in e.state["log"]] == [False, True]
    assert [r["espn_id"] for r in e.state["log"]] == [None, None]


def test_predict_is_memoized_but_never_stale_after_undo(make_feed):
    e, feed = make_feed()
    e.command("new D25")
    before = e.predict()
    assert e.predict() == before and e.predict() is not e.predict()
    e.record_play(None, 30, leaf="dropback_deep")
    after = e.predict()
    e.undo()
    again = e.predict()
    assert again["p"] == before["p"] and again["p"] != after["p"]
    e.view()                                             # view() pops _tree from its copy only
    assert "_tree" in e.predict()


def test_the_game_file_is_replaced_whole_never_half_written(make_feed, monkeypatch):
    """Watch and replay save about twice a play: a save cut short must leave the last good file, not half of one."""
    e, feed = make_feed()
    e.command("new D25")
    good = live.STATE_PATH.read_bytes()

    def crash(src, dst):
        raise OSError("killed mid-save")
    monkeypatch.setattr(live.os, "replace", crash)
    with pytest.raises(OSError):
        e.record_play(None, 4, leaf="run_inside")
    assert live.STATE_PATH.read_bytes() == good
    assert not list(live.STATE_PATH.parent.glob("*.tmp"))


def test_an_unreadable_game_file_is_kept_aside_not_overwritten(make_feed):
    e, feed = make_feed()
    cut = '{"game": {"game_id": "2026_05_TB_DAL"}, "log": ['
    live.STATE_PATH.write_text(cut)
    fresh = live.GameEngine()
    assert fresh.state["log"] == [] and live.STATE_PATH.read_text() == cut      # nothing written over it yet
    kept = list(live.STATE_PATH.parent.glob("live_state.unreadable-*.json"))
    assert len(kept) == 1 and kept[0].read_text() == cut
    for p in kept:
        p.unlink()


@pytest.mark.parametrize("planted, gid", [
    ({"game": {"game_id": "2026_06_PHI_NYG"}, "log": [{"seq": 1}], "sit": {}}, "2026_06_PHI_NYG"),
    ({"game": {"game_id": "../../etc/x y"}, "log": []}, "unknown"),           # never a path in a file name
    ([1, 2, 3], "unknown"),                                                   # parses, but holds no game
    ({"log": []}, "unknown"),
], ids=["another-game", "unsafe-id", "a-list", "no-game"])
def test_another_games_file_is_kept_aside_before_the_first_save(make_feed, planted, gid):
    """G1-3: a game file for another matchup (every new GAME in config.py) used to be dropped silently, and the
    first save wrote the new game over it. Now a byte-identical copy is kept first and the message names it."""
    make_feed()
    raw = json.dumps(planted).encode()
    live.STATE_PATH.write_bytes(raw)
    e = live.GameEngine()
    kept = list(live.STATE_PATH.parent.glob(f"live_state.other-{gid}-*.json"))
    assert len(kept) == 1 and kept[0].read_bytes() == raw
    assert e.state["log"] == [] and kept[0].name in e.state["message"]
    e.command("new D25")                                      # the first save: the new game, the copy untouched
    assert json.loads(live.STATE_PATH.read_text())["game"]["game_id"] == TEST_GAME["game_id"]
    assert kept[0].read_bytes() == raw
    live.STATE_PATH.write_bytes(raw)
    live.GameEngine()                                          # the same second again: a second copy, never over one
    assert len(list(live.STATE_PATH.parent.glob(f"live_state.other-{gid}-*.json"))) == 2


def test_setting_the_summary_knows_which_team_is_ours(make_feed, summary):
    """Watch mode applies plays one by one with apply_one: possession changes need the offense's ESPN id."""
    e, feed = make_feed()
    feed.off_team_id = None
    feed.summary = summary
    assert feed.off_team_id == "6"
    for team, p in iter_plays(summary)[:60]:          # through DAL's first punt and TB's ball after it
        feed.apply_one(team, p)
    assert e.state["drive_n"] == 3 and e.state["drive_active"] is False


def test_a_drive_with_only_a_touchback_kickoff_starts_at_the_touchback(rows):
    kickoff = row(rows, "4018729803781")                  # DAL kicks into the end zone, TB ball at its 35
    d = tl.drive_of(19, [kickoff], False, {}, "DAL")
    assert (d["start"]["x"], d["plays"], d["yards"], d["complete"]) == (65, 0, 0, False)


def test_score_needs_both_teams():
    assert tl.score_of({"homeScore": 7, "awayScore": 0}, {"home": "DAL", "teams": ["DAL"]}) is None
    assert tl.score_of({"homeScore": 7, "awayScore": 3}, {"home": "DAL", "teams": ["TB", "DAL"]}) == {"DAL": 7, "TB": 3}


def test_text_parsers_on_shapes_this_game_lacks():
    import timeline_text as tt
    ctx = {"caller": "DAL", "teams": ["TB", "DAL"]}
    pen = tt.penalty_of("PENALTY on TB-X.Smith, Unnecessary Roughness, 15 yards, enforced between downs.", ctx)
    assert (pen["on"], pen["yards"], pen["at_x"], pen["no_play"], pen["status"]) == ("TB", 15, None, False, "enforced")
    pen = tt.penalty_of("PENALTY on WAS-J.Doe, Offensive Holding, declined.", {"caller": "DAL", "teams": ["WSH", "DAL"]})
    assert (pen["on"], pen["status"], pen["yards"]) == ("WSH", "declined", None)
    k, end = tt.kick_facts("kickoff", "DAL", "TB", "X kicks 65 yards from TB 35 to DAL 0. Y to DAL 20 for 20 yards. "
                           "FUMBLES, RECOVERED by TB at DAL 22.", "", 65, ctx)
    assert (k["fumble_rec"], end, k["blocked"]) == ({"team": "TB", "x": 22}, 22, False)
    k, end = tt.kick_facts("punt", "DAL", "TB", "B.Anger punts 40 yards to TB 20, Center-T.Sieg. Z to TB 25 for 5 "
                           "yards (Blocked by Q).", "", 40, ctx)
    assert (k["blocked"], k["ret_end_x"], end) == (False, 75, 75)


# ---------------------------------------------------------------- G1-6: a malformed poll never fails /api/timeline
def first_drives(summary, n=4):
    """The opening drives of the real game with their win probability: a summary the mutations below can afford to
    rebuild hundreds of times."""
    s = {k: summary[k] for k in ("header", "boxscore", "gameInfo", "winprobability")}
    s["drives"] = {"previous": copy.deepcopy(summary["drives"]["previous"][:n])}
    s["header"] = copy.deepcopy(summary["header"])
    s["winprobability"] = copy.deepcopy(summary["winprobability"])
    return s


def spots_in(node, keep=lambda path: True, path=()):
    """Every (container, key, path) in a JSON tree."""
    items = node.items() if isinstance(node, dict) else enumerate(node) if isinstance(node, list) else ()
    for k, v in items:
        if keep(path + (k,)):
            yield node, k, path + (k,)
        yield from spots_in(v, keep, path + (k,))


def test_a_malformed_summary_never_fails_the_timeline(make_feed, summary, caplog):
    """G1-6: one null winprobability entry, one null drive, or a distance of '' used to raise inside
    timeline.response, and /api/timeline answered 500 for the rest of the game. Now every single mutation of the
    summary below answers; a row that can't be built is left out, listed in `missing`, and the log says why."""
    import random
    e, feed = make_feed()
    small = first_drives(summary)
    feed.apply(small)
    applied = list(feed.applied)
    assert len(applied) > 30
    for known in ((small["winprobability"], 3), (small["drives"]["previous"], 1)):      # the reviewer's cases
        container, key = known
        old, container[key] = container[key], None
        out = tl.response(small, applied, e.state, TEST_GAME, epoch="m", client_epoch="m", mode="live", cache={})
        container[key] = old
        assert out["n"] == len(applied)
    play = small["drives"]["previous"][1]["plays"][2]
    old, play["start"]["distance"] = play["start"]["distance"], ""
    out = tl.response(small, applied, e.state, TEST_GAME, epoch="m", client_epoch="m", mode="live", cache={})
    play["start"]["distance"] = old
    assert out["rows"][[r["id"] for r in out["rows"]].index(str(play["id"]))]["pre"]["togo"] is None

    rng = random.Random(1806)
    values = [None, "", "x", -1, 0, 10 ** 12, 2.5, float("nan"), [], {}, [None], {"x": None}, True, "15:00"]
    spots = list(spots_in(small))
    for _ in range(600):
        container, key, path = rng.choice(spots)
        value = rng.choice(values)
        where = f"{'.'.join(map(str, path))} = {value!r}"
        old, container[key] = container[key], value
        try:
            out = tl.response(small, applied, e.state, TEST_GAME, epoch="m", client_epoch="m", mode="live",
                              cache={})
        except Exception as ex:                                     # pragma: no cover (the failure message)
            pytest.fail(f"{where}: {type(ex).__name__}: {ex}")
        finally:
            container[key] = old
        drawn = {r["id"] for r in out["rows"]}
        assert set(out["missing"]) == {pid for pid in applied if pid not in drawn}, where
        try:
            json.dumps(out, allow_nan=False)                         # JSON the browser can parse: no NaN, no inf
        except ValueError:                                           # pragma: no cover (the failure message)
            pytest.fail(f"{where} put NaN or infinity in the answer")


# ---------------------------------------------------------------- G1-4, G1-5: flags and interceptions typed by hand
def manual_flags_game(e):
    """A hand-typed drive with every kind of flag the evidence named: pre-snap with no play (X FS), a flag on a
    picked play (DH), offsetting fouls on a picked play, a flag after a play that stands (X URD), and DPI after an
    incompletion."""
    e.command("new D25")                                                   # 1st & 10 at DAL 25
    e.command("X FS")                                                      # 1  false start: 1st & 15 at DAL 20
    e.record_play(None, 4, leaf="run_inside")                              # 2  run +4: 2nd & 11 at DAL 24
    e.apply_penalty("DH", play={"leaf": "dropback_short"})                 # 3  no play, 5 yards, 1st & 10 at DAL 29
    e.apply_penalty("OFFSET", play={"leaf": "run_inside"})                 # 4  no play, nothing moves
    e.record_play(None, 0, leaf="dropback_deep", outcome="incomplete")     # 5  incomplete: 2nd & 10 at DAL 29
    e.command("X DPI 30")                                                  # 6  DPI: 1st & 10 at TB 41
    e.record_play(None, 6, leaf="run_ot_left")                             # 7  run +6: 2nd & 4 at TB 35
    e.command("X URD")                                                     # 8  after the play: 15, 1st & 10 at TB 20


def test_hand_typed_flags_are_rows_the_field_draws(make_feed):
    """G1-4: a flag with no play logged nothing, so the field drew nothing and the next snap's line made the ball
    jump on the play before it (a 0-yard pass marched 30 yards); an offsetting no-play marched to wherever the next
    snap was. Now every flag is a penalty row in ESPN's shape, a no-play marches to its own enforced spot, and a
    flag on a play names the foul, the team and the yards."""
    e, feed = make_feed()
    manual_flags_game(e)
    out = build(feed, e, mode="manual")
    rows = out["rows"]
    assert [r["seq"] for r in rows] == list(range(1, 9)) and out["n"] == 8
    assert [r["kind"] for r in rows] == ["penalty", "play", "play", "play", "play", "penalty", "play", "penalty"]
    fs, run, dh, offset, inc, dpi, run2, urd = rows
    assert (fs["geo"]["x0"], fs["geo"]["x_next"], fs["pred"], fs["call"]) == (25, 20, None, None)
    assert fs["result"]["penalty"] == {"code": "FS", "foul": "false start", "on": "DAL", "yards": 5, "at_x": 25,
                                       "no_play": True, "status": "enforced", "note": None}
    assert (fs["pre"]["text"], fs["post"]["text"], fs["result"]["first_down"]) == \
        ("1st & 10 at DAL 25", "1st & 15 at DAL 20", False)
    assert (dh["result"]["nullified"], dh["geo"]["x0"], dh["geo"]["x_next"]) == (True, 24, 29)
    assert dh["result"]["penalty"] == {"code": "DH", "foul": "defensive holding", "on": "TB", "yards": 5,
                                       "at_x": 24, "no_play": True, "status": "enforced", "note": None}
    assert dh["post"]["text"] == "1st & 10 at DAL 29" and dh["result"]["first_down"] and dh["pred"]["leaf"] == \
        "dropback_short"
    assert (offset["geo"]["x0"], offset["geo"]["x_next"], offset["result"]["penalty"]["status"]) == (29, 29, "offsetting")
    assert offset["result"]["penalty"]["on"] is None and offset["result"]["penalty"]["foul"] == "offsetting penalties"
    assert (inc["geo"]["x_end"], inc["geo"]["x_next"]) == (29, 29)            # the pass doesn't march: the flag does
    assert (dpi["geo"]["x0"], dpi["geo"]["x_next"], dpi["result"]["penalty"]["yards"]) == (29, 59, 30)
    assert dpi["result"]["first_down"] and dpi["result"]["fd_by"] == "penalty"
    assert (run2["geo"]["x_end"], run2["geo"]["x_next"]) == (65, 65)
    assert (urd["geo"]["x0"], urd["geo"]["x_next"], urd["result"]["penalty"]["foul"]) == (65, 80, "unnecessary roughness")
    assert urd["result"]["nullified"] is False and urd["result"]["first_down"] is True
    assert out["drives"][0]["plays"] == 3 and out["drives"][0]["yards"] == 55          # flags are not plays
    assert out["box"]["DAL"]["penalties"] == {"n": 1, "yds": 5}
    assert out["status"]["down_text"] == "1st & 10 at TB 20"


def test_hand_typed_flags_stay_out_of_the_scoring_and_the_log_list(make_feed):
    """The flag rows are timeline rows only: metrics, the play log the page lists, the archive and the CSV count
    snaps; an undo takes a flag back like any action, and the next seq follows on."""
    import csv
    import io
    e, feed = make_feed()
    manual_flags_game(e)
    assert e.metrics()["n"] == 5 and len(e.view()["log"]) == 5 and all(r.get("snap") for r in e.view()["log"])
    assert len(list(csv.reader(io.StringIO(e.export_csv())))) == 1 + 5
    con = __import__("duckdb").connect(str(live.DB_PATH))
    try:
        assert con.execute("SELECT count(*) FROM live_log WHERE game_id = ?", [TEST_GAME["game_id"]]).fetchone()[0] == 5
    finally:
        con.close()
    e.undo()                                                               # takes X URD back
    assert len(e.state["log"]) == 7 and e.state["sit"]["yardline_100"] == 35
    e.command("X OH")
    assert e.state["log"][-1]["seq"] == 8 and e.state["log"][-1]["kind"] == "penalty"
    assert build(feed, e, mode="manual")["rows"][-1]["result"]["penalty"]["on"] == "DAL"


def test_a_typed_interception_is_an_interception(make_feed):
    """G1-5: shorthand I logged a turnover with no kind, so the field said 'fumble lost'. Grading stays pass versus
    run (no family is invented); the row says int, and F says fumble."""
    e, feed = make_feed()
    e.command("new D25")
    e.command("I")
    e.command("new D40")
    e.command("K 3 F")
    pick, fumble = e.state["log"]
    assert (pick["turnover_kind"], pick["family"], pick["leaf"], pick["dropback"]) == ("int", None, None, 1)
    assert fumble["turnover_kind"] == "fumble"
    out = build(feed, e, mode="manual")
    assert [r["result"]["turnover_kind"] for r in out["rows"]] == ["int", "fumble"]
    assert out["box"]["DAL"]["pass"]["int"] == 1 and out["box"]["DAL"]["fumbles_lost"] == 1
    e.command("new D30")
    e.command("P 0 INT")
    assert e.state["log"][-1]["turnover_kind"] == "int"

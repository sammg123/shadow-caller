"""Full replay of TB at DAL (Oct 8 2026) through the ESPN feed and the live engine, checked against ESPN's own
drive summaries. Runs in a sandbox: data/live_state.json and data/shadow.duckdb are never touched."""
import copy

import pytest
from helpers import nfl_id, scrimmage

from espn_feed import iter_plays


@pytest.fixture(scope="module")
def replay(make_feed, summary):
    e, feed = make_feed()
    ends = []
    real_end = e.end_drive

    def spy(how):
        ends.append((e.state["drive_n"], how))
        return real_end(how)
    e.end_drive = spy
    logged = feed.apply(summary)
    return e, feed, logged, ends


def dal_drives(summary):
    """ESPN's DAL drives that had at least one offensive snap."""
    return [d for d in summary["drives"]["previous"]
            if d["team"]["abbreviation"] == "DAL" and d.get("offensivePlays", 0) > 0]


def test_final_score(replay):
    e = replay[0]
    assert (e.state["sit"]["score_off"], e.state["sit"]["score_opp"]) == (16, 24)


def test_one_engine_drive_per_espn_drive(replay, summary):
    e = replay[0]
    assert e.state["drive_n"] == len(dal_drives(summary)) == 9
    assert [r["drive"] for r in e.state["log"]] == sorted(r["drive"] for r in e.state["log"])


def test_each_drive_starts_where_espn_says_and_has_the_same_snaps(replay, summary):
    e = replay[0]
    for n, d in enumerate(dal_drives(summary), start=1):
        rows = [r for r in e.state["log"] if r["drive"] == n]
        assert rows[0]["yardline_100"] == d["plays"][0]["end"]["yardsToEndzone"] or \
            rows[0]["yardline_100"] == d["plays"][0]["start"]["yardsToEndzone"], d["description"]
        fg_try = d["result"] == "FG"           # ESPN counts the field-goal attempt as a play
        assert sum(not r["nullified"] for r in rows) == d["offensivePlays"] - fg_try, d["description"]


def test_each_drive_ends_the_way_espn_says(replay, summary):
    e, feed, logged, ends = replay
    how = dict(ends)
    for n, d in enumerate(dal_drives(summary), start=1):
        last = [r for r in e.state["log"] if r["drive"] == n and not r["nullified"]][-1]
        result = d["result"]
        if result == "TD":
            assert last["td"], d["description"]
        elif result in ("INT", "FUMBLE"):
            assert last["turnover"], d["description"]
        elif result == "DOWNS":
            assert last["down"] == 4 and last["yards"] < last["togo"]
        elif result == "PUNT":
            assert how.get(n) == "punt"
        elif result == "FG":
            assert how.get(n) == "fg"
    assert [d["result"] for d in dal_drives(summary)] == \
        ["TD", "PUNT", "PUNT", "PUNT", "FG", "INT", "DOWNS", "TD", "INT"]
    assert e.state["drive_active"] is False


def test_every_dallas_snap_is_logged_with_espns_situation(replay, summary, nflverse):
    e, feed, logged, ends = replay
    dal = [p for t, p in iter_plays(summary)
           if nfl_id(p) in nflverse and scrimmage(nflverse[nfl_id(p)]) and nflverse[nfl_id(p)]["posteam"] == "DAL"]
    assert len(e.state["log"]) == len(dal) == 59
    for r, p in zip(e.state["log"], dal):
        st = p["start"]
        assert (r["down"], r["togo"], r["yardline_100"]) == (st["down"], st["distance"], st["yardsToEndzone"]), p["text"]
        assert r["qtr"] == p["period"]["number"]
    assert logged == sum(not r["nullified"] for r in e.state["log"]) == 55


def test_no_tampa_bay_snap_is_logged(replay):
    e = replay[0]
    assert not any("Daniels" in (r.get("feed_text") or "") for r in e.state["log"])


def test_his_memory_sees_the_two_point_touchdown_pass(replay):
    e = replay[0]
    td = [r for r in e.state["log"] if r["td"]]
    assert [(r["family"], r["leaf"]) for r in td] == [("run", "run_inside"), ("dropback", "dropback_mid")]


def test_interceptions_never_score_for_the_offense(replay):
    e = replay[0]
    picks = [r for r in e.state["log"] if r["turnover"]]
    assert len(picks) == 2 and all(r["yards"] == 0 and not r["td"] for r in picks)


def test_no_play_flags_are_scored_but_not_remembered(replay):
    e = replay[0]
    nulls = [r for r in e.state["log"] if r["nullified"]]
    assert [r["name"] for r in nulls] == [
        "Off-tackle left (no play: defensive offside on TB)",
        "Short (0–9 air yds), incomplete (no play: defensive pass interference on TB)",
        "Off-tackle right (no play: illegal use of hands on TB)",
        "Deep shot (20+), incomplete (no play: offensive holding on DAL)",
    ]
    assert all(r["success"] is None and r["fam_p"] is not None for r in nulls)


def test_no_play_message_names_the_flag_and_the_new_spot(make_feed, summary):
    e, feed = make_feed()
    partial = copy.deepcopy(summary)
    first = partial["drives"]["previous"][0]
    first["plays"] = first["plays"][:8]          # kickoff, 6 snaps, then the offside that wiped out a run
    partial["drives"]["previous"] = [first]
    feed.apply(partial)
    assert e.state["message"] == "No play: defensive offside on TB. 1st & Goal at TB 4. His call still counts for scoring."


def test_replaying_twice_logs_nothing_new(replay, summary):
    e, feed = replay[0], replay[1]
    n = len(e.state["log"])
    assert feed.apply(summary) == 0
    assert len(e.state["log"]) == n


# ---------------------------------------------------------------- possession edge cases (synthetic)
def _game(plays):
    """Minimal ESPN summary: one drive group per (team, plays)."""
    return {"drives": {"previous": [{"team": {"abbreviation": t, "id": {"DAL": "6", "TB": "27"}[t]}, "plays": ps}
                                    for t, ps in plays]}}


def _p(seq, typ, text, q, clock, start, end, home=0, away=0, yards=0):
    return {"id": f"9{seq}", "sequenceNumber": str(seq), "type": {"text": typ}, "text": text, "statYardage": yards,
            "period": {"number": q}, "clock": {"displayValue": clock}, "homeScore": home, "awayScore": away,
            "start": start, "end": end}


def _st(down, togo, ytg, team):
    return {"down": down, "distance": togo, "yardsToEndzone": ytg, "team": {"id": team}}


def test_end_of_half_closes_the_drive_and_second_half_kickoff_starts_a_new_one(make_feed):
    e, feed = make_feed()
    s = _game([("DAL", [
        _p(1, "Kickoff", "X kicks 65 yards from TB 35 to DAL 0. Touchback.", 2, "1:00", _st(0, 0, 65, "27"), _st(1, 10, 75, "6")),
        _p(2, "Rush", "J.Williams up the middle to DAL 30 for 5 yards (X).", 2, "0:40", _st(1, 10, 75, "6"), _st(2, 5, 70, "6"), yards=5),
        _p(3, "Rush", "D.Prescott kneels to DAL 29 for -1 yards.", 2, "0:05", _st(2, 5, 70, "6"), _st(3, 6, 71, "6"), yards=-1),
        _p(4, "End of Half", "END QUARTER 2", 2, "0:00", _st(0, 0, 0, "6"), _st(3, 6, 71, "6")),
        _p(5, "Kickoff", "X kicks 65 yards from TB 35 to DAL 0. Touchback.", 3, "15:00", _st(0, 0, 65, "27"), _st(1, 10, 75, "6")),
        _p(6, "Rush", "J.Williams left tackle to DAL 28 for 3 yards (X).", 3, "14:55", _st(1, 10, 75, "6"), _st(2, 7, 72, "6"), yards=3),
    ])])
    first_half = copy.deepcopy(s)
    first_half["drives"]["previous"][0]["plays"] = first_half["drives"]["previous"][0]["plays"][:4]
    feed.apply(first_half)
    assert e.state["drive_active"] is False and e.state["mem"]["prev"] is None
    feed.apply(s)
    assert e.state["drive_n"] == 2
    assert [r["drive"] for r in e.state["log"]] == [1, 2]
    assert e.state["log"][1]["down"] == 1 and e.state["log"][1]["yardline_100"] == 75


def test_kickoff_ends_the_drive_even_when_espn_has_no_spot_yet(make_feed):
    e, feed = make_feed()
    feed.apply(_game([("DAL", [
        _p(1, "Kickoff", "X kicks 65 yards from TB 35 to DAL 0. Touchback.", 1, "15:00", _st(0, 0, 65, "27"), _st(1, 10, 75, "6")),
        _p(2, "Rush", "J.Williams up the middle to DAL 30 for 5 yards (X).", 1, "14:55", _st(1, 10, 75, "6"), _st(2, 5, 70, "6"), yards=5),
        _p(3, "Kickoff", "X kicks onside 10 yards from TB 35 to TB 45.", 1, "14:20", _st(0, 0, 65, "27"), {"team": {"id": "6"}}),
    ])]))
    assert e.state["drive_active"] is False


def test_one_bad_play_does_not_stall_the_feed(make_feed, monkeypatch):
    e, feed = make_feed()
    real = e.record_play
    calls = []

    def flaky(*a, **k):
        calls.append(1)
        if len(calls) == 1:
            raise ValueError("boom")
        return real(*a, **k)
    monkeypatch.setattr(e, "record_play", flaky)
    s = _game([("DAL", [
        _p(1, "Kickoff", "X kicks 65 yards from TB 35 to DAL 0. Touchback.", 1, "15:00", _st(0, 0, 65, "27"), _st(1, 10, 75, "6")),
        _p(2, "Rush", "J.Williams up the middle to DAL 30 for 5 yards (X).", 1, "14:55", _st(1, 10, 75, "6"), _st(2, 5, 70, "6"), yards=5),
        _p(3, "Rush", "J.Williams left tackle to DAL 33 for 3 yards (X).", 1, "14:20", _st(2, 5, 70, "6"), _st(3, 2, 67, "6"), yards=3),
    ])])
    assert feed.apply(s) == 1
    assert "92" in feed.seen and "93" in feed.seen
    assert "boom" in feed.status["skipped"] and "up the middle" in feed.status["skipped"]
    assert feed.apply(s) == 0                      # the bad play is not retried forever


def test_seen_ids_survive_a_restart(make_feed, summary):
    from espn_feed import Feed
    import threading
    e, feed = make_feed()
    feed.apply(summary)
    again = Feed(e, threading.RLock())
    assert again.seen == feed.seen and len(again.seen) == 183


def test_turnover_never_scores_for_the_offense(make_feed):
    e, feed = make_feed()
    e.set_situation(down=1, togo=10, yardline_100=27)
    before = copy.deepcopy(e.state["sit"])
    e.record_play(None, 76, turnover=True, leaf="dropback_short")
    assert e.state["sit"]["score_off"] == before["score_off"]
    assert e.state["log"][-1]["td"] is False and e.state["drive_active"] is False

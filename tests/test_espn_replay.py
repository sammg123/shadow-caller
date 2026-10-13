"""Full replay of TB at DAL (Oct 8 2026) through the ESPN feed and the live engine, checked against ESPN's own
drive summaries. Runs in a sandbox: data/live_state.json and data/shadow.duckdb are never touched."""
import copy
import json
import threading
import time

import pytest
from helpers import ESPN_EVENT, TEST_GAME, nfl_id, scrimmage

import espn_feed
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


# ---------------------------------------------------------------- live feed safety (G1-2, G1-6, G1-10, G1-11)
FOREIGN = "401872111"


def wait_for(cond, timeout=10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.01)
    return cond()


def foreign(summary, away="NYG", home="PHI"):
    """The saved game with another matchup's teams in its header: what a stale or pasted event id brings."""
    s = copy.deepcopy(summary)
    for c in s["header"]["competitions"][0]["competitors"]:
        c["team"]["abbreviation"] = home if c["homeAway"] == "home" else away
    return s


def typed(e):
    e.command("new D25 | K 4 | Q2 11:11 | DAL 14 TB 10")
    return copy.deepcopy(e.state)


def test_a_foreign_neutral_site_game_is_named_with_vs(summary):
    """ESPN's neutralSite (London, Mexico City): the reason says vs, the way the picker names that game."""
    s = foreign(summary)
    s["header"]["competitions"][0]["neutralSite"] = True
    with pytest.raises(espn_feed.WrongGame, match=r"^ESPN event 401872111 is NYG vs PHI, not DAL v TB\.$"):
        espn_feed.check_matchup(s, FOREIGN)
    s["header"]["competitions"][0]["neutralSite"] = "true"                 # only ESPN's true is a neutral site
    with pytest.raises(espn_feed.WrongGame, match=r" is NYG at PHI, "):
        espn_feed.check_matchup(s, FOREIGN)


def test_a_foreign_game_is_never_applied_to_the_live_game(make_feed, summary, monkeypatch):
    """G1-2: the live feed checks the teams before it takes a summary. Another matchup stops the feed with the
    reason in its status; the typed game, the applied ids and the summary on screen stay as they were."""
    e, feed = make_feed()
    before, shown = typed(e), feed.summary
    with pytest.raises(espn_feed.WrongGame, match=r"^ESPN event 401872111 is NYG at PHI, not DAL v TB\.$"):
        espn_feed.check_matchup(foreign(summary), FOREIGN)
    espn_feed.check_matchup(summary, ESPN_EVENT)                       # TB at DAL is this game
    monkeypatch.setattr(espn_feed, "fetch_summary", lambda eid: foreign(summary))
    feed.start(FOREIGN)
    assert wait_for(lambda: not feed.on)
    assert feed.status["state"] == "error" and "is NYG at PHI, not DAL v TB" in feed.status["detail"]
    assert e.state["log"] == before["log"] and e.state["sit"] == before["sit"]
    assert feed.applied == [] and feed.summary is shown


def test_a_bad_or_thin_poll_keeps_the_previous_summary(make_feed, summary, monkeypatch):
    """G1-6: a poll that isn't a game summary ({code: 500}, no teams, a list) is a failed poll; once plays are
    applied, a poll with no drives is a thin answer. Either way the summary on screen (colors, logos, venue) stays."""
    e, feed = make_feed()
    answers = iter([summary, {"code": 500}, [], {"header": {}}, {**summary, "drives": "x"},
                    {k: v for k, v in summary.items() if k != "drives"}])
    monkeypatch.setattr(espn_feed, "fetch_summary", lambda eid: next(answers))
    feed.event_id = ESPN_EVENT
    assert feed.poll_once() == 55 and feed.summary is summary
    for _ in range(5):
        with pytest.raises(espn_feed.BadSummary):
            feed.poll_once()
        assert feed.summary is summary and len(feed.applied) == 183
    pregame = {k: v for k, v in summary.items() if k != "drives"}
    e2, fresh = make_feed()
    monkeypatch.setattr(espn_feed, "fetch_summary", lambda eid: pregame)
    fresh.event_id = ESPN_EVENT
    assert fresh.poll_once() == 0 and fresh.summary is pregame      # before kickoff ESPN sends no drives yet


def test_a_poll_applies_first_then_saves_its_file_only_when_plays_arrive(make_feed, summary, monkeypatch, sandbox):
    """G1-10: the raw summary is written after the plays are applied, whole (temp file, then a rename), and only
    when new plays arrived; a disk that refuses it never stops the plays."""
    e, feed = make_feed()
    monkeypatch.setattr(espn_feed, "fetch_summary", lambda eid: summary)
    feed.event_id = ESPN_EVENT
    raw_dir = espn_feed.RAW_DIR
    raw = raw_dir / f"summary_{ESPN_EVENT}.json"
    raw.unlink(missing_ok=True)
    blocked = sandbox / "not-a-folder"
    blocked.write_text("a file where the folder should be")
    monkeypatch.setattr(espn_feed, "RAW_DIR", blocked / "espn")
    try:
        assert feed.poll_once() == 55 and len(feed.applied) == 183          # the plays landed anyway
        assert "Couldn't save" in feed.status["detail"] and feed.status["state"] != "error"
        monkeypatch.setattr(espn_feed, "RAW_DIR", raw_dir)
        replaced = []
        real_replace = espn_feed.os.replace
        monkeypatch.setattr(espn_feed.os, "replace", lambda a, b: replaced.append(b) or real_replace(a, b))
        assert feed.poll_once() == 0 and not raw.exists() and raw not in replaced    # nothing new: nothing written
        e.reset()
        feed.forget()
        assert feed.poll_once() == 55 and json.loads(raw.read_text())["header"]["id"] == ESPN_EVENT
        assert raw in replaced and not list(raw_dir.glob("*.tmp"))          # written whole, then swapped in
    finally:
        raw.unlink(missing_ok=True)
        blocked.unlink()


def test_the_live_loop_backs_off_and_resets_on_success(make_feed, monkeypatch):
    """G1-10: 4 s between polls; after errors in a row 4, 8, 16, then 30 s; back to 4 after a good poll."""
    e, feed = make_feed()
    assert [espn_feed.backoff_s(n) for n in range(7)] == [4, 4, 8, 16, 30, 30, 30]
    results = iter([OSError("down")] * 4 + [0] + [OSError("down")])
    waits = []

    def poll():
        r = next(results)
        if isinstance(r, Exception):
            raise r
        return r

    def wait(timeout=None):
        waits.append(timeout)
        if len(waits) == 6:
            feed.on = False
        return False
    monkeypatch.setattr(feed, "poll_once", poll)
    monkeypatch.setattr(feed._wake, "wait", wait)
    feed.on = True
    feed._loop()
    assert waits == [4, 8, 16, 30, 4, 4]


def test_fetches_refuse_redirects_and_oversized_answers(monkeypatch):
    """G1-10: a 3xx is a failed fetch (never a request to wherever it points), and an answer over 8 MB is refused
    without reading it all."""
    import http.server

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/moved":
                self.send_response(302)
                self.send_header("Location", "http://127.0.0.1:9/elsewhere")
                self.end_headers()
                return
            body = b"{}" if self.path == "/small" else b" " * (espn_feed.MAX_SUMMARY_BYTES + 10)
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        assert espn_feed.fetch_json(base + "/small") == {}
        with pytest.raises(OSError):
            espn_feed.fetch_json(base + "/moved")
        with pytest.raises(espn_feed.BadSummary, match="8 MB"):
            espn_feed.fetch_json(base + "/big")
    finally:
        srv.shutdown()


def test_the_seen_file_remembers_the_event_its_plays_came_from(make_feed, summary):
    """G1-2: applied ids are kept with their ESPN event, so a restart follows the event they came from (and its
    summary) instead of falling back to the one in config.py; forget() starts the count of logged plays over."""
    e, feed = make_feed()
    feed.event_id = FOREIGN
    feed.summary = summary
    for team, p in iter_plays(summary)[:5]:
        feed.apply_one(team, p)
    stored = json.loads(espn_feed.SEEN_PATH.read_text())
    assert stored["_events"][TEST_GAME["game_id"]] == FOREIGN
    again = espn_feed.Feed(e, threading.RLock())
    assert again.event_id == FOREIGN and len(again.applied) == 5
    assert feed.status["plays_logged"] == sum(1 for r in e.state["log"] if not r["nullified"]) > 0
    feed.forget()
    assert feed.status["plays_logged"] == 0
    assert espn_feed.Feed(e, threading.RLock()).event_id == TEST_GAME["espn_event"]   # nothing applied: config's

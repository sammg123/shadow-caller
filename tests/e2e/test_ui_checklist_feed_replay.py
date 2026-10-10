"""FI 6.3 checklist #92 to #109: the ESPN feed (FI 1.7, 2.7, 3.2, 3.6; G9, G19, Appendix A #95) and Replay."""
import re
import time

import pytest
from playwright.sync_api import expect
from ui_helpers import (COL, EVENT, LOG_ROWS, REPLAY_TOAST_MS, answer_dialogs, api_post, expect_log_rows,
                        expect_shows, expect_toast, feed_on, feed_on_server, finished, fixed, fresh,
                        load, log_table, pct, quiet, record_requests, reset_game, state, until, with_drive)
from ui_helpers import show  # v1.4 (W6): world-aware helpers

pytestmark = pytest.mark.e2e

# The replay's toast names the backup it kept (G1-11: never "backed up" when nothing was).
REPLAYED_RE = re.compile(r"^Replayed ESPN game 401872980: 55 DAL plays logged\. Your old game is backed up as "
                         r"live_state\.backup-\d{8}-\d{6}(-\d+)?\.json\.$")

FEED_HINT = ("ESPN logs each play, down, distance, spot, clock and score. It can't see play-action, screens or RPOs: "
             "press A, N or O to fix the last play. P undoes that, J/K/L change the run gap, U undoes.")
OFF_STATUS = "Off: enter plays by hand, or turn it on and plays log themselves."
UPDATED_RE = re.compile(r"Updated\s+(\d{1,2}:\d{2}:\d{2})")
CUR_RE = re.compile(r"(^|\s)cur(\s|$)")
SKIPPED = "J.Doe up the middle to TB 40 for 3 yards (spot not parsed)"


def test_92_feed_button_turns_the_feed_on(upage, server):
    """#92: clicking "ESPN live: off" sends {"on":true,"event_id":"401872980"}; "ESPN live: on" with the live style;
    the toast says plays log themselves."""
    fresh(upage, server["base"])
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: off")
    expect(upage.locator("#feedEvent")).to_have_value(EVENT)
    sent = record_requests(upage, "/api/feed")
    upage.locator("#feedBtn").click()
    expect_toast(upage, "ESPN live feed on. Plays log themselves; retag play-action, screen or RPO.")
    assert [r["body"] for r in sent] == [{"on": True, "event_id": EVENT}]
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: on")
    expect(upage.locator("#feedBtn")).to_have_class(re.compile(r"(^|\s)on(\s|$)"))
    expect(upage.locator("#feedBtn")).to_have_attribute("data-feed-state", "live")


def test_93_feed_on_hides_the_pad_keeps_shorthand(upage, server):
    """#93: with the feed on, the pad and flag panel are hidden, shorthand works, the hint is the feed text, the
    entry panel is not dimmed."""
    feed_on(upage, server["base"])
    expect(upage.locator("#manualEntry")).to_be_hidden()
    expect(upage.locator("#flagPanel")).to_be_hidden()
    expect(upage.locator("#entryHint")).to_have_text(FEED_HINT)
    expect(upage.locator("#entry")).not_to_have_attribute("data-dim", "true")
    upage.locator("#cmd").fill("Q4 2:00")
    upage.locator("#cmd").press("Enter")
    expect(upage.locator("#iClock")).to_have_value("2:00")


def test_94_feed_logs_the_whole_game_within_10_s(upage, server):
    """#94: with the feed on (sandbox) all 59 rows appear within 10 s; the status reads "Updated HH:MM:SS · Last: END
    GAME"."""
    fresh(upage, server["base"])
    upage.locator("#feedBtn").click()
    started = time.monotonic()
    expect_log_rows(upage, LOG_ROWS, timeout=10_000)
    assert time.monotonic() - started <= 10.5
    expect(upage.locator("#feedStatus")).to_have_text(
        re.compile(r"^\s*Updated\s+\d{1,2}:\d{2}:\d{2}\s*·\s*Last:\s*END GAME\s*$"))


def test_95_updated_time_moves_without_state_refetch(upage, server):
    """#95 (Appendix A rewrite): with the feed on, "Updated" advances with each server poll without a /api/state
    refetch (only a version, feed.on or feed.state change refetches it)."""
    feed_on(upage, server["base"])
    expect_log_rows(upage, LOG_ROWS)
    status = upage.locator("#feedStatus")
    expect(status).to_have_text(UPDATED_RE)

    def updated():
        m = UPDATED_RE.search(status.text_content() or "")
        return m.group(1) if m else None

    first = updated()
    states = record_requests(upage, "/api/state", "GET")
    until(upage, lambda: updated() not in (None, first), timeout_ms=10_000, what="the Updated time to move")
    assert states == []


def test_96_last_play_panel_after_the_whole_game(upage, server):
    """#96: "Last play from ESPN", "Short (0–9 air yds), turnover", "0 yds", the ESPN text, and A Play-action,
    N Screen, O RPO thrown, P Plain dropback with P current."""
    base = server["base"]
    feed_on(upage, base)
    last = state(base)["log"][0]
    panel = upage.locator("#lastPlay")
    expect(panel).to_be_visible()
    for text in ("Last play from ESPN", "Short (0–9 air yds), turnover", "0 yds", last["feed_text"]):
        expect(panel).to_contain_text(text)
    buttons = panel.locator("[data-retag]")
    expect(buttons).to_have_count(4)
    assert buttons.evaluate_all("els => els.map(e => e.dataset.retag)") == ["A", "N", "O", "P"]
    for i, label in enumerate(("Play-action", "Screen", "RPO, thrown", "Plain dropback")):
        expect(buttons.nth(i)).to_contain_text(label)
    expect(panel.locator('[data-retag="P"]')).to_have_class(CUR_RE)
    expect(panel.locator('[data-retag="P"]')).to_have_attribute("aria-current", "true")
    expect(panel.locator(".cur[data-retag]")).to_have_count(1)


def test_97_retag_a_then_p_restores(upage, server):
    """#97: A sends {"key":"A"}, toasts "Last play retagged: PA short (0–9).", shows " · retagged", marks A current;
    then the P button restores "Short (0–9 air yds)"."""
    feed_on(upage, server["base"])
    panel = upage.locator("#lastPlay")
    expect(panel).to_contain_text("Short (0–9 air yds), turnover")
    sent = record_requests(upage, "/api/retag")
    upage.keyboard.press("a")
    expect_toast(upage, "Last play retagged: PA short (0–9).")
    assert [r["body"] for r in sent] == [{"key": "A"}]
    expect(panel).to_contain_text("PA short (0–9), turnover")
    expect(panel).to_contain_text(re.compile(r"0 yds\s*·\s*retagged"))
    expect(panel.locator('[data-retag="A"]')).to_have_class(CUR_RE)
    panel.locator('[data-retag="P"]').click()
    expect_toast(upage, "Last play retagged: Short (0–9 air yds).")
    expect(panel).to_contain_text("Short (0–9 air yds), turnover")
    expect(panel.locator('[data-retag="P"]')).to_have_class(CUR_RE)


def test_98_retag_j_on_a_pass_is_refused(upage, server):
    """#98: with the feed on, J on that pass gives the red toast "J doesn't fit a pass."."""
    feed_on(upage, server["base"])
    expect(upage.locator("#lastPlay")).to_be_visible()
    upage.keyboard.press("j")
    expect_toast(upage, "J doesn't fit a pass.", error=True)


def test_99_feed_mode_ignores_entry_keys_and_u_sends_undo(upage, server):
    """#99 (v1.2): X, Esc, Enter, T, F, I, S, C send nothing; U sends /api/undo, and a fed play answers 409 with its
    error as a red toast."""
    feed_on(upage, server["base"])
    expect(upage.locator("#lastPlay")).to_be_visible()
    sent = record_requests(upage, "/api/", "POST")
    for key in ("x", "Escape", "Enter", "t", "f", "i", "s", "c"):
        upage.keyboard.press(key)
    quiet(upage)
    assert sent == []
    upage.keyboard.press("u")
    until(upage, lambda: len(sent) == 1, what="U to send /api/undo")
    assert sent[0]["path"] == "/api/undo"
    expect_toast(upage, re.compile(r"^Undo can't take back a play ESPN logged"), error=True)


def test_100_feed_on_before_any_espn_row_waits(upage, server):
    """#100: feed on with no ESPN row yet: "Waiting for the first DAL play" and "Plays appear here a few seconds after
    ESPN posts them."."""
    base = server["base"]
    reset_game(base)
    api_post(base, "/api/feed", {"on": True, "event_id": "999"})     # offline: no saved game, so no row ever lands
    load(upage, base)
    panel = upage.locator("#lastPlay")
    expect(panel).to_be_visible()
    expect_shows(panel, "Waiting for the first DAL play")
    expect_shows(panel, "Plays appear here a few seconds after ESPN posts them.")
    expect(panel.locator("[data-retag]")).to_have_count(0)


def test_101_unknown_event_retries_with_the_error_style(upage, server):
    """#101: event id 999 with the feed on shows "ESPN live: retrying" with the error style and "Can't reach ESPN
    (...). Still trying every few seconds."."""
    fresh(upage, server["base"])
    show(upage, "#feedEvent").fill("999")
    upage.locator("#feedBtn").click()
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: retrying", timeout=10_000)
    expect(upage.locator("#feedBtn")).to_have_class(re.compile(r"(^|\s)err(\s|$)"))
    expect(upage.locator("#feedBtn")).to_have_attribute("data-feed-state", "retrying")
    expect(upage.locator("#feedStatus")).to_have_text(
        re.compile(r"^\s*Can't reach ESPN \(.+\)\. Still trying every few seconds\.\s*$"))


def test_102_skipped_plays_are_named_in_the_status_line(upage, server):
    """#102: when feed.skipped is set and the feed is on, the status line has "Skipped, enter it by hand:" and the
    text (an intercepted /api/state, as FI verified it)."""
    base = server["base"]

    def inject(route):
        response = route.fetch()
        body = response.json()
        body["feed"]["skipped"] = SKIPPED
        route.fulfill(response=response, json=body)

    feed_on_server(base)
    upage.route("**/api/state", inject)
    load(upage, base)
    status = upage.locator("#feedStatus")
    expect(status).to_contain_text("Skipped, enter it by hand:")
    expect(status).to_contain_text(re.compile(r"Skipped, enter it by hand:\s*" + re.escape(SKIPPED)))


def test_103_feed_off_brings_the_pad_back(upage, server):
    """#103: turning the feed off shows "ESPN live: off" and the off text, brings back the pad, hides the last play."""
    feed_on(upage, server["base"])
    expect(upage.locator("#lastPlay")).to_be_visible()
    sent = record_requests(upage, "/api/feed")
    upage.locator("#feedBtn").click()
    expect_toast(upage, "ESPN live feed off. Enter plays by hand.")
    assert len(sent) == 1 and sent[0]["body"]["on"] is False
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: off")
    expect(upage.locator("#feedStatus")).to_have_text(OFF_STATUS)
    expect(upage.locator("#manualEntry")).to_be_visible()
    expect(upage.locator("#lastPlay")).to_be_hidden()


def test_104_event_box_is_not_overwritten_while_focused(upage, server):
    """#104: the ESPN id box is not overwritten while focused, and Enter in it only blurs it."""
    base = server["base"]
    fresh(upage, base)
    box = show(upage, "#feedEvent")
    box.click()
    box.press("ControlOrMeta+a")
    box.press_sequentially("12345")
    api_post(base, "/api/situation", {"qtr": "2"})
    expect(upage.locator("#iQtr")).to_have_value("2")
    expect(box).to_have_value("12345")
    sent = record_requests(upage, "/api/", "POST")
    box.press("Enter")
    expect(box).not_to_be_focused()
    quiet(upage)
    assert sent == []


def test_105_reset_with_the_feed_on_stops_the_feed_first(upage, server):
    """#105 [fix] (G9): Reset with the feed on says the feed turns off, turns it off first, and the game is not
    re-logged behind the user's back."""
    base = server["base"]
    feed_on(upage, base)
    expect_log_rows(upage, LOG_ROWS)
    asked = answer_dialogs(upage, accept=True)
    sent = record_requests(upage, "/api/", "POST")
    upage.locator("#resetBtn").click()
    expect_toast(upage, "Set the start of Dallas's first drive.", error=False)
    assert asked == ["Clear every snap logged for this game? The ESPN feed turns off first, so it doesn't log the game "
                     "again. A copy is kept in data/."]
    assert [r["path"] for r in sent] == ["/api/feed", "/api/reset"] and sent[0]["body"]["on"] is False
    upage.wait_for_timeout(6000)                    # longer than one feed poll (4 s)
    s = state(base)
    assert (s["log"], s["feed"]["on"]) == ([], False)
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: off")
    show(upage, "#logArea")
    expect_shows(upage.locator("#logArea"), "No snaps yet.")


def test_106_replay_confirms_then_toasts(upage, server):
    """#106: Replay asks "Rebuild the game log from ESPN game 401872980? ..." and toasts "Replayed ESPN game
    401872980: 55 DAL plays logged." and where the old game went (G1-11 names the backup file)."""
    fresh(upage, server["base"])
    asked = answer_dialogs(upage, accept=True)
    show(upage, "#replayBtn").click()
    expect_toast(upage, REPLAYED_RE, timeout=REPLAY_TOAST_MS)
    assert asked == ["Rebuild the game log from ESPN game 401872980? The current log is backed up first."]


def test_107_after_a_replay_the_page_matches_the_state(upage, server):
    """#107: 59 log rows, 16 to 24, Q4 0:00, the board at FINAL (v1.5, G4-1: the game is over, so the strip and the
    board never ask for the next spot), every scorecard value from /api/state.metrics."""
    base = server["base"]
    finished(upage, base)
    m = state(base)["metrics"]
    g = m["granular"]
    expect_log_rows(upage, LOG_ROWS)
    for sel, value in (("#iOff", "16"), ("#iOpp", "24"), ("#iQtr", "4"), ("#iClock", "0:00")):
        expect(upage.locator(sel)).to_have_value(value)
    expect(upage.locator("#heroArea")).to_have_attribute("data-kind", "final")
    expect(upage.locator("#driveInfo")).to_have_text("Final. Replay or watch another game from the booth (B).")
    expected = [f"Specific play ({g['leaf_n']} snaps)", f"{g['leaf_top1']} of {g['leaf_n']}",
                f"{g['leaf_top3']} of {g['leaf_n']}", f"Actual play in his top 3 (league {g['leaf_top3_league']})",
                fixed(g["leaf_logloss"], 2), fixed(g["leaf_logloss_league"], 2),
                f"Play type ({g['fam_n']} snaps)", f"{g['fam_top_hits']} of {g['fam_n']}", fixed(g["fam_logloss"], 2),
                f"Log loss (league {fixed(g['fam_logloss_league'], 2)})",
                f"Pass vs run ({m['n']} snaps)", fixed(m["logloss_model"], 3),
                f"His model, log loss (league {fixed(m['logloss_league'], 3)})", pct(m["acc_model"]),
                f"Run or pass called right (league {pct(m['acc_league'])})",
                f"{m['tilt_hits']} of {m['tilt_n']}" if m["tilt_n"] else "0", "Tilts that came true",
                pct(m["dropback_rate"]), "Pass rate tonight"]
    for text in expected:
        expect(upage.locator("#kpiArea")).to_contain_text(text)


def test_108_four_no_play_rows_after_a_replay(upage, server):
    """#108: after a replay exactly 4 rows show Yds "flag" with names containing "(no play:"."""
    finished(upage, server["base"])
    expect_log_rows(upage, LOG_ROWS)
    flagged = [r for r in log_table(upage) if r[COL["Yds"]] == "flag"]
    assert len(flagged) == 4
    assert all("(no play:" in r[COL["Actual"]] for r in flagged), flagged


def test_109_replay_of_an_unknown_game_changes_nothing(upage, server):
    """#109: Replay with event id 999 shows a red toast and leaves the game unchanged."""
    base = server["base"]
    with_drive(upage, base)
    before = state(base)
    show(upage, "#feedEvent").fill("999")
    asked = answer_dialogs(upage, accept=True)
    show(upage, "#replayBtn").click()
    until(upage, lambda: len(asked) == 1, what="the replay confirm")
    assert asked == ["Rebuild the game log from ESPN game 999? The current log is backed up first."]
    expect_toast(upage, re.compile(r"\S"), error=True, timeout=REPLAY_TOAST_MS)
    after = state(base)
    assert (after["version"], after["log"], after["drive_active"]) == (before["version"], before["log"], True)

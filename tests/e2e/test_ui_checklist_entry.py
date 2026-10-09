"""FI 6.3 checklist #38 to #62: manual entry by keyboard and mouse (FI 1.3 to 1.5, 2.4; G4, G5, G6)."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (COL, active_id, command, expect_off_field, expect_toast, fresh, log_table, quiet,
                        record_requests, state, until, with_drive)

pytestmark = pytest.mark.e2e

ON_RE = re.compile(r"(^|\s)on(\s|$)")


def chosen(page):
    return page.locator("#chosen")


def keys(page, *names):
    for name in names:
        page.keyboard.press(name)


def expect_chosen(page, name, hint=None):
    """The chosen line: the resolved name, then the tap hint when the cycle has more (FI 1.4)."""
    if hint is None:
        expect(chosen(page)).to_have_text(re.compile(r"^\s*" + re.escape(name) + r"\s*$"))
    else:
        expect(chosen(page)).to_have_text(re.compile(r"^\s*" + re.escape(name) + r"\s*" + re.escape(hint) + r"\s*$"))


def expect_lit(page, key):
    """Only `key` among the play keys looks selected (.on and aria-pressed, 5.1)."""
    lit = page.locator(".key[data-k].on")
    expect(lit).to_have_count(1)
    expect(lit).to_have_attribute("data-k", key)
    expect(page.locator('.key[data-k][aria-pressed="true"]')).to_have_count(1)
    expect(page.locator(f'.key[data-k="{key}"]')).to_have_attribute("aria-pressed", "true")


def test_38_p_cycles_short_mid_deep_and_wraps(upage, server):
    """#38: P, P, P, P: Short, Intermediate, Deep shot, Short again, each with the "tap P for <next>" hint."""
    with_drive(upage, server["base"])
    steps = [("Short (0–9 air yds)", "tap P for Intermediate (10–19)"),
             ("Intermediate (10–19)", "tap P for Deep shot (20+)"),
             ("Deep shot (20+)", "tap P for Short (0–9 air yds)"),
             ("Short (0–9 air yds)", "tap P for Intermediate (10–19)")]
    for name, hint in steps:
        keys(upage, "p")
        expect_chosen(upage, name, hint)
    expect_lit(upage, "P")


def test_39_j_l_alternate_and_k_r_both_pick_inside(upage, server):
    """#39: J and L alternate off-tackle and edge; K and R both pick "Inside run (A/B gap)" and light K."""
    with_drive(upage, server["base"])
    for key, first, second in (("j", "Off-tackle left", "Outside left (edge)"),
                               ("l", "Off-tackle right", "Outside right (edge)")):
        keys(upage, key)
        expect(chosen(upage)).to_contain_text(first)
        keys(upage, key)
        expect(chosen(upage)).to_contain_text(second)
        keys(upage, key)
        expect(chosen(upage)).to_contain_text(first)
    for key in ("k", "r"):
        keys(upage, "Escape", key)
        expect_chosen(upage, "Inside run (A/B gap)")
        expect_lit(upage, "K")


def test_40_a_n_o_cycles(upage, server):
    """#40: A cycles PA short, PA intermediate, PA deep shot; N picks Screen; O alternates the two RPOs."""
    with_drive(upage, server["base"])
    for name in ("PA short (0–9)", "PA intermediate (10–19)", "PA deep shot (20+)", "PA short (0–9)"):
        keys(upage, "a")
        expect(chosen(upage)).to_contain_text(name)
    keys(upage, "n")
    expect_chosen(upage, "Screen")
    for name in ("RPO, handed off or kept", "RPO, thrown", "RPO, handed off or kept"):
        keys(upage, "o")
        expect(chosen(upage)).to_contain_text(name)
    expect_lit(upage, "O")


def test_41_only_the_last_play_key_looks_selected(upage, server):
    """#41: only the last pressed play key looks selected."""
    with_drive(upage, server["base"])
    for key in ("j", "p", "a", "n"):
        keys(upage, key)
        expect_lit(upage, key.upper())


def test_42_incomplete_names_and_yards_zero(upage, server):
    """#42: P then I "Short (0–9 air yds), incomplete" and Yards 0; J then I "Dropback pass, incomplete"; O then I
    "RPO, thrown, incomplete"."""
    with_drive(upage, server["base"])
    keys(upage, "p")
    upage.keyboard.type("7")
    expect(upage.locator("#yards")).to_have_value("7")
    keys(upage, "i")
    expect_chosen(upage, "Short (0–9 air yds), incomplete")
    expect(upage.locator("#yards")).to_have_value("0")
    for key, name in (("j", "Dropback pass, incomplete"), ("o", "RPO, thrown, incomplete")):
        keys(upage, "Escape", key, "i")
        expect_chosen(upage, name)
    expect(upage.locator('.key[data-out="incomplete"]')).to_have_class(ON_RE)
    expect(upage.locator('.key[data-out="incomplete"]')).to_have_attribute("aria-pressed", "true")


def test_43_sack_and_scramble_names(upage, server):
    """#43: A,S "Play-action, sack"; P,S "Dropback pass, sack"; O,O,S "RPO, sack"; K,C "Dropback pass, scramble"."""
    with_drive(upage, server["base"])
    for seq, name in ((("a", "s"), "Play-action, sack"), (("p", "s"), "Dropback pass, sack"),
                      (("o", "o", "s"), "RPO, sack"), (("k", "c"), "Dropback pass, scramble")):
        keys(upage, "Escape", *seq)
        expect_chosen(upage, name)


def test_44_outcome_twice_turns_it_off_and_a_play_key_clears_it(upage, server):
    """#44: I, S or C twice turns the outcome off; a play key after an outcome clears it (S then P shows Short)."""
    with_drive(upage, server["base"])
    for out_key in ("i", "s", "c"):
        keys(upage, "Escape", "p", out_key, out_key)
        expect_chosen(upage, "Short (0–9 air yds)", "tap P for Intermediate (10–19)")
        expect(upage.locator(".key[data-out].on")).to_have_count(0)
    keys(upage, "Escape", "s", "p")
    expect_chosen(upage, "Short (0–9 air yds)", "tap P for Intermediate (10–19)")
    expect(upage.locator(".key[data-out].on")).to_have_count(0)
    expect(upage.locator('.key[data-out][aria-pressed="true"]')).to_have_count(0)


def test_45_i_alone_enables_log_play(upage, server):
    """#45: I alone shows "Dropback pass, incomplete" and enables Log play during a drive."""
    with_drive(upage, server["base"])
    expect(upage.locator("#logBtn")).to_be_disabled()
    keys(upage, "i")
    expect_chosen(upage, "Dropback pass, incomplete")
    expect(upage.locator("#logBtn")).to_be_enabled()


def test_46_t_and_f_toggle_touchdown_and_turnover(upage, server):
    """#46: T and F toggle the Touchdown and Turnover boxes."""
    with_drive(upage, server["base"])
    td, to = upage.locator("#fTD"), upage.locator("#fTO")
    keys(upage, "t")
    expect(td).to_be_checked()
    keys(upage, "f")
    expect(to).to_be_checked()
    keys(upage, "t", "f")
    expect(td).not_to_be_checked()
    expect(to).not_to_be_checked()


def test_47_escape_clears_pick_yards_and_boxes(upage, server):
    """#47: Esc clears the pick ("Pick the play"), sets Yards to 0, unticks both boxes; focus stays."""
    with_drive(upage, server["base"])
    keys(upage, "p")
    upage.keyboard.type("7")
    keys(upage, "t", "f")
    expect(upage.locator("#fTD")).to_be_checked()
    keys(upage, "Escape")
    expect(chosen(upage)).to_have_text("Pick the play")
    expect(upage.locator("#yards")).to_have_value("0")
    expect(upage.locator("#fTD")).not_to_be_checked()
    expect(upage.locator("#fTO")).not_to_be_checked()
    expect(upage.locator("#yards")).to_be_focused()


def test_48_yards_takes_digits_and_minus_only(upage, server):
    """#48: in Yards, digits and - type, other characters do not ("1q.5 -" gives "15-")."""
    with_drive(upage, server["base"])
    yards = upage.locator("#yards")
    yards.click()
    yards.press("ControlOrMeta+a")
    yards.press("Backspace")
    yards.press_sequentially("1q.5 -")
    expect(yards).to_have_value("15-")


@pytest.mark.parametrize("sel", ["#iQtr", "#iClock", "#iOff", "#iOpp", "#iDown", "#iTogo", "#iYard", "#feedEvent", "#cmd"])
def test_49_letters_in_inputs_never_fire_shortcuts(upage, server, sel):
    """#49: typing J in a strip field, the ESPN id box or the shorthand bar types the letter; the pick is unchanged."""
    with_drive(upage, server["base"])
    keys(upage, "p")
    expect(chosen(upage)).to_contain_text("Short (0–9 air yds)")
    box = upage.locator(sel)
    box.click()
    box.press("ControlOrMeta+a")
    box.press_sequentially("j")
    expect(box).to_have_value("j")
    expect(chosen(upage)).to_contain_text("Short (0–9 air yds)")
    expect_lit(upage, "P")


def test_50_alt_or_ctrl_p_does_not_pick(upage, server):
    """#50: with Alt or Ctrl held, P does not select a play (browser shortcuts keep working)."""
    with_drive(upage, server["base"])
    keys(upage, "Alt+p", "Control+p")
    quiet(upage, 300)
    expect(chosen(upage)).to_have_text("Pick the play")
    expect(upage.locator(".key[data-k].on")).to_have_count(0)
    keys(upage, "p")                                           # control: the plain key does pick
    expect(chosen(upage)).to_contain_text("Short (0–9 air yds)")


def test_51_k_3_enter_logs_the_exact_payload(upage, server):
    """#51: K, Yards 3, Enter sends {"yards":3,"td":false,"turnover":false,"leaf":"run_inside"}, toasts the message,
    clears the pick, and leaves Yards focused showing 0."""
    base = server["base"]
    with_drive(upage, base)
    sent = record_requests(upage, "/api/play")
    keys(upage, "k")
    upage.keyboard.type("3")
    keys(upage, "Enter")
    expect_toast(upage, "Logged.")
    assert [r["body"] for r in sent] == [{"yards": 3, "td": False, "turnover": False, "leaf": "run_inside"}]
    assert state(base)["message"] == "Logged."
    expect(chosen(upage)).to_have_text("Pick the play")
    expect(upage.locator("#yards")).to_have_value("0")
    expect(upage.locator("#yards")).to_be_focused()


def test_52_sack_logs_negative_yards_and_the_distance_grows(upage, server):
    """#52: P, S, Yards 7, Enter logs Yds -7 and the next down's distance grows by 7 (2nd & 17)."""
    with_drive(upage, server["base"])
    keys(upage, "p", "s")
    upage.keyboard.type("7")
    keys(upage, "Enter")
    expect(upage.locator("#iDown")).to_have_value("2")
    expect(upage.locator("#iTogo")).to_have_value("17")
    until(upage, lambda: len(log_table(upage)) == 1, what="one log row")
    assert log_table(upage)[0][COL["Yds"]] == "-7"
    assert log_table(upage)[0][COL["Actual"]] == "Dropback pass, sack"


def test_53_incomplete_logs_zero_yards(upage, server):
    """#53: A, I with Yards 15, Enter logs 0 yards."""
    base = server["base"]
    with_drive(upage, base)
    keys(upage, "a", "i")
    upage.keyboard.type("15")
    expect(upage.locator("#yards")).to_have_value("15")
    keys(upage, "Enter")
    until(upage, lambda: len(log_table(upage)) == 1, what="one log row")
    assert state(base)["log"][0]["yards"] == 0
    assert log_table(upage)[0][COL["Yds"]] == "0"
    assert log_table(upage)[0][COL["Actual"]] == "PA short (0–9), incomplete"


def test_54_a_gain_past_the_line_is_a_first_down(upage, server):
    """#54: a gain of at least the distance toasts "First down." and shows 1st & 10."""
    with_drive(upage, server["base"])
    keys(upage, "k")
    upage.keyboard.type("12")
    keys(upage, "Enter")
    expect_toast(upage, "First down.")
    expect(upage.locator("#iDown")).to_have_value("1")
    expect(upage.locator("#iTogo")).to_have_value("10")


def test_55_yards_into_the_end_zone_are_a_touchdown(upage, server):
    """#55: after `new T8` then `L 3` (2nd & G at TB 5), K with Yards 12 is a touchdown: +7, drive over, toast starts
    "Touchdown, +7", log row "Inside run (A/B gap), TD" with Yds 5."""
    base = server["base"]
    fresh(upage, base)
    command(base, "new T8")
    command(base, "L 3")
    expect(upage.locator("#iTogo")).to_have_value("G")
    expect(upage.locator("#iYard")).to_have_value("5")
    keys(upage, "k")
    upage.keyboard.type("12")
    keys(upage, "Enter")
    expect_toast(upage, re.compile(r"^Touchdown, \+7"))
    expect(upage.locator("#iOff")).to_have_value("7")
    expect_off_field(upage)
    until(upage, lambda: len(log_table(upage)) == 2, what="two log rows")
    newest = log_table(upage)[0]
    assert (newest[COL["Actual"]], newest[COL["Yds"]]) == ("Inside run (A/B gap), TD", "5")


def test_56_turnover_box_logs_a_turnover(upage, server):
    """#56: L, L, Yards 5, F, Enter toasts "Turnover. Waiting for the next Dallas drive."; the row ends ", turnover"."""
    with_drive(upage, server["base"])
    keys(upage, "l", "l")
    upage.keyboard.type("5")
    keys(upage, "f")
    expect(upage.locator("#fTO")).to_be_checked()
    keys(upage, "Enter")
    expect_toast(upage, "Turnover. Waiting for the next Dallas drive.")
    until(upage, lambda: len(log_table(upage)) == 1, what="one log row")
    assert log_table(upage)[0][COL["Actual"]].endswith(", turnover")


def test_57_fourth_down_short_is_a_turnover_on_downs(upage, server):
    """#57: a 4th-down play short of the line toasts "Turnover on downs. ..." and ends the drive."""
    base = server["base"]
    fresh(upage, base)
    command(base, "new D25")
    command(base, "4&5 D30")
    expect(upage.locator("#iDown")).to_have_value("4")
    keys(upage, "k")
    upage.keyboard.type("2")
    keys(upage, "Enter")
    expect_toast(upage, "Turnover on downs. Waiting for the next Dallas drive.")
    expect_off_field(upage)
    assert state(base)["drive_active"] is False


def test_58_enter_with_nothing_picked_or_no_drive_sends_nothing(upage, server):
    """#58: Enter with nothing picked, or with no drive active, sends no request."""
    base = server["base"]
    with_drive(upage, base)
    sent = record_requests(upage, "/api/play")
    keys(upage, "Enter")
    quiet(upage)
    assert sent == []
    keys(upage, "k", "Enter")                                  # control: the same Enter logs once a play is picked
    until(upage, lambda: len(sent) == 1, what="the control play")
    fresh(upage, base)
    sent = record_requests(upage, "/api/play")
    keys(upage, "k")
    expect(chosen(upage)).to_contain_text("Inside run (A/B gap)")   # the keys work; only the drive is missing
    keys(upage, "Enter")
    quiet(upage)
    assert sent == []
    assert state(base)["log"] == []


def test_59_log_play_disabled_until_drive_and_pick(upage, server):
    """#59: Log play stays disabled until a drive is active and a play or outcome is picked."""
    base = server["base"]
    fresh(upage, base)
    log_btn = upage.locator("#logBtn")
    keys(upage, "k")
    expect(chosen(upage)).to_contain_text("Inside run (A/B gap)")
    expect(log_btn).to_be_disabled()
    keys(upage, "Escape")
    command(base, "new D25")
    expect(upage.locator("#driveInfo")).to_have_text(re.compile(r"^Drive \d+, snap 1 of the game$"))
    expect(log_btn).to_be_disabled()
    keys(upage, "k")
    expect(log_btn).to_be_enabled()
    keys(upage, "Escape")
    expect(log_btn).to_be_disabled()
    keys(upage, "c")
    expect(log_btn).to_be_enabled()


def test_60_clicking_play_keys_cycles_and_focuses_yards(upage, server):
    """#60: clicking the play key buttons behaves like the keys (repeat clicks cycle) and focuses Yards."""
    with_drive(upage, server["base"])
    upage.locator('.key[data-k="P"]').click()
    expect(upage.locator("#yards")).to_be_focused()
    upage.locator('.key[data-k="P"]').click()
    expect(chosen(upage)).to_contain_text("Intermediate (10–19)")
    expect_lit(upage, "P")
    upage.locator('.key[data-out="incomplete"]').click()
    expect_chosen(upage, "Intermediate (10–19), incomplete")
    expect(upage.locator('.key[data-out="incomplete"]')).to_have_attribute("aria-pressed", "true")
    expect(upage.locator("#yards")).to_be_focused()


def test_61_shortcuts_work_after_clicking_a_checkbox(upage, server):
    """#61 [fix] (G4): after clicking the Touchdown checkbox, pressing J still selects a play."""
    with_drive(upage, server["base"])
    upage.locator("#fTD").click()
    expect(upage.locator("#fTD")).to_be_checked()
    assert active_id(upage) == "fTD"
    keys(upage, "j")
    expect(chosen(upage)).to_contain_text("Off-tackle left")


def test_62_a_response_never_wipes_a_newer_pick(upage, server):
    """#62 [fix] (G6): picking P right after Enter on a K pick keeps the P pick once the K response lands."""
    base = server["base"]
    with_drive(upage, base)
    held = []
    upage.route("**/api/play", lambda route: held.append(route))
    keys(upage, "k")
    upage.keyboard.type("3")
    keys(upage, "Enter")
    until(upage, lambda: len(held) == 1, what="the K play request")
    keys(upage, "p")
    expect(chosen(upage)).to_contain_text("Short (0–9 air yds)")
    held[0].continue_()
    expect_toast(upage, "Logged.")
    until(upage, lambda: len(state(base)["log"]) == 1, what="the K play to be saved")
    quiet(upage, 500)
    expect(chosen(upage)).to_contain_text("Short (0–9 air yds)")
    expect_lit(upage, "P")


def test_g5_enter_on_a_focused_button_activates_it_and_never_logs(upage, server):
    """ui-architecture 4.6 G5 (new e2e): click Undo, press Enter: Enter activates the button again, never /api/play."""
    base = server["base"]
    with_drive(upage, base)
    command(base, "Q1 14:00")                       # two undo steps: the clock, then the drive
    expect(upage.locator("#iClock")).to_have_value("14:00")
    keys(upage, "k")
    expect(upage.locator("#logBtn")).to_be_enabled()
    plays = record_requests(upage, "/api/play")
    undos = record_requests(upage, "/api/undo")
    upage.locator("#undoBtn").click()
    expect(upage.locator("#iClock")).to_have_value("15:00")
    assert active_id(upage) == "undoBtn"
    keys(upage, "Enter")
    until(upage, lambda: len(undos) == 2, what="Enter to click Undo again")
    quiet(upage)
    assert plays == []

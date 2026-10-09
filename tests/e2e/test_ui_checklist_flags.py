"""FI 6.3 checklist #63 to #77: the flag panel (FI 1.6, 2.5; G7, G25)."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (COL, expect_shows, expect_toast, fresh, log_table, quiet, record_requests, state, until,
                        with_drive)

pytestmark = pytest.mark.e2e

ON_RE = re.compile(r"(^|\s)on(\s|$)")
# FI 1.6, verbatim: key, code, shown as, summary. Defense first, then offense, in button order.
DEFENSE = [("O", "OFFSIDE", "Offside / encroachment / neutral zone", "5 yds, pre-snap"),
           ("H", "DH", "Defensive holding", "5 yds, auto 1st"),
           ("C", "IC", "Illegal contact", "5 yds, auto 1st"),
           ("D", "DPI", "Defensive pass interference", "ball at the spot, auto 1st (Yards = past the line)"),
           ("R", "RTP", "Roughing the passer", "15 yds, auto 1st"),
           ("U", "URD", "Unnecessary roughness", "15 yds, auto 1st"),
           ("M", "FM", "Face mask", "15 yds, auto 1st"),
           ("Z", "12D", "Too many men", "5 yds, pre-snap")]
OFFENSE = [("F", "FS", "False start", "5 yds, pre-snap"),
           ("G", "DOG", "Delay of game", "5 yds, pre-snap"),
           ("E", "ILF", "Illegal formation / shift", "5 yds"),
           ("L", "OH", "Offensive holding", "10 yds"),
           ("P", "OPI", "Offensive pass interference", "10 yds"),
           ("B", "IBB", "Illegal block in the back", "10 yds"),
           ("I", "IG", "Intentional grounding", "10 yds, loss of down"),
           ("N", "URO", "Unnecessary roughness", "15 yds")]
NO_PICK_NOTE = "No play picked: the flag just moves the ball."


def panel(page):
    return page.locator("#flagPanel")


def keys(page, *names):
    for name in names:
        page.keyboard.press(name)


KEY_SHOWN = """(b, k) => [b, ...b.querySelectorAll('*')].some(e => e.textContent.trim() === k)
  || [...b.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === k)"""


def shows_key(button, key):
    """The button prints its flag-mode letter on its own (a key cap, a <b>, a text node): FI 1.6 "with their keys"."""
    return button.evaluate(KEY_SHOWN, key)


def open_panel(page):
    keys(page, "x")
    expect(panel(page)).to_be_visible()


def test_63_x_without_a_drive_is_refused(upage, server):
    """#63: X with no drive gives the red toast "No Dallas drive in progress. Type the ball spot first." and no panel."""
    fresh(upage, server["base"])
    keys(upage, "x")
    expect_toast(upage, "No Dallas drive in progress. Type the ball spot first.", error=True)
    expect(panel(upage)).to_be_hidden()


def test_64_panel_lists_both_columns_offsetting_and_other(upage, server):
    """#64: headings "On TB (defense)" and "On DAL (offense)", 8 coded fouls each with key and summary, Offsetting (W),
    Other on TB, the automatic 1st down box, Other on DAL."""
    with_drive(upage, server["base"])
    open_panel(upage)
    p = panel(upage)
    expect(p).to_contain_text("On TB (defense)")
    expect(p).to_contain_text("On DAL (offense)")
    coded = p.locator("[data-pen]").evaluate_all(
        "els => els.map(e => e.dataset.pen).filter(c => !['OFFSET', 'OTHER_D', 'OTHER_O'].includes(c))")
    assert coded == [code for _, code, _, _ in DEFENSE + OFFENSE]
    for key, code, label, summary in DEFENSE + OFFENSE:
        button = p.locator(f'[data-pen="{code}"]')
        expect(button).to_have_count(1)
        expect(button).to_contain_text(label)
        expect(button).to_contain_text(summary)
        assert shows_key(button, key), f"{code}: no element shows the key letter {key}"
    expect(p.locator('[data-pen="OFFSET"]')).to_contain_text("Offsetting")
    assert shows_key(p.locator('[data-pen="OFFSET"]'), "W"), "Offsetting doesn't show its key W"
    expect(p.locator('[data-pen="OTHER_D"]')).to_contain_text("Other on TB")
    expect(p.locator('[data-pen="OTHER_O"]')).to_contain_text("Other on DAL")
    expect(p.locator("#otherFirst")).to_have_attribute("type", "checkbox")
    expect(p).to_contain_text("automatic 1st down")
    expect(p.locator("#flagClose")).to_be_visible()


def test_65_flag_note_with_and_without_a_pick(upage, server):
    """#65: with A, A picked the note names "PA intermediate (10–19)"; with nothing picked it says the flag only moves
    the ball."""
    with_drive(upage, server["base"])
    keys(upage, "a", "a")
    open_panel(upage)
    expect(upage.locator("#flagNote")).to_have_text(
        "Your pick (PA intermediate (10–19)) is wiped out but still scored as his call. Pre-snap fouls ignore it.")
    keys(upage, "Escape", "Escape")             # close the panel, then clear the pick
    expect(upage.locator("#chosen")).to_have_text("Pick the play")
    open_panel(upage)
    expect(upage.locator("#flagNote")).to_have_text(NO_PICK_NOTE)


def test_66_x_or_escape_closes_and_keeps_the_pick(upage, server):
    """#66: X or Esc closes the panel and keeps the pick; the flag button looks active only while the panel is open."""
    with_drive(upage, server["base"])
    flag_btn = upage.locator("#flagBtn")
    keys(upage, "p")
    expect(flag_btn).not_to_have_class(ON_RE)
    expect(flag_btn).to_have_attribute("aria-expanded", "false")
    for closer in ("x", "Escape"):
        open_panel(upage)
        expect(flag_btn).to_have_class(ON_RE)
        expect(flag_btn).to_have_attribute("aria-expanded", "true")
        keys(upage, closer)
        expect(panel(upage)).to_be_hidden()
        expect(flag_btn).not_to_have_class(ON_RE)
        expect(flag_btn).to_have_attribute("aria-expanded", "false")
        expect(upage.locator("#chosen")).to_contain_text("Short (0–9 air yds)")


def test_67_play_keys_t_and_enter_do_nothing_in_the_panel(upage, server):
    """#67: with the panel open, J, T and Enter send nothing and change nothing."""
    with_drive(upage, server["base"])
    keys(upage, "p")
    open_panel(upage)
    sent = record_requests(upage, "/api/", "POST")
    keys(upage, "j", "t", "Enter")
    quiet(upage)
    assert sent == []
    expect(panel(upage)).to_be_visible()
    expect(upage.locator("#chosen")).to_contain_text("Short (0–9 air yds)")
    expect(upage.locator("#fTD")).not_to_be_checked()


def test_68_h_applies_defensive_holding(upage, server):
    """#68: at 1st & 10 DAL 25 with nothing picked, H sends {"code":"DH","yards":null,"auto_first":false}, toasts the
    message and closes the panel."""
    with_drive(upage, server["base"])
    open_panel(upage)
    sent = record_requests(upage, "/api/penalty")
    keys(upage, "h")
    expect_toast(upage, "Defensive holding: 5 yards, automatic first down. 1st & 10 at DAL 30.")
    assert [r["body"] for r in sent] == [{"code": "DH", "yards": None, "auto_first": False}]
    expect(panel(upage)).to_be_hidden()


def test_69_pre_snap_false_start_ignores_the_pick(upage, server):
    """#69: at 1st & 10 DAL 25, P, X, F toasts "False start: back 5 yards. 1st & 15 at DAL 20." and logs no row."""
    base = server["base"]
    with_drive(upage, base)
    keys(upage, "p")
    open_panel(upage)
    keys(upage, "f")
    expect_toast(upage, "False start: back 5 yards. 1st & 15 at DAL 20.")
    assert state(base)["log"] == []
    expect_shows(upage.locator("#logArea"), "No snaps yet.")


def test_70_flag_on_a_picked_play_logs_a_no_play_row(upage, server):
    """#70: J, X, L adds "Off-tackle left (no play: offensive holding)" with Yds "flag"; the toast ends "His call still
    counts for scoring."."""
    with_drive(upage, server["base"])
    keys(upage, "j")
    open_panel(upage)
    keys(upage, "l")
    expect_toast(upage, re.compile(r"His call still counts for scoring\.$"))
    until(upage, lambda: len(log_table(upage)) == 1, what="the no-play row")
    row = log_table(upage)[0]
    assert (row[COL["Actual"]], row[COL["Yds"]]) == ("Off-tackle left (no play: offensive holding)", "flag")


def test_71_dpi_needs_yards_then_spots_the_ball(upage, server):
    """#71: PPP, X, D with Yards 0 asks for the yards and keeps the panel open; 28 then D spots the ball."""
    with_drive(upage, server["base"])
    keys(upage, "p", "p", "p")
    open_panel(upage)
    keys(upage, "d")
    expect_toast(upage, "Type the yards first: how far past the line for DPI, or the penalty yardage.", error=True)
    expect(panel(upage)).to_be_visible()
    expect(upage.locator("#chosen")).to_contain_text("Deep shot (20+)")
    upage.keyboard.type("28")
    expect(upage.locator("#yards")).to_have_value("28")
    keys(upage, "d")
    expect_toast(upage, re.compile(r"ball at the spot, 28 yards, automatic first down"))
    expect(panel(upage)).to_be_hidden()


def test_72_other_on_tb_with_the_box_ticked(upage, server):
    """#72: Other on TB with Yards 15 and the box ticked toasts "Penalty on TB: 15 yards, automatic first down. ..."
    and the box is unticked afterwards."""
    with_drive(upage, server["base"])
    open_panel(upage)
    upage.keyboard.type("15")
    upage.locator("#otherFirst").check()
    sent = record_requests(upage, "/api/penalty")
    upage.locator('[data-pen="OTHER_D"]').click()
    expect_toast(upage, re.compile(r"^Penalty on TB: 15 yards, automatic first down\. "))
    assert [r["body"] for r in sent] == [{"code": "OTHER_D", "yards": 15, "auto_first": True}]
    expect(panel(upage)).to_be_hidden()
    open_panel(upage)
    expect(upage.locator("#otherFirst")).not_to_be_checked()


def test_73_other_on_dal_never_gives_a_first_down(upage, server):
    """#73: Other on DAL with Yards 10 and the box ticked toasts "Penalty on DAL: back 10 yards. ..." (no 1st down)."""
    base = server["base"]
    with_drive(upage, base)
    open_panel(upage)
    upage.keyboard.type("10")
    upage.locator("#otherFirst").check()
    upage.locator('[data-pen="OTHER_O"]').click()
    expect_toast(upage, re.compile(r"^Penalty on DAL: back 10 yards\. (?!.*first down)"))
    sit = state(base)["sit"]
    assert (sit["down"], sit["togo"], sit["yardline_100"]) == (1, 20, 85)


def test_74_i_and_u_are_fouls_in_the_panel(upage, server):
    """#74: in the panel I applies intentional grounding (down + 1) and U unnecessary roughness on defense, not undo."""
    base = server["base"]
    with_drive(upage, base)
    open_panel(upage)
    keys(upage, "i")
    expect_toast(upage, re.compile(r"^Intentional grounding: back 10 yards, loss of down\."))
    expect(upage.locator("#iDown")).to_have_value("2")
    undos = record_requests(upage, "/api/undo")
    open_panel(upage)
    keys(upage, "u")
    expect_toast(upage, re.compile(r"^Unnecessary roughness on defense: 15 yards, automatic first down\."))
    expect(upage.locator("#iDown")).to_have_value("1")
    assert undos == []


def test_75_offsetting_on_a_picked_play_replays_the_down(upage, server):
    """#75: J, X, W adds "Off-tackle left (no play, flag)" and replays the down."""
    base = server["base"]
    with_drive(upage, base)
    keys(upage, "j")
    open_panel(upage)
    keys(upage, "w")
    expect_toast(upage, re.compile(r"^Offsetting penalties, replay the down\. 1st & 10 at DAL 25\."))
    until(upage, lambda: len(log_table(upage)) == 1, what="the offsetting row")
    assert log_table(upage)[0][COL["Actual"]] == "Off-tackle left (no play, flag)"
    sit = state(base)["sit"]
    assert (sit["down"], sit["togo"], sit["yardline_100"]) == (1, 10, 75)


def test_76_shorthand_roughing_near_the_goal_halves_the_distance(upage, server):
    """#76: shorthand `new T8` then `X RTP` toasts "Done: Roughing the passer: 4 yards (half the distance), automatic
    first down. 1st & Goal at TB 4."."""
    fresh(upage, server["base"])
    cmd = upage.locator("#cmd")
    cmd.fill("new T8")
    cmd.press("Enter")
    expect(upage.locator("#iYard")).to_have_value("8")
    cmd.fill("X RTP")
    cmd.press("Enter")
    expect_toast(upage, "Done: Roughing the passer: 4 yards (half the distance), automatic first down. "
                        "1st & Goal at TB 4.")


def test_77_punt_closes_the_open_panel(upage, server):
    """#77 [fix] (G7): Punt with the flag panel open closes the panel."""
    with_drive(upage, server["base"])
    open_panel(upage)
    upage.locator('[data-end="punt"]').click()
    expect_toast(upage, "Punt. Waiting for the next Dallas drive.")
    expect(panel(upage)).to_be_hidden()
    expect(upage.locator("#flagBtn")).to_have_attribute("aria-expanded", "false")


def test_g25_flag_note_follows_a_mouse_pick(upage, server):
    """ui-architecture 4.6 G25 (new e2e): open with A, A; pick P with the mouse; the note updates."""
    with_drive(upage, server["base"])
    keys(upage, "a", "a")
    open_panel(upage)
    expect(upage.locator("#flagNote")).to_contain_text("PA intermediate (10–19)")
    upage.locator('.key[data-k="P"]').click()
    expect(upage.locator("#flagNote")).to_have_text(
        "Your pick (Short (0–9 air yds)) is wiped out but still scored as his call. Pre-snap fouls ignore it.")

"""FI 6.3 checklist #9 to #26: the situation strip (FI 2.3, 1.8; G1, G2, G3), on the neutral world."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (api_post, command, expect_toast, fresh, quiet, record_requests, selection_of,
                        state, with_drive)

pytestmark = pytest.mark.e2e

BAD_RE = re.compile(r"(^|\s)bad(\s|$)")


def type_and_enter(page, sel, text):
    page.locator(sel).fill(text)
    page.locator(sel).press("Enter")


def expect_valid(page, sel):
    expect(page.locator(sel)).not_to_have_class(BAD_RE)
    expect(page.locator(sel)).not_to_have_attribute("aria-invalid", "true")


def expect_invalid(page, sel):
    expect(page.locator(sel)).to_have_class(BAD_RE)
    expect(page.locator(sel)).to_have_attribute("aria-invalid", "true")


def test_09_ball_on_20_starts_drive_1(upage, server):
    """#9: typing 20 in Ball on + Enter sends {"spot":"DAL 20"}, toasts "Drive 1 started.", drive info updates."""
    fresh(upage, server["base"])
    sent = record_requests(upage, "/api/situation")
    type_and_enter(upage, "#iYard", "20")
    expect_toast(upage, "Drive 1 started.")
    assert [r["body"] for r in sent] == [{"spot": "DAL 20"}]
    expect(upage.locator("#driveInfo")).to_have_text("Drive 1 · snap 1")


def test_10_retyping_the_shown_25_starts_drive_1(upage, server):
    """#10 [fix] (G2): Ball on suggests 25 (its placeholder off the field, G5-3); typing 25 and Enter starts drive 1."""
    fresh(upage, server["base"])
    sent = record_requests(upage, "/api/situation")
    type_and_enter(upage, "#iYard", "25")
    expect(upage.locator("#driveInfo")).to_have_text("Drive 1 · snap 1")
    assert [r["body"] for r in sent] == [{"spot": "DAL 25"}]
    assert state(server["base"])["drive_active"] is True


def test_11_down_2_off_the_field_starts_a_drive(upage, server):
    """#11: off the field, 2 in Down + Enter starts a drive: "Drive N started.", 2nd & 10."""
    fresh(upage, server["base"])
    type_and_enter(upage, "#iDown", "2")
    expect_toast(upage, re.compile(r"^Drive \d+ started\.$"))
    expect(upage.locator("#iDown")).to_have_value("2")
    expect(upage.locator("#iTogo")).to_have_value("10")
    s = state(server["base"])
    assert (s["drive_active"], s["sit"]["down"], s["sit"]["togo"]) == (True, 2, 10)


def test_12_side_chip_off_the_field_starts_a_drive_at_the_mirrored_spot(upage, server):
    """#12: off the field (DAL 25), clicking the side chip starts a drive at TB 25."""
    fresh(upage, server["base"])
    sent = record_requests(upage, "/api/situation")
    upage.locator("#iSide").click()
    expect_toast(upage, "Drive 1 started.")
    assert [r["body"] for r in sent] == [{"spot": "TB 25"}]
    expect(upage.locator("#sideTxt")).to_have_text("TB")
    expect(upage.locator("#iYard")).to_have_value("25")
    s = state(server["base"])
    assert (s["drive_active"], s["sit"]["yardline_100"]) == (True, 25)


def test_13_clock_formats_and_each_hides_est(upage, server):
    """#13: Clock 841 shows 8:41, 8.05 shows 8:05, 12 shows 12:00, and each hides est."""
    base = server["base"]
    with_drive(upage, base)
    for typed, shown in (("841", "8:41"), ("8.05", "8:05"), ("12", "12:00")):
        command(base, "K 3")                                     # a logged play estimates the clock (FI 2.4)
        expect(upage.locator("#clockEst")).to_be_visible()
        type_and_enter(upage, "#iClock", typed)
        expect(upage.locator("#iClock")).to_have_value(shown)
        expect(upage.locator("#clockEst")).to_be_hidden()


def test_14_clock_16_00_is_refused_and_kept_with_the_invalid_style(upage, server):
    """#14: Clock 16:00 gives the red toast and the field keeps 16:00 marked invalid (.bad, aria-invalid)."""
    fresh(upage, server["base"])
    type_and_enter(upage, "#iClock", "16:00")
    expect_toast(upage, "'16:00' isn't a game clock (max 15:00)", error=True)
    expect(upage.locator("#iClock")).to_have_value("16:00")
    expect_invalid(upage, "#iClock")


@pytest.mark.parametrize("sel, typed, message", [
    ("#iDown", "7", "Down must be 1 to 4"),
    ("#iQtr", "6", "Quarter must be 1 to 4 (5 = overtime)"),
    ("#iTogo", "0", "To go must be from 1 to 99"),                # v1.5: the server's ranges (backend)
    ("#iYard", "60", "Yard line must be 1 to 50"),
    ("#iOff", "x", "'x' isn't a number (score_off)."),
], ids=["down", "qtr", "togo", "ball-on", "score"])
def test_15_strip_validation_messages(upage, server, sel, typed, message):
    """#15: each out-of-range or non-numeric value gives its red toast."""
    fresh(upage, server["base"])
    type_and_enter(upage, sel, typed)
    expect_toast(upage, message, error=True)
    expect_invalid(upage, sel)


def test_16_negative_score_is_refused(upage, server):
    """#16 (v1.5, the server's ranges): a score of -3 is refused with a red toast, the field keeps -3 marked invalid
    and explained beside the strip (G5-13), and the score stays 7."""
    base = server["base"]
    fresh(upage, base)
    command(base, "DAL 7 TB 3")
    expect(upage.locator("#iOff")).to_have_value("7")
    type_and_enter(upage, "#iOff", "-3")
    expect_toast(upage, "A score must be from 0 to 199", error=True)
    expect(upage.locator("#iOff")).to_have_value("-3")
    expect_invalid(upage, "#iOff")
    expect(upage.locator("#stripError")).to_contain_text("A score must be from 0 to 199")
    assert state(base)["sit"]["score_off"] == 7


def test_17_to_go_g_means_goal(upage, server):
    """#17: To go g shows G and togo equals yardline_100; To go 10 at TB 6 shows G."""
    base = server["base"]
    with_drive(upage, base)
    type_and_enter(upage, "#iTogo", "g")
    expect(upage.locator("#iTogo")).to_have_value("G")
    sit = state(base)["sit"]
    assert sit["togo"] == sit["yardline_100"]
    command(base, "new T6")
    expect(upage.locator("#iYard")).to_have_value("6")
    type_and_enter(upage, "#iTogo", "10")
    expect(upage.locator("#iTogo")).to_have_value("G")
    sit = state(base)["sit"]
    assert (sit["togo"], sit["yardline_100"]) == (6, 6)


def test_18_side_chip_at_dal_40_flips_to_tb_40_and_selects_ball_on(upage, server):
    """#18: at DAL 40 the chip sends {"spot":"TB 40"}, reads TB in the opponent style, Ball on focused and selected."""
    base = server["base"]
    with_drive(upage, base, spot="new D40")
    expect(upage.locator("#iYard")).to_have_value("40")
    sent = record_requests(upage, "/api/situation")
    upage.locator("#iSide").click()
    expect(upage.locator("#sideTxt")).to_have_text("TB")
    assert [r["body"] for r in sent] == [{"spot": "TB 40"}]
    expect(upage.locator("#iSide")).to_have_class(re.compile(r"(^|\s)opp(\s|$)"))
    expect(upage.locator("#iSide")).to_have_attribute("data-side", "opp")
    expect(upage.locator("#iYard")).to_be_focused()
    start, end, length = selection_of(upage, "#iYard")
    assert (start, end) == (0, length) and length > 0, (start, end, length)


def test_19_switching_the_chip_at_the_50_keeps_tb_50(upage, server):
    """#19: at the 50, switching the chip to TB keeps showing TB 50 after the save (and after later renders)."""
    base = server["base"]
    with_drive(upage, base, spot="new 50")
    expect(upage.locator("#iYard")).to_have_value("50")
    expect(upage.locator("#sideTxt")).to_have_text("DAL")
    sent = record_requests(upage, "/api/situation")
    upage.locator("#iSide").click()
    expect(upage.locator("#sideTxt")).to_have_text("TB")
    assert [r["body"] for r in sent] == [{"spot": "TB 50"}]
    command(base, "Q1 14:00")                                   # another save: the strip renders again
    expect(upage.locator("#iClock")).to_have_value("14:00")
    expect(upage.locator("#sideTxt")).to_have_text("TB")
    expect(upage.locator("#iYard")).to_have_value("50")


def test_20_tab_saves_like_enter(upage, server):
    """#20: Tab out of an edited field saves it the same way Enter does."""
    base = server["base"]
    with_drive(upage, base)
    sent = record_requests(upage, "/api/situation")
    upage.locator("#iDown").fill("2")
    upage.locator("#iDown").press("Tab")
    expect(upage.locator("#iDown")).to_have_value("2")
    assert [r["body"] for r in sent] == [{"down": "2"}]
    assert state(base)["sit"]["down"] == 2


def test_21_enter_in_a_strip_field_during_a_drive_focuses_yards(upage, server):
    """#21: with a drive active, Enter in an edited strip field blurs it and focuses Yards."""
    with_drive(upage, server["base"])
    type_and_enter(upage, "#iTogo", "7")
    expect(upage.locator("#yards")).to_be_focused()
    expect(upage.locator("#iTogo")).to_have_value("7")


def test_22_typing_then_escape_restores_without_a_request(upage, server):
    """#22: typing a value then Esc restores the server value with no request."""
    fresh(upage, server["base"])
    sent = record_requests(upage, "/api/", "POST")
    upage.locator("#iQtr").fill("3")
    upage.locator("#iQtr").press("Escape")
    expect(upage.locator("#iQtr")).to_have_value("1")
    quiet(upage)
    assert sent == []


def test_23_escape_untouched_or_rejected_shows_the_server_value(upage, server):
    """#23 [fix] (G1): Esc in a field without typing, and Esc on a rejected value, show the server value and clear
    the invalid style."""
    fresh(upage, server["base"])
    upage.locator("#iQtr").click()
    upage.locator("#iQtr").press("Escape")
    expect(upage.locator("#iQtr")).to_have_value("1")
    type_and_enter(upage, "#iClock", "16:00")
    expect_invalid(upage, "#iClock")
    upage.locator("#iClock").focus()
    upage.locator("#iClock").press("Escape")
    expect(upage.locator("#iClock")).to_have_value("15:00")
    expect_valid(upage, "#iClock")


def test_24_clearing_a_field_and_enter_sends_nothing(upage, server):
    """#24: clearing a field and pressing Enter sends no request and restores the server value."""
    fresh(upage, server["base"])
    sent = record_requests(upage, "/api/", "POST")
    type_and_enter(upage, "#iQtr", "")
    expect(upage.locator("#iQtr")).to_have_value("1")
    quiet(upage)
    assert sent == []


def test_25_typing_is_never_clobbered_by_a_background_change(upage, server):
    """#25: while typing in a strip field, a change made through the API does not overwrite the typed text."""
    base = server["base"]
    fresh(upage, base)
    upage.locator("#iClock").click()
    upage.locator("#iClock").press("ControlOrMeta+a")
    upage.locator("#iClock").press_sequentially("8:4")
    api_post(base, "/api/situation", {"clock": "10:00"})
    api_post(base, "/api/situation", {"qtr": "2"})
    expect(upage.locator("#iQtr")).to_have_value("2")           # the page rendered the new state
    expect(upage.locator("#iClock")).to_have_value("8:4")
    expect(upage.locator("#iClock")).to_be_focused()


def test_26_est_shows_after_a_logged_play_and_a_typed_clock_hides_it(upage, server):
    """#26: after a logged play est. shows next to Clock; typing a clock hides it."""
    with_drive(upage, server["base"])
    expect(upage.locator("#clockEst")).to_be_hidden()
    upage.keyboard.press("k")
    upage.keyboard.type("3")
    upage.keyboard.press("Enter")
    expect(upage.locator("#clockEst")).to_be_visible()
    type_and_enter(upage, "#iClock", "9:00")
    expect(upage.locator("#clockEst")).to_be_hidden()
    expect(upage.locator("#iClock")).to_have_value("9:00")


def test_g3_ball_on_d_25_starts_the_drive_at_dal_25(upage, server):
    """ui-architecture 4.6 G3 (new e2e): "D 25" in Ball on off the field starts the drive at DAL 25."""
    fresh(upage, server["base"])
    sent = record_requests(upage, "/api/situation")
    type_and_enter(upage, "#iYard", "D 25")
    expect_toast(upage, "Drive 1 started.")
    assert [r["body"] for r in sent] == [{"spot": "D 25"}]
    expect(upage.locator("#iYard")).to_have_value("25")
    expect(upage.locator("#sideTxt")).to_have_text("DAL")
    s = state(server["base"])
    assert (s["drive_active"], s["sit"]["yardline_100"]) == (True, 75)


@pytest.mark.parametrize("typed, spot, yardline_100", [("25", "DAL 25", 75), ("t25", "T 25", 25)], ids=["bare", "sided"])
def test_g5_3_ball_on_after_a_field_goal_starts_on_the_offense_side(upage, server, typed, spot, yardline_100):
    """G5-3: after a Dallas field goal from TB 5 the strip offers Dallas's side: the chip reads DAL, Ball on is blank
    with the placeholder 25, a bare 25 starts the next drive at DAL 25 and a typed side (t25) still picks TB 25."""
    base = server["base"]
    fresh(upage, base)
    command(base, "new T5")
    api_post(base, "/api/drive", {"end": "fg"})
    expect(upage.locator("#driveInfo")).to_have_text("DAL off the field. Type where they get the ball in Ball on.")
    expect(upage.locator("#sideTxt")).to_have_text("DAL")
    expect(upage.locator("#iYard")).to_have_value("")
    expect(upage.locator("#iYard")).to_have_attribute("placeholder", "25")
    sent = record_requests(upage, "/api/situation")
    type_and_enter(upage, "#iYard", typed)
    expect_toast(upage, re.compile(r"^Drive \d+ started\.$"))
    assert [r["body"] for r in sent] == [{"spot": spot}]
    s = state(base)
    assert (s["drive_active"], s["sit"]["yardline_100"]) == (True, yardline_100)
    expect(upage.locator("#iYard")).to_have_value("25")
    expect(upage.locator("#iYard")).not_to_have_attribute("placeholder", "25")


def test_g5_13_a_refused_value_stays_explained_until_fixed(upage, server):
    """G5-13: Clock "zz" is refused: the red toast is an alert that outlasts 2.6 s and Esc dismisses it, while the line
    beside the strip keeps the server's words with the word Invalid, and the field points at it (aria-describedby)
    until a good value is saved."""
    fresh(upage, server["base"])
    type_and_enter(upage, "#iClock", "zz")
    expect_toast(upage, "Clock like 8:41 or 841, got 'zz'", error=True)
    toast = upage.locator("#toast")
    expect(toast).to_have_attribute("role", "alert")
    expect_invalid(upage, "#iClock")
    line = upage.locator("#stripError")
    expect(line).to_be_visible()
    expect(line).to_have_text(re.compile(r"^\s*Invalid\s+Clock like 8:41 or 841, got 'zz'\s*$"))
    expect(upage.locator("#iClock")).to_have_attribute("aria-describedby", "stripError")
    upage.wait_for_timeout(3200)
    expect(toast).to_have_class(re.compile(r"(^|\s)show(\s|$)"))
    upage.locator("body").press("Escape")
    expect(toast).not_to_have_class(re.compile(r"(^|\s)show(\s|$)"))
    expect(line).to_be_visible()
    type_and_enter(upage, "#iClock", "8:41")
    expect(upage.locator("#iClock")).to_have_value("8:41")
    expect(line).to_be_hidden()
    expect(upage.locator("#iClock")).not_to_have_attribute("aria-describedby", "stripError")
    expect_valid(upage, "#iClock")


@pytest.mark.parametrize("size", [(1440, 900), (1920, 1080)], ids=["1440x900", "1920x1080"])
def test_g5_6_the_drive_end_keys_share_the_strip_row(ui_pages, server, size):
    """G5-6 (Under the Lights): with two-digit scores and a drive on, Punt, FG good, FG missed and Half over sit whole
    on the strip's one row under the ribbon (1440: y 44 to 96)."""
    from ui_helpers import BOOT_TIMEOUT_MS, reset_game
    base = server["base"]
    reset_game(base)
    for line in ("DAL 27 TB 10", "Q4 12:41", "new D25", "K 3", "P 6", "J 2"):
        command(base, line)
    page = ui_pages(width=size[0], height=size[1])
    page.goto(f"{base}/?world=under-the-lights&scene=2d", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('#app[data-boot="ready"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    expect(page.locator("#endRow")).to_be_visible()
    strip = page.locator("#rg-situation").bounding_box()
    for kind in ("punt", "fg", "fg_miss", "half"):
        key = page.locator(f'.sc-end[data-end="{kind}"]').bounding_box()
        assert key["y"] >= strip["y"] and key["y"] + key["height"] <= strip["y"] + strip["height"] + 0.5, (kind, key, strip)
        assert key["x"] + key["width"] <= size[0], (kind, key)

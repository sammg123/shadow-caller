"""A7 input surfaces in the browser, beyond what A11's checklist files pin (ui-architecture.md 11.2, 11.3): the strip
selects a field's value when a mouse click focuses it (FI 1.8), the hero's hover and focus reach the store and come
back (G18: actions.hoverLeaf, the hook engine.highlightGhost hangs on), a family row lights its top play, the flag
key shows the panel's state, the desk's mode and dim hooks, the retag keys' fresh window during a watch, shorthand
lines typed back to back both run, and the layouts at 760 px (#7) and 390 px (#8). Neutral world, sandboxed server."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (EVENT, api_post, blur, command, feed_on, fresh, js_errors, load, record_requests, reset_game,
                        state, stop_watch, until, with_drive)
from ui_helpers import neutral_only, point_at  # v1.4 (W6): world-aware helpers

pytestmark = pytest.mark.e2e

ON_RE = re.compile(r"(^|\s)on(\s|$)")
LEAF = '#heroArea .leaf[data-leaf="{}"]'


def highlighted(page):
    """The plays the hero marks as lit (the store's view.hoverLeaf, rendered back by predictionVm)."""
    return page.locator('#heroArea .leaf[data-highlighted="true"]').evaluate_all("els => els.map(e => e.dataset.leaf)")


def test_a_mouse_click_selects_the_whole_strip_value(upage, server):
    """FI 1.8: focus selects the value, also when a mouse click focused it (the click's caret can't undo it), so
    typing replaces "25" instead of extending it (during a drive: off the field Ball on is blank, G5-3)."""
    with_drive(upage, server["base"])
    expect(upage.locator("#iYard")).to_have_value("25")
    sent = record_requests(upage, "/api/situation")
    upage.locator("#iYard").click()
    upage.keyboard.type("20")
    upage.keyboard.press("Enter")
    expect(upage.locator("#iYard")).to_have_value("20")
    expect(upage.locator("#driveInfo")).to_have_text("Drive 1 · snap 1")
    assert [r["body"] for r in sent] == [{"spot": "DAL 20"}]
    assert js_errors(upage) == []


def test_hover_and_focus_light_a_play_and_clear_when_they_leave(upage, server):
    """G18: pointer and focus on a play reach the store (actions.hoverLeaf) and come back as data-highlighted; the
    pointer wins while it is there and focus comes back when it leaves."""
    with_drive(upage, server["base"])
    point_at(upage, LEAF.format("screen"))
    until(upage, lambda: highlighted(upage) == ["screen"], what="the hovered play to light")
    upage.mouse.move(2, 2)
    until(upage, lambda: highlighted(upage) == [], what="the light to clear when the pointer leaves the call")
    upage.locator(LEAF.format("pa_mid")).focus()
    until(upage, lambda: highlighted(upage) == ["pa_mid"], what="the focused play to light")
    point_at(upage, LEAF.format("run_inside"))
    until(upage, lambda: highlighted(upage) == ["run_inside"], what="the pointer to win over focus")
    upage.mouse.move(2, 2)
    until(upage, lambda: highlighted(upage) == ["pa_mid"], what="focus to come back")
    blur(upage)
    until(upage, lambda: highlighted(upage) == [], what="the light to clear on blur")
    assert js_errors(upage) == []


def test_a_family_row_lights_its_most_likely_play(upage, server):
    """DESIGN.md video board: a family row under the pointer lights its projection, i.e. its top play."""
    base = server["base"]
    with_drive(upage, base)
    families = state(base)["prediction"]["families"]
    run = next(f for f in families if f["key"] == "run")
    top = run["leaves"][0]["key"]
    fam = upage.locator('#heroArea .fam[data-family="run"]')
    expect(fam).to_have_attribute("data-top-leaf", top)
    fam.locator(".sc-fam-pct").hover()
    until(upage, lambda: highlighted(upage) == [top], what="the family's top play to light")


def test_tab_walks_the_plays_in_order(upage, server):
    """#122: the plays are buttons in the tab order, family by family, in the order the board shows them."""
    base = server["base"]
    with_drive(upage, base)
    order = [leaf["key"] for f in state(base)["prediction"]["families"] for leaf in f["leaves"]]
    upage.locator(LEAF.format(order[0])).focus()
    for key in order[1:4]:
        upage.keyboard.press("Tab")
        assert upage.evaluate("() => document.activeElement.dataset.leaf") == key


def test_the_flag_key_shows_the_panel_state(upage, server):
    """5.1: #flagBtn.on and aria-expanded while the flag panel is open; X opens, Escape closes."""
    with_drive(upage, server["base"])
    flag = upage.locator("#flagBtn")
    expect(flag).to_have_attribute("aria-expanded", "false")
    upage.keyboard.press("x")
    expect(upage.locator("#flagPanel")).to_be_visible()
    expect(flag).to_have_class(ON_RE)
    expect(flag).to_have_attribute("aria-expanded", "true")
    expect(upage.locator("#yards")).to_be_focused()
    upage.keyboard.press("Escape")
    expect(upage.locator("#flagPanel")).to_be_hidden()
    expect(flag).not_to_have_class(ON_RE)
    expect(flag).to_have_attribute("aria-expanded", "false")


def test_the_desk_reports_its_mode_and_dims_off_the_field(upage, server):
    """#5 and #93 hooks: #entry[data-dim] off the field with the feed off; #entry[data-entry-mode] follows the mode."""
    base = server["base"]
    fresh(upage, base)
    entry = upage.locator("#entry")
    expect(entry).to_have_attribute("data-dim", "true")
    expect(entry).to_have_attribute("data-entry-mode", "manual")
    assert float(upage.locator("#manualEntry").evaluate("e => getComputedStyle(e).opacity")) < 1
    command(base, "new D25")
    expect(entry).to_have_attribute("data-dim", "false")
    feed_on(upage, base)
    expect(entry).to_have_attribute("data-entry-mode", "feed")
    expect(entry).to_have_attribute("data-dim", "false")
    expect(upage.locator("#manualEntry")).to_be_hidden()
    expect(upage.locator("#lastPlay")).to_be_visible()
    expect(upage.locator("#lastPlay")).to_have_attribute("data-fresh", "false")
    api_post(base, "/api/feed", {"on": False})


def test_the_retag_keys_light_after_each_new_caller_play(upage, watch_server):
    """DESIGN.md desk: during a watch the last play changes with each caller snap and #lastPlay[data-fresh] lights."""
    base = watch_server["base"]
    reset_game(base)
    api_post(base, "/api/watch/start", {"event_id": EVENT, "speed": 1})
    try:
        load(upage, base)
        expect(upage.locator("#entry")).to_have_attribute("data-entry-mode", "watch")
        expect(upage.locator('#lastPlay[data-fresh="true"]')).to_have_count(1, timeout=30_000)
        expect(upage.locator("#lastPlay [data-retag]").first).to_be_visible()
    finally:
        stop_watch(base)


def test_two_shorthand_lines_typed_back_to_back_both_run(upage, server):
    """#82: a line typed while another is out runs after it; the box clears once the last one is in."""
    base = server["base"]
    fresh(upage, base)
    sent = record_requests(upage, "/api/command")
    cmd = upage.locator("#cmd")
    cmd.fill("new D25")
    cmd.press("Enter")
    cmd.fill("K 3")
    cmd.press("Enter")
    until(upage, lambda: len(sent) == 2, what="both lines to go out")
    assert [r["body"] for r in sent] == [{"text": "new D25"}, {"text": "K 3"}]
    expect(cmd).to_have_value("")
    expect(upage.locator("#iDown")).to_have_value("2")
    s = state(base)
    assert (s["drive_active"], len(s["log"]), s["sit"]["togo"]) == (True, 1, 7)


@neutral_only("#7's two family columns at 760 px are the neutral layout's; Under the Lights is one column below "
              "1200 x 640 (ui-architecture 15.3)")
def test_families_show_in_two_columns_at_760(ui_pages, server):
    """#7: at 760 px wide the five families sit in two columns."""
    page = ui_pages(760, 900)
    with_drive(page, server["base"])
    fams = page.locator("#heroArea .fam")
    expect(fams).to_have_count(5)
    xs = fams.evaluate_all("els => els.map(e => Math.round(e.getBoundingClientRect().left))")
    assert len(set(xs)) == 2, xs


@pytest.mark.parametrize("panel", ["strip", "call", "entry", "flags"])
def test_nothing_scrolls_sideways_at_390(ui_pages, server, panel):
    """#8 (G17) for the input surfaces: at 390 px no panel is wider than its region, the page is not wider than the
    screen, and the longest call name stays whole (DESIGN.md, the Whole Name Rule)."""
    page = ui_pages(390, 844)
    base = server["base"]
    with_drive(page, base)
    if panel == "flags":
        page.keyboard.press("x")
        expect(page.locator("#flagPanel")).to_be_visible()
    region = {"strip": "#rg-situation", "call": "#rg-call", "entry": "#entry", "flags": "#rg-flags"}[panel]
    over = page.locator(region).evaluate("e => e.scrollWidth - e.clientWidth")
    assert over <= 0, f"{region} is {over} px wider than its box"
    assert page.evaluate("() => document.documentElement.scrollWidth") == 390
    name = page.locator("#heroArea .sc-call-name")
    assert name.evaluate("e => e.scrollWidth <= e.clientWidth")

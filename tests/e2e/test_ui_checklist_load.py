"""FI 6.3 checklist #1 to #8: load and layout, on the neutral world (ui-architecture 7.2). Sandboxed server only."""
import pytest
from playwright.sync_api import expect
from ui_helpers import (command, expect_off_field, expect_shows, finished, fresh, load, record_requests, reset_game,
                        state)
from ui_helpers import neutral_only, show  # v1.4 (W6): world-aware helpers

pytestmark = pytest.mark.e2e


def test_01_title_game_label_and_who_label(upage, server):
    """#1: title "Shadow Play-Caller", #gameLabel = game.label, #whoLabel "Modelling Brian Schottenheimer (DAL offense)"."""
    fresh(upage, server["base"])
    s = state(server["base"])
    expect(upage).to_have_title("Shadow Play-Caller")
    expect(upage.locator("#gameLabel")).to_have_text(s["game"]["label"])
    expect(upage.locator("#whoLabel")).to_have_text("Modelling Brian Schottenheimer (DAL offense)")


def test_02_no_page_or_console_errors_on_load_and_idle(upage, server):
    """#2: no page errors and no console errors on load and after 3 s idle. A component that failed to mount is an
    error shown on the page (ui-architecture 9.1 region notices), so none may be there either."""
    fresh(upage, server["base"])
    expect(upage.locator("#gameLabel")).not_to_have_text("")
    upage.wait_for_timeout(3000)
    assert upage.errors == [], upage.bad_responses + upage.errors
    expect(upage.locator('[data-testid="region-notice"]')).to_have_count(0)


def test_03_version_polls_without_state_refetch(upage, server):
    """#3 (Appendix A): with the feed off and nothing changing, /api/version polls (at least 2 in 4.5 s; every 1 s
    now) and /api/state is not refetched."""
    fresh(upage, server["base"])
    expect(upage.locator("#gameLabel")).not_to_have_text("")
    upage.wait_for_timeout(1500)                       # let the boot fetches settle
    versions = record_requests(upage, "/api/version", "GET")
    states = record_requests(upage, "/api/state", "GET")
    upage.wait_for_timeout(4500)
    assert len(versions) >= 2, versions
    assert states == []


def test_04_fresh_strip_values(upage, server):
    """#4: Qtr 1, Clock 15:00, 0 and 0, Down 1, To go 10, side chip DAL, Ball on 25, est. hidden."""
    fresh(upage, server["base"])
    for sel, value in (("#iQtr", "1"), ("#iClock", "15:00"), ("#iOff", "0"), ("#iOpp", "0"), ("#iDown", "1"),
                       ("#iTogo", "10"), ("#iYard", "25")):
        expect(upage.locator(sel)).to_have_value(value)
    expect(upage.locator("#sideTxt")).to_have_text("DAL")
    expect(upage.locator("#clockEst")).to_be_hidden()


def _dim_style(page):
    return page.locator("#entry").evaluate(
        "e => { const c = getComputedStyle(e); const m = document.querySelector('#manualEntry');"
        " const cm = m ? getComputedStyle(m) : c; return [c.opacity, c.filter, cm.opacity, cm.filter, cm.color]; }")


def test_05_no_drive_off_field_state(upage, server):
    """#5: no drive: "DAL is off the field", #endRow hidden, #logBtn disabled, the entry panel visibly de-emphasized
    (#entry[data-dim="true"], and it looks different once a drive starts)."""
    base = server["base"]
    fresh(upage, base)
    expect_off_field(upage)
    expect(upage.locator("#endRow")).to_be_hidden()
    expect(upage.locator("#logBtn")).to_be_disabled()
    expect(upage.locator("#entry")).to_have_attribute("data-dim", "true")
    dimmed = _dim_style(upage)
    command(base, "new D25")
    expect(upage.locator("#entry")).not_to_have_attribute("data-dim", "true")
    assert _dim_style(upage) != dimmed, "the de-emphasized entry panel looks the same as the active one"


def test_06_fresh_scorecard_log_and_tendencies_title(upage, server):
    """#6: "Scores appear after the first logged snap.", "No snaps yet. ...", "Schottenheimer's tendencies"."""
    fresh(upage, server["base"])
    expect_shows(upage.locator("#kpiArea"), "Scores appear after the first logged snap.")
    show(upage, "#logArea")
    expect_shows(upage.locator("#logArea"), "No snaps yet. Each logged play shows his top pick next to what he called.")
    expect(upage.locator("#profTitle")).to_have_text("Schottenheimer's tendencies")


def _box(page, sel):
    b = page.locator(sel).first.bounding_box()
    assert b, f"{sel} has no layout box"
    return b


@neutral_only("#7 is the neutral layout's rail and family columns; Under the Lights hangs every region in its own "
              "fixtures (DESIGN.md Layout, ui-architecture 15)")
def test_07_rail_stacks_at_1040_and_families_two_columns_at_760(ui_pages, server):
    """#7: at 1440 the rail sits beside the main column; at 1040 px it stacks under it; at 760 px the five families
    show in 2 columns."""
    base = server["base"]
    reset_game(base)
    command(base, "new D25")
    wide = ui_pages(1440, 900)
    load(wide, base)
    expect(wide.locator("#heroArea .fam")).to_have_count(5)
    call, score = _box(wide, "#rg-call"), _box(wide, "#rg-score")
    assert score["x"] >= call["x"] + call["width"] - 1, "at 1440 the scorecard rail should sit beside the main column"
    mid = ui_pages(1040, 900)
    load(mid, base)
    expect(mid.locator("#heroArea .fam")).to_have_count(5)
    main_bottom = max(_box(mid, sel)["y"] + _box(mid, sel)["height"] for sel in ("#rg-call", "#rg-log"))
    assert _box(mid, "#rg-score")["y"] >= main_bottom - 1, "at 1040 the rail should stack under the main column"
    narrow = ui_pages(760, 900)
    load(narrow, base)
    expect(narrow.locator("#heroArea .fam")).to_have_count(5)
    lefts = narrow.locator("#heroArea .fam").evaluate_all("els => els.map(e => Math.round(e.getBoundingClientRect().left))")
    assert len(set(lefts)) == 2, f"families at 760 px sit in {len(set(lefts))} columns: {lefts}"


def _page_width(page):
    return page.evaluate("() => [document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth]")


def test_08_no_horizontal_scroll_at_390(ui_pages, server):
    """#8 [fix] (G17): at 390 px the document is no wider than the viewport, with a drive (the full prediction) and
    after a whole game (the play log, play feed and box score)."""
    base = server["base"]
    reset_game(base)
    command(base, "new D25")
    phone = ui_pages(390, 844)
    load(phone, base)
    expect(phone.locator("#heroArea .fam")).to_have_count(5)
    doc, body, view = _page_width(phone)
    assert doc <= view and body <= view, f"document {doc} px, body {body} px, viewport {view} px (drive)"
    finished(phone, base)
    expect(phone.locator("#logArea tbody tr")).to_have_count(59)
    doc, body, view = _page_width(phone)
    assert doc <= view and body <= view, f"document {doc} px, body {body} px, viewport {view} px (finished game)"

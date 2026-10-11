"""FI 6.3 checklist #1 to #3, #7 and #8 on the restructured home page (restructure-v2.md 1 and 2): the top bar's
title, current game and the caller it shadows; no errors on load or at idle; the version poll; the neutral page's
layout at 1440 and 1040 px; nothing wider than a phone. #4 to #6 went with the situation strip, the entry pad and the
scorecard (the Model Report shows his scorecard now). Sandboxed server only."""
import pytest
from playwright.sync_api import expect
from ui_helpers import api_get, finished, fresh, load, neutral_only, record_requests, seek_game, state

pytestmark = pytest.mark.e2e

MID = 40                        # a paused watch 40 plays in: Dallas has had the ball, the board shows his call


def test_01_title_game_label_and_who_label(upage, server):
    """#1: title "Shadow Play-Caller"; the current game in the top bar, "TB at DAL" with ESPN's status, the game's
    whole label on its tooltip; the plate names the caller it shadows, "Shadowing Schottenheimer · DAL", its tooltip
    every word (v1.5, G4-2)."""
    base = server["base"]
    fresh(upage, base)
    s = state(base)
    detail = api_get(base, "/api/watch")["game"]["detail"]
    expect(upage).to_have_title("Shadow Play-Caller")
    expect(upage.locator("#gameLabel")).to_have_text(f"TB at DAL · {detail}")
    expect(upage.locator("#gameLabel")).to_have_attribute("title", s["game"]["label"])
    expect(upage.locator("#whoLabel")).to_have_text("Shadowing Schottenheimer · DAL")
    expect(upage.locator(".sc-masthead-plate")).to_have_attribute(
        "title", "Modelling Brian Schottenheimer (DAL offense)")


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


def _box(page, sel):
    b = page.locator(sel).first.bounding_box()
    assert b, f"{sel} has no layout box"
    return b


@neutral_only("#7 is the neutral layout's main column and rail; Under the Lights hangs every region in its own "
              "fixtures (DESIGN.md Layout, ui-architecture 15)")
def test_07_the_rail_sits_beside_the_main_column_and_stacks_under_it_at_1040(ui_pages, server):
    """#7: at 1440 the rail (win probability, drives, plays) sits beside the main column (field and call); at 1040 px
    it stacks under it; the top bar and the scoreboard run across the top at both."""
    base = server["base"]
    seek_game(base, MID)
    wide = ui_pages(1440, 900)
    load(wide, base)
    call, wp, field = _box(wide, "#rg-call"), _box(wide, "#rg-wp"), _box(wide, "#rg-field")
    assert wp["x"] >= max(call["x"] + call["width"], field["x"] + field["width"]) - 1, "the rail beside the column"
    top = _box(wide, '[data-testid="transport"]')
    assert top["y"] + top["height"] <= field["y"] + 1, "the top bar above the field"
    mid = ui_pages(1040, 900)
    load(mid, base)
    main_bottom = max(_box(mid, sel)["y"] + _box(mid, sel)["height"] for sel in ("#rg-call", "#rg-field"))
    assert _box(mid, "#rg-wp")["y"] >= main_bottom - 1, "at 1040 the rail stacks under the main column"


def _page_width(page):
    return page.evaluate("() => [document.documentElement.scrollWidth, document.body.scrollWidth, window.innerWidth]")


def test_08_no_horizontal_scroll_at_390(ui_pages, server):
    """#8 [fix] (G17): at 390 px the document is no wider than the viewport, mid-game (the top bar, the call) and at
    the final whistle (every play on the ticker and the drive chart)."""
    base = server["base"]
    seek_game(base, MID)
    phone = ui_pages(390, 844)
    load(phone, base)
    expect(phone.locator('[data-testid="transport"]')).to_be_visible()
    doc, body, view = _page_width(phone)
    assert doc <= view and body <= view, f"document {doc} px, body {body} px, viewport {view} px (mid-game)"
    finished(phone, base)
    expect(phone.locator('[data-testid="progress-count"]')).to_have_text(f"{state(base)['watch']['total']} / "
                                                                          f"{state(base)['watch']['total']}")
    doc, body, view = _page_width(phone)
    assert doc <= view and body <= view, f"document {doc} px, body {body} px, viewport {view} px (finished game)"
    assert phone.errors == [], phone.errors

"""A9 chrome in the browser (ui-architecture.md 2.6, 3.9, 5.1; feature-inventory.md 6.3 #116 to #121; restructure-v2.md
9): the connection banner, the loading screen (while the first state loads and while the page opens its game), the
restart screen for an old server, the toasts a playback request can raise (no answer, a refusal, ESPN out of reach),
outside changes showing without a reload, and the chrome on a phone. Sandboxed servers only (never the live game)."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (expect_toast, fresh, js_errors, load, record_requests, region_box, reset_game, seek_game,
                        state, toasts_shown, until, wait_ready)

pytestmark = pytest.mark.e2e

MID = 40
JUMP = 20
NO_ANSWER = "Can't reach the app server, so the game didn't move. Try again in a moment."
REFUSED = "Refused for the test."
ESPN_DOWN = "ESPN can't be reached right now, so the game stays where it is."
ERROR_MS = 8_000                # G5-13: an error stays up until it has been read
COUNT = '[data-testid="progress-count"]'


def patched_json(route, change):
    """Answer a GET with the real body changed by `change(body)` (an old server the sandbox can't be on demand)."""
    response = route.fetch()
    route.fulfill(response=response, json=change(response.json()))


def at(page, base, idx):
    seek_game(base, idx)
    load(page, base)


def press_right(page):
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("ArrowRight")


# ---------------------------------------------------------------- connection and boot (G11, #119, #120)
def test_g11_the_banner_goes_retrying_then_offline_and_back(upage, server):
    """3.9: one failure is "Reconnecting…", three are offline with a countdown and Retry now; the last good state
    stays on screen; the next success clears it."""
    fresh(upage, server["base"])
    app, banner = upage.locator("#app"), upage.locator('[data-testid="conn"]')
    expect(upage.locator("#gameLabel")).not_to_have_text("")
    label = upage.locator("#gameLabel").text_content()
    expect(banner).to_be_hidden()
    upage.route("**/api/version", lambda route: route.abort())
    expect(app).to_have_attribute("data-conn", "retrying")
    expect(banner).to_be_visible()
    expect(banner).to_have_attribute("data-conn", "retrying")
    expect(banner).to_contain_text("Reconnecting…")
    expect(app).to_have_attribute("data-conn", "offline", timeout=15_000)
    expect(banner).to_contain_text(re.compile(r"Can't reach the app server\. Retrying (in \d+ s|now)\."))
    retry = upage.locator('[data-testid="conn-retry"]')
    expect(retry).to_be_visible()
    expect(retry).to_have_text("Retry now")
    expect(upage.locator("#gameLabel")).to_have_text(label)
    upage.unroute("**/api/version")
    retry.click()
    expect(app).to_have_attribute("data-conn", "online")
    expect(banner).to_be_hidden()


def test_120_the_boot_screen_retries_until_the_state_loads(upage, server):
    """#120: a failed first /api/state says so, counts down, and Retry now loads the game once the server answers."""
    base = server["base"]
    reset_game(base)
    upage.route("**/api/state", lambda route: route.abort())
    load(upage, base, ready=False)
    boot = upage.locator('[data-testid="boot"]')
    expect(boot).to_have_attribute("data-phase", "failed", timeout=15_000)
    expect(boot).to_be_visible()
    expect(boot).to_contain_text("Can't reach the app server")
    expect(boot).to_contain_text(re.compile(r"Retrying (in \d+ s|now)\."))
    upage.unroute("**/api/state")
    upage.locator('[data-testid="boot-retry"]').click()
    wait_ready(upage)
    expect(boot).to_be_hidden()
    expect(upage.locator("#gameLabel")).not_to_have_text("")


def test_the_loading_screen_stays_up_while_the_page_opens_its_game(upage, server):
    """restructure-v2.md 9: the page opens its game once the first state is in; until POST /api/open answers the
    loading screen says "Loading the game…" (#app[data-boot="opening"]), so the game is never seen half opened."""
    base = server["base"]
    reset_game(base)
    held = []
    upage.route("**/api/open", lambda route: held.append(route))
    load(upage, base, ready=False)
    until(upage, lambda: len(held) == 1, what="the page to open its game")
    boot = upage.locator('[data-testid="boot"]')
    expect(upage.locator("#app")).to_have_attribute("data-boot", "opening")
    expect(boot).to_be_visible()
    expect(boot).to_contain_text("Loading the game…")
    held[0].continue_()
    wait_ready(upage)
    expect(boot).to_be_hidden()
    expect(upage.locator(COUNT)).to_have_text(re.compile(r"^0 / \d+$"))
    assert upage.errors == [], upage.errors


def test_119_an_old_server_gets_the_restart_screen(upage, server):
    """#119: a state without `keys` shows "Restart the server to finish the update" and the command to type."""
    base = server["base"]
    reset_game(base)
    upage.route("**/api/state", lambda r: patched_json(r, lambda b: {k: v for k, v in b.items() if k != "keys"}))
    load(upage, base, ready=False)
    boot = upage.locator('[data-testid="boot"]')
    expect(boot).to_have_attribute("data-phase", "restart", timeout=15_000)
    expect(boot).to_contain_text("Restart the server to finish the update")
    expect(boot.locator("strong")).to_have_text("bash start.sh")


# ---------------------------------------------------------------- toasts (#117, #118, #121)
def test_117_118_121_a_playback_request_that_fails_says_so_in_red(upage, server):
    """#118: the toast is one polite status line, and a new one replaces it. #121: a request that gets no answer is a
    red toast and the game stays where it was. #117: a refusal shows the server's words in red for 8 s (G5-13) and the
    page keeps the state it returned."""
    base = server["base"]
    at(upage, base, MID)
    toast = upage.locator("#toast")
    expect(toast).to_have_attribute("role", "status")
    expect(toast).to_have_attribute("aria-live", "polite")
    upage.route("**/api/watch/forward", lambda route: route.abort())
    press_right(upage)
    expect_toast(upage, NO_ANSWER, error=True)
    expect(upage.locator(COUNT)).to_have_text(re.compile(rf"^{MID} / \d+$"))
    upage.unroute("**/api/watch/forward")
    expect(upage.locator("#app")).to_have_attribute("data-conn", "online", timeout=15_000)
    refused = {**state(base), "error": REFUSED}
    upage.route("**/api/watch/forward", lambda route: route.fulfill(status=409, json=refused))
    press_right(upage)
    expect_toast(upage, REFUSED, error=True)
    expect(toast).to_have_text(REFUSED)
    upage.wait_for_timeout(ERROR_MS - 3_000)
    expect(toast).to_have_class(re.compile(r"(^|\s)show(\s|$)"))      # still up, to be read
    expect(toast).not_to_have_class(re.compile(r"(^|\s)show(\s|$)"), timeout=12_000)
    expect(toast).to_have_text(REFUSED)                                 # the words stay in the DOM once it hides
    expect(upage.locator(COUNT)).to_have_text(re.compile(rf"^{MID} / \d+$"))


def test_go_live_says_so_when_espn_cannot_be_reached(upage, server):
    """restructure-v2.md 9: Go Live answers 503 when ESPN can't be reached; the page says so in red and stays put."""
    base = server["base"]
    at(upage, base, MID)
    down = {**state(base), "error": ESPN_DOWN}
    upage.route("**/api/golive", lambda route: route.fulfill(status=503, json=down))
    upage.locator('[data-testid="transport"] [data-transport="live"]').click()
    expect_toast(upage, ESPN_DOWN, error=True)
    expect(upage.locator(COUNT)).to_have_text(re.compile(rf"^{MID} / \d+$"))
    assert js_errors(upage) == [], upage.errors          # the browser logs the 503 itself; the page throws nothing


def test_116_outside_changes_show_without_reload_or_toast(upage, server):
    """#116: a change made elsewhere (here the API) reaches the page by its poll: the count and the field move, no
    reload and no toast."""
    base = server["base"]
    at(upage, base, MID)
    loads = record_requests(upage, "/", "GET")
    seek_game(base, MID + JUMP)
    expect(upage.locator(COUNT)).to_have_text(re.compile(rf"^{MID + JUMP} / \d+$"), timeout=15_000)
    assert [r for r in loads if r["path"] == "/"] == [], "no reload"
    assert toasts_shown(upage) == [], toasts_shown(upage)


# ---------------------------------------------------------------- a phone
def test_chrome_fits_a_phone(ui_pages, server):
    """#8 for the chrome: at 390 px nothing pushes the page sideways, and the top bar, its playback and the field
    stay on screen."""
    page = ui_pages(390, 844)
    fresh(page, server["base"])
    expect(page.locator("#gameLabel")).not_to_have_text("")
    assert page.evaluate("() => document.documentElement.scrollWidth") <= 390
    for sel in ("#rg-masthead", '[data-testid="transport"]', "#field"):
        box = region_box(page, sel)                     # v1.4 (W6): a region a world lends to a fixture has no own box
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= 390 + 0.5, (sel, box)
    assert page.errors == [], page.errors

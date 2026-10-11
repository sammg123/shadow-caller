"""Keyboard and screen-reader access on Under the Lights, with motion on (G5-9, G5-2, G5-15; restructure-v2.md 2). The
other UI tests run with reduced motion; these walk the page by Tab with motion on, at Sam's laptop with and without
the browser's chrome and at the TV: every stop is on screen and is the element under its own centre (nothing covers
it), the top bar's keys come first, the ticker only reads (no stops), the settings menu takes focus when it opens and
gives it back when it closes, and axe (when a copy of axe-core is at hand) finds no violation. The top bar's keys are
whole in every window from 1280x720 up (the HUD scales with the window's height), and small windows never scroll
sideways and keep a finger's 44 px."""
import os
from pathlib import Path

import pytest
from playwright.sync_api import expect
from ui_helpers import BOOT_TIMEOUT_MS, seek_game

from helpers import ROOT

pytestmark = pytest.mark.e2e

WORLD_ID = "under-the-lights"
WALK_SIZES = [(1440, 900), (1440, 790), (1920, 1080)]
BAR_SIZES = [(1440, 900), (1440, 790), (1470, 840), (1512, 982), (1920, 1080), (1920, 950), (1366, 768), (1280, 720)]
MID = 40
MAX_STOPS = 140
TOP_BAR_STOPS = 13              # the camera, the report link, Settings, Back, Play, Forward, four speeds, the bar,
                                # Reset and Go Live
TOUCH_PX = 44
AXE_RULES = ["color-contrast", "label-content-name-mismatch", "scrollable-region-focusable", "region",
             "landmark-one-main", "aria-prohibited-attr", "aria-allowed-attr", "button-name", "label",
             "landmark-banner-is-top-level", "nested-interactive"]
BAR_KEYS = ([f'[data-transport="{k}"]' for k in ("back", "play", "forward", "reset", "live")]
            + [f'[data-testid="transport"] [data-speed="{s}"]' for s in (1, 2, 4, 10)]
            + ['[data-testid="progress"]', '[data-testid="camera-mode"]', '[data-testid="model-report"]',
               '[data-testid="settings-toggle"]'])

STOP_JS = """() => { const e = document.activeElement;
  if (!e || e === document.body) return { body: true };
  const r = e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const inView = r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight;
  const hit = inView ? document.elementFromPoint(cx, cy) : null;
  const label = hit && hit.closest ? hit.closest('label') : null;
  const mine = !!hit && (hit === e || e.contains(hit) || (!!label && label.contains(e)));
  const name = (n) => n ? `${n.tagName.toLowerCase()}#${n.id}.${String(n.className).split(' ')[0]}` : 'none';
  return { body: false, me: name(e), text: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30),
    inView, mine, hit: name(hit), bar: !!e.closest('#rg-masthead'), ticker: !!e.closest('#rg-plays') }; }"""

SETTLE_JS = """async () => {
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));   // the moves the focus set off exist
  const finite = (a) => a.effect && a.effect.getTiming().iterations !== Infinity;
  const deadline = performance.now() + 8000;             // a busy machine gives a page its frames slowly
  while (document.getAnimations().some((a) => a.playState === 'running' && finite(a)) && performance.now() < deadline) {
    await new Promise((ok) => setTimeout(ok, 40));
  } }"""


def _open(ui_pages, base, size, query="scene=2d"):
    page = ui_pages(width=size[0], height=size[1], reduced_motion=False)
    page.goto(f"{base}/?world={WORLD_ID}&{query}", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('#app[data-boot="ready"][data-layout="uls"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('[data-testid="boot"]', state="hidden", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_timeout(800)                     # the first presented state, the board's scan
    return page


def _walk(page):
    """Tab from the top of the page until focus comes round again; every stop as STOP_JS sees it, once whatever the
    focus set moving (the drive chart's unroll, the board's scan) has landed."""
    page.evaluate("() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); }")
    stops = []
    for _ in range(MAX_STOPS):
        page.keyboard.press("Tab")
        page.wait_for_timeout(30)
        page.evaluate(SETTLE_JS)
        stop = page.evaluate(STOP_JS)
        if stop["body"]:
            continue
        if len(stops) > 3 and (stop["me"], stop["text"]) == (stops[0]["me"], stops[0]["text"]):
            break                                    # round again to the first stop
        stops.append(stop)
    return stops


@pytest.mark.parametrize("size", WALK_SIZES, ids=[f"{w}x{h}" for w, h in WALK_SIZES])
def test_g5_9_every_tab_stop_is_on_screen_and_uncovered(ui_pages, server, size):
    """G5-9: a paused game 40 plays in: Tab reaches the top bar first, then the rest of the page; every stop is on
    screen and nothing covers it; the ticker has no stops (it only reads)."""
    base = server["base"]
    seek_game(base, MID)
    page = _open(ui_pages, base, size)
    stops = _walk(page)
    assert len(stops) >= TOP_BAR_STOPS, [s["me"] for s in stops]
    lead = [s for s in stops if "sc-skip" not in s["me"]][:TOP_BAR_STOPS]      # the skip link comes first
    assert all(s["bar"] for s in lead), [s["me"] for s in lead]
    bad = [f"{s['me']} '{s['text']}' (in view {s['inView']}, under its centre {s['hit']})" for s in stops
           if not (s["inView"] and s["mine"])]
    assert bad == [], "\n".join(bad)
    assert [s["me"] for s in stops if s["ticker"]] == [], "the ticker only reads"
    assert page.errors == [], page.errors


def test_g5_9_the_settings_menu_takes_focus_and_gives_it_back(ui_pages, server):
    """G5-9: Enter on Settings opens the menu with focus on its first switch; Tab moves between its switches; Escape
    closes it with focus back on Settings; a press outside closes it too."""
    base = server["base"]
    seek_game(base, MID)
    page = _open(ui_pages, base, WALK_SIZES[0])
    key = page.locator('[data-testid="settings-toggle"]')
    key.focus()
    page.keyboard.press("Enter")
    expect(page.locator("#app")).to_have_attribute("data-settings-open", "true")
    expect(page.locator("#ulsDipLive")).to_be_focused()
    page.keyboard.press("Tab")
    expect(page.locator("#ulsRoomLights")).to_be_focused()
    expect(page.locator("#app")).to_have_attribute("data-settings-open", "true")
    page.keyboard.press("Escape")
    expect(page.locator("#app")).to_have_attribute("data-settings-open", "false")
    expect(key).to_be_focused()
    key.click()
    expect(page.locator("#app")).to_have_attribute("data-settings-open", "true")
    page.mouse.click(400, 500)                       # the bowl, outside the menu
    expect(page.locator("#app")).to_have_attribute("data-settings-open", "false")
    assert page.errors == [], page.errors


def _axe_source():
    for candidate in (os.environ.get("SC_AXE_JS"), ROOT / "node_modules" / "axe-core" / "axe.min.js"):
        if candidate and Path(candidate).is_file():
            return Path(candidate).read_text()
    return None


@pytest.mark.parametrize("menu", [False, True], ids=["page", "settings"])
def test_g5_9_axe_finds_no_violation(ui_pages, server, menu):
    """G5-9, G5-12, G5-14: axe-core (SC_AXE_JS, or node_modules/axe-core) on a paused game and with the settings menu
    open: contrast, landmarks, names that contain their visible words, scrollable regions by keys."""
    source = _axe_source()
    if source is None:
        pytest.skip("axe-core isn't installed: set SC_AXE_JS to an axe.min.js to run this check")
    base = server["base"]
    seek_game(base, MID)
    page = _open(ui_pages, base, WALK_SIZES[0])
    if menu:
        page.locator('[data-testid="settings-toggle"]').click()
        page.wait_for_timeout(600)
    page.add_script_tag(content=source)
    found = page.evaluate("""async (rules) => { const r = await axe.run(document, { runOnly: { type: 'rule', values: rules },
      resultTypes: ['violations'] }); return r.violations.map(v => `${v.id}: ${v.nodes.slice(0, 4).map(n => n.target.join(' ')).join(' | ')}`); }""",
                          AXE_RULES)
    assert found == [], "\n".join(found)


@pytest.mark.parametrize("size", BAR_SIZES, ids=[f"{w}x{h}" for w, h in BAR_SIZES])
def test_g5_2_the_top_bar_is_whole_in_every_window(ui_pages, server, size):
    """G5-2: every key of the top bar is whole on screen and under its own centre at every size from 1280x720 up,
    with the settings menu shut and open."""
    base = server["base"]
    seek_game(base, MID)
    page = _open(ui_pages, base, size)
    for menu in (False, True):
        if menu:
            page.locator('[data-testid="settings-toggle"]').click()
            expect(page.locator("#app")).to_have_attribute("data-settings-open", "true")
        for sel in BAR_KEYS:
            box = page.locator(sel).first.bounding_box()
            assert box and box["x"] >= 0 and box["y"] >= 0, (sel, box)
            assert box["x"] + box["width"] <= size[0] and box["y"] + box["height"] <= size[1], (sel, box, size)
            hit = page.locator(sel).first.evaluate(
                "e => { const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2,"
                " r.top + r.height / 2); return !!h && (h === e || e.contains(h)); }")
            assert hit, f"{sel} is covered ({size}, menu open: {menu})"
        assert page.evaluate("() => document.documentElement.scrollWidth") <= size[0]
    assert page.errors == [], page.errors


@pytest.mark.parametrize("size, touch", [((390, 844), True), ((320, 640), True), ((1024, 768), False)],
                         ids=["390x844", "320x640", "1024x768"])
def test_g5_15_small_windows_never_scroll_sideways_and_keep_their_keys(browser, server, size, touch):
    """G5-15: a phone's top bar wraps (every key on screen, 44 px for a finger) and an XGA projector never scrolls
    sideways, with the settings menu shut or open."""
    base = server["base"]
    seek_game(base, MID)
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, has_touch=touch, is_mobile=touch)
    try:
        page = ctx.new_page()
        page.goto(f"{base}/?world={WORLD_ID}&scene=2d", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
        page.wait_for_selector('#app[data-boot="ready"]', state="attached", timeout=BOOT_TIMEOUT_MS)
        page.wait_for_selector('[data-testid="boot"]', state="hidden", timeout=BOOT_TIMEOUT_MS)
        for state in ("shut", "open"):
            if state == "open":
                page.locator('[data-testid="settings-toggle"]').click()
                expect(page.locator("#app")).to_have_attribute("data-settings-open", "true")
            assert page.evaluate("() => document.documentElement.scrollWidth") <= size[0], state
        for sel in BAR_KEYS:
            box = page.locator(sel).first.bounding_box()
            assert box and box["x"] >= 0 and box["x"] + box["width"] <= size[0], (sel, box)
            if touch:
                assert box["height"] >= TOUCH_PX, (sel, box)
    finally:
        ctx.close()

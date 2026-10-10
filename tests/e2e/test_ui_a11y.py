"""Keyboard and screen-reader access on Under the Lights, with motion on (G5-9, G5-2). The other UI tests run with
reduced motion at three sizes; these walk the page by Tab with motion on, at Sam's laptop with and without the
browser's chrome and at the TV: every stop is on screen and is the element under its own centre (nothing covers
it, a pinned entry line included), the ribbons unroll for the keyboard and stay unrolled while Tab walks their
rows, and axe (when a copy of axe-core is at hand) finds no violation. The desk keeps its entry line, Log play and
key rows, or the retag keys, whole in every window from 1280x720 up (G5-2)."""
import os
from pathlib import Path

import pytest
from playwright.sync_api import expect
from ui_helpers import BOOT_TIMEOUT_MS, EVENT, api_post, command, feed_on_server, reset_game, stop_watch

from helpers import ROOT

pytestmark = pytest.mark.e2e

WORLD_ID = "under-the-lights"
WALK_SIZES = [(1440, 900), (1440, 790), (1920, 1080)]
DESK_SIZES = [(1440, 900), (1440, 790), (1470, 840), (1920, 1080), (1920, 950), (1366, 768), (1280, 720)]
TV_CLASS = 1700                  # at TV widths the desk holds one key row whole; the second scrolls in, never a sliver
MAX_STOPS = 140
AXE_RULES = ["color-contrast", "label-content-name-mismatch", "scrollable-region-focusable", "region",
             "landmark-one-main", "aria-prohibited-attr", "aria-allowed-attr", "button-name", "label",
             "landmark-banner-is-top-level", "nested-interactive"]

STOP_JS = """() => { const e = document.activeElement;
  if (!e || e === document.body) return { body: true };
  const r = e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const inView = r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight;
  const hit = inView ? document.elementFromPoint(cx, cy) : null;
  const label = hit && hit.closest ? hit.closest('label') : null;
  const mine = !!hit && (hit === e || e.contains(hit) || (!!label && label.contains(e)));
  const name = (n) => n ? `${n.tagName.toLowerCase()}#${n.id}.${String(n.className).split(' ')[0]}` : 'none';
  return { body: false, me: name(e), text: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30),
    inView, mine, hit: name(hit), key: e.id || e.dataset.seq || e.dataset.watch || e.dataset.k || name(e) + r.left }; }"""

DESK_JS = """() => { const desk = document.querySelector('.uls-desk'); const d = desk.getBoundingClientRect();
  const whole = (n) => { if (!n || !n.offsetParent && getComputedStyle(n).position !== 'fixed') return 'gone';
    const r = n.getBoundingClientRect(); if (n.dataset.cut === 'true') return 'cut';
    return r.top >= d.top - 1 && r.bottom <= d.bottom + 2 && r.height > 0 ? 'whole' : `partial ${Math.round(r.top)}-${Math.round(r.bottom)} in ${Math.round(d.top)}-${Math.round(d.bottom)}`; };
  return { line: whole(document.querySelector('.uls-desk .sc-entry-line')), log: whole(document.querySelector('#logBtn')),
    rows: [...document.querySelectorAll('.uls-desk .sc-keyrow')].map(whole),
    retag: whole(document.querySelector('#lastPlay .sc-retag')) }; }"""


def _open(ui_pages, base, size, query="scene=2d"):
    page = ui_pages(width=size[0], height=size[1], reduced_motion=False)
    page.goto(f"{base}/?world={WORLD_ID}&{query}", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('#app[data-boot="ready"][data-layout="uls"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_timeout(800)                     # the first presented state, the board's scan
    return page


def _manual_drive_with_plays(base):
    reset_game(base)
    for line in ("new D25", "K 3", "P 6", "J 2"):
        command(base, line)


SETTLE_JS = """async () => {
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));   // the moves the focus set off exist
  const finite = (a) => a.effect && a.effect.getTiming().iterations !== Infinity;
  const deadline = performance.now() + 8000;             // a busy machine gives a page its frames slowly
  while (document.getAnimations().some((a) => a.playState === 'running' && finite(a)) && performance.now() < deadline) {
    await new Promise((ok) => setTimeout(ok, 40));
  } }"""


def _walk(page):
    """Tab from the top of the page until focus comes round again; every stop as STOP_JS sees it, once whatever the
    focus set moving (a ribbon's scan, the board growing, the drawer's rails) has landed."""
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
    """G5-9: a manual drive with three plays: Tab reaches the plays (the ribbon unrolls and stays unrolled from row to
    row), the masthead, the strip, the desk and the lower ribbon; every stop is on screen and nothing covers it."""
    base = server["base"]
    _manual_drive_with_plays(base)
    page = _open(ui_pages, base, size)
    stops = _walk(page)
    assert len(stops) >= 30, [s["me"] for s in stops]
    bad = [f"{s['me']} '{s['text']}' (in view {s['inView']}, under its centre {s['hit']})" for s in stops
           if not (s["inView"] and s["mine"])]
    assert bad == [], "\n".join(bad)
    rows = [s for s in stops if s["me"].startswith("button#.sc-pf-btn")]
    assert len(rows) == 3, "every play is a Tab stop, the older ones too (the ribbon unrolls for them)"
    assert page.errors == [], page.errors


def test_g5_9_escape_rolls_the_feed_up_and_g_b_move_focus_in_and_back(ui_pages, server):
    """G5-9: Escape on an unrolled feed rolls it up with focus on the play it shows; B moves focus into the drawer and
    gives it back on close (B or Escape); G moves it to the stat board, a named region, and back."""
    base = server["base"]
    _manual_drive_with_plays(base)
    page = _open(ui_pages, base, WALK_SIZES[0])
    first = page.locator('#rg-plays [data-newest="true"] .sc-pf-btn')
    first.focus()
    page.keyboard.press("Tab")
    expect(page.locator("#rg-plays")).to_have_attribute("data-open", "true")
    page.keyboard.press("Escape")
    expect(page.locator("#rg-plays")).not_to_have_attribute("data-open", "true")
    expect(first).to_be_focused()
    page.locator("#yards").focus()
    page.keyboard.press("b")
    expect(page.locator("#app")).to_have_attribute("data-booth-open", "true")
    expect(page.locator("#feedBtn")).to_be_focused()
    page.keyboard.press("Escape")
    expect(page.locator("#app")).to_have_attribute("data-booth-open", "false")
    expect(page.locator("#yards")).to_be_focused()
    page.keyboard.press("g")
    board = page.locator(".uls-statboard")
    expect(board).to_be_focused()
    expect(board).to_have_attribute("role", "region")
    page.keyboard.press("PageDown")                 # the stat board scrolls by keys (axe scrollable-region-focusable)
    page.keyboard.press("g")
    expect(page.locator("#yards")).to_be_focused()


def _axe_source():
    for candidate in (os.environ.get("SC_AXE_JS"), ROOT / "node_modules" / "axe-core" / "axe.min.js"):
        if candidate and Path(candidate).is_file():
            return Path(candidate).read_text()
    return None


@pytest.mark.parametrize("keys", ["", "b", "g"], ids=["page", "drawer", "statboard"])
def test_g5_9_axe_finds_no_violation(ui_pages, server, keys):
    """G5-9, G5-12, G5-14: axe-core (SC_AXE_JS, or node_modules/axe-core) on a manual drive, the open drawer and the
    open stat board: contrast, landmarks, names that contain their visible words, scrollable regions by keys."""
    source = _axe_source()
    if source is None:
        pytest.skip("axe-core isn't installed: set SC_AXE_JS to an axe.min.js to run this check")
    base = server["base"]
    _manual_drive_with_plays(base)
    page = _open(ui_pages, base, WALK_SIZES[0])
    for key in keys:
        page.keyboard.press(key)
        page.wait_for_timeout(600)
    page.add_script_tag(content=source)
    found = page.evaluate("""async (rules) => { const r = await axe.run(document, { runOnly: { type: 'rule', values: rules },
      resultTypes: ['violations'] }); return r.violations.map(v => `${v.id}: ${v.nodes.slice(0, 4).map(n => n.target.join(' ')).join(' | ')}`); }""",
                          AXE_RULES)
    assert found == [], "\n".join(found)


@pytest.mark.parametrize("size", DESK_SIZES, ids=[f"{w}x{h}" for w, h in DESK_SIZES])
def test_g5_2_the_manual_desk_fits_the_window(ui_pages, server, size):
    """G5-2: in a drive the desk shows its entry line, Log play and its key rows whole at every size from 1280x720 up
    (the HUD scales with the window's height); at TV widths the second row scrolls in whole, never as a sliver."""
    base = server["base"]
    reset_game(base)
    command(base, "new D25")
    page = _open(ui_pages, base, size)
    desk = page.evaluate(DESK_JS)
    assert (desk["line"], desk["log"]) == ("whole", "whole"), desk
    assert desk["rows"][:2] == ["whole", "whole"], desk
    want = {"whole", "cut"} if size[0] >= TV_CLASS else {"whole"}
    assert set(desk["rows"]) <= want, desk


@pytest.fixture(scope="module")
def feed_server(tmp_path_factory):
    """A sandbox of its own: the ESPN feed remembers the plays it applied (feed_seen) across a reset, and a later
    test's "fresh" game on the shared server would inherit that."""
    from ui_helpers import sandbox
    with sandbox(tmp_path_factory, {}) as srv:
        feed_on_server(srv["base"])
        yield srv


@pytest.mark.parametrize("size", [(1440, 790), (1920, 950), (1280, 720)], ids=["1440x790", "1920x950", "1280x720"])
def test_g5_2_the_feed_desk_keeps_its_retag_keys(ui_pages, feed_server, size):
    """G5-2: with the ESPN feed on, the last play's retag keys are whole on the desk in a short window."""
    page = _open(ui_pages, feed_server["base"], size)
    expect(page.locator("#lastPlay .sc-retag")).to_be_visible()
    assert page.evaluate(DESK_JS)["retag"] == "whole"


@pytest.fixture
def wsrv(watch_server):
    yield watch_server
    stop_watch(watch_server["base"])


@pytest.mark.parametrize("size", [(1440, 790), (1280, 720)], ids=["1440x790", "1280x720"])
def test_g5_2_the_watch_desk_keeps_the_transport_and_retag_keys(ui_pages, wsrv, size):
    """G5-2: during Watch this game the transport and the retag keys are on screen in a short window."""
    base = wsrv["base"]
    reset_game(base)
    api_post(base, "/api/watch/start", {"event_id": EVENT, "speed": 10, "from_seq": 0})
    page = _open(ui_pages, base, size)
    expect(page.locator('[data-testid="watch"] [data-watch="pause"]')).to_be_visible()
    page.wait_for_selector("#lastPlay[data-kind='play']", state="attached", timeout=20_000)
    assert page.evaluate(DESK_JS)["retag"] == "whole"
    for sel in ('[data-testid="watch"] [data-watch="pause"]', '[data-testid="watch"] [data-watch="stop"]'):
        box = page.locator(sel).bounding_box()
        assert box and box["y"] >= 0 and box["y"] + box["height"] <= size[1], (sel, box)


@pytest.mark.parametrize("size, touch", [((390, 844), True), ((320, 640), True), ((1024, 768), False)],
                         ids=["390x844", "320x640", "1024x768"])
def test_g5_15_small_windows_never_scroll_sideways_and_keep_b_and_g(browser, server, size, touch):
    """G5-15: a phone's masthead keys wrap (V, B and G on screen, 44 px for a finger) and an XGA projector never
    scrolls sideways, with the stat board shut or open."""
    base = server["base"]
    _manual_drive_with_plays(base)                 # a drive's band is the widest: DOWN and BALL ON both lit
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, has_touch=touch, is_mobile=touch)
    try:
        page = ctx.new_page()
        page.goto(f"{base}/?world={WORLD_ID}&scene=2d", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
        page.wait_for_selector('#app[data-boot="ready"]', state="attached", timeout=BOOT_TIMEOUT_MS)
        for state in ("shut", "open"):
            if state == "open":
                page.locator('[data-testid="scorecard-toggle"]').click()
                expect(page.locator("#app")).to_have_attribute("data-scorecard-open", "true")
            assert page.evaluate("() => document.documentElement.scrollWidth") <= size[0], state
        for testid in ("booth-toggle", "scorecard-toggle", "camera-mode"):
            box = page.locator(f'[data-testid="{testid}"]').bounding_box()
            assert box and box["x"] >= 0 and box["x"] + box["width"] <= size[0], (testid, box)
            if touch:
                assert box["height"] >= 44, (testid, box)
    finally:
        ctx.close()

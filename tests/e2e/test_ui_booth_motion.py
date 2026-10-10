"""The control-room drawer with motion on (G5-1), on Under the Lights. Every other UI test runs with reduced motion,
where the drawer's rails never run; these run them. A drawer that keeps a translate after its run becomes the
containing block of the position: fixed scorer's strip it holds in manual entry: the strip left the ribbon for the
drawer (0,44 1440x52 -> 0,140 398x52), its fields overprinted and it covered the FEED rack's ESPN live key, so a
click on that key timed out. Here, in manual entry (no drive, a drive, the final) and in flag mode at 1440x900 and
1920x1080: the strip keeps its closed-drawer box while the drawer runs out and after, and the drawer's keys are the
elements under their own centers."""
import pytest
from playwright.sync_api import expect
from ui_helpers import BOOT_TIMEOUT_MS, command, ensure_finished, reset_game

pytestmark = pytest.mark.e2e

WORLD_ID = "under-the-lights"
SIZES = [(1440, 900), (1920, 1080)]
RUN_SAMPLES_MS = (0, 60, 120, 180)      # inside the 240 ms run (--uls-rail-ms)
BOX_SLACK_PX = 0.5

HIT_JS = """sel => { const t = document.querySelector(sel); if (!t) return "missing";
  const r = t.getBoundingClientRect(); if (!r.width || !r.height) return "no box";
  const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return e && (e === t || t.contains(e)) ? "hit" : (e ? `${e.tagName.toLowerCase()}#${e.id}.${e.className}` : "nothing"); }"""


# The drawer's run lands when its rails' animations finish: on a busy machine a page's frames come slowly and an
# animation waits for one to start, so the run is awaited for real, not for a fixed time.
LANDED_JS = """async (sel) => { const d = document.querySelector(sel);
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  const deadline = performance.now() + 15000;
  while (d.getAnimations({ subtree: true }).some((a) => a.playState !== 'finished' && a.effect
    && a.effect.getTiming().iterations !== Infinity) && performance.now() < deadline) {
    await new Promise((ok) => setTimeout(ok, 50));
  }
  return d.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length; }"""


def _open_page(ui_pages, base, size):
    page = ui_pages(width=size[0], height=size[1], reduced_motion=False)
    # the 2D field: this is about the HUD's drawer, and the 3D scene in SwiftShader starves the page of frames
    page.goto(f"{base}/?world={WORLD_ID}&scene=2d", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('#app[data-boot="ready"][data-layout="uls"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    expect(page.locator("#iQtr")).to_be_visible()
    return page


def _box(page, sel):
    b = page.locator(sel).bounding_box()
    return None if b is None else tuple(round(b[k], 1) for k in ("x", "y", "width", "height"))


def _same(a, b):
    return a is not None and b is not None and all(abs(x - y) <= BOX_SLACK_PX for x, y in zip(a, b))


def _open_and_watch_strip(page, key, mode):
    """Press `key` (B or X), sample the strip's box through the drawer's run, wait for the run to land."""
    closed = _box(page, "#rg-situation")
    assert closed and closed[1] > 0 and closed[2] > 1000, f"the strip under the ribbon: {closed}"
    page.keyboard.press(key)
    page.wait_for_selector(f'#app[data-booth-open="true"][data-mode="{mode}"]', state="attached")
    seen = []
    for at in RUN_SAMPLES_MS:
        if at:
            page.wait_for_timeout(at - seen[-1][0])
        seen.append((at, _box(page, "#rg-situation")))
    assert page.evaluate(LANDED_JS, ".uls-drawer") == 0, "the drawer's rails never landed"
    seen.append(("landed", _box(page, "#rg-situation")))
    moved = [(at, box) for at, box in seen if not _same(box, closed)]
    assert moved == [], f"the strip left the ribbon while the drawer ran out: closed {closed}, then {moved}"
    assert page.locator(".uls-drawer").evaluate("d => getComputedStyle(d).translate") in ("none", "0px")


def _expect_hit(page, sel):
    expect(page.locator(sel)).to_be_visible()
    assert page.evaluate(HIT_JS, sel) == "hit", f"{sel} is covered by {page.evaluate(HIT_JS, sel)}"


MANUAL_STATES = {
    "idle": lambda base: reset_game(base),
    "drive": lambda base: (reset_game(base), command(base, "new D25")),
    "final": lambda base: ensure_finished(base),
}


@pytest.mark.parametrize("size", SIZES, ids=[f"{w}x{h}" for w, h in SIZES])
@pytest.mark.parametrize("state_name", list(MANUAL_STATES))
def test_g5_1_b_in_manual_entry_keeps_the_strip_under_the_ribbon(ui_pages, server, state_name, size):
    """G5-1: B in manual entry runs the drawer out while the strip stays put, and the FEED rack's keys take clicks."""
    base = server["base"]
    MANUAL_STATES[state_name](base)
    page = _open_page(ui_pages, base, size)
    _open_and_watch_strip(page, "b", "normal")
    for sel in ("#feedBtn", "#replayBtn", "#feedEvent", "#iYard", "#iQtr"):
        _expect_hit(page, sel)
    page.locator("#feedBtn").click(trial=True, timeout=15_000)   # actionable: nothing intercepts its pointer events
    assert page.errors == [], page.errors


@pytest.mark.parametrize("size", SIZES, ids=[f"{w}x{h}" for w, h in SIZES])
def test_g5_1_x_flag_mode_keeps_the_strip_under_the_ribbon(ui_pages, server, size):
    """G5-1: X in a drive opens the drawer to FLAGS (flag mode); the strip stays put and the foul keys take clicks."""
    base = server["base"]
    reset_game(base)
    command(base, "new D25")
    page = _open_page(ui_pages, base, size)
    _open_and_watch_strip(page, "x", "flag")
    expect(page.locator("#flagPanel")).to_be_visible()
    first_foul = "#flagPanel [data-pen]"
    page.locator(first_foul).first.evaluate("e => e.setAttribute('data-g51', 'first')")
    for sel in ('[data-g51="first"]', "#flagClose", "#iYard"):
        _expect_hit(page, sel)
    page.keyboard.press("Escape")
    page.wait_for_selector('#app[data-booth-open="false"][data-mode="normal"]', state="attached")
    assert page.errors == [], page.errors

"""A lost WebGL context recovers to 3D (G2-4; ui-architecture 6.1 "Context loss", 6.2).

An HDMI hot-plug, sleep and wake or GPU memory pressure can take the WebGL context away mid-game: on demo day that is
the TV. It is not a bug, so it never raises "Something went wrong": the 2D field holds the game while the context is
gone (with a toast saying so), and once the browser restores the context a fresh 3D field takes over again, drawn from
the same game, with the same call on it. Driven with WEBGL_lose_context: loseContext(), then restoreContext().

It runs on the GPU (Chromium's new headless mode, as the goldens do): the context Sam can lose is a GPU's, and a fresh
field compiles its shaders in parallel there (KHR_parallel_shader_compile). Without a GPU the test is skipped with the
reason. Runs on WORLD (ui_helpers; SC_E2E_WORLD=under-the-lights for Sam's world)."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import ACTION_TIMEOUT_MS, BOOT_TIMEOUT_MS, TOAST_LOG_JS, expect_toast, state, with_drive

pytestmark = pytest.mark.e2e

ANY = re.compile(".*")         # not_to_have_attribute(name, ANY): the attribute is absent
LOSE_JS = """() => {
  const canvas = document.querySelector('#field canvas[data-testid="field-canvas"]');
  const gl = canvas.getContext('webgl2');
  window.__lose = gl.getExtension('WEBGL_lose_context');
  window.__lose.loseContext();
  return true;
}"""
RESTORE_JS = "() => { window.__lose.restoreContext(); return true; }"
BUGS = '[data-testid="notices"] [data-notice^="bug:"]'
CANVAS = 'canvas[data-testid="field-canvas"]'
SVG = 'svg[data-testid="field-svg"]'
CYCLES = 2                     # lose and restore twice: the restored field can pause and come back again


@pytest.fixture(scope="module")
def gpu_browser(browser):
    """Chromium's new headless mode on the real GPU (the e2e `browser` renders with SwiftShader)."""
    try:
        b = browser.browser_type.launch(channel="chromium")
    except Exception as err:                            # no new-headless Chromium here
        pytest.skip(f"a lost GPU context needs a GPU; Chromium's new headless mode didn't start ({err})")
    yield b
    b.close()


@pytest.fixture
def gpu_page(gpu_browser):
    ctx = gpu_browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    ctx.set_default_timeout(ACTION_TIMEOUT_MS)
    ctx.add_init_script(script=TOAST_LOG_JS)
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: page.errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    yield page
    ctx.close()


def test_a_lost_context_holds_the_game_in_2d_then_comes_back_to_3d(gpu_page, server):
    """G2-4: lose the context, the 2D field shows the drive with his top 2 and a toast (no bug notice); restore it, the
    3D field is back, ready, with the same shadows, and nothing is left of the 2D field or its error. Twice."""
    base = server["base"]
    page = gpu_page
    with_drive(page, base)
    field = page.locator("#field")
    expect(field).to_have_attribute("data-scene", "webgl")
    expect(field).to_have_attribute("data-scene-ready", "true", timeout=BOOT_TIMEOUT_MS)
    if page.evaluate("window.__shadowDebug ? window.__shadowDebug().tier : null") == "low":
        pytest.skip("this browser has no GPU (tier low)")
    top2 = " ".join(t["key"] for t in state(base)["prediction"]["top"][:2])
    expect(field).to_have_attribute("data-ghosts", top2)
    for _ in range(CYCLES):
        page.evaluate(LOSE_JS)
        expect(field).to_have_attribute("data-scene", "2d")
        expect(page.locator("html")).to_have_attribute("data-scene", "2d")
        expect(field.locator(SVG)).to_have_count(1)
        expect(field.locator(CANVAS)).to_have_count(0)
        expect(field).to_have_attribute("data-ghosts", top2)
        expect_toast(page, re.compile(r"^The 3D field paused"))
        expect(page.locator(BUGS)).to_have_count(0)

        page.evaluate(RESTORE_JS)
        expect(field).to_have_attribute("data-scene", "webgl", timeout=BOOT_TIMEOUT_MS)
        expect(page.locator("html")).to_have_attribute("data-scene", "webgl")
        expect(field).to_have_attribute("data-scene-ready", "true", timeout=BOOT_TIMEOUT_MS)
        expect(field.locator(CANVAS)).to_have_count(1)
        expect(field.locator(SVG)).to_have_count(0)
        expect(field).not_to_have_attribute("data-scene-error", ANY)
        expect(field).to_have_attribute("data-ghosts", top2)
        expect_toast(page, "The 3D field is back.")
    expect(page.locator(BUGS)).to_have_count(0)
    expect(page.locator('[data-testid="notices"] > *')).to_have_count(0)
    assert page.errors == [], page.errors

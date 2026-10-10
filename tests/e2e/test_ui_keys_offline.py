"""New features (ui-architecture 4.3, 3.9, 6.1, 6.2, 7.2): the shared keys V, B, G, Space and digits outside a watch;
the connection banner (G11); render on demand, the draw budget, no leak across rebuilds; the 2D fallback after a lost
WebGL context."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (EVENT, TOTAL_ROWS, api_post, blur, ensure_finished, finished, fresh, load, quiet,
                        record_requests, reset_game, command, until, version, wait_idle, with_drive)
from ui_helpers import CAMERAS  # v1.4 (W6): world-aware helpers

pytestmark = pytest.mark.e2e

NEUTRAL_CAMERAS = CAMERAS      # v1.4 (W6): the world's modes in V order (NEUTRAL_LOOK's on neutral)
DRAW_CALL_BUDGET = 150          # 6.1
TRIANGLE_BUDGET = 300_000       # 6.1
LEAK_SLACK = 2                  # 6.1: geometries and textures within +2 across a rebuild


def test_v_cycles_the_camera_modes(upage, server):
    """4.3: V cycles the look's camera modes in order and wraps; #field and the camera control both say which."""
    with_drive(upage, server["base"])
    control = upage.locator('[data-testid="camera-mode"]')
    for i in range(len(NEUTRAL_CAMERAS) + 1):
        mode, label = NEUTRAL_CAMERAS[i % len(NEUTRAL_CAMERAS)]
        expect(upage.locator("#field")).to_have_attribute("data-camera", mode)
        expect(control).to_have_attribute("data-camera", mode)
        expect(control).to_contain_text(label)
        blur(upage)
        upage.keyboard.press("v")


def test_b_toggles_the_booth(upage, server):
    """4.3: B toggles the booth: [data-testid="booth-toggle"] aria-expanded and #app[data-booth-open]."""
    with_drive(upage, server["base"])
    toggle = upage.locator('[data-testid="booth-toggle"]')
    expect(toggle).to_have_attribute("aria-expanded", "false")
    for open_ in ("true", "false"):
        blur(upage)
        upage.keyboard.press("b")
        expect(toggle).to_have_attribute("aria-expanded", open_)
        expect(upage.locator("#app")).to_have_attribute("data-booth-open", open_)


def test_g_toggles_the_scorecard_and_escape_closes_it(upage, server):
    """4.3: G toggles the full scorecard; Escape closes it first (4.4 Escape layering) and keeps the pick."""
    with_drive(upage, server["base"])
    toggle = upage.locator('[data-testid="scorecard-toggle"]')
    expect(toggle).to_have_attribute("aria-expanded", "false")
    upage.keyboard.press("p")
    blur(upage)
    upage.keyboard.press("g")
    expect(toggle).to_have_attribute("aria-expanded", "true")
    expect(upage.locator("#app")).to_have_attribute("data-scorecard-open", "true")
    upage.keyboard.press("Escape")
    expect(toggle).to_have_attribute("aria-expanded", "false")
    expect(upage.locator("#app")).to_have_attribute("data-scorecard-open", "false")
    expect(upage.locator("#chosen")).to_contain_text("Short (0–9 air yds)")
    upage.keyboard.press("g")
    expect(toggle).to_have_attribute("aria-expanded", "true")
    upage.keyboard.press("g")
    expect(toggle).to_have_attribute("aria-expanded", "false")


def test_digits_in_yards_stay_digits_outside_a_watch(upage, server):
    """4.4: with no watch session, digits typed in Yards stay digits and never post a speed."""
    with_drive(upage, server["base"])
    speeds = record_requests(upage, "/api/watch/", "POST")
    upage.keyboard.press("k")
    upage.keyboard.type("1234")
    expect(upage.locator("#yards")).to_have_value("1234")
    blur(upage)
    upage.keyboard.press("2")
    quiet(upage)
    assert speeds == []


def test_space_on_a_focused_button_clicks_it(upage, server):
    """4.4: a focused button gets its native Space (no watch session): Space on Undo sends /api/undo."""
    fresh(upage, server["base"])
    undos = record_requests(upage, "/api/undo")
    upage.locator("#undoBtn").focus()
    upage.keyboard.press("Space")
    until(upage, lambda: len(undos) == 1, what="Space to click Undo")


def test_connection_banner_retrying_offline_then_online(upage, server):
    """3.9, G11: failed /api/version polls give retrying, then offline with Retry now; the last state stays on
    screen; the next success clears it."""
    base = server["base"]
    fresh(upage, base)
    label = upage.locator("#gameLabel").inner_text()
    upage.route("**/api/version", lambda route: route.abort())
    app = upage.locator("#app")
    expect(app).to_have_attribute("data-conn", "retrying")
    banner = upage.locator('[data-testid="conn"]')
    expect(banner).to_contain_text("Reconnecting…")
    expect(app).to_have_attribute("data-conn", "offline", timeout=10_000)
    expect(banner).to_have_attribute("data-conn", "offline")
    expect(banner).to_contain_text(re.compile(r"Can't reach the app server\. Retrying (in \d+ s|now)\."))
    retry = upage.locator('[data-testid="conn-retry"]')
    expect(retry).to_have_text("Retry now")
    expect(upage.locator("#gameLabel")).to_have_text(label)
    upage.unroute("**/api/version")
    retry.click()
    expect(app).to_have_attribute("data-conn", "online")
    expect(banner).not_to_contain_text("Can't reach")


def debug_state(page):
    return page.evaluate("() => window.__shadowDebug ? window.__shadowDebug() : null")


def test_render_on_demand_idle_frames_stay_flat(upage, server):
    """6.1: with nothing changing, #field[data-frames] does not move over 2 s."""
    with_drive(upage, server["base"])
    expect(upage.locator("#field")).to_have_attribute("data-scene-ready", "true", timeout=15_000)
    wait_idle(upage)
    upage.wait_for_timeout(500)
    before = upage.locator("#field").get_attribute("data-frames")
    assert before is not None and int(before) >= 1, f"#field[data-frames] is {before!r}"
    upage.wait_for_timeout(2000)
    assert upage.locator("#field").get_attribute("data-frames") == before


def test_draw_budget_with_ghosts_and_a_whole_game(upage, server):
    """6.1 with ?debug=1: draw calls at most 150 and triangles at most 300k, with a drive's ghosts after a whole game's
    residue."""
    base = server["base"]
    ensure_finished(base)
    command(base, "new D25")
    load(upage, base, "debug=1")
    wait_idle(upage, TOTAL_ROWS)
    expect(upage.locator("#field")).to_have_attribute("data-ghosts", re.compile(r"\S"))
    upage.wait_for_timeout(500)
    dbg = debug_state(upage)
    assert dbg and dbg["kind"] == "webgl", dbg
    assert dbg["drawCalls"] <= DRAW_CALL_BUDGET, dbg
    assert dbg["triangles"] <= TRIANGLE_BUDGET, dbg


def test_no_geometry_or_texture_leak_across_a_rebuild(upage, server):
    """6.1 leak check: a whole game drawn, then a new epoch (another replay) drawn again: geometries and textures
    within +2 of the first."""
    base = server["base"]
    finished(upage, base, "debug=1")
    wait_idle(upage, TOTAL_ROWS)
    upage.wait_for_timeout(500)
    first = debug_state(upage)
    epoch = version(base)["epoch"]
    api_post(base, "/api/feed/replay", {"event_id": EVENT})
    expect(upage.locator("#field")).not_to_have_attribute("data-epoch", epoch, timeout=30_000)
    wait_idle(upage, TOTAL_ROWS, timeout=30_000)
    upage.wait_for_timeout(500)
    second = debug_state(upage)
    assert second["geometries"] <= first["geometries"] + LEAK_SLACK, (first, second)
    assert second["textures"] <= first["textures"] + LEAK_SLACK, (first, second)


def test_lost_webgl_context_falls_back_to_the_2d_field(upage, server):
    """6.2: a lost WebGL context swaps in the 2D fallback (data-scene 2d, data-scene-error, the SVG) and the same
    hooks keep reporting the situation."""
    base = server["base"]
    reset_game(base)
    command(base, "new D25")
    load(upage, base)
    f = upage.locator("#field")
    expect(f).to_have_attribute("data-scene", "webgl")
    expect(f).to_have_attribute("data-scene-ready", "true", timeout=15_000)
    lost = upage.locator('#field canvas[data-testid="field-canvas"]').evaluate(
        "c => { const gl = c.getContext('webgl2'); const ext = gl && gl.getExtension('WEBGL_lose_context');"
        " if (!ext) return false; ext.loseContext(); return true; }")
    assert lost, "WEBGL_lose_context is not available in this browser"
    expect(f).to_have_attribute("data-scene", "2d", timeout=10_000)
    expect(f).to_have_attribute("data-scene-error", re.compile(r"\S"))
    expect(f.locator('svg[data-testid="field-svg"]')).to_have_count(1)
    expect(f).to_have_attribute("data-los", "75")
    expect(f).to_have_attribute("data-ltg", "65")

"""The keys and the offline behaviours (ui-architecture 4.3, 6.1, 6.2, 7.2; restructure-v2.md 2): the old entry, booth
and scorecard keys do nothing now; 1 to 4 set the speed; a focused key takes its own Space; render on demand, the draw
budget and no leak across a rebuild; the 2D fallback after a lost WebGL context (the connection banner is
test_ui_chrome.py's). The saved game is watched to a moment first (the page's open on load leaves a session where it
is)."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (TOTAL_ROWS, api_get, blur, finished, full_timeline, load, quiet, record_requests, seek_game,
                        until, version, wait_idle)

pytestmark = pytest.mark.e2e

DRAW_CALL_BUDGET = 150          # 6.1
TRIANGLE_BUDGET = 300_000       # 6.1
LEAK_SLACK = 2                  # 6.1: geometries and textures within +2 across a rebuild
PRESNAP_IDX = 1                 # the kickoff applied: Dallas's first snap, 1st & 10 at DAL 30, is next
OLD_KEYS = ("b", "g", "x", "u", "k", "p", "j", "e", "Enter", "Backspace")
SPEED_KEYS = {"1": 1, "2": 2, "3": 4, "4": 10}


def at(page, base, idx, query=""):
    seek_game(base, idx)
    load(page, base, query)


def test_the_old_keys_do_nothing_now(upage, server):
    """restructure-v2.md 1 and 2: B, G, X, U and the entry keys open nothing and send nothing."""
    base = server["base"]
    at(upage, base, PRESNAP_IDX)
    sent = record_requests(upage, "/api/", "POST")
    blur(upage)
    for k in OLD_KEYS:
        upage.keyboard.press(k)
    quiet(upage)
    assert sent == [], sent
    app = upage.locator("#app")
    for attr in ("data-booth-open", "data-scorecard-open", "data-review"):
        assert app.get_attribute(attr) is None, attr
    assert api_get(base, "/api/watch")["idx"] == PRESNAP_IDX
    assert upage.errors == [], upage.errors


def test_digits_set_the_speed(upage, server):
    """1 to 4 are 1x, 2x, 4x and 10x: the key shows pressed and the server plays at that speed."""
    base = server["base"]
    at(upage, base, PRESNAP_IDX)
    speeds = record_requests(upage, "/api/watch/speed")
    blur(upage)
    for key, speed in SPEED_KEYS.items():
        upage.keyboard.press(key)
        expect(upage.locator(f'[data-testid="transport"] [data-speed="{speed}"]')).to_have_attribute(
            "aria-pressed", "true")
        until(upage, lambda s=speed: api_get(base, "/api/watch")["speed"] == s, what=f"the server at {speed}x")
    assert [r["body"] for r in speeds] == [{"speed": s} for s in SPEED_KEYS.values()], speeds


def test_space_on_a_focused_key_clicks_it(upage, server):
    """4.4: a focused key gets its native Space: Space on Forward runs one play on and never plays the game."""
    base = server["base"]
    at(upage, base, PRESNAP_IDX)
    sent = record_requests(upage, "/api/watch/")
    upage.locator('[data-transport="forward"]').focus()
    upage.keyboard.press("Space")
    until(upage, lambda: len(sent) == 1, what="Space to click Forward")
    quiet(upage)
    assert [r["path"] for r in sent] == ["/api/watch/forward"], sent
    assert api_get(base, "/api/watch")["state"] == "paused"


def debug_state(page):
    return page.evaluate("() => window.__shadowDebug ? window.__shadowDebug() : null")


def test_render_on_demand_idle_frames_stay_flat(upage, server):
    """6.1: with nothing changing, #field[data-frames] does not move over 2 s."""
    at(upage, server["base"], PRESNAP_IDX)
    expect(upage.locator("#field")).to_have_attribute("data-scene-ready", "true", timeout=15_000)
    wait_idle(upage, PRESNAP_IDX)
    upage.wait_for_timeout(500)
    before = upage.locator("#field").get_attribute("data-frames")
    assert before is not None and int(before) >= 1, f"#field[data-frames] is {before!r}"
    upage.wait_for_timeout(2000)
    assert upage.locator("#field").get_attribute("data-frames") == before


def last_dallas_presnap(base):
    """The play count before Dallas's last snap of the game: the most residue with his top 2 up."""
    finished_rows = full_timeline(base)["rows"]
    last = max(r["seq"] for r in finished_rows if r["offense_is_caller"] and r["kind"] == "play")
    return last - 1


def test_draw_budget_with_ghosts_and_a_whole_game(upage, server):
    """6.1 with ?debug=1: draw calls at most 150 and triangles at most 300k, with his top 2 up after nearly a whole
    game's residue."""
    base = server["base"]
    finished(upage, base)
    idx = last_dallas_presnap(base)
    at(upage, base, idx, "debug=1")
    wait_idle(upage, idx)
    expect(upage.locator("#field")).to_have_attribute("data-ghosts", re.compile(r"\S"))
    upage.wait_for_timeout(500)
    dbg = debug_state(upage)
    assert dbg and dbg["kind"] == "webgl", dbg
    assert dbg["drawCalls"] <= DRAW_CALL_BUDGET, dbg
    assert dbg["triangles"] <= TRIANGLE_BUDGET, dbg


def test_no_geometry_or_texture_leak_across_a_rebuild(upage, server):
    """6.1 leak check: a whole game drawn, then a new epoch (Reset rebuilds the game at kickoff) and the whole game
    drawn again (Go Live): geometries and textures within +2 of the first."""
    base = server["base"]
    finished(upage, base, "debug=1")
    wait_idle(upage, TOTAL_ROWS)
    upage.wait_for_timeout(500)
    first = debug_state(upage)
    epoch = version(base)["epoch"]
    upage.locator('[data-testid="transport"] [data-transport="reset"]').click()
    expect(upage.locator("#field")).not_to_have_attribute("data-epoch", epoch, timeout=30_000)
    upage.locator('[data-testid="transport"] [data-transport="live"]').click()
    expect(upage.locator('[data-testid="progress-count"]')).to_have_text(f"{TOTAL_ROWS} / {TOTAL_ROWS}",
                                                                         timeout=30_000)
    wait_idle(upage, TOTAL_ROWS, timeout=30_000)
    upage.wait_for_timeout(500)
    second = debug_state(upage)
    assert second["geometries"] <= first["geometries"] + LEAK_SLACK, (first, second)
    assert second["textures"] <= first["textures"] + LEAK_SLACK, (first, second)


def test_lost_webgl_context_falls_back_to_the_2d_field(upage, server):
    """6.2: a lost WebGL context swaps in the 2D fallback (data-scene 2d, data-scene-error, the SVG) and the same
    hooks keep reporting the situation."""
    base = server["base"]
    at(upage, base, PRESNAP_IDX)
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
    expect(f).to_have_attribute("data-los", "70")
    expect(f).to_have_attribute("data-ltg", "60")

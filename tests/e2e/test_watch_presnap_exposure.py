"""G1-1 (v1.4): in Watch this game at the default 4x, the next call and its shadow plays stay on the field long enough
to read before every Dallas snap. They blinked for 0.31 to 0.62 s before (the snap came 1.75 s after the play before
it, and that play took 80% of the wait); watch.py's caller-snap floor and anim-queue's reserve for the call fix it.

Real time: the shared sandbox has no SHADOW_WATCH_SCALE, and motion is on (reduced motion draws every play at once).
The world is the run's (SC_E2E_WORLD), like every UI test. Two scenes: the 2D field on the suite's browser (its
player keeps wall-clock time however slowly a software GPU paints), and the 3D field on a real GPU (macOS Metal):
software WebGL, the suite's default, can't keep a real-time pace, and its frame clamp stretches every play."""
import sys

import pytest
from ui_helpers import WORLD, api_post, app_url, reset_game, stop_watch, wait_ready

pytestmark = pytest.mark.e2e

SPEED = 4
WATCH_S = 23                 # the opening kickoff, then four Dallas snaps 4.8 s apart
MIN_UP_S = 2.0               # the shadows' window before each snap (the call's 400 ms fade-in comes out of it)
# The 2D field's known overrun (ui-architecture 23.1): fallback-player.js restarts a play's clock on every camera frame,
# so each 2D play runs over by the world's look.cameras.moveMs. Allowed for until that is fixed; still far above the
# 0.31 to 0.62 s this test was written against.
CAMERA_MOVE_S = {"neutral": 0.6, "under-the-lights": 1.1}
GPU_ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]

TRACE_JS = """() => {
  window.__presnap = [];
  const f = document.getElementById('field'), a = document.getElementById('app');
  let last = '';
  const tick = () => {
    const row = [performance.now(), a.getAttribute('data-phase'), f.getAttribute('data-ghosts') || ''];
    const key = row[1] + '|' + row[2];
    if (key !== last) { window.__presnap.push(row); last = key; }
    requestAnimationFrame(tick);
  };
  tick();
}"""
RENDERER_JS = """() => { const g = document.createElement('canvas').getContext('webgl2');
  const d = g && g.getExtension('WEBGL_debug_renderer_info');
  return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; }"""


def windows_before_snaps(trace):
    """Seconds the shadows were up before each snap that took them down (the first is dropped: it began before the
    watch did)."""
    out, up = [], None
    for t, phase, ghosts in trace:
        if ghosts and up is None:
            up = t
        elif not ghosts and up is not None:
            if phase == "snap":
                out.append((t - up) / 1000)
            up = None
    return out[1:]


def motion_page(browser):
    """A 1440x900 page with motion on; page errors land in page.errors."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="no-preference")
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(f"pageerror: {e}"))
    return ctx, page


@pytest.fixture
def real_time(server):
    """The shared sandbox at real pace; the watch is stopped with the game put back, whatever happens."""
    yield server
    stop_watch(server["base"])


@pytest.fixture
def gpu_browser(browser):
    """A second Chromium from the suite's Playwright, on the machine's GPU (Metal); skipped where there is none."""
    if sys.platform != "darwin":
        pytest.skip("the real-GPU browser is set up for macOS (Metal) only")
    b = browser.browser_type.launch(args=GPU_ARGS)
    yield b
    b.close()


def exposure(page, base, query):
    """The page opens the saved game paused at kickoff (restructure-v2.md 9); it then plays at 4x from there, as Play
    does, and the trace records every phase and shadow change."""
    reset_game(base)
    page.goto(app_url(base, query), wait_until="domcontentloaded")
    wait_ready(page)
    page.evaluate(TRACE_JS)
    api_post(base, "/api/watch/speed", {"speed": SPEED})
    api_post(base, "/api/watch/resume")
    page.wait_for_timeout(WATCH_S * 1000)
    trace = page.evaluate("window.__presnap")
    stop_watch(base)
    return windows_before_snaps(trace), trace


def check(up, trace, page, least=MIN_UP_S):
    assert len(up) >= 3, f"expected at least three Dallas snaps, saw {trace}"
    assert min(up) >= least, f"the shadows were up {[round(s, 2) for s in up]} s before the snaps (least {least} s)"
    assert not page.errors, page.errors


def test_the_next_call_stays_up_before_every_dallas_snap_2d(browser, real_time):
    ctx, page = motion_page(browser)
    try:
        up, trace = exposure(page, real_time["base"], "scene=2d")
        check(up, trace, page, MIN_UP_S - CAMERA_MOVE_S.get(WORLD, max(CAMERA_MOVE_S.values())))
    finally:
        ctx.close()


def test_the_next_call_stays_up_before_every_dallas_snap_3d_on_a_gpu(gpu_browser, real_time):
    ctx, page = motion_page(gpu_browser)
    try:
        page.goto(app_url(real_time["base"]), wait_until="domcontentloaded")
        renderer = page.evaluate(RENDERER_JS)
        if not renderer or "SwiftShader" in renderer:
            pytest.skip(f"no hardware WebGL here ({renderer or 'none'})")
        up, trace = exposure(page, real_time["base"], "")
        check(up, trace, page)
    finally:
        ctx.close()

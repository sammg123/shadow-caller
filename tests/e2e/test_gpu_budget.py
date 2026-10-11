"""The render pipeline on the real GPU (G7; ui-architecture 6.1 and 20.5). Shader programs are compiled once, at boot:
the plays of a Watch, with their shadows, residue and ball, compile and delete none (before G7, three relinked a
program at about two of three snaps, a 25 to 45 ms hitch each), the program count stays where it was, and the
engine's animated frames stay inside the frame budget. GPU renders: Playwright's default headless Chromium renders
with SwiftShader (the engine's low tier), so this file launches the new headless mode (`channel="chromium"`) and skips
where there is no GPU, like the golden screenshots."""
import pytest
from ui_helpers import BOOT_TIMEOUT_MS, api_post, app_url, feed_off, seek_game, stop_watch, wait_ready

pytestmark = pytest.mark.e2e

PLAYS = 20                      # plays drawn after boot with no program compiled or deleted
WINDOW_S = 20                   # the frame-budget window, Watch at 4x from the dense plays of the third quarter
FROM_SEQ = 90
SLOW_MS = 25                    # a frame this long is a visible hitch at 60 Hz
MAX_SLOW = 0.02                 # at most 2% of animated frames
IDLE_GAP_MS = 250               # a longer gap is the render loop at rest between plays (render on demand), not a frame
MIN_FRAMES = 300

SPY_JS = """(() => {
  const G = window.__gpu = { on: false, creates: 0, deletes: 0, frames: [] };
  const P = WebGL2RenderingContext.prototype;
  const create = P.createProgram, remove = P.deleteProgram;
  P.createProgram = function () { if (G.on) G.creates += 1; return create.apply(this, arguments); };
  P.deleteProgram = function (p) { if (G.on && p) G.deletes += 1; return remove.apply(this, arguments); };
  const hook = () => {                 // #field[data-frames] is written once per frame the engine draws
    const f = document.getElementById('field');
    if (!f) return false;
    new MutationObserver(() => { if (G.on) G.frames.push(performance.now()); })
      .observe(f, { attributes: true, attributeFilter: ['data-frames'] });
    return true;
  };
  const id = setInterval(() => { if (hook()) clearInterval(id); }, 20);
})();"""


@pytest.fixture(scope="module")
def gpu_browser(browser):
    """Chromium's new headless mode on the real GPU (the e2e `browser` renders with SwiftShader, the low tier)."""
    try:
        b = browser.browser_type.launch(channel="chromium")
    except Exception as err:                            # no new-headless Chromium here: nothing to measure
        pytest.skip(f"the budget is the GPU's; Chromium's new headless mode didn't start ({err})")
    yield b
    b.close()


def open_on_gpu(gpu_browser, base):
    """Sam's laptop: 1440x900 at 2x, motion on, the spy installed before any page script. Skips without a GPU."""
    ctx = gpu_browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2,
                                  reduced_motion="no-preference")
    ctx.add_init_script(script=SPY_JS)
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(f"pageerror: {e}"))
    page.goto(app_url(base, "debug=1"), wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    wait_ready(page)
    page.wait_for_selector('#field[data-scene-ready="true"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    if page.evaluate("window.__shadowDebug().tier") != "high":
        ctx.close()
        pytest.skip("the budget is the GPU's; this browser has no GPU (tier low)")
    page.wait_for_timeout(1500)                         # the camera's first glide and the warm-up's frames
    return page


def play_from_where_it_is(base, speed):
    """The game the page opened (paused, restructure-v2.md 9) plays on at `speed`, as the Play key does."""
    api_post(base, "/api/watch/speed", {"speed": speed})
    api_post(base, "/api/watch/resume")


def programs(page):
    return page.evaluate("window.__shadowDebug().programs")


PACE_JS = """() => new Promise((done) => { const t = [];
  const f = (x) => { t.push(x); if (t.length < 120) requestAnimationFrame(f); else done(t); };
  requestAnimationFrame(f); })"""


def display_pace_ms(gpu_browser):
    """The browser's own frame interval on a blank page (median, ms): about 16.7 on an idle machine. A machine too
    busy for a blank page's 60 fps can't measure the engine's frame budget."""
    page = gpu_browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    try:
        page.set_content("<canvas></canvas>")
        t = page.evaluate(PACE_JS)
    finally:
        page.close()
    gaps = sorted(b - a for a, b in zip(t, t[1:]))
    return gaps[len(gaps) // 2]


def test_plays_after_boot_compile_and_delete_no_shader_program(gpu_browser, watch_server):
    """G7-1: 20 plays of a Watch (their arcs, lines, marks, ball, shadows, residue) after boot: 0 programs created, 0
    deleted, and debugState().programs where it was."""
    base = watch_server["base"]
    stop_watch(base)
    feed_off(base)
    page = open_on_gpu(gpu_browser, base)
    try:
        before = programs(page)
        page.evaluate("() => { window.__gpu.on = true; }")
        play_from_where_it_is(base, 1)
        page.wait_for_function(f"Number(document.getElementById('field').dataset.drawnSeq) >= {PLAYS}",
                               timeout=120_000)
        page.wait_for_timeout(500)
        spy = page.evaluate("() => { window.__gpu.on = false; return window.__gpu; }")
        assert (spy["creates"], spy["deletes"]) == (0, 0), spy
        assert programs(page) == before
        assert page.errors == [], page.errors
    finally:
        page.context.close()
        stop_watch(base)


def test_animated_frames_stay_inside_the_frame_budget(gpu_browser, server):
    """G7-1 (6.1): 20 s of Watch at 4x at the demo pace: at most 2% of the engine's animated frames over 25 ms, and no
    program compiled on the way."""
    pace = display_pace_ms(gpu_browser)
    if pace > SLOW_MS:
        pytest.skip(f"this machine draws a blank page every {pace:.1f} ms: too busy to measure a {SLOW_MS} ms budget")
    base = server["base"]
    stop_watch(base)
    seek_game(base, FROM_SEQ)
    page = open_on_gpu(gpu_browser, base)
    try:
        page.evaluate("() => { window.__gpu.on = true; }")
        play_from_where_it_is(base, 4)
        page.wait_for_timeout(WINDOW_S * 1000)
        spy = page.evaluate("() => { window.__gpu.on = false; return window.__gpu; }")
        frames = spy["frames"]
        intervals = [b - a for a, b in zip(frames, frames[1:]) if b - a < IDLE_GAP_MS]
        slow = sorted((round(x, 1) for x in intervals if x > SLOW_MS), reverse=True)
        assert spy["creates"] == 0, spy["creates"]
        assert page.errors == [], page.errors
    finally:
        page.context.close()
        stop_watch(base)
    over = len(slow) > MAX_SLOW * len(intervals)
    if over and display_pace_ms(gpu_browser) > SLOW_MS:
        pytest.skip(f"the machine got too busy during the window (a blank page now runs over {SLOW_MS} ms a frame)")
    assert len(intervals) >= MIN_FRAMES, f"only {len(intervals)} animated frames in {WINDOW_S} s"
    assert not over, f"{len(slow)} of {len(intervals)} frames over {SLOW_MS} ms: {slow}"

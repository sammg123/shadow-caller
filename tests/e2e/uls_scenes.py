"""Under the Lights scenes, frozen in time (v1.4, W6): the golden screenshots (ui-architecture 7.3) and the watch-mode
walk-through of docs/design/play-drawing.md drive the page to the same five states.

  final       the game at its final whistle, at rest
  presnap     a watch paused before the first Dallas snap: his top 2 as shadow plays, text underneath
  midflight   that watch stepped to Dallas's deep pass middle (+21), the ball at the top of its arc
  incomplete  the first Dallas snap stepped: its arc, the X and "Short pass middle · incomplete"
  settings    the paused pre-snap with the top bar's settings menu open

The page opens its game on load (restructure-v2.md 9: POST /api/open), which leaves a watch session where it is, so
every state is a session. A play is stepped through the API (POST /api/watch/step), which draws it in motion: the
page's own Right jumps one play and snaps the field (restructure-v2.md 2). The page runs on Playwright's clock
(page.clock), paused once the state is set, and every frame after that is a 16 ms tick of it, so a ball in flight is
caught on the same frame every run. Captures need the real GPU: Playwright's
default headless Chromium renders with SwiftShader (the engine's low tier, no bloom, no crowd), and the goldens are
what Sam sees, so `gpu_browser` launches the new headless mode (`channel="chromium"`)."""
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

from ui_helpers import api_post, stop_watch, watch_paused_at

GOLDEN_DIR = Path(__file__).resolve().parent / "goldens" / "under-the-lights"
ACTUAL_DIR = Path(__file__).resolve().parents[2] / "test-results" / "visual" / "under-the-lights"
SIZES = ((1440, 900), (1920, 1080))
STATES = ("final", "presnap", "midflight", "incomplete", "settings")
TICK_MS = 16                    # one frame of the page clock
SETTLE_MS = 10_000              # the ticker's paging and the light dip all done
CHUNK_MS = 96                   # the clock runs in chunks with a real pause between, so fetches can answer
BOOT_MS = 60_000
PRESNAP_IDX = 1                 # the kickoff applied: the first Dallas snap (seq 2) is next
DEEP_PASS_IDX = 6               # six plays applied: seq 7, "Deep pass middle · +21", is next
MIDFLIGHT_FRAMES = 40           # the deep pass's apex (x 81.5 of 71 to 92, 3.8 yd up), at its own pace
INCOMPLETE_FRAMES = 88          # the X down, the words in, the ball sliding back to the line of scrimmage
DIFF_THRESHOLD = 24             # a channel off by more than this is a changed pixel
STEP_SETTLE_MS = 800            # real time for a stepped play's fetches, so it starts on the stopped clock's frame
MAX_CHANGED = 0.01              # ui-architecture 7.3: 1% pixel tolerance


EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def iso_ms(ms):
    """An exact millisecond for Playwright's clock (the Python API reads a number as seconds, a float loses the ms)."""
    return (EPOCH + timedelta(milliseconds=ms)).isoformat(timespec="milliseconds")


def golden_path(state, size):
    return GOLDEN_DIR / f"{state}-{size[0]}x{size[1]}.png"


# ---------------------------------------------------------------- the server
def replayed(base):
    """The saved game at its final whistle: Go Live on a finished game jumps to its end, in a watch session, so the
    page's POST /api/open on load leaves it there (a replay alone would open at kickoff)."""
    stop_watch(base)
    api_post(base, "/api/feed", {"on": False})
    api_post(base, "/api/golive")


def step_play(page):
    """Step one play of the paused watch on the page's server, drawn in motion (POST /api/watch/step)."""
    parts = urlsplit(page.url)
    api_post(f"{parts.scheme}://{parts.netloc}", "/api/watch/step")


# ---------------------------------------------------------------- the page and its clock
def open_page(browser, base, size, query="debug=1"):
    """A page on Under the Lights (the default world: no ?world=) with motion on and Playwright's clock installed."""
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, device_scale_factor=1,
                              reduced_motion="no-preference")
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: page.errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.clock_origin = int(time.time()) * 1000
    page.clock.install(time=iso_ms(page.clock_origin))
    page.goto(f"{base}/?{query}", wait_until="domcontentloaded", timeout=BOOT_MS)
    page.wait_for_selector('#app[data-boot="ready"]', state="attached", timeout=BOOT_MS)
    page.wait_for_selector('#field[data-scene-ready="true"][data-anim-state="idle"]', state="attached", timeout=BOOT_MS)
    page.evaluate("document.fonts.ready.then(() => true)")
    return page


def freeze(page):
    """Stop the page's clock on its frame grid (a requestAnimationFrame fires every 16 ms from the install time), so
    a play that starts while it is stopped starts on a frame and its Nth frame is the same moment every run."""
    elapsed = page.evaluate("Date.now()") - page.clock_origin
    page.clock.pause_at(iso_ms(page.clock_origin + (elapsed // TICK_MS + 2) * TICK_MS))


def run(page, ms, chunk=CHUNK_MS, gap_ms=12):
    """Advance the frozen clock by `ms` in chunks, letting the network and CSS animations run between them; whole
    frames only, so the clock stays on its frame grid."""
    assert ms % TICK_MS == 0 and chunk % TICK_MS == 0, "whole frames only"
    left = ms
    while left > 0:
        step = min(chunk, left)
        page.clock.run_for(step)
        page.wait_for_timeout(gap_ms)
        left -= step


def settle(page):
    page.wait_for_timeout(600)          # the LED step-ins are CSS: real time
    run(page, SETTLE_MS)
    page.wait_for_timeout(600)


PLAY_FRAME_JS = "(() => { const d = window.__shadowDebug(); return d.ball ? d.frames : null; })()"


def snap_and_tick(page, frames):
    """Step one play of the paused watch (step_play), then stop on its `frames`th frame, counted by the engine from
    the first frame its ball is in play (never by the page's hooks, which can trail by a frame)."""
    step_play(page)
    page.wait_for_timeout(STEP_SETTLE_MS)      # the step and its fetches land while the clock stands still
    end = time.monotonic() + 30
    first = None
    while first is None:
        if time.monotonic() > end:
            raise AssertionError("the stepped play never started")
        page.clock.run_for(TICK_MS)
        page.wait_for_timeout(30)
        first = page.evaluate(PLAY_FRAME_JS)
    while page.evaluate(PLAY_FRAME_JS) - first < frames:
        page.clock.run_for(TICK_MS)
        page.wait_for_timeout(4)


FRAME_JS = """() => { const d = window.__shadowDebug(); return { anim: d.animState, seq: d.playingSeq,
  ball: d.ball, ghosts: d.ghosts }; }"""


def step_frames(page, max_frames=900):
    """Step one play of the paused watch (step_play) on the frozen clock and return the engine's state at every frame
    of it (`__shadowDebug()`: anim, seq, ball, ghosts), from the frame it starts to the frame it is down."""
    step_play(page)
    frames, started = [], False
    for _ in range(max_frames):
        page.clock.run_for(TICK_MS)
        page.wait_for_timeout(6)
        f = page.evaluate(FRAME_JS)
        started = started or f["anim"] == "playing"
        if started and f["anim"] != "playing":
            return frames
        if started:
            frames.append(f)
    raise AssertionError(f"the stepped play didn't finish in {max_frames} frames (started: {started})")


def wait_shadows(page):
    page.wait_for_selector('#field[data-ghosts]:not([data-ghosts=""])', state="attached", timeout=BOOT_MS)


# ---------------------------------------------------------------- the five states
def scene(browser, base, state, size):
    """(page, png bytes) of `state` at `size`; the caller closes page.context."""
    if state == "final":
        replayed(base)
        page = open_page(browser, base, size)
        freeze(page)
        settle(page)
        return page, page.screenshot()
    watch_paused_at(base, DEEP_PASS_IDX if state == "midflight" else PRESNAP_IDX)
    page = open_page(browser, base, size)
    wait_shadows(page)
    freeze(page)
    settle(page)
    if state == "settings":
        page.locator('[data-testid="settings-toggle"]').click()
        page.wait_for_selector('#app[data-settings-open="true"]', state="attached")
        settle(page)
    elif state in ("midflight", "incomplete"):
        snap_and_tick(page, MIDFLIGHT_FRAMES if state == "midflight" else INCOMPLETE_FRAMES)
    return page, page.screenshot()


# ---------------------------------------------------------------- comparing two PNGs in the browser
DIFF_JS = """async ([a, b, threshold]) => {
  const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail;
    i.src = src; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  if (ia.width !== ib.width || ia.height !== ib.height) return { size: [ia.width, ia.height, ib.width, ib.height] };
  const w = ia.width, h = ia.height;
  const pixels = (img) => { const c = new OffscreenCanvas(w, h); const g = c.getContext("2d");
    g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
  const pa = pixels(ia), pb = pixels(ib);
  let changed = 0;
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
    if (d > threshold) changed += 1;
  }
  return { ratio: changed / (w * h) };
}"""


def changed_ratio(page, png_a, png_b, threshold=DIFF_THRESHOLD):
    """Share of pixels that differ by more than `threshold` in any channel (1.0 when the sizes differ)."""
    import base64
    url = lambda png: "data:image/png;base64," + base64.b64encode(png).decode()  # noqa: E731
    out = page.evaluate(DIFF_JS, [url(png_a), url(png_b), threshold])
    return 1.0 if "size" in out else out["ratio"]

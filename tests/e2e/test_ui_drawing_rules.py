"""Play drawing rules on the field, on both engines (docs/design/play-drawing.md, binding; the G6 fixes):

  1. a field goal starts on the line of scrimmage like every play: no hold drawn behind it (it read as a sack), and
     no frame of the kick goes behind the line;
  4. before each Dallas snap his top 2's plates never touch (4b: each beside its own stroke, placed in screen space),
     at 390, 1440 and 1920 wide; on 4th down (he usually kicks) they read "NEXT 1 · If he goes · ...";
  3. a play's words never sit on the ball: the 2D field lays them out in its own view, so a phone's deep plates step
     clear of it.

Runs on ui_helpers.WORLD (SC_E2E_WORLD: neutral by default, under-the-lights for Sam's world) against the scaled-pace
watch sandbox; every test sets its own server state (FI 6.1) and leaves no session running."""
import json
import time

import pytest
from playwright.sync_api import expect
from ui_helpers import BOOT_TIMEOUT_MS, app_url, stop_watch
from uls_scenes import freeze, iso_ms, run, step_frames, watch_paused_at

from helpers import ROOT

pytestmark = pytest.mark.e2e

SCENES = {"webgl": "debug=1", "2d": "debug=1&scene=2d"}
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "timeline_tb_dal.json").read_text())
ROWS = {r["seq"]: r for r in FIXTURE["rows"]}
FG_IDX = 86                     # 86 plays applied: seq 87, "FG 41 yds · good" from the TB 23 (x 77), is next
FOURTH_IDX = 42                 # seq 43 is next: Dallas's punt on 4th & 10
STACK_IDXS = (7, 128, 169)      # pre-snaps where #2 sat over #1 (live rehearsal, 2026-10-09)
PHONE_IDX = 6                   # "Inside run (up the middle) · +21" just ended on the center line
SIZES = ((390, 844), (1440, 900), (1920, 1080))
FIRST_REACH_YD = 1.0            # a play's first frame (16 ms in) is this close to its line of scrimmage
BALL_SLACK_YD = 0.25
PX_SLACK = 0.5

SHADOW_PLATES_JS = """() => {
  const sel = '#field .sc-shadow-label, #field .sc-ghost-label';
  return [...document.querySelectorAll(sel)].map(e => {
    const plate = e.querySelector('rect') ?? e;
    const r = plate.getBoundingClientRect();
    const rank = Number((String(e.className.baseVal ?? e.className).match(/rank-(\\d+)/) ?? [])[1]);
    const cs = getComputedStyle(e);
    return { rank, text: e.textContent, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      shown: r.width > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && e.getAttribute('display') !== 'none' };
  });
}"""


@pytest.fixture
def wsrv(watch_server):
    yield watch_server
    stop_watch(watch_server["base"])


def open_field(browser, base, size, query, clocked=False):
    """The app on ui_helpers.WORLD at `size` with motion on; `clocked` installs Playwright's clock (frame by frame)."""
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, device_scale_factor=1,
                              reduced_motion="no-preference")
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: page.errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    if clocked:
        page.clock_origin = int(time.time()) * 1000
        page.clock.install(time=iso_ms(page.clock_origin))
    page.goto(app_url(base, query), wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('#app[data-boot="ready"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('#field[data-scene-ready="true"][data-anim-state="idle"]', state="attached",
                           timeout=BOOT_TIMEOUT_MS)
    return page


def shown_plates(page, count=2, timeout_ms=20_000):
    """The shadow words' plates on screen, by rank, once his top `count` are all laid out and visible."""
    end = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < end:
        plates = {p["rank"]: p for p in page.evaluate(SHADOW_PLATES_JS) if p["shown"]}
        if all(r in plates for r in range(1, count + 1)):
            page.wait_for_timeout(400)          # one more look: the text is laid out for the view the camera lands in
            again = {p["rank"]: p for p in page.evaluate(SHADOW_PLATES_JS) if p["shown"]}
            if again == plates:
                return plates
        page.wait_for_timeout(200)
    raise AssertionError(f"his top {count} never showed: {page.evaluate(SHADOW_PLATES_JS)}")


# ---------------------------------------------------------------- 1: a field goal from the line of scrimmage
@pytest.mark.parametrize("scene_id", sorted(SCENES))
def test_a_field_goal_starts_on_the_line_of_scrimmage(browser, wsrv, scene_id):
    """Seq 87, "FG 41 yds · good" from the TB 23 (x 77), stepped on a paused watch frame by frame: its first ball
    frame is on the line of scrimmage and no frame goes behind it (the 8-yard hold read as a sack)."""
    base = wsrv["base"]
    watch_paused_at(base, FG_IDX)
    page = open_field(browser, base, (1440, 900), SCENES[scene_id], clocked=True)
    try:
        freeze(page)
        run(page, 1600)
        frames = [f for f in step_frames(page) if f["seq"] == 87 and f["ball"]]
        x0 = ROWS[87]["geo"]["x0"]
        assert x0 == 77
        assert frames, "the kick never flew"
        assert abs(frames[0]["ball"]["x"] - x0) <= FIRST_REACH_YD, f"left from x {frames[0]['ball']['x']:.2f}"
        back = min(f["ball"]["x"] for f in frames)
        assert back >= x0 - BALL_SLACK_YD, f"a frame went back to x {back:.2f}, behind the line of scrimmage"
        assert max(f["ball"]["h"] for f in frames) > 3.333, "over the crossbar"
        assert page.errors == [], page.errors
    finally:
        page.context.close()


# ---------------------------------------------------------------- 4: his top 2's words, one block
def apart(a, b):
    """Two plates' boxes don't overlap (PX_SLACK of touching allowed)."""
    return (a["bottom"] <= b["top"] + PX_SLACK or b["bottom"] <= a["top"] + PX_SLACK
            or a["right"] <= b["left"] + PX_SLACK or b["right"] <= a["left"] + PX_SLACK)


@pytest.mark.parametrize("size", SIZES, ids=[f"{w}x{h}" for w, h in SIZES])
@pytest.mark.parametrize("scene_id", sorted(SCENES))
def test_his_top_twos_plates_never_touch(browser, wsrv, scene_id, size):
    """Before three Dallas snaps where #2 used to sit over #1 (or touch it): the two plates never meet (4b: each sits
    beside its own stroke, placed in screen space, so their order follows the strokes' lanes)."""
    base = wsrv["base"]
    for idx in STACK_IDXS:
        watch_paused_at(base, idx)
        page = open_field(browser, base, size, SCENES[scene_id])
        try:
            plates = shown_plates(page)
            one, two = plates[1], plates[2]
            assert apart(one, two), (f"idx {idx}: '{one['text']}' {one} meets '{two['text']}' {two}")
            assert one["text"].startswith("NEXT 1") and two["text"].startswith("NEXT 2"), (one["text"], two["text"])
            assert page.errors == [], page.errors
        finally:
            page.context.close()


@pytest.mark.parametrize("scene_id", sorted(SCENES))
def test_on_fourth_down_the_shadows_read_if_he_goes(browser, wsrv, scene_id):
    """4th & 10 before Dallas's punt: the model only knows what he calls if he goes, and the words say so."""
    base = wsrv["base"]
    watch_paused_at(base, FOURTH_IDX)
    page = open_field(browser, base, (1440, 900), SCENES[scene_id])
    try:
        plates = shown_plates(page)
        for rank in (1, 2):
            assert plates[rank]["text"].startswith(f"NEXT {rank} · If he goes · "), plates[rank]["text"]
        assert apart(plates[1], plates[2])
        assert page.errors == [], page.errors
    finally:
        page.context.close()


# ---------------------------------------------------------------- 3: never on the ball
def test_on_a_phone_the_2d_field_keeps_a_plays_words_off_the_ball(browser, wsrv):
    """390x844, ?scene=2d, after "Inside run (up the middle) · +21": the words' plate and the ball never meet."""
    base = wsrv["base"]
    watch_paused_at(base, PHONE_IDX)
    page = open_field(browser, base, (390, 844), SCENES["2d"])
    try:
        words = page.locator("#field .sc-fb-play-label rect").first
        expect(words).to_be_attached()
        page.wait_for_timeout(600)
        plate = words.bounding_box()
        ball = page.locator('#field [data-part="ball"]').first.bounding_box()
        assert plate and ball
        apart = (plate["y"] + plate["height"] <= ball["y"] + PX_SLACK or ball["y"] + ball["height"] <= plate["y"] + PX_SLACK
                 or plate["x"] + plate["width"] <= ball["x"] + PX_SLACK or ball["x"] + ball["width"] <= plate["x"] + PX_SLACK)
        assert apart, f"the words {plate} cover the ball {ball}"
        assert page.errors == [], page.errors
    finally:
        page.context.close()

"""Under the Lights, the stadium's look (v1.4 fixes; DESIGN.md "The stadium (3D art direction)", docs/design/
play-drawing.md 4). Always on Sam's world, whatever SC_E2E_WORLD says: the look is the world's own.

  4b    his top 2 read as two plays, colour-coded by rank: #1's plate carries "NEXT 1" on an LED amber tab, #2's
        "NEXT 2" on LED warm white (the strokes are drawn in the same); crops of the first Dallas snap and of one at
        midfield (over the star) at 1440 and 1920, GPU renders, are written to test-results/visual/uls-look/ to be
        looked at
  G3-2  no flat slab under the near sideline: on the wide and tight cameras at both sizes no 41 rows of the free area
        in a row are flat and dark (the finish gate's flat.py: luminance range under 36 and mean under 40), none is one
        flat color, and every 60-row band of it has a luminance range of 6 or more (GPU renders)
  G3-8  on a phone every field label plate sits inside the screen, wrapped and a size down when it must

Every test sets its own server state (FI 6.1) on the scaled-pace watch sandbox and leaves no session running."""
import base64
from pathlib import Path

import pytest
from playwright.sync_api import expect
from ui_helpers import BOOT_TIMEOUT_MS, state, stop_watch, wait_idle, wait_ready
from uls_scenes import ACTUAL_DIR, PRESNAP_IDX, SIZES, freeze, open_page, replayed, run, wait_shadows, watch_paused_at

pytestmark = pytest.mark.e2e

WORLD_ID = "under-the-lights"
FIELD = "#field"
LOOK_DIR = ACTUAL_DIR.parent / "uls-look"
MIDFIELD_IDX = 4                # four plays applied: Dallas's 4th snap is next, from his 46, over the star at the 50
PHONE_IDX = 49                  # TB's punt with a flag is the play on display: the longest words of the game
SETTLE_MS = 6_000               # the camera's glide, the shadows' growth, the LED step-ins
RANK_TONE = {1: "rgb(255, 178, 30)", 2: "rgb(255, 243, 209)"}   # 4b: #1 LED amber, #2 LED warm white
FLAT_RANGE = 1.0                # a row whose luminance spans less than this is one flat color
DARK_FLAT = (36.0, 40.0)        # the finish gate's flat.py: a row spanning less than 36 with a mean under 40
MAX_FLAT_RUN = 40               # rows in a row of either, at most
BAND_ROWS = 60
MIN_BAND_RANGE = 6.0            # luminance range of any 60-row band of the free area, at least
FREE = {(1440, 900): (20, 960, 96, 716), (1920, 1080): (20, 1280, 120, 840)}    # x0, x1, y0, y1 (DESIGN.md Layout)
HUD_HIDDEN = ("#app > *:not(#rg-field), .sc-field-legend, .sc-field-labels { visibility: hidden !important; } "
              "#rg-field { visibility: visible !important; }")


@pytest.fixture
def wsrv(watch_server):
    yield watch_server
    stop_watch(watch_server["base"])


@pytest.fixture(scope="module")
def gpu_browser(browser):
    """Chromium's new headless mode on the real GPU (the e2e `browser` renders with SwiftShader, the low tier)."""
    try:
        b = browser.browser_type.launch(channel="chromium")
    except Exception as err:
        pytest.skip(f"these are GPU renders; Chromium's new headless mode didn't start ({err})")
    yield b
    b.close()


def open_uls(page, base):
    page.goto(f"{base}/?world={WORLD_ID}", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    wait_ready(page)
    expect(page.locator(FIELD)).to_have_attribute("data-scene-ready", "true", timeout=BOOT_TIMEOUT_MS)


def family_of(leaf):
    return "screen" if leaf == "screen" else leaf.split("_", 1)[0]


SHADOWS_JS = """() => [...document.querySelectorAll('.sc-field-label > .sc-shadow-label')].map((el) => {
  const box = el.getBoundingClientRect();
  const tag = el.querySelector('.sc-label-tag');
  return { text: el.textContent, classes: [...el.classList], edge: getComputedStyle(el).borderTopColor,
    style: getComputedStyle(el).borderTopStyle, tag: tag ? tag.textContent : null,
    tab: tag ? getComputedStyle(tag).backgroundColor : null, box: [box.x, box.y, box.width, box.height] }; })"""


def gpu_page(gpu_browser, base, size):
    page = open_page(gpu_browser, base, size, query=f"world={WORLD_ID}&debug=1")
    if page.evaluate("window.__shadowDebug().tier") != "high":
        page.context.close()
        pytest.skip("these are GPU renders; this browser has no GPU (tier low)")
    return page


# ---------------------------------------------------------------- 4b: two plays, two colours, each tagged
def test_each_prediction_plate_is_tagged_in_its_ranks_colour(ui_pages, wsrv):
    """Before the first Dallas snap his top 2's plates read "NEXT 1 · ..." and "NEXT 2 · ...", each tag on a tab in
    the colour its stroke is drawn in: #1 LED amber, #2 LED warm white (never a family's or a team's colour)."""
    base = wsrv["base"]
    watch_paused_at(base, PRESNAP_IDX)
    page = ui_pages()
    open_uls(page, base)
    top = state(base)["prediction"]["top"][:2]
    expect(page.locator(FIELD)).to_have_attribute("data-ghosts", " ".join(t["key"] for t in top))
    expect(page.locator(".sc-shadow-label")).to_have_count(2)
    shadows = page.evaluate(SHADOWS_JS)
    for rank, (play, words) in enumerate(zip(top, shadows), 1):
        family = family_of(play["key"])
        assert f"family-{family}" in words["classes"] and f"rank-{rank}" in words["classes"], words
        assert words["tag"] == f"NEXT {rank}", words
        assert words["text"].startswith(f"NEXT {rank} · {play['name']}"), words
        assert words["tab"] == RANK_TONE[rank], (words, "the tab wears the stroke's colour")
        assert words["style"] == "dashed", words
    assert shadows[0]["tab"] != shadows[1]["tab"], "two plays, two colours"
    assert page.errors == [], page.errors


def crop_png(helper, png, box, k):
    url = "data:image/png;base64," + base64.b64encode(png).decode()
    out = helper.evaluate("""async ([src, x, y, w, h, k]) => {
      const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail;
        i.src = src; });
      const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(img, x, y, w, h, 0, 0, c.width, c.height); return c.toDataURL('image/png'); }""",
                          [url, *[round(v) for v in box], k])
    return base64.b64decode(out.split(",", 1)[1])


@pytest.mark.parametrize("idx", [PRESNAP_IDX, MIDFIELD_IDX], ids=["first-snap", "midfield"])
def test_shadow_crops_for_a_look(gpu_browser, wsrv, idx):
    """The two shadows in their tones, dashed over a dark casing that holds them on the turf and over the star logo:
    crops (3x at 1440, 2x at 1920) of the shadows and their words, written for a look; both plates on screen."""
    base = wsrv["base"]
    watch_paused_at(base, idx)
    LOOK_DIR.mkdir(parents=True, exist_ok=True)
    helper = gpu_browser.new_page()
    helper.goto("about:blank")
    try:
        for size in SIZES:
            page = gpu_page(gpu_browser, base, size)
            wait_shadows(page)
            freeze(page)
            run(page, SETTLE_MS - SETTLE_MS % 16)
            png = page.screenshot()
            shadows = page.evaluate(SHADOWS_JS)
            assert len(shadows) == 2, shadows
            x0 = min(s["box"][0] for s in shadows) - 120
            x1 = max(s["box"][0] + s["box"][2] for s in shadows) + 120
            y1 = max(s["box"][1] + s["box"][3] for s in shadows) + 10
            y0 = min(s["box"][1] for s in shadows) - (190 if size[0] == 1440 else 250)
            box = (max(0, x0), max(0, y0), min(size[0], x1) - max(0, x0), min(size[1], y1) - max(0, y0))
            k = 3 if size[0] == 1440 else 2
            name = f"shadows-{'first' if idx == PRESNAP_IDX else 'midfield'}-{size[0]}x{size[1]}"
            (LOOK_DIR / f"{name}.png").write_bytes(crop_png(helper, png, box, k))
            assert page.errors == [], page.errors
            page.context.close()
    finally:
        helper.close()


# ---------------------------------------------------------------- G3-2: a stadium under every pixel
ROWS_JS = """async ([src, x0, x1, y0, y1]) => {
  const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail;
    i.src = src; });
  const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const rows = [];
  for (let y = y0; y < y1; y++) {
    const d = g.getImageData(x0, y, x1 - x0, 1).data; let mn = 255, mx = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      mn = Math.min(mn, l); mx = Math.max(mx, l); sum += l; }
    rows.push([mn, mx, sum / ((x1 - x0) || 1)]);
  }
  return rows; }"""


def longest_run(rows, flat):
    longest = run_len = 0
    for row in rows:
        run_len = run_len + 1 if flat(*row) else 0
        longest = max(longest, run_len)
    return longest


def slab_report(helper, png, free):
    x0, x1, y0, y1 = free
    rows = helper.evaluate(ROWS_JS, ["data:image/png;base64," + base64.b64encode(png).decode(), x0, x1, y0, y1])
    bands = [max(r[1] for r in rows[i:i + BAND_ROWS]) - min(r[0] for r in rows[i:i + BAND_ROWS])
             for i in range(0, len(rows) - BAND_ROWS + 1)]
    worst = min(range(len(bands)), key=lambda i: bands[i])
    dark_flat = lambda mn, mx, mean: mx - mn < DARK_FLAT[0] and mean < DARK_FLAT[1]  # noqa: E731
    return {"longest_flat_run": longest_run(rows, lambda mn, mx, mean: mx - mn < FLAT_RANGE),
            "longest_dark_flat_run": longest_run(rows, dark_flat),
            "min_band_range": round(bands[worst], 2), "at_y": y0 + worst}


def camera_to(page, mode):
    for _ in range(4):
        if page.locator(FIELD).get_attribute("data-camera") == mode:
            return
        page.keyboard.press("v")
        run(page, 3_008)
    assert page.locator(FIELD).get_attribute("data-camera") == mode


def test_no_flat_slab_below_the_near_sideline(gpu_browser, wsrv):
    """DESIGN.md: a bowl under every pixel. The home stand's back (columns, the lit concourse band, the gates) and the
    plaza behind it (bowl-haze concrete, lit near the stands, joints and lamp pools) fill what the home-side cameras
    see under the near sideline: the canvas alone, the HUD hidden, on the final state."""
    base = wsrv["base"]
    replayed(base)
    helper = gpu_browser.new_page()
    helper.goto("about:blank")
    found = {}
    try:
        for size in SIZES:
            page = gpu_page(gpu_browser, base, size)
            freeze(page)
            run(page, 9_008)
            for mode in ("wide", "tight"):
                camera_to(page, mode)
                style = page.add_style_tag(content=HUD_HIDDEN)
                page.wait_for_timeout(200)
                png = page.screenshot()
                style.evaluate("el => el.remove()")
                LOOK_DIR.mkdir(parents=True, exist_ok=True)
                (LOOK_DIR / f"slab-{mode}-{size[0]}x{size[1]}.png").write_bytes(png)
                found[f"{mode} {size[0]}x{size[1]}"] = slab_report(helper, png, FREE[size])
            assert page.errors == [], page.errors
            page.context.close()
    finally:
        helper.close()
    for name, r in found.items():
        assert r["longest_flat_run"] <= MAX_FLAT_RUN, (name, r)
        assert r["longest_dark_flat_run"] <= MAX_FLAT_RUN, (name, r)
        assert r["min_band_range"] >= MIN_BAND_RANGE, (name, r)


# ---------------------------------------------------------------- G3-8: words on a phone
PLATES_JS = """() => [...document.querySelectorAll('.sc-field-label > span')].filter((el) => {
  const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && el.getClientRects().length > 0; }).map((el) => {
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  return { text: el.textContent, left: r.left, right: r.right, size: cs.fontSize, wrap: cs.whiteSpace }; })"""


def test_field_words_stay_on_a_phone_screen(ui_pages, wsrv):
    """At 390x844 TB's 'Punt · 41 yds · downed · flag: offensive holding on DAL' was wider than the screen and cut at
    its right edge: now every plate wraps if it must, a size down, and sits inside the screen."""
    base = wsrv["base"]
    watch_paused_at(base, PHONE_IDX)
    page = ui_pages(width=390, height=844)
    open_uls(page, base)
    wait_idle(page)
    expect(page.locator(".sc-field-label > .sc-play-label").first).to_contain_text("Punt")
    page.wait_for_timeout(500)
    plates = page.evaluate(PLATES_JS)
    width = page.evaluate("document.documentElement.clientWidth")
    xs = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--sc-size-xs').trim()")
    assert plates, "the play's words and his shadows' words are on the field"
    for plate in plates:
        assert plate["left"] >= 0 and plate["right"] <= width, (plate, width)
        assert plate["wrap"] == "normal" and plate["size"] == xs, (plate, xs)
    assert page.errors == [], page.errors

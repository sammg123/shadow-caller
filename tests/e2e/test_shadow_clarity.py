"""play-drawing.md 4b acceptance, measured in the browser (Sam, 2026-10-10: "the overlapping is a big issue").

For every Dallas pre-snap of the saved TB at DAL game (59), at 1440x900 and 1920x1080 (and Sam's MacBook window,
1512x982, on a sample), on the world's default pre-snap camera, with the previous play drawn the way a watched game
draws it (stepped, so it animates and gets its verdict):

  - no plate on the field meets another (his NEXT 1 and NEXT 2 plates, the previous play's LAST plate): 0 overlaps,
  - no plate meets the ball (its footprint as the engine projects it, debugState().clarity.ball): 0 overlaps,
  - no plate sits on a prediction's stroke or the previous play's (their screen samples, clarity.shadows[].px and
    clarity.last.px), beyond a pixel of anti-aliasing,
  - his two predictions never share a lane: their strokes (yards, clarity.shadows[].stroke) stay at least 3 yd apart,
    4 once fanned, and each starts at least 1.5 yd from the ball,
  - the previous play reads as the last play: its plate tagged LAST and drawn in its own colour, solid; the
    predictions' tagged NEXT 1 and NEXT 2, dashed, in two other colours.

Three pages (one per window size) follow one paused watch, stepped a play at a time through the server, so each
pre-snap is measured on all of them at once. The 2D field gets the same checks on a sample. Runs on ui_helpers.WORLD
(SC_E2E_WORLD: neutral by default, under-the-lights for Sam's world)."""
import json
import math
import time

import pytest
from ui_helpers import BOOT_TIMEOUT_MS, EVENT, api_get, api_post, app_url, stop_watch

from helpers import ROOT

pytestmark = pytest.mark.e2e

FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "timeline_tb_dal.json").read_text())
ROWS = FIXTURE["rows"]
C = 26.667
SIZES = ((1440, 900), (1920, 1080))
MACBOOK = (1512, 982)
MACBOOK_EVERY = 4               # Sam's MacBook window measures every 4th Dallas pre-snap (and the two he captured)
SAM_SEQS = (127, 152)           # his screenshots: after "Short pass left · +11" and "Short pass left · +15"
TRIGGER_YD = 3.0                # play-drawing.md 4b: within about 3 yards, they fan out ...
FAN_YD = 4.0                    # ... to lanes at least about 4 yards apart
START_YD = 1.5                  # ... and start about 1.5 yards past the ball
EPS_YD = 1e-6
AA_PX = 1.0                     # a stroke sample this far inside a plate's edge is anti-aliasing, not an overlap
SETTLE_S = 45                   # a stepped play, its verdict's beat, the camera's glide, on a busy machine
SAMPLE_2D = (2, 5, 8, 12, 41, 42, 51, 102, 127, 130, 150, 152)

MEASURE_JS = """() => {
  const field = document.getElementById('field');
  const origin = field.getBoundingClientRect();
  const d = window.__shadowDebug ? window.__shadowDebug() : null;
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
      && el.closest('[display="none"]') === null && Number(cs.opacity) > 0.05; };
  const html = [...field.querySelectorAll('.sc-field-label > span')].filter(shown).map((el) => {
    const r = el.getBoundingClientRect();
    return { text: el.textContent, cls: el.className, tag: el.querySelector('.sc-label-tag')?.textContent ?? null,
      box: [r.left - origin.left, r.top - origin.top, r.right - origin.left, r.bottom - origin.top] }; });
  const svg = [...field.querySelectorAll('.sc-fb-plate')].filter(shown).map((el) => {
    const r = el.querySelector('[data-role="plate"]').getBoundingClientRect();
    return { text: el.textContent, cls: String(el.getAttribute('class')), tag: el.getAttribute('data-tag') || null,
      box: [r.left - origin.left, r.top - origin.top, r.right - origin.left, r.bottom - origin.top] }; });
  return { anim: field.getAttribute('data-anim-state'), ghosts: field.getAttribute('data-ghosts'),
    camera: field.getAttribute('data-camera'), plates: [...html, ...svg], clarity: d ? d.clarity : null };
}"""


# ---------------------------------------------------------------- the browser and the watch
@pytest.fixture(scope="module")
def clarity_browser(browser):
    """Chromium's new headless mode on the GPU when there is one (what Sam sees); the suite's SwiftShader otherwise."""
    try:
        b = browser.browser_type.launch(channel="chromium")
    except Exception:          # no new-headless Chromium here: the suite's own browser measures the same layout
        yield browser
        return
    yield b
    b.close()


@pytest.fixture
def wsrv(watch_server):
    yield watch_server
    stop_watch(watch_server["base"])


def dallas_presnaps():
    """(index, seq, index of the play the field shows before it) for every Dallas pre-snap."""
    out = []
    for i, row in enumerate(ROWS):
        if not (row.get("pred") or {}).get("dist"):
            continue
        prev = max(k for k in range(i) if ROWS[k]["kind"] != "admin")
        out.append((i, row["seq"], prev))
    return out


def watch_idx(base):
    return api_get(base, "/api/watch")["idx"]


def pause_at(base, idx):
    """A watch paused with exactly `idx` plays applied, started over when it is past it."""
    if api_get(base, "/api/watch")["state"] not in ("paused",) or watch_idx(base) > idx:
        stop_watch(base)
        api_post(base, "/api/feed", {"on": False})
        api_post(base, "/api/watch/start", {"event_id": EVENT, "speed": 2, "from_seq": 0})
        api_post(base, "/api/watch/pause")
    while watch_idx(base) < idx:
        api_post(base, "/api/watch/step")
    assert watch_idx(base) == idx


def open_page(browser, base, size, query):
    dpr = 2 if size == MACBOOK else 1
    ctx = browser.new_context(viewport={"width": size[0], "height": size[1]}, device_scale_factor=dpr,
                              reduced_motion="no-preference")
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: page.errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.goto(app_url(base, query), wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('#app[data-boot="ready"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('#field[data-scene-ready="true"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    return page


def wait_drawn(page, seq):
    """The page has drawn every row through `seq` (#field[data-drawn-seq]) and stands idle."""
    page.wait_for_function(f"""() => {{ const f = document.getElementById('field');
      return Number(f.getAttribute('data-drawn-seq')) >= {seq} && f.getAttribute('data-anim-state') === 'idle'; }}""",
                           timeout=SETTLE_S * 1000)


def settled(page, want_ghosts):
    """The pre-snap measured once it holds still: shadows up, idle, the plates the same twice in a row."""
    end = time.monotonic() + SETTLE_S
    last = None
    while time.monotonic() < end:
        m = page.evaluate(MEASURE_JS)
        ready = m["anim"] == "idle" and m["ghosts"] == want_ghosts and m["clarity"] and len(m["plates"]) >= 2
        if ready and last and m["plates"] == last["plates"]:
            return m
        last = m if ready else None
        page.wait_for_timeout(350)
    raise AssertionError(f"the pre-snap never settled: {page.evaluate(MEASURE_JS)}")


# ---------------------------------------------------------------- the checks
def overlap(a, b, slack=0.5):
    return a[0] < b[2] - slack and b[0] < a[2] - slack and a[1] < b[3] - slack and b[1] < a[3] - slack


def on_plate(box, pts):
    return [p for p in pts if box[0] + AA_PX < p[0] < box[2] - AA_PX and box[1] + AA_PX < p[1] < box[3] - AA_PX]


def seg_dist(p, a, b):
    ab = (b[0] - a[0], b[1] - a[1])
    l2 = ab[0] ** 2 + ab[1] ** 2
    k = 0 if l2 < 1e-12 else max(0.0, min(1.0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2))
    return math.hypot(p[0] - (a[0] + ab[0] * k), p[1] - (a[1] + ab[1] * k))


def ground_gap(s, t):
    """The least distance on the turf between two strokes (an arc's footprint is its ground track)."""
    pts = lambda st: ((st["from"]["x"], st["from"]["y"]), (st["to"]["x"], st["to"]["y"]))  # noqa: E731
    (a, b), (c, d) = pts(s), pts(t)
    return min(seg_dist(a, c, d), seg_dist(b, c, d), seg_dist(c, a, b), seg_dist(d, a, b))


def check(m, seq, label):
    """Every 4b rule on one measured pre-snap; returns its counts."""
    tag = f"#{seq} {label}"
    plates, cl = m["plates"], m["clarity"]
    ball = [cl["ball"][k] for k in ("x0", "y0", "x1", "y1")]
    counts = {"plates": len(plates), "label_label": 0, "label_ball": 0, "label_stroke": 0}
    for i, p in enumerate(plates):
        counts["label_ball"] += overlap(p["box"], ball)
        counts["label_label"] += sum(overlap(p["box"], q["box"]) for q in plates[i + 1:])
        strokes = [pt for s in cl["shadows"] for pt in s["px"]] + (cl["last"]["px"] if cl.get("last") else [])
        hits = on_plate(p["box"], strokes)
        counts["label_stroke"] += bool(hits)
        assert not hits, f"{tag}: '{p['text']}' {p['box']} sits on a stroke at {hits[:3]}"
    assert counts["label_label"] == 0, f"{tag}: plates meet: {[p['text'] for p in plates]}"
    assert counts["label_ball"] == 0, f"{tag}: a plate on the ball {ball}: {[(p['text'], p['box']) for p in plates]}"
    top = [s for s in cl["shadows"] if not s["hovered"]][:2]
    assert len(top) == 2, f"{tag}: {cl['shadows']}"
    gap = ground_gap(top[0]["stroke"], top[1]["stroke"])
    counts["gap"] = gap
    assert gap >= TRIGGER_YD - EPS_YD, f"{tag}: the predictions {gap:.2f} yd apart"
    lanes = {s["lane"] for s in top}
    if lanes != {0}:
        assert gap >= FAN_YD - EPS_YD, f"{tag}: fanned only {gap:.2f} yd apart"
    assert all(s["dashed"] is True for s in top), f"{tag}: a prediction drawn solid"
    starts = [math.hypot(s["stroke"]["from"]["x"] - snap_x(seq), s["stroke"]["from"]["y"] - C) for s in top]
    assert min(starts) >= START_YD - 0.01, f"{tag}: a stroke starts {min(starts):.2f} yd from the ball"
    tags = sorted(p["tag"] for p in plates if p["tag"])
    assert "NEXT 1" in tags and "NEXT 2" in tags, f"{tag}: {tags}"
    assert top[0]["color"] != top[1]["color"], f"{tag}: #1 and #2 in one colour"
    if cl.get("last"):
        assert cl["last"]["dashed"] is False and cl["last"]["color"] not in {s["color"] for s in top}, \
            f"{tag}: the previous play styled as a prediction"
        last_plates = [p for p in plates if p["tag"] == "LAST"]
        assert len(last_plates) <= 1, f"{tag}: {last_plates}"
        assert all("is-last" in p["cls"] for p in last_plates)
    return counts


def snap_x(seq):
    row = next(r for r in ROWS if r["seq"] == seq)
    return row["geo"]["x0"]


# ---------------------------------------------------------------- the acceptance sweep
def sweep(browser, base, query, sizes_for, seqs=None):
    """Step the watch through every Dallas pre-snap (or `seqs`), measuring each page that `sizes_for(seq)` names."""
    targets = [t for t in dallas_presnaps() if seqs is None or t[1] in seqs]
    sizes = sorted({s for t in targets for s in sizes_for(t[1])})
    pause_at(base, targets[0][2])
    pages = {size: open_page(browser, base, size, query) for size in sizes}
    totals = {size: {"snaps": 0, "label_label": 0, "label_ball": 0, "label_stroke": 0, "min_gap": 99.0}
              for size in sizes}
    try:
        for i, seq, prev in targets:
            if watch_idx(base) != prev:
                pause_at(base, prev)
                for page in pages.values():
                    wait_drawn(page, ROWS[prev - 1]["seq"])
            api_post(base, "/api/watch/step")          # the previous play draws (and is graded), then the call goes up
            assert watch_idx(base) == prev + 1
            while watch_idx(base) < i:                 # a timeout between them draws nothing
                api_post(base, "/api/watch/step")
            want = " ".join(t["key"] for t in api_get(base, "/api/state")["prediction"]["top"][:2])
            for size in sizes_for(seq):
                wait_drawn(pages[size], ROWS[i - 1]["seq"])
                m = settled(pages[size], want)
                c = check(m, seq, f"{size[0]}x{size[1]}")
                t = totals[size]
                t["snaps"] += 1
                for k in ("label_label", "label_ball", "label_stroke"):
                    t[k] += c[k]
                t["min_gap"] = min(t["min_gap"], c["gap"])
        for size, page in pages.items():
            assert page.errors == [], f"{size}: {page.errors}"
    finally:
        for page in pages.values():
            page.context.close()
    return totals


def test_every_dallas_presnap_is_clear_at_1440_1920_and_on_sams_macbook(clarity_browser, wsrv):
    """All 59 Dallas pre-snaps at 1440x900 and 1920x1080, every 4th one (and Sam's two) in his 1512x982 window:
    0 plate-plate overlaps, 0 plates on the ball or a stroke, his two predictions in their own lanes."""
    snaps = [t[1] for t in dallas_presnaps()]
    mac = set(snaps[::MACBOOK_EVERY]) | set(SAM_SEQS)
    totals = sweep(clarity_browser, wsrv["base"], "debug=1",
                   lambda seq: SIZES + ((MACBOOK,) if seq in mac else ()))
    print("4b clarity:", json.dumps({f"{w}x{h}": t for (w, h), t in totals.items()}))
    for size in SIZES:
        assert totals[size]["snaps"] == 59, totals
    assert totals[MACBOOK]["snaps"] == len(mac), totals
    for t in totals.values():
        assert t["label_label"] == 0 and t["label_ball"] == 0 and t["label_stroke"] == 0, totals
        assert t["min_gap"] >= FAN_YD - EPS_YD, totals


def test_the_2d_field_keeps_the_same_rules(clarity_browser, wsrv):
    """The 2D fallback (?scene=2d) on a sample of pre-snaps, Sam's two among them: the same thin, colour-coded,
    tagged, separated and overlap-free pre-snap."""
    totals = sweep(clarity_browser, wsrv["base"], "debug=1&scene=2d", lambda seq: ((1440, 900),), seqs=SAMPLE_2D)
    print("4b clarity 2D:", json.dumps({f"{w}x{h}": t for (w, h), t in totals.items()}))
    t = totals[(1440, 900)]
    assert t["snaps"] == len(SAMPLE_2D)
    assert t["label_label"] == 0 and t["label_ball"] == 0 and t["label_stroke"] == 0, t


# ---------------------------------------------------------------- the LAST plate after a jump (4b rule 2)
JUMPS = (                       # (plays applied, the play on display, its verdict as the plate reads it)
    (126, "Short pass left · +11", "TOP PICK · 19%"),                 # Q3 2:52, before snap 127 (Sam's first)
    (151, "Short pass left · +15", "MISS · #4 Intermediate · 10%"),   # before snap 152 (his second)
)
LAST_PLATE_JS = """() => {
  const plate = document.querySelector('#field .sc-field-label > .sc-play-label.is-last');
  const part = (cls) => plate?.querySelector(cls)?.textContent ?? null;
  return plate && { tag: part('.sc-label-tag'), body: part('.sc-label-body'), sub: part('.sc-label-sub') };
}"""


def test_a_jump_keeps_the_last_plates_verdict(clarity_browser, wsrv):
    """4b rule 2 after a progress-bar jump (POST /api/watch/seek, never a step): the field draws the game at once, so
    no verdict is marked as a play lands, and the previous play's LAST plate still reads its verdict under its words,
    as a watched play's does. The world's CSS sets the case ("TOP PICK" under the lights)."""
    base = wsrv["base"]
    stop_watch(base)
    api_post(base, "/api/feed", {"on": False})
    api_post(base, "/api/watch/seek", {"idx": 0})               # Reset: the page opens at kickoff, then jumps
    page = open_page(clarity_browser, base, SIZES[0], "debug=1")
    try:
        for idx, body, sub in JUMPS:
            api_post(base, "/api/watch/seek", {"idx": idx})
            assert watch_idx(base) == idx
            want = " ".join(t["key"] for t in api_get(base, "/api/state")["prediction"]["top"][:2])
            wait_drawn(page, ROWS[idx - 1]["seq"])
            settled(page, want)
            plate = page.evaluate(LAST_PLATE_JS)
            assert plate and (plate["tag"], plate["body"]) == ("LAST", body), f"idx {idx}: {plate}"
            assert (plate["sub"] or "").upper() == sub.upper(), f"idx {idx}: the verdict line is missing: {plate}"
        assert page.errors == [], page.errors
    finally:
        page.context.close()

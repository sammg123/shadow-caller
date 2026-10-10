"""The boards that read (v1.5, G4), end to end on Sam's world, Under the Lights, at 1440x900 and 1920x1080:

  - the video board earns its keep off the field (his night so far, led by a touchdown) and at FINAL (the score,
    SHADOW v LEAGUE's three lines, the stat board's key; the strip never asks for the next spot);
  - the main screen names the play-caller it shadows, whole, and the board's plate names him too;
  - on 4th down the board says the call is the play if he goes for it;
  - SHADOW v LEAGUE reads true: what "called right" measures, the basis once, the trailing side dimmed, a tie on
    screen lights no lamp and no red, the values in the accessibility tree;
  - the board never clips (the then-line holds to one line) and its rows are tappable;
  - the stat board shows every pair whole; forced colors drop the unlit 8s.

Every test sets its own server state (FI 6.1) on the scaled-pace watch sandbox and leaves no session running. Each
capture lands in test-results/visual/boards/ for a person to look at."""
import math

import pytest
from playwright.sync_api import expect
from ui_helpers import (BOOT_TIMEOUT_MS, TOTAL_ROWS, expect_off_field, fixed, full_timeline, pct, state, stop_watch,
                        wait_idle, wait_ready)
from uls_scenes import replayed, watch_paused_at

from helpers import ROOT

pytestmark = pytest.mark.e2e

WORLD_ID = "under-the-lights"
SIZES = ((1440, 900), (1920, 1080))
SIZE_IDS = [f"{w}x{h}" for w, h in SIZES]
SHOTS = ROOT / "test-results" / "visual" / "boards"
TB_DRIVE_IDX = 20       # Dallas's first drive ended in a touchdown (seq 12); Tampa Bay is on its first drive
FOURTH_IDX = 42         # seq 43 is next: 4th & 10 at DAL 44 (Dallas punts)
WRAP_IDX = 3            # the first Dallas snap whose then-line ran to two lines at 1440 and cut the fifth family
BAND_PAIRS = ("called_right", "top3", "passrun_logloss")
LED_DIM = "rgb(185, 173, 146)"            # --uls-led-dim, #B9AD92
DOTO_MIN_PX = 40                          # The 40 Pixel Rule
TARGET_MIN_PX = 24                        # a pointer's target (WCAG 2.2 target size, minimum)


@pytest.fixture
def wsrv(watch_server):
    """The scaled-pace sandbox; a session a test leaves behind is stopped with the game put back."""
    yield watch_server
    stop_watch(watch_server["base"])


def open_uls(ui_pages, base, size, reduced_motion=True):
    page = ui_pages(*size, reduced_motion=reduced_motion)
    page.goto(f"{base}/?world={WORLD_ID}", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    wait_ready(page)
    expect(page.locator("#field")).to_have_attribute("data-scene-ready", "true", timeout=BOOT_TIMEOUT_MS)
    page.evaluate("document.fonts.ready.then(() => true)")
    page.mouse.move(5, size[1] // 2)              # off the board, so it stays its own size
    return page


def capture(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))


def no_errors(page):
    assert page.errors == [], page.errors
    assert page.bad_responses == [], page.bad_responses


def text(locator):
    return " ".join(locator.text_content().split())


def percent(p):
    """Math.round(p * 100), as the board's spoken words have it."""
    return math.floor(p * 100 + 0.5)


FITS_JS = """sel => { const face = document.querySelector(sel); const board = document.querySelector('.uls-board');
  const b = board.getBoundingClientRect(), f = face.getBoundingClientRect();
  const kids = [...face.querySelectorAll('*')].filter(e => e.getClientRects().length && getComputedStyle(e).position !== 'absolute');
  const cut = kids.filter(e => { const r = e.getBoundingClientRect(); return r.bottom > b.bottom - 7.5 || r.right > b.right + 0.5; })
    .map(e => e.className);
  return { cut, wide: face.scrollWidth - face.clientWidth, board: [Math.round(b.width), Math.round(b.height)] }; }"""


def fits_on_the_board(page, sel, size):
    got = page.evaluate(FITS_JS, sel)
    assert got["cut"] == [] and got["wide"] <= 0, got
    want = {1440: [416, 324], 1920: [560, 430]}[size[0]]
    assert got["board"] == want, f"the board is {got['board']}, DESIGN.md says {want}"


def font_px(page, sel):
    return page.locator(sel).first.evaluate("e => parseFloat(getComputedStyle(e).fontSize)")


# ---------------------------------------------------------------- G4-1: off the field, his night so far
@pytest.mark.parametrize("size", SIZES, ids=SIZE_IDS)
def test_off_the_field_the_board_recaps_his_night(ui_pages, wsrv, size):
    """Tampa Bay's first drive: the board recaps Dallas's touchdown (the referee's signal, the call it made with its
    odds, the field's words, the verdict), the night's tally and his last verdicts, and still says DAL is off the
    field; everything fits the 416 x 324 (560 x 430) board with Doto at 40 px or more."""
    base = wsrv["base"]
    watch_paused_at(base, TB_DRIVE_IDX)
    page = open_uls(ui_pages, base, size)
    wait_idle(page, TB_DRIVE_IDX)
    s = state(base)
    last, g = s["log"][0], s["metrics"]["granular"]
    hero = page.locator("#heroArea")
    expect(hero).to_have_attribute("data-kind", "recap")
    face = page.locator(".sc-recap")
    expect(face.locator(".sc-face-kicker")).to_have_text("Schottenheimer so far")
    lead = face.locator(".sc-recap-lead")
    expect(lead).to_have_attribute("data-lead", "td")
    expect(lead).to_have_text("Touchdown")
    expect(face.locator(".sc-recap-name")).to_have_text(s["leaf_names"][last["top_leaf"]])
    expect(face.locator(".sc-recap-pct")).to_have_text(pct(last["top_leaf_p"]))
    assert text(face.locator(".sc-recap-happened")).endswith("· TD")
    verdict = "top1" if last["leaf_rank"] == 1 else "top3" if last["leaf_rank"] <= 3 else "miss"
    expect(face.locator(".sc-recap-verdict")).to_have_attribute("data-verdict", verdict)
    assert text(face.locator(".sc-recap-tally")) == (
        f"Top pick {g['leaf_top1']} of {g['leaf_n']} · In his top 3 {g['leaf_top3']} of {g['leaf_n']}")
    expect(face.locator(".sc-recap-dot")).to_have_count(min(6, len(s["log"])))
    expect_off_field(page)                                       # the e2e helpers' line, still on the face
    assert font_px(page, ".sc-recap-pct") >= DOTO_MIN_PX
    fits_on_the_board(page, ".sc-recap", size)
    capture(page, f"recap-tb-drive-{size[0]}x{size[1]}")
    no_errors(page)


# ---------------------------------------------------------------- G4-1: FINAL
@pytest.mark.parametrize("size", SIZES, ids=SIZE_IDS)
def test_at_the_final_whistle_the_board_says_final(ui_pages, wsrv, size):
    """Replay to the end: FINAL, the score in LED digits, SHADOW v LEAGUE's three lines and the stat board's key on the
    board, never the Ball-on instruction; the strip says the game is over; G opens the stat board and the board keeps
    its size under the pointer."""
    base = wsrv["base"]
    replayed(base)
    page = open_uls(ui_pages, base, size)
    wait_idle(page, TOTAL_ROWS)
    s, status = state(base), full_timeline(base)["status"]
    assert status["state"] == "post"
    m, g = s["metrics"], s["metrics"]["granular"]
    expect(page.locator("#heroArea")).to_have_attribute("data-kind", "final")
    face = page.locator(".sc-final")
    expect(face.locator(".sc-face-kicker")).to_have_text("Final")
    for abbr, score in status["score"].items():
        expect(face.locator(f'.sc-final-team[data-team="{abbr}"] .sc-digits-value')).to_have_text(str(score))
    lines = face.locator(".sc-final-line")
    assert lines.evaluate_all("els => els.map(e => e.dataset.pair)") == list(BAND_PAIRS)
    brief = lambda x, dp: fixed(x, dp).removeprefix("0")               # noqa: E731
    assert [text(lines.nth(i)) for i in range(3)] == [
        f"Run/pass right {pct(m['acc_model'])} v {pct(m['acc_league'])}",
        f"Play in top 3 {g['leaf_top3']} v {g['leaf_top3_league']}",
        f"Pass vs run log loss {brief(m['logloss_model'], 3)} v {brief(m['logloss_league'], 3)}"]
    expect(page.locator("#heroArea .sc-offfield")).to_be_hidden()
    expect(face).not_to_contain_text("Ball on")
    expect(page.locator("#driveInfo")).to_have_text("Final. Replay or watch another game from the booth (B).")
    fits_on_the_board(page, ".sc-final", size)
    capture(page, f"final-{size[0]}x{size[1]}")
    key = face.locator(".sc-key")
    before = page.locator(".uls-board").bounding_box()
    key.hover()
    after = page.locator(".uls-board").bounding_box()
    assert (round(after["width"]), round(after["height"])) == (round(before["width"]), round(before["height"]))
    key.click()
    expect(page.locator("#app")).to_have_attribute("data-scorecard-open", "true")
    no_errors(page)


# ---------------------------------------------------------------- G4-2: the masthead and the board's plate
@pytest.mark.parametrize("size", SIZES, ids=SIZE_IDS)
def test_the_main_screen_names_the_caller_it_shadows(ui_pages, wsrv, size):
    """The nameplate's line names the caller whole, no ellipsis; its tooltip has every word; the board's plate names
    him; the B and G keys name their letters; the call's live region speaks one sentence."""
    base = wsrv["base"]
    watch_paused_at(base, 1)
    page = open_uls(ui_pages, base, size)
    s = state(base)
    expect(page.locator("#whoLabel")).to_have_text("Shadowing Schottenheimer · DAL")
    meta = page.locator(".sc-masthead-meta").evaluate("e => [e.scrollWidth, e.clientWidth]")
    assert meta[0] <= meta[1], f"the nameplate's line is cut: {meta}"
    expect(page.locator(".sc-masthead-plate")).to_have_attribute(
        "title", f"{s['game']['label']} · Modelling Brian Schottenheimer (DAL offense)")
    expect(page.locator(".sc-call-kicker")).to_have_text(f"Schottenheimer's next call · Snap {s['prediction']['snap_next']}")
    expect(page.locator('[data-testid="booth-toggle"] .sc-key-name')).to_have_text("Booth (B)")
    expect(page.locator('[data-testid="scorecard-toggle"] .sc-key-name')).to_have_text("Scorecard (G)")
    top = s["prediction"]["top"]
    expect(page.locator(".sc-board-spoken")).to_have_text(
        f"Next call, snap {s['prediction']['snap_next']}: {top[0]['name']}, {percent(top[0]['p'])} percent. "
        f"Then {top[1]['name']}, {percent(top[1]['p'])} percent.")
    capture(page, f"masthead-{size[0]}x{size[1]}")
    no_errors(page)


# ---------------------------------------------------------------- G4-4: 4th down
def test_on_fourth_down_the_call_is_if_he_goes_for_it(ui_pages, wsrv):
    """4th & 10 at DAL 44, before the punt: the plate says the call is the play if he goes for it, and why."""
    base = wsrv["base"]
    watch_paused_at(base, FOURTH_IDX)
    assert state(base)["sit"]["down"] == 4
    page = open_uls(ui_pages, base, SIZES[0])
    expect(page.locator(".sc-call")).to_have_attribute("data-fourth", "true")
    expect(page.locator(".sc-call-label")).to_have_text("4th down · if he goes for it")
    title = page.locator(".sc-call-kicker").get_attribute("title")
    assert "if he goes for it" in title and "no punt or field-goal class" in title, title
    capture(page, "fourth-down-1440x900")
    no_errors(page)


# ---------------------------------------------------------------- G4-3: SHADOW v LEAGUE
def test_shadow_v_league_reads_true(ui_pages, wsrv):
    """The band: the captions say what each pair measures, the basis once under the plate, the trailing value dimmed,
    the values in the accessibility tree. The stat board: 1.62 v 1.62 is even, no lamp, no red."""
    base = wsrv["base"]
    replayed(base)
    page = open_uls(ui_pages, base, SIZES[0])
    m = state(base)["metrics"]
    band = page.locator("#rg-score")
    assert [text(band.locator(f'[data-pair="{p}"] .sc-card-plabel')) for p in BAND_PAIRS] == [
        "Run/pass right", "Play in top 3", "Pass vs run log loss"]
    expect(band.locator(".sc-card-basisline")).to_have_text(f"his model v league baseline · {m['n']} snaps")
    expect(band.locator(".sc-card-basisline")).to_be_visible()
    expect(band.locator('[data-pair="called_right"] .sc-card-basis')).to_be_hidden()
    called = band.locator('[data-pair="called_right"]')
    expect(called).to_have_attribute("data-leader", "shadow")
    assert called.locator('[data-side="league"] .sc-card-brief').evaluate("e => getComputedStyle(e).color") == LED_DIM
    full = called.locator('[data-side="shadow"] .sc-card-full')
    assert full.evaluate("e => getComputedStyle(e).display") != "none", "the full value is in the accessibility tree"
    assert full.get_attribute("aria-hidden") is None
    page.keyboard.press("g")
    expect(page.locator("#app")).to_have_attribute("data-scorecard-open", "true")
    leaf = page.locator('#kpiArea [data-pair="leaf_logloss"]')
    expect(leaf).to_have_attribute("data-leader", "even")
    lit = leaf.locator(".sc-card-lamp").evaluate_all(
        "els => els.filter(e => getComputedStyle(e).backgroundColor === 'rgb(255, 178, 30)').length")
    assert lit == 0, "a tie on screen lights no lamp"
    his = page.locator('#kpiArea [data-group="leaf"] .sc-kpi-value').nth(2)
    expect(his).to_have_text("1.62")
    assert his.get_attribute("data-tone") is None, "his 1.62 against the league's 1.62 is not red"
    no_errors(page)


# ---------------------------------------------------------------- G4-5: the board never clips
def test_the_then_line_holds_to_one_line_and_the_board_never_clips(ui_pages, wsrv):
    """The snap whose then-line ran to two lines at 1440: it holds to one line now (the second play steps aside when
    it doesn't fit), the fifth family sits whole on the face; the open board's names never break and its rows are
    24 px tall at least."""
    base = wsrv["base"]
    watch_paused_at(base, WRAP_IDX)
    page = open_uls(ui_pages, base, SIZES[0])
    got = page.evaluate("""() => { const face = document.querySelector('.uls-board .sc-call');
      const then = face.querySelector('.sc-then'), box = face.querySelector('.sc-then-items');
      const lh = parseFloat(getComputedStyle(then).lineHeight), f = face.getBoundingClientRect();
      const fams = [...face.querySelectorAll('.sc-fams > .fam')];
      const shown = [...box.querySelectorAll('.sc-then-item')].filter(i => i.getBoundingClientRect().top < box.getBoundingClientRect().bottom);
      return { thenH: then.getBoundingClientRect().height, lh, shown: shown.length,
               cut: fams[fams.length - 1].getBoundingClientRect().bottom - f.bottom }; }""")
    assert got["thenH"] <= got["lh"] * 1.2, got
    assert got["shown"] >= 1 and got["cut"] <= 0, got
    page.locator(".uls-board").hover()
    rows = page.locator(".uls-board .leaf").evaluate_all("""els => els.map(e => ({ h: e.getBoundingClientRect().height,
      lines: Math.round(e.querySelector('.sc-leaf-name').getBoundingClientRect().height
        / parseFloat(getComputedStyle(e.querySelector('.sc-leaf-name')).lineHeight)) }))""")
    assert len(rows) == 14
    assert all(r["h"] >= TARGET_MIN_PX - 0.5 for r in rows), rows
    assert all(r["lines"] == 1 for r in rows), rows
    capture(page, "board-open-1440x900")
    no_errors(page)


# ---------------------------------------------------------------- G4-8: the stat board
@pytest.mark.parametrize("size", SIZES, ids=SIZE_IDS)
def test_the_stat_board_shows_every_pair_whole(ui_pages, wsrv, size):
    """G after a replay: the SHADOW v LEAGUE pairs stand two to a row and every one sits whole on the board, with the
    specific-play group's two counts in view."""
    base = wsrv["base"]
    replayed(base)
    page = open_uls(ui_pages, base, size)
    page.keyboard.press("g")
    expect(page.locator("#app")).to_have_attribute("data-scorecard-open", "true")
    got = page.evaluate("""() => { const board = document.querySelector('.uls-statboard').getBoundingClientRect();
      const inside = (e) => { const r = e.getBoundingClientRect(); return r.top >= board.top && r.bottom <= board.bottom; };
      const pairs = [...document.querySelectorAll('#kpiArea .sc-card-pair')];
      const counts = [...document.querySelectorAll('#kpiArea [data-group="leaf"] .sc-kpi')].slice(0, 2);
      return { lefts: [...new Set(pairs.map(p => Math.round(p.getBoundingClientRect().left)))].length,
               whole: pairs.every(inside), counts: counts.every(inside) }; }""")
    assert got == {"lefts": 2, "whole": True, "counts": True}, got
    capture(page, f"statboard-{size[0]}x{size[1]}")
    no_errors(page)


# ---------------------------------------------------------------- G4-10: forced colors
def test_forced_colors_drop_the_unlit_eights_and_keep_lit_states(ui_pages, wsrv):
    """Under forced colors the unlit 8s go (0-0 never reads 80 80), a pressed key keeps a Highlight frame, and a lit
    lamp keeps its own system colors."""
    base = wsrv["base"]
    watch_paused_at(base, TB_DRIVE_IDX)
    page = open_uls(ui_pages, base, SIZES[0])
    page.emulate_media(forced_colors="active")
    page.keyboard.press("b")                                     # the booth key is on (aria-expanded)
    expect(page.locator("#app")).to_have_attribute("data-booth-open", "true")
    got = page.evaluate("""() => ({
      ghost: getComputedStyle(document.querySelector('[data-testid="team-score"]'), '::before').content,
      key: getComputedStyle(document.querySelector('[data-testid="booth-toggle"]')).outlineStyle,
      lamp: getComputedStyle(document.querySelector('.sc-sb-poss[data-on="true"]')).forcedColorAdjust })""")
    assert got == {"ghost": "none", "key": "solid", "lamp": "none"}, got
    capture(page, "forced-colors-1440x900")
    no_errors(page)

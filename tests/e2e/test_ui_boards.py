"""The boards that read (v1.5, G4), end to end on Sam's world, Under the Lights, at 1440x900 and 1920x1080:

  - the main screen names the play-caller it shadows, whole, and the board's plate names him too;
  - on 4th down the board says the call is the play if he goes for it;
  - forced colors drop the unlit 8s.
(restructure-v2.md 1 and 3: the band's SHADOW v LEAGUE row and the stat board left the GameCast for the Model Report,
and the board became one card, PREVIOUS PLAY, NEXT CALL and LAST 6 at once, whose faces, fit and type test_ui_card.py
checks.)

Every test sets its own server state (FI 6.1) on the scaled-pace watch sandbox and leaves no session running. Each
capture lands in test-results/visual/boards/ for a person to look at."""
import math

import pytest
from playwright.sync_api import expect
from ui_helpers import BOOT_TIMEOUT_MS, state, stop_watch, wait_ready
from uls_scenes import watch_paused_at

from helpers import ROOT

pytestmark = pytest.mark.e2e

WORLD_ID = "under-the-lights"
SIZES = ((1440, 900), (1920, 1080))
SIZE_IDS = [f"{w}x{h}" for w, h in SIZES]
SHOTS = ROOT / "test-results" / "visual" / "boards"
TB_DRIVE_IDX = 20       # Dallas's first drive ended in a touchdown (seq 12); Tampa Bay is on its first drive
FOURTH_IDX = 42         # seq 43 is next: 4th & 10 at DAL 44 (Dallas punts)


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


def percent(p):
    """Math.round(p * 100), as the board's spoken words have it."""
    return math.floor(p * 100 + 0.5)


# ---------------------------------------------------------------- G4-2: the masthead and the board's plate
@pytest.mark.parametrize("size", SIZES, ids=SIZE_IDS)
def test_the_main_screen_names_the_caller_it_shadows(ui_pages, wsrv, size):
    """The nameplate's line names the caller whole, no ellipsis; its tooltip has every word; the board's plate names
    him; the top bar's view keys say what they do; the call's live region speaks one sentence."""
    base = wsrv["base"]
    watch_paused_at(base, 1)
    page = open_uls(ui_pages, base, size)
    s = state(base)
    expect(page.locator("#whoLabel")).to_have_text("Shadowing Schottenheimer · DAL")
    meta = page.locator(".sc-masthead-meta").evaluate("e => [e.scrollWidth, e.clientWidth]")
    assert meta[0] <= meta[1], f"the nameplate's line is cut: {meta}"
    expect(page.locator(".sc-masthead-plate")).to_have_attribute("title", "Modelling Brian Schottenheimer (DAL offense)")
    expect(page.locator("#gameLabel")).to_have_attribute("title", s["game"]["label"])
    expect(page.locator(".sc-call-kicker")).to_have_text(f"Schottenheimer's next call · Snap {s['prediction']['snap_next']}")
    expect(page.locator('[data-testid="model-report"] .sc-key-name')).to_have_text("Model Report")
    expect(page.locator('[data-testid="settings-toggle"] .sc-key-name')).to_have_text("Settings")
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


# ---------------------------------------------------------------- G4-10: forced colors
def test_forced_colors_drop_the_unlit_eights_and_keep_lit_states(ui_pages, wsrv):
    """Under forced colors the unlit 8s go (0-0 never reads 80 80), a pressed key keeps a Highlight frame, and a lit
    lamp keeps its own system colors."""
    base = wsrv["base"]
    watch_paused_at(base, TB_DRIVE_IDX)
    page = open_uls(ui_pages, base, SIZES[0])
    page.emulate_media(forced_colors="active")
    page.locator('[data-testid="settings-toggle"]').click()     # the settings key is on (aria-expanded)
    expect(page.locator('[data-testid="settings-toggle"]')).to_have_attribute("aria-expanded", "true")
    got = page.evaluate("""() => ({
      ghost: getComputedStyle(document.querySelector('[data-testid="team-score"]'), '::before').content,
      key: getComputedStyle(document.querySelector('[data-testid="settings-toggle"]')).outlineStyle,
      lamp: getComputedStyle(document.querySelector('.sc-sb-poss[data-on="true"]')).forcedColorAdjust })""")
    assert got == {"ghost": "none", "key": "solid", "lamp": "none"}, got
    capture(page, "forced-colors-1440x900")
    no_errors(page)

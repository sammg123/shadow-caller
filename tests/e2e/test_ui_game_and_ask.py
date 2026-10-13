"""The game picker and the Ask slide-out on the GameCast, end to end (restructure-v2.md 11; game-picker.md 3 to 5;
analyst-ui.md 4), on WORLD (ui_helpers; Sam runs it with SC_E2E_WORLD=under-the-lights).

The picker: the top bar's game key opens the 2026 season (offline: the saved weeks); while it is open no page
shortcut fires (it is modal) and Escape closes it without going live; TB at DAL with "Track both sides" lights both
sides and opens the game (POST /api/game/select); the page follows the new track without a reload: the plate names
both play-callers and the key the game, and the card follows the offense with the ball, headed with that caller's
name. Ask: the key shows once the analyst's status is read, and the drawer it opens says the analyst is ready, or
why it isn't (Ollama not reachable), as flat stadium hardware; the page's keys stand down inside it and its Escape
closes it without going live.

Runs on a sandbox of its own (offline, the saved TB at DAL game), so switching games never touches another test's."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (QUIET_MS, WORLD, api_get, api_post, blur, call, load, quiet, record_requests, reset_game,
                        sandbox, state, until)

pytestmark = pytest.mark.e2e

EVENT = "401872980"                     # TB at DAL, 2026 week 5 (the saved game)
SIDES = ["TB", "DAL"]                   # away, then home: how the picker sends both sides
TB_BALL_IDX = 104                       # the interception applied: Tampa Bay has the ball (test_ui_card.py)
DAL_BALL_IDX = 126                      # "Short pass left · +11" applied: Dallas's snap is next (test_ui_card.py)
SELECT_TIMEOUT_MS = 60_000              # two callers' models load and the game is rebuilt on the server
TRIGGER = ".sc-picker-trigger"
PANEL = ".sc-picker-panel"
ASK_KEY = '[data-testid="ask"]'
DRAWER = '[data-testid="ask-panel"]'
QUIET_THREADS = {"OMP_NUM_THREADS": "1", "KMP_BLOCKTIME": "0"}


@pytest.fixture(scope="module")
def own_server(tmp_path_factory):
    with sandbox(tmp_path_factory, QUIET_THREADS) as srv:
        yield srv


def last_name(full):
    words = [w for w in full.split() if not re.fullmatch(r"(jr|sr|ii|iii|iv|v)\.?", w, re.I)]
    return words[-1] if words else ""


def watch_idx(base):
    return api_get(base, "/api/watch")["idx"]


def no_page_errors(page):
    assert [e for e in page.errors if e.startswith("pageerror")] == [], page.errors


def open_picker(page):
    page.locator(TRIGGER).click()
    expect(page.locator(PANEL)).to_be_visible()
    expect(page.locator(PANEL)).to_have_attribute("data-sc-layer", "modal")


def test_the_picker_opens_tb_at_dal_with_both_sides_and_the_page_follows(ui_pages, own_server):
    base = own_server["base"]
    reset_game(base)
    page = ui_pages()
    load(page, base)
    expect(page.locator("#gameLabel")).to_have_text(re.compile(r"^TB at DAL"))
    at = watch_idx(base)

    # modal: with the picker open no page shortcut fires, focus anywhere; Escape closes it and never goes live
    open_picker(page)
    page.locator(".sc-picker-title").click()                 # inside it, on nothing focusable: focus on the page
    sent = record_requests(page, "/api/")
    for key in ("ArrowRight", "ArrowLeft", "v", "2"):
        page.keyboard.press(key)
    quiet(page, QUIET_MS)
    assert [r["path"] for r in sent] == [], sent
    page.keyboard.press("Escape")
    expect(page.locator(PANEL)).to_be_hidden()
    quiet(page, QUIET_MS)
    assert [r["path"] for r in sent] == [] and watch_idx(base) == at, "Escape closed the picker; it never went live"

    # TB at DAL, both sides: both lamps lit at once, and Open sends exactly that
    open_picker(page)
    game = page.locator(f'.sc-picker-game[data-event="{EVENT}"]')
    expect(game).to_be_visible()
    game.click()
    expect(page.locator(".sc-picker-chosen")).to_be_visible()
    both = page.locator(".sc-picker-both-box")
    expect(both).to_be_enabled()
    both.check()
    radios = page.locator(".sc-picker-side-box")
    expect(radios).to_have_count(2)
    for i in range(2):
        expect(radios.nth(i)).to_be_checked()                  # restructure-v2.md 11 item 5: both sides selected
    selects = record_requests(page, "/api/game/select")
    page.locator(".sc-picker-go").click()
    expect(page.locator(PANEL)).to_be_hidden()
    until(page, lambda: len(selects) == 1, what="the selection to go out")
    assert selects[0]["body"] == {"event_id": EVENT, "sides": SIDES}, selects

    # the page follows the new track: the plate names both callers, the key the game
    until(page, lambda: sorted(state(base).get("track", {}).get("sides", [])) == sorted(SIDES),
          timeout_ms=SELECT_TIMEOUT_MS, what="the server to open both sides")
    s = state(base)
    callers = {t["team"]: t["caller"] for t in s["tracked"]}
    assert set(callers) == set(SIDES), s["tracked"]
    who = f"Shadowing {last_name(callers['TB'])} · TB and {last_name(callers['DAL'])} · DAL"
    expect(page.locator("#whoLabel")).to_have_text(who, timeout=SELECT_TIMEOUT_MS)
    detail = ((s.get("watch") or {}).get("game") or {}).get("detail")
    expect(page.locator("#gameLabel")).to_have_text(f"TB at DAL · {detail}" if detail else "TB at DAL")

    # the card follows the offense with the ball, headed with that caller's name (restructure-v2.md 11 decision 4); the
    # field draws that offense's ball from its own side (Tampa Bay attacks right to left) with its shadow plays
    kicker = page.locator("#heroArea .sc-call-kicker")
    field = page.locator("#field")
    for idx, team in ((TB_BALL_IDX, "TB"), (DAL_BALL_IDX, "DAL")):
        api_post(base, "/api/watch/seek", {"idx": idx})
        s = state(base)
        pred = s["prediction"]
        assert pred and pred.get("team") == team and s["poss"] == team, (idx, pred and pred.get("team"), s["poss"])
        expect(kicker).to_have_text(re.compile(rf"^{re.escape(last_name(callers[team]))}'s next call"),
                                    timeout=SELECT_TIMEOUT_MS)
        yl = s["sit"]["yardline_100"]
        expect(field).to_have_attribute("data-poss", team)
        expect(field).to_have_attribute("data-ball-x", f"{yl if team == 'TB' else 100 - yl:g}")
        expect(field).to_have_attribute("data-ghosts", re.compile(r"^\S+ \S+$"))
    no_page_errors(page)


def test_ask_shows_whether_the_analyst_can_answer_and_keeps_its_keys(ui_pages, own_server):
    base = own_server["base"]
    reset_game(base)
    page = ui_pages()
    load(page, base)
    status_code, status = call(base, "/api/ask/status")
    assert status_code == 200, f"the analyst's blueprint answers its status: {status_code} {status}"
    key = page.locator(ASK_KEY)
    expect(key).to_be_visible()
    if status["ready"]:
        expect(key).to_have_attribute("data-status", re.compile(r"^(ready|warming|busy)$"))
        expect(key.locator(".sc-key-value")).to_have_text("")
    else:
        expect(key).to_have_attribute("data-status", "down")
        expect(key.locator(".sc-key-value")).to_have_text("Not ready")
        expect(key).to_have_attribute("title", status["message"])

    key.click()
    drawer = page.locator(DRAWER)
    expect(drawer).to_be_visible()
    expect(key).to_have_attribute("aria-expanded", "true")
    expect(page.locator("html")).to_have_attribute("data-ask", "open")
    word = drawer.locator(".sc-ask-state-word")
    if status["ready"]:
        expect(word).to_have_text(re.compile(r"^(Ready|Warming up|Busy)$"))
    else:
        expect(word).to_have_text("Not ready")
        expect(drawer.locator(".sc-ask-note")).to_have_text(status["message"])
    if WORLD == "under-the-lights":
        assert drawer.evaluate("e => getComputedStyle(e).boxShadow") == "none", "flat hardware: the skin wins"
        board = page.locator(".uls-board").bounding_box()
        box = drawer.bounding_box()
        assert box["x"] + box["width"] <= board["x"], ("the drawer never covers the video board", box, board)

    # the page's keys stand down inside the drawer; its Escape closes it and never goes live
    at = watch_idx(base)
    camera = page.locator('[data-testid="camera-mode"]').get_attribute("data-camera")
    drawer.locator('[data-testid="ask-close"]').focus()
    for k in ("ArrowRight", "ArrowLeft", "v", "3"):
        page.keyboard.press(k)
    quiet(page, QUIET_MS)
    assert watch_idx(base) == at
    assert page.locator('[data-testid="camera-mode"]').get_attribute("data-camera") == camera
    page.keyboard.press("Escape")
    expect(drawer).to_be_hidden()
    expect(key).to_be_focused()
    quiet(page, QUIET_MS)
    assert watch_idx(base) == at, "Escape closed the drawer; it never went live"
    blur(page)
    no_page_errors(page)

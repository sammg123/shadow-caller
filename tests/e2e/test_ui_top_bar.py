"""The top bar, end to end (restructure-v2.md 1, 2, 4 and 9), on WORLD (ui_helpers; SC_E2E_WORLD=under-the-lights for
Sam's world): playback (step back, Play or Pause, step forward, the four speeds, the progress bar with the game's
drives on it, its count, Reset and Go Live), the camera (Wide or Blimp, V), the Model Report link and the settings
menu, driven by mouse and by keys. The page opens its game on load (POST /api/open: the saved game is final, so it
opens paused at kickoff), every move goes through the server's playback routes, the field snaps to where the game is,
nothing on the page takes typing, presses never stack requests, and nothing reaches the console.

Runs on the scaled-pace watch sandbox (conftest `watch_server`, offline, the saved TB at DAL game); every test sets
its own state and leaves no session running."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (CAMERAS, WORLD, api_get, blur, full_timeline, load, quiet, record_requests, reset_game,
                        seek_game, stop_watch, until, wait_idle)

pytestmark = pytest.mark.e2e

TRANSPORT = '[data-testid="transport"]'
PROGRESS = '[data-testid="progress"]'
COUNT = '[data-testid="progress-count"]'
CAMERA = '[data-testid="camera-mode"]'
SETTINGS = '[data-testid="settings-toggle"]'
SCORE_TICKS = f'{PROGRESS} .sc-progress-mark[data-kind="score"]'
SPEEDS = ["1", "2", "4", "10"]          # the speed keys' data-speed, in key order (1 to 4)
MID = 40                                # a paused watch with 40 of the saved game's plays applied
PLAYS_BEFORE_PAUSE = 3
PLAYBACK = ("/api/open", "/api/watch/seek", "/api/watch/back", "/api/watch/forward", "/api/golive",
            "/api/watch/pause", "/api/watch/resume")
GONE = ("#entry", "#entryHint", "#manualEntry", "#flagPanel", "#lastPlay", "#kpiArea", "#logArea", "#replayBtn",
        '[data-testid="booth-toggle"]', '[data-testid="scorecard-toggle"]', '[data-testid="review"]',
        'a[href="/api/export.csv"]')
TYPING = "#app input:not([type=checkbox]), #app textarea, #app select, #app [contenteditable]"


@pytest.fixture
def wsrv(watch_server):
    yield watch_server
    stop_watch(watch_server["base"])


def key(name):
    return f'{TRANSPORT} [data-transport="{name}"]'


def total(base):
    return api_get(base, "/api/watch")["total"]


def idx_of(base):
    return api_get(base, "/api/watch")["idx"]


def last_seq(base):
    """The seq of the newest timeline row: what #field has drawn once it snaps to where the game is."""
    return max((r["seq"] for r in full_timeline(base)["rows"]), default=0)


def at_kickoff(page, base):
    """A first visit: nothing running, so the page opens the saved final game paused at kickoff."""
    reset_game(base)
    load(page, base)


def at_play(page, base, idx):
    seek_game(base, idx)
    load(page, base)


def expect_at(page, idx, n):
    """The count, the slider and the server agree that `idx` of `n` plays are applied."""
    expect(page.locator(COUNT)).to_have_text(f"{idx} / {n}")
    expect(page.locator(PROGRESS)).to_have_attribute("aria-valuenow", str(idx))


def expect_settled(page, base):
    """No playback request on its way, and the count where the server is."""
    expect(page.locator("#app")).to_have_attribute("data-playback", "")
    expect_at(page, idx_of(base), total(base))


def moved(page, base, before, sign):
    """The game moved from `before` (on for sign 1, back for -1) and the page is where the server is; the new idx."""
    until(page, lambda: (idx_of(base) - before) * sign > 0, what="a play " + ("on" if sign > 0 else "back"))
    expect_settled(page, base)
    return idx_of(base)


def drive_starts(page, n):
    """The drive ticks' plays, read off the bar (each tick sits at its play's share of the game)."""
    return page.locator(f'{PROGRESS} .sc-progress-mark[data-kind="drive"]').evaluate_all(
        f"els => els.map(e => Math.round(parseFloat(e.style.getPropertyValue('--sc-at')) * {n}))")


def test_the_top_bar_reads_and_nothing_on_the_page_takes_typing(ui_pages, wsrv):
    """Every control is a labelled key a first-time viewer understands; the count says where the game is; the drives
    and quarters are ticks on the bar (a score only once its play is in: no spoilers at kickoff); the camera says its
    view; the Model Report is a link; Ask waits for phase 4; and the entry pad, flags, strip, booth and stat board are
    gone with every input they had."""
    page = ui_pages()
    base = wsrv["base"]
    at_kickoff(page, base)
    n = total(base)
    expect(page.locator(TRANSPORT)).to_be_visible()
    for name, words in (("back", "Back"), ("play", "Play"), ("forward", "Forward"), ("reset", "Reset"),
                        ("live", "Go Live")):
        expect(page.locator(key(name))).to_be_visible()
        expect(page.locator(key(name))).to_contain_text(words)
    speeds = page.locator(f"{TRANSPORT} [data-speed]")
    assert speeds.evaluate_all("els => els.map(e => e.dataset.speed)") == SPEEDS
    expect(speeds.locator("visible=true")).to_have_count(len(SPEEDS))
    expect(page.locator(f'{TRANSPORT} [data-speed][aria-pressed="true"]')).to_have_count(1)
    expect_at(page, 0, n)
    expect(page.locator(PROGRESS)).to_have_attribute("aria-valuetext", "Kickoff")
    expect(page.locator(PROGRESS)).to_have_attribute("aria-valuemax", str(n))
    expect(page.locator(key("back"))).to_be_disabled()
    expect(page.locator(key("forward"))).to_be_enabled()
    kinds = page.locator(f"{PROGRESS} .sc-progress-mark").evaluate_all("els => els.map(e => e.dataset.kind)")
    assert set(kinds) == {"drive", "quarter"}, f"no score tick before its play (DC E5): {kinds}"
    assert kinds.count("quarter") >= 3, kinds
    expect(page.locator(CAMERA)).to_contain_text(CAMERAS[0][1])
    report = page.locator('[data-testid="model-report"]')
    expect(report).to_be_visible()
    expect(report).to_contain_text("Model Report")
    assert report.evaluate("e => e.localName") == "a"
    assert report.get_attribute("href").startswith("/report"), report.get_attribute("href")
    expect(page.locator('[data-testid="ask"]')).to_be_hidden()
    assert page.locator(TYPING).count() == 0, "restructure-v2.md 1: nothing on the page takes typing"
    for gone in GONE:
        assert page.locator(gone).count() == 0, f"{gone} is gone with its feature"
    assert page.errors == [], page.errors


def test_play_and_pause_from_the_key_and_space(ui_pages, wsrv):
    """Play runs the game from where it is; Pause holds it there, and nothing lands while paused; Space does both."""
    page = ui_pages()
    base = wsrv["base"]
    at_kickoff(page, base)
    n = total(base)
    play = page.locator(key("play"))
    play.click()
    expect(page.locator("#app")).to_have_attribute("data-watch-state", "playing")
    expect(play).to_have_attribute("data-playing", "true")
    expect(play).to_contain_text("Pause")
    until(page, lambda: idx_of(base) >= PLAYS_BEFORE_PAUSE, timeout_ms=30_000, what="plays to land")
    blur(page)
    page.keyboard.press("Space")
    expect(page.locator("#app")).to_have_attribute("data-watch-state", "paused")
    expect(play).to_contain_text("Play")
    held = idx_of(base)
    quiet(page, 1200)
    assert idx_of(base) == held, "paused: no play lands"
    expect_at(page, held, n)
    page.keyboard.press("Space")
    expect(page.locator("#app")).to_have_attribute("data-watch-state", "playing")
    page.keyboard.press("Space")
    expect(page.locator("#app")).to_have_attribute("data-watch-state", "paused")
    assert page.errors == [], page.errors


def test_left_and_right_step_one_play_and_the_field_snaps_there(ui_pages, wsrv):
    """Right and the Forward key go one play on, Left and Back one play back, through the server; the field shows the
    play just run and nothing is replayed."""
    page = ui_pages()
    base = wsrv["base"]
    at_play(page, base, MID)
    n = total(base)
    expect_at(page, MID, n)
    blur(page)
    page.keyboard.press("ArrowRight")
    here = moved(page, base, MID, 1)
    wait_idle(page, last_seq(base))
    page.keyboard.press("ArrowLeft")
    here = moved(page, base, here, -1)
    page.locator(key("forward")).click()
    here = moved(page, base, here, 1)
    page.locator(key("back")).click()
    moved(page, base, here, -1)
    wait_idle(page, last_seq(base))
    assert api_get(base, "/api/watch")["state"] == "paused"
    assert page.errors == [], page.errors


def test_nothing_is_sent_past_either_end(ui_pages, wsrv):
    """At kickoff Back is off and Left sends nothing; at the end Forward is off and Right sends nothing (the server
    would refuse both, 409)."""
    page = ui_pages()
    base = wsrv["base"]
    at_kickoff(page, base)
    sent = record_requests(page, "/api/watch/")
    blur(page)
    page.keyboard.press("ArrowLeft")
    quiet(page)
    assert [r["path"] for r in sent] == [], sent
    page.locator(key("live")).click()
    expect_at(page, total(base), total(base))
    expect(page.locator(key("forward"))).to_be_disabled()
    blur(page)
    page.keyboard.press("ArrowRight")
    quiet(page)
    assert [r["path"] for r in sent] == [], sent
    assert page.errors == [], page.errors


def test_the_progress_bar_jumps_where_it_is_clicked_or_let_go(ui_pages, wsrv):
    """A click on the bar jumps there; a drag moves the knob and jumps once, where it is let go."""
    page = ui_pages()
    base = wsrv["base"]
    at_kickoff(page, base)
    n = total(base)
    sent = record_requests(page, "/api/watch/seek")
    track = page.locator(PROGRESS)
    box = track.bounding_box()
    track.click(position={"x": box["width"] * 0.5, "y": box["height"] / 2})
    until(page, lambda: len(sent) == 1, what="one seek")
    assert abs(sent[0]["body"]["idx"] - n / 2) <= 1, sent
    expect_at(page, sent[0]["body"]["idx"], n)
    expect(track).to_have_attribute("aria-valuetext", f"Play {sent[0]['body']['idx']} of {n}")
    y = box["y"] + box["height"] / 2
    page.mouse.move(box["x"] + box["width"] * 0.2, y)
    page.mouse.down()
    for f in (0.3, 0.45, 0.6, 0.75):
        page.mouse.move(box["x"] + box["width"] * f, y)
    page.mouse.up()
    until(page, lambda: len(sent) == 2, what="the drag's seek")
    quiet(page)
    assert len(sent) == 2, "a drag sends one seek, not one per move"
    assert abs(sent[1]["body"]["idx"] - n * 0.75) <= 1, sent
    expect_at(page, sent[1]["body"]["idx"], n)
    wait_idle(page, last_seq(base))
    assert page.errors == [], page.errors


def test_the_focused_bar_takes_its_own_keys(ui_pages, wsrv):
    """On the focused bar: Right one play on (once, not twice: the page's own Right stands down), Page Down the next
    drive's start, Home kickoff, End the end."""
    page = ui_pages()
    base = wsrv["base"]
    at_play(page, base, MID)
    n = total(base)
    sent = record_requests(page, "/api/")
    track = page.locator(PROGRESS)
    track.focus()
    page.keyboard.press("ArrowRight")
    here = moved(page, base, MID, 1)
    assert [r["path"] for r in sent if r["path"] != "/api/open"] == ["/api/watch/forward"], sent
    page.keyboard.press("PageDown")
    nxt = min(s for s in drive_starts(page, n) if s > here)
    until(page, lambda: idx_of(base) == nxt, what=f"the next drive's start, play {nxt}")
    expect_settled(page, base)
    page.keyboard.press("Home")
    until(page, lambda: idx_of(base) == 0, what="kickoff")
    expect_settled(page, base)
    page.keyboard.press("End")
    until(page, lambda: idx_of(base) == n, what="the end")
    expect_settled(page, base)
    expect(track).to_be_focused()
    assert page.errors == [], page.errors


def test_reset_goes_back_to_kickoff_paused(ui_pages, wsrv):
    page = ui_pages()
    base = wsrv["base"]
    at_play(page, base, MID)
    n = total(base)
    page.locator(key("reset")).click()
    expect_at(page, 0, n)
    expect(page.locator(PROGRESS)).to_have_attribute("aria-valuetext", "Kickoff")
    expect(page.locator(key("back"))).to_be_disabled()
    assert api_get(base, "/api/watch")["state"] == "paused"
    wait_idle(page, last_seq(base))
    assert page.errors == [], page.errors


def test_go_live_on_a_finished_game_jumps_to_its_end(ui_pages, wsrv):
    """Offline the saved game is final: Go Live (Escape, or the key) jumps to its last play, lights its lamp and
    turns itself off; pressed again it sends nothing. The game's scores tick the bar once their plays are in, and
    Reset takes them off again."""
    page = ui_pages()
    base = wsrv["base"]
    at_kickoff(page, base)
    n = total(base)
    sent = record_requests(page, "/api/golive")
    blur(page)
    page.keyboard.press("Escape")
    expect_at(page, n, n)
    expect(page.locator(PROGRESS)).to_have_attribute("aria-valuetext", "Final")
    expect(page.locator(SCORE_TICKS)).not_to_have_count(0)
    live = page.locator(key("live"))
    expect(live).to_have_attribute("data-live", "true")
    expect(page.locator(key("forward"))).to_be_disabled()
    wait_idle(page, last_seq(base))
    page.keyboard.press("Escape")
    live.click(force=True)
    quiet(page)
    assert len(sent) == 1, sent
    page.locator(key("reset")).click()
    expect_at(page, 0, n)
    expect(page.locator(SCORE_TICKS)).to_have_count(0)
    expect(live).to_have_attribute("data-live", "false")
    live.click()
    expect_at(page, n, n)
    assert len(sent) == 2, sent
    assert page.errors == [], page.errors


def test_v_and_the_camera_key_toggle_wide_and_blimp_only(ui_pages, wsrv):
    """restructure-v2.md 4: two views, Wide by default and Blimp, and V (or the key) toggles them; nothing else."""
    page = ui_pages()
    base = wsrv["base"]
    at_kickoff(page, base)
    field = page.locator("#field")
    camera = page.locator(CAMERA)
    assert [c[0] for c in CAMERAS] == ["wide", "blimp"]
    expect(camera).to_have_attribute("data-camera", "wide")
    expect(field).to_have_attribute("data-camera", "wide")
    expect(camera).to_contain_text("Wide")
    blur(page)
    seen = []
    for _ in range(4):
        page.keyboard.press("v")
        want = "blimp" if not seen or seen[-1] == "wide" else "wide"
        expect(camera).to_have_attribute("data-camera", want)
        expect(field).to_have_attribute("data-camera", want)
        seen.append(want)
    assert seen == ["blimp", "wide", "blimp", "wide"]
    camera.click()
    expect(camera).to_have_attribute("data-camera", "blimp")
    expect(camera).to_contain_text("Blimp")
    assert page.errors == [], page.errors


def test_rapid_presses_never_stack_requests(ui_pages, wsrv):
    """Eight quick Rights: one request at a time, the presses that came while one ran folded into the newest, and the
    page ends where the server is."""
    page = ui_pages()
    base = wsrv["base"]
    at_play(page, base, MID)
    flight = {"now": 0, "max": 0, "sent": 0}

    def started(req):
        if req.method == "POST" and any(req.url.endswith(p) for p in PLAYBACK):
            flight.update(now=flight["now"] + 1, sent=flight["sent"] + 1)
            flight["max"] = max(flight["max"], flight["now"])

    def ended(req):
        if req.method == "POST" and any(req.url.endswith(p) for p in PLAYBACK):
            flight["now"] -= 1

    page.on("request", started)
    page.on("requestfinished", ended)
    page.on("requestfailed", ended)
    blur(page)
    for _ in range(8):
        page.keyboard.press("ArrowRight")
    until(page, lambda: flight["now"] == 0 and page.locator('#app[data-playback=""]').count() == 1,
          timeout_ms=30_000, what="the presses to settle")
    assert flight["max"] == 1, flight
    assert flight["sent"] < 8, flight
    expect_settled(page, base)
    assert page.errors == [], page.errors


@pytest.mark.skipif(WORLD != "under-the-lights", reason="the settings menu is Under the Lights' own")
def test_the_settings_menu_keeps_its_keys_to_itself(ui_pages, wsrv):
    """The menu's two switches take Space (never Play); Escape closes the menu (never Go Live) and gives focus back
    to the Settings key."""
    page = ui_pages()
    base = wsrv["base"]
    at_kickoff(page, base)
    page.locator(SETTINGS).click()
    expect(page.locator("#app")).to_have_attribute("data-settings-open", "true")
    expect(page.locator(SETTINGS)).to_have_attribute("aria-expanded", "true")
    dip = page.locator("#ulsDipLive")
    expect(dip).to_be_focused()
    before = dip.is_checked()
    page.keyboard.press("Space")
    expect(dip).to_be_checked(checked=not before)
    page.keyboard.press("Space")
    expect(dip).to_be_checked(checked=before)
    expect(page.locator("#ulsRoomLights")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#app")).to_have_attribute("data-settings-open", "false")
    expect(page.locator(SETTINGS)).to_be_focused()
    assert idx_of(base) == 0, "Escape closed the menu; it did not go live"
    assert page.locator("#app").get_attribute("data-watch-state") == "paused"
    assert page.errors == [], page.errors


@pytest.mark.parametrize("size", [(1440, 900), (1512, 982), (1920, 1080)], ids=["1440x900", "1512x982", "1920x1080"])
def test_the_top_bar_fits_and_the_call_stays_clear_of_it(ui_pages, wsrv, size):
    """At Sam's three windows the top bar is one piece across the top, its keys whole and on screen, the page never
    scrolls sideways, and the call's region sits below the bar and above the scoreboard."""
    page = ui_pages(width=size[0], height=size[1])
    base = wsrv["base"]
    at_play(page, base, MID)
    boxes = page.evaluate("""() => { const r = (s) => { const n = document.querySelector(s); if (!n) return null;
      const b = n.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
      return { bar: r('[data-testid="transport"]'), call: r('#rg-call'), band: r('#rg-scoreboard'),
        width: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }; }""")
    assert boxes["width"] <= boxes["view"], boxes
    for sel in ([key(n) for n in ("back", "play", "forward", "reset", "live")]
                + [f'{TRANSPORT} [data-speed="{s}"]' for s in SPEEDS] + [CAMERA, '[data-testid="model-report"]']):
        b = page.locator(sel).bounding_box()
        assert b and b["x"] >= 0 and b["x"] + b["width"] <= size[0] and b["y"] >= 0, (sel, b)
    call, bar, band = boxes["call"], boxes["bar"], boxes["band"]
    if WORLD == "under-the-lights":
        assert call["top"] >= bar["bottom"], boxes
        assert call["bottom"] <= band["top"], boxes
    else:
        assert call["top"] >= bar["bottom"], boxes
    assert page.errors == [], page.errors


def test_no_console_errors_through_a_whole_session(ui_pages, wsrv):
    """Open, play, pause, step, seek, reset, Go Live and both views: nothing reaches the console."""
    page = ui_pages()
    base = wsrv["base"]
    at_kickoff(page, base)
    n = total(base)
    page.locator(key("play")).click()
    until(page, lambda: idx_of(base) >= PLAYS_BEFORE_PAUSE, timeout_ms=30_000, what="plays to land")
    page.locator(key("play")).click()
    expect(page.locator("#app")).to_have_attribute("data-watch-state", "paused")
    page.locator(key("forward")).click()
    expect_settled(page, base)
    box = page.locator(PROGRESS).bounding_box()
    page.locator(PROGRESS).click(position={"x": box["width"] * 0.6, "y": box["height"] / 2})
    expect_settled(page, base)
    page.locator(key("reset")).click()
    expect_at(page, 0, n)
    page.locator(key("live")).click()
    expect_at(page, n, n)
    page.locator(CAMERA).click()
    page.locator(CAMERA).click()
    expect(page.locator(CAMERA)).to_have_attribute("data-camera", "wide")
    wait_idle(page, last_seq(base))
    assert page.errors == [], page.errors
    assert re.search(r"\b\d+ / \d+\b", page.locator(COUNT).inner_text())

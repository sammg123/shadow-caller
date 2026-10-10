"""Under the Lights, end to end (v1.4, W6). Sam's world is the page's default, and its field follows
docs/design/play-drawing.md (Sam's binding direction, 2026-10-09):

  1. every play starts on the line of scrimmage: the ball in flight never leaves from behind it (no dropback, no
     handoff mesh); only the play's own facts take it back (a screen caught behind the line, a loss, a sack);
  3. every drawn play carries its words on the field, as descriptive as ESPN gets ("Short pass middle · incomplete");
  4. before each Dallas snap his top 2 are up as shadow plays with "1 · Inside run (A/B gap) · 28%" underneath, a
     hovered play outside them joins, the opponent's snaps get none, and the snap takes them away.

Plus the scoreboard band against the server, zero console errors through a replay and a whole watched game, and the
golden screenshots (ui-architecture 7.3, uls_scenes.py). Every test sets its own server state (FI 6.1) on the
scaled-pace watch sandbox and leaves no session running."""
import json
import os
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (BOOT_TIMEOUT_MS, TOTAL_ROWS, answer_dialogs, api_get, blur, full_timeline, pct,
                        reset_game, state, stop_watch, wait_idle, wait_ready)
from uls_scenes import (ACTUAL_DIR, MAX_CHANGED, PRESNAP_IDX, SIZES, STATES, changed_ratio, freeze, golden_path,
                        open_page, replayed, run, scene, step_frames, watch_paused_at)

from helpers import ROOT

pytestmark = pytest.mark.e2e

WORLD_ID = "under-the-lights"
FIELD = "#field"
TB_PRESNAP_IDX = 14             # TB's kickoff return applied: the opponent's first snap is next (no shadows)
LABELS = {                      # play-drawing.md 3, its own examples, on their real TB at DAL rows
    1: "Kickoff · return to DAL 30", 2: "Short pass middle · incomplete", 3: "Short pass middle · +8",
    5: "Inside run (up the middle) · +4", 7: "Deep pass middle · +21", 8: "No play · defensive offside on TB",
    17: "QB scramble right · +5", 28: "Outside run right · +2", 41: "Inside run (left guard) · −2",
    43: "Punt · 53 yds · out of bounds", 65: "Flag · false start on TB · −5", 87: "FG 41 yds · good",
    95: "Off-tackle left · +72", 96: "Outside run left · TD", 101: "Short pass left · +27",
    104: "Pass intercepted · short middle", 114: "Sack · −11", 159: "Deep pass left · TD", 161: "Kickoff · touchback",
    181: "Kneel · −1",
}
SCENES = {"webgl": "", "2d": "scene=2d"}
BAND_PAIRS = ["called_right", "top3", "passrun_logloss"]   # DESIGN.md: exactly these three on the band
WATCH_DONE_MS = 240_000
BALL_SLACK_YD = 0.25            # the ball's sampled spot, against the line of scrimmage
FIRST_REACH_YD = 1.0            # a play's first frame (16 ms in) is this close to its line of scrimmage
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "timeline_tb_dal.json").read_text())
ROWS = {r["seq"]: r for r in FIXTURE["rows"]}


@pytest.fixture
def wsrv(watch_server):
    """The scaled-pace sandbox; a session a test leaves behind is stopped with the game put back."""
    yield watch_server
    stop_watch(watch_server["base"])


@pytest.fixture(scope="module")
def gpu_browser(browser):
    """Chromium's new headless mode on the real GPU (the e2e `browser` renders with SwiftShader, the low tier)."""
    try:
        b = browser.browser_type.launch(channel="chromium")
    except Exception as err:                            # no new-headless Chromium here: the goldens can't be made
        pytest.skip(f"the goldens are GPU renders; Chromium's new headless mode didn't start ({err})")
    yield b
    b.close()


def open_uls(page, base, query=""):
    page.goto(f"{base}/?world={WORLD_ID}" + (f"&{query}" if query else ""), wait_until="domcontentloaded",
              timeout=BOOT_TIMEOUT_MS)
    wait_ready(page)
    expect(page.locator(FIELD)).to_have_attribute("data-scene-ready", "true", timeout=BOOT_TIMEOUT_MS)


def on_screen(scope, words):
    """`words` exactly, on screen inside `scope` (a hidden copy, such as the live play's words set aside during a
    review, doesn't count)."""
    expect(scope.get_by_text(words, exact=True).filter(visible=True).first).to_be_visible()


def no_errors(page):
    assert page.errors == [], page.errors
    assert page.bad_responses == [], page.bad_responses


# ---------------------------------------------------------------- the default world
def test_boots_into_under_the_lights_unless_neutral_is_asked_for(ui_pages, wsrv):
    """2.7 + v1.2: no ?world= opens Under the Lights (its layout, its fonts, the wide camera, no notice); ?world=neutral
    still opens neutral."""
    base = wsrv["base"]
    reset_game(base)
    page = ui_pages()
    page.goto(base + "/", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    wait_ready(page)
    expect(page.locator("html")).to_have_attribute("data-world", WORLD_ID)
    expect(page.locator("#app")).to_have_attribute("data-layout", "uls")
    expect(page.locator(FIELD)).to_have_attribute("data-scene-ready", "true", timeout=BOOT_TIMEOUT_MS)
    expect(page.locator(FIELD)).to_have_attribute("data-camera", "wide")
    expect(page.locator('[data-testid="notices"] > *')).to_have_count(0)
    page.evaluate("document.fonts.ready.then(() => true)")
    loaded = page.evaluate("[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family)")
    assert any("Big Shoulders Display" in f for f in loaded), loaded
    page.goto(base + "/?world=neutral", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    wait_ready(page)
    expect(page.locator("html")).to_have_attribute("data-world", "neutral")
    expect(page.locator("#app")).not_to_have_attribute("data-layout", "uls")
    expect(page.locator(FIELD)).to_have_attribute("data-camera", "sideline", timeout=BOOT_TIMEOUT_MS)
    no_errors(page)


FIRST_FRAME_JS = """() => {
  const css = (sel, prop) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
  return { world: document.documentElement.dataset.world, ground: css('html', 'backgroundColor'),
    cover: css('.sc-boot-static', 'backgroundColor'), lamp: css('.sc-boot-static .sc-lamp', 'backgroundColor'),
    face: css('.sc-boot-static .sc-boot-board', 'backgroundImage'),
    plateFont: css('.sc-boot-static .sc-boot-plate', 'fontFamily'),
    words: document.querySelector('.sc-boot-static .sc-boot-heading')?.textContent ?? null,
    wordsCase: css('.sc-boot-static .sc-boot-heading', 'textTransform') };
}"""
SHEETS_IN_JS = "() => [...document.querySelectorAll('link[rel=stylesheet]')].every((l) => l.sheet !== null)"
NIGHT_SKY = "rgb(13, 20, 36)"           # --uls-night-sky #0D1424
LED_AMBER = "rgb(255, 178, 30)"         # --uls-led-amber #FFB21E: the loading lamp


def test_the_first_frame_is_the_stadium_before_any_script_runs(ui_pages, wsrv):
    """G2-8: with main.js held back, the page as shipped is already Under the Lights: the night sky and the loading
    board (the LED face, its plate in Big Shoulders, the lamp amber), never a neutral screen; let go, the script boots
    into the same world with no notice."""
    base = wsrv["base"]
    reset_game(base)
    page = ui_pages()
    held = []
    page.route("**/static/js/main.js", lambda route: held.append(route))
    page.goto(base + "/", wait_until="commit", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector(".sc-boot-static .sc-boot-heading", state="attached", timeout=BOOT_TIMEOUT_MS)
    # the first paint waits for every stylesheet in <head> (render-blocking); script can read styles before that
    page.wait_for_function(SHEETS_IN_JS, timeout=BOOT_TIMEOUT_MS)
    page.evaluate("document.fonts.ready.then(() => true)")
    first = page.evaluate(FIRST_FRAME_JS)
    assert first["world"] == WORLD_ID, first
    assert first["ground"] == NIGHT_SKY and first["cover"] == NIGHT_SKY, first
    assert first["lamp"] == LED_AMBER, first
    assert "radial-gradient" in first["face"], first
    assert first["plateFont"].startswith('"Big Shoulders Display"'), first
    assert (first["words"], first["wordsCase"]) == ("Loading the game…", "uppercase"), first
    assert len(held) == 1, "main.js was asked for once and held"
    held[0].continue_()
    wait_ready(page)
    expect(page.locator("html")).to_have_attribute("data-world", WORLD_ID)
    expect(page.locator(".sc-boot-static")).to_have_count(0)
    expect(page.locator('[data-testid="notices"] > *')).to_have_count(0)
    no_errors(page)


# ---------------------------------------------------------------- play-drawing.md 4: the shadow plays
def shadow_text(rank, play):
    return f"{rank} · {play['name']} · {pct(play['p'])}"


def test_his_top_two_are_up_as_shadow_plays_before_a_dallas_snap(ui_pages, wsrv):
    """play-drawing.md 4: before the first Dallas snap the field holds exactly his top 2, in rank order, each with its
    rank, name and odds underneath; focusing his third play draws its shadow too, and leaving it takes it away."""
    base = wsrv["base"]
    watch_paused_at(base, PRESNAP_IDX)
    page = ui_pages()
    open_uls(page, base)
    top = state(base)["prediction"]["top"]
    field = page.locator(FIELD)
    expect(field).to_have_attribute("data-ghosts", f"{top[0]['key']} {top[1]['key']}")
    for rank, play in enumerate(top[:2], 1):
        on_screen(field, shadow_text(rank, play))
    expect(field).not_to_contain_text(shadow_text(3, top[2]))
    third = page.locator(f'#heroArea .leaf[data-leaf="{top[2]["key"]}"]')
    third.focus()
    expect(field).to_have_attribute("data-ghost-highlight", top[2]["key"])
    on_screen(field, shadow_text(3, top[2]))
    blur(page)
    expect(field).to_have_attribute("data-ghost-highlight", "")
    expect(field).not_to_contain_text(shadow_text(3, top[2]))
    no_errors(page)


def test_the_opponents_snaps_get_no_shadow_plays(ui_pages, wsrv):
    """play-drawing.md 4: only the modeled caller's offense; Tampa Bay's first snap has none."""
    base = wsrv["base"]
    watch_paused_at(base, TB_PRESNAP_IDX)
    page = ui_pages()
    open_uls(page, base)
    wait_idle(page, TB_PRESNAP_IDX)
    expect(page.locator(FIELD)).to_have_attribute("data-poss", "TB")
    expect(page.locator(FIELD)).to_have_attribute("data-ghosts", "")
    expect(page.locator(FIELD)).not_to_contain_text(re.compile(r"\b[12] · .+ · \d+%"))
    no_errors(page)


# ---------------------------------------------------------------- play-drawing.md 3: the words on the field
@pytest.mark.parametrize("scene_id", sorted(SCENES))
def test_every_drawn_play_carries_its_words(ui_pages, wsrv, scene_id):
    """play-drawing.md 3: each of its own examples, reviewed from the play ribbon (Enter on a play), is on the field in
    those exact words, on both engines."""
    base = wsrv["base"]
    replayed(base)
    page = ui_pages()
    open_uls(page, base, SCENES[scene_id])
    wait_idle(page, TOTAL_ROWS)
    field = page.locator(FIELD)
    page.locator("#rg-plays").hover()                    # the ribbon unrolls; focus inside keeps it unrolled
    for seq, words in LABELS.items():
        page.locator(f'#rg-plays [data-testid="play-row"][data-seq="{seq}"] button').focus()
        page.keyboard.press("Enter")
        expect(field).to_have_attribute("data-review-seq", str(seq))
        on_screen(field, words)
    no_errors(page)


# ---------------------------------------------------------------- play-drawing.md 1: from the line of scrimmage
def allowed_back(row):
    """How far behind its line of scrimmage the play's own facts take the ball (yards, <= 0): a pass caught behind
    the line, a loss, a sack. Anything further back would be a dropback or a handoff mesh."""
    g = row["geo"]
    spots = [g["x_end"]] + ([g["x_catch"]] if g.get("x_catch") is not None else [])
    return min([0.0] + [g["dir"] * (x - g["x0"]) for x in spots if x is not None])


def test_every_snap_starts_on_the_line_of_scrimmage(browser, wsrv):
    """play-drawing.md 1 and 4, in motion, frame by frame on the page clock: Dallas's first drive stepped play by play
    (Right on a paused watch). Each ball leaves from its line of scrimmage, no frame has it behind the line unless the
    play itself went back, and his shadows are off the field while his snap is in the air."""
    base = wsrv["base"]
    watch_paused_at(base, PRESNAP_IDX)
    page = open_page(browser, base, SIZES[0])
    try:
        freeze(page)
        run(page, 1600)
        checked = 0
        for seq in range(PRESNAP_IDX + 1, 13):
            frames = [f for f in step_frames(page) if f["seq"] == seq and f["ball"]]
            row = ROWS[seq]
            g = row["geo"]
            ahead = [g["dir"] * (f["ball"]["x"] - g["x0"]) for f in frames]
            assert ahead, f"seq {seq}: no ball in flight"
            assert abs(ahead[0]) <= FIRST_REACH_YD, f"seq {seq}: the ball left from {ahead[0]:+.2f} yd, not the line"
            floor = allowed_back(row) - BALL_SLACK_YD
            assert min(ahead) >= floor, f"seq {seq}: the ball went {min(ahead):+.1f} yd back (the play allows {floor:+.1f})"
            if row["offense_is_caller"]:
                assert all(f["ghosts"] == [] for f in frames), f"seq {seq}: shadows stayed up after his snap"
            checked += 1
        assert checked == 11, checked
        assert page.errors == [], page.errors
    finally:
        page.context.close()


# ---------------------------------------------------------------- the scoreboard band
def band_pair(page, pair_id):
    return page.locator(f'#rg-score [data-pair="{pair_id}"]')


def test_scoreboard_band_matches_the_server(ui_pages, wsrv):
    """DESIGN.md scoreboard band: the scores against /api/state, the quarter, clock, down and ball on against the
    timeline's status (an ESPN game's band shows ESPN's clock, or during his drive the engine's, G4-9), and row two's
    three SHADOW V LEAGUE pairs against /api/state metrics, mid-game and final. Its paint is the offense's color
    mid-game and neutral scoreboard steel once the game is final (G2-5: nobody has the ball)."""
    base = wsrv["base"]
    page = ui_pages()
    for setup in (lambda: watch_paused_at(base, 40), lambda: replayed(base)):
        setup()
        open_uls(page, base)
        tl = full_timeline(base)
        s, status = state(base), tl["status"]
        expect_band(page, s, status)
        expect_band_paint(page, tl)
    no_errors(page)


STEEL_NEUTRAL = "rgb(51, 64, 92)"       # --uls-steel-neutral #33405C (tokens.css): the band with no team's paint


def rgb(hex_color):
    return "rgb({}, {}, {})".format(*(int(hex_color[i:i + 2], 16) for i in (1, 3, 5)))


def expect_band_paint(page, tl):
    """The band wears the offense's ESPN primary (the team #field reports with the ball, else the caller), and the
    neutral steel after the final whistle."""
    band = page.locator(".uls-band")
    if tl["status"]["state"] == "post":
        expect(band).to_have_css("background-color", STEEL_NEUTRAL)
        return
    caller = next(t["abbr"] for t in tl["teams"].values() if t["caller"])
    poss = page.locator(FIELD).get_attribute("data-poss") or caller
    expect(band).to_have_css("background-color", rgb(tl["teams"][poss]["color"]))


def expect_band(page, s, status):
    sit, m, g = s["sit"], s["metrics"], s["metrics"]["granular"]
    board = page.locator('[data-testid="scoreboard"]')
    expect(board.locator('[data-testid="team-score"][data-team="DAL"]')).to_have_text(str(sit["score_off"]))
    expect(board.locator('[data-testid="team-score"][data-team="TB"]')).to_have_text(str(sit["score_opp"]))
    expect(board.locator('[data-fact="qtr"]')).to_contain_text(f"Q{status['qtr']}")
    expect(board.locator('[data-testid="game-clock"]')).to_contain_text(band_clock(s, status))
    down, _, spot = (status.get("down_text") or "").partition(" at ")
    if status["state"] != "post":
        expect(board.locator('[data-fact="down"]')).to_contain_text(down)
        expect(board.locator('[data-fact="ball"]')).to_contain_text(spot)
    shown = page.locator("#rg-score [data-pair]").evaluate_all(
        "els => els.filter(e => e.getClientRects().length > 0).map(e => e.dataset.pair)")
    assert shown == BAND_PAIRS, shown
    want = {"called_right": (pct(m["acc_model"]), pct(m["acc_league"]), "higher"),
            "top3": (str(g["leaf_top3"]), str(g["leaf_top3_league"]), "higher"),
            "passrun_logloss": (f"{m['logloss_model']:.3f}", f"{m['logloss_league']:.3f}", "lower")}
    for pair_id, (mine, league, better) in want.items():
        pair = band_pair(page, pair_id)
        expect(pair.locator('[data-side="shadow"]')).to_contain_text(mine)
        expect(pair.locator('[data-side="league"]')).to_contain_text(league)
        expect(pair).to_have_attribute("data-leader", leader(mine, league, better))


def band_clock(s, status):
    """G4-9 (model/vm-scoreboard.js engineClock): one clock with the strip. During the caller's drive, in ESPN's
    quarter, the band shows the engine's clock (ESPN's at his last snap less its runoff estimate); otherwise, and
    always after the final whistle, ESPN's own."""
    sit = s["sit"]
    live = s["drive_active"] and status["state"] != "post" and sit.get("qtr") == status["qtr"]
    return sit["clock_str"] if live and sit.get("clock_str") else status["clock"]


def leader(mine, league, better):
    a, b = float(mine.rstrip("%")), float(league.rstrip("%"))
    if a == b:
        return "even"
    return "shadow" if (a > b) == (better == "higher") else "league"


# ---------------------------------------------------------------- a whole game, no console errors
def test_replay_and_a_whole_watched_game_raise_no_console_errors(ui_pages, wsrv):
    """Replay this game, then Watch this game to the end at 10x, from the drawer, with motion on: no page error, no
    console error, no failed request."""
    base = wsrv["base"]
    reset_game(base)
    page = ui_pages(reduced_motion=False)
    open_uls(page, base)
    answer_dialogs(page, accept=True)
    blur(page)
    page.keyboard.press("b")
    expect(page.locator("#app")).to_have_attribute("data-booth-open", "true")
    page.locator("#replayBtn").click()
    wait_idle(page, TOTAL_ROWS, timeout=120_000)
    page.locator('[data-watch="start"]:visible').first.click()
    expect(page.locator("#app")).to_have_attribute("data-watch-state", "playing")
    blur(page)
    page.keyboard.press("4")
    expect(page.locator('[data-testid="watch"]')).to_have_attribute("data-watch-state", "done", timeout=WATCH_DONE_MS)
    wait_idle(page, TOTAL_ROWS, timeout=60_000)
    assert api_get(base, "/api/watch")["idx"] == TOTAL_ROWS
    no_errors(page)


# ---------------------------------------------------------------- golden screenshots (ui-architecture 7.3)
@pytest.mark.parametrize("size", SIZES, ids=[f"{w}x{h}" for w, h in SIZES])
@pytest.mark.parametrize("state_id", STATES)
def test_golden_screenshots(gpu_browser, wsrv, state_id, size):
    """Each state at each size matches its golden within 1% of pixels. SC_UPDATE_GOLDENS=1 writes them instead; a
    failed comparison leaves the capture in test-results/visual/under-the-lights/."""
    page, png = scene(gpu_browser, wsrv["base"], state_id, size)
    try:
        tier = page.evaluate("window.__shadowDebug().tier")
        if state_id == "presnap":
            assert len(page.locator(FIELD).get_attribute("data-ghosts").split()) == 2
        no_errors_in(page)
    finally:
        page.context.close()
    if tier != "high":
        pytest.skip("the goldens are GPU renders; this browser has no GPU (tier low)")
    path = golden_path(state_id, size)
    if os.environ.get("SC_UPDATE_GOLDENS") == "1":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png)
        return
    assert path.exists(), f"no golden {path.name}: run with SC_UPDATE_GOLDENS=1 to write it"
    blank = gpu_browser.new_page()
    try:
        ratio = changed_ratio(blank, path.read_bytes(), png)
    finally:
        blank.close()
    if ratio > MAX_CHANGED:
        ACTUAL_DIR.mkdir(parents=True, exist_ok=True)
        (ACTUAL_DIR / path.name).write_bytes(png)
    assert ratio <= MAX_CHANGED, f"{path.name}: {ratio:.2%} of pixels changed (the capture is in {ACTUAL_DIR})"


def no_errors_in(page):
    assert page.errors == [], page.errors

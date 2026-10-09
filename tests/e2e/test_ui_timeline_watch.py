"""New features (ui-architecture 7.2, 5.3, 5.4; DC B, C, E): every timeline row drawn on the field and listed in the
play feed, drives, win probability, scoreboard and box score after a replay; Left/Right review; and Watch this game
(start, Space, Right, 1 to 4, Stop with restore, Done then Watch again, no spoilers) on a sandbox whose Watch pace is
scaled down (SHADOW_WATCH_SCALE, conftest `watch_server`)."""
import re
import time

import pytest
from playwright.sync_api import expect
from ui_helpers import (EVENT, TOTAL_ROWS, answer_dialogs, api_get, api_post, blur, command,
                        ensure_finished, expect_log_rows, expect_toast, finished, full_timeline, load, quiet,
                        record_requests, reset_game, state, stop_watch, until, version, wait_idle)

pytestmark = pytest.mark.e2e

PLAY_ROW = '[data-testid="play-row"]'
DRIVE_RESULTS = ["TD", "TD", "PUNT", "PUNT", "PUNT", "PUNT", "PUNT", "PUNT", "FG", "END OF HALF", "TD", "INT", "TD",
                 "FUMBLE", "FG", "DOWNS", "DOWNS", "TD", "PUNT", "INT", "END OF GAME"]          # DC G17
SCENES = {"webgl": "", "2d": "scene=2d"}


def verdict_of(pred):
    """model/verdict.js verdictOf(pred).key, ported."""
    if not pred:
        return "none"
    rank = pred.get("leaf_rank")
    if isinstance(rank, int) and not isinstance(rank, bool) and rank > 0:
        return "top1" if rank == 1 else "top3" if rank <= 3 else "miss"
    if pred.get("family") and pred.get("fam_top"):
        return "top1" if pred["fam_top"] == pred["family"] else "miss"
    p, dropback = pred.get("p"), pred.get("dropback")
    if isinstance(p, (int, float)) and dropback in (0, 1):
        return "top1" if (p >= 0.5) == (dropback == 1) else "miss"
    return "none"


def field_attr(page, name):
    return page.locator("#field").get_attribute(name)


# ---------------------------------------------------------------- the whole game, after a replay
@pytest.mark.parametrize("scene", sorted(SCENES))
def test_every_row_is_drawn_on_the_field(upage, server, scene):
    """5.3: after a replay the field has drawn all 183 rows (data-drawn-seq), nothing queued, idle, this epoch."""
    base = server["base"]
    finished(upage, base, SCENES[scene])
    wait_idle(upage, TOTAL_ROWS)
    f = upage.locator("#field")
    expect(f).to_have_attribute("data-scene", scene)
    expect(f).to_have_attribute("data-queue", "0")
    expect(f).to_have_attribute("data-epoch", version(base)["epoch"])
    expect(f).to_have_attribute("data-drive-active", "false")
    expect(f).to_have_attribute("aria-label", "DAL off the field.")
    expect(upage.locator("#app")).to_have_attribute("data-source", "espn")


def test_play_feed_lists_every_row_with_its_verdict(upage, server):
    """5.4, DC G1: 183 play rows, newest first, 64 caller snaps; hooks per row; verdicts match each pred."""
    base = server["base"]
    finished(upage, base)
    rows = full_timeline(base)["rows"]
    feed = upage.locator('[data-testid="play-feed"]')
    expect(feed).to_have_attribute("aria-label", "Plays")
    assert feed.evaluate("e => e.tagName") == "OL"
    expect(upage.locator(PLAY_ROW)).to_have_count(TOTAL_ROWS)
    expect(upage.locator(f'{PLAY_ROW}[data-caller="true"]')).to_have_count(64)
    got = upage.locator(PLAY_ROW).evaluate_all(
        "els => els.map(e => [e.dataset.seq, e.dataset.id, e.dataset.kind, e.dataset.team, e.dataset.caller,"
        " e.dataset.verdict, e.dataset.nullified, e.dataset.scoring])")
    want = [[str(r["seq"]), r["id"], r["kind"], r["team"], "true" if r["offense_is_caller"] else "false",
             verdict_of(r.get("pred")), "true" if r["result"] and r["result"]["nullified"] else "false",
             "true" if r["scoring"] else "false"] for r in sorted(rows, key=lambda r: -r["seq"])]
    assert got == want
    assert sum(1 for r in rows if r["scoring"]) == 7


def test_drives_win_probability_scoreboard_and_box(upage, server):
    """5.4, DC C: 21 drives with G17's results in order, win probability 0 at the end, 16 to 24, DAL 366 and TB 419
    yards, both logos."""
    finished(upage, server["base"])
    drives = upage.locator('[data-testid="drive-chart"] [data-testid="drive"]')
    expect(drives).to_have_count(21)
    got = drives.evaluate_all("els => els.map(e => [Number(e.dataset.idx), e.dataset.result, e.dataset.complete])")
    assert [r for _, r, _ in sorted(got)] == DRIVE_RESULTS
    assert all(c == "true" for _, _, c in got)
    wp = upage.locator('[data-testid="wp-chart"]')
    expect(wp).to_have_attribute("data-available", "true")
    assert float(wp.get_attribute("data-wp-caller")) == 0.0
    expect(wp).to_have_attribute("aria-label", "DAL win probability 0%")
    board = upage.locator('[data-testid="scoreboard"]')
    expect(board).to_have_attribute("data-state", "post")
    expect(board.locator('[data-testid="team-score"][data-team="DAL"]')).to_have_text("16")
    expect(board.locator('[data-testid="team-score"][data-team="TB"]')).to_have_text("24")
    expect(board.locator('[data-testid="game-clock"]')).to_contain_text("0:00")
    logos = board.locator('img[data-testid="team-logo"][alt]')
    expect(logos).to_have_count(2)
    for logo in logos.all():
        assert re.fullmatch(r"/api/logo/(DAL|TB)(\?v=(default|dark))?", logo.get_attribute("src")), logo.get_attribute("src")
        assert logo.get_attribute("alt")
        until(upage, lambda: logo.evaluate("e => e.complete && e.naturalWidth > 0"), what="the logo to load")
    box = upage.locator('[data-testid="box-score"]')
    assert box.evaluate("e => e.tagName") == "TABLE"
    teams, yards = box.evaluate(
        "t => { const teams = [...t.querySelectorAll('th[data-team]')].map(th => th.dataset.team);"
        " const row = [...t.querySelectorAll('tr')].find(r => r.cells[0] && r.cells[0].innerText.trim() === 'Total yards');"
        " return [teams, row ? [...row.cells].slice(1).map(c => c.innerText.trim()) : null]; }")
    assert teams == ["TB", "DAL"]
    assert yards == ["419", "366"]


def test_hand_entered_play_is_noted_as_off_the_field(upage, server):
    """DC C1 + 5.4: after a replay, a typed play has no ESPN row: "1 hand-entered play isn't on the field"."""
    base = server["base"]
    ensure_finished(base)
    command(base, "new D25 | K 3")
    load(upage, base)
    expect(upage.locator('[data-testid="unlinked-note"]')).to_have_text("1 hand-entered play isn't on the field")


def test_left_and_right_review_drawn_rows_and_escape_returns_live(upage, server):
    """2.2 review: Left shows the newest drawable row, Left again the one before, Right goes forward then back to
    live; Esc returns to live. The field and the banner both say which row."""
    base = server["base"]
    finished(upage, base)
    wait_idle(upage, TOTAL_ROWS)
    drawable = [r["seq"] for r in full_timeline(base)["rows"] if r["kind"] != "admin"]
    banner = upage.locator('[data-testid="review"]')
    blur(upage)
    upage.keyboard.press("ArrowLeft")
    expect(banner).to_be_visible()
    expect(banner).to_have_attribute("data-seq", str(drawable[-1]))
    expect(upage.locator("#field")).to_have_attribute("data-review-seq", str(drawable[-1]))
    expect(upage.locator("#field")).to_have_attribute("data-anim-state", "reviewing")
    upage.keyboard.press("ArrowLeft")
    expect(banner).to_have_attribute("data-seq", str(drawable[-2]))
    upage.keyboard.press("ArrowRight")
    expect(banner).to_have_attribute("data-seq", str(drawable[-1]))
    upage.keyboard.press("ArrowRight")
    expect(banner).to_be_hidden()
    expect(upage.locator("#field")).not_to_have_attribute("data-review-seq", re.compile(".*"))
    upage.keyboard.press("ArrowLeft")
    expect(banner).to_be_visible()
    upage.keyboard.press("Escape")
    expect(banner).to_be_hidden()
    expect(upage.locator("#field")).to_have_attribute("data-anim-state", "idle")


def test_play_feed_text_is_never_html(upage, server):
    """G27 for ESPN's play text: a row whose text holds markup shows it as literal text."""
    base = server["base"]
    ensure_finished(base)
    evil = 'D.Prescott pass <b>x</b> <img src=x onerror="window.__a11Pwned=1"> to TB 12'

    def inject(route):
        response = route.fetch()
        body = response.json()
        for row in body.get("rows", []):
            if row["seq"] == 2:
                row["text"] = evil
        route.fulfill(response=response, json=body)

    upage.route("**/api/timeline*", inject)
    load(upage, base)
    row = upage.locator(f'{PLAY_ROW}[data-seq="2"]')
    expect(row).to_contain_text("<b>x</b>")
    assert row.locator("b, img").count() == 0
    assert upage.evaluate("() => window.__a11Pwned") is None


# ---------------------------------------------------------------- Watch this game
@pytest.fixture
def wsrv(watch_server):
    """The scaled-pace sandbox; any session a test leaves behind is stopped with the game put back."""
    yield watch_server
    stop_watch(watch_server["base"])


def watch_now(base):
    return api_get(base, "/api/watch")


def start_watch(base, speed):
    reset_game(base)
    return api_post(base, "/api/watch/start", {"event_id": EVENT, "speed": speed, "from_seq": 0})


def wait_watch(base, check, timeout_s=40, what="the watch"):
    end = time.monotonic() + timeout_s
    while time.monotonic() < end:
        w = watch_now(base)
        if check(w):
            return w
        time.sleep(0.1)
    raise AssertionError(f"timed out waiting for {what}: {watch_now(base)}")


def watch_box(page):
    return page.locator('[data-testid="watch"]')


def test_watch_start_from_the_page(upage, wsrv):
    """3.8: Watch this game confirms, posts the start at the chosen speed (default 4) from 0, and the page switches
    to watch mode: data-watch-state playing, the pad and flags hidden, progress "n / 183"."""
    base = wsrv["base"]
    reset_game(base)
    load(upage, base)
    asked = answer_dialogs(upage, accept=True)
    sent = record_requests(upage, "/api/watch/start")
    upage.locator('[data-watch="start"]:visible').first.click()
    expect(upage.locator("#app")).to_have_attribute("data-watch-state", "playing")
    assert asked == [f"Watch ESPN game {EVENT} from the start? Your game is backed up first and comes back when you "
                     "stop."]
    assert [r["body"] for r in sent] == [{"event_id": EVENT, "speed": 4, "from_seq": 0}]
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "playing")
    expect(upage.locator("#app")).to_have_attribute("data-mode", "watch")
    expect(upage.locator("#manualEntry")).to_be_hidden()
    expect(upage.locator("#flagPanel")).to_be_hidden()
    expect(upage.locator('[data-testid="watch-progress"]')).to_have_text(re.compile(r"^\s*\d+ / 183\s*$"))


def test_space_pauses_and_resumes(upage, wsrv):
    """3.8, 4.3: Space pauses a playing watch and resumes a paused one."""
    base = wsrv["base"]
    start_watch(base, 1)
    load(upage, base)
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "playing")
    sent = record_requests(upage, "/api/watch/", "POST")
    blur(upage)
    upage.keyboard.press("Space")
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "paused")
    assert watch_now(base)["state"] == "paused"
    upage.keyboard.press("Space")
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "playing")
    assert [r["path"] for r in sent] == ["/api/watch/pause", "/api/watch/resume"]


def test_right_steps_exactly_one_play_when_paused(upage, wsrv):
    """2.2 review at the live edge: Right on a paused watch steps the server one play; the field draws exactly it."""
    base = wsrv["base"]
    start_watch(base, 1)
    wait_watch(base, lambda w: w["idx"] >= 3, what="three plays")
    api_post(base, "/api/watch/pause")
    n = version(base)["timeline_n"]
    load(upage, base)
    wait_idle(upage, n)
    steps = record_requests(upage, "/api/watch/step")
    blur(upage)
    upage.keyboard.press("ArrowRight")
    wait_idle(upage, n + 1)
    quiet(upage, 1000)
    assert field_attr(upage, "data-drawn-seq") == str(n + 1)
    assert len(steps) == 1
    assert (watch_now(base)["idx"], watch_now(base)["state"]) == (n + 1, "paused")


def test_digit_keys_set_the_watch_speed(upage, wsrv):
    """3.8, 4.3: 1 to 4 post speeds 1, 2, 4 and 10; the pressed speed button follows."""
    base = wsrv["base"]
    start_watch(base, 1)
    api_post(base, "/api/watch/pause")
    load(upage, base)
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "paused")
    sent = record_requests(upage, "/api/watch/speed")
    blur(upage)
    for key in ("1", "2", "3", "4"):
        upage.keyboard.press(key)
    until(upage, lambda: len(sent) == 4, what="four speed posts")
    assert [r["body"] for r in sent] == [{"speed": 1}, {"speed": 2}, {"speed": 4}, {"speed": 10}]
    expect(upage.locator('[data-speed="10"]')).to_have_attribute("aria-pressed", "true")
    expect(upage.locator('[data-speed][aria-pressed="true"]')).to_have_count(1)
    assert watch_now(base)["speed"] == 10


def test_stop_puts_the_pre_watch_game_back(upage, wsrv):
    """3.8: Stop confirms "Stop watching and put your game back?", posts restore, and the pre-watch log returns."""
    base = wsrv["base"]
    reset_game(base)
    command(base, "new D25 | K 3")
    api_post(base, "/api/watch/start", {"event_id": EVENT, "speed": 1, "from_seq": 0})
    wait_watch(base, lambda w: w["idx"] >= 3, what="three plays")
    load(upage, base)
    asked = answer_dialogs(upage, accept=True)
    sent = record_requests(upage, "/api/watch/stop")
    upage.locator('[data-watch="stop"]').click()
    expect(upage.locator("#app")).not_to_have_attribute("data-watch-state", re.compile("playing|paused"))
    assert asked == ["Stop watching and put your game back?"]
    assert [r["body"] for r in sent] == [{"restore": True}]
    s = state(base)
    assert (len(s["log"]), s["log"][0]["name"], s["drive_active"]) == (1, "Inside run (A/B gap)", True)
    expect_log_rows(upage, 1)
    expect(upage.locator("#manualEntry")).to_be_visible()


def test_no_play_row_is_ever_ahead_of_the_field(upage_motion, wsrv):
    """DC E5 on screen (3.4): while a watch plays with motion on, no play row has a seq above #field[data-drawn-seq]."""
    base = wsrv["base"]
    start_watch(base, 4)
    load(upage_motion, base)
    samples = []
    end = time.monotonic() + 6
    while time.monotonic() < end:
        samples.append(upage_motion.evaluate(
            "() => { const f = document.getElementById('field'); const d = Number(f && f.dataset.drawnSeq || 0);"
            " const seqs = [...document.querySelectorAll('[data-testid=\"play-row\"]')].map(r => Number(r.dataset.seq));"
            " return [d, seqs.length ? Math.max(...seqs) : 0]; }"))
        upage_motion.wait_for_timeout(80)
    ahead = [s for s in samples if s[1] > s[0]]
    assert not ahead, f"play rows ahead of the field: {ahead[:5]}"
    assert max(d for d, _ in samples) > 0, "nothing was drawn while the watch played"


def test_done_then_watch_again_restores_before_starting(upage, wsrv):
    """3.8: a finished session shows Back to my game and Watch again; Watch again stops with restore, then starts."""
    base = wsrv["base"]
    start_watch(base, 10)
    wait_watch(base, lambda w: w["state"] == "done", timeout_s=60, what="the watched game to finish")
    load(upage, base)
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "done")
    expect(upage.locator('[data-watch="back"]')).to_be_enabled()
    expect(upage.locator('[data-watch="again"]')).to_be_enabled()
    expect(upage.locator('[data-testid="watch-progress"]')).to_have_text(re.compile(r"^\s*183 / 183\s*$"))
    answer_dialogs(upage, accept=True)
    sent = record_requests(upage, "/api/watch/", "POST")
    upage.locator('[data-watch="again"]').click()
    until(upage, lambda: len(sent) >= 2, what="stop then start")
    assert [r["path"] for r in sent[:2]] == ["/api/watch/stop", "/api/watch/start"]
    assert sent[0]["body"] == {"restore": True}
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "playing")


def test_retag_while_playing_pauses_first(upage, wsrv):
    """DC E2.8, 4.3 watch mode: A while the watch plays posts pause, then the retag."""
    base = wsrv["base"]
    start_watch(base, 1)
    wait_watch(base, lambda w: w["idx"] >= 3, what="the first Dallas snap")
    load(upage, base)
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "playing")
    sent = record_requests(upage, "/api/", "POST")
    blur(upage)
    upage.keyboard.press("a")
    until(upage, lambda: len(sent) >= 2, what="pause then retag")
    assert [r["path"] for r in sent[:2]] == ["/api/watch/pause", "/api/retag"]
    assert sent[1]["body"] == {"key": "A"}
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "paused")


def test_undo_is_refused_while_a_game_plays_back(upage, wsrv):
    """4.3 watch mode: U gives the red toast "Undo is off while a game plays back. Stop watching first." and no undo."""
    base = wsrv["base"]
    start_watch(base, 1)
    load(upage, base)
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "playing")
    undos = record_requests(upage, "/api/undo")
    blur(upage)
    upage.keyboard.press("u")
    expect_toast(upage, "Undo is off while a game plays back. Stop watching first.", error=True)
    quiet(upage)
    assert undos == []


def test_transport_buttons_follow_the_watch_state(upage, wsrv):
    """5.4: transport buttons are disabled when not allowed: playing (pause, stop), paused (play, step, stop)."""
    base = wsrv["base"]
    start_watch(base, 1)
    load(upage, base)
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "playing")
    expect_buttons(upage, enabled=("pause", "stop"), disabled=("play", "step"))
    upage.locator('[data-watch="pause"]').click()
    expect(watch_box(upage)).to_have_attribute("data-watch-state", "paused")
    expect_buttons(upage, enabled=("play", "step", "stop"), disabled=("pause",))


def expect_buttons(page, enabled, disabled):
    for name in enabled:
        expect(page.locator(f'[data-watch="{name}"]')).to_be_enabled()
    for name in disabled:
        expect(page.locator(f'[data-watch="{name}"]')).to_be_disabled()

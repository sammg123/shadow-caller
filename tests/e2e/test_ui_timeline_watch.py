"""The timeline on the page and the playback contract (ui-architecture 7.2, 5.3, 5.4; DC B, C, E; restructure-v2.md 5
and 9): every timeline row drawn on the field and listed on the ticker, the drive chart, win probability and the
scoreboard at the final whistle; the page opens its game once on load and leaves a running session or the live feed
alone; a jump (a seek, a drive picked on the drive chart) snaps the field to where the game is without replaying the
plays in between; while the game plays no row is ever ahead of the field. Runs on the sandboxes (conftest `server`
and the scaled-pace `watch_server`), never the live game."""
import re
import time

import pytest
from playwright.sync_api import expect
from ui_helpers import (EVENT, TOTAL_ROWS, api_get, api_post, app_url, blur, click_at, feed_on_server, finished,
                        full_timeline, game_at_end, load, quiet, record_requests, reset_game, seek_game, state,
                        stop_watch, until, version, wait_idle, wait_ready)

pytestmark = pytest.mark.e2e

PLAY_ROW = '[data-testid="play-row"]'
DRIVE_RESULTS = ["TD", "TD", "PUNT", "PUNT", "PUNT", "PUNT", "PUNT", "PUNT", "FG", "END OF HALF", "TD", "INT", "TD",
                 "FUMBLE", "FG", "DOWNS", "DOWNS", "TD", "PUNT", "INT", "END OF GAME"]          # DC G17
SCENES = {"webgl": "", "2d": "scene=2d"}
MID = 40
JUMP_FROM, JUMP_TO = 10, 120    # a long seek: 110 plays the field must not replay one by one
DRIVE_PICK = 4                  # the fifth drive on the chart


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


def last_seq(base):
    return max((r["seq"] for r in full_timeline(base)["rows"]), default=0)


# ---------------------------------------------------------------- the whole game, at the final whistle
@pytest.mark.parametrize("scene", sorted(SCENES))
def test_every_row_is_drawn_on_the_field(upage, server, scene):
    """5.3: at the final whistle the field has drawn all 183 rows (data-drawn-seq), nothing queued, idle, this
    epoch, ESPN's plays."""
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


def test_the_ticker_lists_every_row_with_its_verdict(upage, server):
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
    assert upage.locator(f"{PLAY_ROW} button, {PLAY_ROW} [tabindex]").count() == 0, "the ticker only reads"


def test_drives_win_probability_and_scoreboard(upage, server):
    """5.4, DC C: 21 drives with G17's results in order, win probability 0 at the end, 16 to 24, both logos."""
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
    assert upage.locator('[data-testid="box-score"]').count() == 0, "the box score lives on the Model Report now"


def test_play_text_is_never_html(upage, server):
    """G27 for ESPN's play text: a row whose text holds markup shows it as literal text."""
    base = server["base"]
    game_at_end(base)
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


# ---------------------------------------------------------------- the page opens its game (restructure-v2.md 9)
def opens(page):
    """POST /api/open requests from the page's first request on (recorded before it loads)."""
    return record_requests(page, "/api/open")


def test_a_first_visit_opens_the_saved_game_once_paused_at_kickoff(upage, server):
    base = server["base"]
    reset_game(base)
    sent = opens(upage)
    load(upage, base)
    assert len(sent) == 1, sent
    w = api_get(base, "/api/watch")
    assert (w["state"], w["idx"]) == ("paused", 0), w
    expect(upage.locator("#app")).to_have_attribute("data-mode", "watch")
    expect(upage.locator("#app")).to_have_attribute("data-watch-state", "paused")
    expect(upage.locator('[data-testid="progress-count"]')).to_have_text(f"0 / {w['total']}")
    upage.reload(wait_until="domcontentloaded")
    wait_ready(upage)
    assert len(sent) == 2, "every load opens once"
    assert api_get(base, "/api/watch")["idx"] == 0
    assert upage.errors == [], upage.errors


def test_open_leaves_a_running_session_where_it_is(upage, server):
    base = server["base"]
    seek_game(base, MID)
    sent = opens(upage)
    load(upage, base)
    assert len(sent) == 1, sent
    assert api_get(base, "/api/watch")["idx"] == MID
    expect(upage.locator('[data-testid="progress-count"]')).to_have_text(re.compile(rf"^{MID} / \d+$"))


def test_open_leaves_the_live_feed_on(upage, server):
    """With the live feed on (offline: the saved game, applied whole), open changes nothing: the feed stays on and no
    watch session starts."""
    base = server["base"]
    feed_on_server(base)
    before = version(base)
    load(upage, base)
    after = version(base)
    assert after["feed"]["on"] is True
    assert after["watch"]["state"] not in ("playing", "paused", "done"), after["watch"]
    assert after["epoch"] == before["epoch"]
    expect(upage.locator("#app")).to_have_attribute("data-mode", "feed")
    api_post(base, "/api/feed", {"on": False})


# ---------------------------------------------------------------- jumps snap the field
@pytest.fixture
def wsrv(watch_server):
    """The scaled-pace sandbox; any session a test leaves behind is stopped with the game put back."""
    yield watch_server
    stop_watch(watch_server["base"])


def sample_anim(page, until_seq, timeout_s=30):
    """#field's anim states, sampled every 40 ms until it is idle with `until_seq` drawn."""
    states = []
    end = time.monotonic() + timeout_s
    while time.monotonic() < end:
        st, drawn = page.evaluate("() => { const f = document.getElementById('field');"
                                  " return [f.dataset.animState, Number(f.dataset.drawnSeq || 0)]; }")
        states.append(st)
        if st == "idle" and drawn == until_seq:
            return states
        page.wait_for_timeout(40)
    raise AssertionError(f"#field never settled on {until_seq}: {states[-10:]}")


def test_a_seek_snaps_the_field_without_replaying_the_plays(upage_motion, wsrv):
    """restructure-v2.md 9: a long jump draws the last play and the next call's shadows at once (motion on): the
    field never runs the 110 plays in between."""
    base = wsrv["base"]
    seek_game(base, JUMP_FROM)
    load(upage_motion, base)
    wait_idle(upage_motion, JUMP_FROM)
    sent = record_requests(upage_motion, "/api/watch/seek")
    track = upage_motion.locator('[data-testid="progress"]')
    box = track.bounding_box()
    n = api_get(base, "/api/watch")["total"]
    track.click(position={"x": box["width"] * JUMP_TO / n, "y": box["height"] / 2})
    until(upage_motion, lambda: len(sent) == 1, what="the seek")
    until(upage_motion, lambda: api_get(base, "/api/watch")["idx"] == sent[0]["body"]["idx"], what="the server")
    states = sample_anim(upage_motion, last_seq(base))
    assert "playing" not in states, states
    assert upage_motion.errors == [], upage_motion.errors


def test_a_drive_on_the_drive_chart_jumps_to_its_first_play(upage, wsrv):
    """restructure-v2.md 5: a drive picked on the drive chart jumps the game there (a seek), paused."""
    base = wsrv["base"]
    game_at_end(base)
    load(upage, base)
    sent = record_requests(upage, "/api/watch/seek")
    click_at(upage, f'[data-testid="drive-chart"] [data-testid="drive"]:nth-child({DRIVE_PICK + 1}) button')
    until(upage, lambda: len(sent) == 1, what="the drive's seek")
    idx = sent[0]["body"]["idx"]
    until(upage, lambda: api_get(base, "/api/watch")["idx"] == idx, what="the server at the drive")
    expect(upage.locator('[data-testid="progress-count"]')).to_have_text(re.compile(rf"^{idx} / \d+$"))
    assert api_get(base, "/api/watch")["state"] == "paused"
    wait_idle(upage, last_seq(base))
    assert upage.errors == [], upage.errors


def test_space_pauses_then_resumes_through_the_server(upage, wsrv):
    """3.8, 4.3: Space posts pause on a playing game and resume on a paused one, nothing else."""
    base = wsrv["base"]
    reset_game(base)
    api_post(base, "/api/watch/start", {"event_id": EVENT, "speed": 1, "from_seq": 0})
    load(upage, base)
    expect(upage.locator("#app")).to_have_attribute("data-watch-state", "playing")
    sent = record_requests(upage, "/api/watch/", "POST")
    blur(upage)
    upage.keyboard.press("Space")
    expect(upage.locator("#app")).to_have_attribute("data-watch-state", "paused")
    upage.keyboard.press("Space")
    expect(upage.locator("#app")).to_have_attribute("data-watch-state", "playing")
    quiet(upage)
    assert [r["path"] for r in sent] == ["/api/watch/pause", "/api/watch/resume"]


def test_no_play_row_is_ever_ahead_of_the_field(upage_motion, wsrv):
    """DC E5 on screen (3.4): while a game plays with motion on, no play row has a seq above #field[data-drawn-seq]."""
    base = wsrv["base"]
    reset_game(base)
    api_post(base, "/api/watch/start", {"event_id": EVENT, "speed": 4, "from_seq": 0})
    upage_motion.goto(app_url(base), wait_until="domcontentloaded")
    wait_ready(upage_motion)
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
    assert max(d for d, _ in samples) > 0, "nothing was drawn while the game played"
    assert state(base)["watch"]["state"] in ("playing", "done")

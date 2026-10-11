"""The video board as one card (restructure-v2.md section 3), end to end on the saved TB at DAL game in Watch: PREVIOUS
PLAY, NEXT CALL and LAST 6 at once, never switching faces, in the two pre-snaps Sam captured (after "Short pass left ·
+11" at Q3 2:52 the next call is Inside run (A/B gap) 21% then PA short 16%; snap 41, after "Short pass left · +15" at
Q4 8:04, Short (0-9) 47% then Intermediate 11%), with Tampa Bay on the ball, before his first snap and at the final
whistle. It fits at 1440x900, 1512x982 and 1920x1080 without covering the top bar, the ribbons, the scoreboard band, the
ball or the shadow plays, scrolls nothing and sets no type below its world's size; a play on it lights its shadow on
the field, and a click or a key on it sends nothing (no user input into the game).

Runs on ui_helpers.WORLD (neutral by default; SC_E2E_WORLD=under-the-lights for Sam's world). Every test sets its own
state on the scaled-pace watch sandbox and leaves no session running. Card captures land in SC_CARD_SHOTS (default
test-results/visual/card/)."""
import os
from pathlib import Path

import pytest
from playwright.sync_api import expect
from ui_helpers import (BOOT_TIMEOUT_MS, WORLD, api_get, app_url, pct, point_at, record_requests, region_box, state,
                        stop_watch, until, wait_ready, watch_paused_at)

from helpers import ROOT

pytestmark = pytest.mark.e2e

SHOTS = Path(os.environ.get("SC_CARD_SHOTS", ROOT / "test-results" / "visual" / "card"))
ULS = WORLD == "under-the-lights"
SIZES = ((1440, 900), (1512, 982), (1920, 1080))
SAM_SIZE = (1512, 982)                   # Sam's laptop
TOP_PICK_IDX = 126                       # "Short pass left · +11" (Q3 2:52) applied; Dallas's snap 35 is next
MISS_IDX = 151                           # "Short pass left · +15" (Q4 8:04) applied; snap 41 is next
TB_BALL_IDX = 104                        # the interception applied: Tampa Bay has the ball at its 25
TOTAL_PLAYS = 183
DOTO_MIN_PX = 40                         # The 40 Pixel Rule
SLACK_PX = 0.5
# Each element of the card and the type size it must keep (its world's token, read off a probe in the page).
TYPE = {
    "under-the-lights": (
        (".sc-call-name", "--sc-size-l"), (".sc-call-pct", "--sc-size-call"), (".sc-then", "--sc-size-m"),
        (".sc-split-labels", "--sc-size-xs"), (".sc-fam-head", "--sc-size-s"), (".sc-call-kicker", "--uls-size-plate"),
        (".sc-face-kicker", "--uls-size-plate"), (".sc-prev-label", "--sc-size-m"),
        (".sc-prev-verdict", "--uls-size-ribbon"), (".sc-prev-predpct", "--uls-size-led-readout"),
        (".sc-recent-label", "--sc-size-xs"), (".sc-recent-tally", "--sc-size-s"),
        (".sc-recent-note", "--sc-size-xs")),
    "neutral": (
        (".sc-call-name", "--sc-size-xl"), (".sc-call-pct", "--sc-size-call"), (".sc-then", "--sc-size-m"),
        (".sc-split-labels", "--sc-size-xs"), (".sc-fam-head", "--sc-size-s"), (".sc-call-kicker", "--sc-size-s"),
        (".sc-face-kicker", "--sc-size-s"), (".sc-prev-label", "--sc-size-m"), (".sc-prev-verdict", "--sc-size-m"),
        (".sc-prev-predname", "--sc-size-l"), (".sc-recent-label", "--sc-size-xs"), (".sc-recent-tally", "--sc-size-s"),
        (".sc-recent-note", "--sc-size-xs")),
}[WORLD]

TYPE_JS = """pairs => { const hero = document.getElementById('heroArea'); const probe = document.createElement('span');
  hero.appendChild(probe); const px = (e) => parseFloat(getComputedStyle(e).fontSize);
  const out = pairs.map(([sel, token]) => { const el = [...hero.querySelectorAll(sel)].find(e => e.getClientRects().length);
    probe.style.fontSize = `var(${token})`; return [sel, el ? px(el) : null, px(probe)]; });
  probe.remove(); return out; }"""

# What the card may not cover, in viewport px: the board (its fixture, or the call region), the HUD around it, and the
# ball and the shadow plays as the engine projects them (debug=1: clarity.ball, clarity.shadows[].px, the NEXT plates).
COVER_JS = """() => { const r = (n) => { const b = n.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
  const call = document.getElementById('rg-call'); const board = call.closest('.uls-board') || call;
  const field = document.getElementById('field').getBoundingClientRect();
  const d = window.__shadowDebug ? window.__shadowDebug() : null; const c = d && d.clarity;
  const at = ([x, y]) => [x + field.left, y + field.top];
  const plates = [...document.querySelectorAll('#field .sc-field-label > span, #field .sc-fb-plate')]
    .filter(e => e.getClientRects().length).map(r);
  return { board: r(board), scroll: [board.scrollHeight, board.clientHeight],
    page: [document.documentElement.scrollWidth, innerWidth],
    ball: c && c.ball ? [c.ball.x0 + field.left, c.ball.y0 + field.top, c.ball.x1 + field.left, c.ball.y1 + field.top] : null,
    strokes: c ? c.shadows.flatMap(s => s.px.map(at)) : [], plates, field: [field.left, field.top, field.right, field.bottom] }; }"""


@pytest.fixture
def wsrv(watch_server):
    """The scaled-pace sandbox; a session a test leaves behind is stopped with the game put back."""
    yield watch_server
    stop_watch(watch_server["base"])


def open_card(ui_pages, base, size=SAM_SIZE):
    page = ui_pages(*size)
    page.goto(app_url(base, "debug=1"), wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    wait_ready(page)
    expect(page.locator("#field")).to_have_attribute("data-scene-ready", "true", timeout=BOOT_TIMEOUT_MS)
    page.evaluate("document.fonts.ready.then(() => true)")
    page.mouse.move(5, size[1] // 2)                       # off the board, so it stays its own size
    return page


def words(locator):
    return " ".join(locator.text_content().split())


def capture(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.locator("#rg-call").screenshot(path=str(SHOTS / f"{WORLD}-{name}.png"))


def no_errors(page):
    assert [e for e in page.errors if e.startswith("pageerror")] == [], page.errors


def card(page):
    return page.locator("#heroArea")


def expect_previous(page, label, verdict):
    prev = card(page).locator(".sc-prev")
    expect(prev).to_be_visible()
    expect(prev.locator(".sc-prev-label")).to_have_text(label)
    expect(prev.locator(".sc-prev-verdict")).to_have_text(verdict)
    return prev


def expect_next_call(page, s, snap):
    top = s["prediction"]["top"]
    call = card(page).locator(".sc-call")
    expect(call).to_be_visible()
    expect(call.locator(".sc-call-kicker")).to_have_text(f"Schottenheimer's next call · Snap {snap}")
    expect(call.locator(".sc-call-name")).to_have_text(top[0]["name"])
    expect(call.locator(".sc-call-pct")).to_have_text(pct(top[0]["p"]))
    items = call.locator(".sc-then-item")
    expect(items).to_have_count(2)
    for i, t in enumerate(top[1:3]):
        expect(items.nth(i).locator(".sc-then-name")).to_have_text(t["name"])
        expect(items.nth(i).locator(".sc-then-pct")).to_have_text(pct(t["p"]))
        expect(items.nth(i)).to_be_visible()
    return call


def expect_last_six(page, s):
    """LAST 6 and his night so far; once a flag has wiped out a call (graded, no snap number) the tally says how his
    calls split, so "Snap 55" beside "of 59" needs no guessing."""
    g = s["metrics"]["granular"]
    recent = card(page).locator(".sc-recent")
    expect(recent).to_be_visible()
    expect(recent.locator(".sc-recent-dot")).to_have_count(min(6, len(s["log"])))
    assert words(recent.locator(".sc-recent-tally")) == (
        f"Top pick {g['leaf_top1']} of {g['leaf_n']} · In his top 3 {g['leaf_top3']} of {g['leaf_n']}")
    wiped = sum(1 for r in s["log"] if r.get("nullified") and r.get("leaf_rank") is not None)
    note = recent.locator(".sc-recent-note")
    if wiped:
        expect(note).to_have_text(f"{g['leaf_n']} calls: {g['leaf_n'] - wiped} snaps and {wiped} wiped out by "
                                  + ("a flag" if wiped == 1 else "flags"))
    else:
        expect(note).to_be_hidden()


# ---------------------------------------------------------------- Sam's two captures
def test_after_a_top_pick_the_card_shows_his_previous_call_the_next_call_and_his_last_six(ui_pages, wsrv):
    """Sam's first capture, Q3 2:52: PREVIOUS PLAY "Short pass left · +11", top pick at 19%; NEXT CALL Inside run
    (A/B gap) 21%, then PA short (0-9) 16% and his #3; LAST 6 and his night so far, all on screen at once."""
    base = wsrv["base"]
    watch_paused_at(base, TOP_PICK_IDX)
    s = state(base)
    top = s["prediction"]["top"]
    assert [(top[0]["name"], pct(top[0]["p"])), (top[1]["name"], pct(top[1]["p"]))] == [
        ("Inside run (A/B gap)", "21%"), ("PA short (0–9)", "16%")], "Sam's numbers"
    page = open_card(ui_pages, base)
    prev = expect_previous(page, "Short pass left · +11", f"Top pick · {pct(s['log'][0]['leaf_p'])}")
    expect(prev.locator(".sc-face-kicker")).to_have_text(f"Previous play · Snap {s['log'][0]['snap']}")
    expect(prev.locator(".sc-prev-predicted")).to_be_hidden()
    expect_next_call(page, s, s["prediction"]["snap_next"])
    expect_last_six(page, s)
    expect(card(page)).to_have_attribute("data-kind", "call")
    capture(page, f"after-top-pick-{SAM_SIZE[0]}x{SAM_SIZE[1]}")
    no_errors(page)


def test_snap_41_after_a_miss_shows_the_miss_and_the_next_call(ui_pages, wsrv):
    """Sam's second capture, snap 41 after "Short pass left · +15" (Q4 8:04): MISS with his #4 Intermediate at 10%
    and what the board predicted; NEXT CALL Short (0-9 air yds) 47%, then Intermediate (10-19) 11%."""
    base = wsrv["base"]
    watch_paused_at(base, MISS_IDX)
    s = state(base)
    top, last = s["prediction"]["top"], s["log"][0]
    assert s["prediction"]["snap_next"] == 41
    assert [(top[0]["name"], pct(top[0]["p"])), (top[1]["name"], pct(top[1]["p"]))] == [
        ("Short (0–9 air yds)", "47%"), ("Intermediate (10–19)", "11%")], "Sam's numbers"
    page = open_card(ui_pages, base)
    prev = expect_previous(page, "Short pass left · +15", f"Miss · #{last['leaf_rank']} Intermediate · {pct(last['leaf_p'])}")
    expect(prev.locator(".sc-prev-predicted")).to_be_visible()
    expect(prev.locator(".sc-prev-predname")).to_have_text(s["leaf_names"][last["top_leaf"]])
    expect(prev.locator(".sc-prev-predpct")).to_have_text(pct(last["top_leaf_p"]))
    expect_next_call(page, s, 41)
    expect_last_six(page, s)
    capture(page, f"after-miss-snap-41-{SAM_SIZE[0]}x{SAM_SIZE[1]}")
    no_errors(page)


# ---------------------------------------------------------------- whoever has the ball
def test_while_tb_has_the_ball_next_call_says_so_and_his_previous_call_stays(ui_pages, wsrv):
    """After the interception: NEXT CALL reads "TB has the ball"; PREVIOUS PLAY (his intercepted pass) and LAST 6
    stay up."""
    base = wsrv["base"]
    watch_paused_at(base, TB_BALL_IDX)
    s = state(base)
    assert s["prediction"] is None
    page = open_card(ui_pages, base)
    expect(card(page)).to_have_attribute("data-kind", "offfield")
    expect(card(page).locator(".sc-offfield-heading")).to_have_text("TB has the ball")
    expect(card(page).locator(".sc-call")).to_be_hidden()
    expect_previous(page, "Pass intercepted · short middle", f"Top pick · {pct(s['log'][0]['leaf_p'])}")
    expect_last_six(page, s)
    capture(page, f"tb-has-the-ball-{SAM_SIZE[0]}x{SAM_SIZE[1]}")
    no_errors(page)


def test_before_his_first_snap_there_is_no_previous_play_at_all(ui_pages, wsrv):
    """At kickoff: no PREVIOUS PLAY and no LAST 6 (absent, never a placeholder); NEXT CALL says when his call comes,
    and nothing on the card asks for input."""
    base = wsrv["base"]
    watch_paused_at(base, 0)
    page = open_card(ui_pages, base)
    expect(card(page).locator(".sc-offfield-body")).to_have_text("When DAL gets the ball, his next call appears here.")
    expect(card(page).locator(".sc-prev")).to_be_hidden()
    expect(card(page).locator(".sc-recent")).to_be_hidden()
    expect(card(page)).not_to_contain_text("Ball on")
    no_errors(page)


def test_at_the_final_whistle_next_call_becomes_final(ui_pages, wsrv):
    """The whole game applied: FINAL, the score and the way to the full scorecard in the Model Report (Sam: no Shadow
    v League numbers on the GameCast), with his last call and his last six still up."""
    base = wsrv["base"]
    watch_paused_at(base, TOTAL_PLAYS)
    s = state(base)
    status = api_get(base, "/api/timeline?since=0")["status"]
    assert status["state"] == "post"
    page = open_card(ui_pages, base)
    expect(card(page)).to_have_attribute("data-kind", "final")
    face = card(page).locator(".sc-final")
    expect(face.locator(".sc-face-kicker")).to_have_text("Final")
    for abbr, score in status["score"].items():
        expect(face.locator(f'.sc-final-team[data-team="{abbr}"] .sc-digits-value')).to_have_text(str(score))
    expect(face.locator(".sc-final-line")).to_have_count(0)
    expect(face).not_to_contain_text("League")
    expect(face.locator('a.sc-key[href^="/report"]')).to_have_text("Tonight's scorecard")
    expect_previous(page, "Pass intercepted · short middle", f"Top pick · {pct(s['log'][0]['leaf_p'])}")
    expect_last_six(page, s)
    capture(page, f"final-{SAM_SIZE[0]}x{SAM_SIZE[1]}")
    no_errors(page)


# ---------------------------------------------------------------- it fits
def overlaps(a, b):
    return a[0] < b[2] - SLACK_PX and b[0] < a[2] - SLACK_PX and a[1] < b[3] - SLACK_PX and b[1] < a[3] - SLACK_PX


def inside(box, pt):
    return box[0] + SLACK_PX < pt[0] < box[2] - SLACK_PX and box[1] + SLACK_PX < pt[1] < box[3] - SLACK_PX


def hud_boxes(page):
    """The HUD the card may not cover: the top bar, the plays ticker, the scoreboard band, the drive chart and the win
    probability (whichever this page shows), as viewport boxes."""
    boxes = {}
    for sel in ("#rg-masthead", "#rg-plays", "#rg-scoreboard", "#rg-drives", "#rg-wp"):
        if page.locator(sel).count():
            b = region_box(page, sel)
            if b and b["width"] and b["height"]:
                boxes[sel] = [b["x"], b["y"], b["x"] + b["width"], b["y"] + b["height"]]
    return boxes


@pytest.mark.parametrize("size", SIZES, ids=[f"{w}x{h}" for w, h in SIZES])
def test_the_card_fits_and_covers_nothing(ui_pages, wsrv, size):
    """The tallest card (a miss, with what the board predicted) at the three windows: whole on screen with nothing to
    scroll, clear of the HUD, the ball and the shadow plays, and every type size at least its world's."""
    base = wsrv["base"]
    watch_paused_at(base, MISS_IDX)
    want = " ".join(t["key"] for t in state(base)["prediction"]["top"][:2])
    page = open_card(ui_pages, base, size)
    expect(card(page).locator(".sc-prev-predicted")).to_be_visible()
    expect(page.locator("#field")).to_have_attribute("data-ghosts", want)
    page.wait_for_selector('#field[data-anim-state="idle"]', state="attached")
    got = page.evaluate(COVER_JS)
    assert got["scroll"][0] <= got["scroll"][1] + 1, f"the card scrolls in its board: {got['scroll']}"
    assert got["page"][0] <= got["page"][1], f"the page scrolls sideways: {got['page']}"
    board = got["board"]
    for name, box in hud_boxes(page).items():
        assert not overlaps(board, box), f"the card {board} covers {name} {box}"
    if ULS:
        assert 0 <= board[0] and board[2] <= size[0] and 0 <= board[1] and board[3] <= size[1], f"off screen: {board}"
        assert got["ball"] and not overlaps(board, got["ball"]), f"the card {board} covers the ball {got['ball']}"
        on_card = [p for p in got["strokes"] if inside(board, p)]
        assert got["strokes"] and not on_card, f"the card covers a shadow play at {on_card[:3]}"
        assert not [p for p in got["plates"] if overlaps(board, p)], "the card covers a play's words on the field"
    else:
        assert not overlaps(board, got["field"]), f"the card {board} sits on the field {got['field']}"
    sizes = page.evaluate(TYPE_JS, [list(p) for p in TYPE])
    small = [(sel, px, want_px) for sel, px, want_px in sizes if px is None or px < want_px - 0.01]
    assert not small, f"type below its size (selector, px, token px): {small}"
    if ULS:
        doto = page.evaluate("""() => [...document.querySelectorAll('#heroArea .sc-call-pct, #heroArea .sc-prev-predpct')]
          .filter(e => e.getClientRects().length).map(e => parseFloat(getComputedStyle(e).fontSize))""")
        assert doto and min(doto) >= DOTO_MIN_PX, doto
    no_errors(page)


# ---------------------------------------------------------------- a play is shown, never picked
def test_a_play_on_the_card_lights_its_shadow_and_sends_nothing(ui_pages, wsrv):
    """Pointing at the top pick lights its shadow on the field; a click focuses it, and focus keeps it lit; a click or
    Enter on a play sends nothing to the server."""
    base = wsrv["base"]
    watch_paused_at(base, TOP_PICK_IDX)
    top1 = state(base)["prediction"]["top"][0]["key"]
    page = open_card(ui_pages, base, (1440, 900))
    field = page.locator("#field")
    sent = record_requests(page, "/api/", method="POST")
    leaf = point_at(page, f'#heroArea .leaf[data-leaf="{top1}"]')
    expect(field).to_have_attribute("data-ghost-highlight", top1)
    page.mouse.down()
    page.mouse.up()
    expect(leaf).to_be_focused()
    page.mouse.move(2, 2)
    expect(field).to_have_attribute("data-ghost-highlight", top1)      # focus holds the light once the pointer leaves
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    assert [r for r in sent if r["path"] != "/api/open"] == [], sent
    leaf.evaluate("e => e.blur()")
    until(page, lambda: field.get_attribute("data-ghost-highlight") in ("", None), what="the light to clear on blur")
    no_errors(page)

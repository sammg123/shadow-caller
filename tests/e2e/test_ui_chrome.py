"""A9 chrome in the browser (ui-architecture.md 2.6, 3.8, 3.9, 5.1, 5.3, 5.4; feature-inventory.md 6.3 #92 to #109):
the ESPN feed bar and Replay, Watch this game, the connection banner, the boot screen, toasts, the masthead keys, the
field host's hooks and the review banner. Neutral world, sandboxed servers only (never the live game). Watch tests
use the `watch_server` sandbox with SHADOW_WATCH_SCALE small, so a whole game plays back in seconds."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (EVENT, TOTAL_ROWS, answer_dialogs, blur, command, expect_log_rows, expect_toast,
                        feed_on, finished, fresh, full_timeline, load, quiet, record_requests, reset_game, state,
                        until, version, wait_idle, wait_ready, wait_server)

pytestmark = pytest.mark.e2e

FEED_ON_TOAST = "ESPN live feed on. Plays log themselves; retag play-action, screen or RPO."
FEED_OFF_STATUS = "Off: enter plays by hand, or turn it on and plays log themselves."
CONFIRM_REPLAY = f"Rebuild the game log from ESPN game {EVENT}? The current log is backed up first."
CONFIRM_RESET_FEED_ON = ("Clear every snap logged for this game? The ESPN feed turns off first, so it doesn't log the "
                         "game again.")
CONFIRM_WATCH = f"Watch ESPN game {EVENT} from the start? Your game is backed up first and comes back when you stop."
CONFIRM_STOP = "Stop watching and put your game back?"
HINT_FEED = ("ESPN logs each play, down, distance, spot, clock and score. It can't see play-action, screens or RPOs: "
             "press A, N or O to fix the last play. P undoes that, J/K/L change the run gap, U undoes.")
UPDATED_RE = re.compile(r"^Updated (\d\d:\d\d:\d\d) · Last: END GAME$")
ANY = re.compile(".*")
LONG_MS = 30_000             # a replay holds the server about 11 s (DC E6); the toast comes after it
GAME_MS = 240_000            # a whole watched game: about 11 s at 10x on an idle machine, every DAL snap runs predict()


def feed_bar(page):
    return page.locator("#rg-feed")


def transport(page):
    return page.locator('[data-testid="watch"]')


def field(page):
    return page.locator("#field")


def drawn(page):
    return int(field(page).get_attribute("data-drawn-seq") or "0")


def settled(page, base, timeout_ms=15_000):
    """The field has drawn every row a paused watch applied: returns that seq. A pause can land while the watch thread
    is still applying the play it started (DC E2), so the server's count is read again until the field matches it."""
    def caught_up():
        n = version(base)["timeline_n"]
        idle = page.locator(f'#field[data-anim-state="idle"][data-drawn-seq="{n}"]').count() == 1
        return n if idle else None
    until(page, lambda: caught_up() is not None, timeout_ms, step_ms=250, what="the field to draw every applied row")
    page.wait_for_timeout(600)                         # nothing else lands while paused
    n = caught_up()
    assert n is not None, "a paused watch kept applying plays"
    return n


def play_seqs(page):
    return [int(s) for s in page.locator('[data-testid="play-row"]').evaluate_all(
        "rows => rows.map(r => r.getAttribute('data-seq'))")]


def patched_json(route, change):
    """Answer a GET with the real body changed by `change(body)` (an old server, a feed state the sandbox can't
    reach on demand)."""
    response = route.fetch()
    route.fulfill(response=response, json=change(response.json()))


# ---------------------------------------------------------------- ESPN feed (#92 to #105)
def test_92_94_95_feed_on_from_the_bar(upage, server):
    """#92: the button sends {"on": true, "event_id": "401872980"}, reads "ESPN live: on" in the live style and toasts.
    #94: the whole saved game lands and the status reads "Updated HH:MM:SS · Last: END GAME". #95 (Appendix A): the
    "Updated" time moves with the feed's polls without refetching /api/state."""
    base = server["base"]
    fresh(upage, base)
    expect(upage.locator("#feedEvent")).to_have_value(EVENT)
    posts = record_requests(upage, "/api/feed")
    upage.locator("#feedBtn").click()
    until(upage, lambda: posts, what="POST /api/feed")
    assert posts[0]["body"] == {"on": True, "event_id": EVENT}
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: on")
    expect(upage.locator("#feedBtn")).to_have_class(re.compile(r"(^|\s)on(\s|$)"))
    expect(upage.locator("#feedBtn")).to_have_attribute("data-feed-state", "live")
    expect_toast(upage, FEED_ON_TOAST)
    status = upage.locator("#feedStatus")
    expect(status).to_have_text(UPDATED_RE, timeout=LONG_MS)
    expect(status.locator("strong")).to_have_text(["Last:"])
    expect_log_rows(upage, 59, timeout=LONG_MS)
    first = UPDATED_RE.match(status.text_content()).group(1)
    states = record_requests(upage, "/api/state", "GET")
    until(upage, lambda: UPDATED_RE.match(status.text_content() or "") and
          UPDATED_RE.match(status.text_content()).group(1) != first, 12_000, what="a newer feed poll time")
    assert states == [], "the poll time comes from /api/version; the state is not refetched"


def test_93_96_feed_mode_entry_and_last_play(upage, server):
    """#93: with the feed on the manual pad and the flag panel are hidden, the entry panel is not dimmed and the hint
    is the feed's. #96: the last-play panel shows ESPN's last play and the retag keys, P current."""
    feed_on(upage, server["base"])
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: on")
    expect(upage.locator("#manualEntry")).to_be_hidden()
    expect(upage.locator("#flagPanel")).to_be_hidden()
    expect(upage.locator("#entry")).not_to_have_attribute("data-dim", "true")
    expect(upage.locator("#entryHint")).to_have_text(HINT_FEED)
    last = upage.locator("#lastPlay")
    expect(last).to_be_visible()
    for text in ("Last play from ESPN", "Short (0–9 air yds), turnover", "0 yds"):
        expect(last).to_contain_text(text)
    for key in "ANOP":
        expect(last.locator(f'[data-retag="{key}"]')).to_be_visible()
    expect(last.locator('[data-retag="P"]')).to_have_class(re.compile(r"(^|\s)cur(\s|$)"))


def test_97_98_99_feed_mode_keys(upage, server):
    """#97: A retags the last pass to play-action and P puts it back. #98: J on a pass is a red toast. #99: X, Esc,
    Enter, T, F, I, S and C send nothing; U undoes, and a fed play is refused with a red toast."""
    feed_on(upage, server["base"])
    expect(upage.locator("#lastPlay")).to_be_visible()
    retags = record_requests(upage, "/api/retag")
    blur(upage)
    upage.keyboard.press("A")
    expect_toast(upage, "Last play retagged: PA short (0–9).")
    assert retags[0]["body"] == {"key": "A"}
    expect(upage.locator("#lastPlay")).to_contain_text(" · retagged")
    expect(upage.locator('#lastPlay [data-retag="A"]')).to_have_class(re.compile(r"(^|\s)cur(\s|$)"))
    upage.locator('#lastPlay [data-retag="P"]').click()
    expect(upage.locator("#lastPlay")).to_contain_text("Short (0–9 air yds)")
    blur(upage)
    upage.keyboard.press("J")
    expect_toast(upage, "J doesn't fit a pass.", error=True)
    posts = record_requests(upage, "/api/", method="POST")
    for key in ("X", "Escape", "Enter", "T", "F", "I", "S", "C"):
        upage.keyboard.press(key)
    quiet(upage)
    assert posts == [], posts
    for done in (1, 2):                                 # U undoes the two retags made after the last ESPN play
        upage.keyboard.press("U")
        until(upage, lambda: len(posts) == done, what=f"undo {done}")
        expect_toast(upage, "Undid the last action.")
    upage.keyboard.press("U")                           # then reaches a play ESPN logged: refused (Appendix B v1.2)
    expect_toast(upage, re.compile(r"^Undo can't take back a play ESPN logged"), error=True)
    assert [p["path"] for p in posts] == ["/api/undo"] * 3


def test_100_feed_on_before_the_first_espn_play(upage, server):
    """#100: the feed is on and no ESPN row has landed yet: "Waiting for the first DAL play" (the feed state comes
    from an intercepted answer; the offline sandbox applies the whole game on its first poll)."""
    base = server["base"]
    reset_game(base)
    starting = {"on": True, "state": "starting", "last_poll": None, "last_play": None, "skipped": None}
    upage.route("**/api/state", lambda r: patched_json(r, lambda b: {**b, "feed": {**b["feed"], **starting}}))
    upage.route("**/api/version", lambda r: patched_json(r, lambda b: {**b, "feed": {**b["feed"], **starting}}))
    load(upage, base)
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: on")
    expect(upage.locator("#feedStatus")).to_have_text("Updated …")
    expect(upage.locator("#lastPlay")).to_contain_text("Waiting for the first DAL play")
    expect(upage.locator("#lastPlay")).to_contain_text("Plays appear here a few seconds after ESPN posts them.")


def test_101_a_feed_that_cannot_reach_espn_keeps_retrying(upage, server):
    """#101: event id 999 with the feed on: "ESPN live: retrying" in the error style, and the reason it gives."""
    base = server["base"]
    fresh(upage, base)
    box = upage.locator("#feedEvent")
    box.fill("999")
    upage.locator("#feedBtn").click()
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: retrying", timeout=15_000)
    expect(upage.locator("#feedBtn")).to_have_class(re.compile(r"(^|\s)err(\s|$)"))
    expect(upage.locator("#feedBtn")).to_have_attribute("data-feed-state", "retrying")
    expect(upage.locator("#feedStatus")).to_have_text(
        re.compile(r"^Can't reach ESPN \(.+\)\. Still trying every few seconds\.$"))
    upage.locator("#feedBtn").click()
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: off")


def test_102_a_skipped_play_shows_in_the_status_line(upage, server):
    """#102: with the feed on and feed.skipped set, the status line names it after "Skipped, enter it by hand:"."""
    base = server["base"]
    reset_game(base)
    live = {"on": True, "state": "live", "last_poll": "21:00:00", "last_play": "END GAME",
            "skipped": "J.Daniels pass short left (no spot)"}
    upage.route("**/api/state", lambda r: patched_json(r, lambda b: {**b, "feed": {**b["feed"], **live}}))
    upage.route("**/api/version", lambda r: patched_json(r, lambda b: {**b, "feed": {**b["feed"], **live}}))
    load(upage, base)
    status = upage.locator("#feedStatus")
    expect(status).to_have_text("Updated 21:00:00 · Last: END GAME · Skipped, enter it by hand: "
                                "J.Daniels pass short left (no spot)")
    expect(status.locator("strong")).to_have_text(["Last:", "Skipped, enter it by hand:"])


def test_103_turning_the_feed_off_brings_the_pad_back(upage, server):
    """#103: off again: "ESPN live: off", the off line, the manual pad back, the last-play panel hidden."""
    feed_on(upage, server["base"])
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: on")
    upage.locator("#feedBtn").click()
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: off")
    expect(upage.locator("#feedBtn")).to_have_attribute("data-feed-state", "off")
    expect(upage.locator("#feedStatus")).to_have_text(FEED_OFF_STATUS)
    expect(upage.locator("#manualEntry")).to_be_visible()
    expect(upage.locator("#lastPlay")).to_be_hidden()


def test_104_the_id_box_keeps_what_is_typed_and_enter_only_blurs(upage, server):
    """#104: a render never overwrites the focused id box, and Enter in it blurs without sending anything."""
    base = server["base"]
    fresh(upage, base)
    box = upage.locator("#feedEvent")
    box.click()
    box.fill("40187")
    before = version(base)["version"]
    command(base, "DAL 3 TB 0")                         # another client changes the game: the page re-renders
    wait_server(base, lambda v: v["version"] != before)
    expect(upage.locator("#iOff")).to_have_value("3", timeout=8_000)
    expect(box).to_have_value("40187")
    posts = record_requests(upage, "/api/", method="POST")
    box.press("Enter")
    quiet(upage)
    assert upage.evaluate("() => document.activeElement && document.activeElement.id") != "feedEvent"
    assert posts == [], posts
    expect(box).to_have_value("40187")


def test_105_reset_with_the_feed_on_turns_the_feed_off_first(upage, server):
    """#105 (G9): the confirm says the feed turns off; the feed stops before the reset, so nothing is re-logged."""
    base = server["base"]
    feed_on(upage, base)
    dialogs = answer_dialogs(upage)
    posts = record_requests(upage, "/api/", method="POST")
    upage.locator("#resetBtn").click()
    expect_toast(upage, "Set the start of Dallas's first drive.")
    assert dialogs == [CONFIRM_RESET_FEED_ON]
    assert [p["path"] for p in posts] == ["/api/feed", "/api/reset"]
    assert posts[0]["body"] == {"on": False, "event_id": None}
    expect(upage.locator("#feedBtnTxt")).to_have_text("ESPN live: off")
    upage.wait_for_timeout(5_000)                      # longer than one feed poll (4 s)
    assert state(base)["log"] == []


def test_g12_background_news_lands_in_the_feed_bar_not_a_toast(upage, server):
    """G12: a change this page did not make (another client, the feed thread) arrives by poll; its message shows in
    the feed bar's polite region, never as a toast."""
    base = server["base"]
    fresh(upage, base)
    expect(upage.locator("#gameLabel")).not_to_have_text("")
    bg = upage.locator('[data-testid="bg-message"]')
    expect(bg).to_have_attribute("role", "status")
    expect(bg).to_have_attribute("aria-live", "polite")
    news = command(base, "new D25")["message"]
    expect(bg).to_have_text(news)
    expect(bg).to_have_attribute("data-empty", "false")
    expect(upage.locator("#toast")).not_to_have_class(re.compile(r"(^|\s)show(\s|$)"))


def test_reset_needs_a_yes(upage, server):
    """Dismissing the Reset confirm sends nothing (#89 on the masthead's Reset key)."""
    base = server["base"]
    reset_game(base)
    command(base, "new D25 | K 3")
    load(upage, base)
    dialogs = answer_dialogs(upage, accept=False)
    posts = record_requests(upage, "/api/reset")
    upage.locator("#resetBtn").click()
    until(upage, lambda: dialogs, what="the Reset confirm")
    quiet(upage)
    assert dialogs == ["Clear every snap logged for this game?"]
    assert posts == []
    assert len(state(base)["log"]) == 1


# ---------------------------------------------------------------- Replay (#106 to #109)
def test_106_replay_asks_then_rebuilds_the_game(upage, server):
    """#106: the confirm names the event; the toast reports 55 DAL plays and the backup."""
    base = server["base"]
    fresh(upage, base)
    dialogs = answer_dialogs(upage)
    upage.locator("#replayBtn").click()
    expect(upage.locator("#toast")).to_have_text(
        f"Replayed ESPN game {EVENT}: 55 DAL plays logged. Old game backed up in data/.", timeout=LONG_MS)
    assert dialogs == [CONFIRM_REPLAY]
    expect_toast(upage, re.compile(r"^Replayed ESPN game"))


def test_107_108_a_replayed_game_on_screen(upage, server):
    """#107: 59 log rows, 16 to 24, Q4 0:00, the offense off the field. #108: exactly 4 rows with Yds "flag"."""
    finished(upage, server["base"])
    expect_log_rows(upage, 59, timeout=LONG_MS)
    expect(upage.locator('[data-testid="team-score"][data-team="DAL"]')).to_contain_text("16")
    expect(upage.locator('[data-testid="team-score"][data-team="TB"]')).to_contain_text("24")
    expect(upage.locator("#heroArea")).to_contain_text("DAL is off the field")
    expect(upage.locator("#iQtr")).to_have_value("4")
    expect(upage.locator("#iClock")).to_have_value("0:00")
    flags = upage.locator("#logArea tbody tr").filter(has_text="(no play:")
    expect(flags).to_have_count(4)


def test_109_replay_of_an_unknown_game_changes_nothing(upage, server):
    """#109: Replay with event id 999 is a red toast, and the game stays as it was."""
    base = server["base"]
    finished(upage, base)
    before = version(base)
    answer_dialogs(upage)
    upage.locator("#feedEvent").fill("999")
    upage.locator("#replayBtn").click()
    expect(upage.locator("#toast")).to_have_class(re.compile(r"(^|\s)err(\s|$)"), timeout=LONG_MS)
    expect(upage.locator("#toast")).to_have_attribute("data-tone", "error")
    after = version(base)
    assert (after["epoch"], after["timeline_n"]) == (before["epoch"], before["timeline_n"])
    assert len(state(base)["log"]) == 59


# ---------------------------------------------------------------- Watch this game (3.8, DC E1 to E5)
def test_watch_start_pause_step_speeds_and_stop(upage, watch_server):
    """Start at the speed picked beforehand; Space pauses; Right steps exactly one play; 1 to 4 post 1, 2, 4 and 10;
    nothing on screen runs ahead of the field (DC E5); Stop puts the pre-watch game back."""
    base = watch_server["base"]
    reset_game(base)
    command(base, "new D25 | K 3")                     # our own game: the watch backs it up and Stop puts it back
    before = [row["name"] for row in state(base)["log"]]
    load(upage, base)
    dialogs = answer_dialogs(upage)
    posts = record_requests(upage, "/api/watch/")
    box = transport(upage)
    expect(box).to_have_attribute("data-watch-state", "idle")
    box.locator('[data-speed="1"]').click()
    expect(box.locator('[data-speed="1"]')).to_have_attribute("aria-pressed", "true")
    feed_bar(upage).locator('[data-watch="start"]').click()
    expect(box).to_have_attribute("data-watch-state", "playing")
    assert dialogs == [CONFIRM_WATCH]
    assert posts[0] == {"path": "/api/watch/start", "method": "POST",
                        "body": {"event_id": EVENT, "speed": 1, "from_seq": 0}}
    expect(feed_bar(upage).locator('[data-watch="start"]')).to_be_hidden()
    expect(upage.locator('[data-testid="watch-progress"]')).to_have_text(re.compile(rf"^\d+ / {TOTAL_ROWS}$"))
    blur(upage)
    upage.keyboard.press("Space")
    expect(box).to_have_attribute("data-watch-state", "paused")
    seq = settled(upage, base)
    upage.keyboard.press("ArrowRight")
    expect(field(upage)).to_have_attribute("data-drawn-seq", str(seq + 1))
    quiet(upage)
    assert drawn(upage) == seq + 1, "Right steps exactly one play"
    for digit in "1234":
        upage.keyboard.press(digit)
    until(upage, lambda: len([p for p in posts if p["path"] == "/api/watch/speed"]) == 4, what="four speed posts")
    assert [p["body"]["speed"] for p in posts if p["path"] == "/api/watch/speed"] == [1, 2, 4, 10]
    expect(box.locator('[data-speed="10"]')).to_have_attribute("aria-pressed", "true")
    assert max(play_seqs(upage), default=0) <= drawn(upage), "a play row is ahead of the field"
    box.locator('[data-watch="stop"]').click()
    expect(box).to_have_attribute("data-watch-state", re.compile(r"^(idle|stopped)$"))
    assert dialogs[-1] == CONFIRM_STOP
    assert posts[-1]["path"] == "/api/watch/stop" and posts[-1]["body"] == {"restore": True}
    assert [row["name"] for row in state(base)["log"]] == before


def test_watch_transport_keys_then_done_back_and_again(upage, watch_server):
    """The transport's own keys: start (10x), pause, step, play. At the end, Back to my game and Watch again show,
    and Watch again stops with restore before it starts (DC E2.5)."""
    base = watch_server["base"]
    reset_game(base)
    load(upage, base)
    dialogs = answer_dialogs(upage)
    posts = record_requests(upage, "/api/watch/")
    box = transport(upage)
    box.locator('[data-speed="10"]').click()
    box.locator('[data-watch="start"]').click()
    expect(box).to_have_attribute("data-watch-state", "playing")
    box.locator('[data-watch="pause"]').click()
    expect(box).to_have_attribute("data-watch-state", "paused")
    expect(box.locator('[data-watch="step"]')).to_be_enabled()
    seq = settled(upage, base)
    box.locator('[data-watch="step"]').click()
    expect(field(upage)).to_have_attribute("data-drawn-seq", str(seq + 1))
    box.locator('[data-watch="play"]').click()
    expect(box).to_have_attribute("data-watch-state", "done", timeout=GAME_MS)
    expect(upage.locator('[data-testid="watch-progress"]')).to_have_text(f"{TOTAL_ROWS} / {TOTAL_ROWS}")
    expect(box.locator('[data-watch="back"]')).to_be_visible()
    expect(box.locator('[data-watch="again"]')).to_be_visible()
    expect(box.locator('[data-watch="stop"]')).to_be_hidden()
    wait_idle(upage, TOTAL_ROWS, timeout=LONG_MS)
    sent = len(posts)
    box.locator('[data-watch="again"]').click()
    expect(box).to_have_attribute("data-watch-state", "playing")
    assert [p["path"] for p in posts[sent:sent + 2]] == ["/api/watch/stop", "/api/watch/start"]
    assert posts[sent]["body"] == {"restore": True}
    assert dialogs.count(CONFIRM_WATCH) == 2
    box.locator('[data-watch="pause"]').click()
    expect(box).to_have_attribute("data-watch-state", "paused")
    box.locator('[data-watch="stop"]').click()
    expect(box).to_have_attribute("data-watch-state", re.compile(r"^(idle|stopped)$"))


# ---------------------------------------------------------------- connection, boot, toasts (G11, #116 to #121)
def test_g11_the_banner_goes_retrying_then_offline_and_back(upage, server):
    """3.9: one failure is "Reconnecting…", three are offline with a countdown and Retry now; the last good state
    stays on screen; the next success clears it."""
    fresh(upage, server["base"])
    app, banner = upage.locator("#app"), upage.locator('[data-testid="conn"]')
    expect(upage.locator("#gameLabel")).not_to_have_text("")
    expect(banner).to_be_hidden()
    upage.route("**/api/version", lambda route: route.abort())
    expect(app).to_have_attribute("data-conn", "retrying")
    expect(banner).to_be_visible()
    expect(banner).to_have_attribute("data-conn", "retrying")
    expect(banner).to_contain_text("Reconnecting…")
    expect(app).to_have_attribute("data-conn", "offline", timeout=15_000)
    expect(banner).to_contain_text(re.compile(r"Can't reach the app server\. Retrying (in \d+ s|now)\."))
    retry = upage.locator('[data-testid="conn-retry"]')
    expect(retry).to_be_visible()
    expect(upage.locator("#gameLabel")).not_to_have_text("")
    upage.unroute("**/api/version")
    retry.click()
    expect(app).to_have_attribute("data-conn", "online")
    expect(banner).to_be_hidden()


def test_120_the_boot_screen_retries_until_the_state_loads(upage, server):
    """#120: a failed first /api/state says so, counts down, and Retry now loads the game once the server answers."""
    base = server["base"]
    reset_game(base)
    upage.route("**/api/state", lambda route: route.abort())
    load(upage, base, ready=False)
    boot = upage.locator('[data-testid="boot"]')
    expect(boot).to_have_attribute("data-phase", "failed", timeout=15_000)
    expect(boot).to_be_visible()
    expect(boot).to_contain_text("Can't reach the app server")
    expect(boot).to_contain_text(re.compile(r"Retrying (in \d+ s|now)\."))
    upage.unroute("**/api/state")
    upage.locator('[data-testid="boot-retry"]').click()
    wait_ready(upage)
    expect(boot).to_be_hidden()
    expect(upage.locator("#gameLabel")).not_to_have_text("")


def test_119_an_old_server_gets_the_restart_screen(upage, server):
    """#119: a state without `keys` shows "Restart the server to finish the update" and the command to type."""
    base = server["base"]
    reset_game(base)
    upage.route("**/api/state", lambda r: patched_json(r, lambda b: {k: v for k, v in b.items() if k != "keys"}))
    load(upage, base, ready=False)
    boot = upage.locator('[data-testid="boot"]')
    expect(boot).to_have_attribute("data-phase", "restart", timeout=15_000)
    expect(boot).to_contain_text("Restart the server to finish the update")
    expect(boot.locator("strong")).to_have_text("bash start.sh")


def test_117_118_121_toasts(upage, server):
    """#118: one polite toast; a new one replaces it. #121: a POST that gets no answer is a red toast. #117: a 400 shows
    its error in red for about 2.6 s and the page keeps the state it returned."""
    base = server["base"]
    fresh(upage, base)
    toast = upage.locator("#toast")
    expect(toast).to_have_attribute("role", "status")
    expect(toast).to_have_attribute("aria-live", "polite")
    upage.locator("#undoBtn").click()
    expect_toast(upage, re.compile(r"^(Undid the last action\.|Nothing to undo\.)$"))
    upage.route("**/api/undo", lambda route: route.abort())
    upage.locator("#undoBtn").click()
    expect_toast(upage, "Can't reach the app server. Nothing was saved.", error=True)
    upage.unroute("**/api/undo")
    refused = {**state(base), "error": "Refused for the test."}
    upage.route("**/api/undo", lambda route: route.fulfill(status=400, json=refused))
    upage.locator("#undoBtn").click()
    expect_toast(upage, "Refused for the test.", error=True)
    expect(toast).not_to_have_class(re.compile(r"(^|\s)show(\s|$)"), timeout=4_000)
    expect(toast).to_have_text("Refused for the test.")       # the words stay in the DOM once it hides (FI 4.5)


# ---------------------------------------------------------------- masthead, field host, review banner
def test_masthead_labels_and_keys(upage, server):
    """#1 (masthead part), Export CSV, and the view keys: V cycles the camera, B the booth, G the scorecard."""
    base = server["base"]
    fresh(upage, base)
    expect(upage.locator("h1")).to_have_text("Shadow Play-Caller")
    expect(upage.locator("#gameLabel")).to_have_text(state(base)["game"]["label"])
    expect(upage.locator("#whoLabel")).to_have_text("Modelling Brian Schottenheimer (DAL offense)")
    expect(upage.locator('a[href="/api/export.csv"]')).to_have_text("Export CSV")
    cam = upage.locator('[data-testid="camera-mode"]')
    expect(cam).to_have_attribute("data-camera", ANY)
    first = cam.get_attribute("data-camera")
    blur(upage)
    upage.keyboard.press("V")
    scene = field(upage).get_attribute("data-scene")
    if scene == "2d":
        expect(cam).to_have_attribute("data-camera", first)          # the 2D field has one camera, "Top"
    else:
        expect(cam).not_to_have_attribute("data-camera", first)
    if scene:                                                        # an engine reports the camera it shows
        expect(field(upage)).to_have_attribute("data-camera", cam.get_attribute("data-camera"))
    booth, card = upage.locator('[data-testid="booth-toggle"]'), upage.locator('[data-testid="scorecard-toggle"]')
    upage.keyboard.press("B")
    expect(booth).to_have_attribute("aria-expanded", "true")
    expect(upage.locator("#app")).to_have_attribute("data-booth-open", "true")
    booth.click()
    expect(booth).to_have_attribute("aria-expanded", "false")
    blur(upage)
    upage.keyboard.press("G")
    expect(card).to_have_attribute("aria-expanded", "true")
    expect(upage.locator("#app")).to_have_attribute("data-scorecard-open", "true")
    upage.keyboard.press("Escape")
    expect(card).to_have_attribute("aria-expanded", "false")


def test_field_host_hooks_and_legend(upage, server):
    """5.3: #field is an image with the legend; a drive at DAL 25 reports LOS 75 and LTG 65 and the store's drawn
    seq, queue and epoch; off the field the lines go away."""
    base = server["base"]
    reset_game(base)
    command(base, "new D25")
    load(upage, base)
    f = field(upage)
    expect(f).to_have_attribute("role", "img")
    expect(f.locator('[data-testid="field-legend"]')).to_have_text("Ball shown mid-field; ESPN gives no hash.")
    expect(f).to_have_attribute("data-drive-active", "true")
    expect(f).to_have_attribute("data-los", "75")
    expect(f).to_have_attribute("data-ltg", "65")
    expect(f).to_have_attribute("data-poss", "DAL")
    expect(f).to_have_attribute("data-ball-x", "25")
    expect(f).to_have_attribute("aria-label", "Ball on DAL 25. 1st & 10. Line to gain DAL 35.")
    wait_idle(upage)
    expect(f).to_have_attribute("data-queue", "0")
    expect(f).to_have_attribute("data-epoch", version(base)["epoch"])
    expect(f).not_to_have_attribute("data-review-seq", ANY)
    command(base, "punt")
    expect(f).to_have_attribute("data-drive-active", "false")
    expect(f).not_to_have_attribute("data-los", ANY)
    expect(f).to_have_attribute("aria-label", "DAL off the field.")


def test_review_banner_steps_through_past_plays(upage, server):
    """Left reviews the newest drawn play; the banner's keys step earlier and later; Escape returns to live."""
    base = server["base"]
    finished(upage, base)
    wait_idle(upage, TOTAL_ROWS, timeout=LONG_MS)
    seqs = [r["seq"] for r in full_timeline(base)["rows"] if r["kind"] != "admin"]
    banner = upage.locator('[data-testid="review"]')
    expect(banner).to_be_hidden()
    blur(upage)
    upage.keyboard.press("ArrowLeft")
    expect(banner).to_be_visible()
    expect(banner).to_have_attribute("data-seq", str(seqs[-1]))
    expect(field(upage)).to_have_attribute("data-review-seq", str(seqs[-1]))
    expect(banner).to_contain_text(re.compile(r"Reviewing .+Esc returns to live\."))
    banner.locator('[data-review="earlier"]').click()
    expect(banner).to_have_attribute("data-seq", str(seqs[-2]))
    banner.locator('[data-review="later"]').click()
    expect(banner).to_have_attribute("data-seq", str(seqs[-1]))
    blur(upage)
    upage.keyboard.press("Escape")
    expect(banner).to_be_hidden()
    expect(field(upage)).not_to_have_attribute("data-review-seq", ANY)


def test_chrome_fits_a_phone(ui_pages, server):
    """#8 for the chrome: at 390 px nothing pushes the page sideways, and every chrome region stays on screen."""
    page = ui_pages(390, 844)
    fresh(page, server["base"])
    expect(page.locator("#gameLabel")).not_to_have_text("")
    assert page.evaluate("() => document.documentElement.scrollWidth") <= 390
    for sel in ("#rg-masthead", "#rg-feed", '[data-testid="watch"]', "#field"):
        box = page.locator(sel).first.bounding_box()
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= 390 + 0.5, (sel, box)

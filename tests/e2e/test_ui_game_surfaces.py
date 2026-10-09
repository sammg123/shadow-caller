"""A8 game surfaces in the browser (ui-architecture 5.4, FI 3.7 to 3.9, checklist #110 to #115), neutral world.

Scoreboard, play feed, drive chart, win probability, box score, scorecard, tendencies and play log, on the sandboxed
server (saved TB at DAL game, offline). Every test sets its own state first (FI 6.1) and never relies on test order;
the finished game is replayed only when the server isn't already showing it untouched, because a replay holds the
engine lock for tens of seconds on a busy machine. Model-dependent numbers are checked against GET /api/state, never
hard-coded (FI 6.1). ?scene=2d keeps these tests off the WebGL engine: they are about the HUD panels.
"""
import json
import math
import re
import urllib.request

import pytest
from e2e_helpers import EVENT, get, post
from playwright.sync_api import Page

pytestmark = pytest.mark.e2e

QUERY = "/?world=neutral&scene=2d"
ROW = '[data-testid="play-row"]'
DRIVE = '[data-testid="drive"]'
A8_REGIONS = ("scoreboard", "plays", "drives", "wp", "score", "box", "tendencies", "log")
A8_LABELS = ("Scoreboard", "Play feed", "Drive chart", "Win probability", "Scorecard", "Box score", "Tendencies",
             "Play log")                # shell/bindings.js labels: a notice naming one means that panel failed
REPLAY_TIMEOUT_S = 240                 # DC E6: a replay holds the lock; far longer when the machine is busy
WAIT_MS = 60_000
G17_RESULTS = ["TD", "TD", "PUNT", "PUNT", "PUNT", "PUNT", "PUNT", "PUNT", "FG", "END OF HALF", "TD", "INT", "TD",
               "FUMBLE", "FG", "DOWNS", "DOWNS", "TD", "PUNT", "INT", "END OF GAME"]
# The HUD shows a state once the caller's profile is presented (#profTitle leaves its generic title).
PRESENTED = ("(() => { const t = document.querySelector('#profTitle')?.textContent ?? '';"
             " return t.endsWith(\"'s tendencies\") && t !== 'His tendencies'; })()")


def pct(x: float) -> str:
    """model/format.js pct: Math.round, so halves round up (Python's round() would round them to even)."""
    return f"{math.floor(x * 100 + 0.5)}%"


def slow_post(base: str, path: str, body: dict) -> dict:
    """POST with room for a replay on a loaded machine (the shared helper gives up after 30 s)."""
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=REPLAY_TIMEOUT_S) as r:
        return json.loads(r.read().decode())


def is_untouched_final(st: dict) -> bool:
    """The replayed TB at DAL game exactly as a replay leaves it (FI 6.1 Finished game, #107)."""
    sit, log = st.get("sit") or {}, st.get("log") or []
    return (len(log) == 59 and not st.get("drive_active") and not (st.get("feed") or {}).get("on")
            and (sit.get("score_off"), sit.get("score_opp")) == (16, 24) and not any(r.get("retagged") for r in log)
            and ((st.get("watch") or {}).get("state") in (None, "idle", "stopped")))


def finished(page: Page, server: dict) -> dict:
    """FI 6.1 Finished game (replayed unless the server already shows it untouched), then the page, every panel full."""
    base = server["base"]
    if not is_untouched_final(get(base + "/api/state")):
        post(base, "/api/feed", {"on": False})
        slow_post(base, "/api/feed/replay", {"event_id": EVENT})
    page.goto(base + QUERY)
    page.wait_for_function(f"document.querySelectorAll('{ROW}').length === 183", timeout=WAIT_MS)
    page.wait_for_function("document.querySelectorAll('#logArea tbody tr').length === 59", timeout=WAIT_MS)
    return get(base + "/api/state")


def fresh(page: Page, server: dict, *commands: str) -> dict:
    """FI 6.1 Fresh game, then shorthand lines, then the page once the state is presented."""
    base = server["base"]
    post(base, "/api/feed", {"on": False})
    slow_post(base, "/api/reset", {})
    for text in commands:
        post(base, "/api/command", {"text": text})
    page.goto(base + QUERY)
    page.wait_for_function(PRESENTED, timeout=WAIT_MS)
    return get(base + "/api/state")


def texts(page: Page, selector: str) -> list[str]:
    return [t.strip() for t in page.locator(selector).all_text_contents()]


# ---------------------------------------------------------------- scorecard (FI 3.7)
def test_fresh_scorecard_log_and_tendencies_say_so(page, server):
    """#6 for the three A8 panels."""
    fresh(page, server)
    assert page.locator("#kpiArea .sc-card-empty").inner_text() == "Scores appear after the first logged snap."
    assert page.locator("#kpiArea .sc-card-group").count() == 0
    assert page.locator("#logArea .sc-log-empty").inner_text() == (
        "No snaps yet. Each logged play shows his top pick next to what he called.")
    assert page.locator("#profTitle").inner_text() == "Schottenheimer's tendencies"


def test_groups_appear_only_with_snaps(page, server):
    """#110: a pass with no type (shorthand I) scores pass vs run only."""
    st = fresh(page, server, "new D25", "I")
    assert st["metrics"]["n"] == 1 and st["metrics"]["granular"]["leaf_n"] == 0
    page.wait_for_selector("#kpiArea .sc-card-group")
    assert [g.get_attribute("data-group") for g in page.locator("#kpiArea .sc-card-group").all()] == ["passrun"]
    assert texts(page, "#kpiArea .sc-card-group .sc-card-sub") == ["Pass vs run (1 snaps)"]


def test_scorecard_matches_the_api_and_tones_log_loss(page, server):
    """#110, #111, #107: every group, every value from /api/state, log loss better or worse than the league."""
    st = finished(page, server)
    m, g = st["metrics"], st["metrics"]["granular"]
    assert texts(page, "#kpiArea .sc-card-group > .sc-card-sub") == [
        f"Specific play ({g['leaf_n']} snaps)", f"Play type ({g['fam_n']} snaps)", f"Pass vs run ({m['n']} snaps)"]
    passrun = texts(page, '#kpiArea [data-group="passrun"] .sc-kpi-value')
    assert passrun == [f"{m['logloss_model']:.3f}", pct(m["acc_model"]), f"{m['tilt_hits']} of {m['tilt_n']}",
                       pct(m["dropback_rate"])]
    leaf = texts(page, '#kpiArea [data-group="leaf"] .sc-kpi-value')
    assert leaf[:2] == [f"{g['leaf_top1']} of {g['leaf_n']}", f"{g['leaf_top3']} of {g['leaf_n']}"]
    toned = [(v.inner_text(), v.get_attribute("data-tone"), v.get_attribute("class"))
             for v in page.locator("#kpiArea .sc-kpi-value[data-tone]").all()]
    expect = [(g["leaf_logloss"], g["leaf_logloss_league"], 2), (g["fam_logloss"], g["fam_logloss_league"], 2),
              (m["logloss_model"], m["logloss_league"], 3)]
    assert [(t[0], t[1]) for t in toned] == [(f"{a:.{dp}f}", "better" if a < b else "worse") for a, b, dp in expect]
    assert all(tone in cls.split() for _, tone, cls in toned)
    assert page.locator("#kpiArea .sc-card-note").inner_text() == (
        "Lower log loss is better. One game is a pipeline test, not proof.")


def test_shadow_v_league_shows_only_computed_pairs(page, server):
    """No league top-pick or tilt count is ever shown; each pair lights the side that leads."""
    st = finished(page, server)
    m, g = st["metrics"], st["metrics"]["granular"]
    pairs = page.locator("#kpiArea .sc-card-pair")
    assert [p.get_attribute("data-pair") for p in pairs.all()] == [
        "called_right", "top3", "passrun_logloss", "family_logloss", "leaf_logloss"]
    called = page.locator('#kpiArea [data-pair="called_right"]')
    assert called.locator('[data-side="shadow"] .sc-card-full').inner_text() == pct(m["acc_model"])
    assert called.locator('[data-side="league"] .sc-card-full').inner_text() == pct(m["acc_league"])
    leader = "shadow" if m["acc_model"] > m["acc_league"] else "league" if m["acc_model"] < m["acc_league"] else "even"
    assert called.get_attribute("data-leader") == leader
    top3 = page.locator('#kpiArea [data-pair="top3"]')
    assert top3.locator('[data-side="league"] .sc-card-full').inner_text() == str(g["leaf_top3_league"])


# ---------------------------------------------------------------- play log (FI 3.9)
def test_log_columns_order_and_cells(page, server):
    """#112: the FI columns in order, every row, newest first; G15 and G16; #108."""
    st = finished(page, server)
    assert texts(page, "#logArea thead th") == [
        "#", "Time", "Situation", "His top pick", "Actual", "His % on it", "League %", "Rank", "Yds"]
    rows = page.locator("#logArea tbody tr")
    assert rows.count() == len(st["log"]) == 59
    newest = st["log"][0]
    assert rows.nth(0).get_attribute("data-seq") == str(newest["seq"])
    assert rows.nth(0).locator("td").nth(0).inner_text() == str(newest["snap"])
    flagged = page.locator('#logArea tbody tr[data-nullified="true"]')
    assert flagged.count() == 4
    for i in range(4):
        cells = [c.strip() for c in flagged.nth(i).locator("td").all_text_contents()]
        assert cells[0] == "" and cells[8] == "flag" and "(no play:" in cells[4]
    assert "1st & Goal at TB 8" in texts(page, "#logArea tbody td:nth-child(3)")


def test_log_rank_tones(page, server):
    """#113: rank 1 good, 2 and 3 plain, 4 and up bad."""
    st = finished(page, server)
    ranks = [r.get("leaf_rank") for r in st["log"]]
    assert page.locator("#logArea .sc-log-rank.ok").count() == sum(1 for r in ranks if r == 1)
    assert page.locator("#logArea .sc-log-rank.no").count() == sum(1 for r in ranks if r is not None and r >= 4)
    assert page.locator('#logArea .sc-log-rank[data-tone="good"]').count() == sum(1 for r in ranks if r == 1)
    plain = page.locator("#logArea .sc-log-rank:not(.ok):not(.no)")
    assert set(plain.all_text_contents()) <= {"2", "3", "—"}


# ---------------------------------------------------------------- tendencies (FI 3.8)
def test_tendencies_plot_and_note(page, server):
    """#114: 9 rows, filled exactly when the 90% interval excludes zero, in the G14 order."""
    st = finished(page, server)
    coefs = {k: v for k, v in st["profile"]["coefs"].items() if k != "intercept"}
    rows = page.locator("#profArea [data-term]")
    assert rows.count() == 9
    keys = [r.get_attribute("data-term") for r in rows.all()]
    assert keys == ["early_down", "third_long", "trailing9", "red_zone", "dq", "last", "last_fail",
                    "explosive_prev", "sack_prev"]
    sure = {r.get_attribute("data-term") for r in page.locator('#profArea [data-sure="true"]').all()}
    assert sure == {k for k, v in coefs.items() if v["lo"] > 0 or v["hi"] < 0}
    assert page.locator("#profArea .sc-tend-note").inner_text() == (
        "1,351 snaps, 21 games (2025–2026). Filled dots: 90% interval excludes zero.")


def test_play_type_mix_and_held_out(page, server):
    """#115: five families with his % and exp. X%, then the held-out sentence from cv.specific_play."""
    st = finished(page, server)
    gran = st["profile"]["granular"]
    rows = page.locator("#profArea .sc-tend-mix tr")
    assert rows.count() == 5
    got = {r.get_attribute("data-family"): [c.strip() for c in r.locator("td").all_text_contents()] for r in rows.all()}
    assert got == {k: [pct(v["his"]), f"exp. {pct(v['league_expected'])}"] for k, v in gran["family_rates"].items()}
    sp = gran["cv"]["specific_play"]
    assert page.locator("#profArea .sc-tend-heldout").inner_text() == (
        f"Held-out check: his top pick for the specific play was right {pct(sp['top1_his'])} of the time; the actual "
        f"play was in his top 3 {pct(sp['top3_his'])} of the time ({sp['n']:,} snaps).")


# ---------------------------------------------------------------- the timeline panels (DC C1 to C5, G1, G16, G17)
def test_timeline_panels_after_a_replay(page, server):
    """183 plays (64 by the caller), 21 drives with ESPN's results, DAL at 0% at the end, 16 to 24, and the box."""
    finished(page, server)
    assert page.locator(f'{ROW}[data-caller="true"]').count() == 64
    assert page.locator(ROW).first.get_attribute("data-seq") == "183"
    verdicts = [page.locator(f'{ROW}[data-verdict="{v}"]').count() for v in ("top1", "top3", "miss")]
    assert sum(verdicts) == 59
    assert [d.get_attribute("data-result") for d in page.locator(DRIVE).all()] == G17_RESULTS
    wp = page.locator('[data-testid="wp-chart"]')
    assert (wp.get_attribute("data-available"), wp.get_attribute("data-wp-caller")) == ("true", "0")
    assert wp.get_attribute("aria-label") == "DAL win probability 0%"
    scores = {s.get_attribute("data-team"): s.inner_text() for s in page.locator('[data-testid="team-score"]').all()}
    assert scores == {"DAL": "16", "TB": "24"}
    assert page.locator('[data-testid="scoreboard"]').get_attribute("data-state") == "post"
    assert page.locator('[data-testid="team-logo"]').count() == 2
    box = page.locator('[data-testid="box-score"]')
    yards = box.locator("tr", has=page.locator("th", has_text=re.compile(r"^Total yards$")))
    heads = [h.get_attribute("data-team") for h in box.locator("th[data-team]").all()]
    assert dict(zip(heads, [c.strip() for c in yards.locator("td").all_text_contents()])) == {"TB": "419", "DAL": "366"}
    for region in A8_REGIONS:
        assert page.locator(f'[data-testid="region-notice"][data-region="{region}"]').count() == 0, region
    tray = page.locator('[data-testid="notices"]').inner_text()
    assert not [label for label in A8_LABELS if label in tray], tray


def test_a_play_row_shows_its_play_on_the_field(page, server):
    """Click a play, a drive or a logged snap: the field reviews it, the row is pressed; again returns to live."""
    finished(page, server)
    row = page.locator(f'{ROW}[data-seq="104"]')
    row.scroll_into_view_if_needed()
    row.locator("button").click()
    page.wait_for_selector('#field[data-review-seq="104"]')
    assert row.locator("button").get_attribute("aria-pressed") == "true"
    assert page.locator(f'{DRIVE}[data-idx="12"] button').get_attribute("aria-pressed") == "true"
    assert page.locator('#logArea tr[data-tl-seq="104"] button').get_attribute("aria-pressed") == "true"
    row.locator("button").click()
    page.wait_for_function("!document.querySelector('#field').hasAttribute('data-review-seq')")
    page.locator(f'{DRIVE}[data-idx="2"] button').click()
    page.wait_for_selector('#field[data-review-seq="14"]')
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('#field').hasAttribute('data-review-seq')")
    assert page.locator(f'{ROW}[aria-pressed="true"], {ROW} [aria-pressed="true"]').count() == 0


def test_enter_on_a_focused_play_row_reviews_it(page, server):
    """G18: rows are buttons, so the keyboard reaches them and Enter activates them natively."""
    finished(page, server)
    btn = page.locator(f'{ROW}[data-seq="2"] button')
    btn.scroll_into_view_if_needed()
    btn.focus()
    page.keyboard.press("Enter")
    page.wait_for_selector('#field[data-review-seq="2"]')
    assert btn.get_attribute("aria-pressed") == "true"
    assert page.evaluate("document.activeElement.closest('[data-testid=\"play-row\"]')?.dataset.seq") == "2"


def test_game_panels_fit_a_phone(browser, server):
    """#8 for the A8 panels: at 390 px the page never scrolls sideways; the log table scrolls inside its region."""
    if not is_untouched_final(get(server["base"] + "/api/state")):
        post(server["base"], "/api/feed", {"on": False})
        slow_post(server["base"], "/api/feed/replay", {"event_id": EVENT})
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    try:
        page.goto(server["base"] + QUERY)
        page.wait_for_function(f"document.querySelectorAll('{ROW}').length === 183", timeout=WAIT_MS)
        assert page.evaluate("document.documentElement.scrollWidth") == 390
        for region in ("#rg-scoreboard", "#rg-plays", "#rg-drives", "#rg-wp", "#rg-score", "#rg-box", "#rg-tendencies",
                       "#rg-log"):
            box = page.locator(region).bounding_box()
            assert box["x"] >= 0 and box["x"] + box["width"] <= 390 + 0.5, region
    finally:
        ctx.close()

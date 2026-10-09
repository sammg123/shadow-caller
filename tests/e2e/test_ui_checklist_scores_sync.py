"""FI 6.3 checklist #110 to #121 and #123: scorecard, tendencies, play log (FI 3.7 to 3.9), sync and errors (FI 4;
G11, G12, G27). Model numbers come from /api/state."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (COL, LOG_COLUMNS, LOG_ROWS, actual_text, api_post, command, expect_log_rows, expect_toast,
                        finished, fixed, fresh, int_text, load, log_header, log_table, pct, reset_game, state,
                        toast_log, toasts_shown, version, wait_ready, with_drive)

pytestmark = pytest.mark.e2e

SHOW_RE = re.compile(r"(^|\s)show(\s|$)")
NETWORK_TOAST = "Can't reach the app server. Nothing was saved."


def kpi(page):
    return page.locator("#kpiArea")


def test_110_groups_appear_only_with_their_snaps(upage, server):
    """#110: "Specific play" and "Play type" only when leaf_n and fam_n are above 0; "Pass vs run" once a snap logs."""
    base = server["base"]
    reset_game(base)
    command(base, "new D25 | I")                     # a pass with no type: leaf_n 0, fam_n 0
    g = state(base)["metrics"]["granular"]
    assert (g["leaf_n"], g["fam_n"]) == (0, 0)
    load(upage, base)
    expect(kpi(upage)).to_contain_text("Pass vs run (1 snaps)")
    expect(kpi(upage)).not_to_contain_text("Specific play")
    expect(kpi(upage)).not_to_contain_text("Play type")
    command(base, "new D25 | K 3")
    expect(kpi(upage)).to_contain_text("Specific play (1 snaps)")
    expect(kpi(upage)).to_contain_text("Play type (1 snaps)")
    expect(kpi(upage)).to_contain_text("Pass vs run (2 snaps)")


def test_111_log_loss_values_styled_better_or_worse(upage, server):
    """#111: each log-loss value is styled better when below the league's and worse otherwise (.better/.worse,
    data-tone)."""
    base = server["base"]
    finished(upage, base)
    m = state(base)["metrics"]
    g = m["granular"]
    pairs = [(fixed(g["leaf_logloss"], 2), g["leaf_logloss"], g["leaf_logloss_league"]),
             (fixed(g["fam_logloss"], 2), g["fam_logloss"], g["fam_logloss_league"]),
             (fixed(m["logloss_model"], 3), m["logloss_model"], m["logloss_league"])]
    better = [text for text, model, league in pairs if model < league]
    worse = [text for text, model, league in pairs if model >= league]
    expect(kpi(upage).locator(".better")).to_have_count(len(better))
    expect(kpi(upage).locator(".worse")).to_have_count(len(worse))
    expect(kpi(upage).locator('.better[data-tone="better"]')).to_have_count(len(better))
    expect(kpi(upage).locator('.worse[data-tone="worse"]')).to_have_count(len(worse))
    for text in better:
        expect(kpi(upage).locator(".better").filter(has_text=text)).to_have_count(1)
    for text in worse:
        expect(kpi(upage).locator(".worse").filter(has_text=text)).to_have_count(1)


def test_112_log_columns_and_newest_first(upage, server):
    """#112: columns #, Time, Situation, His top pick, Actual, His % on it, League %, Rank, Yds; newest row first."""
    base = server["base"]
    finished(upage, base)
    log = state(base)["log"]
    expect_log_rows(upage, LOG_ROWS)
    assert log_header(upage) == LOG_COLUMNS
    rows = log_table(upage)
    for row, src in ((rows[0], log[0]), (rows[-1], log[-1])):
        assert row[COL["Time"]] == f"Q{src['qtr']} {src['clock']}"
        assert row[COL["Actual"]] == actual_text(src)
    assert log[0]["seq"] > log[-1]["seq"]


RANK_CELLS = """rows => rows.map(r => {
  const c = r.querySelectorAll('th, td')[7];
  const has = (cls) => c.classList.contains(cls) || !!c.querySelector('.' + cls);
  const tone = c.getAttribute('data-tone') || (c.querySelector('[data-tone]') || {getAttribute: () => ''}).getAttribute('data-tone') || '';
  return [c.innerText.trim(), has('ok'), has('no'), tone];
})"""


def test_113_rank_styles_and_dashes(upage, server):
    """#113: rank 1 good, 2 and 3 neutral, 4 and up bad; a missing rank shows a dash."""
    base = server["base"]
    finished(upage, base)
    log = state(base)["log"]
    expect_log_rows(upage, LOG_ROWS)
    cells = upage.locator("#logArea tbody tr").evaluate_all(RANK_CELLS)
    assert len(cells) == len(log)
    for (text, ok, no, tone), src in zip(cells, log):
        rank = src.get("leaf_rank")
        if rank is None:
            assert (text, ok, no) == ("—", False, False), (src["seq"], text, ok, no)
        elif rank == 1:
            assert (text, ok, no, tone) == ("1", True, False, "good"), (src["seq"], text, ok, no, tone)
        elif rank <= 3:
            assert (text, ok, no) == (str(rank), False, False), (src["seq"], text, ok, no)
        else:
            assert (text, ok, no, tone) == (str(rank), False, True, "bad"), (src["seq"], text, ok, no, tone)


def test_114_tendency_plot_rows_and_note(upage, server):
    """#114: 9 rows, filled exactly where lo > 0 or hi < 0, and "1,351 snaps, 21 games (2025–2026). Filled dots: 90%
    interval excludes zero." Rows are found by the A11 v1.2 hook [data-term][data-sure] (ui-architecture section 5)."""
    base = server["base"]
    fresh(upage, base)
    profile = state(base)["profile"]
    coefs = {k: v for k, v in profile["coefs"].items() if k != "intercept"}
    area = upage.locator("#profArea")
    expect(area.locator('[aria-label="His pass-run tendency terms with 90 percent intervals"]')).to_have_count(1)
    rows = area.locator("[data-term]")
    expect(rows).to_have_count(9)
    got = dict(rows.evaluate_all("els => els.map(e => [e.dataset.term, e.dataset.sure])"))
    assert got == {k: "true" if (v["lo"] > 0 or v["hi"] < 0) else "false" for k, v in coefs.items()}
    for v in coefs.values():
        expect(area).to_contain_text(v["label"])
    note = (f"{int_text(profile['n_snaps'])} snaps, {profile['n_games']} games "
            f"({'–'.join(str(s) for s in profile['seasons'])}). Filled dots: 90% interval excludes zero.")
    assert note == "1,351 snaps, 21 games (2025–2026). Filled dots: 90% interval excludes zero."
    expect(area).to_contain_text(note)


def test_115_play_type_mix_then_held_out_check(upage, server):
    """#115: all five families with his % and "exp. X%", followed by the held-out sentence (38%, 66%, 1,270 today)."""
    base = server["base"]
    fresh(upage, base)
    s = state(base)
    granular = s["profile"]["granular"]
    sp = granular["cv"]["specific_play"]
    held_out = (f"Held-out check: his top pick for the specific play was right {pct(sp['top1_his'])} of the time; the "
                f"actual play was in his top 3 {pct(sp['top3_his'])} of the time ({int_text(sp['n'])} snaps).")
    area = upage.locator("#profArea")
    expect(area).to_contain_text(held_out)
    text = area.evaluate("e => e.textContent")
    for key, rate in granular["family_rates"].items():
        name = s["family_names"][key]
        assert re.search(re.escape(name) + r"\s*" + re.escape(pct(rate["his"])) + r"\s*"
                         + re.escape(f"exp. {pct(rate['league_expected'])}"), text), (name, rate)
        assert text.index(name) < text.index(held_out)
    assert len(granular["family_rates"]) == 5


def test_116_outside_changes_show_without_reload_or_toast(upage, server):
    """#116: a change posted from outside the page shows up within 2.5 s, without a reload and without a toast."""
    base = server["base"]
    fresh(upage, base)
    expect(upage.locator("#iQtr")).to_have_value("1")
    marker = upage.evaluate("() => (window.__a11Marker = Math.random())")
    api_post(base, "/api/situation", {"qtr": "3"})
    expect(upage.locator("#iQtr")).to_have_value("3", timeout=2500)
    assert upage.evaluate("() => window.__a11Marker") == marker          # same document: no reload
    assert toasts_shown(upage) == []


def test_g12_background_messages_go_to_the_polite_region(upage, server):
    """ui-architecture 4.6 G12: a poll's new message shows in [data-testid="bg-message"] (role=status, polite), never
    as a toast."""
    base = server["base"]
    fresh(upage, base)
    region = upage.locator('[data-testid="bg-message"]')
    expect(region).to_have_attribute("role", "status")
    expect(region).to_have_attribute("aria-live", "polite")
    command(base, "new D25")
    expect(region).to_have_text("Done: new drive at D25")
    assert toasts_shown(upage) == []


def test_117_a_400_shows_its_error_for_2_6_s_and_the_returned_state(upage, server):
    """#117: a 400 shows its error in a red toast for about 2.6 s and the page shows the state the 400 returned (here
    a change only that body carries: /api/version is frozen, so no poll can bring it)."""
    base = server["base"]
    with_drive(upage, base)
    expect(upage.locator("#iQtr")).to_have_value("1")
    frozen = version(base)
    upage.route("**/api/version", lambda route: route.fulfill(json=frozen))
    upage.wait_for_timeout(1200)                       # the next poll already sees the frozen version
    api_post(base, "/api/situation", {"qtr": "3"})     # another client: only the 400's body can tell the page
    upage.locator("#iDown").fill("7")
    upage.locator("#iDown").press("Enter")
    expect_toast(upage, "Down must be 1 to 4", error=True)
    expect(upage.locator("#iQtr")).to_have_value("3")        # only the 400's body can bring it (version frozen)
    expect(upage.locator("#toast")).not_to_have_class(SHOW_RE)
    log = toast_log(upage)[1]
    shown = next(e for e in log if e["kind"] == "show" and e["text"] == "Down must be 1 to 4")
    hidden = next(e for e in log if e["kind"] == "hide" and e["at"] > shown["at"])
    lasted = hidden["at"] - shown["at"]
    assert 2300 <= lasted <= 3100, f"the toast showed for {lasted:.0f} ms (2600 ms expected)"


def test_118_toast_is_a_polite_live_region_and_replaces(upage, server):
    """#118: the toast is a polite live region, and a new toast replaces the previous one."""
    fresh(upage, server["base"])
    toast = upage.locator("#toast")
    expect(toast).to_have_attribute("role", "status")
    expect(toast).to_have_attribute("aria-live", "polite")
    upage.keyboard.press("x")
    expect_toast(upage, "No Dallas drive in progress. Type the ball spot first.", error=True)
    upage.locator("#cmd").fill("KK 3")
    upage.locator("#cmd").press("Enter")
    expect_toast(upage, "Didn't understand 'KK 3'", error=True)
    expect(upage.locator("#toast")).to_have_count(1)


def test_119_old_server_without_keys_shows_the_restart_screen(upage, server):
    """#119: if /api/state has no keys, the page shows "Restart the server to finish the update"."""
    base = server["base"]
    reset_game(base)

    def no_keys(route):
        response = route.fetch()
        body = response.json()
        body.pop("keys", None)
        route.fulfill(response=response, json=body)

    upage.route("**/api/state", no_keys)
    load(upage, base, ready=False)
    boot = upage.locator('[data-testid="boot"]')
    expect(boot).to_have_attribute("data-phase", "restart", timeout=15_000)
    expect(boot).to_be_visible()
    expect(boot).to_contain_text("Restart the server to finish the update")
    expect(boot).to_contain_text("bash start.sh")
    expect(upage.locator("#app")).to_have_attribute("data-boot", "restart")


def test_120_first_state_failure_says_so_and_retries(upage, server):
    """#120 [fix] (G11): if the first /api/state fails the page says so and retries until it loads."""
    base = server["base"]
    reset_game(base)
    calls = []

    def flaky(route):
        calls.append(1)
        if len(calls) <= 2:
            route.abort()
        else:
            route.continue_()

    upage.route("**/api/state", flaky)
    load(upage, base, ready=False)
    boot = upage.locator('[data-testid="boot"]')
    expect(boot).to_have_attribute("data-phase", "failed", timeout=15_000)
    expect(boot).to_contain_text("Can't reach the app server")
    expect(boot).to_contain_text(re.compile(r"Retrying (in \d+ s|now)\."))
    wait_ready(upage)
    expect(upage.locator("#gameLabel")).not_to_have_text("")
    expect(boot).to_be_hidden()
    assert len(calls) >= 3


def test_121_failed_actions_show_a_red_toast(upage, server):
    """#121 [fix] (G11): a failed action (network error, or a non-JSON 500) shows a red toast."""
    base = server["base"]
    with_drive(upage, base)
    upage.route("**/api/play", lambda route: route.abort())
    upage.keyboard.press("k")
    upage.keyboard.press("Enter")
    expect_toast(upage, NETWORK_TOAST, error=True)
    upage.unroute("**/api/play")
    upage.route("**/api/play", lambda route: route.fulfill(status=500, content_type="text/html",
                                                           body="<html><body>Internal Server Error</body></html>"))
    upage.keyboard.press("k")
    upage.keyboard.press("Enter")
    expect_toast(upage, re.compile(r"\S"), error=True)      # a second red toast, whatever the words
    assert state(base)["log"] == []


def test_123_server_text_is_never_html(upage, server):
    """#123 [fix] (G27): a play whose ESPN text holds <b>x</b> shows in the log as literal text (intercepted state,
    the sandbox's saved game has no such play)."""
    base = server["base"]
    reset_game(base)
    command(base, "new D25 | K 3")
    evil = "Inside run (A/B gap) (no play: <b>x</b> <img src=x onerror=\"window.__a11Pwned=1\">)"

    def inject(route):
        response = route.fetch()
        body = response.json()
        if body.get("log"):
            body["log"][0]["name"] = evil
        route.fulfill(response=response, json=body)

    upage.route("**/api/state", inject)
    load(upage, base)
    expect_log_rows(upage, 1)
    expect(upage.locator("#logArea")).to_contain_text("<b>x</b>")
    assert log_table(upage)[0][COL["Actual"]] == evil
    assert upage.locator("#logArea b, #logArea img").count() == 0
    assert upage.evaluate("() => window.__a11Pwned") is None

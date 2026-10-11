"""FI 6.3 checklist #29 to #37 and #122: the next call (FI 3.5; G18, G23), on the restructured board (restructure-v2.md
section 3). Every number comes from /api/state. The page opens a watch on load and takes no user input into the game,
so every state is a pre-snap of the saved TB at DAL game in Watch, paused with N plays applied (indices probed on that
game: the flags and arrows each check needs are asserted before the page is read)."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (BOOT_TIMEOUT_MS, app_url, capitalize, click_at, pct, pct1, record_requests, signed1,
                        stop_watch, wait_ready, watch_paused_at, why_habits)

pytestmark = pytest.mark.e2e

PLATE = "Schottenheimer's next call"                       # v1.5 (G4-2): the plate names the caller it shadows
# v1.5 (G4-6): the tilt tag's words for the server's flag (his pass rate here against the league's)
TAG_TEXT = {"no edge": "Like the league", "lean pass": "Leans pass", "lean run": "Leans run", "tilt pass": "Tilts pass",
            "tilt run": "Tilts run"}
FIRST_SNAP_IDX = 1          # the opening kickoff applied: his first snap is next (opening script, no edge)
LEAN_IDX = 3                # his third snap is next: lean pass
TILT_IDX = 81               # snap 24 is next: TILT RUN
LATE_IDX = 126              # snap 35 is next (Sam's capture): lean run, memory terms, both a ▲ and a ▼
TB_DRIVE_IDX = 20           # Dallas scored on its first drive; Tampa Bay has the ball
TOTAL_PLAYS = 183


@pytest.fixture
def wsrv(watch_server):
    yield watch_server
    stop_watch(watch_server["base"])


def load(page, base):
    page.goto(app_url(base), wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    wait_ready(page)


def at(page, base, idx):
    s = watch_paused_at(base, idx)
    load(page, base)
    return s


def tag_text(flag):
    return TAG_TEXT.get(flag.lower(), capitalize(flag))


def hero(page):
    return page.locator("#heroArea")


def test_29_most_likely_call_and_runners_up(upage, wsrv):
    """#29: the plate with top[0] and its pct, then top[1] and top[2] with theirs."""
    top = at(upage, wsrv["base"], LATE_IDX)["prediction"]["top"]
    h = hero(upage)
    expect(h).to_contain_text(re.compile(
        re.escape(PLATE) + r".*?" + re.escape(top[0]["name"]) + r"\s*" + re.escape(pct(top[0]["p"])), re.S))
    expect(h).to_contain_text(re.compile(
        r"Then.*?" + re.escape(top[1]["name"]) + r"\s*" + re.escape(pct(top[1]["p"])) + r".*?"
        + re.escape(top[2]["name"]) + r"\s*" + re.escape(pct(top[2]["p"])), re.S))
    for item in upage.locator("#heroArea .sc-then-item").all():
        expect(item).to_be_visible()                       # #2 and #3 both on screen, never clipped


def _pill_style(page):
    return page.locator("#heroArea .pill").evaluate(
        "e => { const c = getComputedStyle(e); return [c.backgroundColor, c.color, c.borderTopStyle, c.borderTopColor,"
        " c.borderTopWidth, c.fontWeight].join('|'); }")


def test_30_pill_text_and_distinct_styles(upage, wsrv):
    """#30: the tag says what prediction.flag measures (G4-6); TILT, lean and no edge look different."""
    base = wsrv["base"]
    styles = {}
    for idx in (FIRST_SNAP_IDX, LEAN_IDX, TILT_IDX):
        flag = at(upage, base, idx)["prediction"]["flag"]
        pill = upage.locator("#heroArea .pill")
        expect(pill).to_have_text(tag_text(flag))
        expect(pill).to_have_class(re.compile(rf"(^|\s){flag.replace(' ', '').lower()}(\s|$)"))
        expect(pill).to_have_attribute("data-flag", re.compile(r"\S"))
        styles[flag.split()[0].lower()] = _pill_style(upage)
    assert set(styles) == {"no", "lean", "tilt"}, f"the probed pre-snaps no longer give no edge, lean and TILT: {styles}"
    assert len(set(styles.values())) == 3, f"TILT, lean and No edge must look different: {styles}"


def test_31_pass_run_bar_labels(upage, wsrv):
    """#31: "Ball thrown or dropback {pct(p)}", "League {pct(p_league)} (dashed)", "Handed off or kept {pct(1-p)}"."""
    p = at(upage, wsrv["base"], LATE_IDX)["prediction"]
    for text in (f"Ball thrown or dropback {pct(p['p'])}", f"League {pct(p['p_league'])} (dashed)",
                 f"Handed off or kept {pct(1 - p['p'])}"):
        expect(hero(upage)).to_contain_text(text)
    expect(upage.locator("#heroArea [aria-label^='Pass versus run']")).to_have_count(1)
    expect(upage.locator("#heroArea .lgmark")).to_have_count(1)


def test_32_five_families_in_descending_order(upage, wsrv):
    """#32: five families in descending p, each with pct(p) and "League {pct(p_league)}"."""
    families = at(upage, wsrv["base"], LATE_IDX)["prediction"]["families"]
    assert [f["p"] for f in families] == sorted((f["p"] for f in families), reverse=True)
    fams = upage.locator("#heroArea .fam")
    expect(fams).to_have_count(5)
    for i, f in enumerate(families):
        expect(fams.nth(i)).to_contain_text(f["name"])
        expect(fams.nth(i)).to_contain_text(pct(f["p"]))
        expect(fams.nth(i)).to_contain_text(f"League {pct(f['p_league'])}")


def test_33_leaves_in_descending_order_with_pct1(upage, wsrv):
    """#33: each family lists its leaves in descending p with pct1 values (one decimal under 10%)."""
    families = at(upage, wsrv["base"], LATE_IDX)["prediction"]["families"]
    leaves = [leaf for f in families for leaf in f["leaves"]]
    for f in families:
        assert [x["p"] for x in f["leaves"]] == sorted((x["p"] for x in f["leaves"]), reverse=True)
    rows = upage.locator("#heroArea .leaf[data-leaf]")
    expect(rows).to_have_count(14)
    assert rows.evaluate_all("els => els.map(e => e.dataset.leaf)") == [x["key"] for x in leaves]
    for i, leaf in enumerate(leaves):
        expect(rows.nth(i)).to_contain_text(leaf["name"])
        expect(rows.nth(i)).to_contain_text(pct1(leaf["p"]))


UP = '#heroArea .up[title="Well above the league"]'
DOWN = '#heroArea .down[title="Well below the league"]'


def test_34_hot_arrows_only_where_hot(upage, wsrv):
    """#34: every hot "up" item shows ▲ titled "Well above the league", every "down" ▼ titled "Well below the
    league", and nothing else shows an arrow."""
    pred = at(upage, wsrv["base"], LATE_IDX)["prediction"]
    items = [f for f in pred["families"]] + [leaf for f in pred["families"] for leaf in f["leaves"]]
    ups = [x["key"] for x in items if x["hot"] == "up"]
    downs = [x["key"] for x in items if x["hot"] == "down"]
    assert ups and downs, f"play {LATE_IDX} no longer gives both arrows: up {ups}, down {downs}"
    expect(upage.locator(UP)).to_have_count(len(ups))
    expect(upage.locator(DOWN)).to_have_count(len(downs))
    for arrow in upage.locator(UP).all():
        expect(arrow).to_have_text("▲")
    for arrow in upage.locator(DOWN).all():
        expect(arrow).to_have_text("▼")
    for f in pred["families"]:
        for leaf in f["leaves"]:
            row = upage.locator(f'#heroArea .leaf[data-leaf="{leaf["key"]}"]')
            expect(row.locator('.up[title="Well above the league"]')).to_have_count(1 if leaf["hot"] == "up" else 0)
            expect(row.locator('.down[title="Well below the league"]')).to_have_count(1 if leaf["hot"] == "down" else 0)


def test_35_why_line_starts_with_his_habits(upage, wsrv):
    """#35 (G23): the why line starts with "{x} pass pts from his habits here", one decimal, "+" when 0 or more."""
    pred = at(upage, wsrv["base"], LATE_IDX)["prediction"]
    expect(upage.locator("#heroArea .why").first).to_have_text(re.compile(
        r"^\s*" + re.escape(why_habits(pred)) + r"\s*pass pts from his habits here"))


def test_36_opening_script_then_memory_terms(upage, wsrv):
    """#36: his opening snaps show "Opening script: memory switches on after snap 15"; late in the game the why line
    lists each memory term with its points instead."""
    base = wsrv["base"]
    assert at(upage, base, FIRST_SNAP_IDX)["prediction"]["script"]
    expect(upage.locator("#heroArea .why").first).to_contain_text("Opening script: memory switches on after snap 15")
    pred = at(upage, base, LATE_IDX)["prediction"]
    assert pred["memory_parts"] and not pred["script"]
    for part in pred["memory_parts"]:
        expect(hero(upage)).to_contain_text(
            re.compile(re.escape(signed1(part["pts"])) + r"\s*" + re.escape(part["term"])))
    expect(hero(upage)).not_to_contain_text("Opening script")


def test_37_clicking_a_prediction_row_shows_it_and_picks_nothing(upage, wsrv):
    """#37, restructure-v2.md (no user input into the game): clicking a play lights its shadow on the field and sends
    nothing to the server; the board never offers to log it."""
    base = wsrv["base"]
    at(upage, base, LATE_IDX)
    sent = record_requests(upage, "/api/", method="POST")
    click_at(upage, '#heroArea .leaf[data-leaf="run_edge_left"]')
    expect(upage.locator("#field")).to_have_attribute("data-ghost-highlight", "run_edge_left")
    upage.wait_for_timeout(700)
    assert [r for r in sent if r["path"] != "/api/open"] == [], sent
    expect(hero(upage)).not_to_contain_text(re.compile(r"click|pick it|log this", re.I))


def test_122_prediction_rows_are_buttons_in_the_tab_order(upage, wsrv):
    """#122 [fix] (G18): the plays are keyboard-focusable buttons, in the board's order; focus lights a play's shadow,
    and Enter on it sends nothing."""
    base = wsrv["base"]
    families = at(upage, base, LATE_IDX)["prediction"]["families"]
    order = [leaf["key"] for f in families for leaf in f["leaves"]]
    first = upage.locator(f'#heroArea .leaf[data-leaf="{order[0]}"]')
    assert first.evaluate("e => e.tagName") == "BUTTON"
    assert first.evaluate("e => e.tabIndex") >= 0
    first.focus()
    expect(upage.locator("#field")).to_have_attribute("data-ghost-highlight", order[0])
    for key in order[1:3]:
        upage.keyboard.press("Tab")
        assert upage.evaluate("() => document.activeElement.dataset.leaf") == key
    sent = record_requests(upage, "/api/", method="POST")
    upage.keyboard.press("Enter")
    upage.wait_for_timeout(700)
    assert sent == [], sent


def test_g24_next_call_off_the_field_says_who_has_the_ball(upage, wsrv):
    """ui-architecture 4.6 G24, restructured: NEXT CALL off the field never asks for input. Before kickoff it says when
    his call comes; on Tampa Bay's drive "TB has the ball"; at the final whistle it is FINAL."""
    base = wsrv["base"]
    at(upage, base, 0)
    expect(hero(upage).locator(".sc-offfield-body")).to_have_text("When DAL gets the ball, his next call appears here.")
    at(upage, base, TB_DRIVE_IDX)
    expect(hero(upage)).to_have_attribute("data-kind", "offfield")
    expect(hero(upage).locator(".sc-offfield-heading")).to_have_text("TB has the ball")
    at(upage, base, TOTAL_PLAYS)
    expect(hero(upage)).to_have_attribute("data-kind", "final")
    expect(hero(upage).locator(".sc-offfield")).to_be_hidden()
    expect(hero(upage)).not_to_contain_text("Ball on")

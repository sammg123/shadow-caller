"""FI 6.3 checklist #29 to #37 and #122: the next call (FI 3.5; G18, G23, G24). Every number comes from /api/state."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import (EVENT, api_post, capitalize, command, ensure_finished, expect_off_field, expect_shows,
                        feed_on, fresh, load, pct, pct1, reset_game, signed1, state, stop_watch, why_habits,
                        with_drive)
from ui_helpers import click_at  # v1.4 (W6): world-aware helpers

pytestmark = pytest.mark.e2e

HOT_STATE = "new D25 | Q1 10:00 | DAL 0 TB 0 | PP 12"      # after the whole game: ▲ and ▼ both show (probed)


def hero(page):
    return page.locator("#heroArea")


def chosen(page):
    return page.locator("#chosen")


def test_29_most_likely_call_and_runners_up(upage, server):
    """#29: "Most likely call" with top[0] and pct, then top[1] and top[2] with their percentages."""
    base = server["base"]
    with_drive(upage, base)
    top = state(base)["prediction"]["top"]
    h = hero(upage)
    expect(h).to_contain_text("Most likely call")
    expect(h).to_contain_text(re.compile(
        re.escape("Most likely call") + r".*?" + re.escape(top[0]["name"]) + r"\s*" + re.escape(pct(top[0]["p"])), re.S))
    expect(h).to_contain_text(re.compile(
        r"Then.*?" + re.escape(top[1]["name"]) + r"\s*" + re.escape(pct(top[1]["p"])) + r".*?"
        + re.escape(top[2]["name"]) + r"\s*" + re.escape(pct(top[2]["p"])), re.S))


def _pill_style(page):
    return page.locator("#heroArea .pill").evaluate(
        "e => { const c = getComputedStyle(e); return [c.backgroundColor, c.color, c.borderTopStyle, c.borderTopColor,"
        " c.borderTopWidth, c.fontWeight].join('|'); }")


def test_30_pill_text_and_distinct_styles(upage, server):
    """#30: the pill is prediction.flag with a capital first letter; TILT, lean and "No edge" look different."""
    base = server["base"]
    styles = {}
    for line in ("new D25", "new D25 | 3&2 D25", "new D25 | Q1 15:00 | DAL 0 TB 14 | 3&2 T20"):
        reset_game(base)
        flag = command(base, line)["prediction"]["flag"]
        load(upage, base)
        pill = upage.locator("#heroArea .pill")
        expect(pill).to_have_text(capitalize(flag))
        cls = flag.replace(" ", "").lower()
        expect(pill).to_have_class(re.compile(rf"(^|\s){cls}(\s|$)"))
        expect(pill).to_have_attribute("data-flag", re.compile(r"\S"))
        styles[flag.split()[0].lower()] = _pill_style(upage)
    assert set(styles) == {"no", "lean", "tilt"}, f"the probed lines no longer give no edge, lean and TILT: {styles}"
    assert len(set(styles.values())) == 3, f"TILT, lean and No edge must look different: {styles}"


def test_31_pass_run_bar_labels(upage, server):
    """#31: "Ball thrown or dropback {pct(p)}", "League {pct(p_league)} (dashed)", "Handed off or kept {pct(1-p)}"."""
    base = server["base"]
    with_drive(upage, base)
    p = state(base)["prediction"]
    for text in (f"Ball thrown or dropback {pct(p['p'])}", f"League {pct(p['p_league'])} (dashed)",
                 f"Handed off or kept {pct(1 - p['p'])}"):
        expect(hero(upage)).to_contain_text(text)
    expect(upage.locator("#heroArea [aria-label^='Pass versus run']")).to_have_count(1)
    expect(upage.locator("#heroArea .lgmark")).to_have_count(1)


def test_32_five_families_in_descending_order(upage, server):
    """#32: five family columns in descending p, each with pct(p) and "League {pct(p_league)}"."""
    base = server["base"]
    with_drive(upage, base)
    families = state(base)["prediction"]["families"]
    assert [f["p"] for f in families] == sorted((f["p"] for f in families), reverse=True)
    fams = upage.locator("#heroArea .fam")
    expect(fams).to_have_count(5)
    for i, f in enumerate(families):
        expect(fams.nth(i)).to_contain_text(f["name"])
        expect(fams.nth(i)).to_contain_text(pct(f["p"]))
        expect(fams.nth(i)).to_contain_text(f"League {pct(f['p_league'])}")


def test_33_leaves_in_descending_order_with_pct1(upage, server):
    """#33: each family lists its leaves in descending p with pct1 values (one decimal under 10%)."""
    base = server["base"]
    with_drive(upage, base)
    families = state(base)["prediction"]["families"]
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


def test_34_hot_arrows_only_where_hot(upage, server):
    """#34: every hot "up" item shows ▲ titled "Well above the league", every "down" ▼ titled "Well below the
    league", and nothing else shows an arrow."""
    base = server["base"]
    ensure_finished(base)
    pred = command(base, HOT_STATE)["prediction"]
    load(upage, base)
    items = [f for f in pred["families"]] + [leaf for f in pred["families"] for leaf in f["leaves"]]
    ups = [x["key"] for x in items if x["hot"] == "up"]
    downs = [x["key"] for x in items if x["hot"] == "down"]
    assert ups and downs, f"{HOT_STATE!r} no longer gives both arrows: up {ups}, down {downs}"
    expect(upage.locator("#heroArea .fam")).to_have_count(5)
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


def test_35_why_line_starts_with_his_habits(upage, server):
    """#35 (G23): the why line starts with "{x} pass pts from his habits here", one decimal, "+" when 0 or more."""
    base = server["base"]
    with_drive(upage, base)
    first = upage.locator("#heroArea .why").first
    expect(first).to_have_text(re.compile(
        r"^\s*" + re.escape(why_habits(state(base)["prediction"])) + r"\s*pass pts from his habits here"))


def test_36_opening_script_then_memory_terms(upage, server):
    """#36: snaps 1 to 15 show "Opening script: memory switches on after snap 15"; after a whole game plus
    `new D25` the why line lists each memory_parts term with its points instead."""
    base = server["base"]
    with_drive(upage, base)
    expect(upage.locator("#heroArea .why").first).to_contain_text(
        "Opening script: memory switches on after snap 15")
    ensure_finished(base)
    pred = command(base, "new D25")["prediction"]
    assert pred["memory_parts"] and not pred["script"]
    load(upage, base)
    expect(upage.locator("#heroArea .why").first).to_be_visible()
    for part in pred["memory_parts"]:
        expect(hero(upage)).to_contain_text(
            re.compile(re.escape(signed1(part["pts"])) + r"\s*" + re.escape(part["term"])))
    expect(hero(upage)).not_to_contain_text("Opening script")


def test_37_clicking_a_prediction_row_picks_it(upage, server):
    """#37: clicking "Outside left (edge)" picks it and focuses Yards, the same as pressing J twice."""
    with_drive(upage, server["base"])
    click_at(upage, '#heroArea .leaf[data-leaf="run_edge_left"]')
    expect(chosen(upage)).to_contain_text("Outside left (edge)")
    expect(upage.locator("#yards")).to_be_focused()
    expect(upage.locator('.key[data-k="J"]')).to_have_attribute("aria-pressed", "true")
    by_click = " ".join(chosen(upage).text_content().split())   # v1.4 (W6): as written; a world may set it in caps
    upage.keyboard.press("Escape")
    expect(chosen(upage)).to_have_text("Pick the play")
    upage.keyboard.press("j")
    upage.keyboard.press("j")
    expect(chosen(upage)).to_have_text(by_click)


def test_122_prediction_rows_are_buttons_enter_and_space_pick(upage, server):
    """#122 [fix] (G18): prediction rows are keyboard-focusable buttons; Enter or Space picks them."""
    with_drive(upage, server["base"])
    edge = upage.locator('#heroArea .leaf[data-leaf="run_edge_left"]')
    assert edge.evaluate("e => e.tagName") == "BUTTON"
    assert edge.evaluate("e => e.tabIndex") >= 0
    edge.focus()
    upage.keyboard.press("Enter")
    expect(chosen(upage)).to_contain_text("Outside left (edge)")
    mid = upage.locator('#heroArea .leaf[data-leaf="pa_mid"]')
    mid.focus()
    upage.keyboard.press("Space")
    expect(chosen(upage)).to_contain_text("PA intermediate (10–19)")


def test_g24_off_field_copy_follows_the_input_mode(upage, server, watch_server):
    """ui-architecture 4.6 G24: the off-field panel's copy by mode: manual, feed, watch."""
    base = server["base"]
    fresh(upage, base)
    expect_off_field(upage)
    expect_shows(hero(upage),
        "When DAL gets the ball, click Ball on above and type the spot, like D 25. The drive starts and predictions "
        "come back. Update the score and clock the same way.")
    feed_on(upage, base)
    expect_shows(hero(upage),
        "When DAL gets the ball, the ESPN feed starts the drive and the next call appears here.")
    wbase = watch_server["base"]
    reset_game(wbase)
    api_post(wbase, "/api/watch/start", {"event_id": EVENT, "speed": 0.5})
    api_post(wbase, "/api/watch/pause")                         # nothing applied yet: DAL hasn't had the ball
    try:
        load(upage, wbase)
        expect_shows(hero(upage), "When DAL gets the ball in this game, the next call appears here.")
    finally:
        stop_watch(wbase)

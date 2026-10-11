"""The Model Report page (/report; restructure-v2.md section 6) in a browser, on both worlds, against a sandboxed server
(the saved TB at DAL game, never the live one). Every board is on the page with the saved game's real numbers, read
from the server's own /api/state and /api/timeline as the e2e suite does, never hard-coded; the links work; the page
loads no 3D engine; it follows the game live through the app's own sync; and it reads at 1512x982 and 1920x1080.
Run alone: .venv/bin/python -m pytest tests/e2e/test_report_page.py -q -x"""
import pytest
from playwright.sync_api import expect

from ui_helpers import (BOOT_TIMEOUT_MS, EVENT, EXPECT_TIMEOUT_MS, REPLAY_TIMEOUT_S, api_post, ensure_finished, fixed,
                        full_timeline, pct, reset_game, state)

pytestmark = pytest.mark.e2e

WORLDS = ("under-the-lights", "neutral")
LAPTOP, TV = (1512, 982), (1920, 1080)
EMPTY = "No calls yet: his first snap hasn't happened."
SECTIONS = ("rp-night", "rp-league", "rp-situations", "rp-surprises", "rp-tendencies", "rp-memory", "rp-wp", "rp-drives",
            "rp-box", "rp-calls")
# DESIGN.md (Typography): text you read on the boards; at 1920 nothing a viewer reads is under 20 px. Under the Lights
# only: the neutral world keeps its plain system sizes.
MIN_TEXT_PX = {LAPTOP: 15, TV: 20}
TEXT_SAMPLES = (".rp-calls td", ".rp-hits td", ".rp-surprise-when", ".rp-legend li", ".rp-who", ".sc-box td")


def open_report(pages, base, world, size=LAPTOP):
    page = pages(width=size[0], height=size[1])
    page.goto(f"{base}/report?world={world}", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('#report[data-boot="ready"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    return page


def last_name(caller):
    return caller.split()[-1]


def problems(page):
    """Uncaught errors, console errors and failed requests (page.errors and page.bad_responses, conftest.py)."""
    return page.errors + page.bad_responses


@pytest.mark.parametrize("world", WORLDS)
def test_every_board_shows_the_saved_game(ui_pages, server, world):
    base = server["base"]
    ensure_finished(base)
    s = state(base)
    g, m = s["metrics"]["granular"], s["metrics"]
    page = open_report(ui_pages, base, world)
    expect(page.locator("#rp-calls tr[data-seq]")).to_have_count(m["n"])
    for sid in SECTIONS:
        expect(page.locator(f"#{sid} .rp-face")).to_be_visible()
    caller = last_name(s["profile"]["caller"])
    # his night so far: the scorecard's own tallies, a bar per call
    expect(page.locator("#rp-night .rp-plate")).to_have_text(f"{caller} so far")
    expect(page.locator(".rp-tally-num")).to_have_text([str(g["leaf_top1"]), str(g["leaf_top3"])])
    expect(page.locator(".rp-bar")).to_have_count(m["n"])
    expect(page.locator(".rp-mark")).to_have_count(6)
    # SHADOW v LEAGUE: every pair, his model first
    pairs = page.locator("#rp-league .sc-card-pair")
    expect(pairs).to_have_count(5)
    expect(pairs.nth(0).locator(".sc-card-full")).to_have_text([pct(m["acc_model"]), pct(m["acc_league"])])
    expect(pairs.nth(2).locator(".sc-card-full")).to_have_text(
        [fixed(m["logloss_model"], 3), fixed(m["logloss_league"], 3)])
    # hit rate: the buckets add up to the scorecard's totals
    expect(page.locator(".rp-hits tbody tr")).to_have_count(8)
    expect(page.locator(".rp-hits tfoot .rp-n")).to_have_text(
        [str(g["leaf_n"]), str(g["leaf_top1"]), str(g["leaf_top3"]), str(g["leaf_top3_league"])])
    check_surprises_and_memory(page, s)
    # the app's own boards, at report size
    expect(page.locator("#rp-tendencies .rp-plate")).to_have_text(f"{caller}'s tendencies")
    expect(page.locator('#rp-wp [data-testid="wp-chart"]')).to_have_attribute("data-available", "true")
    expect(page.locator('#rp-drives [data-testid="drive"]')).to_have_count(len(full_timeline(base)["drives"]))
    expect(page.locator('#rp-box [data-testid="box-score"] th[data-team]')).to_have_count(2)
    analyst = page.locator('[data-testid="report-analyst"]')
    expect(analyst).to_be_hidden()
    assert analyst.inner_text() == ""
    assert problems(page) == []


def check_surprises_and_memory(page, s):
    """The lowest-chance call he made leads the surprises; every tilt is on the memory board."""
    log = [r for r in s["log"] if r.get("leaf_p") is not None]
    lowest = min(log, key=lambda r: r["leaf_p"])
    items = page.locator(".rp-surprise")
    expect(items).to_have_count(min(5, len(log)))
    expect(items.nth(0).locator(".rp-rank")).to_have_text("1")
    expect(items.nth(0).locator(".rp-surprise-called")).to_have_text(lowest["name"])
    tilts = [r for r in s["log"] if r["flag"].startswith("TILT")]
    expect(page.locator(".rp-memory-row")).to_have_count(len(tilts))
    hits = sum(1 for r in tilts if (r["flag"] == "TILT PASS") == bool(r["dropback"]))
    expect(page.locator('.rp-memory-row[data-outcome="true"]')).to_have_count(hits)


@pytest.mark.parametrize("world", WORLDS)
def test_links_back_to_the_gamecast_and_to_the_csv(ui_pages, server, world):
    base = server["base"]
    ensure_finished(base)
    page = open_report(ui_pages, base, world)
    back = page.locator('[data-testid="report-back"]')
    expect(back).to_be_visible()
    expect(back).to_have_attribute("href", f"/?world={world}")
    assert page.request.get(base + back.get_attribute("href")).status == 200
    csv = page.locator('[data-testid="report-csv"]')
    expect(csv).to_be_visible()
    expect(csv).to_have_attribute("href", "/api/export.csv")
    assert csv.get_attribute("download") is not None
    answer = page.request.get(base + "/api/export.csv")
    assert answer.status == 200 and answer.headers["content-type"].startswith("text/csv")
    assert len(answer.text().strip().splitlines()) == state(base)["metrics"]["n"] + 1
    assert problems(page) == []


def test_a_drive_of_his_opens_its_calls_in_the_table(ui_pages, server):
    base = server["base"]
    ensure_finished(base)
    calls = [r for r in full_timeline(base)["rows"] if r.get("offense_is_caller") and r.get("pred")]
    drives = list(dict.fromkeys(r["drive"] for r in calls))
    first = next(r["seq"] for r in calls if r["drive"] == drives[1])
    page = open_report(ui_pages, base, "under-the-lights")
    page.locator(f'#rp-drives .sc-dc-item[data-idx="{drives[1]}"] .sc-dc-btn').click()
    expect(page.locator(f'#rp-calls tr[data-seq="{first}"]')).to_be_focused()
    expect(page.locator('#rp-drives .sc-dc-item[data-caller="false"] .sc-dc-btn').first).to_be_disabled()
    assert problems(page) == []


def test_no_3d_engine_loads_on_this_page(ui_pages, server):
    base = server["base"]
    ensure_finished(base)
    page = ui_pages()
    scripts = []
    page.on("request", lambda req: scripts.append(req.url) if req.resource_type == "script" else None)
    page.goto(f"{base}/report", wait_until="load", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('#report[data-boot="ready"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    expect(page.locator("#rp-calls tr[data-seq]").first).to_be_attached()
    assert scripts and not [u for u in scripts if "/vendor/three/" in u or "/field/" in u or "/theme/worlds/" in u]
    assert page.locator("canvas").count() == 0
    expect(page.locator("html")).to_have_attribute("data-world", "under-the-lights")


def test_follows_the_game_live_without_a_reload(ui_pages, server):
    base = server["base"]
    reset_game(base)
    page = open_report(ui_pages, base, "under-the-lights")
    expect(page.locator("#rp-night .rp-empty")).to_have_text(EMPTY)
    expect(page.locator("#rp-calls .rp-empty")).to_have_text(EMPTY)
    marker = page.evaluate("() => (window.__reportMark = Math.random())")
    api_post(base, "/api/feed/replay", {"event_id": EVENT})
    n = state(base)["metrics"]["n"]
    expect(page.locator("#rp-calls tr[data-seq]")).to_have_count(n, timeout=REPLAY_TIMEOUT_S * 1000)
    expect(page.locator("#rp-night .rp-empty")).to_be_hidden()
    assert page.evaluate("() => window.__reportMark") == marker, "the same page, never reloaded"
    assert problems(page) == []


@pytest.mark.parametrize("size", (LAPTOP, TV), ids=("1512x982", "1920x1080"))
@pytest.mark.parametrize("world", WORLDS)
def test_readable_on_a_laptop_and_a_tv(ui_pages, server, world, size):
    base = server["base"]
    ensure_finished(base)
    page = open_report(ui_pages, base, world, size)
    expect(page.locator("#rp-calls tr[data-seq]").first).to_be_visible(timeout=EXPECT_TIMEOUT_MS)
    width = page.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
    assert width[0] <= width[1], f"the page scrolls sideways: {width}"
    ribbon = page.locator(".rp-ribbon").bounding_box()
    assert ribbon["y"] == 0 and ribbon["width"] == size[0]
    night = page.locator("#rp-night").bounding_box()
    assert night["y"] + night["height"] <= size[1], "the night board fits the first viewport"
    if world == "under-the-lights":
        smallest = page.evaluate("""(sels) => Math.min(...sels.flatMap((s) => [...document.querySelectorAll(s)])
          .filter((n) => n.getClientRects().length).map((n) => parseFloat(getComputedStyle(n).fontSize)))""",
                                 list(TEXT_SAMPLES))
        assert smallest >= MIN_TEXT_PX[size], f"text at {smallest}px"
        tally = page.evaluate("() => parseFloat(getComputedStyle(document.querySelector('.rp-tally-num')).fontSize)")
        assert tally >= 64, "the tally is the page's biggest readout (DESIGN.md: Doto, 64 px and up here)"
    assert problems(page) == []

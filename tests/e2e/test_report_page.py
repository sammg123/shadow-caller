"""The Model Report page (/report; restructure-v2.md section 6) in a browser, on both worlds, against a sandboxed server
(the saved TB at DAL game, never the live one). Every board is on the page with the saved game's real numbers, read
from the server's own /api/state and /api/timeline as the e2e suite does, never hard-coded; the links work; the page
loads no 3D engine; it follows the game live through the app's own sync; and it reads at 1512x982 and 1920x1080.
Run alone: .venv/bin/python -m pytest tests/e2e/test_report_page.py -q -x"""
import json
import re

import pytest
from playwright.sync_api import expect

from ui_helpers import (BOOT_TIMEOUT_MS, EVENT, EXPECT_TIMEOUT_MS, REPLAY_TIMEOUT_S, api_post, ensure_finished, fixed,
                        full_timeline, pct, reset_game, sandbox, state)

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
    # the analyst's full chat, mounted (docs/design/analyst-ui.md 5); one caller: no switch on the ribbon
    analyst = page.locator('[data-testid="report-analyst"]')
    expect(analyst).to_be_visible()
    expect(analyst.locator('[data-testid="ask-panel"]')).to_have_attribute("data-layout", "embedded")
    expect(analyst.locator(".sc-ask-title")).to_have_text("Ask the analyst")
    expect(page.locator('[data-testid="report-sides"]')).to_be_hidden()
    expect(page.locator(".rp-who")).to_have_text(f"Shadowing {caller} · {s['profile']['team']}")
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


# ---------------------------------------------------------------- both play-callers tracked (restructure-v2.md 11.4)
# The saved game as the server sends it with both sides tracked (game-picker.md 4, play-caller-models.md 7): `tracked`
# names both callers away first, one log with both callers' calls (each row carrying team and caller), and the timeline
# marking both offenses' plays and drives as caller rows, its frame (teams[abbr].caller, field.left_team) still the
# game's. Derived from the sandbox's own /api/state and /api/timeline exactly as the
# node fixture does (tests/js/both-sides.mjs): Dallas's 59 calls as graded, each Tampa Bay play made Zac Robinson's call
# wearing Dallas's predictions in game order (stand-ins: real grades from the model, just not his). Served through the
# page's own routes, so the report's real sync, boards and switch run on it. The analyst's two calls are stood in too, so
# a cite can be pressed without Ollama (its backend has its own tests).
TB_CALLER, DAL_CALLER = "Zac Robinson", "Brian Schottenheimer"
READY = {"ready": True, "ollama": True, "model": "gpt-oss:20b", "installed": True, "warm": True, "busy": False,
         "message": None}


def _stand_in(row, template, snap):
    pre, result = row.get("pre") or {}, row.get("result") or {}
    return {**template, "espn_id": row["id"], "team": "TB", "caller": TB_CALLER, "feed_text": row["text"],
            "snap": snap, "drive": row["drive"], "qtr": row["qtr"], "clock": row["clock"], "down": pre.get("down"),
            "togo": pre.get("togo"), "yardline_100": pre.get("yardline_100"), "yards": result.get("yards"),
            "td": bool(result.get("td")), "turnover": bool(result.get("turnover")),
            "nullified": bool(result.get("nullified"))}


def both_sides(s, body):
    """(state, timeline) with both sides tracked; DAL's calls as graded, TB's plays as stand-in calls."""
    dal_oldest = list(reversed(s["log"]))
    dal_by_id = {r["espn_id"]: r for r in dal_oldest}
    dal_pred = {r["id"]: r["pred"] for r in body["rows"] if r.get("pred")}
    log, preds, tb_snaps = [], {}, 0
    for row in body["rows"]:
        if row["team"] == "DAL" and row.get("pred") and row["id"] in dal_by_id:
            log.append({**dal_by_id[row["id"]], "team": "DAL", "caller": DAL_CALLER})
            preds[row["id"]] = row["pred"]
        elif row["team"] == "TB" and row["kind"] == "play":
            template = dal_oldest[sum(1 for r in log if r["team"] == "TB") % len(dal_oldest)]
            wiped = bool((row.get("result") or {}).get("nullified"))
            tb_snaps += 0 if wiped else 1
            log.append(_stand_in(row, template, None if wiped else tb_snaps))
            preds[row["id"]] = {**dal_pred[template["espn_id"]], "snap": None if wiped else tb_snaps,
                                "engine_drive": row["drive"]}
    log = [{**r, "seq": i + 1} for i, r in enumerate(log)]
    seq_of = {r["espn_id"]: r["seq"] for r in log}
    rows = [{**r, "offense_is_caller": True, "pred": {**preds[r["id"]], "log_seq": seq_of[r["id"]]}}
            if r["id"] in preds else r for r in body["rows"]]
    timeline = {**body, "rows": rows,
                "drives": [{**d, "offense_is_caller": True} if d["team"] == "TB" else d for d in body["drives"]]}
    tracked = [{"team": "TB", "caller": TB_CALLER, "slug": "zac-robinson",
                "profile": {**s["profile"], "caller": TB_CALLER, "team": "TB"}},
               {"team": "DAL", "caller": DAL_CALLER, "slug": "brian-schottenheimer"}]
    return {**s, "tracked": tracked, "log": list(reversed(log)), "prediction": None}, timeline


def serve_both_sides(page, base):
    """The page sees the saved game with both sides tracked; returns (state, timeline) as served."""
    s, body = both_sides(state(base), full_timeline(base))
    page.route("**/api/state", lambda route: route.fulfill(json=s))
    page.route(re.compile(r".*/api/timeline\?since=0(&.*)?$"), lambda route: route.fulfill(json=body))
    return s, body


def serve_analyst(page, cite):
    """The analyst ready, answering every question with one sentence that cites `cite` ({seq, ref})."""
    text = f"Look at his call at {cite['ref']}."
    events = [{"type": "tool", "name": "list_plays", "label": "Looking through the plays"},
              {"type": "delta", "text": text}, {"type": "done", "text": text, "cites": [cite]}]
    page.route("**/api/ask/status", lambda route: route.fulfill(json=READY))
    page.route("**/api/ask", lambda route: route.fulfill(status=200, content_type="application/x-ndjson",
                                                        body="".join(json.dumps(e) + "\n" for e in events)))


def calls_of(body, team):
    return [r for r in body["rows"] if r.get("offense_is_caller") and r.get("pred") and r["team"] == team]


def test_both_sides_switch_and_a_cite_to_the_other_callers_call(ui_pages, server):
    base = server["base"]
    ensure_finished(base)
    page = ui_pages(width=LAPTOP[0], height=LAPTOP[1])
    s, body = serve_both_sides(page, base)
    target = calls_of(body, "DAL")[40]
    serve_analyst(page, {"seq": target["seq"], "ref": f"Q{target['qtr']} {target['clock']}"})
    page.goto(f"{base}/report?world=under-the-lights", wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('#report[data-boot="ready"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    rows = page.locator("#rp-calls tr[data-seq]")
    tb, dal = page.locator('.rp-side-key[data-team="TB"]'), page.locator('.rp-side-key[data-team="DAL"]')
    # the ribbon names both callers as a switch, the first named (away) shown; his sections are his
    expect(page.locator('[data-testid="report-sides"]')).to_be_visible()
    expect(page.locator(".rp-who")).to_be_hidden()
    expect(page.locator(".rp-side-key")).to_have_text(["TB Robinson", "DAL Schottenheimer"])
    expect(tb).to_have_attribute("aria-pressed", "true")
    expect(rows).to_have_count(len(calls_of(body, "TB")))
    expect(page.locator("#rp-night .rp-plate")).to_have_text("Robinson so far")
    expect(page.locator("#rp-tendencies .rp-plate")).to_have_text("Robinson's tendencies")
    shared = {sid: page.locator(f"#{sid} .rp-face").inner_text() for sid in ("rp-wp", "rp-drives", "rp-box")}
    # the switch: his sections change at once, the game's boards stay the game's
    dal.click()
    expect(dal).to_have_attribute("aria-pressed", "true")
    expect(rows).to_have_count(len(calls_of(body, "DAL")))
    expect(page.locator("#rp-calls .rp-plate")).to_have_text("Schottenheimer's calls v the model")
    expect(page.locator(".rp-tally-num")).to_have_text([str(s["metrics"]["granular"]["leaf_top1"]),
                                                        str(s["metrics"]["granular"]["leaf_top3"])])
    assert {sid: page.locator(f"#{sid} .rp-face").inner_text() for sid in shared} == shared
    tb.click()
    expect(rows).to_have_count(len(calls_of(body, "TB")))
    # a cite of Schottenheimer's call while Robinson's sections show: the switch flips, the row comes into view, lit
    page.locator('[data-testid="ask-suggestion"]').first.click()
    cite = page.locator('[data-testid="ask-cite"]')
    expect(cite).to_have_text(f"Q{target['qtr']} {target['clock']}")
    cite.click()
    expect(dal).to_have_attribute("aria-pressed", "true")
    row = page.locator(f'#rp-calls tr[data-seq="{target["seq"]}"]')
    expect(row).to_be_focused()
    expect(row).to_have_attribute("data-cited", "true")
    box, ribbon = row.bounding_box(), page.locator(".rp-ribbon").bounding_box()
    assert ribbon["y"] + ribbon["height"] <= box["y"] and box["y"] + box["height"] <= LAPTOP[1], (box, ribbon)
    expect(row).not_to_have_attribute("data-cited", "true", timeout=EXPECT_TIMEOUT_MS)
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), "the page scrolls sideways"
    assert problems(page) == []


# ---------------------------------------------------------------- both play-callers on the real engine
QUIET_THREADS = {"OMP_NUM_THREADS": "1", "KMP_BLOCKTIME": "0"}


@pytest.fixture(scope="module")
def both_server(tmp_path_factory):
    """A sandbox of its own (a pick changes the server's track): TB at DAL with both sides tracked, picked the way the
    game picker picks it (POST /api/game/select, game-picker.md 4), then played to its final whistle (Go Live on a
    finished game jumps to its end), so every number is the real engine's, each caller graded by his own model."""
    with sandbox(tmp_path_factory, QUIET_THREADS) as srv:
        api_post(srv["base"], "/api/game/select", {"event_id": EVENT, "sides": ["TB", "DAL"]})
        api_post(srv["base"], "/api/golive")
        yield srv


def test_both_sides_on_the_real_engine_each_caller_has_his_own_sections(ui_pages, both_server):
    base = both_server["base"]
    s, body = state(base), full_timeline(base)
    assert [t["team"] for t in s["tracked"]] == ["TB", "DAL"] and s["watch"]["state"] == "done", s["watch"]
    tracked = {t["team"]: t for t in s["tracked"]}
    page = open_report(ui_pages, base, "under-the-lights")
    rows, plate = page.locator("#rp-calls tr[data-seq]"), page.locator("#rp-night .rp-plate")
    expect(page.locator('[data-testid="report-sides"]')).to_be_visible()
    expect(page.locator(".rp-who")).to_be_hidden()
    expect(page.locator(".rp-side-key")).to_have_text(
        [f"{team} {last_name(tracked[team]['caller'])}" for team in ("TB", "DAL")])
    expect(rows).to_have_count(len(calls_of(body, "TB")))
    shared = {sid: page.locator(f"#{sid} .rp-face").inner_text() for sid in ("rp-wp", "rp-drives", "rp-box")}
    for team in ("DAL", "TB"):           # each caller's sections are his own: his calls, his tallies, his name
        key = page.locator(f'.rp-side-key[data-team="{team}"]')
        key.click()
        expect(key).to_have_attribute("aria-pressed", "true")
        g = tracked[team]["metrics"]["granular"]
        expect(rows).to_have_count(len(calls_of(body, team)))
        expect(plate).to_have_text(f"{last_name(tracked[team]['caller'])} so far")
        expect(page.locator(".rp-tally-num")).to_have_text([str(g["leaf_top1"]), str(g["leaf_top3"])])
        assert {sid: page.locator(f"#{sid} .rp-face").inner_text() for sid in shared} == shared
    # the drive chart keeps the game's frame (DC A3): each team in its own direction and colour, Tampa Bay right to left
    drives = page.locator("#rp-drives .sc-dc-item")
    expect(drives).to_have_count(len(body["drives"]))
    sides = drives.evaluate_all("ns => ns.map((n) => [n.dataset.team, n.dataset.dir, n.dataset.caller])")
    assert {tuple(x) for x in sides} == {("DAL", "1", "true"), ("TB", "-1", "false")}, sides
    assert problems(page) == []


# The SHADOW v LEAGUE pairs' parts as drawn: each pair's caption and snap count (a count hidden because every pair
# counts the same snaps has no box), its two readouts, and the scorecard's board and the page around them.
PAIRS_JS = """() => { const r = (n) => { const b = n.getBoundingClientRect(); return [b.left, b.top, b.right,
    b.bottom]; };
  const shown = (p, sel) => [...p.querySelectorAll(sel)].filter((n) => n.getClientRects().length).map(r);
  return { face: r(document.querySelector('#rp-league .rp-face')),
    pairs: [...document.querySelectorAll('#rp-league .sc-card-pair')].map((p) => ({ id: p.dataset.pair,
      words: shown(p, '.sc-card-plabel, .sc-card-basis'), sides: shown(p, '.sc-card-side') })),
    page: [document.documentElement.scrollWidth, innerWidth] }; }"""
SLACK = 0.5


def overlaps(a, b):
    return a[0] < b[2] - SLACK and b[0] < a[2] - SLACK and a[1] < b[3] - SLACK and b[1] < a[3] - SLACK


@pytest.mark.parametrize("size", (LAPTOP, TV), ids=("1512x982", "1920x1080"))
def test_both_sides_each_pairs_own_snap_count_fits_his_scorecard(ui_pages, both_server, size):
    """A caller whose pairs count different snaps shows each pair's own count: a sack or a scramble is graded on pass or
    run and its play type, never on a specific play, so Robinson's specific-play pairs count fewer snaps than the rest.
    Every caption and count stays clear of the other pairs and inside his scorecard's board, and the page never scrolls
    sideways (Sam's laptop and a TV)."""
    base = both_server["base"]
    page = open_report(ui_pages, base, "under-the-lights", size)
    expect(page.locator("#rp-calls tr[data-seq]").first).to_be_visible(timeout=EXPECT_TIMEOUT_MS)
    expect(page.locator('.rp-side-key[data-team="TB"]')).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#rp-league .sc-card-pairs")).to_have_attribute("data-basis-shared", "false")
    page.evaluate("document.fonts.ready.then(() => true)")
    m = page.evaluate(PAIRS_JS)
    assert len(m["pairs"]) == 5 and all(len(p["words"]) == 2 for p in m["pairs"]), m["pairs"]
    face = m["face"]
    for p in m["pairs"]:
        caption, count = p["words"]
        assert not overlaps(caption, count), (size, p["id"], "its caption under its own count")
        for box in p["words"]:
            assert face[0] - SLACK <= box[0] and box[2] <= face[2] + SLACK, (size, p["id"], box, "past the board", face)
        for other in m["pairs"]:
            if other is not p:
                hit = [b for b in other["words"] + other["sides"] for w in p["words"] if overlaps(w, b)]
                assert not hit, (size, p["id"], "runs into", other["id"], hit)
    assert m["page"][0] <= m["page"][1], f"the page scrolls sideways: {m['page']}"
    assert problems(page) == []

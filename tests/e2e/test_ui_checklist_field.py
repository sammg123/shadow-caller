"""FI 6.3 checklist #27 and #28 plus the #field hooks of ui-architecture 5.3, run on both engines (WebGL and the 2D
fallback, `?scene=2d`, ui-architecture 6.2) against the same hooks. The saved game is watched to a moment (a paused
watch session; the page's open on load leaves it there, restructure-v2.md 9) and the field reports what /api/state
says."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import CAMERAS, api_post, blur, full_timeline, load, seek_game, state, version, wait_idle

pytestmark = pytest.mark.e2e

SCENES = {"webgl": "", "2d": "scene=2d"}
CHILD = {"webgl": 'canvas[data-testid="field-canvas"]', "2d": 'svg[data-testid="field-svg"]'}
PRESNAP_IDX = 1                 # the kickoff applied: Dallas's first snap, 1st & 10 at DAL 30, is next
GOAL_IDX = 7                    # Dallas's 1st & Goal at TB 8 is next
TB_IDX = 14                     # Tampa Bay has the ball: 1st & 10 at TB 27 is next
ORDINAL = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th"}


@pytest.fixture(params=sorted(SCENES))
def scene(request):
    return request.param


def field(page):
    return page.locator("#field")


def at(page, base, idx, query=""):
    seek_game(base, idx)
    load(page, base, query)


def spot(yardline_100):
    """ESPN's words for a spot `yardline_100` yards from Tampa Bay's goal (Dallas on offense)."""
    if yardline_100 == 50:
        return "50"
    return f"DAL {100 - yardline_100}" if yardline_100 > 50 else f"TB {yardline_100}"


def aria_for(sit):
    """The field's name for Dallas's situation, from /api/state's sit (model/vm-field.js ariaOf)."""
    yl, down, togo = sit["yardline_100"], sit["down"], sit["togo"]
    goal = togo >= yl
    ltg = "the goal line" if goal else spot(yl - togo)
    return f"Ball on {spot(yl)}. {ORDINAL[down]} & {'Goal' if goal else togo}. Line to gain {ltg}."


def test_27_a_dallas_snap_reports_its_lines_and_his_top_two(upage, server, scene):
    """#27 [hook]: before Dallas's first snap the field reports the drive, the line of scrimmage and the line to gain
    (yards from Tampa Bay's goal), names the spot, and draws his top 2 in rank order."""
    base = server["base"]
    at(upage, base, PRESNAP_IDX, SCENES[scene])
    s = state(base)
    sit = s["sit"]
    f = field(upage)
    expect(f).to_have_attribute("data-scene", scene)
    expect(f).to_have_attribute("role", "img")
    expect(f).to_have_attribute("data-drive-active", "true")
    expect(f).to_have_attribute("data-los", str(sit["yardline_100"]))
    expect(f).to_have_attribute("data-ltg", str(sit["yardline_100"] - sit["togo"]))
    expect(f).to_have_attribute("aria-label", aria_for(sit))
    expect(f).to_have_attribute("data-ghosts", " ".join(t["key"] for t in s["prediction"]["top"][:2]))


def test_28_first_and_goal_puts_the_line_to_gain_on_the_goal_line(upage, server, scene):
    """#28 [hook]: 1st & Goal at TB 8 reports the line to gain at the goal line (0)."""
    base = server["base"]
    at(upage, base, GOAL_IDX, SCENES[scene])
    f = field(upage)
    expect(f).to_have_attribute("data-scene", scene)
    expect(f).to_have_attribute("data-drive-active", "true")
    expect(f).to_have_attribute("data-los", "8")
    expect(f).to_have_attribute("data-ltg", "0")
    expect(f).to_have_attribute("aria-label", "Ball on TB 8. 1st & Goal. Line to gain the goal line.")


def test_the_opponents_ball_is_no_drive_of_his_and_draws_no_shadow_plays(upage, server, scene):
    """With Tampa Bay on offense Dallas has no drive and the field shows no shadow plays."""
    base = server["base"]
    at(upage, base, TB_IDX, SCENES[scene])
    f = field(upage)
    expect(f).to_have_attribute("data-scene", scene)
    expect(f).to_have_attribute("data-drive-active", "false")
    expect(f).to_have_attribute("data-ghosts", "")
    assert state(base)["drive_active"] is False


def test_field_hooks_with_a_drive(upage, server, scene):
    """ui-architecture 5.3: scene ready, its canvas or SVG, the approximation legend, idle with nothing queued, the
    epoch, the world's default camera (Wide, restructure-v2.md 4), and the frame counter."""
    base = server["base"]
    at(upage, base, PRESNAP_IDX, SCENES[scene])
    f = field(upage)
    expect(f).to_have_attribute("data-scene-ready", "true", timeout=15_000)
    expect(f.locator(CHILD[scene])).to_have_count(1)
    expect(f.locator('[data-testid="field-legend"]')).to_have_text("Ball shown mid-field; ESPN gives no hash.")
    wait_idle(upage, PRESNAP_IDX)
    expect(f).to_have_attribute("data-queue", "0")
    expect(f).to_have_attribute("data-epoch", version(base)["epoch"])
    camera = f.get_attribute("data-camera")
    assert camera, "#field has no data-camera"
    if scene == "webgl":
        assert camera == CAMERAS[0][0], camera
    assert int(f.get_attribute("data-frames") or "0") >= 1
    assert upage.errors == [], upage.errors


def test_field_reports_the_new_situation_after_right(upage, server, scene):
    """#27's hooks follow the game: Right runs Dallas's first snap and the field reports the situation after it."""
    base = server["base"]
    at(upage, base, PRESNAP_IDX, SCENES[scene])
    before = state(base)["sit"]
    blur(upage)
    upage.keyboard.press("ArrowRight")
    expect(upage.locator("#app")).to_have_attribute("data-playback", "")
    expect(upage.locator('[data-testid="progress-count"]')).not_to_have_text(re.compile(rf"^{PRESNAP_IDX} /"))
    after = state(base)
    assert after["sit"] != before
    f = field(upage)
    if after["drive_active"]:
        expect(f).to_have_attribute("data-los", str(after["sit"]["yardline_100"]))
        expect(f).to_have_attribute("aria-label", aria_for(after["sit"]))
    else:
        expect(f).to_have_attribute("data-drive-active", "false")


def verdict_words(pred):
    """model/verdict.js verdictOf, in words: his rank for the play he ran (1, top 3 or not), else the play type."""
    rank = (pred or {}).get("leaf_rank")
    if isinstance(rank, int) and rank > 0:
        return "Top pick" if rank == 1 else "In his top 3" if rank <= 3 else "Miss"
    return "Top pick" if pred.get("fam_top") == pred.get("family") else "Miss"


def test_a_played_snap_is_spoken_with_its_verdict_and_a_camera_change_on_the_status_line(upage, server):
    """G2-6: assistive tech hears each newly drawn play once, with his verdict, in a polite log (nothing from before
    the page loaded), and what V just did on the status line."""
    base = server["base"]
    at(upage, base, PRESNAP_IDX)
    log = upage.locator('[data-testid="announcer-log"]')
    status = upage.locator('[data-testid="announcer-status"]')
    expect(log).to_have_attribute("role", "log")
    expect(log).to_have_attribute("aria-live", "polite")
    expect(status).to_have_attribute("role", "status")
    wait_idle(upage, PRESNAP_IDX)
    expect(log.locator("p")).to_have_count(0)
    api_post(base, "/api/watch/step")
    row = [r for r in full_timeline(base)["rows"] if r["seq"] == PRESNAP_IDX + 1][0]
    words = verdict_words(row["pred"])
    spoken = log.locator("p")
    expect(spoken).to_have_count(1)
    expect(spoken.first).to_have_text(re.compile(r"^Q1 \d{1,2}:\d{2} DAL\. .+\. " + re.escape(words) + r"\.$"))
    blur(upage)
    upage.keyboard.press("v")
    expect(status).to_have_text(f"Camera: {CAMERAS[1][1]}")

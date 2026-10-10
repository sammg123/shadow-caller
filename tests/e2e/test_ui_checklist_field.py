"""FI 6.3 checklist #27 and #28 plus the #field hooks of ui-architecture 5.3, run on both engines (WebGL and the 2D
fallback, `?scene=2d`, ui-architecture 6.2) against the same hooks."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import blur, command, full_timeline, state, version, wait_idle, with_drive
from ui_helpers import CAMERAS, point_at  # v1.4 (W6): world-aware helpers

pytestmark = pytest.mark.e2e

ANY = re.compile(".*")                      # not_to_have_attribute(name, ANY): the attribute is absent
SCENES = {"webgl": "", "2d": "scene=2d"}
CHILD = {"webgl": 'canvas[data-testid="field-canvas"]', "2d": 'svg[data-testid="field-svg"]'}


@pytest.fixture(params=sorted(SCENES))
def scene(request):
    return request.param


def field(page):
    return page.locator("#field")


def test_27_drive_reports_los_75_ltg_65_then_punt_clears_them(upage, server, scene):
    """#27 [hook]: 1st & 10 DAL 25 reports drive active, LOS 75, LTG 65; after Punt no drive and neither line."""
    with_drive(upage, server["base"], SCENES[scene])
    f = field(upage)
    expect(f).to_have_attribute("data-scene", scene)
    expect(f).to_have_attribute("role", "img")
    expect(f).to_have_attribute("data-drive-active", "true")
    expect(f).to_have_attribute("data-los", "75")
    expect(f).to_have_attribute("data-ltg", "65")
    expect(f).to_have_attribute("aria-label", "Ball on DAL 25. 1st & 10. Line to gain DAL 35.")
    upage.locator('[data-end="punt"]').click()
    expect(f).to_have_attribute("data-drive-active", "false")
    expect(f).not_to_have_attribute("data-los", ANY)
    expect(f).not_to_have_attribute("data-ltg", ANY)
    expect(f).to_have_attribute("aria-label", "DAL off the field.")
    expect(f).to_have_attribute("data-ghosts", "")


def test_28_first_and_goal_puts_the_line_to_gain_on_the_goal_line(upage, server, scene):
    """#28 [hook]: 1st & Goal at TB 8 reports the line to gain at the goal line (0)."""
    with_drive(upage, server["base"], SCENES[scene], spot="new T8")
    f = field(upage)
    expect(f).to_have_attribute("data-scene", scene)
    expect(f).to_have_attribute("data-drive-active", "true")
    expect(f).to_have_attribute("data-los", "8")
    expect(f).to_have_attribute("data-ltg", "0")
    expect(f).to_have_attribute("aria-label", "Ball on TB 8. 1st & Goal. Line to gain the goal line.")


def test_field_hooks_with_a_drive(upage, server, scene):
    """ui-architecture 5.3: scene ready, its canvas or SVG, the approximation legend, the shadow plays (his top 2) in
    rank order, idle with nothing queued, the epoch, a camera, and the frame counter."""
    base = server["base"]
    with_drive(upage, base, SCENES[scene])
    f = field(upage)
    expect(f).to_have_attribute("data-scene-ready", "true", timeout=15_000)
    expect(f.locator(CHILD[scene])).to_have_count(1)
    expect(f.locator('[data-testid="field-legend"]')).to_have_text("Ball shown mid-field; ESPN gives no hash.")
    top = [t["key"] for t in state(base)["prediction"]["top"]]
    # v1.4 (play-drawing.md 4): the field draws his top 2 as shadow plays, in rank order; both engines report exactly
    # those two (W6: A5 part 2 moved the 3D hook from the three zones to the drawn shadows, as A6's 2D field had)
    expect(f).to_have_attribute("data-ghosts", " ".join(top[:2]))
    wait_idle(upage)
    expect(f).to_have_attribute("data-queue", "0")
    expect(f).to_have_attribute("data-epoch", version(base)["epoch"])
    camera = f.get_attribute("data-camera")
    assert camera, "#field has no data-camera"
    if scene == "webgl":
        assert camera == CAMERAS[0][0], camera               # the world's cameras.default (sideline on neutral)
    assert int(f.get_attribute("data-frames") or "0") >= 1


def test_field_ghost_highlight_follows_hover_and_focus(upage, server, scene):
    """G18 + 5.3: hovering or focusing a prediction row highlights its ghost; leaving it clears the highlight."""
    base = server["base"]
    with_drive(upage, base, SCENES[scene])
    top1 = state(base)["prediction"]["top"][0]["key"]
    leaf = point_at(upage, f'#heroArea .leaf[data-leaf="{top1}"]')
    expect(field(upage)).to_have_attribute("data-ghost-highlight", top1)
    upage.mouse.move(2, 2)
    expect(field(upage)).to_have_attribute("data-ghost-highlight", "")
    leaf.focus()
    expect(field(upage)).to_have_attribute("data-ghost-highlight", top1)


def test_field_reports_the_new_situation_after_a_play(upage, server, scene):
    """#27's hooks follow the game: after `K 4` from 1st & 10 at DAL 25 the field reports 2nd & 6 at DAL 29."""
    base = server["base"]
    with_drive(upage, base, SCENES[scene])
    command(base, "K 4")
    f = field(upage)
    expect(f).to_have_attribute("data-los", "71")
    expect(f).to_have_attribute("data-ltg", "65")
    expect(f).to_have_attribute("aria-label", "Ball on DAL 29. 2nd & 6. Line to gain DAL 35.")


def verdict_words(pred):
    """model/verdict.js verdictOf, in words: his rank for the play he ran (1, top 3 or not), else the play type."""
    rank = (pred or {}).get("leaf_rank")
    if isinstance(rank, int) and rank > 0:
        return "Top pick" if rank == 1 else "In his top 3" if rank <= 3 else "Miss"
    return "Top pick" if pred.get("fam_top") == pred.get("family") else "Miss"


def test_a_logged_play_is_spoken_with_its_verdict_and_a_camera_change_on_the_status_line(upage, server):
    """G2-6: assistive tech hears each newly drawn play once, with his verdict, in a polite log (nothing from before
    the page loaded), and what V just did on the status line."""
    base = server["base"]
    with_drive(upage, base)
    log = upage.locator('[data-testid="announcer-log"]')
    status = upage.locator('[data-testid="announcer-status"]')
    expect(log).to_have_attribute("role", "log")
    expect(log).to_have_attribute("aria-live", "polite")
    expect(status).to_have_attribute("role", "status")
    wait_idle(upage)
    expect(log.locator("p")).to_have_count(0)
    command(base, "K 4")
    row = full_timeline(base)["rows"][-1]
    words = verdict_words(row["pred"])
    spoken = log.locator("p")
    expect(spoken).to_have_count(1)
    expect(spoken.first).to_have_text(re.compile(r"^Q1 \d{1,2}:\d{2} DAL\. Inside run.*\+4\. " + re.escape(words) + r"\.$"))
    blur(upage)
    upage.keyboard.press("v")
    expect(status).to_have_text(f"Camera: {CAMERAS[1][1]}")

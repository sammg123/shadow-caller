"""The review camera frames the whole reviewed play (G2-2; ui-architecture 2.5 cameras, 14.5 camera rig).

Left and Right (or a play picked from the play ribbon) replay a past row from its own line of scrimmage. The camera
holds that row's situation and its whole play, so a 72-yard run, a 48-yard deep shot, a punt and a field goal end on
screen, with the play's words inside the free part of the field: clear of every HUD inset the world reserves
(--sc-field-safe-*; Under the Lights keeps its video board and desk on the right, so at 1440x900 the words stay left
of x 984, at 1920x1080 left of x 1296). The live view keeps the situation's own frame. Runs on WORLD (ui_helpers;
SC_E2E_WORLD=under-the-lights for Sam's world), on the WebGL field: the 2D field always shows the whole field."""
import re

import pytest
from playwright.sync_api import expect
from ui_helpers import TOTAL_ROWS, finished, until, wait_idle

pytestmark = pytest.mark.e2e

SIZES = ((1440, 900), (1920, 1080))
# play-drawing.md 3's words for the plays that ended off screen before G2-2 (TB at DAL, the saved game)
REVIEWED = {81: "Deep pass middle · +48", 95: "Off-tackle left · +72", 43: "Punt · 53 yds · out of bounds",
            87: "FG 41 yds · good"}
EDGE_PX = 1                    # sub-pixel rounding of the label's box against the free area's edges
ANY = re.compile(".*")         # not_to_have_attribute(name, ANY): the attribute is absent

FREE_AREA_JS = """() => {
  const field = document.getElementById('field');
  const r = field.getBoundingClientRect();
  const cs = getComputedStyle(field);
  const inset = (k) => parseFloat(cs.getPropertyValue('--sc-field-safe-' + k)) || 0;
  return { left: r.left + inset('left'), right: r.right - inset('right'), top: r.top + inset('top'),
    bottom: r.bottom - inset('bottom') };
}"""

LABEL_JS = """(words) => {
  const all = [...document.querySelectorAll('#field .sc-play-label')];
  const el = all.find((e) => e.textContent === words && e.getClientRects().length > 0
    && getComputedStyle(e.closest('.sc-field-label') ?? e).display !== 'none');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}"""


def review(page, seq):
    """Review `seq` from the play ribbon (Enter on its row), the way Sam picks a play, then let go of the ribbon."""
    page.locator("#rg-plays").hover()
    page.locator(f'#rg-plays [data-testid="play-row"][data-seq="{seq}"] button').focus()
    page.keyboard.press("Enter")
    expect(page.locator("#field")).to_have_attribute("data-review-seq", str(seq))
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.mouse.move(2, 2)


def settled_label(page, words):
    """The label's box once it stops moving (the camera has landed on the review's frame)."""
    seen = {"last": None}

    def still():
        box = page.evaluate(LABEL_JS, words)
        same = box is not None and box == seen["last"]
        seen["last"] = box
        return same
    until(page, still, timeout_ms=15_000, step_ms=250, what=f"'{words}' to stand still on the field")
    return seen["last"]


@pytest.mark.parametrize("size", SIZES, ids=[f"{w}x{h}" for w, h in SIZES])
def test_review_frames_the_whole_play_with_its_words_in_the_free_area(ui_pages, server, size):
    """G2-2: reviewing the deep pass (+48), the 72-yard run, the punt and the field goal leaves each play's words on
    the field inside the free area, at the laptop's size and the TV's."""
    page = ui_pages(width=size[0], height=size[1])
    finished(page, server["base"])
    wait_idle(page, TOTAL_ROWS, timeout=60_000)
    expect(page.locator("#field")).to_have_attribute("data-scene", "webgl")
    for seq, words in REVIEWED.items():
        review(page, seq)
        box = settled_label(page, words)
        free = page.evaluate(FREE_AREA_JS)
        inside = (box["left"] >= free["left"] - EDGE_PX and box["right"] <= free["right"] + EDGE_PX
                  and box["top"] >= free["top"] - EDGE_PX and box["bottom"] <= free["bottom"] + EDGE_PX)
        assert inside, f"seq {seq} '{words}' at {box} is outside the free area {free} ({size[0]}x{size[1]})"
    page.keyboard.press("Escape")
    expect(page.locator("#field")).not_to_have_attribute("data-review-seq", ANY)
    assert page.errors == [], page.errors

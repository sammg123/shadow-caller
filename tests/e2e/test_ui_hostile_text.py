"""G1-12 (v1.4, G27 for ESPN's other text): team names, the venue and a flag's words in /api/timeline are shown as
text, never parsed as HTML, on both worlds and on the 2D field. A summary is ESPN's (or a saved file's): its words
reach the band, the scoreboard and the field's labels. The server caps their length (tests/test_backend_gaps.py);
here the page must never build a node from them, and must still show the words, markup and all."""
import pytest
from ui_helpers import app_url, ensure_finished, wait_idle, wait_ready, TOTAL_ROWS

pytestmark = pytest.mark.e2e

WORLDS = ("neutral", "under-the-lights")
SCENES = {"webgl": "", "2d": "scene=2d"}
NAME = '<b data-g112="name">Cowboys</b><img data-g112="img" src=x onerror="window.__g112=1">'
PLACE = '<i data-g112="place">Dallas</i>'
VENUE = '<script data-g112="venue">window.__g112v = 1</script>AT&T Stadium'
NOTE = '<img data-g112="note" src=x onerror="window.__g112n=1"> holding on TB'


def hostile(body):
    """The real timeline with markup in the teams, the venue and the flag on the last play drawn."""
    for team in (body.get("teams") or {}).values():
        team.update(name=NAME, location=PLACE, display_name=NAME)
    if isinstance(body.get("game"), dict):
        body["game"].update(venue=VENUE, city=PLACE)
    drawn = [r for r in body.get("rows", []) if r["kind"] != "admin" and r.get("result")]
    if drawn:
        last = drawn[-1]
        last["result"]["penalty"] = {"on": "TB", "foul": NOTE, "yards": 5, "at_x": (last.get("geo") or {}).get("x0"),
                                     "no_play": False, "status": "enforced", "note": NOTE}
    return body


@pytest.mark.parametrize("world", WORLDS)
@pytest.mark.parametrize("scene", sorted(SCENES))
def test_espn_words_are_text_never_markup(ui_pages, server, world, scene):
    base = server["base"]
    ensure_finished(base)
    page = ui_pages()

    def inject(route):
        response = route.fetch()
        route.fulfill(response=response, json=hostile(response.json()))

    page.route("**/api/timeline*", inject)
    query = "&".join(q for q in (f"world={world}", SCENES[scene]) if q)
    page.goto(app_url(base).split("?")[0] + "?" + query, wait_until="domcontentloaded")
    wait_ready(page)
    wait_idle(page, TOTAL_ROWS)
    page.wait_for_timeout(500)
    assert page.locator("[data-g112]").count() == 0, "a node was built from ESPN's words"
    assert page.evaluate("() => [window.__g112, window.__g112n, window.__g112v]") == [None, None, None]
    text = page.evaluate("() => document.body.textContent")
    assert "<b data-g112=\"name\">Cowboys</b>" in text, "the team name is shown, markup and all"
    field = page.evaluate("() => (document.getElementById('field') || document.body).textContent")
    assert '<img data-g112="note"' in field, "the flag's words are on the field, as text"
    assert not [e for e in page.errors if "g112" in e], page.errors

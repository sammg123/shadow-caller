import pytest
from e2e_helpers import get, post

pytestmark = pytest.mark.e2e

BOOT_MS = 60_000
SESSION_STATES = ("playing", "paused", "done", "error")


def test_page_loads_opens_the_saved_game_and_has_no_console_errors(page, server):
    """The page opens its game on load (restructure-v2.md 9: POST /api/open; offline the saved game is final, so it
    opens paused at kickoff, unless a session is already on screen), Go Live jumps it to its final whistle (DAL 16,
    TB 24), and a reload brings nothing to the console. The game the session backed up is put back at the end."""
    base = server["base"]
    try:
        page.goto(base + "/", wait_until="networkidle")
        page.wait_for_selector('#app[data-boot="ready"]', state="attached", timeout=BOOT_MS)
        assert get(base + "/api/watch")["state"] in ("paused", "done")
        v = post(base, "/api/golive")
        assert (v["sit"]["score_off"], v["sit"]["score_opp"]) == (16, 24)
        assert v["watch"]["state"] == "done"
        page.reload(wait_until="networkidle")
        page.wait_for_selector('#app[data-boot="ready"]', state="attached", timeout=BOOT_MS)
        page.wait_for_timeout(1500)
        assert page.errors == []
    finally:
        if get(base + "/api/watch")["state"] in SESSION_STATES:
            post(base, "/api/watch/stop", {"restore": True})

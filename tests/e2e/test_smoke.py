import pytest
from e2e_helpers import EVENT, post

pytestmark = pytest.mark.e2e


def test_page_loads_replays_and_has_no_console_errors(page, server):
    page.goto(server["base"] + "/", wait_until="networkidle")
    v = post(server["base"], "/api/feed/replay", {"event_id": EVENT})
    assert (v["sit"]["score_off"], v["sit"]["score_opp"]) == (16, 24)
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)
    assert page.errors == []

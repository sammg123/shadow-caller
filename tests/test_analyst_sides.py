"""The analyst with both sides tracked (restructure-v2.md 11 decision 4; analyst.md 2): one Caller per tracked
play-caller, each with his own profile, calls, scorecard and memory; a team argument chooses the caller in every
caller tool; nothing assumes one offense. The engine is a stand-in for the engine builder's two-sided GameEngine,
held to its contract: every caller row and the prediction carry team and caller, and metrics(team) is that caller's
scorecard. It is made from the real TB at DAL game (Dallas's calls, plus Tampa Bay's from the first of them)."""
import copy
import json
from types import SimpleNamespace

import pytest
from helpers import TEST_GAME

import analyst
import analyst_tools as at
import live

TB_NAME, DAL_NAME = "Zac Robinson", "Brian Schottenheimer"
TB_ROWS = 10
BOTH = {**TEST_GAME, "sides": ["TB", "DAL"], "track": "DAL+TB"}


class TwoSides:
    """The engine's contract with both sides tracked, over a real game's state."""

    def __init__(self, real):
        self.profile = copy.deepcopy(real.profile)
        state = copy.deepcopy(real.state)
        dal = [{**r, "team": "DAL", "caller": DAL_NAME} for r in state["log"]]
        tb = [{**r, "team": "TB", "caller": TB_NAME, "seq": 1000 + i}
              for i, r in enumerate([r for r in dal if live.is_snap(r)][:TB_ROWS])]
        self.state = {**state, "log": dal + tb, "drive_active": True}
        self._pred = {**real.predict(), "team": "TB", "caller": TB_NAME}

    def predict(self):
        return copy.deepcopy(self._pred)

    def metrics(self, team=None):
        rows = [r for r in self.state["log"] if team in (None, r.get("team"))]
        return live.GameEngine.metrics(SimpleNamespace(state={"log": rows}))

    def epoch(self):
        return "t-1"


@pytest.fixture(scope="module")
def game(make_feed, summary):
    e, feed = make_feed()
    feed.apply(summary)
    return e, feed


@pytest.fixture(scope="module")
def snap(game):
    e, feed = game
    engine = TwoSides(e)
    tb_profile = {**engine.profile, "caller": TB_NAME, "team": "TB"}
    raw = at.capture(engine, feed, BOTH, mode="replay", sides=[("TB", tb_profile), ("DAL", engine.profile)])
    return at.build_snapshot(raw)


def tool(snap, name, **args):
    result = at.run_tool(snap, name, args)
    assert result.ok, result.text
    return json.loads(result.text)


def test_every_tracked_caller_has_his_own_calls_profile_and_scorecard(snap, game):
    tb, dal = snap.callers
    assert (tb.team, tb.name, dal.team, dal.name) == ("TB", TB_NAME, "DAL", DAL_NAME)
    assert {r["team"] for r in tb.log} == {"TB"} and len(tb.log) == TB_ROWS
    assert {r["team"] for r in dal.log} == {"DAL"} and len(dal.log) == len(game[0].state["log"])
    assert tb.metrics["n"] == TB_ROWS and dal.metrics["n"] == game[0].metrics()["n"]
    assert tb.profile["caller"] == TB_NAME and dal.profile["caller"] == DAL_NAME
    assert set(tb.memory_parts) == {r["seq"] for r in tb.log if live.is_snap(r)}


def test_the_next_call_belongs_to_the_offense_with_the_ball(snap):
    tb, dal = snap.callers
    assert tb.on_field and tb.prediction["team"] == "TB"
    assert not dal.on_field and dal.prediction is None
    now = tool(snap, "game_situation")["callers"]
    assert [(c["team"], c["has_ball"]) for c in now] == [("TB", True), ("DAL", False)]
    assert now[0]["next_call"]["top_pick"] and now[1]["next_call"] is None and now[1]["next_call_note"]


@pytest.mark.parametrize("name, key", [("scorecard", "caller"), ("tendencies", "caller"),
                                       ("caller_profile", "name")])
def test_a_team_argument_chooses_the_caller(snap, name, key):
    assert tool(snap, name, team="TB")[key] == TB_NAME
    assert tool(snap, name, team="DAL")[key] == DAL_NAME
    assert tool(snap, name, team="Dallas Cowboys")[key] == DAL_NAME
    assert tool(snap, name)[key] == TB_NAME, "left out: the caller whose offense has the ball"


def test_each_scorecard_counts_only_his_calls(snap):
    assert tool(snap, "scorecard", team="TB")["snaps"] == TB_ROWS
    assert tool(snap, "scorecard", team="DAL", split="down")["by_down"]


def test_the_explainer_explains_the_caller_asked_about(snap):
    assert TB_NAME in tool(snap, "model_explainer", team="TB")["explainer"]
    assert DAL_NAME in tool(snap, "model_explainer", team="DAL")["explainer"]
    assert TB_NAME in tool(snap, "model_explainer")["explainer"]


def test_the_tools_offer_both_callers_and_the_prompt_names_both(snap):
    schemas = {s["function"]["name"]: s["function"]["parameters"]["properties"] for s in at.schemas(snap)}
    for name in ("scorecard", "tendencies", "caller_profile", "model_explainer"):
        assert schemas[name]["team"]["enum"] == ["TB", "DAL"], name
    prompt = analyst.system_prompt(snap)
    assert f"{TB_NAME}, who calls plays for TB" in prompt and f"{DAL_NAME}, who calls plays for DAL" in prompt
    assert "models the offensive play-callers it tracks" in prompt and "one offensive play-caller" not in prompt


def test_one_tracked_caller_reads_exactly_as_before(game):
    e, feed = game
    before = at.build_snapshot(at.capture(e, feed, TEST_GAME, mode="replay"))
    named = at.build_snapshot(at.capture(e, feed, TEST_GAME, mode="replay", sides=[("DAL", e.profile)]))
    assert at.dump(before) == at.dump(named)
    assert len(before.callers) == 1 and before.callers[0].team == "DAL"

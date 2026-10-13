"""The live feed with both sides tracked (game-picker.md 4; play-caller-models.md 7): espn_feed.Feed applies every ESPN
play once, logs each tracked offense's snaps with its own play-caller's model, and names the team that has the ball
after every play, exactly as the engine builder's driver does (tests/sides_helpers.SideDriver, which the engine's own
tests hold to the contract). One side reads as it always has. The saved TB at DAL game, sandboxed: never data/."""
import threading

import pytest
from helpers import TEST_GAME
from sides_helpers import CLOCK_KEYS, SideDriver, without

import callers
import config
import live
from espn_feed import Feed, iter_plays, team_ids

SEASON, WEEK = 2026, 5


@pytest.fixture(scope="module")
def models():
    tb = callers.find_caller("TB", SEASON, WEEK)
    return {"TB": callers.load_caller(tb["slug"]), "DAL": callers.load_caller(config.CALLER_SLUG)}


def fresh(sandbox, **kw):
    for p in sandbox.glob("*.json"):
        p.unlink()
    e = live.GameEngine(**kw)
    e.reset()
    return e


def by_feed(sandbox, summary, one_by_one=False, **kw):
    e = fresh(sandbox, **kw)
    feed = Feed(e, threading.RLock())
    if one_by_one:                                  # as Watch mode applies them
        feed.summary = summary
        for team, p in iter_plays(summary):
            feed.apply_one(team, p)
    else:
        feed.apply(summary)
    return e, feed


def by_driver(sandbox, summary, **kw):
    e = fresh(sandbox, **kw)
    SideDriver(e, summary).apply()
    return e


def same_game(a, b):
    assert [without(r, CLOCK_KEYS) for r in a.state["log"]] == [without(r, CLOCK_KEYS) for r in b.state["log"]]
    assert (a.state["mem"], a.state["sit"], a.state["drive_n"]) == (b.state["mem"], b.state["sit"], b.state["drive_n"])
    for team in a.sides:
        assert a.metrics(team) == b.metrics(team)


def test_the_feed_knows_both_teams_by_their_espn_ids(summary):
    assert team_ids(summary) == {"6": "DAL", "27": "TB"}


@pytest.mark.parametrize("one_by_one", [False, True])
def test_both_sides_tracked_the_feed_logs_each_offenses_calls_with_its_own_model(sandbox, summary, models,
                                                                                  one_by_one):
    both = {"callers": {"TB": models["TB"], "DAL": models["DAL"]}}
    e, feed = by_feed(sandbox, summary, one_by_one, **both)
    same_game(e, by_driver(sandbox, summary, **both))
    teams = {r["team"] for r in e.state["log"] if live.is_snap(r)}
    assert teams == {"TB", "DAL"} and len(feed.applied) == len(iter_plays(summary)), "every play applied once"
    callers_seen = {(r["team"], r["caller"]) for r in e.state["log"] if live.is_snap(r)}
    assert callers_seen == {("TB", models["TB"].name), ("DAL", models["DAL"].name)}


def test_one_other_side_alone_logs_only_its_calls(sandbox, summary, models):
    e, _ = by_feed(sandbox, summary, callers={"TB": models["TB"]})
    same_game(e, by_driver(sandbox, summary, callers={"TB": models["TB"]}))
    assert {r["team"] for r in e.state["log"] if live.is_snap(r)} == {"TB"}


def test_one_side_reads_as_it_always_has(sandbox, summary):
    e, feed = by_feed(sandbox, summary)
    same_game(e, by_driver(sandbox, summary))
    assert e.sides == (TEST_GAME["offense"],) and feed.off_team_id == "6"
    assert {r["team"] for r in e.state["log"] if live.is_snap(r)} == {"DAL"}

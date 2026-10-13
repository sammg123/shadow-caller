"""The play-callers a GameEngine runs on (play-caller-models.md 7): one model per tracked offense, and the game as each
offense sees it.

A side is a team the engine tracks and its play-caller's models: tonight's build in models/ (the default, loaded
exactly as the engine always loaded it) or a callers.CallerModel bundle from models/callers. The engine keeps one
situation: down, distance and field position are always the offense's with the ball (ESPN's yardsToEndzone), while
the score stays GAME's offense's (score_off) against its opponent's. So the opponent's offense reads the score the
other way round, and GAME the other way round too: its own home flag and spread (the total is shared), or its own
config when the track keeps one per side (GAME["by_side"], game-picker.md 4).
"""
import json
import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

import joblib

import callers
from callers import CallerModel, ModelVersionError
from config import CALLER_NAME

MAX_SIDES = 2
BOTH_HELP = "callers maps one or both teams of the game to their play-caller's model, like {'DAL': model}."


@dataclass(frozen=True)
class Side:
    """One tracked offense and its play-caller's models, as the engine reads them."""
    team: str
    caller: str                  # his name as the play-caller table spells it
    slug: str | None             # his folder name in models/callers
    profile: dict                # profile.json (the live schema): coefficients, q0, alpha, labels
    stage1: object               # the league baseline
    granular: dict               # the play-type models and his adjustments
    w: Mapping                   # his stage 2 coefficient estimates by term
    alpha: float                 # how fast his in-game memory learns
    q0: float                    # where it starts


def _side(team: str, profile: dict, stage1: object, granular: dict, caller: str, slug: str | None) -> Side:
    return Side(team=team, caller=caller, slug=slug, profile=profile, stage1=stage1, granular=granular,
                w={c: v["est"] for c, v in profile["coefs"].items()}, alpha=profile["alpha"], q0=profile["q0"])


def _slug_of(name: str) -> str | None:
    try:
        return callers.slugify(name)
    except ValueError:
        return None


def default_side(team: str, model_dir: str | Path) -> Side:
    """Tonight's build in model_dir (models/) for `team`, loaded as the engine always has: FileNotFoundError when it is
    missing, ModelVersionError when it was built with another scikit-learn (app.py may rebuild it then)."""
    import sklearn
    folder = Path(model_dir)
    profile = json.loads((folder / "profile.json").read_text())
    if profile.get("sklearn") != sklearn.__version__:
        raise ModelVersionError(f"Model was built with a different scikit-learn version "
                                f"({profile.get('sklearn')}, this setup has {sklearn.__version__})")
    stage1 = joblib.load(folder / "stage1.joblib")
    granular = joblib.load(folder / "granular.joblib")
    name = str(profile.get("caller") or CALLER_NAME)
    return _side(team, profile, stage1, granular, name, _slug_of(name))


def bundle_side(team: str, model: CallerModel) -> Side:
    """`team` run on one play-caller's bundle (callers.load_caller)."""
    if not isinstance(model, CallerModel):
        raise ValueError(f"The play-caller for {team} must be a model from callers.load_caller "
                         f"(got {type(model).__name__}).")
    return _side(team, model.profile, model.stage1, model.granular, model.name, model.slug)


def make_sides(game: Mapping, model_dir: str | Path, caller: CallerModel | None = None,
               by_team: Mapping | None = None) -> tuple[Side, ...]:
    """The sides an engine runs on, in the order they are listed. caller: one bundle for GAME's offense. by_team:
    {team: bundle} for one or both teams of GAME. Neither: models/ for GAME's offense. ValueError for anything else."""
    if caller is not None and by_team is not None:
        raise ValueError("Give the engine one play-caller (caller) or one per team (callers), not both.")
    if by_team is None:
        team = game["offense"]
        return (default_side(team, model_dir) if caller is None else bundle_side(team, caller),)
    if not isinstance(by_team, Mapping) or not 1 <= len(by_team) <= MAX_SIDES:
        raise ValueError(BOTH_HELP)
    teams = (game["offense"], game["opponent"])
    stray = [t for t in by_team if t not in teams]
    if stray:
        raise ValueError(f"{str(stray[0])[:8]} doesn't play in this game ({teams[0]} and {teams[1]} do).")
    return tuple(bundle_side(team, model) for team, model in by_team.items())


def track_key(teams: Iterable[str]) -> str:
    """'DAL'; 'DAL+TB' with both sides (sorted, joined by '+'): the track's folder and archive key (game-picker.md 4)."""
    return "+".join(sorted(teams))


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _has_line(config: object, team: str) -> bool:
    return (isinstance(config, Mapping) and config.get("offense") == team
            and isinstance(config.get("offense_is_home"), bool)
            and _number(config.get("offense_spread")) and _number(config.get("total_line")))


def side_game(game: Mapping, team: str) -> Mapping:
    """GAME as `team`'s offense sees it (what base_row reads: its home flag, its spread, the total): GAME itself for
    GAME's offense; for its opponent, the track's own config for that side when it has one, else GAME turned around."""
    if team == game["offense"]:
        return game
    by_side = game.get("by_side")
    own = by_side.get(team) if isinstance(by_side, Mapping) else None
    if _has_line(own, team):
        return own
    return {**game, "offense": team, "opponent": game["offense"], "offense_is_home": not game["offense_is_home"],
            "offense_spread": -game["offense_spread"]}


def side_sit(sit: dict, game: Mapping, team: str) -> dict:
    """The situation as `team`'s offense sees it: the score from its side (the engine keeps GAME's offense's)."""
    if team == game["offense"]:
        return sit
    return {**sit, "score_off": sit["score_opp"], "score_opp": sit["score_off"]}

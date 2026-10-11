"""Play-caller models built by scripts/build_callers.py: list them, find who called a team's plays, load one.

models/callers/index.json lists every caller in the sourced table (built, skipped or failed, and why);
models/callers/<slug>/ holds one caller's stage1.joblib, granular.joblib and profile.json, the same three files
the engine loads from models/ today. Nothing here writes. docs/design/play-caller-models.md has the wiring.
"""
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import joblib

from config import MODEL_DIR

CALLERS_DIR = MODEL_DIR / "callers"
INDEX_FILE = "index.json"
BUNDLE_FILES = ("stage1.joblib", "granular.joblib", "profile.json")
SLUG_MAX = 64
SLUG_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
Folder = str | Path | None        # a callers folder; None is models/callers
APOSTROPHES = re.compile(r"['’ʼ`]")


class CallerNotFound(LookupError):
    """No complete model for that slug (or the slug is not one this module would ever write)."""


class ModelVersionError(RuntimeError):
    """The caller's models were built with another scikit-learn: rebuild them before a game, never during one."""


@dataclass(frozen=True)
class CallerModel:
    """One play-caller's models, ready for the engine: what live.GameEngine loads from models/ today."""
    slug: str
    name: str
    profile: dict
    stage1: object
    granular: dict
    path: Path


def slugify(name: str) -> str:
    """'Kevin O'Connell' -> 'kevin-oconnell': ASCII letters and digits joined by single dashes."""
    text = unicodedata.normalize("NFKD", APOSTROPHES.sub("", str(name))).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:SLUG_MAX].rstrip("-")
    if not slug:
        raise ValueError(f"'{str(name)[:40]}' has no letters or digits to make a slug from.")
    return slug


def is_slug(text: object) -> bool:
    return isinstance(text, str) and len(text) <= SLUG_MAX and bool(SLUG_RE.fullmatch(text))


def _folder(callers_dir: Folder) -> Path:
    return Path(callers_dir) if callers_dir is not None else CALLERS_DIR


def read_index(callers_dir: Folder = None) -> dict:
    """index.json as written by scripts/build_callers.py, or an empty index when nothing was built yet."""
    path = _folder(callers_dir) / INDEX_FILE
    if not path.exists():
        return {"callers": []}
    try:
        index = json.loads(path.read_text())
    except ValueError as e:
        raise ValueError(f"{path} is not valid JSON ({e}). Run scripts/build_callers.py again.") from e
    if not isinstance(index, dict) or not isinstance(index.get("callers"), list):
        raise ValueError(f"{path} has no list of callers. Run scripts/build_callers.py again.")
    return index


def list_callers(callers_dir: Folder = None, include_unbuilt: bool = False) -> list[dict]:
    """Index entries, in the index's order (by name). Only callers with a model unless include_unbuilt."""
    return [c for c in read_index(callers_dir)["callers"] if include_unbuilt or c.get("status") == "built"]


def has_model(name: str, callers_dir: Folder = None) -> bool:
    """Whether `name` (as the play-caller table spells it) has a built model: the game picker's has_model hook."""
    return any(c.get("name") == name for c in list_callers(callers_dir))


def find_caller(team: str, season: int, week: int, callers_dir: Folder = None) -> dict | None:
    """The index entry of whoever called `team`'s plays in that week, built or not (its status says), or None."""
    for c in read_index(callers_dir)["callers"]:
        for s in c.get("stints") or ():
            if (s.get("team"), s.get("season")) == (team, season) and \
                    s.get("first_week", week + 1) <= week <= s.get("last_week", week - 1):
                return c
    return None


def load_caller(slug: str, callers_dir: Folder = None, check_version: bool = True) -> CallerModel:
    """One caller's models. CallerNotFound for an unknown or incomplete bundle, ModelVersionError when they were
    built with another scikit-learn (unless check_version=False)."""
    if not is_slug(slug):
        raise CallerNotFound(f"No play-caller model named '{str(slug)[:40]}'.")
    folder = _folder(callers_dir) / slug
    missing = [f for f in BUNDLE_FILES if not (folder / f).is_file()]
    if missing:
        raise CallerNotFound(f"No complete model for '{slug}' in {folder} (missing {', '.join(missing)}). "
                             "Run scripts/build_callers.py.")
    try:
        profile = json.loads((folder / "profile.json").read_text())
    except ValueError as e:
        raise ValueError(f"{folder / 'profile.json'} is not valid JSON ({e}).") from e
    if not isinstance(profile, dict):
        raise ValueError(f"{folder / 'profile.json'} does not hold a profile object.")
    if check_version:
        _check_sklearn(profile, slug)
    return CallerModel(slug=slug, name=str(profile.get("caller") or slug), profile=profile,
                       stage1=joblib.load(folder / "stage1.joblib"), granular=joblib.load(folder / "granular.joblib"),
                       path=folder)


def _check_sklearn(profile: dict, slug: str) -> None:
    import sklearn
    if profile.get("sklearn") != sklearn.__version__:
        raise ModelVersionError(f"The model for '{slug}' was built with scikit-learn {profile.get('sklearn')}; this "
                                f"setup has {sklearn.__version__}. Run scripts/build_callers.py --only {slug} --force.")

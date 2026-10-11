"""callers.py: the runtime side of the per-caller models (slugs, the index, who called a team's plays, loading one).
Bundles here are written by hand, so these tests never need nflverse or a build."""
import json

import joblib
import numpy as np
import pytest
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier

import callers
from callers import CallerNotFound, ModelVersionError, find_caller, list_callers, load_caller, slugify

# ---------------------------------------------------------------- slugs


@pytest.mark.parametrize("name, slug", [
    ("Brian Schottenheimer", "brian-schottenheimer"),
    ("Kevin O'Connell", "kevin-oconnell"),            # an apostrophe joins, it doesn't split
    ("Kevin O’Connell", "kevin-oconnell"),       # the typographic apostrophe too
    ("José Núñez", "jose-nunez"),                     # accents fold to ASCII
    ("  Ken  Dorsey Jr. ", "ken-dorsey-jr"),
    ("Mike McDaniel / Frank Smith", "mike-mcdaniel-frank-smith"),
])
def test_slugify_makes_a_lowercase_ascii_dash_slug(name, slug):
    assert slugify(name) == slug
    assert callers.is_slug(slug)


def test_slugify_refuses_a_name_with_nothing_to_keep():
    with pytest.raises(ValueError, match="letters or digits"):
        slugify(" -- ")


@pytest.mark.parametrize("bad", ["", "Brian", "brian_s", "../models", "brian--s", "-brian", "a" * 65, None, 7])
def test_is_slug_rejects_anything_that_could_leave_the_folder(bad):
    assert not callers.is_slug(bad)


# ---------------------------------------------------------------- bundles

def tiny_model():
    rng = np.random.default_rng(3)
    X = rng.normal(size=(200, 12))
    y = (X[:, 0] + rng.normal(size=200) > 0).astype(int)
    return HistGradientBoostingClassifier(max_iter=5, random_state=7).fit(X, y)


def write_bundle(root, slug, *, sklearn_version=None, skip=()):
    folder = root / slug
    folder.mkdir(parents=True)
    profile = {"caller": "Pat Early", "team": "DAL", "teams": ["DAL"], "seasons": [2024], "n_snaps": 500,
               "alpha": 0.1, "q0": 0.5, "coefs": {"intercept": {"est": 0.2, "lo": 0.0, "hi": 0.4}},
               "sklearn": sklearn_version or sklearn.__version__, "slug": slug}
    granular = {"W_A": np.arange(30.0).reshape(6, 5), "rpo_throw_his": 0.3}
    if "stage1.joblib" not in skip:
        joblib.dump(tiny_model(), folder / "stage1.joblib")
    if "granular.joblib" not in skip:
        joblib.dump(granular, folder / "granular.joblib")
    if "profile.json" not in skip:
        (folder / "profile.json").write_text(json.dumps(profile))
    return profile, granular


def test_load_caller_round_trip(tmp_path):
    profile, granular = write_bundle(tmp_path, "pat-early")
    m = load_caller("pat-early", callers_dir=tmp_path)
    assert (m.slug, m.name, m.path) == ("pat-early", "Pat Early", tmp_path / "pat-early")
    assert m.profile == profile
    assert np.array_equal(m.granular["W_A"], granular["W_A"]) and m.granular["rpo_throw_his"] == 0.3
    X = np.zeros((3, 12))
    assert np.array_equal(m.stage1.predict_proba(X), tiny_model().predict_proba(X))


def test_load_caller_refuses_a_bad_slug_before_touching_the_disk(tmp_path):
    for bad in ("../pat-early", "Pat Early", ""):
        with pytest.raises(CallerNotFound, match="No play-caller model"):
            load_caller(bad, callers_dir=tmp_path)


def test_load_caller_names_a_missing_file(tmp_path):
    write_bundle(tmp_path, "pat-early", skip=("granular.joblib",))
    with pytest.raises(CallerNotFound, match="granular.joblib"):
        load_caller("pat-early", callers_dir=tmp_path)
    with pytest.raises(CallerNotFound, match="nobody"):
        load_caller("nobody", callers_dir=tmp_path)


def test_load_caller_refuses_a_model_built_with_another_scikit_learn(tmp_path):
    write_bundle(tmp_path, "pat-early", sklearn_version="0.0.1")
    with pytest.raises(ModelVersionError, match="0.0.1"):
        load_caller("pat-early", callers_dir=tmp_path)
    assert load_caller("pat-early", callers_dir=tmp_path, check_version=False).name == "Pat Early"


def test_load_caller_refuses_a_profile_that_is_not_an_object(tmp_path):
    write_bundle(tmp_path, "pat-early", skip=("profile.json",))
    (tmp_path / "pat-early" / "profile.json").write_text("[1, 2]")
    with pytest.raises(ValueError, match="profile.json"):
        load_caller("pat-early", callers_dir=tmp_path)


# ---------------------------------------------------------------- the index

ENTRIES = [
    {"name": "Pat Early", "slug": "pat-early", "status": "built", "teams": ["DAL"],
     "stints": [{"season": 2024, "team": "DAL", "first_week": 1, "last_week": 22}]},
    {"name": "Brian Schottenheimer", "slug": "brian-schottenheimer", "status": "built", "teams": ["DAL"],
     "stints": [{"season": 2025, "team": "DAL", "first_week": 1, "last_week": 22},
                {"season": 2026, "team": "DAL", "first_week": 1, "last_week": 22}]},
    {"name": "Sam Mover", "slug": "sam-mover", "status": "built", "teams": ["NYG", "PHI"],
     "stints": [{"season": 2024, "team": "NYG", "first_week": 1, "last_week": 22},
                {"season": 2025, "team": "PHI", "first_week": 1, "last_week": 22}]},
    {"name": "Drew Brief", "slug": "drew-brief", "status": "skipped", "reason": "Only 3 games", "teams": ["WAS"],
     "stints": [{"season": 2026, "team": "WAS", "first_week": 1, "last_week": 3}]},
]


def write_index(root, entries=ENTRIES):
    root.mkdir(parents=True, exist_ok=True)
    (root / "index.json").write_text(json.dumps({"built_at": "2026-10-10T18:00:00", "callers": entries}))


def test_list_callers_without_an_index_is_empty(tmp_path):
    assert list_callers(callers_dir=tmp_path / "none") == []


def test_list_callers_shows_built_callers_unless_asked_for_all(tmp_path):
    write_index(tmp_path)
    assert [c["slug"] for c in list_callers(callers_dir=tmp_path)] == ["pat-early", "brian-schottenheimer",
                                                                       "sam-mover"]
    every = list_callers(callers_dir=tmp_path, include_unbuilt=True)
    assert [c["status"] for c in every] == ["built", "built", "built", "skipped"]


@pytest.mark.parametrize("text", ["[]", "{\"callers\": 3}", "not json"])
def test_a_broken_index_is_an_error_not_an_empty_list(tmp_path, text):
    (tmp_path / "index.json").write_text(text)
    with pytest.raises(ValueError, match="index.json"):
        list_callers(callers_dir=tmp_path)


def test_has_model_is_true_only_for_a_built_caller(tmp_path):
    write_index(tmp_path)
    assert callers.has_model("Sam Mover", callers_dir=tmp_path)
    assert not callers.has_model("Drew Brief", callers_dir=tmp_path)          # skipped: no model
    assert not callers.has_model("Nobody", callers_dir=tmp_path)
    assert not callers.has_model("Sam Mover", callers_dir=tmp_path / "none")  # nothing built yet


@pytest.mark.parametrize("team, season, week, slug", [
    ("DAL", 2024, 9, "pat-early"),
    ("DAL", 2026, 5, "brian-schottenheimer"),
    ("NYG", 2024, 1, "sam-mover"),                     # a caller who moved teams is found on both
    ("PHI", 2025, 22, "sam-mover"),
    ("WAS", 2026, 2, "drew-brief"),                    # found even when skipped: the caller says why
    ("WAS", 2026, 4, None),
    ("PHI", 2024, 3, None),
])
def test_find_caller_answers_who_called_a_teams_plays_that_week(tmp_path, team, season, week, slug):
    write_index(tmp_path)
    hit = find_caller(team, season, week, callers_dir=tmp_path)
    assert (hit and hit["slug"]) == slug


def test_find_caller_skips_a_malformed_stint(tmp_path):
    write_index(tmp_path, [{"name": "X", "slug": "x", "status": "built", "stints": [{"season": 2026, "team": "DAL"}]},
                           *ENTRIES])
    assert find_caller("DAL", 2026, 5, callers_dir=tmp_path)["slug"] == "brian-schottenheimer"

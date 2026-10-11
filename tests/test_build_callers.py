"""scripts/build_callers.py and the generalized build: a model per play-caller from a sourced table.

A small synthetic league (six teams, 2022 to 2026, every snap charted) stands in for nflverse, so the whole pipeline
runs end to end into a temp folder: table, cache, stage 1 shared by callers on one team, stage 2, play types, the
bundles, the index and load_caller. Never touches data/, models/*.joblib or models/profile.json."""
import hashlib
import json
import sys
from datetime import datetime, timedelta

import duckdb
import numpy as np
import polars as pl
import pytest

from helpers import ROOT

sys.path.append(str(ROOT / "scripts"))
import build  # noqa: E402
import build_callers  # noqa: E402
import callers  # noqa: E402
import config  # noqa: E402
from features import BASE_FEATURES, base_row  # noqa: E402
from granular import predict_tree  # noqa: E402

LIVE_MODELS = [ROOT / "models" / n for n in ("stage1.joblib", "granular.joblib", "profile.json")]
OLD_PROFILE_KEYS = ["caller", "seasons", "n_snaps", "n_games", "alpha", "lambda", "q0", "coefs", "cv_logloss",
                    "dropback_rate", "by_down", "team", "stage1_check", "granular", "built_at", "sklearn"]
HEADER = "season,team,first_week,last_week,play_caller,role,source,confidence,note\n"


# ---------------------------------------------------------------- a synthetic league
TEAMS = ["DAL", "NYG", "PHI", "WAS", "KC", "BUF"]
WEEKS = {2022: 8, 2023: 8, 2024: 8, 2025: 8, 2026: 5}
LEAN = {("DAL", 2025): 0.8, ("DAL", 2026): 0.8, ("PHI", 2025): -0.6, ("PHI", 2026): -0.6}   # early-down pass lean
DRIVES, PLAYS = 8, 6


def _sigmoid(z):
    return 1 / (1 + np.exp(-z))


def _offense(rng, game_id, season, week, off, dfn, home, first_id, drive0):
    """One team's snaps in one game: DRIVES drives of PLAYS run/pass snaps, plus a punt row per drive."""
    rows, pid = [], first_id
    spread, total = float(rng.normal(0, 4)), float(44 + rng.normal(0, 3))
    for d in range(DRIVES):
        yl, diff = int(rng.integers(25, 80)), int(rng.integers(-14, 15))
        for k in range(PLAYS):
            down = (1, 2, 3)[k % 3]
            togo = 10 if down == 1 else int(rng.integers(1, 12))
            game_sec = 3600 - 3600 * (d * PLAYS + k) / (DRIVES * PLAYS)
            z = (-0.3 + 1.6 * (down == 3) + 0.07 * (togo - 7) - 0.03 * diff
                 + LEAN.get((off, season), 0.0) * (down <= 2))
            drop = int(rng.random() < _sigmoid(z))
            yards = int(rng.integers(-4, 26) if drop else rng.integers(-3, 13))
            loc = None if drop else str(rng.choice(["left", "middle", "right"]))
            td = int(yards >= yl)
            rows.append({
                "game_id": game_id, "play_id": float(pid), "season": season, "week": week, "posteam": off,
                "defteam": dfn, "home_team": home, "drive": float(drive0 + 2 * d), "down": float(down),
                "ydstogo": float(togo), "yardline_100": float(yl), "score_differential": float(diff),
                "qtr": float(1 + min(3, int((3600 - game_sec) // 900))),
                "half_seconds_remaining": float(game_sec - 1800 if game_sec > 1800 else game_sec),
                "game_seconds_remaining": float(game_sec), "qb_dropback": float(drop), "qb_scramble": 0.0,
                "play_type": "pass" if drop else "run", "yards_gained": float(yards),
                "first_down": float(yards >= togo), "touchdown": float(td), "td_team": off if td else None,
                "sack": float(drop and rng.random() < 0.06), "interception": float(drop and rng.random() < 0.02),
                "fumble_lost": 0.0, "spread_line": round(spread * 2) / 2, "total_line": round(total * 2) / 2,
                "xpass": float(np.clip(_sigmoid(z - LEAN.get((off, season), 0.0) * (down <= 2)
                                                + rng.normal(0, 0.3)), 0.01, 0.99)),
                "epa": float(rng.normal()), "qb_kneel": 0.0, "qb_spike": 0.0, "two_point_attempt": 0.0,
                "run_location": loc,
                "run_gap": None if loc in (None, "middle") else str(rng.choice(["end", "tackle", "guard"])),
                "air_yards": float(rng.integers(-2, 35)) if drop else None})
            pid += 25
            yl = max(1, yl - max(0, yards))
        rows.append({**rows[-1], "play_id": float(pid), "play_type": "punt", "down": 4.0})   # filtered out
        pid += 25
    return rows


def synthetic_pbp(seed=5):
    rng, rows = np.random.default_rng(seed), []
    for season, weeks in WEEKS.items():
        for week in range(1, weeks + 1):
            order = TEAMS[week % 6:] + TEAMS[:week % 6]
            for away, home in [(order[i], order[5 - i]) for i in range(3)]:
                gid = f"{season}_{week:02d}_{away}_{home}"
                rows += _offense(rng, gid, season, week, away, home, home, 40, 1)
                rows += _offense(rng, gid, season, week, home, away, home, 40 + 25 * (PLAYS + 1) * DRIVES + 25, 2)
    df = pl.DataFrame(rows, infer_schema_length=None).with_columns(
        pl.col("season").cast(pl.Int32), pl.col("week").cast(pl.Int32))
    return df.select(build.PBP_COLS)


def synthetic_ftn(pbp, seed=6):
    rng = np.random.default_rng(seed)
    snaps = pbp.filter(pl.col("play_type").is_in(["run", "pass"]))
    drop = snaps["qb_dropback"].to_numpy() == 1
    pa = drop & (rng.random(snaps.height) < 0.25)
    screen = drop & ~pa & (rng.random(snaps.height) < 0.12)
    return pl.DataFrame({
        "nflverse_game_id": snaps["game_id"], "nflverse_play_id": snaps["play_id"].cast(pl.Int32),
        "season": snaps["season"], "week": snaps["week"], "is_rpo": rng.random(snaps.height) < 0.08,
        "is_play_action": pa, "is_screen_pass": screen})


TABLE = HEADER + (
    "2024,DAL,1,22,Pat Early,OC,https://example.test/a,medium,\n"
    "2025,DAL,1,22,Brian Schottenheimer,HC,https://example.test/b,high,\n"
    "2026,DAL,1,22,Brian Schottenheimer,HC,https://example.test/c,high,\n"
    "2024,NYG,1,22,Sam Mover,OC,https://example.test/d,high,\n"
    '2025,PHI,1,22,Sam Mover,OC,https://example.test/e,low,"moved, then called plays"\n'
    "2026,PHI,1,22,Sam Mover,OC,https://example.test/f,medium,\n"
    "2026,WAS,1,3,Drew Brief,OC,https://example.test/g,low,\n"
    "2026,WAS,4,22,Kim Rest,HC,https://example.test/h,medium,\n")


def _digests(paths):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None for p in paths}


@pytest.fixture(scope="module")
def league():
    raw = synthetic_pbp()
    return {"raw": raw, "ftn": synthetic_ftn(raw), "plays": build.prepare_plays(raw)}


@pytest.fixture(scope="module")
def built(tmp_path_factory, league):
    """The whole pipeline once, two workers, into a temp folder. nflverse is replaced by the synthetic league."""
    tmp = tmp_path_factory.mktemp("callers")
    (tmp / "table.csv").write_text(TABLE)
    pulls = []
    mp = pytest.MonkeyPatch()
    mp.setattr(build.nfl, "load_pbp", lambda seasons: pulls.append("pbp") or league["raw"])
    mp.setattr(build.nfl, "load_ftn_charting", lambda seasons: pulls.append("ftn") or league["ftn"])
    args = ["--table", str(tmp / "table.csv"), "--cache", str(tmp / "cache" / "pbp.duckdb"),
            "--out", str(tmp / "callers")]
    before = _digests(LIVE_MODELS)
    code = build_callers.main(args + ["--jobs", "2"])
    after = _digests(LIVE_MODELS)
    yield {"tmp": tmp, "out": tmp / "callers", "args": args, "code": code, "pulls": pulls,
           "live_before": before, "live_after": after}
    mp.undo()


def read_index(out):
    return json.loads((out / "index.json").read_text())


def entry(out, slug):
    return next(c for c in read_index(out)["callers"] if c["slug"] == slug)


def profile(out, slug):
    return json.loads((out / slug / "profile.json").read_text())


# ---------------------------------------------------------------- the generalized build.py

def test_build_with_no_arguments_builds_tonights_caller_into_the_live_folders(monkeypatch):
    seen = []
    fake = {"coefs": {"intercept": {"label": "Overall lean", "est": 0.1, "lo": 0.0, "hi": 0.2}}}
    monkeypatch.setattr(build, "build", lambda *a, **k: seen.append((a, k)) or fake)
    build.main()
    assert seen == [((config.CALLER_NAME, config.CALLERS_CSV, config.MODEL_DIR, config.DB_PATH), {})]


def test_build_fits_any_caller_into_any_folder_and_database(tmp_path, league, monkeypatch):
    monkeypatch.setattr(build.nfl, "load_pbp", lambda seasons: league["raw"])
    monkeypatch.setattr(build.nfl, "load_ftn_charting", lambda seasons: league["ftn"])
    (tmp_path / "t.csv").write_text(TABLE)
    out, db = tmp_path / "out", tmp_path / "db" / "x.duckdb"
    prof = build.build("Sam Mover", tmp_path / "t.csv", out, db, log=lambda msg: None)
    assert sorted(p.name for p in out.iterdir()) == ["granular.joblib", "profile.json", "stage1.joblib"]
    assert json.loads((out / "profile.json").read_text()) == prof
    assert list(prof) == OLD_PROFILE_KEYS
    assert (prof["caller"], prof["team"], prof["n_games"]) == ("Sam Mover", "PHI", 21)
    con = duckdb.connect(str(db), read_only=True)
    try:
        assert {r[0] for r in con.execute("SHOW TABLES").fetchall()} == {"plays", "caller_snaps"}
        assert con.execute("SELECT count(*) FROM caller_snaps").fetchone()[0] == prof["n_snaps"]
    finally:
        con.close()


def test_a_caller_missing_from_the_table_stops_the_build(tmp_path):
    (tmp_path / "t.csv").write_text(TABLE)
    with pytest.raises(SystemExit, match="No rows for Nobody"):
        build.caller_rows(tmp_path / "t.csv", "Nobody")


def test_caller_snaps_keep_only_his_weeks(league):
    rows = pl.DataFrame({"season": [2025, 2026], "team": ["DAL", "DAL"], "first_week": [3, 1],
                         "last_week": [5, 2], "play_caller": ["X", "X"]})
    snaps = build.caller_snaps(league["plays"], rows)
    got = snaps.select("season", "week", "posteam").unique().sort("season", "week").rows()
    assert got == [(2025, 3, "DAL"), (2025, 4, "DAL"), (2025, 5, "DAL"), (2026, 1, "DAL"), (2026, 2, "DAL")]
    assert set(snaps["success"].unique().to_list()) <= {0, 1}


def test_the_league_baseline_never_sees_an_excluded_team(league):
    lg = build.league_rows(league["plays"], ("NYG", "PHI"))
    assert lg.height == league["plays"].filter(~pl.col("posteam").is_in(["NYG", "PHI"])).height > 0
    assert not set(lg["posteam"].unique().to_list()) & {"NYG", "PHI"}


def test_finish_profile_keeps_the_profile_json_key_order():
    stage2 = {k: None for k in OLD_PROFILE_KEYS[:11]}
    out = build.finish_profile(stage2, "DAL", {"n": 1}, {"n_snaps": 1})
    assert list(out) == OLD_PROFILE_KEYS and out["team"] == "DAL" and stage2 == {k: None for k in OLD_PROFILE_KEYS[:11]}


# ---------------------------------------------------------------- the table

def write_table(tmp_path, body, header=HEADER):
    path = tmp_path / "t.csv"
    path.write_text(header + body)
    return path


def test_default_table_prefers_the_2024_2026_research(tmp_path):
    (tmp_path / "play_callers.csv").write_text(HEADER)
    assert build_callers.default_table(tmp_path) == tmp_path / "play_callers.csv"
    (tmp_path / "play_callers_2024_2026.csv").write_text(HEADER)
    assert build_callers.default_table(tmp_path) == tmp_path / "play_callers_2024_2026.csv"


def test_a_valid_table_reads_into_stints(tmp_path):
    stints = build_callers.read_table(write_table(tmp_path, TABLE[len(HEADER):]))
    assert len(stints) == 8
    s = stints[4]
    assert (s.line, s.season, s.team, s.first_week, s.last_week, s.caller, s.role, s.confidence, s.note) == \
        (6, 2025, "PHI", 1, 22, "Sam Mover", "OC", "low", "moved, then called plays")


def test_the_short_table_without_confidence_or_note_still_reads(tmp_path):
    path = write_table(tmp_path, "2025,DAL,1,22,Brian Schottenheimer,HC,https://x.test\n",
                       header="season,team,first_week,last_week,play_caller,role,source\n")
    (s,) = build_callers.read_table(path)
    assert (s.caller, s.confidence, s.note) == ("Brian Schottenheimer", "", "")
    assert s.as_dict()["confidence"] is None and build_callers.weakest([s.confidence]) is None


def test_table_validation_lists_every_problem_with_its_line(tmp_path):
    body = ("2025,DALL,1,22,A One,HC,s\n"           # line 2: unknown team
            "2025,LAR,1,22,B Two,HC,s\n"            # line 3: an alias, with a hint
            "2025,NYG,0,22,C Three,HC,s\n"          # line 4: week 0
            "2025,PHI,9,4,D Four,HC,s\n"            # line 5: first after last
            "2017,KC,1,22,E Five,HC,s\n"            # line 6: before the data
            "twenty,KC,1,22,F Six,HC,s\n"           # line 7: not a number
            "2025,BUF,1,22,,HC,s\n"                 # line 8: no caller
            "2025,MIA,1,10,G Seven,HC,s\n"
            "2025,MIA,8,22,H Eight,OC,s\n"          # line 10: overlaps line 9 in weeks 8 to 10
            "2025,SEA,1,6,I Nine,HC,s\n"
            "2025,SEA,9,22,J Ten,OC,s\n"            # line 12: weeks 7 to 8 have nobody
            "2025,DEN,3,22,K Eleven,HC,s\n"         # line 13: weeks 1 to 2 have nobody
            "2025,TEN,1,22,L Twelve,HC,s,high,a,b\n")  # line 14: an unquoted comma
    with pytest.raises(build_callers.TableError) as e:
        build_callers.read_table(write_table(tmp_path, body))
    text = "\n".join(e.value.problems)
    for want in ("line 2: team 'DALL'", "line 3: team 'LAR'", "did you mean LA", "line 4: weeks 0 to 22",
                 "line 5: weeks 9 to 4", "line 6: season 2017", "line 7: season 'twenty'",
                 "line 8: no play_caller", "MIA 2025: lines 9 and 10 overlap in weeks 8 to 10",
                 "SEA 2025: nobody calls weeks 7 to 8", "DEN 2025: nobody calls weeks 1 to 2",
                 "line 14: more values than columns"):
        assert want in text, (want, text)
    assert len(e.value.problems) == 11


def test_missing_columns_are_named(tmp_path):
    path = write_table(tmp_path, "2025,DAL,1,22,X\n", header="season,team,first_week,last_week,play_caller\n")
    with pytest.raises(build_callers.TableError, match="missing column.*role.*source"):
        build_callers.read_table(path)


def test_two_spellings_of_one_slug_are_refused(tmp_path):
    body = "2025,MIN,1,22,Kevin O'Connell,HC,s\n2024,MIN,1,22,Kevin OConnell,HC,s\n"
    with pytest.raises(build_callers.TableError, match="kevin-oconnell"):
        build_callers.read_table(write_table(tmp_path, body))


def test_a_caller_with_too_few_games_is_screened_out_with_the_reason(league):
    charted = build_granular_label(league)
    one = build_callers.Caller("One Game", "one-game",
                               (build_callers.Stint(2, 2026, "WAS", 1, 1, "One Game", "HC", "s"),))
    scr = build_callers.screen(one, league["plays"], charted)
    assert (scr.snaps, scr.games, scr.charted) == (DRIVES * PLAYS, 1, DRIVES * PLAYS)
    assert scr.reason.startswith("Only 1 game (48 snaps) in the data")
    ok = build_callers.Caller("Pat Early", "pat-early",
                              (build_callers.Stint(2, 2024, "DAL", 1, 22, "Pat Early", "OC", "s"),))
    assert build_callers.screen(ok, league["plays"], charted).reason is None


def build_granular_label(league):
    import build_granular
    return build_granular.label(league["plays"], league["ftn"])


def test_callers_on_one_team_share_one_stage1_group(tmp_path):
    stints = build_callers.read_table(write_table(tmp_path, TABLE[len(HEADER):]))
    groups = build_callers.exclusion_groups(build_callers.group_callers(stints))
    assert {k: [c.name for c in v] for k, v in groups.items()} == {
        ("DAL",): ["Brian Schottenheimer", "Pat Early"], ("NYG", "PHI"): ["Sam Mover"],
        ("WAS",): ["Drew Brief", "Kim Rest"]}
    sam = next(c for c in build_callers.group_callers(stints) if c.slug == "sam-mover")
    assert (sam.teams, sam.seasons, sam.role, sam.confidence, sam.latest.team) == \
        (("NYG", "PHI"), (2024, 2025, 2026), "OC", "low", "PHI")


# ---------------------------------------------------------------- guards

@pytest.mark.parametrize("flag, value", [("--cache", ROOT / "data" / "shadow.duckdb"),
                                         ("--cache", ROOT / "data" / "x" / "pbp.duckdb"),
                                         ("--out", ROOT / "models"), ("--out", ROOT / "data" / "callers"),
                                         ("--out", ROOT), ("--out", ROOT.parent)])
def test_refuses_sams_database_and_the_live_models_folder(tmp_path, capsys, monkeypatch, flag, value):
    monkeypatch.setattr(build.nfl, "load_pbp", lambda seasons: pytest.fail("must not pull"))
    path = write_table(tmp_path, TABLE[len(HEADER):])
    args = {"--table": str(path), "--cache": str(tmp_path / "c.duckdb"), "--out": str(tmp_path / "o"),
            flag: str(value)}
    assert build_callers.main([x for kv in args.items() for x in kv]) == 2
    assert "Refusing" in capsys.readouterr().err


def test_an_invalid_table_builds_nothing(tmp_path, capsys):
    path = write_table(tmp_path, "2025,DALL,1,22,A One,HC,s\n")
    assert build_callers.main(["--table", str(path), "--cache", str(tmp_path / "c.duckdb"),
                               "--out", str(tmp_path / "o")]) == 2
    assert "DALL" in capsys.readouterr().err and not (tmp_path / "o").exists() and not (tmp_path / "c.duckdb").exists()


@pytest.mark.parametrize("flag", [["--jobs", "0"], ["--jobs", "two"], ["--threads", "-1"], ["--jobs", "٣"]])
def test_jobs_and_threads_must_be_whole_numbers(flag, capsys):
    with pytest.raises(SystemExit) as e:
        build_callers.parse_args(flag)
    assert e.value.code == 2 and "whole number" in capsys.readouterr().err


@pytest.mark.parametrize("values, want", [(["high", "low", "medium"], "low"), (["High", "medium"], "medium"),
                                          (["HIGH", "High"], "high"), (["", ""], None), (["high", "0.8"], "0.8")])
def test_his_confidence_is_his_least_sure_stint(values, want):
    assert build_callers.weakest(values) == want


def test_a_cache_is_reused_for_a_day_then_pulled_again():
    now, req = datetime.now(), build_callers._request()
    fresh = {"pulled_at": now.isoformat(timespec="seconds"), "request": req}
    assert build_callers._fresh(fresh)
    assert not build_callers._fresh({**fresh, "pulled_at": (now - timedelta(hours=25)).isoformat()})
    assert not build_callers._fresh({**fresh, "request": {"seasons": [2024], "ftn_seasons": [2024]}})
    for broken in (None, {"request": req}, {**fresh, "pulled_at": "yesterday"}):
        assert not build_callers._fresh(broken)


def test_a_failed_bundle_write_keeps_the_old_bundle_and_leaves_no_temp_folder(tmp_path, monkeypatch):
    build_callers.write_bundle(tmp_path, "pat-early", {"m": 1}, {"g": 1}, {"caller": "Pat Early", "v": 1})
    build_callers.write_bundle(tmp_path, "pat-early", {"m": 2}, {"g": 2}, {"caller": "Pat Early", "v": 2})
    assert json.loads((tmp_path / "pat-early" / "profile.json").read_text())["v"] == 2

    def disk_full(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(build_callers.joblib, "dump", disk_full)
    with pytest.raises(OSError, match="disk full"):
        build_callers.write_bundle(tmp_path, "pat-early", {"m": 3}, {"g": 3}, {"caller": "Pat Early", "v": 3})
    assert sorted(p.name for p in tmp_path.iterdir()) == ["pat-early"]
    assert json.loads((tmp_path / "pat-early" / "profile.json").read_text())["v"] == 2


def test_a_folder_that_is_not_a_bundle_is_never_replaced(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "live_state.json").write_text("{}")
    with pytest.raises(ValueError, match="not a caller bundle"):
        build_callers.write_bundle(tmp_path, "data", {"m": 1}, {"g": 1}, {"caller": "Data"})
    assert sorted(p.name for p in tmp_path.iterdir()) == ["data"]
    assert (tmp_path / "data" / "live_state.json").read_text() == "{}"
    (tmp_path / "pat-early").mkdir()
    (tmp_path / "pat-early" / ".DS_Store").write_text("")                    # Finder's file is fine
    build_callers.write_bundle(tmp_path, "pat-early", {"m": 1}, {"g": 1}, {"caller": "Pat Early"})
    assert sorted(p.name for p in (tmp_path / "pat-early").iterdir()) == sorted(build_callers.BUNDLE_FILES)


def test_only_matches_any_spelling_of_the_name(tmp_path):
    stints = build_callers.read_table(write_table(tmp_path, TABLE[len(HEADER):]))
    callers_ = build_callers.group_callers(stints)
    assert build_callers.select(callers_, ["  brian  SCHOTTENHEIMER "]) == {"brian-schottenheimer"}
    assert build_callers.select(callers_, ["sam-mover", "Pat Early"]) == {"sam-mover", "pat-early"}


def test_only_must_name_a_caller_in_the_table(tmp_path, capsys):
    path = write_table(tmp_path, TABLE[len(HEADER):])
    assert build_callers.main(["--table", str(path), "--only", "Nobody Here", "--cache", str(tmp_path / "c.duckdb"),
                               "--out", str(tmp_path / "o")]) == 2
    assert "Nobody Here" in capsys.readouterr().err


# ---------------------------------------------------------------- end to end

def test_the_whole_table_builds_and_pulls_nflverse_once(built):
    assert built["code"] == 0
    assert built["pulls"] == ["pbp", "ftn"]
    assert built["live_after"] == built["live_before"]


def test_every_buildable_caller_gets_a_bundle(built):
    for slug in ("brian-schottenheimer", "pat-early", "sam-mover"):
        assert sorted(p.name for p in (built["out"] / slug).iterdir()) == ["granular.joblib", "profile.json",
                                                                           "stage1.joblib"]
    assert not (built["out"] / "drew-brief").exists() and not (built["out"] / "kim-rest").exists()
    assert not [p for p in built["out"].iterdir() if p.name.startswith(".")]          # no temp folders left


def test_the_profile_keeps_the_live_schema_and_adds_his_teams(built, league):
    p = profile(built["out"], "sam-mover")
    assert list(p)[:len(OLD_PROFILE_KEYS)] == OLD_PROFILE_KEYS
    assert (p["caller"], p["team"], p["teams"]) == ("Sam Mover", "PHI", ["NYG", "PHI"])
    assert p["seasons"] == [2024, 2025, 2026]
    assert p["n_games"] == 21 and p["n_snaps"] == 21 * DRIVES * PLAYS
    assert [s["team"] for s in p["stints"]] == ["NYG", "PHI", "PHI"]
    cv = p["cv_logloss"]
    assert 0 < cv["habits_plus_memory"] < 1 and 0 < cv["league_baseline"] < 1
    assert p["granular"]["cv"]["specific_play"]["n"] > 0
    assert p["data"]["source"] == "nflverse" and p["build"]["fingerprint"]


def test_his_own_snaps_never_train_his_baseline(built, league):
    plays = league["plays"]
    for slug, teams in (("brian-schottenheimer", ["DAL"]), ("pat-early", ["DAL"]), ("sam-mover", ["NYG", "PHI"])):
        base = profile(built["out"], slug)["baseline"]
        assert base["excluded_teams"] == teams
        assert base["n_train"] == plays.filter(~pl.col("posteam").is_in(teams)).height


def test_callers_on_one_team_share_one_stage1_fit(built, league):
    X = league["plays"].select(BASE_FEATURES).to_numpy()[:400]
    p = {s: callers.load_caller(s, callers_dir=built["out"]).stage1.predict_proba(X)[:, 1]
         for s in ("brian-schottenheimer", "pat-early", "sam-mover")}
    assert np.array_equal(p["brian-schottenheimer"], p["pat-early"])
    assert not np.array_equal(p["brian-schottenheimer"], p["sam-mover"])
    shared = {s: profile(built["out"], s)["build"]["seconds"]["shared_by"] for s in p}
    assert shared == {"brian-schottenheimer": 2, "pat-early": 2, "sam-mover": 1}


def test_the_index_lists_every_caller_built_or_not(built):
    idx = read_index(built["out"])
    assert [c["name"] for c in idx["callers"]] == ["Brian Schottenheimer", "Drew Brief", "Kim Rest", "Pat Early",
                                                   "Sam Mover"]
    assert idx["counts"] == {"built": 3, "skipped": 2, "failed": 0, "not built": 0}
    sam = entry(built["out"], "sam-mover")
    assert {k: sam[k] for k in ("status", "teams", "seasons", "role", "confidence", "snaps", "games",
                                "up_to_date")} == {
        "status": "built", "teams": ["NYG", "PHI"], "seasons": [2024, 2025, 2026], "role": "OC",
        "confidence": "low", "snaps": 21 * DRIVES * PLAYS, "games": 21, "up_to_date": True}
    assert set(sam["logloss"]) == {"league", "his"} and sam["built_at"] and sam["seconds"]["own"] > 0
    drew = entry(built["out"], "drew-brief")
    assert drew["status"] == "skipped" and drew["games"] == 3 and "3 games" in drew["reason"]
    assert "logloss" not in drew


def test_load_caller_round_trip_predicts_like_the_engine(built):
    m = callers.load_caller("brian-schottenheimer", callers_dir=built["out"])
    assert m.profile == profile(built["out"], "brian-schottenheimer") and m.name == "Brian Schottenheimer"
    sit = {"down": 1, "togo": 10, "yardline_100": 75, "qtr": 1, "clock": 900, "score_off": 0, "score_opp": 0}
    game = {"offense_is_home": True, "offense_spread": 3.0, "total_line": 45.0}
    p0 = m.stage1.predict_proba(np.array([base_row(sit, game)]))[0, 1]
    (lf, ll), (hf, hl) = predict_tree(m.granular, sit, game)
    assert 0 < p0 < 1 and abs(sum(hl.values()) - 1) < 1e-9 and abs(sum(lf.values()) - 1) < 1e-9
    assert [c["slug"] for c in callers.list_callers(callers_dir=built["out"])] == [
        "brian-schottenheimer", "pat-early", "sam-mover"]
    assert callers.find_caller("PHI", 2026, 3, callers_dir=built["out"])["slug"] == "sam-mover"


def test_a_rerun_skips_current_bundles_and_force_rebuilds_only_the_named_caller(built, capsys):
    stamp = {s: (built["out"] / s / "profile.json").stat().st_mtime_ns
             for s in ("brian-schottenheimer", "pat-early", "sam-mover")}
    assert build_callers.main(built["args"] + ["--jobs", "1"]) == 0
    assert "3 up to date" in capsys.readouterr().out
    assert {s: (built["out"] / s / "profile.json").stat().st_mtime_ns for s in stamp} == stamp
    assert build_callers.main(built["args"] + ["--jobs", "1", "--only", "Pat Early", "--force"]) == 0
    now = {s: (built["out"] / s / "profile.json").stat().st_mtime_ns for s in stamp}
    assert now["pat-early"] != stamp["pat-early"]
    assert {s: v for s, v in now.items() if s != "pat-early"} == {s: v for s, v in stamp.items() if s != "pat-early"}
    assert len(read_index(built["out"])["callers"]) == 5
    assert built["pulls"] == ["pbp", "ftn"]                                   # the cache was reused both times


def test_a_bundle_with_an_unreadable_profile_is_rebuilt_not_a_crash(built):
    folder = built["out"] / "sam-mover"
    good = (folder / "profile.json").read_text()
    (folder / "profile.json").write_text(json.dumps({"caller": "Sam Mover", "build": {}}))
    try:
        assert build_callers.bundle_profile(built["out"], "sam-mover") is None
        callers_ = build_callers.group_callers(build_callers.read_table(built["tmp"] / "table.csv"))
        sam = next(c for c in callers_ if c.slug == "sam-mover")
        scr = build_callers.Screen(1008, 21, 1008, None)
        e = build_callers.index_entry(sam, scr, None, "fp", None)
        assert e["status"] == "not built"
    finally:
        (folder / "profile.json").write_text(good)


def test_refresh_pulls_again_even_when_the_cache_is_fresh(built, monkeypatch):
    calls = []
    monkeypatch.setattr(build_callers, "pull_cache", lambda path, log=None: calls.append(path) or {"pulled_at": "x"})
    cache = built["tmp"] / "cache" / "pbp.duckdb"
    assert build_callers.ensure_cache(cache)["source"] == "nflverse" and calls == []
    assert build_callers.ensure_cache(cache, refresh=True) == {"pulled_at": "x"} and calls == [cache]

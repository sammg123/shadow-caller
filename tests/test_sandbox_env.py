"""Env overrides that let tests and demos run the app on a copy of the data, never the live game."""
import json
import os
import shutil
import subprocess
import sys

from helpers import ESPN_EVENT, ESPN_FILE, ROOT


def run_py(code, env_extra):
    env = {**os.environ, **env_extra}
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()


def test_data_dir_and_port_come_from_the_environment(tmp_path):
    got = run_py("import config; print(config.DATA_DIR); print(config.STATE_PATH); print(config.PORT)",
                 {"SHADOW_DATA_DIR": str(tmp_path), "SHADOW_PORT": "5099"})
    assert got.splitlines() == [str(tmp_path), str(tmp_path / "live_state.json"), "5099"]


def test_defaults_point_at_the_real_data_dir():
    env = {k: "" for k in ("SHADOW_DATA_DIR", "SHADOW_PORT")}
    got = run_py("import config; print(config.DATA_DIR); print(config.PORT)", env)
    assert got.splitlines() == [str(ROOT / "data"), "5050"]


def test_offline_mode_reads_the_saved_espn_game(tmp_path):
    (tmp_path / "espn").mkdir()
    shutil.copy(ESPN_FILE, tmp_path / "espn" / ESPN_FILE.name)
    got = run_py(f"import espn_feed; s = espn_feed.fetch_summary('{ESPN_EVENT}'); "
                 "print(len(s['drives']['previous']))",
                 {"SHADOW_DATA_DIR": str(tmp_path), "SHADOW_ESPN_OFFLINE": "1"})
    assert got == "21"


def test_offline_mode_without_a_saved_game_says_so(tmp_path):
    code = ("import espn_feed\ntry:\n    espn_feed.fetch_summary('123')\nexcept FileNotFoundError as e:\n"
            "    print('missing', e)")
    got = run_py(code, {"SHADOW_DATA_DIR": str(tmp_path), "SHADOW_ESPN_OFFLINE": "1"})
    assert got.startswith("missing") and "summary_123_final.json" in got


def test_sandbox_script_never_uses_the_real_data_dir(tmp_path):
    got = subprocess.run([sys.executable, "scripts/sandbox.py", "--data", str(tmp_path), "--dry-run"], cwd=ROOT,
                         capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    info = json.loads(got.stdout)
    assert info["data_dir"] == str(tmp_path) and info["data_dir"] != str(ROOT / "data")
    assert (tmp_path / "espn" / ESPN_FILE.name).exists() and (tmp_path / "play_callers.csv").exists()


def test_sandbox_script_refuses_the_real_data_dir():
    got = subprocess.run([sys.executable, "scripts/sandbox.py", "--data", str(ROOT / "data"), "--dry-run"], cwd=ROOT,
                         capture_output=True, text=True, timeout=60)
    assert got.returncode != 0 and "real data" in got.stderr

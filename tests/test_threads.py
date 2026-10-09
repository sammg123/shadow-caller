"""The engine predicts one row at a time: a thread pool only adds overhead (measured 852 ms vs 4 ms per
prediction under load on a 14-core Mac). Pin OpenMP/BLAS to one thread unless the user overrides it."""
import os
import subprocess
import sys

from helpers import ROOT

CHECK = ("import os, live\n"
         "from threadpoolctl import threadpool_info\n"
         "e = live.GameEngine.__new__(live.GameEngine)\n"
         "import joblib; m = joblib.load(live.MODEL_DIR / 'stage1.joblib')\n"
         "import numpy as np; m.predict_proba(np.zeros((1, m.n_features_in_)))\n"
         "omp = [i['num_threads'] for i in threadpool_info() if i['user_api'] == 'openmp']\n"
         "print(os.environ['OMP_NUM_THREADS'], omp)")


def run(env_extra):
    env = {k: v for k, v in os.environ.items() if not k.endswith("_NUM_THREADS")}
    env.update(env_extra)
    out = subprocess.run([sys.executable, "-c", CHECK], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()


def test_engine_pins_openmp_to_one_thread():
    assert run({}) == "1 [1]"


def test_user_override_wins():
    assert run({"OMP_NUM_THREADS": "3"}) == "3 [3]"

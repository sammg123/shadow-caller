"""Pin native thread pools to one thread. Import this before numpy, scipy or scikit-learn.

The engine predicts one row at a time, so a thread pool only adds overhead: on a 14-core Mac under load a
prediction took 852 ms (2.6 s of CPU) with the default OpenMP pool and 4 ms with one thread, and idle
OpenMP workers spin on the CPU between calls. Set OMP_NUM_THREADS yourself to override.
"""
import os

for _var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(_var, "1")

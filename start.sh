#!/bin/bash
# One-command launcher for macOS/Linux: sets up a virtual env the first time, then opens the app.
set -e
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  PY=""
  # 3.12 first: requirements.lock was made with it, and its numpy and scipy need 3.12 or newer.
  for c in python3.12 python3.13 python3.14 python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)'; then
      PY="$c"; break
    fi
  done
  if [ -z "$PY" ]; then
    echo "Needs Python 3.12 or newer. Install it with:  brew install python@3.12   then run ./start.sh again."
    exit 1
  fi
  echo "Setting up with $($PY --version)..."
  "$PY" -m venv .venv
  .venv/bin/python -m pip install -q --upgrade pip
  # The exact versions the models were built with, each checked against its hash (requirements.lock).
  .venv/bin/python -m pip install -q --require-hashes -r requirements.lock
fi

exec .venv/bin/python app.py

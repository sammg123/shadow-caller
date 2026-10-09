"""Browser tests against a sandboxed copy of the app (never the live game). Run: pytest tests/e2e -m e2e"""
import subprocess
import sys
import time
from pathlib import Path

import pytest

from e2e_helpers import ROOT, _free_port, _get


@pytest.fixture(scope="session")
def server(tmp_path_factory):
    port = _free_port()
    data = tmp_path_factory.mktemp("sandbox")
    proc = subprocess.Popen([sys.executable, "scripts/sandbox.py", "--port", str(port), "--data", str(data)],
                            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            _get(base + "/api/version")
            break
        except Exception:
            if proc.poll() is not None:
                raise RuntimeError("sandbox server exited:\n" + proc.stdout.read())
            time.sleep(0.25)
    else:
        proc.kill()
        raise RuntimeError("sandbox server did not start")
    yield {"base": base, "data": data, "port": port}
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.fixture(scope="session")
def browser():
    pw = pytest.importorskip("playwright.sync_api")
    with pw.sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        yield b
        b.close()


@pytest.fixture
def page(browser, server):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(f"pageerror: {e}"))
    pg.on("console", lambda m: pg.errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    yield pg
    ctx.close()

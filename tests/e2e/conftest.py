"""Browser tests against a sandboxed copy of the app (never the live game). Run: pytest tests/e2e -m e2e
The `server` fixture lives in tests/conftest.py, shared with the API tests."""
import os

import pytest


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


# ---------------------------------------------------------------- A11 additions (ui-architecture.md 7.2), additive only
WATCH_SCALE = "0.05"      # DC E3: every Watch delay times this; the whole game takes about 11 s at 4x
# The models' OpenMP pool spins its threads after every prediction (about 2.5 cores per busy sandbox); one thread
# gives the same predictions and leaves the machine to the browser. Applies to this fixture's sandbox only.
QUIET_THREADS = {"OMP_NUM_THREADS": "1", "KMP_BLOCKTIME": "0"}
for _name, _value in QUIET_THREADS.items():      # the shared `server` sandbox inherits this process's environment
    os.environ.setdefault(_name, _value)


def _collect_errors(pg):
    """page.errors: uncaught exceptions and console errors; page.bad_responses: every 4xx/5xx answer with its URL (a
    console 404 alone doesn't say which file is missing)."""
    pg.errors = []
    pg.bad_responses = []
    pg.on("pageerror", lambda e: pg.errors.append(f"pageerror: {e}"))
    pg.on("console", lambda m: pg.errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    pg.on("response", lambda r: pg.bad_responses.append(f"{r.status} {r.request.method} {r.url}")
          if r.status >= 400 else None)
    return pg


@pytest.fixture
def ui_pages(browser):
    """Factory for pages on their own context: 1440x900 and reduced motion by default, so every draw is instant
    (ui-architecture 7.2); reduced_motion=False for the motion tests. Page and console errors land in page.errors."""
    from ui_helpers import ACTION_TIMEOUT_MS, TOAST_LOG_JS
    contexts = []

    def make(width=1440, height=900, reduced_motion=True, context=None):
        ctx = context
        if ctx is None:
            ctx = browser.new_context(viewport={"width": width, "height": height}, accept_downloads=True,
                                      reduced_motion="reduce" if reduced_motion else "no-preference")
            ctx.set_default_timeout(ACTION_TIMEOUT_MS)
            ctx.add_init_script(script=TOAST_LOG_JS)    # every toast is seen, even on a busy machine
            contexts.append(ctx)
        return _collect_errors(ctx.new_page())

    yield make
    for ctx in contexts:
        ctx.close()


@pytest.fixture
def upage(ui_pages):
    """The default checklist page: 1440x900, reduced motion."""
    return ui_pages()


@pytest.fixture
def upage_motion(ui_pages):
    """A page with motion on (animations play; tests wait on data-anim-state)."""
    return ui_pages(reduced_motion=False)


@pytest.fixture(scope="session")
def watch_server(tmp_path_factory):
    """A second sandbox with SHADOW_WATCH_SCALE small (DC E3, Appendix B #6), so a watched game plays in seconds."""
    from ui_helpers import sandbox
    with sandbox(tmp_path_factory, {"SHADOW_WATCH_SCALE": WATCH_SCALE, **QUIET_THREADS}) as srv:
        yield srv

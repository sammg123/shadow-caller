"""Helpers for the UI regression suite (package A11; ui-architecture.md sections 5 and 7.2, feature-inventory.md 6.1).

Every test sets its own server state first (FI 6.1) and then loads the page on `WORLD` (`?world=`): neutral by
default; `SC_E2E_WORLD=under-the-lights` runs the same checklist on Sam's world (v1.4, W6). On load the page opens its
game once (restructure-v2.md 9: POST /api/open): a watch session or the live feed already on is left as it is, else a
finished game opens paused at kickoff, so a test that wants another moment of the saved game seeks there first
(seek_game, game_at_end).
Model-dependent numbers are read from GET /api/state and formatted here exactly like model/format.js does, never
hard-coded. Selectors come only from the contract in ui-architecture.md section 5."""
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import urlsplit

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import expect

from helpers import EVENT, ROOT, _free_port  # noqa: F401  (tests/helpers.py: the saved TB at DAL game)

WORLD = os.environ.get("SC_E2E_WORLD", "neutral")      # v1.4 (W6): the world every UI test loads
# restructure-v2.md 4: each world's two views (id, label) in V order, the first being the default (the neutral world's
# index.js and theme/worlds/under-the-lights/look.js).
WORLD_CAMERAS = {"neutral": [("wide", "Wide"), ("blimp", "Blimp")],
                 "under-the-lights": [("wide", "Wide"), ("blimp", "Blimp")]}
CAMERAS = WORLD_CAMERAS[WORLD]
SHOW_WAIT_MS = 500              # how long a target may take to appear on screen
BOOT_TIMEOUT_MS = 60_000        # three.js in SwiftShader, and a server busy with a replay: room, once per test
ACTION_TIMEOUT_MS = 10_000      # clicks and fills on an element that never shows fail, in time for a busy machine
EXPECT_TIMEOUT_MS = 10_000      # 1 s poll + presentation gating (at most 4 s, decision 2), with room on a busy machine
QUIET_MS = 700                  # a "sends nothing" check waits this long for a request that must never come
REPLAY_TIMEOUT_S = 90
FEED_GAME_S = 180               # the offline feed applies the whole game in one poll: about 9 s idle, minutes when busy
SESSION_STATES = ("playing", "paused", "done", "error")
TOTAL_ROWS = 183                # DC B1: TB@DAL fully applied

expect.set_options(timeout=EXPECT_TIMEOUT_MS)


# ---------------------------------------------------------------- HTTP against a sandboxed server
def call(base, path, body=None, method=None, timeout=REPLAY_TIMEOUT_S):
    """(status, parsed body) of a GET (body None) or a JSON POST, 4xx and 5xx answers included."""
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method or ("GET" if body is None else "POST"),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def api_get(base, path):
    status, body = call(base, path)
    assert status == 200, f"GET {path} answered {status}: {body}"
    return body


def api_post(base, path, body=None):
    status, out = call(base, path, {} if body is None else body)
    assert status == 200, f"POST {path} {body} answered {status}: {out.get('error')}"
    return out


def state(base):
    return api_get(base, "/api/state")


def version(base):
    return api_get(base, "/api/version")


def full_timeline(base):
    return api_get(base, "/api/timeline?since=0")


# ---------------------------------------------------------------- server preconditions (FI 6.1)
def stop_watch(base):
    """End any Watch session and put the game it backed up back (DC E2.6); /api/reset refuses during one."""
    if api_get(base, "/api/watch")["state"] in SESSION_STATES:
        api_post(base, "/api/watch/stop", {"restore": True})


def feed_off(base):
    api_post(base, "/api/feed", {"on": False})


def reset_game(base):
    """Fresh: no watch, feed off, reset. Q1 15:00, 0-0, 1st & 10, ball on DAL 25, no drive."""
    stop_watch(base)
    feed_off(base)
    api_post(base, "/api/reset")


_FINISHED = {}


def ensure_finished(base):
    """Finished game (FI 6.1): feed off, then the saved game replayed. 59 log rows, DAL 16 TB 24, Q4 0:00, no drive.
    A replay takes several seconds, so it is skipped when nothing was saved since this helper's last replay (same
    epoch and version, feed off, no watch): the engine state is then the same byte for byte."""
    v = version(base)
    mark = (v["epoch"], v["version"])
    if _FINISHED.get(base) == mark and not v["feed"]["on"] and v["watch"]["state"] not in SESSION_STATES:
        return
    stop_watch(base)
    feed_off(base)
    api_post(base, "/api/feed/replay", {"event_id": EVENT})
    v = version(base)
    _FINISHED[base] = (v["epoch"], v["version"])


def seek_game(base, idx):
    """The saved game paused with its first `idx` plays applied, in a watch session (POST /api/watch/seek), so the
    page's open on load leaves it there."""
    feed_off(base)
    return api_post(base, "/api/watch/seek", {"idx": idx})


def game_at_end(base):
    """The saved final game at its end, in a watch session (Go Live on a finished game jumps to its end)."""
    feed_off(base)
    return api_post(base, "/api/golive")


def watch_paused_at(base, idx, tries=3):
    """A watch of the saved game, paused with exactly `idx` plays applied one by one (step is exact, DC E2), and its
    /api/state. The slowest speed leaves the first play's wait between start and pause; should a busy server apply
    plays past `idx` first, it starts over. (seek_game gets there too, rebuilt at once.)"""
    for _ in range(tries):
        stop_watch(base)
        feed_off(base)
        api_post(base, "/api/watch/start", {"event_id": EVENT, "speed": 0.5, "from_seq": 0})
        api_post(base, "/api/watch/pause")
        while api_get(base, "/api/watch")["idx"] < idx:
            api_post(base, "/api/watch/step")
        if api_get(base, "/api/watch")["idx"] == idx:
            return state(base)
    raise AssertionError(f"couldn't pause the watch at play {idx}: {api_get(base, '/api/watch')}")


def wait_server(base, check, timeout_s=30, what="the server state"):
    """Poll the server until check(version body) is true."""
    end = time.monotonic() + timeout_s
    while time.monotonic() < end:
        v = version(base)
        if check(v):
            return v
        time.sleep(0.2)
    raise AssertionError(f"timed out waiting for {what}: {version(base)}")


def feed_on_server(base):
    """Feed on (FI 6.1): fresh, then the feed on for the saved game; the offline poller applies the whole game."""
    reset_game(base)
    api_post(base, "/api/feed", {"on": True, "event_id": EVENT})
    wait_server(base, lambda v: v["timeline_n"] == TOTAL_ROWS and v["feed"]["state"] == "live", FEED_GAME_S,
                "the feed to apply the whole game")


# ---------------------------------------------------------------- loading the page
def app_url(base, query=""):
    return f"{base}/?world={WORLD}" + (f"&{query}" if query else "")


def wait_ready(page):
    """The boot finished: the first state is loaded and the page has opened its game (#app[data-boot="ready"], written
    by the conductor once POST /api/open answered), and the loading screen is gone (it hides on the next frame)."""
    page.wait_for_selector('#app[data-boot="ready"]', state="attached", timeout=BOOT_TIMEOUT_MS)
    page.wait_for_selector('[data-testid="boot"]', state="hidden", timeout=BOOT_TIMEOUT_MS)


def load(page, base, query="", ready=True):
    page.goto(app_url(base, query), wait_until="domcontentloaded", timeout=BOOT_TIMEOUT_MS)
    if ready:
        wait_ready(page)


def fresh(page, base, query=""):
    """A first visit: no session, the feed off, the game reset; the page then opens the saved game at kickoff."""
    reset_game(base)
    load(page, base, query)


def finished(page, base, query=""):
    """The saved game at its final whistle on the page (game_at_end), every row drawn."""
    game_at_end(base)
    load(page, base, query)


def wait_idle(page, seq=None, timeout=15_000):
    """#field[data-anim-state="idle"], and [data-drawn-seq="seq"] when given (ui-architecture 5.3)."""
    sel = '#field[data-anim-state="idle"]' + (f'[data-drawn-seq="{seq}"]' if seq is not None else "")
    page.wait_for_selector(sel, state="attached", timeout=timeout)


def _shows(loc, ms=SHOW_WAIT_MS):
    try:
        loc.wait_for(state="visible", timeout=ms)
        return True
    except PlaywrightTimeout:
        return False


def reveal(page, selector):
    """The target on screen where a world rolls its region up (v1.4, W6: Under the Lights' lower ribbon unrolls the
    drive chart on hover or focus): hover the innermost region that holds it first; scroll only when that wasn't
    enough."""
    loc = page.locator(selector).first
    if _shows(loc, 100):
        return loc
    region = page.locator(f"[data-region]:has({selector})").last
    if region.count():
        region.hover()
        region.evaluate(SETTLED_JS)                     # the unroll is an LED step-in: let it land first
    if not _shows(loc, 300):
        loc.scroll_into_view_if_needed()
    return loc


SETTLED_JS = """r => Promise.race([Promise.all(r.getAnimations({ subtree: true }).map(a => a.finished.catch(() => null))),
  new Promise(ok => setTimeout(ok, 1500))])"""


POINT_TRIES = 4


def _in_viewport(page, box):
    size = page.viewport_size or {"width": 0, "height": 0}
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    return 0 <= cx < size["width"] and 0 <= cy < size["height"]


def point_at(page, selector):
    """Put the mouse on `selector` itself, after reveal(), and keep it there until the target stops moving under it:
    in a world whose board or ribbon unrolls on hover (Under the Lights), the pointer arriving changes the layout, and
    Playwright's own hover and click scroll the target first, which can slide it out from under the pointer."""
    loc = reveal(page, selector)
    at = None
    for _ in range(POINT_TRIES):
        box = loc.bounding_box()
        assert box, f"{selector} isn't on screen"
        if not _in_viewport(page, box):                 # below the fold (the neutral page scrolls): bring it up
            loc.scroll_into_view_if_needed()
            box = loc.bounding_box()
        point = (round(box["x"] + box["width"] / 2), round(box["y"] + box["height"] / 2))
        if point == at:
            return loc
        page.mouse.move(*point)
        page.wait_for_timeout(120)
        at = point
    raise AssertionError(f"{selector} kept moving under the pointer")


def click_at(page, selector):
    """point_at, then a click where the mouse is."""
    loc = point_at(page, selector)
    page.mouse.down()
    page.mouse.up()
    return loc


REGION_BOX_JS = """e => { const rects = (n) => { const r = n.getBoundingClientRect();
    return r.width || r.height ? [r] : [...n.children].flatMap(rects); };
  const all = rects(e); if (!all.length) return null;
  const x = Math.min(...all.map(r => r.left)), y = Math.min(...all.map(r => r.top));
  return { x, y, width: Math.max(...all.map(r => r.right)) - x, height: Math.max(...all.map(r => r.bottom)) - y }; }"""


def region_box(page, selector):
    """A region's box, or the union of its first boxed descendants' when it has none (a world may lend a region's
    parts to a fixture with display: contents, as Under the Lights does with the masthead); None when nothing shows."""
    return page.locator(selector).first.evaluate(REGION_BOX_JS)


def neutral_only(reason):
    """A test of the neutral world's own layout or surfaces (v1.4, W6): skipped on another world, with the reason."""
    import pytest
    return pytest.mark.skipif(WORLD != "neutral", reason=f"neutral world only: {reason}")


def blur(page):
    """Nothing focused, so global keys reach the keyboard listener from the body (FI 4.6)."""
    page.evaluate("() => { if (document.activeElement && document.activeElement !== document.body) "
                  "document.activeElement.blur(); }")


def until(page, check, timeout_ms=EXPECT_TIMEOUT_MS, step_ms=100, what="a condition"):
    """Wait for check() while letting Playwright deliver events (request listeners run during page waits)."""
    waited = 0
    while not check():
        if waited >= timeout_ms:
            raise AssertionError(f"timed out after {timeout_ms} ms waiting for {what}")
        page.wait_for_timeout(step_ms)
        waited += step_ms


def quiet(page, ms=QUIET_MS):
    page.wait_for_timeout(ms)


# ---------------------------------------------------------------- requests and errors
def record_requests(page, path, method="POST"):
    """Requests to `path` (exact; a path ending in "/" is a prefix) as {"path", "method", "body"} in send order."""
    seen = []

    def on_request(req):
        p = urlsplit(req.url).path
        if (p == path or (path.endswith("/") and p.startswith(path))) and (method is None or req.method == method):
            try:
                body = req.post_data_json
            except Exception:  # not JSON: keep the raw text
                body = req.post_data
            seen.append({"path": p, "method": req.method, "body": body})

    page.on("request", on_request)
    return seen


def js_errors(page):
    """Uncaught exceptions only (console network errors are left to the tests that look for them)."""
    return [e for e in page.errors if e.startswith("pageerror")]


# ---------------------------------------------------------------- toasts
SHOW_RE = re.compile(r"(^|\s)show(\s|$)")
ERR_RE = re.compile(r"(^|\s)err(\s|$)")


# Every toast the page shows, as the page sees it: a toast lasts 2.6 s (FI 4.5) and its words stay in the DOM after
# it hides, so a test that looks late (a busy machine) could read a hidden toast's words, or miss a toast that came
# and went. The `ui_pages` fixture installs this before any page script; each entry is a toast shown (a new message,
# or the same words for a new toast id) or the toast hiding, with the page clock.
TOAST_LOG_JS = """(() => {
  const log = [];
  Object.defineProperty(window, "__a11Toasts", { value: log, configurable: true });
  Object.defineProperty(window, "__a11ToastsId", { value: Math.random(), configurable: true });
  const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim();
  function start() {
    const t = document.getElementById("toast");
    if (!t) return false;
    let lastKey = null;
    new MutationObserver((mutations) => {
      const at = performance.now();
      if (!t.classList.contains("show")) {
        if (lastKey !== null) log.push({ kind: "hide", at });
        lastKey = null;
        return;
      }
      const entry = { kind: "show", text: norm(t.textContent), err: t.classList.contains("err"),
        tone: t.getAttribute("data-tone"), at };
      const key = JSON.stringify([entry.text, entry.err, entry.tone]);
      const fresh = mutations.some((m) => m.type === "childList" && m.addedNodes.length > 0);
      if (key !== lastKey || fresh) log.push(entry);
      lastKey = key;
    }).observe(t, { attributes: true, attributeFilter: ["class", "data-tone"], childList: true, subtree: true,
      characterData: true });
    return true;
  }
  if (!start()) document.addEventListener("DOMContentLoaded", start, { once: true });
})();"""


def toast_log(page):
    """The page's toast log (TOAST_LOG_JS), or None on a page without it."""
    return page.evaluate("() => window.__a11Toasts ? [window.__a11ToastsId, window.__a11Toasts] : null")


def _toast_matches(text, shown):
    if isinstance(text, re.Pattern):
        return bool(text.search(shown))
    return shown == re.sub(r"\s+", " ", text).strip()


def toasts_shown(page):
    """The toasts this document has shown so far (TOAST_LOG_JS), oldest first."""
    got = toast_log(page)
    return [e for e in (got[1] if got else []) if e["kind"] == "show"]


def expect_toast(page, text, error=False, timeout=EXPECT_TIMEOUT_MS):
    """A toast shows `text` (a string, whitespace-normalized and whole, or a regex searched): .show, .err only for
    errors, data-tone mirrored (5.1, FI 4.5). Toasts are taken in order: each call matches the first toast after the
    one the previous call matched, so the same words twice in a row need two toasts. `timeout` is how long the toast
    may take to appear (a seek or Go Live rebuilds the game first, restructure-v2.md 9)."""
    if toast_log(page) is None:
        _expect_toast_in_dom(page, text, error, timeout)
        return
    page_id, start = getattr(page, "_a11_toast_cursor", (None, 0))
    found = {}

    def check():
        doc_id, entries = toast_log(page)
        first = start if doc_id == page_id else 0
        shows = [(i, e) for i, e in enumerate(entries) if i >= first and e["kind"] == "show"]
        hit = next(((i, e) for i, e in shows if _toast_matches(text, e["text"])), None)
        if hit:
            found.update(doc=doc_id, index=hit[0], entry=hit[1])
        return bool(hit)

    try:
        until(page, check, timeout_ms=timeout, what=f"a toast {text!r}")
    except AssertionError as err:
        raise AssertionError(f"{err}; toasts shown: {[e['text'] for e in toasts_shown(page)]}") from None
    page._a11_toast_cursor = (found["doc"], found["index"] + 1)
    entry = found["entry"]
    assert (entry["err"], entry["tone"]) == (error, "error" if error else "info"), entry


def _expect_toast_in_dom(page, text, error, timeout):
    toast = page.locator("#toast")
    expect(toast).to_have_text(text, timeout=timeout)
    expect(toast).to_have_class(SHOW_RE)
    if error:
        expect(toast).to_have_class(ERR_RE)
    else:
        expect(toast).not_to_have_class(ERR_RE)
    expect(toast).to_have_attribute("data-tone", "error" if error else "info")


# ---------------------------------------------------------------- model/format.js, ported (JS rounding rules)
def _to_fixed(x, dp):
    """Number.prototype.toFixed: the exact binary value, halves away from zero."""
    return str(Decimal(x).quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP))


def _js_round(x):
    return math.floor(x + 0.5)


def pct(x):
    return "—" if x is None else f"{_js_round(x * 100)}%"


def pct1(x):
    if x is None:
        return "—"
    v = x * 100
    return f"{_to_fixed(v, 1)}%" if v < 9.95 else f"{_js_round(v)}%"


def fixed(x, dp):
    return "—" if x is None else _to_fixed(x, dp)


def signed1(x):
    r = _js_round(x * 10) / 10 or 0.0
    return f"{'+' if r >= 0 else ''}{_to_fixed(r, 1)}"


def why_habits(pred):
    """FI 3.5 why line, item 1: round((p_habits - p_league) * 1000) / 10, one decimal (G23)."""
    return signed1(_js_round((pred["p_habits"] - pred["p_league"]) * 1000) / 10)


def capitalize(text):
    return text[:1].upper() + text[1:] if text else ""


# ---------------------------------------------------------------- a second sandbox (Watch mode at test pace)
@contextmanager
def sandbox(tmp_path_factory, env_extra):
    """The app on a throwaway data folder (offline, saved game) with extra environment, like tests/conftest.py's
    `server` fixture. Never the live game."""
    import os
    port = _free_port()
    data = tmp_path_factory.mktemp("sandbox-ui")
    log_path = tmp_path_factory.mktemp("sandbox-ui-log") / "server.log"
    log = log_path.open("w")
    env = {**os.environ, **env_extra}
    proc = subprocess.Popen([sys.executable, "scripts/sandbox.py", "--port", str(port), "--data", str(data)],
                            cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, text=True, env=env)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(240):
            try:
                call(base, "/api/version", timeout=2)
                break
            except Exception:
                if proc.poll() is not None:
                    raise RuntimeError("sandbox server exited:\n" + log_path.read_text())
                time.sleep(0.25)
        else:
            raise RuntimeError("sandbox server did not start:\n" + log_path.read_text())
        yield {"base": base, "data": data, "port": port, "log": log_path}
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()

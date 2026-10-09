"""Team logos for the UI: GET /api/logo/<abbr>?v=default|dark (data contract C2).

The upstream URL is never built from the request. It is the 500 px PNG that the current game's ESPN summary lists
for that team, and it has to be https://a.espncdn.com/<safe path>.png, written exactly that way. The first good copy
is cached in DATA_DIR/logos/<ABBR>-<variant>.png and served from there. Offline (SHADOW_ESPN_OFFLINE=1) the route
serves the cache or 404 and never touches the network.

Fill data/logos once, online, so offline demos have logos (scripts/sandbox.py copies them):

    .venv/bin/python logos.py data/espn/summary_401872980_final.json
"""
import http.client
import logging
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import IO, NoReturn
from urllib.parse import urlsplit, urlunsplit

from flask import Flask, Response, jsonify, request, send_file

log = logging.getLogger(__name__)

ABBR_RE = re.compile(r"[A-Z]{2,4}")
VARIANTS = ("default", "dark")
UPSTREAM_HOST = "a.espncdn.com"
UPSTREAM_PATH_RE = re.compile(r"/[A-Za-z0-9/_.-]+\.png")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_LOGO_PX = 500                  # ESPN's default and dark logos; its 4096 px variants never qualify
MAX_LOGO_BYTES = 1024 * 1024
FETCH_TIMEOUT_S = 5                # per socket operation, and for the whole download
FAILURE_TTL_S = 600                # a failed fetch isn't retried for 10 minutes
MAX_AGE_S = 86400                  # browsers keep a served logo for a day
USER_AGENT = "Mozilla/5.0 shadow-caller"
NO_LOGO = "No logo for that team."

Key = tuple[str, str]              # (ABBR, variant)


class LogoError(Exception):
    """A logo request that can't be answered with a PNG. status is the HTTP code to send instead."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def _now() -> float:
    return time.monotonic()


# -------------------------------------------------- the request

def normalize_abbr(raw: object) -> str | None:
    """'dal' -> 'DAL'. None unless it is 2 to 4 ASCII letters, which rules out '/', '..', '%2e' and newlines."""
    if not isinstance(raw, str) or not raw.isascii():
        return None
    abbr = raw.upper()
    return abbr if ABBR_RE.fullmatch(abbr) else None


def parse_request(raw_abbr: str, v_values: list[str]) -> Key:
    """(ABBR, variant) from the URL. LogoError 404 for a malformed team, 400 for a bad or repeated ?v=."""
    abbr = normalize_abbr(raw_abbr)
    if abbr is None:
        raise LogoError(404, NO_LOGO)
    variant = v_values[0] if len(v_values) == 1 else (None if v_values else "default")
    if variant not in VARIANTS:
        raise LogoError(400, "v must be default or dark")
    return abbr, variant


# -------------------------------------------------- the summary (header only: no scores, records or results)

def _dig(obj: object, *keys: str | int) -> object:
    """obj[k1][k2]..., where a str key needs a dict and an int key a list. None as soon as the shape is off."""
    for k in keys:
        if isinstance(k, int):
            obj = obj[k] if isinstance(obj, list) and 0 <= k < len(obj) else None
        else:
            obj = obj.get(k) if isinstance(obj, dict) else None
    return obj


def game_teams(summary: object) -> dict[str, dict]:
    """{ABBR: ESPN team} for the game in this summary, from header.competitions[0].competitors[].team only."""
    comps = _dig(summary, "header", "competitions", 0, "competitors")
    teams: dict[str, dict] = {}
    for comp in comps if isinstance(comps, list) else []:
        team = _dig(comp, "team")
        abbr = normalize_abbr(_dig(team, "abbreviation"))
        if abbr and abbr not in teams and isinstance(team, dict):
            teams[abbr] = team
    return teams


def _is_variant(logo: dict, variant: str) -> bool:
    rel = _dig(logo, "rel")
    sizes = [_dig(logo, k) for k in ("width", "height")]
    return (isinstance(rel, list) and variant in rel
            and all(not isinstance(s, (int, float)) or s <= MAX_LOGO_PX for s in sizes))


def logo_href(team: object, variant: str) -> str | None:
    """The href ESPN lists for this team's 500 px logo under rel `variant`. The plain ['full', 'dark'] logo wins
    over ['full', 'scoreboard', 'dark']: fewest rel tags first, then list order."""
    logos = _dig(team, "logos")
    if not isinstance(logos, list):
        return None
    hits = [lg for lg in logos if isinstance(lg, dict) and _is_variant(lg, variant)]
    if not hits:
        return None
    href = min(hits, key=lambda lg: len(lg["rel"])).get("href")
    return href if isinstance(href, str) else None


def allowed_upstream(url: object) -> bool:
    """True only for https://a.espncdn.com/<letters, digits, / _ . ->.png with no port, user, password, query or
    fragment, no '..' or '//' in the path, and nothing that urlsplit would quietly drop (whitespace, a bare '?')."""
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    path = parts.path
    return (parts.scheme == "https" and parts.hostname == UPSTREAM_HOST and parts.netloc == UPSTREAM_HOST
            and port is None and parts.username is None and parts.password is None
            and not parts.query and not parts.fragment
            and UPSTREAM_PATH_RE.fullmatch(path) is not None and ".." not in path and "//" not in path
            and urlunsplit(parts) == url)


# -------------------------------------------------- fetching

class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    """A 3xx is a failed fetch (502), never a second request: the redirect target isn't on the allowlist."""

    def redirect_request(self, req: urllib.request.Request, fp: IO[bytes], code: int, msg: str,
                         headers: http.client.HTTPMessage, newurl: str) -> NoReturn:
        raise urllib.error.HTTPError(req.full_url, code, f"redirect refused ({msg})", headers, fp)


def build_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(_RefuseRedirects())


def _check_answer(resp: http.client.HTTPResponse) -> None:
    if resp.status != 200:
        raise LogoError(502, f"ESPN answered {resp.status} for the logo, not 200.")
    if resp.headers.get_content_type() != "image/png":
        raise LogoError(502, "ESPN's logo isn't image/png.")


def _read_capped(resp: http.client.HTTPResponse, deadline: float) -> bytes:
    """At most MAX_LOGO_BYTES + 1 bytes, one socket read at a time, so a slow drip can't outlast the deadline."""
    chunks, size = [], 0
    while size <= MAX_LOGO_BYTES:
        chunk = resp.read1(MAX_LOGO_BYTES + 1 - size)
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
        if _now() > deadline:
            raise LogoError(502, "ESPN's logo took too long.")
    if size > MAX_LOGO_BYTES:
        raise LogoError(502, "ESPN's logo is over 1 MB.")
    return b"".join(chunks)


def fetch_png(url: str) -> bytes:
    """PNG bytes from an allowlisted URL: 5 s timeout, no redirects, status 200, Content-Type image/png, the PNG
    signature and at most 1 MB. Anything else, a URL off the allowlist included, raises LogoError(502)."""
    if not allowed_upstream(url):                     # checked here, at the network boundary, for every caller
        raise LogoError(502, "ESPN's logo URL isn't on the allowlist.")
    deadline = _now() + FETCH_TIMEOUT_S
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with build_opener().open(req, timeout=FETCH_TIMEOUT_S) as resp:
            _check_answer(resp)
            data = _read_capped(resp, deadline)
    except urllib.error.HTTPError as e:                             # 4xx, 5xx and every refused 3xx
        e.close()
        raise LogoError(502, "ESPN refused the logo.") from e
    except (OSError, ValueError, http.client.HTTPException) as e:    # DNS, TLS, timeouts, a broken reply
        raise LogoError(502, "Couldn't reach ESPN for the logo.") from e
    if not data.startswith(PNG_SIGNATURE):
        raise LogoError(502, "ESPN's logo isn't a PNG.")
    return data


# -------------------------------------------------- the cache

def cache_path(data_dir: str | os.PathLike, abbr: str, variant: str) -> Path:
    """DATA_DIR/logos/<ABBR>-<variant>.png, built only from validated tokens and refused (404) if it resolves
    anywhere but that folder (a planted symlink, say)."""
    if not (isinstance(abbr, str) and ABBR_RE.fullmatch(abbr)) or variant not in VARIANTS:
        raise LogoError(404, NO_LOGO)
    folder = (Path(data_dir) / "logos").resolve()
    path = folder / f"{abbr}-{variant}.png"
    if path.resolve().parent != folder:
        log.warning("Logo cache file %s resolves outside %s; not serving it.", path, folder)
        raise LogoError(404, NO_LOGO)
    return path


def write_cache(path: Path, data: bytes) -> None:
    """A temp file in the same folder, then os.replace, so a reader never sees half a PNG."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.stem}.", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


# -------------------------------------------------- the route

def _error(e: LogoError) -> Response:
    resp = jsonify({"error": str(e)})
    resp.status_code = e.status
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


class LogoProxy:
    """The cache first; then, online, ESPN (one fetch in flight per team and variant, failures held 10 minutes)."""

    def __init__(self, get_summary: Callable[[], dict | None], get_teams: Callable[[], Iterable[str]] | None,
                 data_dir: str | os.PathLike, offline: bool) -> None:
        self.get_summary, self.get_teams = get_summary, get_teams
        self.data_dir, self.offline = Path(data_dir), bool(offline)
        self._guard = threading.Lock()
        self._inflight: dict[Key, threading.Lock] = {}     # held while that logo is being fetched
        self._failed: dict[Key, float] = {}                # _now() of its last failed fetch

    def serve(self, abbr: str) -> Response:
        """Flask view for GET /api/logo/<abbr>?v=default|dark."""
        try:
            path = self.ensure(*parse_request(abbr, request.args.getlist("v")))
        except LogoError as e:
            return _error(e)
        resp = send_file(path, mimetype="image/png", max_age=MAX_AGE_S)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp

    def ensure(self, abbr: str, variant: str) -> Path:
        """Path of the cached PNG for a validated team and variant, fetched first when online. LogoError otherwise."""
        teams = game_teams(self._summary())
        if abbr not in (teams or self._configured_teams()):
            raise LogoError(404, NO_LOGO)
        path = cache_path(self.data_dir, abbr, variant)
        if path.is_file():
            return path
        if self.offline:
            raise LogoError(404, "That logo isn't cached, and the app is offline.")
        url = logo_href(teams.get(abbr), variant)
        if url is None:
            raise LogoError(404, NO_LOGO)
        return self._fetch_once((abbr, variant), url, path)

    def _fetch_once(self, key: Key, url: str, path: Path) -> Path:
        with self._lock_for(key):
            if path.is_file():                          # fetched by another request while this one waited
                return path
            failed_at = self._failed.get(key)
            if failed_at is not None and _now() - failed_at < FAILURE_TTL_S:
                raise LogoError(502, "ESPN's logo failed in the last 10 minutes; not retrying yet.")
            try:
                data = fetch_png(url)
            except LogoError as e:
                self._failed[key] = _now()
                log.warning("Logo %s-%s from %s failed: %s (%r)", *key, url, e, e.__cause__)
                raise
            try:
                write_cache(path, data)
            except OSError as e:
                log.error("Couldn't save logo %s: %s", path, e)
                raise LogoError(500, "Couldn't save the logo.") from e
            self._failed.pop(key, None)
            return path

    def _lock_for(self, key: Key) -> threading.Lock:
        with self._guard:
            return self._inflight.setdefault(key, threading.Lock())

    def _summary(self) -> dict | None:
        try:
            return self.get_summary()
        except Exception:                               # a broken loader mustn't take the logo route down with it
            log.exception("Couldn't load the ESPN summary for logos; only cached logos will be served.")
            return None

    def _configured_teams(self) -> set[str]:
        """With no summary: the configured game's teams, for cached logos only (no summary means no upstream URL)."""
        if self.get_teams is None:
            return set()
        return {abbr for abbr in map(normalize_abbr, self.get_teams() or ()) if abbr}


def register(app: Flask, get_summary: Callable[[], dict | None], get_teams: Callable[[], Iterable[str]] | None,
             data_dir: str | os.PathLike, offline: bool) -> LogoProxy:
    """Add GET /api/logo/<abbr>?v=default|dark to a Flask app and return its LogoProxy.

    get_summary() returns the current ESPN summary dict, or None. The allowed teams and the upstream URLs come only
    from its header competitors (the current game). get_teams() returns the configured game's abbreviations; it is
    used only when no summary is loaded, and then only to serve logos already cached (None skips it). The cache is
    data_dir/logos. offline=True never touches the network: the cache, or 404.
    """
    proxy = LogoProxy(get_summary, get_teams, data_dir, offline)
    app.add_url_rule("/api/logo/<abbr>", "team_logo", proxy.serve, methods=["GET"])
    return proxy


def warm(summary: dict, data_dir: str | os.PathLike) -> dict[str, str]:
    """Fetch both variants of both teams' logos into data_dir/logos, through the same checks as the route.
    Returns {"DAL-default": "ok", ...}, or "<status>: <reason>" for one that failed."""
    proxy = LogoProxy(lambda: summary, None, data_dir, offline=False)
    out = {}
    for abbr in game_teams(summary):
        for variant in VARIANTS:
            try:
                proxy.ensure(abbr, variant)
                out[f"{abbr}-{variant}"] = "ok"
            except LogoError as e:
                out[f"{abbr}-{variant}"] = f"{e.status}: {e}"
    return out


if __name__ == "__main__":
    import json
    import sys

    from config import DATA_DIR

    if len(sys.argv) != 2:
        sys.exit("usage: .venv/bin/python logos.py data/espn/summary_<event>_final.json")
    print(json.dumps(warm(json.loads(Path(sys.argv[1]).read_text()), DATA_DIR), indent=1))

"""Logo proxy (data contract C2, section G tests 35-38): only the 500 px PNGs that the current game's ESPN summary
lists, from a.espncdn.com, cached in DATA_DIR/logos, and never the network when offline.

Every test builds a throwaway Flask app on a temp data folder. The CDN is faked under urllib, so the real opener,
redirect handling and response parsing all run, and nothing reaches ESPN or touches data/.
"""
import http.client
import importlib.util
import io
import socket
import threading
import urllib.request

import pytest
from flask import Flask
from helpers import ROOT

import logos

PNG = logos.PNG_SIGNATURE + bytes(64)          # the proxy checks the signature, not the picture
DAL_DEFAULT = "https://a.espncdn.com/i/teamlogos/nfl/500/dal.png"
DAL_DARK = "https://a.espncdn.com/i/teamlogos/nfl/500-dark/dal.png"
TB_DARK = "https://a.espncdn.com/i/teamlogos/nfl/500-dark/tb.png"


class FakeSocket:
    """Enough of a socket for http.client: swallows the request, replays one canned answer."""

    def __init__(self, raw):
        self.raw = raw

    def sendall(self, data):
        pass

    def makefile(self, *args, **kwargs):
        return io.BytesIO(self.raw)

    def close(self):
        pass


def http_answer(status="200 OK", ctype="image/png", body=PNG, extra=""):
    head = f"HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\n{extra}\r\n"
    return head.encode() + body


REDIRECT = http_answer("302 Found", "text/html", b"", "Location: https://evil.example/dal.png\r\n")


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """Any real connection attempt fails the test."""
    def refuse(*args, **kwargs):
        raise AssertionError("a logo test tried to open a real network connection")
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


@pytest.fixture
def cdn(monkeypatch):
    """ESPN's CDN, faked at the TLS connection: queue raw HTTP answers in cdn.answers; cdn.requests records
    (host, timeout, method, path) for every request urllib sends."""
    class CDN(http.client.HTTPSConnection):
        answers, requests, on_connect = [], [], None

        def putrequest(self, method, url, *args, **kwargs):
            CDN.requests.append((self.host, self.timeout, method, url))
            super().putrequest(method, url, *args, **kwargs)

        def connect(self):
            if CDN.on_connect:
                CDN.on_connect()
            self.sock = FakeSocket(CDN.answers.pop(0))

    def https_open(handler, req):                    # urllib's own handler, on the fake connection
        return handler.do_open(CDN, req, context=handler._context)

    for name in ("https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("no_proxy", "*")              # and no system proxy either
    monkeypatch.setattr(urllib.request.HTTPSHandler, "https_open", https_open)
    return CDN


def make_app(data_dir, summary, offline=False, teams=None):
    app = Flask(__name__)
    app.testing = True                               # anything unexpected raises in the test, not a quiet 500
    get_summary = summary if callable(summary) else (lambda: summary)
    logos.register(app, get_summary, (lambda: teams) if teams is not None else None, data_dir, offline)
    return app


def get(app, url):
    r = app.test_client().get(url)
    try:
        return r.status_code, r.headers, r.get_data()
    finally:
        r.close()


def files_under(folder):
    return sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file() or p.is_symlink())


def put_cached(data_dir, name, body=PNG):
    (data_dir / "logos").mkdir(parents=True, exist_ok=True)
    (data_dir / "logos" / name).write_bytes(body)


def mini_summary(**hrefs):
    """A header with one 500 px logo per team: mini_summary(DAL="https://...")."""
    return {"header": {"competitions": [{"competitors": [
        {"team": {"abbreviation": abbr, "logos": [{"href": href, "width": 500, "height": 500,
                                                   "rel": ["full", "default"]}]}}
        for abbr, href in hrefs.items()]}]}}


# ------------------------------------------------------------------ 35: request validation

@pytest.mark.parametrize("url, status", [
    ("/api/logo/../x", 404), ("/api/logo/dal.png", 404), ("/api/logo/D-L", 404), ("/api/logo/TOOLONG", 404),
    ("/api/logo/%2e%2e", 404), ("/api/logo/%2e%2e%2fx", 404), ("/api/logo/DAL%0A", 404), ("/api/logo/D", 404),
    ("/api/logo/NYJ", 404),                                   # a real team, but not in this game
    ("/api/logo/DAL?v=../x", 400), ("/api/logo/DAL?v=", 400), ("/api/logo/DAL?v=DARK", 400),
    ("/api/logo/DAL?v=scoreboard", 400), ("/api/logo/DAL?v=default&v=dark", 400),
])
def test_logo_rejects_bad_input(tmp_path, summary, cdn, url, status):
    assert get(make_app(tmp_path, summary), url)[0] == status
    assert cdn.requests == [] and files_under(tmp_path) == []


def test_logo_team_must_be_plain_ascii_letters():
    assert logos.normalize_abbr("dal") == "DAL"
    assert "ſf".upper() == "SF"                    # LATIN SMALL LETTER LONG S + f uppercases to ASCII...
    assert logos.normalize_abbr("ſf") is None      # ...so only ASCII input is uppercased
    assert logos.normalize_abbr(None) is None and logos.normalize_abbr("DAL\n") is None


def test_logo_bad_variant_says_what_is_allowed(tmp_path, summary, cdn):
    status, headers, body = get(make_app(tmp_path, summary), "/api/logo/DAL?v=../x")
    assert status == 400 and b"default or dark" in body
    assert headers["X-Content-Type-Options"] == "nosniff"


# ------------------------------------------------------------------ 36: upstream allowlist

@pytest.mark.parametrize("url, ok", [
    (DAL_DEFAULT, True), (DAL_DARK, True), ("https://a.espncdn.com/i/teamlogos/nfl/500/tb.png", True),
    ("http://a.espncdn.com/i/teamlogos/nfl/500/dal.png", False),                # not https
    ("https://a.espncdn.com.evil.com/i/teamlogos/nfl/500/dal.png", False),      # look-alike host
    ("https://evil.com/a.espncdn.com/i/teamlogos/nfl/500/dal.png", False),      # the host only in the path
    ("https://user:pw@a.espncdn.com/i/teamlogos/nfl/500/dal.png", False),       # userinfo
    ("https://a.espncdn.com@evil.com/i/teamlogos/nfl/500/dal.png", False),      # userinfo hiding the real host
    ("https://a.espncdn.com:443/i/teamlogos/nfl/500/dal.png", False),           # any port, even 443
    ("https://a.espncdn.com:abc/i/teamlogos/nfl/500/dal.png", False),           # a malformed port
    ("https://a.espncdn.com/i/teamlogos/../../etc/passwd.png", False),          # ..
    ("https://a.espncdn.com//evil.com/dal.png", False),                         # //
    ("https://a.espncdn.com/i/teamlogos/nfl/500/dal.png?w=4096", False),        # a query string
    ("https://a.espncdn.com/i/teamlogos/nfl/500/dal.png?", False),              # even an empty one
    ("https://a.espncdn.com/i/teamlogos/nfl/500/dal.png#x", False),             # a fragment
    ("https://a.espncdn.com/i/teamlogos/nfl/500/dal.svg", False),               # not a PNG
    ("https://a.espncdn.com/i/teamlogos/nfl/500/%2e%2e/dal.png", False),        # encoded dots
    ("https://a.espncdn.com/i/teamlogos/nfl/500/dal.png\n", False),             # urlsplit drops it quietly
    (" https://a.espncdn.com/i/teamlogos/nfl/500/dal.png", False),              # so does this
    ("HTTPS://A.ESPNCDN.COM/i/teamlogos/nfl/500/dal.png", False),               # not written exactly
    ("https://a.espncdn.com\\@evil.com/dal.png", False),                        # backslash trick
    ("//a.espncdn.com/i/teamlogos/nfl/500/dal.png", False),                     # scheme-relative
    (None, False), (42, False),
])
def test_logo_upstream_url_allowlist(url, ok):
    assert logos.allowed_upstream(url) is ok


def test_logo_never_fetches_an_href_that_fails_the_allowlist(tmp_path, cdn):
    app = make_app(tmp_path, mini_summary(DAL="https://a.espncdn.com.evil.example/i/teamlogos/nfl/500/dal.png"))
    assert get(app, "/api/logo/DAL")[0] == 502
    assert cdn.requests == [] and files_under(tmp_path) == []


def test_logo_href_is_the_plain_500px_png_from_the_header(summary):
    teams = logos.game_teams(summary)
    assert sorted(teams) == ["DAL", "TB"]
    assert logos.logo_href(teams["DAL"], "default") == DAL_DEFAULT
    assert logos.logo_href(teams["DAL"], "dark") == DAL_DARK            # not the 500-dark/scoreboard one
    assert logos.logo_href(teams["TB"], "dark") == TB_DARK
    huge = {"logos": [{"href": DAL_DEFAULT, "width": 4096, "height": 4096, "rel": ["full", "default"]}]}
    assert logos.logo_href(huge, "default") is None
    assert logos.logo_href({"logos": "nope"}, "default") is None and logos.logo_href(None, "dark") is None
    assert logos.game_teams({"header": "nope"}) == {} and logos.game_teams(None) == {}


def test_logo_fetches_the_summary_href_once_then_serves_the_cache(tmp_path, summary, cdn):
    cdn.answers.append(http_answer())
    app = make_app(tmp_path, summary)
    for _ in range(2):
        status, headers, body = get(app, "/api/logo/dal?v=dark")
        assert status == 200 and body == PNG
        assert headers["Content-Type"] == "image/png" and headers["X-Content-Type-Options"] == "nosniff"
        assert "max-age=86400" in headers["Cache-Control"]
    assert cdn.requests == [("a.espncdn.com", logos.FETCH_TIMEOUT_S, "GET", "/i/teamlogos/nfl/500-dark/dal.png")]
    assert files_under(tmp_path) == ["logos/DAL-dark.png"]


# ------------------------------------------------------------------ 37: offline

def test_logo_offline_never_touches_network(tmp_path, summary, monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("offline logo request touched the network")
    monkeypatch.setattr(urllib.request, "urlopen", boom)
    monkeypatch.setattr(urllib.request.OpenerDirector, "open", boom)
    monkeypatch.setattr(logos, "build_opener", boom)
    put_cached(tmp_path, "DAL-default.png")
    put_cached(tmp_path, "NYJ-default.png")                       # cached, but NYJ isn't in this game
    app = make_app(tmp_path, summary, offline=True)
    status, headers, body = get(app, "/api/logo/DAL")
    assert status == 200 and headers["Content-Type"] == "image/png" and body == PNG
    assert get(app, "/api/logo/DAL?v=dark")[0] == 404
    assert get(app, "/api/logo/TB")[0] == 404
    assert get(app, "/api/logo/NYJ")[0] == 404


def test_logo_without_a_summary_serves_only_cached_logos_of_the_configured_game(tmp_path, cdn):
    put_cached(tmp_path, "DAL-default.png")

    def broken_loader():
        raise RuntimeError("summary file unreadable")
    for source in (None, broken_loader):
        app = make_app(tmp_path, source, teams=("DAL", "TB"))
        assert get(app, "/api/logo/DAL")[0] == 200
        assert get(app, "/api/logo/TB")[0] == 404                 # no summary, so no upstream URL to fetch
        assert get(app, "/api/logo/NYJ")[0] == 404
    assert get(make_app(tmp_path, None), "/api/logo/DAL")[0] == 404   # no summary and no configured teams
    assert cdn.requests == []


# ------------------------------------------------------------------ 38: cache path, size, signature, redirects

@pytest.mark.parametrize("answer, status, written", [
    pytest.param(http_answer(), 200, ["logos/DAL-default.png"], id="png-written-only-in-logos"),
    pytest.param(http_answer(body=b"<html>not a logo</html>"), 502, [], id="not-a-png"),
    pytest.param(http_answer(ctype="text/html"), 502, [], id="not-image-png"),
    pytest.param(http_answer(body=logos.PNG_SIGNATURE + bytes(logos.MAX_LOGO_BYTES)), 502, [], id="over-1mb"),
    pytest.param(http_answer("204 No Content", body=b""), 502, [], id="not-200"),
    pytest.param(http_answer("404 Not Found", "text/html", b"gone"), 502, [], id="4xx"),
    pytest.param(REDIRECT, 502, [], id="redirect"),
])
def test_logo_cache_path_size_signature_redirect(tmp_path, summary, cdn, answer, status, written):
    cdn.answers.extend([answer, http_answer()])          # a followed redirect would get the good second answer
    got, headers, _ = get(make_app(tmp_path, summary), "/api/logo/DAL")
    assert got == status and headers["X-Content-Type-Options"] == "nosniff"
    assert cdn.requests == [("a.espncdn.com", logos.FETCH_TIMEOUT_S, "GET", "/i/teamlogos/nfl/500/dal.png")]
    assert files_under(tmp_path) == written


def test_logo_of_exactly_1mb_is_kept(tmp_path, summary, cdn):
    body = logos.PNG_SIGNATURE + bytes(logos.MAX_LOGO_BYTES - len(logos.PNG_SIGNATURE))
    cdn.answers.append(http_answer(body=body))
    status, _, got = get(make_app(tmp_path, summary), "/api/logo/TB")
    assert status == 200 and got == body
    assert files_under(tmp_path) == ["logos/TB-default.png"]


def test_logo_unreachable_cdn_gives_502(tmp_path, summary, cdn):
    def timeout():
        raise TimeoutError("timed out")
    cdn.on_connect = timeout
    assert get(make_app(tmp_path, summary), "/api/logo/DAL")[0] == 502
    assert files_under(tmp_path) == []


def test_logo_download_running_past_the_deadline_is_dropped(tmp_path, summary, cdn, monkeypatch):
    ticks = iter(range(0, 10_000, 10))                   # every clock read is 10 s after the one before
    monkeypatch.setattr(logos, "_now", lambda: float(next(ticks)))
    cdn.answers.append(http_answer())
    assert get(make_app(tmp_path, summary), "/api/logo/DAL")[0] == 502
    assert files_under(tmp_path) == []


def test_logo_cache_path_is_built_from_validated_tokens_only(tmp_path):
    assert logos.cache_path(tmp_path, "DAL", "dark") == (tmp_path / "logos" / "DAL-dark.png").resolve()
    for abbr, variant in (("../x", "default"), ("dal", "default"), (None, "default"), ("DAL", "../x"),
                          ("DAL", "dark/../../x")):
        with pytest.raises(logos.LogoError):
            logos.cache_path(tmp_path, abbr, variant)


def test_logo_cache_refuses_a_file_that_resolves_outside_the_logos_folder(tmp_path, summary, cdn):
    secret = tmp_path / "secret.png"
    secret.write_bytes(PNG + b"secret")
    data = tmp_path / "data"
    (data / "logos").mkdir(parents=True)
    (data / "logos" / "DAL-default.png").symlink_to(secret)
    status, _, body = get(make_app(data, summary), "/api/logo/DAL")
    assert status == 404 and b"secret" not in body
    assert cdn.requests == [] and secret.read_bytes() == PNG + b"secret"


def test_logo_failed_cache_write_leaves_no_temp_file_and_is_retried(tmp_path, summary, cdn):
    blocker = tmp_path / "logos" / "DAL-default.png"
    blocker.mkdir(parents=True)                         # a folder where the file goes: os.replace fails
    cdn.answers.extend([http_answer(), http_answer()])
    app = make_app(tmp_path, summary)
    assert get(app, "/api/logo/DAL")[0] == 500
    assert files_under(tmp_path) == []                  # the temp file was removed
    blocker.rmdir()                                     # a local fault isn't held 10 minutes: retried now
    assert get(app, "/api/logo/DAL")[0] == 200 and len(cdn.requests) == 2


def test_logo_failures_are_cached_for_ten_minutes(tmp_path, summary, cdn, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(logos, "_now", lambda: clock[0])
    cdn.answers.extend([http_answer("503 Service Unavailable", "text/html", b"busy"), http_answer(), http_answer()])
    app = make_app(tmp_path, summary)
    assert get(app, "/api/logo/TB")[0] == 502
    clock[0] += logos.FAILURE_TTL_S - 1
    assert get(app, "/api/logo/TB")[0] == 502 and len(cdn.requests) == 1      # not retried inside 10 minutes
    assert get(app, "/api/logo/TB?v=dark")[0] == 200                           # other keys aren't blocked
    clock[0] += 2
    assert get(app, "/api/logo/TB")[0] == 200 and len(cdn.requests) == 3


def test_logo_one_fetch_in_flight_per_team_and_variant(tmp_path, summary, cdn):
    entered, release = threading.Event(), threading.Event()

    def hold():
        entered.set()
        release.wait(5)
    cdn.on_connect = hold
    cdn.answers.extend([http_answer(), http_answer()])
    app = make_app(tmp_path, summary)
    results = []
    workers = [threading.Thread(target=lambda: results.append(get(app, "/api/logo/TB")[0])) for _ in range(2)]
    workers[0].start()
    assert entered.wait(5)
    workers[1].start()
    workers[1].join(0.2)
    assert workers[1].is_alive() and len(cdn.requests) == 1    # the second request waits for the first fetch
    release.set()
    for w in workers:
        w.join(5)
    assert results == [200, 200] and len(cdn.requests) == 1


# ------------------------------------------------------------------ filling data/logos for offline demos

def test_warm_fetches_both_variants_for_both_teams(tmp_path, summary, cdn):
    cdn.answers.extend([http_answer(), http_answer(), http_answer(), REDIRECT])
    got = logos.warm(summary, tmp_path)
    assert got["DAL-default"] == got["DAL-dark"] == got["TB-default"] == "ok"
    assert got["TB-dark"].startswith("502")
    assert files_under(tmp_path) == ["logos/DAL-dark.png", "logos/DAL-default.png", "logos/TB-default.png"]
    cdn.answers.append(http_answer())
    assert set(logos.warm(summary, tmp_path).values()) == {"ok"}
    assert len(cdn.requests) == 5 and cdn.requests[-1][3] == "/i/teamlogos/nfl/500-dark/tb.png"  # the rest cached


def load_sandbox_script():
    spec = importlib.util.spec_from_file_location("sandbox_script", ROOT / "scripts" / "sandbox.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fake_repo(root, with_logos):
    (root / "data" / "espn").mkdir(parents=True)
    (root / "data" / "play_callers.csv").write_text("caller\n")
    if with_logos:
        put_cached(root / "data", "DAL-default.png")
        (root / "data" / "logos" / "notes.txt").write_text("not a logo")
    return root


@pytest.mark.parametrize("with_logos", [True, False])
def test_sandbox_prepare_copies_cached_logos(tmp_path, monkeypatch, with_logos):
    script = load_sandbox_script()
    repo = fake_repo(tmp_path / "repo", with_logos)
    monkeypatch.setattr(script, "ROOT", repo)
    monkeypatch.setattr(script, "REAL_DATA", (repo / "data").resolve())
    out = script.prepare(tmp_path / "sandbox")
    assert files_under(out / "logos") == (["DAL-default.png"] if with_logos else [])
    if with_logos:
        assert (out / "logos" / "DAL-default.png").read_bytes() == PNG

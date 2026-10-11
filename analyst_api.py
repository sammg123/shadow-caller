"""POST /api/ask and GET /api/ask/status (docs/design/analyst.md sections 5 and 7), as a Flask blueprint.

create_blueprint(snapshot) takes the function that returns the analyst's snapshot (app.py builds it under LOCK, see
section 7); the model's call runs after it, with no lock held. A question is checked strictly (400 with a plain
reason), waits for no one (429 while another answers), and is answered as NDJSON: one small JSON event per line
(tool, delta, then done or error). The routes are registered on the app, so its own hooks cover them: the Host check,
the 64 KB body cap, the same-origin JSON gate for POSTs, the security headers and the JSON error pages.
"""
import json
import logging
import re
from collections.abc import Callable, Generator, Iterator, Mapping
from contextlib import closing

from flask import Blueprint, Response, jsonify, request

import analyst

log = logging.getLogger(__name__)

QUESTION_MAX = 500
HISTORY_MAX = 10                   # earlier messages, oldest first
TEXT_MAX = {"user": QUESTION_MAX, "assistant": 4000}
FIELDS = ("question", "history")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def text_of(value: object) -> str | None:
    """Text without control characters (line breaks and tabs stay), trimmed; None when it isn't text."""
    return CONTROL_RE.sub("", value).strip() if isinstance(value, str) else None


def parse_ask(body: object) -> tuple[str, list]:
    """(question, history) from POST /api/ask's body. ValueError, with the reason for the page, otherwise."""
    if not isinstance(body, dict):
        raise ValueError('Send a JSON object: {"question": "..."}.')
    extra = [k for k in body if k not in FIELDS]
    if extra:
        raise ValueError(f"Unknown field {str(extra[0])[:40]!r}: send question and, if you like, history.")
    question = text_of(body.get("question"))
    if not question:
        raise ValueError("Ask a question: question must be text.")
    if len(question) > QUESTION_MAX:
        raise ValueError(f"Ask in at most {QUESTION_MAX} characters.")
    return question, history_of(body.get("history"))


def history_of(value: object) -> list:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("history must be a list of messages, oldest first.")
    if len(value) > HISTORY_MAX:
        raise ValueError(f"history can hold at most {HISTORY_MAX} messages.")
    return [message_of(m) for m in value]


def message_of(m: object) -> dict:
    if not isinstance(m, dict) or set(m) != {"role", "content"}:
        raise ValueError('Each history message is {"role": "user" or "assistant", "content": "..."}.')
    if m["role"] not in TEXT_MAX:
        raise ValueError("A history message's role must be user or assistant.")
    content = text_of(m["content"])
    if not content:
        raise ValueError("A history message needs content: text.")
    cap = TEXT_MAX[m["role"]]
    if len(content) > cap:
        raise ValueError(f"A {m['role']} message in history can be at most {cap:,} characters.")
    return {"role": m["role"], "content": content}


def ndjson(events: Generator[Mapping, None, None], lease: analyst.Lease) -> Iterator[str]:
    """The answer, one JSON event per line. The stream owns the turn: however it ends (read to the end, closed by the
    server, or dropped unclosed when the page resets the connection mid-answer, which Werkzeug's dev server does), it
    hangs up on the model at once and gives the turn back."""
    try:
        with closing(events):
            for event in events:
                yield json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
    finally:
        lease.release()


def create_blueprint(snapshot: Callable[[], object], client=None, gate: analyst.Gate | None = None) -> Blueprint:
    """The analyst's routes. snapshot() returns an analyst_tools.Snapshot (app.py: under LOCK, quickly); client is
    the Ollama client (analyst.OllamaClient() by default); gate keeps it to one question at a time (analyst.GATE)."""
    bp = Blueprint("analyst", __name__)
    client = client if client is not None else analyst.OllamaClient()
    gate = gate if gate is not None else analyst.GATE

    @bp.post("/api/ask")
    def ask():
        try:
            question, history = parse_ask(request.get_json(silent=True))
        except ValueError as e:
            log.info("POST /api/ask refused: %s", e)
            return jsonify({"error": str(e)}), 400
        lease = gate.try_acquire()
        if lease is None:
            return jsonify({"error": analyst.BUSY}), 429
        try:
            snap = snapshot()
        except Exception:
            lease.release()
            log.exception("The analyst couldn't take a snapshot of the game")
            return jsonify({"error": analyst.FAULT}), 500
        resp = Response(ndjson(analyst.ask(question, history, snap, client), lease), mimetype="application/x-ndjson",
                        headers={"Cache-Control": "no-store"})
        resp.call_on_close(lease.release)          # a stream closed before it started never runs its own finally
        return resp

    @bp.get("/api/ask/status")
    def status():
        report = client.status()
        ready = bool(report.get("ollama") and report.get("installed"))
        return jsonify({"ready": ready, "ollama": bool(report.get("ollama")), "model": client.model,
                        "installed": bool(report.get("installed")), "warm": bool(report.get("warm")),
                        "busy": gate.busy, "message": None if ready else analyst.NEEDS_OLLAMA})

    return bp

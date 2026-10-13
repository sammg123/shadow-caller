"""Watch mode's request bodies (docs/design/data-contract.md E1), validated at the HTTP boundary, and the error every
watch request is refused with. watch.py re-exports all of it (app.py and the tests read it from there)."""
import re

SPEED_MIN, SPEED_MAX, DEFAULT_SPEED = 0.5, 10.0, 4.0
EVENT_ID_RE = re.compile(r"[0-9]{6,12}")             # ASCII digits: the id ends up in file names and URLs
START_KEYS, SPEED_KEYS, STOP_KEYS, SEEK_KEYS = ("event_id", "speed", "from_seq"), ("speed",), ("restore",), ("idx",)


class WatchError(Exception):
    """A watch request that isn't valid (status 400) or that the session's state doesn't allow (409)."""

    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------- E1: request bodies (validated at the HTTP boundary)
def body_of(raw, allowed=()):
    """A JSON request body as a dict holding only `allowed` keys. No body counts as {}."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise WatchError("Send a JSON object.", 400)
    extra = sorted(str(k) for k in raw if k not in allowed)
    if extra:
        raise WatchError(f"Unknown field '{extra[0][:20]}'. This takes {', '.join(allowed) or 'no fields'}.", 400)
    return raw


def event_arg(value, default=None):
    """The ESPN event id: 6 to 12 digits, as a string or a JSON number. Missing or '' means `default`."""
    if value is None or value == "":
        value = default
    if isinstance(value, int) and not isinstance(value, bool):
        value = str(value)
    if value is None or value == "":
        raise WatchError("Enter the ESPN event id to watch.", 400)
    if not isinstance(value, str) or not EVENT_ID_RE.fullmatch(value):
        raise WatchError(f"ESPN event ids are 6 to 12 digits, like 401872980 (got '{str(value)[:20]}').", 400)
    return value


def speed_arg(value):
    """A playback speed from 0.5 to 10 (NaN and infinity fail the range test)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not SPEED_MIN <= value <= SPEED_MAX:
        raise WatchError(f"Speed must be a number from {SPEED_MIN:g} to {SPEED_MAX:g}.", 400)
    return float(value)


def from_seq_arg(value):
    """Plays to apply at once before the pacing starts: a whole number from 0 (the top is checked in start())."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise WatchError("from_seq must be a whole number of plays, 0 or more.", 400)
    return value


def parse_start(raw, default_event):
    """(event_id, speed, from_seq) from a POST /api/watch/start body."""
    d = body_of(raw, START_KEYS)
    return (event_arg(d.get("event_id"), default_event), speed_arg(d.get("speed", DEFAULT_SPEED)),
            from_seq_arg(d.get("from_seq", 0)))


def parse_speed(raw):
    d = body_of(raw, SPEED_KEYS)
    if "speed" not in d:
        raise WatchError(f"Send the speed, from {SPEED_MIN:g} to {SPEED_MAX:g}.", 400)
    return speed_arg(d["speed"])


def parse_stop(raw):
    """restore, default false."""
    restore = body_of(raw, STOP_KEYS).get("restore", False)
    if not isinstance(restore, bool):
        raise WatchError("restore must be true or false.", 400)
    return restore


def parse_seek(raw):
    """POST /api/watch/seek's idx, the plays to show: a whole number from 0 (the top is checked in seek())."""
    d = body_of(raw, SEEK_KEYS)
    if "idx" not in d:
        raise WatchError("Send idx, the number of plays to show (0 is kickoff).", 400)
    idx = d["idx"]
    if isinstance(idx, bool) or not isinstance(idx, int) or idx < 0:
        raise WatchError("idx must be a whole number of plays, 0 or more.", 400)
    return idx


def parse_empty(raw):
    """pause, resume, step, back, forward, open and Go Live take no fields."""
    body_of(raw)

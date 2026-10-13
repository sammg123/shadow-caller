"""Values from a request, checked at the HTTP boundary for app.py's routes: the JSON object of a POST, and the numbers
and short text fields of the manual-entry calls (a ValueError with a plain reason, which app.state_call answers as a
400), and /api/timeline's since and until (the reason comes back as text)."""
import math
import re

from flask import request

TEXT_FIELD_MAX = 40                # a call, leaf, family, outcome, side, team or drive end
SINCE_RE = re.compile(r"[0-9]{1,9}")         # ASCII digits only: '\d' takes Arabic-Indic and fullwidth digits too


def json_object():
    """The request's JSON object. ValueError (a 400) for an empty body, one that isn't JSON or isn't an object."""
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        raise ValueError("Send a JSON object.")
    return d


def number(value, what):
    """An int from a JSON number or the text of one ('14', '2.0'; a fraction is cut off, as typed boxes always
    were). ValueError for anything else: text that isn't a number, NaN, infinity, true or false."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"{what} must be a number.")
    try:
        return int(float(value)) if isinstance(value, str) else int(value)
    except (ValueError, OverflowError):
        raise ValueError(f"'{str(value)[:20]}' isn't a number ({what}).") from None


def whole(value, what, lo, hi):
    """A JSON whole number from lo to hi (a typed box sends text: those go through number())."""
    ok_type = isinstance(value, int) or (isinstance(value, float) and math.isfinite(value) and value.is_integer())
    if isinstance(value, bool) or not ok_type or not lo <= value <= hi:
        raise ValueError(f"{what} must be a whole number from {lo} to {hi}.")
    return int(value)


def in_range(value, what, lo, hi):
    n = number(value, what)
    if not lo <= n <= hi:
        raise ValueError(f"{what} must be from {lo} to {hi}.")
    return n


def text(d, key, what=None, required=False):
    """A short text field: None when absent (or null), else a string of at most TEXT_FIELD_MAX characters."""
    value = d.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > TEXT_FIELD_MAX:
        raise ValueError(f"Send {what or key} as text.")
    return value.strip()


def flag(d, key):
    """A yes/no field: absent or null is no."""
    value = d.get(key)
    if value is None:
        return False
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be true or false.")
    return value


def timeline_args(args):
    """(since, until, error) from the query: ASCII whole numbers; until is optional and never before since."""
    since, until = args.get("since", "0"), args.get("until")
    if not SINCE_RE.fullmatch(since):
        return None, None, "since must be a whole number"
    if until is None:
        return int(since), None, None
    if not SINCE_RE.fullmatch(until):
        return None, None, "until must be a whole number"
    if int(until) < int(since):
        return None, None, "until can't be before since"
    return int(since), int(until), None

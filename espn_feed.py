"""ESPN live play-by-play feed (unofficial public JSON, no key).

Turns each play into what the engine needs: run gap and side, pass depth (air yards when ESPN
gives yards after catch), sack / scramble / incomplete, TD, turnover, penalties that wipe out a
play, punts and field goals. ESPN can't tell play-action, RPO or screen: retag those in the app.
"""
import json
import logging
import os
import re
import threading
import time
import urllib.request
from datetime import datetime

from config import DATA_DIR, ESPN_OFFLINE, GAME
from live import parse_clock

log = logging.getLogger(__name__)

BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
RAW_DIR = DATA_DIR / "espn"
SEEN_PATH = DATA_DIR / "feed_seen.json"

GAP_RE = re.compile(r"\b(left end|left tackle|left guard|up the middle|right guard|right tackle|right end)\b", re.I)
PASS_RE = re.compile(r"\bpass (incomplete )?(short|deep)? ?(left|middle|right)?", re.I)
GAP_LEAF = {"left end": "run_edge_left", "left tackle": "run_ot_left", "left guard": "run_inside",
            "up the middle": "run_inside", "right guard": "run_inside", "right tackle": "run_ot_right",
            "right end": "run_edge_right"}
GAIN_RE = re.compile(r"\bfor (?:(-?\d+) (?:yards?|yds?)\b|(no gain))", re.I)
SHORT_GAIN_RE = re.compile(r"\b(-?\d+) yds? (?:pass|rush|run)\b", re.I)    # ESPN's own text: '46 Yd pass from'
GAMEBOOK_RE = re.compile(r"\b[A-Z][a-z]?\.[A-Z]")                          # NFL gamebook names: 'D.Prescott'
REVERSED_RE = re.compile(r"\bplay was REVERSED\.\s*", re.I)
TWO_POINT_RE = re.compile(r"\s*TWO-POINT CONVERSION ATTEMPT\..*?(?:ATTEMPT (?:FAILS|SUCCEEDS)\.?|$)", re.I | re.S)
PEN_RE = re.compile(r"PENALTY on ([A-Z]{2,3})(?:-[^,]*)?, ([^,]+),")
ADMIN_TYPES = ("kickoff", "timeout", "end period", "end of", "two-minute", "coin toss", "extra point",
               "two-point", "conversion")
PASS_TYPES = ("pass reception", "pass incompletion", "passing touchdown", "pass interception")
END_OF_HALF_TYPES = ("end of half", "end of regulation", "end of game")
KICKOFF_RE = re.compile(r"\bkicks (?:onside )?\d+ yards?\b", re.I)
SCORING_SUMMARY_RE = re.compile(r"\b\d+ Yds? (?:pass from|run|rush)\b[^()]*\(", re.I)   # 'X 46 Yd pass from Y (Z Kick)'
SCRAMBLE_RE = re.compile(r"\bscrambles (left end|left tackle|left guard|up the middle|right guard|right tackle|right end)\b",
                         re.I)
EVENT_RE = re.compile(r"[0-9]{1,12}")      # ASCII digits only ('\d' takes Arabic-Indic too): ids reach paths and URLs
ORDER_KEY = "_apply_order"                 # feed_seen.json: games whose id list is in apply order (older files sorted it)
# Air yards of an incompletion, from the gamebook word: median and interquartile range, nflverse 2026 weeks 1 to 5
# (65 games, pass attempts excluding sacks). Hard-coded for v1; build.py can write them into models/profile.json later.
AIR_EST = {"short": {"air": 5, "band": [1, 10], "n": 1049}, "deep": {"air": 23, "band": [19, 32], "n": 461}}
AIR_EST_SOURCE = "nflverse 2026 weeks 1-5 (65 games), pass attempts excluding sacks: median air yards, IQR as the band"


def fetch_json(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 shadow-caller"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def find_event(team_abbr, date=None):
    """ESPN event id for this team's game on date (YYYYMMDD, default today)."""
    date = date or datetime.now().strftime("%Y%m%d")
    sb = fetch_json(f"{BASE}/scoreboard?dates={date}")
    for ev in sb.get("events", []):
        comps = (ev.get("competitions") or [{}])[0].get("competitors", [])
        if any((c.get("team") or {}).get("abbreviation") == team_abbr for c in comps):
            return str(ev["id"]), ev.get("name", "")
    return None, None


def check_event(event_id):
    """The event id as a string, or ValueError: it is used in file names and URLs."""
    eid = str(event_id or "")
    if not EVENT_RE.fullmatch(eid):
        raise ValueError(f"ESPN event ids are digits only, like 401872980 (got '{eid[:20]}').")
    return eid


def fetch_summary(event_id):
    event_id = check_event(event_id)
    if ESPN_OFFLINE:                                   # demos and tests: a saved finished game, no network
        path = RAW_DIR / f"summary_{event_id}_final.json"
        if not path.exists():                          # the file's name, never the server's folders
            raise FileNotFoundError(f"Offline mode: no saved game for ESPN event {event_id} ({path.name}).")
        return json.loads(path.read_text())
    return fetch_json(f"{BASE}/summary?event={event_id}")


def iter_drive_plays(summary):
    """All plays in order as (offense_abbr, drive_idx, drive_id, play). drive_idx counts ESPN's drives from 1
    (drives.previous, then drives.current, the drive in progress)."""
    drives = summary.get("drives") or {}
    groups = list(drives.get("previous") or [])
    cur = drives.get("current")
    if isinstance(cur, dict) and cur.get("plays"):
        groups.append(cur)
    seen, out = set(), []
    for idx, d in enumerate(groups, start=1):
        team = (d.get("team") or {}).get("abbreviation")
        did = str(d["id"]) if d.get("id") is not None else None
        for p in d.get("plays") or []:
            pid = str(p.get("id"))
            if pid in seen:
                continue
            seen.add(pid)
            out.append((team, idx, did, p))
    out.sort(key=lambda x: int(x[3].get("sequenceNumber") or 0))
    return out


def iter_plays(summary):
    """All plays in order as (offense_abbr, play). drives.current is the drive in progress."""
    return [(team, p) for team, idx, did, p in iter_drive_plays(summary)]


def team_id(summary, abbr):
    """ESPN team id for an abbreviation, from the drive records (fallback: boxscore, header)."""
    drives = summary.get("drives") or {}
    for d in list(drives.get("previous") or []) + [drives.get("current") or {}]:
        t = d.get("team") or {}
        if t.get("abbreviation") == abbr and t.get("id") is not None:
            return str(t["id"])
    for t in (summary.get("boxscore") or {}).get("teams") or []:
        tt = t.get("team") or {}
        if tt.get("abbreviation") == abbr:
            return str(tt.get("id"))
    for c in (((summary.get("header") or {}).get("competitions") or [{}])[0]).get("competitors") or []:
        tt = c.get("team") or {}
        if tt.get("abbreviation") == abbr:
            return str(tt.get("id"))
    return None


def _depth(air):
    return "short" if air < 10 else ("mid" if air < 20 else "deep")


def play_text(text):
    """The play as it finally stood: the corrected text after a replay reversal, without the two-point
    try ESPN appends to a touchdown."""
    return TWO_POINT_RE.sub("", REVERSED_RE.split(text)[-1]).strip()


def penalty_note(text):
    """'defensive offside on TB' from '...PENALTY on TB-D.Walker, Defensive Offside, 4 yards...'."""
    m = PEN_RE.search(text or "")
    return f"{m.group(2).strip().lower()} on {m.group(1)}" if m else None


def _gain(text):
    """First gain in the text ('for 8 yards', 'for no gain', ESPN's '46 Yd pass'), or None."""
    m = GAIN_RE.search(text)
    if m:
        return 0 if m.group(2) else int(m.group(1))
    m = SHORT_GAIN_RE.search(text)
    return int(m.group(1)) if m else None


def _align(text):
    """'S' shotgun, 'U' not shotgun (under center or pistol); None when the text isn't gamebook text."""
    if "shotgun" in text.lower():
        return "S"
    return "U" if GAMEBOOK_RE.search(text) else None


def _call_family(typ, body):
    """'sack', 'scramble', 'pass', 'run' or None (no call: a flag before the snap), from the play
    text before any penalty, falling back to ESPN's play type for its own short text."""
    low = body.lower()
    if not re.search(r"[a-z]", low.replace("shotgun", "").replace("no huddle", "")):
        return None                                                # nothing but a formation tag
    if "sacked" in low or typ.startswith("sack"):
        return "sack"
    if "scrambles" in low:
        return "scramble"
    if re.search(r"\bpass\b", low) or "intercepted" in low or typ.startswith(PASS_TYPES):
        return "pass"
    if GAP_RE.search(low) or typ.startswith("rush") or SHORT_GAIN_RE.search(body):
        return "run"
    if GAMEBOOK_RE.search(body) and GAIN_RE.search(body):       # 'J.Williams to DAL 30 for 2 yards'
        return "run"
    return None


def _yards(p, body, family, incomplete, intercepted):
    """Yards the call gained: the gamebook gain before any fumble (not the return, not the flag)."""
    if incomplete or intercepted:
        return 0
    gain = _gain(re.split(r"\bFUMBLES\b", body)[0])
    if gain is None:
        stat = p.get("statYardage")
        gain = int(stat) if isinstance(stat, (int, float)) else 0
    return abs(gain) if family == "sack" else gain


def _pass_leaf(p, body, yards, incomplete, intercepted):
    """Depth from air yards (gain minus yards after catch) on a completion, else from the short/deep word.
    Incompletions: 'deep' (15+) is 20+ air yards 70% of the time in 2022-25 nflverse, so deep -> 20+."""
    m = PASS_RE.search(body)
    word = (m.group(2) or "").lower() if m else ""
    yac = p.get("yardsAfterCatch")
    if not incomplete and not intercepted and isinstance(yac, (int, float)):
        depth = _depth(yards - int(yac))
        # gamebook 'deep' = 15+ air yards, 'short' = under 15: a whole bucket off means ESPN's YAC is wrong
        if word == "deep" and depth == "short":
            return "dropback_deep"
        if word == "short" and depth == "deep":
            return "dropback_mid"
        return f"dropback_{depth}"
    return f"dropback_{word}" if word else None


def _gap_side(gap):
    """'left' / 'middle' / 'right' from gap words ('left tackle' -> 'left', 'up the middle' -> 'middle')."""
    if not gap:
        return None
    return "middle" if gap == "up the middle" else gap.split()[0]


def _pass_facts(p, body, yards, incomplete, intercepted):
    """Side and gamebook depth word of a pass, and its air yards: exact from yards after catch on a completion,
    the median for the word on an incompletion. An interception's air comes from its spot (timeline.py)."""
    m = PASS_RE.search(body)
    word = ((m.group(2) or "").lower() or None) if m else None
    out = {"lat": ((m.group(3) or "").lower() or None) if m else None, "depth": word}
    yac = p.get("yardsAfterCatch")
    if not incomplete and not intercepted and isinstance(yac, (int, float)):
        air = yards - int(yac)
        conflict = (word == "deep" and air < 10) or (word == "short" and air >= 20)   # the same distrust as _pass_leaf
        out.update(air=air, yac=int(yac), air_src="yac_conflict" if conflict else "yac")
    elif not intercepted and word in AIR_EST:
        out.update(air=AIR_EST[word]["air"], air_src="est", air_band=list(AIR_EST[word]["band"]))
    return out


def _turnover(p, typ, low):
    if "isTurnover" in p:
        return bool(p["isTurnover"])
    return "intercepted" in low or "opponent" in typ


def classify(team, p):
    """What happened on this play, in the engine's terms."""
    typ = ((p.get("type") or {}).get("text") or "").lower()
    raw = p.get("text") or ""
    text = play_text(raw)
    low = text.lower()
    nullified = "no play" in low
    info = {"id": str(p.get("id")), "team": team, "text": raw, "type": typ, "kind": "skip",
            "leaf": None, "family": None, "outcome": None, "yards": 0, "td": False, "turnover": False,
            "nullified": nullified, "align": _align(raw),
            "lat": None, "gap": None, "depth": None, "air": None, "air_src": None, "air_band": None, "yac": None}
    if (any(k in typ for k in ADMIN_TYPES) or raw.lstrip().upper().startswith("TWO-POINT CONVERSION")
            or KICKOFF_RE.search(text)):
        return info
    if "punt" in typ or re.search(r"\bpunts\b", low):
        info["kind"] = "sync" if nullified else "punt"
        return info
    if "field goal" in typ:
        made = "good" in typ and "no good" not in typ
        info["kind"] = "sync" if nullified else ("fg" if made else "fg_miss")
        return info
    body = re.split(r"\bpenalty on\b", text, maxsplit=1, flags=re.I)[0]
    family = _call_family(typ, body)
    if family is None or any(k in low for k in ("kneels", "spiked", "aborted")) or low.strip(" .") == "team safety":
        info["kind"] = "sync"                      # flag before the snap, kneel, spike, fumbled snap
        return info

    body_low = body.lower()
    gamebook = bool(GAMEBOOK_RE.search(body))      # gamebook text beats ESPN's type, which can lag a reversal
    intercepted = "intercepted" in body_low
    incomplete = family == "pass" and ("incomplete" in body_low or (not gamebook and "incompletion" in typ))
    yards = _yards(p, body, family, incomplete, intercepted)
    if family == "run":
        m = GAP_RE.search(body)
        gap = m.group(1).lower() if m else None
        info.update(family="run", leaf=GAP_LEAF[gap] if gap else None, gap=gap, lat=_gap_side(gap))
    elif family == "pass":
        info.update(family="dropback", leaf=_pass_leaf(p, body, yards, incomplete, intercepted),
                    outcome="incomplete" if incomplete else None, **_pass_facts(p, body, yards, incomplete, intercepted))
    else:
        info.update(family="dropback", outcome=family)
        if family == "scramble":
            m = SCRAMBLE_RE.search(body)
            gap = m.group(1).lower() if m else None
            info.update(gap=gap, lat=_gap_side(gap))
    turnover = not nullified and _turnover(p, typ, low)
    td = (not turnover and not nullified and "touchdown nullified" not in low
          and ("touchdown" in low or (not gamebook and "touchdown" in typ) or bool(SCORING_SUMMARY_RE.search(text))))
    info.update(kind="play", yards=yards, turnover=turnover, td=td)
    return info


def situation(p, which, offense_is_home):
    """Down, distance, ball (distance to the end zone), quarter, clock, score at start or end of a play."""
    st = p.get(which) or {}
    out = {}
    down, dist, ytg = st.get("down"), st.get("distance"), st.get("yardsToEndzone")
    if isinstance(down, int) and 1 <= down <= 4 and isinstance(ytg, int) and 1 <= ytg <= 99:
        out.update(down=down, togo=max(1, int(dist or 10)), yardline_100=ytg)
    q = (p.get("period") or {}).get("number")
    if isinstance(q, int) and 1 <= q <= 5:
        out["qtr"] = q
    clk = (p.get("clock") or {}).get("displayValue")
    if which == "start" and clk:
        try:
            out["clock"] = parse_clock(clk)
        except ValueError:
            pass
    if which == "end":
        h, a = p.get("homeScore"), p.get("awayScore")
        if isinstance(h, int) and isinstance(a, int):
            out["score_off"], out["score_opp"] = (h, a) if offense_is_home else (a, h)
    poss = (st.get("team") or {}).get("id")
    out["_poss_id"] = str(poss) if poss is not None else None
    return out


class Feed:
    """Polls ESPN and applies new plays to the engine, in order, under the app's lock.

    applied: ESPN play ids in the order they were applied (the timeline's seq); seen is the same ids as a set.
    skipped_ids: the applied ids whose apply failed (this game, since the ids were last loaded or forgotten).
    gen: bumped by invalidate(); a poll fetched under an older gen applies nothing.
    summary: the last ESPN summary applied or loaded (load_summary() falls back to the saved files)."""

    def __init__(self, engine, lock, on_change=None):
        self.engine, self.lock, self.on_change = engine, lock, on_change
        self.event_id = GAME.get("espn_event")
        self.on = False
        self.interval = 4
        self.status = {"state": "off", "detail": "", "last_poll": None, "last_play": None, "plays_logged": 0,
                       "skipped": None}
        self.gen = 0
        self.reload_seen()
        self.summary = None
        self.off_team_id = None
        self._thread = None
        self.load_summary()

    @property
    def summary(self):
        return self._summary

    @summary.setter
    def summary(self, summary):
        """Set event_id first: a summary only counts for the event it was set under."""
        self._summary, self._summary_event = summary, self.event_id
        if summary:                                    # apply_one needs it to see possession change hands
            self.off_team_id = team_id(summary, GAME["offense"]) or getattr(self, "off_team_id", None)
        self.fix_order(summary)

    def load_summary(self):
        """This game's ESPN summary: memory, then data/espn/summary_<event>.json (the last poll), then the saved
        summary_<event>_final.json. None when there is none. Never touches the network."""
        if self._summary is not None and self._summary_event == self.event_id:
            return self._summary
        eid = str(self.event_id or "")
        if not EVENT_RE.fullmatch(eid):
            return None
        for path in (RAW_DIR / f"summary_{eid}.json", RAW_DIR / f"summary_{eid}_final.json"):
            try:
                s = json.loads(path.read_text()) if path.exists() else None
            except (ValueError, OSError) as ex:
                print(f"Couldn't read {path.name} ({ex}); trying the next saved copy.")
                continue
            if isinstance(s, dict):
                self.summary = s
                return s
        return None

    # -------------------------------------------------- persistence of processed play ids
    def _load_seen(self):
        """(ids in apply order, True if the file is the old string-sorted format)."""
        if not SEEN_PATH.exists():
            return [], False
        try:
            d = json.loads(SEEN_PATH.read_text())
            ids = [str(x) for x in d.get(GAME["game_id"], [])]
            legacy = GAME["game_id"] not in (d.get(ORDER_KEY) or [])
        except (ValueError, OSError, AttributeError, TypeError) as ex:
            print(f"Couldn't read {SEEN_PATH.name} ({ex}); ESPN plays already in the log may be logged again.")
            return [], False
        return list(dict.fromkeys(ids)), legacy and len(ids) > 1

    def reload_seen(self):
        """Read the applied ids from feed_seen.json again (after a backup of it is put back)."""
        self.applied, self._legacy_order = self._load_seen()
        self.seen = set(self.applied)
        self.skipped_ids = []

    def fix_order(self, summary):
        """An old feed_seen.json stored the ids string-sorted: put them back in the order the plays happened."""
        if not getattr(self, "_legacy_order", False) or not summary:
            return
        pos = {str(p.get("id")): i for i, (t, p) in enumerate(iter_plays(summary))}
        order = sorted(self.applied, key=lambda pid: pos.get(pid, len(pos)))
        self._legacy_order = False
        if order != self.applied:
            self.applied = order
            self._bump_epoch()

    def _save_seen(self):
        try:
            d = json.loads(SEEN_PATH.read_text()) if SEEN_PATH.exists() else {}
        except (ValueError, OSError):
            d = {}
        d = d if isinstance(d, dict) else {}
        ordered = d.get(ORDER_KEY) if isinstance(d.get(ORDER_KEY), list) else []
        d[GAME["game_id"]] = list(self.applied)
        d[ORDER_KEY] = sorted(set(ordered) | {GAME["game_id"]})
        tmp = SEEN_PATH.with_name(SEEN_PATH.name + ".tmp")
        tmp.write_text(json.dumps(d))
        os.replace(tmp, SEEN_PATH)                     # atomic: a crash mid-write can't corrupt it

    def forget(self):
        self.seen, self.applied, self._legacy_order, self.skipped_ids = set(), [], False, []
        self.status["skipped"] = None
        self._save_seen()
        self._bump_epoch()

    def invalidate(self):
        """Drop any poll already in flight: its apply() sees a stale generation and applies nothing."""
        with self.lock:
            self.gen += 1

    def _bump_epoch(self):
        bump = getattr(self.engine, "bump_epoch", None)
        if bump:
            bump()

    # -------------------------------------------------- control
    def resolve_event(self, event_id=None):
        """The event to follow: the id given (checked), else the current one, else today's game for the offense
        from ESPN's scoreboard. That last is a network call of up to 10 s: make it before taking the app's lock."""
        if event_id:
            return check_event(event_id)
        if self.event_id:
            return check_event(self.event_id)
        eid, name = find_event(GAME["offense"])
        if not eid:
            raise ValueError(f"No {GAME['offense']} game on ESPN today. Enter the ESPN event id.")
        return check_event(eid)

    def start(self, event_id=None):
        eid = self.resolve_event(event_id)
        if eid != self.event_id:
            self.invalidate()        # a poll of the old event still in flight must not land as the new one's
            self.event_id = eid
        self.on = True
        self.status.update(state="starting", detail=f"ESPN event {self.event_id}")
        if not self._thread or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()

    def stop(self):
        self.on = False
        self.status.update(state="off", detail="")

    def _loop(self):
        while self.on:
            try:
                self.poll_once()
            except Exception as e:  # network blips: keep polling, show the error
                self.status.update(state="error", detail=f"{type(e).__name__}: {e}")
            time.sleep(self.interval)

    def poll_once(self, summary=None):
        gen, eid = self.gen, self.event_id             # read before the fetch: a replay or watch may start meanwhile,
        summary = summary or fetch_summary(eid)        # and switch event_id; this poll stays with its own game's file
        if gen != self.gen:
            return 0
        RAW_DIR.mkdir(exist_ok=True)
        (RAW_DIR / f"summary_{check_event(eid)}.json").write_text(json.dumps(summary))
        n = self.apply(summary, gen)
        self.status.update(state="live" if self.on else self.status["state"], last_poll=datetime.now().strftime("%H:%M:%S"),
                           detail=f"ESPN event {eid}")
        return n

    # -------------------------------------------------- apply plays
    def apply(self, summary, gen=None):
        """Apply every play in the summary not applied yet, in order. gen: the generation read before the fetch;
        when a replay, reset or watch has invalidated it since, nothing is applied (returns 0)."""
        logged = 0
        with self.lock:              # the replay button and the poll thread must not both apply the same plays
            if gen is not None and gen != self.gen:
                return 0
            self.summary = summary
            self.off_team_id = team_id(summary, GAME["offense"]) or self.off_team_id
            new = [(t, p) for t, p in iter_plays(summary) if str(p.get("id")) not in self.seen]
            try:
                for team, p in new:
                    logged += self.apply_one(team, p, save=False)
            finally:
                if new:
                    self._save_seen()
        if new and self.on_change:
            self.on_change()
        return logged

    def apply_one(self, team, p, save=True):
        """Apply one ESPN play to the engine, then record its id in apply order and update the status line.
        Never raises: a play that fails is skipped (status 'skipped', its id in skipped_ids, the traceback in the
        server log) but still counts as applied. Returns 1 if it logged a snap that counts. Takes the lock
        (re-entrant), so callers may hold it."""
        pid = str(p.get("id"))
        logged = 0
        with self.lock:
            typed_rows = not self.applied and bool(self.engine.state.get("log"))
            try:
                logged = self._apply_one(team, p)
            except Exception as ex:    # one bad play must not stall the feed for the rest of the game
                self.status["skipped"] = f"{(p.get('text') or '')[:90]} ({ex})"
                if pid not in self.skipped_ids:
                    self.skipped_ids.append(pid)
                log.exception("ESPN play %s skipped; enter it by hand if it was a %s snap", pid, GAME["offense"])
            if pid not in self.seen:
                if typed_rows:         # the field showed hand-typed plays; from now on it shows ESPN's: new epoch
                    self._bump_epoch()
                self.seen.add(pid)
                self.applied.append(pid)
            self.status["last_play"] = (p.get("text") or "")[:160]
            self.status["plays_logged"] += logged
            if save:
                self._save_seen_safely()
        return logged

    def _save_seen_safely(self):
        try:
            self._save_seen()
        except OSError as ex:
            self.status["detail"] = f"Couldn't save {SEEN_PATH.name}: {ex}"
            print(f"Couldn't save {SEEN_PATH.name}:", ex)

    def _apply_one(self, team, p):
        """Apply one ESPN play to the engine. Returns 1 if it logged a snap that counts, else 0."""
        e, home = self.engine, GAME["offense_is_home"]
        info = classify(team, p)
        start, end = situation(p, "start", home), situation(p, "end", home)
        ours = team == GAME["offense"]
        if info["kind"] == "skip":
            self._apply_admin(info, start, end)
            return 0
        logged = 0
        if ours and info["kind"] == "play":
            e.feed_sync(start, offense_ball=True)
            if info["nullified"]:
                note = penalty_note(play_text(info["text"]))
                e.apply_penalty("OFFSET", play={k: info[k] for k in ("leaf", "family", "outcome")},
                                source="espn", note=note, espn_id=info["id"])
            else:
                e.record_play(None, info["yards"], td=info["td"], turnover=info["turnover"],
                              leaf=info["leaf"], family=None if info["leaf"] else info["family"],
                              outcome=info["outcome"], source="espn", feed=info)
                logged = 1
        elif ours and info["kind"] in ("punt", "fg", "fg_miss") and e.state["drive_active"]:
            e.end_drive(info["kind"])
        elif ours and info["kind"] == "sync":
            e.feed_sync(start, offense_ball=True)
        e.feed_sync(end, offense_ball=self._ours(end))
        if ours and info["kind"] == "play" and info["nullified"] and e.state["drive_active"]:
            e.set_message(f"No play: {note or 'flag'}. {e.situation_text()}. His call still counts for scoring.")
        return logged

    def _apply_admin(self, info, start, end):
        """Timeouts, kickoffs, PATs, ends of quarters: clock and score; possession only when it's clean."""
        e = self.engine
        keep = {k: v for k, v in start.items() if k in ("qtr", "clock")}
        keep.update({k: v for k, v in end.items() if k in ("score_off", "score_opp")})
        half_over = any(k in info["type"] for k in END_OF_HALF_TYPES)
        e.feed_sync(keep, offense_ball=False if half_over else None)
        if "kickoff" in info["type"]:
            e.feed_sync({}, offense_ball=False)            # a kickoff always starts a new possession
            if "down" in end:
                e.feed_sync(end, offense_ball=self._ours(end))

    def _ours(self, end):
        """True/False when ESPN clearly says who has the ball next; None when it's unclear (no change)."""
        poss = end.get("_poss_id")
        if not poss or not self.off_team_id:
            return None
        if poss != self.off_team_id:
            return False
        return True if "down" in end else None

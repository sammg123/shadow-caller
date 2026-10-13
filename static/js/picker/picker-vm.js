// The game picker's view model (docs/design/game-picker.md 3; restructure-v2.md 7, phase 2). Pure: GET /api/games's
// payload, the models' index (GET /api/callers: restructure-v2.md 11 decision 1, who has a model and why not) and the
// panel's own state in, a frozen view out; pickerReduce is the panel's state machine and selectionOf the {event_id,
// sides} it emits. Kickoff times are the viewer's own (the time zone comes in, never the clock). Every
// string is plain text for textContent, in sentence case (a world sets caps in CSS).

export const FIND_ID_HELP = "Open the game on espn.com. The number after gameId/ in the address is the game id.";
export const REF_MAX = 500;
const MESSAGE_MAX = 300;
const SEP = " · ";
const LAST_REGULATION_QTR = 4;
const SUFFIXES = new Set(["JR", "JR.", "SR", "SR.", "II", "III", "IV"]);

export const INITIAL = Object.freeze({
  open: false, loading: false, error: null, data: null, index: null, filter: "", expanded: Object.freeze({}),
  chosen: null, side: null, both: false, ref: Object.freeze({ text: "", busy: false, error: null }),
});

const own = (obj, key) => (obj && Object.hasOwn(obj, key) ? obj[key] : undefined);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : "");
const message = (v) => (str(v?.message ?? v).trim() || "Something went wrong.").slice(0, MESSAGE_MAX);
/** The server's reason without the help line it ends with (the panel shows that line under the field already). */
const withoutHelp = (text) => text.replace(FIND_ID_HELP, "").trim() || text;

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

// ---------------------------------------------------------------- the payload, read defensively
const capped = (v) => str(v).trim().slice(0, MESSAGE_MAX) || null;

/**
 * The models' index (GET /api/callers) as {name: {model, reason}}: a play-caller has a model when his entry is built,
 * by his name exactly as the play-caller table spells it (callers.has_model's rule, which the server's select follows);
 * else the reason the index gives (a skipped caller's, a failed build's error). null without a readable index.
 * @param {unknown} body
 */
export function indexOf(body) {
  if (!isObj(body) || !Array.isArray(body.callers)) return null;
  return Object.fromEntries(body.callers.filter((c) => isObj(c) && str(c.name)).map((c) => [c.name,
    { model: c.status === "built", reason: c.status === "built" ? null : capped(c.reason) ?? capped(c.error) }]));
}

function teamOf(t, index) {
  if (!isObj(t) || !str(t.abbr)) return null;
  const known = isObj(t.caller) && str(t.caller.name) ? own(index, t.caller.name) : undefined;
  const caller = isObj(t.caller) && str(t.caller.name) ? { name: t.caller.name, role: str(t.caller.role) || null,
    model: known ? known.model : t.caller.model === true, reason: known?.reason ?? capped(t.caller.reason) } : null;
  return { abbr: t.abbr, name: str(t.name) || t.abbr, short: str(t.short) || t.abbr,
    score: Number.isInteger(t.score) ? t.score : null, caller };
}

/** A game from the payload (each side's caller as the models' index knows him), or null without an id or two teams. */
export function gameOf(g, index = null) {
  const away = teamOf(g?.away, index);
  const home = teamOf(g?.home, index);
  if (!isObj(g) || !str(g.event_id) || !away || !home) return null;
  return { id: g.event_id, seasonType: g.season_type, week: g.week, kickoff: str(g.kickoff), timeValid: g.time_valid
    !== false, neutral: g.neutral === true, status: str(g.status), detail: str(g.detail), completed: g.completed === true,
  clock: str(g.clock), period: Number.isInteger(g.period) ? g.period : null, away, home, raw: g };
}

function weeksOf(data, index) {
  const weeks = Array.isArray(data?.weeks) ? data.weeks : [];
  return weeks.filter((w) => isObj(w) && str(w.key)).map((w) => ({
    key: w.key, label: str(w.label) || w.key, detail: str(w.detail), stale: w.stale === true, error: str(w.error),
    current: w.key === data.current || w.current === true,
    games: (Array.isArray(w.games) ? w.games : []).map((g) => gameOf(g, index)).filter(Boolean),
  }));
}

// ---------------------------------------------------------------- words for one game
/** "live", "final", "upcoming", or "off" (postponed, canceled: nothing to open). */
export function kindOf(g) {
  if (g.status === "in") return "live";
  if (g.status === "pre") return "upcoming";
  return g.status === "post" && g.completed ? "final" : "off";
}

const quarter = (n) => (n <= LAST_REGULATION_QTR ? `Q${n}` : n === LAST_REGULATION_QTR + 1 ? "OT" : `${n - 4}OT`);

const FORMATS = new Map();
function kickoffText(iso, timeZone) {
  const when = new Date(iso);
  if (!iso || Number.isNaN(when.getTime())) return null;
  try {
    const key = timeZone || "UTC";
    if (!FORMATS.has(key)) FORMATS.set(key, new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric",
      minute: "2-digit", timeZone: key }));
    const p = Object.fromEntries(FORMATS.get(key).formatToParts(when).map((x) => [x.type, x.value]));
    return `${p.weekday} ${p.hour}:${p.minute} ${p.dayPeriod}`;
  } catch {
    return null;   // an unknown time zone: ESPN's own words instead
  }
}

function statusText(g, kind, timeZone) {
  if (kind === "live") return `Live${SEP}${g.clock && g.period ? `${quarter(g.period)} ${g.clock}` : g.detail || "on now"}`;
  if (kind === "final") return g.detail || "Final";
  if (kind === "off") return g.detail || "Not played";
  if (!g.timeValid) return "Time TBD";
  return kickoffText(g.kickoff, timeZone) ?? (g.detail || "Upcoming");
}

const scored = (kind) => kind === "live" || kind === "final";
const scoreOf = (t, kind) => (scored(kind) && t.score !== null ? String(t.score) : "");
const sepOf = (g) => (g.neutral ? "vs" : "at");

function lastName(name) {
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1].toUpperCase())) words.pop();
  return words[words.length - 1];
}

function rowOf(g, ui, timeZone) {
  const kind = kindOf(g);
  const status = statusText(g, kind, timeZone);
  const named = (t) => `${t.name}${scoreOf(t, kind) ? ` ${scoreOf(t, kind)}` : ""}`;
  const shadow = [g.away, g.home].filter((t) => t.caller?.model).map((t) => `${lastName(t.caller.name)} (${t.abbr})`);
  return {
    id: g.id, kind, status, matchup: `${g.away.abbr} ${sepOf(g)} ${g.home.abbr}`,
    away: { abbr: g.away.abbr, name: g.away.name, score: scoreOf(g.away, kind) },
    home: { abbr: g.home.abbr, name: g.home.name, score: scoreOf(g.home, kind) },
    label: `${named(g.away)} ${sepOf(g)} ${named(g.home)}. ${status}.`,
    caller: shadow.length ? `Shadow: ${shadow.join(SEP)}` : null,
    picked: ui.chosen?.event_id === g.id,
  };
}

// ---------------------------------------------------------------- the list
function teamOptions(weeks) {
  const seen = new Map();
  for (const g of weeks.flatMap((w) => w.games)) for (const t of [g.away, g.home]) if (!seen.has(t.abbr)) seen.set(t.abbr, t.name);
  const teams = [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: "", label: "All teams" }, ...teams];
}

function weekVm(w, ui, timeZone) {
  const games = ui.filter ? w.games.filter((g) => g.away.abbr === ui.filter || g.home.abbr === ui.filter) : w.games;
  const open = own(ui.expanded, w.key) ?? (ui.filter ? true : w.current);
  const note = w.error || (w.stale ? "Not updated: ESPN didn't answer just now." : null);
  return { key: w.key, title: w.current ? `This week${SEP}${w.label}` : w.label, detail: w.detail, current: w.current,
    open, note, games: games.map((g) => rowOf(g, ui, timeZone)) };
}

function statusVm(ui) {
  if (ui.loading && !ui.data) return { text: "Loading the schedule…", tone: "info", retry: false };
  if (ui.error) return { text: ui.error, tone: "error", retry: true };
  if (ui.data?.offline === true) return { text: "Offline: only the saved weeks are listed.", tone: "info", retry: false };
  return { text: "", tone: "info", retry: false };
}

// ---------------------------------------------------------------- the chosen game
const modeled = (g) => [g.away, g.home].filter((t) => t.caller?.model).map((t) => t.abbr);

function goHint(g, kind) {
  if (kind === "off") return `${g.detail || "Not played"}: nothing to open.`;
  if (!modeled(g).length) return "No play-caller model for either team yet.";
  if (kind === "final") return "Finished: opens paused at kickoff.";
  return kind === "live" ? "Live: opens live." : "Not started: opens live and follows it from kickoff.";
}

/** Why a side can or can't be shadowed: the model index's own reason when the server sends it (restructure-v2.md 11
 * decision 1: a side with no built model is disabled and says why). */
function sideNote(caller) {
  if (!caller) return "Not in the play-caller table yet.";
  if (caller.model) return "Model ready.";
  return caller.reason ?? "No model for this play-caller yet.";
}

/** One side's switch. `group` names its radio group: one shared group for one side, a group of its own for each side
 * while both are tracked, so a browser keeps both checked (a group holds one checked radio). */
function sideVm(t, ui) {
  const model = t.caller?.model === true;
  return { abbr: t.abbr, team: t.name, caller: t.caller ? `${t.caller.name}${t.caller.role ? ` (${t.caller.role})` : ""}`
    : null, model, checked: model && (ui.both || ui.side === t.abbr), disabled: !model || ui.both,
  group: ui.both ? `side-${t.abbr}` : "side", note: sideNote(t.caller) };
}

function chosenVm(ui, weeks, timeZone) {
  const g = gameOf(ui.chosen, ui.index);
  if (!g) return null;
  const kind = kindOf(g);
  const week = weeks.find((w) => w.games.some((x) => x.id === g.id))?.label ?? `Week ${g.week}`;
  const score = scored(kind) ? `${g.away.abbr} ${g.away.score ?? ""}, ${g.home.abbr} ${g.home.score ?? ""}` : "";
  const bothReady = modeled(g).length === 2;
  const selection = selectionOf(ui);
  return {
    id: g.id, kind, title: `${g.away.short} ${sepOf(g)} ${g.home.short}`,
    sub: [week, statusText(g, kind, timeZone), score].filter(Boolean).join(SEP),
    sides: [g.away, g.home].map((t) => sideVm(t, ui)),
    both: { checked: ui.both, disabled: !bothReady, label: "Track both sides (separate stats)",
      note: bothReady ? "Two play-callers, two scorecards." : "Needs a play-caller model on both sides." },
    go: { disabled: selection === null, label: "Open this game", hint: goHint(g, kind) },
    selection,
  };
}

/** The selection the picker emits for phase 2, {event_id, sides}, or null when nothing can be opened. */
export function selectionOf(ui) {
  const g = gameOf(ui?.chosen, ui?.index);
  if (!g || kindOf(g) === "off") return null;
  const sides = ui.both ? [g.away.abbr, g.home.abbr] : ui.side ? [ui.side] : [];
  return sides.length ? { event_id: g.id, sides } : null;
}

/** The whole panel's view, deep-frozen. */
export function pickerVm(ui, { timeZone } = {}) {
  const weeks = weeksOf(ui.data, ui.index);
  const shown = weeks.map((w) => weekVm(w, ui, timeZone)).filter((w) => !ui.filter || w.games.length);
  const empty = ui.filter && !shown.length ? "No games for that team in this list."
    : ui.data && !weeks.length && !ui.error ? "No games listed yet." : null;
  return deepFreeze({
    open: ui.open, title: "Pick a game", status: statusVm(ui), empty, weeks: shown,
    filter: { value: ui.filter, label: "Team", options: teamOptions(weeks) },
    chosen: chosenVm(ui, weeks, timeZone),
    ref: { text: ui.ref.text, busy: ui.ref.busy, error: ui.ref.error, help: FIND_ID_HELP,
      label: "Paste an ESPN game link or id", button: "Find" },
  });
}

// ---------------------------------------------------------------- the panel's state machine
function pick(ui, raw) {
  const g = gameOf(raw, ui.index);
  if (!g) return ui;
  const ready = modeled(g);
  const side = ready.includes(g.home.abbr) ? g.home.abbr : ready[0] ?? null;
  return { ...ui, chosen: g.raw, side, both: false };
}

function chooseSide(ui, abbr) {
  const g = gameOf(ui.chosen, ui.index);
  if (!g || ui.both || !modeled(g).includes(abbr)) return ui;
  return { ...ui, side: abbr };
}

function setBoth(ui, on) {
  const g = gameOf(ui.chosen, ui.index);
  if (!g || (on && modeled(g).length !== 2)) return ui;
  return { ...ui, both: on };
}

const HANDLERS = Object.freeze({
  open: (ui) => ({ ...ui, open: true }),
  close: (ui) => ({ ...ui, open: false, chosen: null, side: null, both: false, ref: { ...ui.ref, busy: false } }),
  loading: (ui) => ({ ...ui, loading: true }),
  loaded: (ui, a) => ({ ...ui, loading: false, error: null, data: isObj(a.data) ? a.data : null,
    index: indexOf(a.callers) ?? ui.index }),
  loadFailed: (ui, a) => ({ ...ui, loading: false, error: message(a.error) }),
  filter: (ui, a) => ({ ...ui, filter: str(a.team) }),
  toggleWeek: (ui, a) => ({ ...ui, expanded: { ...ui.expanded, [str(a.key)]: a.open === true } }),
  pick: (ui, a) => pick(ui, a.game),
  back: (ui) => ({ ...ui, chosen: null, side: null, both: false }),
  side: (ui, a) => chooseSide(ui, a.abbr),
  both: (ui, a) => setBoth(ui, a.on === true),
  refText: (ui, a) => ({ ...ui, ref: { text: str(a.text).slice(0, REF_MAX), busy: ui.ref.busy, error: null } }),
  refBusy: (ui) => ({ ...ui, ref: { ...ui.ref, busy: true, error: null } }),
  refFailed: (ui, a) => ({ ...ui, ref: { ...ui.ref, busy: false, error: withoutHelp(message(a.error)) } }),
  refFound: (ui, a) => ({ ...pick(ui, a.game), ref: { text: "", busy: false, error: null } }),
});

/** The panel's next state: a new object for an action that changes it, the same one otherwise. */
export function pickerReduce(ui, action) {
  const handler = own(HANDLERS, action?.type);
  return handler ? handler(ui, action) : ui;
}

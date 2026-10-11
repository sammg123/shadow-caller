// The scene Look: schema, validation, merge (ui-architecture.md 2.7; owner A10). Pure.
// validateLook walks a declarative schema and returns every problem with its path ("lights[2].intensity must be
// >= 0"); unknown keys are problems too, so a typo never passes silently. resolveLook deep-merges a world's partial
// look over a base (NEUTRAL_LOOK by default: objects merge, arrays and null replace), validates the result and
// deep-freezes a copy, throwing a LookError that lists every problem. A world keeps its own data under `world`.
import { deepFreeze, isPlainObject } from "../core/domain.js";
import { DEFAULT_MOTION } from "../field/timing.js";
import { NEUTRAL_LOOK } from "./neutral-look.js";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CLASS_RE = /^-?[A-Za-z_][\w-]*(?: -?[A-Za-z_][\w-]*)*$/;
const PASS_RE = /^[A-Za-z][A-Za-z0-9-]*$/;
const LABEL_RE = /^[^\u0000-\u001f<>]{1,24}$/;
const MAX_SHADOW_CASTERS = 2;
const WORLD_DEPTH = 8;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- schema vocabulary
const hex = { t: "hex" };
const bool = { t: "bool" };
const num = (min = -Infinity, max = Infinity, { above = false } = {}) => ({ t: "num", min, max, above });
const unit = num(0, 1);
const oneOf = (...values) => ({ t: "enum", values });
const hexOr = (...words) => ({ t: "hexOr", words });
const str = (re, hint) => ({ t: "str", re, hint });
const obj = (fields, optional = []) => ({ t: "obj", fields, optional: new Set(optional) });
const arr = (item, { min = 0, max = Infinity, len = null } = {}) => ({ t: "arr", item, min, max, len });
const nullable = (inner) => ({ t: "nullable", inner });
const tagged = (key, variants) => ({ t: "tagged", key, variants });
const json = { t: "json" };
const vec3 = arr(num(), { len: 3 });

const LINE = obj({ color: hex, widthYd: num(0, 5, { above: true }), opacity: unit, mode: oneOf("paint", "float") });
const STROKE = obj({
  geometry: oneOf("line2", "tube", "ribbon", "decal"), widthPx: num(0, 64, { above: true }),
  widthYd: num(0, 20, { above: true }), core: hex, edge: hexOr("team", "team-alt"), opacity: unit,
  dash: nullable(arr(num(0, 100), { len: 2 })), ghostedOpacity: unit, approx: oneOf("hatch", "soft", "dashed", "pixel"),
}, ["widthPx", "widthYd"]);
const LIGHT = obj({
  id: str(ID_RE, "a lowercase id (a-z, 0-9 and -)"), kind: oneOf("ambient", "hemisphere", "directional", "spot"),
  color: hex, intensity: num(0, 1e7), groundColor: hex, position: vec3, target: vec3, castShadow: bool,
  angle: num(0, Math.PI / 2, { above: true }), penumbra: unit,
}, ["groundColor", "position", "target", "castShadow", "angle", "penumbra"]);
const CAMERA_MODE = obj({
  id: str(ID_RE, "a lowercase id (a-z, 0-9 and -)"), label: str(LABEL_RE, "a label of 1 to 24 characters"),
  rig: oneOf("sideline", "endzone", "overhead", "skycam", "table", "blimp"), fov: num(1, 120, { above: true }),
  height: num(0, 1000), back: num(-1000, 1000), yaw: num(-360, 360), follow: oneOf("ball", "drive", "pan", "none"), cut: bool,
}, ["yaw"]);
const MOTION_FIELDS = Object.fromEntries([...Object.keys(DEFAULT_MOTION), "ghostInMs", "ghostOutMs", "verdictMs"]
  .map((k) => [k, ["groundYps", "airYps", "kickYps", "maxRowMs"].includes(k) ? num(0, 1e5, { above: true }) : num(0, 1e5)]));

const SCHEMA = obj({
  id: str(ID_RE, "a lowercase id (a-z, 0-9 and -)"),
  version: oneOf(1),
  renderer: obj({
    toneMapping: oneOf("none", "aces", "agx", "neutral"), exposure: num(0, 10, { above: true }),
    shadows: oneOf("off", "pcf", "pcfsoft", "vsm"), shadowMapSize: oneOf(1024, 2048),
    antialias: oneOf("smaa", "fxaa", "msaa", "none"), clear: hex, clearAlpha: unit,
  }),
  environment: obj({
    background: nullable(hex),
    fog: nullable(tagged("kind", {
      exp2: obj({ kind: oneOf("exp2"), color: hex, density: num(0, 1) }),
      linear: obj({ kind: oneOf("linear"), color: hex, near: num(0, 1e5), far: num(0, 1e5) }),
    })),
    ibl: nullable(oneOf("room")), iblIntensity: num(0, 10),
  }),
  lights: arr(LIGHT, { max: 16 }),
  field: obj({
    turf: arr(hex, { len: 2 }), stripeYd: oneOf(5, 10), paint: hex, paintOpacity: unit, surround: hex,
    endZones: oneOf("team", "neutral"), endZoneText: oneOf("name", "abbr", "none"), numerals: bool, hashes: bool,
    plinth: nullable(obj({ height: num(0, 50), color: hex })), roughness: unit, metalness: unit, grain: unit,
  }),
  lines: obj({ los: LINE, ltg: LINE }),
  ball: obj({
    kind: oneOf("football", "dot", "puck"), color: hex, accent: hex, scale: num(0, 10, { above: true }),
    trail: obj({ kind: oneOf("none", "ribbon", "comet", "spark"), color: hexOr("team"), widthPx: num(0, 64),
      fadeMs: num(0, 1e4) }),
  }),
  // v1.4 (G3-9): the plays draw with these three (play-style.js, the 2D field); the zone era's corridor, area and band
  // strokes and ghost.opacity (the shadows' opacities are play-drawing.md's) are gone.
  strokes: obj({ arc: STROKE, ground: STROKE, mark: STROKE }),
  // tint (optional, G3-1): "fill" (the default) tints every shadow by `fill`; "family" by the world's family ramp
  // (look.world.plays.families: pass, run, rpo), with `fill` for any family it leaves out. `style` is the 2D field's dash.
  ghost: obj({
    fill: hexOr("team", "neutral"), stroke: hex, style: oneOf("zone", "outline", "hatch", "pixel", "marker"),
    afterSnapOpacity: unit, labels: bool, tint: oneOf("fill", "family"),
  }, ["tint"]),
  lastPlay: obj({ keep: oneOf("until-next-snap", "until-presnap"), dimOpacity: unit }),
  residue: obj({ keep: oneOf("none", "drive", "game"), opacity: unit }),
  labels: obj({ renderer: oneOf("css2d", "sprite", "decal", "none"), className: str(CLASS_RE, "CSS class names"),
    result: bool }),
  post: obj({
    bloom: nullable(obj({ strength: num(0, 10), radius: num(0, 5), threshold: num(0, 10) })),
    extra: arr(str(PASS_RE, "a pass name (letters, digits and -)"), { max: 8 }),
  }),
  cameras: obj({
    modes: arr(CAMERA_MODE, { min: 1, max: 8 }), default: str(ID_RE, "a camera mode id"),
    moveMs: num(0, 1e4), ease: oneOf("linear", "outCubic", "inOutCubic"),
    orbit: nullable(obj({ minPolar: num(0, Math.PI), maxPolar: num(0, Math.PI), minAzimuth: num(-TAU, TAU),
      maxAzimuth: num(-TAU, TAU), zoom: bool })),
    inset: nullable(obj({ mode: str(ID_RE, "a camera mode id"), rect: arr(unit, { len: 4 }) })),
  }),
  motion: obj(MOTION_FIELDS),
  teamColor: obj({ minContrast: num(1, 21), against: arr(hex, { min: 1, max: 8 }) }),
  world: json,
}, ["world"]);

/** The top-level groups of a Look, in schema order. */
export const LOOK_KEYS = Object.freeze(Object.keys(SCHEMA.fields));

// ---------------------------------------------------------------- the walker
const sub = (path, key) => (path ? `${path}.${key}` : key);
const list = (values) => values.join(", ");

function checkNum(spec, v, path) {
  if (typeof v !== "number" || !Number.isFinite(v)) return [`${path} must be a number`];
  if (spec.above && v <= spec.min) return [`${path} must be > ${spec.min}`];
  if (v < spec.min) return [`${path} must be >= ${spec.min}`];
  if (v > spec.max) return [`${path} must be <= ${spec.max}`];
  return [];
}

function checkObj(spec, v, path) {
  if (!isPlainObject(v)) return [`${path || "look"} must be an object`];
  const missing = Object.keys(spec.fields).filter((k) => v[k] === undefined && !spec.optional.has(k))
    .map((k) => `${sub(path, k)} is missing`);
  const unknown = Object.keys(v).filter((k) => !Object.hasOwn(spec.fields, k)).map((k) => `${sub(path, k)} is not a Look field`);
  const inner = Object.keys(spec.fields).filter((k) => v[k] !== undefined).flatMap((k) => check(spec.fields[k], v[k], sub(path, k)));
  return [...missing, ...unknown, ...inner];
}

function checkArr(spec, v, path) {
  if (!Array.isArray(v)) return [`${path} must be a list`];
  const plural = (n) => `${n} item${n === 1 ? "" : "s"}`;
  if (spec.len !== null && v.length !== spec.len) return [`${path} must have ${plural(spec.len)}`];
  if (v.length < spec.min) return [`${path} must have at least ${plural(spec.min)}`];
  if (v.length > spec.max) return [`${path} must have at most ${plural(spec.max)}`];
  return v.flatMap((item, i) => check(spec.item, item, `${path}[${i}]`));
}

function checkTagged(spec, v, path) {
  const tags = Object.keys(spec.variants);
  if (!isPlainObject(v) || !tags.includes(v[spec.key])) return [`${sub(path, spec.key)} must be one of ${list(tags)}`];
  return check(spec.variants[v[spec.key]], v, path);
}

function checkJson(v, path, depth = 0) {
  if (v === null || ["string", "boolean"].includes(typeof v)) return [];
  if (typeof v === "number") return Number.isFinite(v) ? [] : [`${path} must be a finite number`];
  if (depth > WORLD_DEPTH) return [`${path} is nested too deeply`];
  if (Array.isArray(v)) return v.flatMap((x, i) => checkJson(x, `${path}[${i}]`, depth + 1));
  if (isPlainObject(v)) return Object.entries(v).flatMap(([k, x]) => checkJson(x, sub(path, k), depth + 1));
  return [`${path} must be JSON data (no functions)`];
}

const SIMPLE = {
  hex: (s, v, p) => (typeof v === "string" && HEX_RE.test(v) ? [] : [`${p} must be a #rrggbb color`]),
  bool: (s, v, p) => (typeof v === "boolean" ? [] : [`${p} must be true or false`]),
  enum: (s, v, p) => (s.values.includes(v) ? [] : [`${p} must be ${s.values.length === 1 ? s.values[0] : `one of ${list(s.values)}`}`]),
  str: (s, v, p) => (typeof v === "string" && s.re.test(v) ? [] : [`${p} must be ${s.hint}`]),
  hexOr: (s, v, p) => (s.words.includes(v) || (typeof v === "string" && HEX_RE.test(v)) ? []
    : [`${p} must be ${s.words.join(", ")} or a #rrggbb color`]),
  num: (s, v, p) => checkNum(s, v, p),
  obj: (s, v, p) => checkObj(s, v, p),
  arr: (s, v, p) => checkArr(s, v, p),
  nullable: (s, v, p) => (v === null ? [] : check(s.inner, v, p)),
  tagged: (s, v, p) => checkTagged(s, v, p),
  json: (s, v, p) => (isPlainObject(v) ? checkJson(v, p) : [`${p} must be a plain object`]),
};

function check(spec, value, path) {
  return SIMPLE[spec.t](spec, value, path);
}

// ---------------------------------------------------------------- rules across fields
function duplicates(items, path) {
  const seen = new Set();
  return items.flatMap((item, i) => {
    if (!isPlainObject(item) || typeof item.id !== "string") return [];
    if (seen.has(item.id)) return [`${path}[${i}].id "${item.id}" is used twice`];
    seen.add(item.id);
    return [];
  });
}

function lightRules(lights) {
  if (!Array.isArray(lights)) return [];
  const casters = lights.filter((l) => isPlainObject(l) && l.castShadow === true).length;
  const placed = lights.flatMap((l, i) => (isPlainObject(l) && ["directional", "spot"].includes(l.kind) && !l.position
    ? [`lights[${i}].position is required for ${l.kind} lights`] : []));
  const shadows = casters > MAX_SHADOW_CASTERS
    ? [`lights: at most ${MAX_SHADOW_CASTERS} lights may cast shadows (found ${casters})`] : [];
  return [...duplicates(lights, "lights"), ...placed, ...shadows];
}

function cameraRules(cameras) {
  if (!isPlainObject(cameras) || !Array.isArray(cameras.modes)) return [];
  const ids = cameras.modes.filter(isPlainObject).map((m) => m.id);
  const names = `cameras.modes (${list(ids)})`;
  const def = ids.includes(cameras.default) ? [] : [`cameras.default must name one of ${names}`];
  const inset = isPlainObject(cameras.inset) && !ids.includes(cameras.inset.mode)
    ? [`cameras.inset.mode must name one of ${names}`] : [];
  return [...duplicates(cameras.modes, "cameras.modes"), ...def, ...inset];
}

function fogRules(environment) {
  const fog = isPlainObject(environment) ? environment.fog : null;
  if (!isPlainObject(fog) || fog.kind !== "linear" || !(fog.far <= fog.near)) return [];
  return ["environment.fog.far must be greater than environment.fog.near"];
}

/** Every problem with a full look; `ok` when there are none. */
export function validateLook(look) {
  if (!isPlainObject(look)) return { ok: false, errors: ["look must be an object"] };
  const errors = [...check(SCHEMA, look, ""), ...lightRules(look.lights), ...cameraRules(look.cameras),
    ...fogRules(look.environment)];
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------- merge and resolve
export class LookError extends Error {
  constructor(errors) {
    const shown = errors.slice(0, 4).join("; ");
    super(`The look is not valid: ${shown}${errors.length > 4 ? ` (and ${errors.length - 4} more)` : ""}`);
    this.name = "LookError";
    this.errors = Object.freeze([...errors]);
  }
}

/** A JSON-shaped copy (plain objects and arrays rebuilt), so freezing it never freezes the caller's data. */
function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]));
  return value;
}

function merge(base, partial) {
  if (!isPlainObject(base) || !isPlainObject(partial)) return partial === undefined ? base : partial;
  const out = { ...base };
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value;
  }
  return out;
}

/**
 * The full look for a world: `partial` deep-merged over `base` (objects merge key by key; arrays, null and
 * values replace), validated, copied and deep-frozen. Throws a LookError listing every problem.
 */
export function resolveLook(partial, base = NEUTRAL_LOOK) {
  if (partial !== undefined && partial !== null && !isPlainObject(partial)) throw new LookError(["look must be an object"]);
  const merged = merge(base, partial ?? {});
  const { ok, errors } = validateLook(merged);
  if (!ok) throw new LookError(errors);
  return deepFreeze(copy(merged));
}

// theme/look-schema.js and theme/neutral-look.js (ui-architecture.md 2.7; owner A10).
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MOTION } from "../../static/js/field/timing.js";
import { LOOK_KEYS, LookError, resolveLook, validateLook } from "../../static/js/theme/look-schema.js";
import { NEUTRAL_LOOK } from "../../static/js/theme/neutral-look.js";

/** A mutable deep copy of the neutral look with `edit` applied. */
function variant(edit) {
  const look = JSON.parse(JSON.stringify(NEUTRAL_LOOK));
  edit(look);
  return look;
}

const errorsOf = (look) => validateLook(look).errors;

function deepFrozen(value) {
  if (!value || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}

test("NEUTRAL_LOOK validates and is deep-frozen", () => {
  assert.deepEqual(validateLook(NEUTRAL_LOOK), { ok: true, errors: [] });
  assert.ok(deepFrozen(NEUTRAL_LOOK));
  assert.deepEqual(NEUTRAL_LOOK.cameras.modes.map((m) => m.id), ["sideline", "endzone", "overhead"]);
  assert.equal(NEUTRAL_LOOK.post.bloom, null);
});

test("v1.4 (W6): the neutral look's shadow plays fade out at the snap, as the 2D field's do (play-drawing.md 4)", () => {
  assert.equal(NEUTRAL_LOOK.ghost.afterSnapOpacity, 0);
});

test("G3-9: a Look keeps only the keys something reads: the strokes the plays draw with, no ghost opacity list", () => {
  assert.deepEqual(Object.keys(NEUTRAL_LOOK.strokes), ["arc", "ground", "mark"]);
  assert.deepEqual(Object.keys(NEUTRAL_LOOK.ghost).sort(), ["afterSnapOpacity", "fill", "labels", "stroke", "style"],
    "the shadows' opacities are play-drawing.md's (grammar.js SHADOW_OPACITY); ghost.style is the 2D field's dash");
});

test("G3-1: ghost.tint is optional: absent or fill tints every shadow by ghost.fill, family by the world's ramp", () => {
  assert.equal(NEUTRAL_LOOK.ghost.tint, undefined, "the neutral world keeps one shadow tint");
  for (const tint of ["fill", "family"]) {
    assert.deepEqual(errorsOf(variant((l) => { l.ghost.tint = tint; })), [], tint);
  }
});

test("the look's motion carries every timing.js field plus the ghost and verdict times", () => {
  for (const key of Object.keys(DEFAULT_MOTION)) assert.equal(NEUTRAL_LOOK.motion[key], DEFAULT_MOTION[key], key);
  for (const key of ["ghostInMs", "ghostOutMs", "verdictMs"]) assert.ok(Number.isFinite(NEUTRAL_LOOK.motion[key]), key);
});

test("LOOK_KEYS lists the top-level groups of 2.7", () => {
  assert.deepEqual(LOOK_KEYS, ["id", "version", "renderer", "environment", "lights", "field", "lines", "ball", "strokes",
    "ghost", "lastPlay", "residue", "labels", "post", "cameras", "motion", "teamColor", "world"]);
});

test("each bad field is rejected with its path", () => {
  const cases = [
    [(l) => { l.lights[2].intensity = -1; }, "lights[2].intensity must be >= 0"],
    [(l) => { l.renderer.toneMapping = "filmic"; }, "renderer.toneMapping must be one of none, aces, agx, neutral"],
    [(l) => { l.field.turf[1] = "green"; }, "field.turf[1] must be a #rrggbb color"],
    [(l) => { l.field.turf = ["#000000"]; }, "field.turf must have 2 items"],
    [(l) => { l.cameras.default = "blimp"; }, "cameras.default must name one of cameras.modes (sideline, endzone, overhead)"],
    [(l) => { l.field.logo = true; }, "field.logo is not a Look field"],
    [(l) => { l.extra = {}; }, "extra is not a Look field"],
    [(l) => { delete l.lines.ltg.mode; }, "lines.ltg.mode is missing"],
    [(l) => { l.ghost.opacity = [0.5, 0.3, 0.2]; }, "ghost.opacity is not a Look field"],
    [(l) => { l.ghost.tint = "rainbow"; }, "ghost.tint must be one of fill, family"],
    [(l) => { l.version = 2; }, "version must be 1"],
    [(l) => { l.id = "Bad World"; }, "id must be a lowercase id (a-z, 0-9 and -)"],
    [(l) => { l.strokes.arc.edge = "teal"; }, "strokes.arc.edge must be team, team-alt or a #rrggbb color"],
    [(l) => { l.strokes.fan = l.strokes.arc; }, "strokes.fan is not a Look field"],
    [(l) => { delete l.strokes.mark; }, "strokes.mark is missing"],
    [(l) => { l.strokes.band = l.strokes.arc; }, "strokes.band is not a Look field"],
    [(l) => { l.strokes.arc.dash = [4]; }, "strokes.arc.dash must have 2 items"],
    [(l) => { l.renderer.shadowMapSize = 4096; }, "renderer.shadowMapSize must be one of 1024, 2048"],
    [(l) => { l.environment.fog = { kind: "fancy" }; }, "environment.fog.kind must be one of exp2, linear"],
    [(l) => { l.environment.fog = { kind: "linear", color: "#000000", near: 50, far: 10 }; },
      "environment.fog.far must be greater than environment.fog.near"],
    [(l) => { l.lights[1].id = "ambient"; }, "lights[1].id \"ambient\" is used twice"],
    [(l) => { l.lights.push({ id: "spot", kind: "spot", color: "#ffffff", intensity: 3 }); },
      "lights[3].position is required for spot lights"],
    [(l) => { l.cameras.modes[1].id = "sideline"; }, "cameras.modes[1].id \"sideline\" is used twice"],
    [(l) => { l.cameras.inset = { mode: "nope", rect: [0, 0, 0.3, 0.3] }; },
      "cameras.inset.mode must name one of cameras.modes (sideline, endzone, overhead)"],
    [(l) => { l.cameras.modes[0].fov = 0; }, "cameras.modes[0].fov must be > 1"],
    [(l) => { l.labels.className = "x\" onmouseover=\"y"; }, "labels.className must be CSS class names"],
    [(l) => { l.post.extra = ["led grid"]; }, "post.extra[0] must be a pass name (letters, digits and -)"],
    [(l) => { l.teamColor.against = []; }, "teamColor.against must have at least 1 item"],
    [(l) => { l.motion.airYps = 0; }, "motion.airYps must be > 0"],
    [(l) => { l.world = { pass: () => 1 }; }, "world.pass must be JSON data (no functions)"],
    [(l) => { l.ball.trail.color = "teamish"; }, "ball.trail.color must be team or a #rrggbb color"],
  ];
  for (const [edit, message] of cases) assert.ok(errorsOf(variant(edit)).includes(message), `${message}\n got: ${errorsOf(variant(edit))}`);
});

test("at most two lights may cast shadows (6.1)", () => {
  const look = variant((l) => {
    l.lights = ["a", "b", "c"].map((id) => ({ id, kind: "directional", color: "#ffffff", intensity: 1,
      position: [0, 0, 50], castShadow: true }));
  });
  assert.ok(errorsOf(look).includes("lights: at most 2 lights may cast shadows (found 3)"));
});

test("validateLook refuses a non-object and lists every problem, not just the first", () => {
  assert.deepEqual(validateLook(null), { ok: false, errors: ["look must be an object"] });
  const errors = errorsOf(variant((l) => { l.renderer.exposure = 0; l.field.stripeYd = 7; }));
  assert.ok(errors.length >= 2);
});

test("a world may keep its own data under `world` (plain JSON)", () => {
  assert.deepEqual(errorsOf(variant((l) => { l.world = { towers: 4, kickoff: { night: [1, 2] } }; })), []);
});

test("resolveLook deep-merges a partial over the neutral look: objects merge, arrays and null replace", () => {
  const partial = {
    id: "under-the-lights", field: { turf: ["#3f8c3b", "#46983f"] }, post: { bloom: { strength: 0.5, radius: 0.5, threshold: 1.05 } },
    lights: [{ id: "moon", kind: "ambient", color: "#26314c", intensity: 0.2 }],
    environment: { fog: { kind: "exp2", color: "#0d1424", density: 0.004 } },
  };
  const look = resolveLook(partial);
  assert.equal(look.id, "under-the-lights");
  assert.deepEqual(look.field.turf, ["#3f8c3b", "#46983f"]);
  assert.equal(look.field.stripeYd, NEUTRAL_LOOK.field.stripeYd, "untouched fields keep the base value");
  assert.equal(look.lights.length, 1, "arrays replace");
  assert.equal(look.environment.ibl, null);
  assert.equal(look.post.bloom.threshold, 1.05);
  assert.ok(deepFrozen(look));
  assert.equal(Object.isFrozen(partial.lights), false, "the caller's partial is never frozen");
  assert.deepEqual(resolveLook({ strokes: { arc: { widthPx: 6 } } }).strokes.arc,
    { ...NEUTRAL_LOOK.strokes.arc, widthPx: 6 }, "record entries merge field by field");
});

test("resolveLook with nothing returns the base, and throws a LookError listing every problem", () => {
  assert.deepEqual(resolveLook(undefined), NEUTRAL_LOOK);
  assert.deepEqual(resolveLook(null), NEUTRAL_LOOK);
  assert.throws(() => resolveLook({ renderer: { exposure: -1 }, ghost: { style: "glow" } }), (err) => {
    assert.ok(err instanceof LookError);
    assert.equal(err.name, "LookError");
    assert.ok(err.errors.includes("renderer.exposure must be > 0"));
    assert.ok(err.errors.includes("ghost.style must be one of zone, outline, hatch, pixel, marker"));
    assert.match(err.message, /renderer\.exposure/);
    return true;
  });
  assert.throws(() => resolveLook("dark"), LookError);
  assert.deepEqual(resolveLook({ cameras: { default: "overhead" } }, NEUTRAL_LOOK).cameras.default, "overhead");
});

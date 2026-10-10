// The regulation field (ui-architecture 2.5 field-mesh.js; three-recipe 4; owner A5): turf with every painted
// line (turf.js), the numerals, end zones in the defending teams' exact ESPN primaries with their names painted
// in them, the home logo at midfield, goalposts and pylons (structures.js), and the plinth when the look has one.
// Everything static; about 12 draw calls. Glyphs wait for the world's display font, so `ready` resolves once the
// numerals, wordmarks and logo are in (or failed: a missing logo or font never blocks the field).
import * as THREE from "three";
import { safeHex, safeLogoUrl } from "../core/domain.js";
import { fieldFont, groundDecal, loadFont, logoTexture, numeralAtlas, numeralMesh, paintMaterial,
  wordmarkMasks } from "./decals.js";
import { NFL, endZoneTeams, logoLayout, wordmarkLayout, wordmarkText } from "./field-spec.js";
import { disposeTree } from "./dispose.js";
import { LAYERS } from "./materials.js";
import { createGoalposts, createPlinth, createPylons } from "./structures.js";
import { createTurf, turfGeometry } from "./turf.js";

/** The turf plane without a plinth reaches toward the horizon (fog and the world's bowl hide its edge). */
const OPEN_TURF = Object.freeze([460, 360]);
const PLINTH_TOP = Object.freeze([132, 66]);
const PLINTH_OUTER = Object.freeze([700, 600]);
const LOGO_YD = 11;
const OUTLINE_DARKEN = "#101418";

function endZoneColor(look, team) {
  if (look.field.endZones !== "team") return look.field.turf[0];
  return safeHex(team?.color) ?? look.field.turf[0];
}

/** Outline color for a wordmark: the team's alternate, else a dark rim. */
function outlineColor(team) {
  return safeHex(team?.alt_color) ?? OUTLINE_DARKEN;
}

function addWordmark(look, group, { doc, font, maxAnisotropy }, team, side) {
  const text = wordmarkText(team, look.field.endZoneText);
  if (!text) return;
  const masks = wordmarkMasks(doc, text, font, maxAnisotropy);
  const layout = wordmarkLayout(NFL, side);
  const outline = groundDecal(layout, paintMaterial(look, outlineColor(team), masks.outline));
  const fill = groundDecal(layout, paintMaterial(look, look.field.paint, masks.fill));
  outline.name = `wordmark-${side < 0 ? "left" : "right"}-outline`;
  fill.name = `wordmark-${side < 0 ? "left" : "right"}`;
  fill.renderOrder = LAYERS.decal.order + 0.5;
  group.add(outline, fill);
}

async function addLogo(look, group, { doc, maxAnisotropy, alive }, frame) {
  const home = frame?.teams && typeof frame.field?.home === "string" && Object.hasOwn(frame.teams, frame.field.home)
    ? frame.teams[frame.field.home] : null;
  const url = safeLogoUrl(home?.logo);
  if (!url || !doc?.defaultView?.Image) return;
  const tex = await logoTexture(doc, url, maxAnisotropy);
  if (!tex) return;
  if (!alive()) {
    tex.dispose();
    return;
  }
  const material = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, fog: false,
    roughness: look.field.roughness, metalness: look.field.metalness, polygonOffset: true,
    polygonOffsetFactor: LAYERS.decal.factor, polygonOffsetUnits: LAYERS.decal.units });
  const mesh = groundDecal(logoLayout(LOGO_YD), material);
  mesh.name = "midfield-logo";
  group.add(mesh);
}

async function addGlyphs(look, group, ctx, frame) {
  if (!ctx.doc?.createElement) return;
  await loadFont(ctx.doc, ctx.font);
  if (!ctx.alive()) return;
  if (look.field.numerals) {
    const atlas = numeralAtlas(ctx.doc, ctx.font, ctx.maxAnisotropy);
    group.add(numeralMesh(NFL, paintMaterial(look, look.field.paint, atlas)));
  }
  const ez = endZoneTeams(frame?.field, frame?.teams);
  addWordmark(look, group, ctx, ez.left, -1);
  addWordmark(look, group, ctx, ez.right, 1);
  await addLogo(look, group, ctx, frame);
}

/**
 * @param {object} look  a resolved Look (field, renderer)
 * @param {{ field: object, teams: object } | null} frame  DC A1 `field` and C2 `teams`; null for a bare field
 * @param {{ doc?: Document, maxAnisotropy?: number, onError?: (err: Error) => void }} [deps]  onError: a glyph that
 *   failed to draw (the stage reports it as a "warning"; the field is ready without it)
 * @returns {{ group: THREE.Group, ready: Promise<void>, dispose(): void }}
 */
export function buildField(look, frame, { doc = null, maxAnisotropy = 1, onError = () => {} } = {}) {
  const group = new THREE.Group();
  group.name = "field";
  const ez = endZoneTeams(frame?.field, frame?.teams);
  const turf = createTurf(look, NFL, { left: endZoneColor(look, ez.left), right: endZoneColor(look, ez.right) });
  const top = look.field.plinth ? PLINTH_TOP : OPEN_TURF;
  const turfMesh = new THREE.Mesh(turfGeometry(top), turf.material);
  turfMesh.name = "turf";
  turfMesh.receiveShadow = true;
  turfMesh.renderOrder = LAYERS.turf.order;
  group.add(turfMesh, createGoalposts(NFL, { left: safeHex(ez.left?.color), right: safeHex(ez.right?.color) }),
    createPylons(NFL));
  const plinth = createPlinth(look, top, PLINTH_OUTER);
  if (plinth) group.add(plinth);
  const glyphs = new THREE.Group();
  glyphs.name = "field-glyphs";
  group.add(glyphs);
  const life = { alive: true };
  const ctx = { doc, font: fieldFont(doc), maxAnisotropy, alive: () => life.alive };
  const ready = addGlyphs(look, glyphs, ctx, frame).catch((err) => {
    if (life.alive) onError(err);
  });
  return {
    group, ready, turf,
    /** Free everything the field built, including glyphs that arrive after this (their loads are dropped). */
    dispose() {
      life.alive = false;
      disposeTree(group);
      ready.then(() => disposeTree(glyphs));
    },
  };
}

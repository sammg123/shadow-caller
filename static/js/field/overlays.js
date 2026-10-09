// What sits over the plays (A5 part 2; ui-architecture 14.4 `overlays`, 2.5 markVerdict): the verdict of the caller's
// play on display ("Top pick", "In his top 3", "Miss", model/verdict.js) as a chip under the play's words, and the
// situation the facade last painted (the line of scrimmage, possession), which the ghost layer reads for the shadows'
// team. A chip lives in a slot: "live" (the play on display; the player hands it over and takes it back) or "review"
// (the play Left/Right is showing). The chip is text only, anchored at the play's words and dropped a plate below them
// by the world's CSS (.sc-verdict-chip), so it stays under them in every camera; canvas label renderers (sprite,
// decal) get it one line down the field instead.
//   createOverlays(stage) -> { situation(sit), current(), verdict({ seq, key, label }, { slot, visible }),
//     relabel(slot, { row, label }), clearVerdict(slot), setVisible(slot, on), chip(slot), clear(), dispose() }
import { verdictOf, verdictText } from "../model/verdict.js";
import { fieldLabel, removeLabel, setLabelVisible } from "./play-art.js";
import { chipSpot } from "./play-style.js";

const KEYS = new Set(["top1", "top3", "miss"]);

// The functions below share one context `o` = { stage, st: { sit, chips: { live, review } } }.
function clearVerdict(o, slot) {
  const chip = o.st.chips[slot];
  if (!chip) return;
  removeLabel(o.stage, chip.handle);
  o.st.chips = { ...o.st.chips, [slot]: null };
  o.stage.requestRender();
}

function verdict(o, { seq, key, label } = {}, { slot = "live", visible = true } = {}) {
  clearVerdict(o, slot);
  const text = verdictText(key);
  if (!KEYS.has(key) || !text || !label?.at) return;
  const at = o.stage.labels?.kind === "css2d" ? label.at : chipSpot(label);
  const handle = fieldLabel(o.stage, at, text, `sc-verdict-chip is-${key}`);
  setLabelVisible(handle, visible);
  o.st.chips = { ...o.st.chips, [slot]: { seq, key, text, label, handle } };
  o.stage.requestRender();
}

/** A retag after the chip went up (DC B7): the same play, its words and its grade again. */
function relabel(o, slot, { row, label } = {}) {
  const chip = o.st.chips[slot];
  if (!chip || !row) return;
  const handle = chip.handle;
  const visible = handle?.object?.visible !== false;
  verdict(o, { seq: chip.seq, key: verdictOf(row.pred).key, label: label ?? chip.label }, { slot, visible });
}

/** The overlays layer (scene.js LAYER_FACTORIES). */
export function createOverlays(stage) {
  const o = { stage, st: { sit: null, chips: { live: null, review: null } } };
  const clear = () => {
    clearVerdict(o, "live");
    clearVerdict(o, "review");
    o.st.sit = null;
  };
  return {
    situation(sit) {
      o.st.sit = sit && typeof sit === "object" ? sit : null;
    },
    current: () => o.st.sit,
    verdict: (v, opts) => verdict(o, v, opts),
    relabel: (slot, change) => relabel(o, slot, change),
    clearVerdict: (slot = "live") => clearVerdict(o, slot),
    setVisible(slot, on) {
      setLabelVisible(o.st.chips[slot]?.handle, on);
      stage.requestRender();
    },
    chip: (slot = "live") => {
      const c = o.st.chips[slot];
      return c ? { seq: c.seq, key: c.key, text: c.text, label: c.label } : null;
    },
    clear,
    dispose: clear,
  };
}

// What sits over the plays (A5 part 2; ui-architecture 14.4 `overlays`, 2.5 markVerdict): the verdict of the caller's
// play on display as a chip under the play's words, and the situation the facade last painted (the line of scrimmage,
// possession), which the ghost layer reads for the shadows' team. The chip says what was graded when the conductor
// sends its words (G2-7: "In his top 3 · #2 Intermediate · 39%", model/vm-field.js verdictChipText), else its plain
// words ("Top pick", "In his top 3", "Miss", model/verdict.js). A chip lives in a slot: "live" (the play on display;
// the player hands it over and takes it back) or "review" (the play Left/Right is showing). The chip is text only,
// anchored at the play's words and dropped a plate below them by the world's CSS (.sc-verdict-chip), so it stays under
// them in every camera; canvas label renderers (sprite, decal) get it one line down the field instead.
//   createOverlays(stage) -> { situation(sit), current(), verdict({ seq, key, label, text? }, { slot, visible }),
//     retext(slot, seq, text), relabel(slot, { row, label }), clearVerdict(slot), setVisible(slot, on), chip(slot),
//     clear(), dispose() }
import { verdictOf, verdictText } from "../model/verdict.js";
import { verdictChipText } from "../model/vm-field.js";
import { fieldLabel, removeLabel, setLabelVisible } from "./play-art.js";
import { chipSpot } from "./play-style.js";

const KEYS = new Set(["top1", "top3", "miss"]);
const wordsOf = (key, text) => (typeof text === "string" && text.trim() !== "" ? text : verdictText(key));

// The functions below share one context `o` = { stage, st: { sit, chips: { live, review } } }.
function clearVerdict(o, slot) {
  const chip = o.st.chips[slot];
  if (!chip) return;
  removeLabel(o.stage, chip.handle);
  o.st.chips = { ...o.st.chips, [slot]: null };
  o.stage.requestRender();
}

function verdict(o, { seq, key, label, text } = {}, { slot = "live", visible = true } = {}) {
  clearVerdict(o, slot);
  const words = KEYS.has(key) ? wordsOf(key, text) : "";
  if (!words || !label?.at) return;
  const at = o.stage.labels?.kind === "css2d" ? label.at : chipSpot(label);
  const handle = fieldLabel(o.stage, at, words, `sc-verdict-chip is-${key}`);
  setLabelVisible(handle, visible);
  o.st.chips = { ...o.st.chips, [slot]: { seq, key, text: words, label, handle } };
  o.stage.requestRender();
}

const shows = (chip) => chip.handle?.object?.visible !== false;

/** G2-7: the same chip, reworded (the conductor's words for what was graded arrive after the player put it up). */
function retext(o, slot, seq, text) {
  const chip = o.st.chips[slot];
  if (!chip || chip.seq !== seq || chip.text === wordsOf(chip.key, text)) return;
  verdict(o, { seq, key: chip.key, label: chip.label, text }, { slot, visible: shows(chip) });
}

/**
 * A retag after the chip went up (DC B7): the same play, its words and its grade again, from the row's new pred. The
 * chip keeps the kind of words it was given: what was graded (G2-7) is worked out again, plain words stay plain.
 */
function relabel(o, slot, { row, label } = {}) {
  const chip = o.st.chips[slot];
  if (!chip || !row) return;
  const detailed = chip.text !== verdictText(chip.key);
  verdict(o, { seq: chip.seq, key: verdictOf(row.pred).key, label: label ?? chip.label,
    ...(detailed ? { text: verdictChipText(row.pred) } : {}) }, { slot, visible: shows(chip) });
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
    retext: (slot, seq, text) => retext(o, slot, seq, text),
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

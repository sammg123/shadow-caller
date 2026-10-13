// The Model Report's moves between its boards (no DOM of its own; restructure-v2.md 11 decision 4, docs/design/
// analyst-ui.md 5). The ribbon's switch picks whose sections the boards show (with both play-callers tracked); a drive
// button or an analyst's cite switches to that call's caller when it isn't the one shown, re-renders at once so the
// row is there, then brings the row into view, or the play's drive on the drive chart when it has no row
// (report/model/cite.js). The pick reaches the boards as pv.sideChoice through the scheduler's extras.
import { citeTarget } from "./model/cite.js";

/** The viewer's pick of a caller's sections: null until he picks (then the first caller the server names shows). */
export function createSideChoice() {
  let team = null;
  return Object.freeze({
    get: () => team,
    /** @returns {boolean} true when the pick changed */
    set(next) {
      if (typeof next !== "string" || !next || next === team) return false;
      team = next;
      return true;
    },
  });
}

/**
 * @param {{ reveal: { show(seq: number): boolean, showDrive(idx: number): boolean },
 *   view: () => { presented: object | null, tl: object | null }, render: () => void }} deps
 *   reveal: report/ui/reveal.js; view: the presented state and timeline now; render: re-render the boards at once
 * @returns {{ showSide(team: string): void, revealCall(seq: number): boolean,
 *   extras(): { sideChoice: string | null } }}
 *   revealCall: false when the play is nowhere on the page
 */
export function createMoves({ reveal, view, render }) {
  const choice = createSideChoice();
  const showSide = (team) => {
    if (choice.set(team)) render();
  };
  const revealCall = (seq) => {
    const target = citeTarget({ ...view(), sideChoice: choice.get() }, Number(seq));
    if (target.side) showSide(target.side);
    if (reveal.show(target.seq)) return true;
    return target.drive !== null && reveal.showDrive(target.drive);
  };
  return Object.freeze({ showSide, revealCall, extras: () => ({ sideChoice: choice.get() }) });
}

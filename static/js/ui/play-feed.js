// Play feed (ui-architecture.md 2.6, 5.4; owner A8). Renders playsVm: every play drawn so far, both teams, newest
// first and grouped by drive under a header with the drive's team, result and summary. The caller's snaps carry the
// call (as logged, retags included) and the verdict: top pick, in his top 3, or miss. Every row that draws something
// is a button (G18): it shows that play on the field (actions.reviewAt), and pressing the reviewed row again goes
// back to live. Rows are reconciled by seq, so new plays never rebuild old rows and a focused row keeps focus.
// Text only (G27): ESPN's play text goes in through textContent.
import { el, reconcile, setAttr, setData, setHidden, setText } from "./dom.js";

const ROW_PARTS = new WeakMap();
const GROUP_PARTS = new WeakMap();

function onRowPress(li, actions) {
  const item = ROW_PARTS.get(li)?.item;
  if (!item) return;
  if (item.reviewing) actions.exitReview();
  else actions.reviewAt(item.seq);
}

function rowParts(copy) {
  return {
    time: el("span", { cls: ["sc-pf-time", "sc-num"] }),
    team: el("span", { cls: "sc-pf-team" }),
    sit: el("span", { cls: "sc-pf-sit" }),
    noPlay: el("span", { cls: "sc-pf-noplay", text: copy.noPlay }),
    result: el("span", { cls: ["sc-pf-result", "sc-num"] }),
    text: el("span", { cls: "sc-pf-text" }),
    verdict: el("span", { cls: "sc-pf-verdict" }),
    callName: el("span", { cls: "sc-pf-callname" }),
    retagged: el("span", { cls: "sc-pf-retagged", text: copy.retagged }),
  };
}

function createRow(item, ctx) {
  const copy = ctx.copy.PLAYS;
  const p = rowParts(copy);
  const call = el("span", { cls: "sc-pf-call" }, [p.verdict, p.callName, p.retagged]);
  const inner = [el("span", { cls: "sc-pf-meta" }, [p.time, p.team, p.sit, p.noPlay]), p.result, p.text, call];
  const control = item.reviewable
    ? el("button", { cls: "sc-pf-btn", attrs: { type: "button" } }, inner)
    : el("div", { cls: "sc-pf-btn" }, inner);
  const li = el("li", { cls: "sc-pf-row", data: { testid: "play-row" } }, [control]);
  if (item.reviewable) control.addEventListener("click", () => onRowPress(li, ctx.actions));
  ROW_PARTS.set(li, { ...p, call, control, item });
  return li;
}

function updateRow(li, item, newest, copy) {
  const p = ROW_PARTS.get(li);
  ROW_PARTS.set(li, { ...p, item });            // the click handler reads the newest item
  for (const key of ["seq", "id", "kind", "team", "caller", "verdict", "nullified", "retagged", "scoring", "reviewing"]) {
    setData(li, key, item[key]);
  }
  setData(li, "newest", item.seq === newest);
  setText(p.time, item.time);
  setText(p.team, item.team);
  setText(p.sit, item.situation);
  setHidden(p.noPlay, !item.nullified);
  setText(p.result, item.result);
  setText(p.text, item.text);
  setHidden(p.call, !item.verdictText && !item.call);
  setText(p.verdict, item.verdictText);
  setText(p.callName, item.call);
  setHidden(p.callName, !item.call || item.call === item.text);   // hand-entered rows already read as the call
  setHidden(p.retagged, !item.retagged);
  if (p.control.localName === "button") {
    setAttr(p.control, "aria-pressed", item.reviewing ? "true" : "false");
    setAttr(p.control, "title", item.reviewing ? copy.reviewing : copy.review);
  }
}

function createGroup() {
  const team = el("span", { cls: "sc-pf-gteam" });
  const result = el("span", { cls: "sc-pf-gresult" });
  const summary = el("span", { cls: "sc-pf-gsum" });
  const rows = el("ol", { cls: "sc-pf-rows" });
  const li = el("li", { cls: "sc-pf-group" }, [el("div", { cls: "sc-pf-ghead" }, [team, result, summary]), rows]);
  GROUP_PARTS.set(li, { team, result, summary, rows });
  return li;
}

/** A group's key: its drive and its oldest row, which never changes while newer rows join the group. */
const groupKey = (g) => `${g.idx}:${g.rows.length ? g.rows[g.rows.length - 1].seq : "-"}`;

function updateGroup(li, group, ctx, newest) {
  const p = GROUP_PARTS.get(li);
  const copy = ctx.copy.PLAYS;
  setData(li, "drive", group.idx);
  setData(li, "team", group.team);
  setData(li, "caller", group.caller);
  setData(li, "complete", group.complete);
  setText(p.team, group.team);
  setText(p.result, group.complete ? group.resultText : copy.inProgress);
  setText(p.summary, group.summary);
  reconcile(p.rows, group.rows, { key: (r) => r.seq, create: (r) => createRow(r, ctx),
    update: (node, r) => updateRow(node, r, newest, copy) });
}

/**
 * @param {HTMLElement} root  #rg-plays
 * @param {{ actions: object, copy: object }} ctx
 * @returns {{ update(vm: object): void, destroy(): void }}
 */
export function mount(root, ctx) {
  const copy = ctx.copy.PLAYS;
  const title = el("h2", { cls: "sc-panel-title", text: copy.heading });
  const note = el("p", { cls: "sc-pf-unlinked", data: { testid: "unlinked-note" } });
  const empty = el("p", { cls: "sc-pf-empty", text: copy.empty });
  const list = el("ol", { cls: "sc-pf-feed", attrs: { "aria-label": copy.heading }, data: { testid: "play-feed" } });
  const box = el("div", { cls: "sc-plays" }, [title, note, empty, list]);
  root.appendChild(box);
  return {
    update(vm) {
      setText(title, vm.heading);
      setAttr(list, "aria-label", vm.heading);
      setText(note, vm.unlinkedNote);
      setHidden(note, !vm.unlinkedNote);
      setHidden(empty, vm.rows.length > 0);
      const newest = vm.rows.length ? vm.rows[0].seq : null;
      reconcile(list, vm.groups, { key: groupKey, create: () => createGroup(),
        update: (node, g) => updateGroup(node, g, ctx, newest) });
    },
    destroy() {
      box.remove();
    },
  };
}

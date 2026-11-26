import { agents, panes, spaces, terminals, shared, run, openOverlay, closeOverlay, props } from "herdr";
import { RECENT, KEPT } from "./recent.js";
import { asleepTerminal } from "./resume.js";
import { shownName } from "./marks.js";
import { DIALOG } from "./ui.js";

export const REVEAL_MS = 140;
export const SWITCH_ROWS = 10;
const ASLEEP_PROGRAM = Object.freeze({ key: "claude", icon: "icons/claude.svg" });

export function switchOrder(recent, live, asleep) {
  const rank = new Map((Array.isArray(recent) ? recent : []).map((address, i) => [address, i]));
  const by = (x) => rank.get(x.address) ?? KEPT + x.i;
  return [
    ...live.map((a, i) => ({ address: a.address, i, program: a.program })).toSorted((x, y) => by(x) - by(y)),
    ...asleep.map((k) => ({ address: k.address, program: ASLEEP_PROGRAM, asleep: true })),
  ];
}

const spaceOfTab = (tab) => spaces().find((s) => (s.tabs ?? []).some((t) => t.id === tab)) ?? null;
const placeOf = (address) => {
  const space = spaceOfTab(panes().find((p) => p.terminal === address)?.tab);
  return space ? [space.name, space.machine].filter(Boolean).join(" \u{b7} ") : null;
};

export function switchRows() {
  const order = switchOrder(shared(RECENT), agents(), terminals().filter(asleepTerminal));
  return order.map((s) => ({ ...s, name: shownName(s.address, panes().find((p) => p.terminal === s.address)), place: placeOf(s.address) }));
}

export function land(row) {
  closeOverlay(props()?.overlay);
  if (!row) return;
  if (!row.asleep) { run("pane.focus", { terminal: row.address }); return; }
  const space = spaceOfTab(panes().find((p) => p.terminal === row.address)?.tab);
  openOverlay({ mod: "kanso-sleep", kind: "dialog", width: DIALOG.wide, props: { wake: { space: space?.id, terminal: row.address } } });
}

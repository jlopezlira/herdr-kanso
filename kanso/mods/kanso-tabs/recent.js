import { agents, focused, shared, setShared, panes, spaces, run, openOverlay } from "herdr";
import { DIALOG } from "./ui.js";

export const RECENT = "kanso.recent";
export const KEPT = 50;

export const recentWith = (list, address, live) => [address, ...(Array.isArray(list) ? list : []).filter((a) => a !== address && live.has(a))].slice(0, KEPT);

export function currentAgent(live = new Set(agents().map((a) => a.address))) {
  const at = focused();
  return [at?.agent, at?.terminal].find((address) => live.has(address)) ?? null;
}

export function noteFocus() {
  const live = new Set(agents().map((a) => a.address));
  const now = currentAgent(live);
  const list = shared(RECENT);
  if (!now || (Array.isArray(list) && list[0] === now)) return;
  setShared(RECENT, recentWith(list, now, live));
}

export const spaceOfTab = (tab) => spaces().find((s) => (s.tabs ?? []).some((t) => t.id === tab)) ?? null;

export function land(row) {
  if (!row) return;
  if (!row.asleep) { run("pane.focus", { terminal: row.address }); return; }
  const space = spaceOfTab(panes().find((p) => p.terminal === row.address)?.tab);
  openOverlay({ mod: "kanso-sleep", kind: "dialog", width: DIALOG.wide, props: { wake: { space: space?.id, terminal: row.address } } });
}

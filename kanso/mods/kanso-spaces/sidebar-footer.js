import { button, failureBlock, row, stack } from "./kit.js";
import { stateBlockPx } from "./ui-state.js";
import { REFUSAL_LINES, footerHeight, railHeight, refusalBlock } from "./footer-model.js";

// The update's one icon: the footer row that runs it and every notice about it.
export const updateIcon = "lu-refresh-cw";
const icon = (label, name, busy = false) => button({ label, kind: "icon", size: "lg", icon: name, spin: busy, disabled: busy });
// Proposed: `menu`, Settings' menu, drawn, open over it; shut, Settings is its row or Button alone.
const settings = (collapsed, menu) => {
  const own = collapsed ? icon("Settings", "lu-settings") : row({ icon: "lu-settings", name: "Settings", names: true, nameInk: "muted" });
  return menu ? stack({ variant: "footer settings" }, own, stack({ variant: "footer menu" }, menu)) : own;
};
// Its rows, open or in the rail: the update's while one is offered, then Settings'.
export const ADD_COMPUTER = { label: "Add a computer", icon: "lu-server" };
const addComputer = (collapsed) => (collapsed ? icon(ADD_COMPUTER.label, ADD_COMPUTER.icon)
  : row({ icon: ADD_COMPUTER.icon, name: ADD_COMPUTER.label, names: true, nameInk: "muted" }));
export const footerRows = ({ update = null, machine = false } = {}) => 1 + (update ? 1 : 0) + (machine ? 1 : 0);
const REFUSED_PX = stateBlockPx(refusalBlock("words"), REFUSAL_LINES);
export const footerPx = (update, refused = null, open = true, machine = false) => {
  const rows = footerRows({ update, machine });
  return open ? footerHeight(rows, update && refused ? REFUSED_PX : 0) : railHeight(rows);
};
// `update`: the row's words. Proposed: `busy`, the update runs, so its row is quiet; `refused`, the failure block's words when it did not update,
// under its row with Update to try again; `collapsed`, the rail's column, where neither words nor the refusal fit.
export const sidebarFooter = ({ update = null, busy = false, refused = null, menu = null, collapsed = false, machine = false } = {}) => {
  const shown = update && refused && !busy ? refused : null;
  const height = footerPx(update, shown, !collapsed, machine);
  const slots = [update && "update", shown && !collapsed && "refused", machine && "machine", "settings"].filter(Boolean);
  return collapsed
    ? stack({ variant: "rail footer", height, slots }, update ? icon(update, updateIcon, busy) : null, machine ? addComputer(true) : null, settings(true, menu))
    : stack({ variant: "footer", height, slots }, update ? row({ icon: updateIcon, name: update, busy, dimmed: busy, names: true, nameInk: busy ? "dim" : "muted" }) : null,
      shown ? stack({ variant: "footer refusal" }, failureBlock(shown)) : null, machine ? addComputer(false) : null, settings(false, menu));
};

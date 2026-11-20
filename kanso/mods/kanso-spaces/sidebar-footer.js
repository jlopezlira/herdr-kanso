// The sidebar's Footer: kansō's update while one is offered, then Settings; collapsed, their icon Buttons in the rail.
import { button, failureBlock, row, stack } from './kit.js';
import { stateBlockPx } from './ui-state.js';
import { REFUSAL_LINES, footerHeight, railHeight, refusalBlock } from './footer-model.js';

// The update's one icon: the footer row that runs it and every notice about it.
export const updateIcon = 'lu-refresh-cw';
const icon = (label, name, busy = false) => button({ label, kind: 'icon', size: 'lg', icon: name, spin: busy, disabled: busy });
// Proposed: `menu`, Settings' menu, drawn, open over it; shut, Settings is its row or Button alone.
const settings = (collapsed, menu) => {
  const own = collapsed ? icon('Settings', 'lu-settings') : row({ icon: 'lu-settings', name: 'Settings', names: true, nameInk: 'muted' });
  return menu ? stack({ variant: 'footer settings' }, own, stack({ variant: 'footer menu' }, menu)) : own;
};
// Its rows, open or in the rail: the update's while one is offered, then Settings'.
export const footerRows = ({ update = null } = {}) => (update ? 2 : 1);
const REFUSED_PX = stateBlockPx(refusalBlock('words'), REFUSAL_LINES);
export const footerPx = (update, refused = null, open = true) => {
  const rows = footerRows({ update });
  return open ? footerHeight(rows, update && refused ? REFUSED_PX : 0) : railHeight(rows);
};
// `update`: the row's words. Proposed: `busy`, the update runs, so its row is quiet; `refused`, the failure block's words when it did not update,
// under its row with Update to try again; `collapsed`, the rail's column, where neither words nor the refusal fit.
export const sidebarFooter = ({ update = null, busy = false, refused = null, menu = null, collapsed = false } = {}) => {
  const shown = update && refused && !busy ? refused : null;
  const height = footerPx(update, shown, !collapsed);
  return collapsed
    ? stack({ variant: 'rail footer', height }, update ? icon(update, updateIcon, busy) : null, settings(true, menu))
    : stack({ variant: 'footer', height }, update ? row({ icon: updateIcon, name: update, busy, dimmed: busy, names: true, nameInk: busy ? 'dim' : 'muted' }) : null,
      shown ? stack({ variant: 'footer refusal' }, failureBlock(shown)) : null, settings(false, menu));
};

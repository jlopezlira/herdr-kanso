// The sidebar's Footer: kansō's update while one is offered, then Settings; collapsed, their icon Buttons in the rail.
import { button, failureBlock, row, stack } from './kit.js';

// The update's one icon: the footer row that runs it and every notice about it.
export const updateIcon = 'lu-refresh-cw';
const icon = (label, name, busy = false) => button({ label, kind: 'icon', size: 'lg', icon: name, spin: busy, disabled: busy });
// Proposed: `menu`, Settings' menu, drawn, open over it; shut, Settings is its row or Button alone.
const settings = (collapsed, menu) => {
  const own = collapsed ? icon('Settings', 'lu-settings') : row({ icon: 'lu-settings', name: 'Settings', names: true, nameInk: 'muted' });
  return menu ? stack({ variant: 'footer settings' }, own, stack({ variant: 'footer menu' }, menu)) : own;
};
// Its rows, open or in the rail: the update's while one is offered, then Settings'. Herdr fits the footer's height to them.
export const footerRows = ({ update = null } = {}) => (update ? 2 : 1);
// `update`: the row's words. Proposed: `busy`, the update runs, so its row is quiet; `refused`, the failure block's words when it did not update,
// under its row with Update to try again; `collapsed`, the rail's column, where neither words nor the refusal fit.
export const sidebarFooter = ({ update = null, busy = false, refused = null, menu = null, collapsed = false } = {}) => collapsed
  ? stack({ variant: 'rail footer' }, update ? icon(update, updateIcon, busy) : null, settings(true, menu))
  : stack({ variant: 'footer' }, update ? row({ icon: updateIcon, name: update, busy, dimmed: busy, names: true, nameInk: busy ? 'dim' : 'muted' }) : null,
    update && refused && !busy ? stack({ variant: 'footer refusal' }, failureBlock(refused)) : null, settings(false, menu));

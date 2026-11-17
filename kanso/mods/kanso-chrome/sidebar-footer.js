// The sidebar's Footer: kansō's update while one is offered, then Settings; collapsed, their icon Buttons in the rail.
import { button, failureBlock, row, stack } from './kit.js';

// The update's one icon: the footer row that runs it and every notice about it.
export const updateIcon = 'lu-refresh-cw';
const icon = (label, name) => button({ label, kind: 'icon', size: 'lg', icon: name });
// Proposed: `menu`, Settings' menu, drawn, open over it.
const settings = (collapsed, menu) => stack({ variant: 'footer settings' },
  collapsed ? icon('Settings', 'lu-settings') : row({ icon: 'lu-settings', name: 'Settings' }), menu ? stack({ variant: 'footer menu' }, menu) : null);
// `update`: the row's words. Proposed: `busy`, the update runs, so its row is quiet; `refused`, the failure block's words when it did not update,
// under its row with Update to try again; `collapsed`, the rail's column, where neither words nor the refusal fit.
export const sidebarFooter = ({ update = null, busy = false, refused = null, menu = null, collapsed = false } = {}) => collapsed
  ? stack({ variant: 'rail footer' }, update ? icon(update, updateIcon) : null, settings(true, menu))
  : stack({ variant: 'footer' }, update ? row({ icon: updateIcon, name: update, dimmed: busy }) : null,
    update && refused && !busy ? stack({ variant: 'footer refusal' }, failureBlock(refused)) : null, settings(false, menu));

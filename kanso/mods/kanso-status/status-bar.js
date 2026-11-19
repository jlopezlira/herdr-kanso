// The status bar: two halves around panes per view. A computer stands in for its sidebar row; the rest are the bar's items and Buttons.
import { button, failureLine, phrase, stack, statusItem } from './kit.js';

// Unreachable is said in words with Refresh, `detail` the source's words; folded, the name gives way to its icon.
export const computerItem = ({ name, remote = true, state = 'on', folded = false, detail = null }) => state === 'unreachable'
  ? failureLine({ text: phrase("Can't reach", name), fix: 'Refresh', detail })
  : statusItem({ icon: remote ? 'lu-server' : 'lu-monitor', text: folded ? null : name, pending: state === 'pending' });

// The command palette's only pointer door; its key is in the tooltip.
export const paletteDoor = ({ tip }) => button({ label: 'Command palette', kind: 'icon', size: 'sm', icon: 'lu-command', tip });
export const layoutPaused = ({ detail = null } = {}) => failureLine({ text: 'Layout paused', fix: 'Resume', detail });

// One part of the bar: its left or right half, each folding its own items, or the middle slot of panes per view.
// The app draws the bar in three blocks, each with one part, so a part with nothing in it takes no room there.
const statusPart = (part, items) => stack({ variant: phrase('status bar', part) }, items);
export const statusBar = ({ left = [], middle = null, right = [], popup = null } = {}) => stack({ variant: 'status bar', grid: true },
  statusPart('left', left), statusPart('middle', middle), statusPart('right', right), popup ? stack({ variant: 'status bar popup' }, popup) : null);

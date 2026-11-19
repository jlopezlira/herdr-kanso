// The view switch: the sidebar's three views, a track of Tabs when open, one Button with their Menu when collapsed.
import { button, menu, phrase, stack, tabs } from './kit.js';

export const views = [
  { key: 'spaces', label: 'Projects', icon: 'lu-folder' },
  { key: 'agents', label: 'Status', icon: 'lu-activity' },
  { key: 'threads', label: 'Threads', icon: 'lu-message-square' },
];
// Proposed: `asks`, someone needs you, so Status carries the dot, and its Mark in the menu; `tips`, each view's tooltip by key, with its key.
const shown = ({ asks, tips }) => views.map((item) => ({ ...item, dot: asks && item.key === 'agents', tip: tips[item.key] }));
// Collapsed, one button for the current view opens the menu of all three.
// Proposed: `carry`, while someone needs you and Status is not on show, the button carries the dot, and its tooltip and spoken name say so.
const asking = (item, calls) => (calls ? { label: phrase(item.label, '·', 'Someone needs you'), tip: phrase(item.tip || item.label, '·', 'Someone needs you') } : { label: item.label, tip: item.tip });
export const viewSwitch = ({ view = 'spaces', column = false, open = false, asks = false, carry = false, tips = {} } = {}) => {
  const items = shown({ asks, tips });
  if (!column) return stack({ variant: 'view switch' }, tabs({ items, value: view, size: 'sm', track: true, label: true }));
  const current = items.find((item) => item.key === view) ?? items[0];
  const calls = carry && asks && current.key !== 'agents';
  const choices = items.map(({ key, label, icon, dot }) => ({ key, label, icon, selected: key === current.key, mark: dot ? 'blocked' : null }));
  const list = open ? stack({ variant: 'view menu' }, menu({ items: choices })) : null;
  const own = button({ ...asking(current, calls), kind: 'icon', size: 'lg', icon: current.icon, active: open });
  return stack({ variant: 'view switch' }, calls ? stack({ variant: 'view button' }, own) : own, list);
};

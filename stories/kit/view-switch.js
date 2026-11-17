// The view switch: the sidebar's three views, a track of Tabs when open, one Button with their Menu when collapsed.
import { button, menu, stack, tabs } from './kit.js';

export const views = [
  { key: 'spaces', label: 'Projects', icon: 'lu-folder' },
  { key: 'agents', label: 'Status', icon: 'lu-activity' },
  { key: 'threads', label: 'Threads', icon: 'lu-message-square' },
];
// Proposed: `asks`, someone needs you, so Status carries the dot, and its Mark in the menu; `tips`, each view's tooltip by key, with its key.
const shown = ({ asks, tips }) => views.map((item) => ({ ...item, dot: asks && item.key === 'agents', tip: tips[item.key] }));
// Collapsed, one button for the current view opens the menu of all three.
export const viewSwitch = ({ view = 'spaces', column = false, open = false, asks = false, tips = {} } = {}) => {
  const items = shown({ asks, tips });
  if (!column) return stack({ variant: 'view switch' }, tabs({ items, value: view, size: 'sm', track: true, label: true }));
  const current = items.find((item) => item.key === view) ?? items[0];
  const choices = items.map(({ key, label, icon, dot }) => ({ key, label, icon, selected: key === current.key, mark: dot ? 'blocked' : null }));
  const list = open ? stack({ variant: 'view menu' }, menu({ items: choices })) : null;
  return stack({ variant: 'view switch' }, button({ label: current.label, kind: 'icon', size: 'lg', icon: current.icon, active: open, tip: current.tip }), list);
};

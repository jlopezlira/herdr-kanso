// The kit's compositions: each one only calls pieces with its own props and draws no markup.
import { avatar, button, chip, dawn, grow, list, mark, menu, row, stack, tabs, windowControls } from './pieces.js';

const tool = (icon, label) => button({ label, kind: 'icon', size: 'lg', icon });
const more = (open) => stack({ variant: 'toolbar group', open }, tool(open ? 'lu-chevron-up' : 'lu-chevron-down', open ? 'Fewer tools' : 'More tools'), open ? [tool('lu-arrow-up-down', 'Sort'), tool('lu-search', 'Search')] : null);
export const toolbar = ({ column = false, open = false } = {}) => column
  ? stack({ variant: 'toolbar', column }, tool('lu-panel-left', 'Show sidebar'), tool('lu-plus', 'New'), more(open))
  : stack({ variant: 'toolbar' }, tool('lu-plus', 'New'), grow(), tool('lu-arrow-up-down', 'Sort'), tool('lu-search', 'Search'), tool('lu-panel-left', 'Hide sidebar'));

// Sidebar compositions: each one is the Row, Tab, Menu, Avatar, Mark, Chip or Button in its own configuration.
const icon = (name, label) => ({ icon: name, label });

export const sessionRow = ({ program = 'p-claude', name, activity = null, time = null, place = null, status = 'working', depth = 1, current = false, pinned = false, commands = 0, hover = false, focus = false, dimmed = false }) => row({
  icon: program, name, second: activity, detail: place, meta: time, mark: status, depth, current, dimmed, hover, focus,
  glint: status === 'working', flag: pinned ? 'lu-pin' : null, chip: commands, actions: [icon('lu-pin', 'Pin to the top'), icon('lu-ellipsis', 'More')],
});

export const projectRow = ({ name, folder = null, branch = null, sync = null, open = false, status = 'blocked', count = 0, hover = false, focus = false }) => row({
  name, heading: true, current: open, hover, focus, detail: [folder, branch && { icon: 'lu-git-branch', text: branch }, sync],
  mark: count ? status : 'none', meta: count ? String(count) : null, actions: [icon('lu-plus', 'New agent in ' + name), icon('lu-ellipsis', 'More')],
});

export const computerStates = ['on', 'off', 'unreachable'];
export const computerRow = ({ name, remote = true, state = 'on', status = 'blocked', count = 0, hover = false, focus = false }) => row({
  icon: remote ? 'lu-server' : 'lu-monitor', name, heading: true, hover, focus,
  mark: count ? status : 'none', meta: count ? String(count) : null,
  action: state === 'off' ? { kind: 'icon', ...icon('lu-power', 'Turn ' + name + ' on') } : state === 'unreachable' ? { kind: 'icon', ...icon('lu-refresh-cw', 'Refresh') } : null,
  actions: state === 'on' && remote ? [icon('lu-power', 'Turn off'), icon('lu-plus', 'New project on ' + name), icon('lu-arrow-right-left', 'Sync')] : [],
});

export const section = ({ title, status = 'none', count = 0 }) => row({ name: title, heading: true, mark: status, meta: count ? String(count) : null });

export const asleep = ({ names = [], open = false } = {}) => list(row({ name: 'Asleep', heading: true, mark: 'asleep', meta: open ? null : String(names.length) }),
  open ? names.map((name) => row({ name, depth: 1, dimmed: true, action: { label: 'Wake', kind: 'quiet' } })) : null);

export const views = [
  { key: 'spaces', label: 'Projects', icon: 'lu-folder' },
  { key: 'agents', label: 'Status', icon: 'lu-activity' },
  { key: 'threads', label: 'Threads', icon: 'lu-message-square' },
];
// Collapsed, one button for the current view opens the menu of all three.
export const viewSwitch = ({ view = 'spaces', column = false, open = false } = {}) => {
  if (!column) return stack({ variant: 'view switch' }, tabs({ items: views, value: view, size: 'sm', track: true, label: true }));
  const current = views.find((item) => item.key === view) ?? views[0];
  const list = open ? stack({ variant: 'view menu' }, menu({ items: views.map((item) => ({ ...item, selected: item.key === current.key })) })) : null;
  return stack({ variant: 'view switch' }, button({ label: current.label, kind: 'icon', size: 'lg', icon: current.icon, active: open }), list);
};

export const sidebarFooter = ({ update = null } = {}) => stack({ variant: 'footer' }, update ? row({ icon: 'lu-refresh-cw', name: update }) : null, row({ icon: 'lu-settings', name: 'Settings' }), row({ icon: 'lu-server', name: 'Add computer' }));

export const tile = ({ initial = null, tone = 'teal', status = 'none', count = 0, open = false }) => stack({ variant: 'rail tile', on: open },
  initial ? avatar({ initial, tone, size: 'md' }) : mark({ status, size: 'lg' }), count ? chip({ label: count, quiet: true, tone: status === 'blocked' ? 'blocked' : null }) : null);

// Cells

export const header = ({ collapsed = false, dawn: early = false, open = false } = {}) => stack({ variant: 'header', collapsed },
  early ? dawn() : null, stack({ variant: 'header title' }, windowControls()), toolbar({ column: collapsed, open }));

// The rows and tiles of the current view come in drawn; the sidebar only places them.
export const sidebar = ({ collapsed = false, dawn: early = false, view = 'spaces', switcher = true, menu: open = false, rows = [], tiles = [] } = {}) => collapsed
  ? stack({ variant: 'rail' }, header({ collapsed, dawn: early }), switcher ? viewSwitch({ view, column: true, open }) : null, stack({ variant: 'rail list' }, tiles), stack({ variant: 'rail footer' }, tool('lu-settings', 'Settings')))
  : stack({ variant: 'sidebar' }, header({ dawn: early }), switcher ? viewSwitch({ view }) : null, stack({ variant: 'rows' }, rows), sidebarFooter());

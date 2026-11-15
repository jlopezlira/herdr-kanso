// The kit's compositions: each one only calls pieces with its own props and draws no markup.
import { avatar, button, chip, dawn, grow, mark, menu, row, stack, tabs, windowControls } from './pieces.js';

const tool = (icon, label) => button({ label, kind: 'icon', size: 'lg', icon });
const more = (open) => stack({ variant: 'toolbar group', open }, tool(open ? 'lu-chevron-up' : 'lu-chevron-down', open ? 'Fewer tools' : 'More tools'), open ? tool('lu-arrow-up-down', 'Sort') + tool('lu-search', 'Search') : '');
export const toolbar = ({ column = false, open = false } = {}) => column
  ? stack({ variant: 'toolbar', column }, tool('lu-panel-left', 'Show sidebar'), tool('lu-plus', 'New'), more(open))
  : stack({ variant: 'toolbar' }, tool('lu-plus', 'New'), grow(), tool('lu-arrow-up-down', 'Sort'), tool('lu-search', 'Search'), tool('lu-panel-left', 'Hide sidebar'));

// Sidebar compositions: each one is the Row, Tab, Menu, Avatar, Mark, Chip or Button in its own configuration.
const icon = (name, label) => ({ icon: name, label });

export const sessionRow = ({ program = 'p-claude', name, activity = '', time = '', place = '', status = 'working', depth = 1, current = false, pinned = false, commands = 0, hover = false, focus = false, dimmed = false }) => row({
  icon: program, name, second: activity, detail: place, meta: time, mark: status, depth, current, dimmed, hover, focus,
  glint: status === 'working', flag: pinned ? 'lu-pin' : '', chip: commands, actions: [icon('lu-pin', 'Pin to the top'), icon('lu-ellipsis', 'More')],
});

export const projectRow = ({ name, folder = '', branch = '', sync = '', open = false, status = 'blocked', count = 0, hover = false, focus = false }) => row({
  name, heading: true, current: open, hover, focus, detail: [folder, branch && { icon: 'lu-git-branch', text: branch }, sync],
  mark: count ? status : 'none', meta: count ? String(count) : '', actions: [icon('lu-plus', `New agent in ${name}`), icon('lu-ellipsis', 'More')],
});

export const computerStates = ['on', 'off', 'unreachable'];
export const computerRow = ({ name, remote = true, state = 'on', status = 'blocked', count = 0, hover = false, focus = false }) => row({
  icon: remote ? 'lu-server' : 'lu-monitor', name, heading: true, hover, focus,
  mark: count ? status : 'none', meta: count ? String(count) : '',
  action: state === 'off' ? { kind: 'icon', ...icon('lu-power', `Turn ${name} on`) } : state === 'unreachable' ? { kind: 'icon', ...icon('lu-refresh-cw', 'Refresh') } : null,
  actions: state === 'on' && remote ? [icon('lu-power', 'Turn off'), icon('lu-plus', `New project on ${name}`), icon('lu-arrow-right-left', 'Sync')] : [],
});

export const section = ({ title, status = 'none', count = 0 }) => row({ name: title, heading: true, mark: status, meta: count ? String(count) : '' });

export const asleep = ({ names = [], open = false } = {}) => row({ name: 'Asleep', heading: true, mark: 'asleep', meta: open ? '' : String(names.length) })
  + (open ? names.map((name) => row({ name, depth: 1, dimmed: true, action: { label: 'Wake', kind: 'quiet' } })).join('') : '');

export const views = [
  { key: 'spaces', label: 'Projects', icon: 'lu-folder' },
  { key: 'agents', label: 'Status', icon: 'lu-activity' },
  { key: 'threads', label: 'Threads', icon: 'lu-message-square' },
];
// Collapsed, one button for the current view opens the menu of all three.
export const viewSwitch = ({ view = 'spaces', column = false, open = false } = {}) => {
  if (!column) return stack({ variant: 'view switch' }, tabs({ items: views, value: view, size: 'sm', track: true, label: true }));
  const current = views.find((item) => item.key === view) ?? views[0];
  const list = open ? stack({ variant: 'view menu' }, menu({ items: views.map((item) => ({ ...item, selected: item.key === current.key })) })) : '';
  return stack({ variant: 'view switch' }, button({ label: current.label, kind: 'icon', size: 'lg', icon: current.icon, active: open }), list);
};

export const sidebarFooter = ({ update = '' } = {}) => stack({ variant: 'footer' }, update ? row({ icon: 'lu-refresh-cw', name: update }) : '', row({ icon: 'lu-settings', name: 'Settings' }), row({ icon: 'lu-server', name: 'Add computer' }));

export const tile = ({ initial = '', tone = 'teal', status = 'none', count = 0, open = false }) => stack({ variant: 'rail tile', on: open },
  initial ? avatar({ initial, tone, size: 'md' }) : mark({ status, size: 'lg' }), count ? chip({ label: count, quiet: true, tone: status === 'blocked' ? 'blocked' : '' }) : '');

// Cells

export const header = ({ collapsed = false, dawn: early = false, open = false } = {}) => stack({ variant: 'header', collapsed },
  early ? dawn() : '', stack({ variant: 'header title' }, windowControls()), toolbar({ column: collapsed, open }));

const group = (...rows) => stack({ variant: 'row group' }, ...rows);
const lists = {
  spaces: () => group(computerRow({ name: 'light', remote: false }))
    + group(projectRow({ name: 'prjct' }), sessionRow({ program: 'lu-terminal', name: 'Orion', status: 'idle' }))
    + group(projectRow({ name: 'amtelser' }), sessionRow({ program: 'lu-terminal', name: 'Nova', activity: 'Run npm publish?', time: '2m', status: 'blocked' }))
    + group(projectRow({ name: 'kansō', folder: 'herdr-kanso', branch: 'main', sync: '↓12', open: true }), sessionRow({ name: 'Atlas', activity: 'Reviewing step 01', time: '3m' }),
      sessionRow({ name: 'Juno', status: 'idle', depth: 2, current: true }), sessionRow({ program: 'p-codex', name: 'Iris', status: 'done', depth: 2 }))
    + group(projectRow({ name: 'agile' })) + group(asleep({ names: ['site', 'dojo'] })) + group(computerRow({ name: 'dark', state: 'off' })),
  agents: () => section({ title: 'Needs you', status: 'blocked' }) + sessionRow({ program: 'lu-terminal', name: 'Nova', activity: 'Run npm publish?', time: '2m', place: 'amtelser', status: 'blocked', depth: 0 })
    + section({ title: 'Working' }) + sessionRow({ name: 'Atlas', activity: 'Reviewing step 01', time: '3m', place: 'kansō', depth: 0 })
    + section({ title: 'Done' }) + sessionRow({ program: 'p-codex', name: 'Iris', place: 'kansō', status: 'done', depth: 0 })
    + section({ title: 'Idle', count: 2 }) + section({ title: 'Terminals', count: 1 }),
  threads: () => section({ title: 'Pinned' }) + sessionRow({ name: 'Review boards 01 to 04', activity: 'Reviewing step 01', time: '3m', current: true, depth: 0 })
    + section({ title: 'kansō' }) + sessionRow({ name: 'Audit the app errors', activity: 'Allow network access?', time: '1m', status: 'blocked', depth: 0 }) + sessionRow({ name: 'Sleep lost call', status: 'done', depth: 0 })
    + section({ title: 'Snoozed', count: 1 }) + section({ title: 'Settled', count: 4 }),
};
const tiles = {
  spaces: () => tile({ initial: 'A', tone: 'teal', status: 'blocked', count: 4, open: true }) + tile({ initial: 'D', tone: 'yellow', status: 'working', count: 1 }) + tile({ initial: 'B', tone: '', count: 1 }),
  agents: () => tile({ status: 'blocked', count: 1 }) + tile({ status: 'working', count: 3 }) + tile({ status: 'done', count: 2 }) + tile({ status: 'idle', count: 3 }),
  threads: () => tile({ status: 'blocked', count: 1 }) + tile({ status: 'working', count: 1 }) + tile({ status: 'done', count: 1 }),
};
export const sidebar = ({ collapsed = false, dawn: early = false, view = 'spaces', switcher = true, menu: open = false } = {}) => collapsed
  ? stack({ variant: 'rail' }, header({ collapsed, dawn: early }), switcher ? viewSwitch({ view, column: true, open }) : '', stack({ variant: 'rail list' }, tiles[view]()), stack({ variant: 'rail footer' }, tool('lu-settings', 'Settings')))
  : stack({ variant: 'sidebar' }, header({ dawn: early }), switcher ? viewSwitch({ view }) : '', stack({ variant: 'rows' }, lists[view]()), sidebarFooter());

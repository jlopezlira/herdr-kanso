// Sample sidebar content for the stories: the rows and tiles of each view, drawn with the compositions.
import { asleep, computerRow, panelBack, panelClose, panelRefresh, projectRow, section, sidebar, tile } from './compositions.js';
import { sessionRow } from './session-row.js';
import { button, glyph, menu, stack, statusItem } from './pieces.js';
import keyFile from '../../kanso/keys.json' with { type: 'json' };
import windowsKeyFile from '../../kanso/keys.windows.json' with { type: 'json' };
import { LIST_LAYER, describe, layer } from '../../kanso/mods/kanso-help/keymap.js';
import { GRID, LEVELS, SNIPPETS, gridWorld, move } from '../../kanso/mods/kanso-dojo/dojo.js';
import { hachiPixels } from '../../kanso/mods/kanso-dojo/mascot-pixels.js';

// A pull request's number as the app shows it.
export const pullRequest = (number) => `#${number}`;
const group = (...rows) => stack({ variant: 'row group' }, ...rows);
// A conversation's own tools under the pointer, and what a session's commands tooltip says.
export const sessionTools = [{ icon: 'lu-check', label: 'Settle' }];
export const sessionCommandsTip = 'npm test · 2m';

export const sampleRows = {
  spaces: () => [
    group(computerRow({ name: 'light', remote: false })),
    group(projectRow({ name: 'prjct' }), sessionRow({ program: 'lu-terminal', name: 'Orion', status: 'idle' })),
    group(projectRow({ name: 'amtelser' }), sessionRow({ program: 'lu-terminal', name: 'Nova', activity: 'Run npm publish?', time: '2m', status: 'blocked' })),
    group(projectRow({ name: 'kansō', folder: 'herdr-kanso', branch: 'main', sync: '↓12', open: true }), sessionRow({ name: 'Atlas', activity: 'Reviewing step 01', time: '3m' }),
      sessionRow({ name: 'Juno', status: 'idle', depth: 2, current: true }), sessionRow({ program: 'p-codex', name: 'Iris', status: 'done', depth: 2 })),
    group(projectRow({ name: 'agile' })), group(asleep({ names: ['site', 'dojo'] })), group(computerRow({ name: 'dark', state: 'off' })),
  ],
  agents: () => [
    section({ title: 'Needs you', status: 'blocked' }), sessionRow({ program: 'lu-terminal', name: 'Nova', activity: 'Run npm publish?', time: '2m', place: 'amtelser', status: 'blocked', depth: 0 }),
    section({ title: 'Working' }), sessionRow({ name: 'Atlas', activity: 'Reviewing step 01', time: '3m', place: 'kansō', depth: 0 }),
    section({ title: 'Done' }), sessionRow({ program: 'p-codex', name: 'Iris', place: 'kansō', status: 'done', depth: 0 }),
    section({ title: 'Idle', count: 2 }), section({ title: 'Terminals', count: 1 }),
  ],
  threads: () => [
    section({ title: 'Pinned' }), sessionRow({ name: 'Review boards 01 to 04', activity: 'Reviewing step 01', time: '3m', current: true, depth: 0 }),
    section({ title: 'kansō' }), sessionRow({ name: 'Audit the app errors', activity: 'Allow network access?', time: '1m', status: 'blocked', depth: 0 }), sessionRow({ name: 'Sleep lost call', status: 'done', depth: 0 }),
    section({ title: 'Snoozed', count: 1 }), section({ title: 'Settled', count: 4 }),
  ],
};
export const sampleTiles = {
  spaces: () => [tile({ initial: 'A', tone: 'teal', status: 'blocked', count: 4, open: true }), tile({ initial: 'D', tone: 'yellow', status: 'working', count: 1 }), tile({ initial: 'B', tone: '', count: 1 })],
  agents: () => [tile({ status: 'blocked', count: 1 }), tile({ status: 'working', count: 3 }), tile({ status: 'done', count: 2 }), tile({ status: 'idle', count: 3 })],
  threads: () => [tile({ status: 'blocked', count: 1 }), tile({ status: 'working', count: 1 }), tile({ status: 'done', count: 1 })],
};
export const sampleSidebar = ({ view = 'spaces', ...args } = {}) => sidebar({ ...args, view, rows: sampleRows[view](), tiles: sampleTiles[view]() });

// Sample status bar content: what each panel item holds when its Menu opens.
const hide = [{ separator: true }, { icon: 'lu-eye-off', label: 'Hide this' }];
export const statusMenus = {
  servers: () => menu({ title: ':5173 vite · no pane', items: [{ icon: 'lu-external-link', label: 'Open in the browser' }, { icon: 'lu-copy', label: 'Copy localhost:5173' },
    { separator: true }, { icon: 'lu-square', label: 'Stop' }, { separator: true }, { icon: 'lu-plug', label: 'Open Ports' }, ...hide.slice(1)] }),
  containers: () => menu({ title: 'cart-db · exited 1', items: [{ icon: 'lu-power', label: 'Start' }, { icon: 'lu-terminal', label: 'Logs' },
    { separator: true }, { icon: 'lu-x', label: 'Remove' }, { separator: true }, { icon: 'lu-container', label: 'Open Containers' }, ...hide.slice(1)] }),
  reviews: () => menu({ title: '2 reviews requested', items: [{ icon: 'lu-git-pull-request', label: `${pullRequest(142)} Checkout auth flow`, hint: 'acme-shop' },
    { icon: 'lu-git-pull-request', label: '#87 Locale files', hint: 'docs-site' }, ...hide] }),
};
export const statusPanels = ({ open = '' } = {}) => [
  statusItem({ icon: 'lu-plug', tone: 'working', text: 1, open: open === 'servers' }),
  statusItem({ icon: 'lu-container', tone: 'blocked', text: 1, open: open === 'containers' }),
  statusItem({ icon: 'lu-git-pull-request', text: 2, open: open === 'reviews' }),
];

// The Keyboard's sample layers: kansō's own keys file for each computer, read by the app's keymap; of Herdr's keys, only ⌘T, the one the design names.
const bindingsOf = (file, herdr = []) => [...Object.entries(file).flatMap(([section, keys]) => Object.entries(keys).map(([chord, action]) => ({ section, keys: chord, action }))), ...herdr];
const keyFiles = {
  mac: bindingsOf(keyFile, [{ section: 'global', keys: 'cmd-t', action: 'tab.new' }]),
  windows: bindingsOf(windowsKeyFile),
  linux: bindingsOf(keyFile),
};
export const keyLayerMods = { mac: ['alt cmd', 'cmd', 'alt shift cmd', 'shift cmd', 'ctrl shift', 'lists'], windows: ['alt', 'alt shift', 'ctrl shift', 'ctrl', 'lists'], linux: ['alt cmd', 'cmd', 'alt shift cmd', 'shift cmd', 'ctrl shift', 'lists'] };
export const keyLayer = (os = 'mac', mods = 'alt cmd') => {
  const lists = mods === 'lists';
  const held = lists ? [] : mods.split(' ');
  const found = lists ? LIST_LAYER : layer(keyFiles[os], held);
  const keys = Object.fromEntries([...found].map(([key, does]) => [key, { kind: lists ? 'list' : does.section === 'global' ? 'herdr' : 'kanso', does: describe(does.action), ...(lists ? { chord: does.chord.split(' ') } : {}) }]));
  return { held, lists, name: lists ? 'Every list and menu · j k gg G Enter /' : null, keys };
};

// Every notice the app sends today, each as a state, a home and its words; the Notifications story offers them by name.
const updated = (detail) => ({ state: 'done', home: 'update', text: 'kansō updated to 3.31.0', detail });
const notUpdated = (detail) => ({ state: 'failed', home: 'update', text: 'kansō was not updated', act: 'Update', detail });
export const appNotices = {
  'Update available': { state: 'fact', home: 'update', text: 'kansō 3.31.0 is available', act: 'Update' },
  'Already updating': { state: 'fact', home: 'update', text: 'kansō is already being updated' },
  'Up to date': { state: 'fact', home: 'update', text: 'kansō is up to date' },
  Updated: updated(null),
  'Updated, keys updated': updated('kansō\'s keys updated.'),
  'Updated, kept your keys': updated('kansō\'s keys updated. Kept your own cmd-d, cmd-shift-w.'),
  'Updated, keys.json unreadable': updated('Your keys.json could not be read, so kansō\'s keys were left as they are.'),
  'Updated, new layout': updated('New layout; the one you had is in layouts/kanso.json.old-*.'),
  'Check failed': { state: 'failed', home: 'update', text: 'GitHub could not be reached', act: 'Refresh' },
  'Install failed': notUpdated('permission denied'),
  'Install failed, Windows tool missing': notUpdated('curl.exe is not on PATH; nothing was downloaded another way'),
  'Install failed, Windows folder not moved': notUpdated('could not put kanso-tabs in place: C:\\Users\\you\\AppData\\Roaming\\herdr-app\\mods\\kanso-tabs'),
  'Out of memory': { state: 'failed', home: 'memory', text: 'Herdr\'s mod runtime is out of memory', act: 'Restart' },
};

// Two notices already on screen when the story adds one.
export const sampleNotices = [
  { state: 'done', home: 'agent', text: 'docs finished: Added docs/limits.md and the table' },
  { state: 'waits', home: 'pr', text: `${pullRequest(142)} · test / unit failed` },
];

// A sample panel's content, composed outside the shell: its tool, its section and rows, and the words of its empty, failed and stale reads.
export const samplePanel = {
  title: 'Worktrees',
  scope: 'This computer',
  read: 'Read 14:02 · devbox unreachable · next try 14:07',
  tool: () => button({ label: 'New worktree', kind: 'icon', icon: 'lu-plus' }),
  periods: ['Today', 'Month', '30 days', 'Year', 'All'],
  number: { value: '2.4 GB', unit: 'in 9 worktrees' },
  section: { name: 'acme-shop', meta: '1.6 GB' },
  rows: [
    { name: 'acme-shop-cart', meta: '310 MB', second: 'In a tab: cart-ui · today', mark: 'working' },
    { name: 'rate-limit-v1', meta: '412 MB', second: 'Merged · 3 d', mark: 'done' },
    { name: 'promo-banner', meta: '380 MB', second: '2 uncommitted changes · 6 d', mark: 'blocked' },
  ],
  empty: { icon: 'lu-git-fork', text: 'No worktrees' },
  failure: { text: "Can't list worktrees on devbox", source: 'git worktree list: timed out after 30 s', fix: 'Refresh', agent: 'migrate' },
};

// What real panels put in a header: before the title, nothing, ‹ or the program's mark; after it, the tools each one has.
const headerTool = (label, icon) => button({ label, kind: 'icon', icon });
export const samplePanelHeader = {
  starts: { none: () => [], back: () => [panelBack()], mark: () => [glyph('p-claude')] },
  tools: {
    none: () => [],
    refresh: () => [panelRefresh()],
    reading: () => [panelRefresh({ reading: true })],
    'share and refresh': () => [headerTool('Share', 'lu-share'), panelRefresh()],
    'pin and refresh': () => [headerTool('Stay on this agent', 'lu-pin'), panelRefresh()],
    document: () => [headerTool('Open with…', 'lu-external-link'), panelRefresh(), panelClose()],
  },
};

// The Sort menu of each view, in the app's words: its orders, the current one ticked, then what the sidebar shows.
const ticked = (label, on) => ({ label, icon: on ? 'lu-check' : undefined });
const sortShows = [ticked('What each agent is on', true), ticked('While you were away', true), ticked('Projects, Status and Threads', true)];
const sortMenu = (title, orders, current, extra = []) => menu({ items: [{ heading: title }, ...orders.map((label) => ticked(label, label === current)), ...extra, { separator: true }, { heading: 'Show' }, ...sortShows] });
// The menu + opens on Status and Threads: a project to start in, then the other ways in, then another computer.
export const sampleAddMenu = () => menu({ items: [{ heading: 'New conversation in' }, { label: 'kansō' }, { label: 'amtelser' }, { label: 'site', hint: 'dark' },
  { separator: true }, { label: 'New project with a conversation…', icon: 'lu-folder-plus' }, { label: 'Open a folder, no project…', icon: 'lu-file' }, { label: 'Add computer…', icon: 'lu-server' }] });
export const sampleSortMenus = {
  spaces: () => sortMenu('Agents, pinned first, then by', ['Last update', 'Needs you first', 'By kind', 'As on screen', 'Your order (drag)'], 'Last update'),
  agents: () => sortMenu('In each section, by', ['Latest change first', 'Longest in its state', 'Project'], 'Latest change first'),
  threads: () => sortMenu('Threads, pinned first, then by', ['Your last message', 'When it started'], 'Your last message', [ticked('Grouped by project', false)]),
};

// The dōjō: its levels, worlds and Hachi come from the mod; the keyboard shows the level's keys.
const fingers = { h: 'index', j: 'index', k: 'middle', l: 'ring' };
const arrows = { h: '←', j: '↓', k: '↑', l: '→' };
const shifted = { 4: '$', 6: '^', g: 'G', f: 'F', t: 'T' };
const practiceKeys = [...'1234567890qwertyuiopasdfghjkl;zxcvbnm,./'];
const markOf = (motions, key, lit, hint) => {
  const own = motions.some((motion) => motion[0] === key);
  const other = motions.includes(shifted[key]) ? shifted[key] : '';
  return { state: key === lit ? 'lit' : own || other ? 'kanso' : 'free', hint: key === hint, ...(own ? { corner: arrows[key] ?? other, finger: fingers[key] ?? '' } : other ? { label: other } : {}) };
};
const trailOf = (at, path) => path.reduce((cells, motion) => [...cells, move(gridWorld(), cells.at(-1) ?? at, motion)], []).slice(0, -1);
export const sampleDojo = {
  title: 'hjkl dōjō',
  moods: ['calm', 'glad', 'sweat', 'sleep'],
  tones: ['none', 'success', 'missed', 'armed'],
  phases: ['start', 'round', 'result'],
  grid: GRID,
  targets: 10,
  sleep: 'z z',
  levels: LEVELS,
  lines: SNIPPETS[1],
  tip: (level) => LEVELS[level - 1].tip,
  pixels: hachiPixels,
  keys: practiceKeys,
  marks: (level, lit, hint) => Object.fromEntries(practiceKeys.map((key) => [key, markOf(LEVELS[level - 1].motions, key, lit, hint)])),
  trail: (at, path) => trailOf(at, path.split(' ').filter(Boolean)),
  bests: (text) => text.split(',').map((best) => best.trim()).filter(Boolean),
  pathKeys: [{ keys: ['[', ']'], label: 'level' }, { keys: ['p'], label: 'pet' }],
  resultKeys: (level, last) => [{ keys: ['↩'], label: 'play again' }, ...(last ? [] : [{ keys: ['n'], label: `next level: ${LEVELS[level].name}` }])],
  share: { title: 'Scores and practice days only', items: [{ label: 'Post to X', hover: true }, { label: 'Post to LinkedIn' }, { label: 'Post to Bluesky' }, { separator: true }, { label: 'Save image' }] },
  leave: { label: 'Leave', kind: 'quiet', key: 'esc' },
  end: { label: 'End round', kind: 'quiet' },
};

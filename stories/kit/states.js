// The pages drawn from named states: each state is a preset of its page's playground, and the catalog draws its record from that preset.
import { dojo, edge, keyboard, keyboardExplorer, keyboardSystems, panel, panelBack, panelHeader, panelRefresh, pickedKey, shortcutRow, stepperMenu, panelDoors } from './compositions.js';
import { tabBar } from './tab-bar.js';
import { computerItem, layoutPaused, paletteDoor } from './status-bar.js';
import { emptyState, phrase, failureBlock, keycap, metric, needsItem, row, skeletonOf, stack, statusItem, stepper, tabs } from './pieces.js';
import { atWidth, inBar } from './frames.js';
import { toolbar } from './toolbar.js';
import { keyLayer, keyLayerMods, paletteTip, sampleColumns, sampleDojo, samplePanel, samplePanelHeader, sampleAddMenu, sampleSortMenus, statusMenus, statusPanels, unreachable } from './samples.js';

export const layerDefaults = Object.fromEntries(keyboardSystems.map((os) => [`${os}Layer`, keyLayerMods[os][0]]));
const practiceKey = (key) => key === 'none' ? '' : key;
const settingsSlice = (markup) => `<div class="kanso-story__slice kanso-story__settings">${markup}</div>`;

const question = 'Run pnpm add react-countdown@2.3?';
export const needsShown = { none: null, question: needsItem({ name: 'cart-ui', question, more: 1 }), folded: needsItem({ name: 'cart-ui', more: 1 }) };
export const memoryShown = { none: null, word: statusItem({ text: 'Memory 8% free', tone: 'blocked' }), folded: statusItem({ text: '8% free', tone: 'blocked' }) };
export const stepperShown = ['rest', 'hover', 'menu'];

const statusBar = ({ width, computer, paused, stepper: middle, minimap, needs, memory, panels, open }) => {
  const menuOpen = !paused && middle === 'menu';
  const popup = menuOpen ? stepperMenu() : panels && open !== 'none' ? statusMenus[open]() : '';
  const bar = inBar(width, {
    left: computer === 'none' ? [] : [computerItem({ name: 'devbox', state: computer, detail: unreachable('devbox') })],
    middle: paused ? layoutPaused({ detail: 'layout write refused 3 times' }) : stepper({ hover: middle === 'hover', open: menuOpen, columns: minimap ? sampleColumns : [] }),
    right: [needsShown[needs], memoryShown[memory], ...(panels ? statusPanels({ open }) : []), paletteDoor({ tip: paletteTip })].filter(Boolean),
    popup,
  });
  return popup ? `<div class="kanso-story__popup-room">${bar}</div>` : bar;
};

const tabItems = (value) => [{ key: 'checkout', label: 'checkout' }, { key: 'cart-ui', label: 'cart-ui', mark: value === 'cart-ui' ? '' : 'blocked' }, { key: 'tests', label: 'tests' }];
export const tabActs = {
  'at rest': (items) => items,
  'close armed': ([first, ...rest]) => [{ ...first, armed: true, tip: 'Press again to close checkout' }, ...rest],
  renaming: ([first, ...rest]) => [{ ...first, editing: true }, ...rest],
  'renamed, waiting': ([first, ...rest]) => [{ ...first, label: 'api-limits', pending: true }, ...rest],
  dragging: ([first, second, third]) => [first, { ...second, drop: true }, { ...third, held: true }],
  'long name': ([first, second, third]) => [first, second, { ...third, label: 'retry-after-header-for-cart-and-checkout' }],
};
const foldedTabs = ['perf', 'web', 'e2e', 'storybook', 'seed-data'];

const edgeColumns = (panes, stacked) => stacked && panes.length > 1 ? [panes.slice(0, 2), ...panes.slice(2).map((pane) => [pane])] : panes.map((pane) => [pane]);
export const edgeSides = ['left', 'right', 'both'];

// Panel: the sample panel's content in each read; the last row takes the look picked for it.
export const panelRowLooks = { rest: {}, hover: { hover: true }, selected: { current: true }, armed: { current: true, action: { label: 'Remove', kind: 'quiet', armed: true } } };
const panelRows = ({ lines, last }) => samplePanel.rows.map((item, index, rows) => row({ ...item, second: lines ? item.second : null, ...(index === rows.length - 1 ? panelRowLooks[last] : {}) }));
const panelSection = (rows) => [row({ ...samplePanel.section, heading: true }), panelRows(rows)];
const periods = () => tabs({ items: samplePanel.periods.map((label) => ({ key: label, label })), value: 'Month', size: 'sm', track: true, label: true });
export const panelContents = {
  rows: (last) => panelSection({ lines: true, last }),
  'one-line rows': (last) => panelSection({ lines: false, last }),
  'period and the number': (last) => [periods(), metric(samplePanel.number), panelSection({ lines: true, last })],
};
// Each read puts its state pattern where the list would start; stale keeps the last body under the time it was read.
export const panelReads = {
  ready: { body: (content) => content },
  loading: { reading: true, body: () => skeletonOf({ shape: 'list row', count: 3 }) },
  empty: { body: () => emptyState(samplePanel.empty) },
  failed: { body: () => failureBlock(samplePanel.failure) },
  stale: { stale: true, scope: samplePanel.read, body: (content) => content },
};

// The dōjō from its facts: the level, the bests so far, the phase and what the round shows.
const sameSpot = (x, y) => (spot) => spot.x === x && spot.y === y;
const dojoWorld = ({ level, x, y, goalX, goalY, path, hint }) => {
  const trail = sampleDojo.trail({ x, y }, path);
  const look = (cx, cy) => ({ current: cx === x && cy === y, goal: cx === goalX && cy === goalY, trail: trail.some(sameSpot(cx, cy)), hint: sameSpot(cx, cy)(trail[0] ?? {}) ? hint : '' });
  const { w, h } = sampleDojo.grid;
  return sampleDojo.levels[level - 1].world === 'grid'
    ? { cells: Array.from({ length: w * h }, (_, index) => look(index % w, Math.floor(index / w))) }
    : { lines: sampleDojo.lines.map((line, cy) => [...line].map((character, cx) => ({ character, ...look(cx, cy) }))) };
};
const dojoProps = ({ level, bests: written, picking, phase, score, time, streak, moves, need, reached, x, y, goalX, goalY, path, pressed, mood, feedback, tone, points, record, summary, share }) => {
  const bests = sampleDojo.bests(written);
  const { name } = sampleDojo.levels[level - 1];
  const hint = path.split(' ')[0];
  return {
    header: { title: sampleDojo.title, level, name, share: bests.length > 0, shared: share, end: phase === 'round' ? sampleDojo.end : null, leave: sampleDojo.leave },
    path: { levels: sampleDojo.levels.map(({ n, name: levelName }, index) => ({ number: n, name: levelName, best: bests[index] ?? '', done: index < bests.length, current: n === level, focus: picking && n === level })), keys: sampleDojo.pathKeys },
    play: { statistics: { score, time, streak, moves: phase === 'round' ? moves : null, need }, progress: { reached, total: sampleDojo.targets }, world: dojoWorld({ level, x, y, goalX, goalY, path, hint }) },
    result: phase === 'result' ? { record: { value: points, unit: 'points', record }, summary, keys: sampleDojo.resultKeys(level, level === sampleDojo.levels.length) } : null,
    pixels: sampleDojo.pixels(mood), sleep: mood === 'sleep' ? sampleDojo.sleep : null, feedback: { text: feedback, tone },
    marks: sampleDojo.marks(level, pressed, tone === 'missed' ? hint : ''), share: share ? sampleDojo.share : null,
  };
};
const round3 = { level: 3, bests: '88, 104', phase: 'round', score: 45, time: '38s', streak: 2, moves: 2, need: 5, reached: 4, x: 11, y: 3, goalX: 14, goalY: 6, pressed: 'j', feedback: 'This one takes 5 at best.' };
const best3 = { level: 3, bests: '88, 104, 142', phase: 'result', points: 142, record: 'a new best for level 3 · was 120', summary: '10 targets · 8 in the fewest moves · best streak 5 · 1:12', mood: 'glad', tone: 'success', feedback: 'A new best! Enter to play again, n for the next level.' };
const firstOpen = 'Make a move to start: 10 targets, in as few moves as you can.';

export const statedPages = {
  'Compositions/Toolbar': {
    args: { view: 'spaces', column: false, open: false, sorted: false, order: null, menu: false, add: false },
    markup: ({ menu: shown, add, ...args }) => {
      const bar = toolbar({ ...args, sortMenu: shown ? sampleSortMenus[args.view]() : null, addMenu: add ? sampleAddMenu() : null });
      return shown || add ? `<div class="kanso-story__tools-room">${bar}</div>` : bar;
    },
    states: [
      { label: 'Projects', args: {}, caption: 'Sidebar open on Projects: + adds a project.' },
      { label: 'Status and Threads', args: { view: 'agents' }, caption: '+ starts a conversation in a project you pick.' },
      { label: '+ menu', args: { view: 'agents', add: true }, caption: 'After a click on +, on Status and Threads: Add computer… ends it.' },
      { label: 'Sorted', args: { sorted: true }, caption: 'The order is not the default one.' },
      { label: 'Sort names its order', args: { sorted: true, order: 'Needs you first' }, caption: 'Proposed. Sort\'s tooltip names the order in use.' },
      { label: 'Sort menu, Projects', args: { menu: true }, caption: 'After a click on Sort, on Projects.' },
      { label: 'Sort menu, Status', args: { view: 'agents', menu: true }, caption: 'After a click on Sort, on Status.' },
      { label: 'Sort menu, Threads', args: { view: 'threads', menu: true }, caption: 'After a click on Sort, on Threads.' },
      { label: 'Collapsed', args: { column: true }, caption: 'Sidebar collapsed.' },
      { label: 'Collapsed, tools open', args: { column: true, open: true }, caption: 'After a click on the caret.' },
    ],
  },
  'Compositions/Panel': {
    args: { title: samplePanel.title, scope: samplePanel.scope, header: 'page', state: 'ready', look: 'panel', content: 'rows', last: 'rest' },
    markup: ({ title, scope, header, state, look, content, last }) => {
      const { reading = false, stale = false, scope: read = scope, body } = panelReads[state];
      const start = look === 'window' ? [panelBack()] : [];
      return panel({ look, stale, header: panelHeader({ title, form: header, start, second: read, tools: [samplePanel.tool(), panelRefresh({ reading })] }) }, body(panelContents[content](last)));
    },
    states: [
      { label: 'At rest', args: {}, caption: 'The read is fresh.' },
      { label: 'Period and the number', args: { content: 'period and the number' }, caption: 'The panel counts over a period.' },
      { label: 'One-line rows', args: { content: 'one-line rows' }, caption: 'The rows have no second fact.' },
      { label: 'Selected, removal armed', args: { last: 'armed' }, caption: 'After the first press on Remove.' },
      { label: 'Narrow', args: { look: 'narrow' }, caption: 'The panel is under 340 wide.' },
      { label: 'Window', args: { look: 'window', header: 'bar' }, caption: 'A file opened from a panel.' },
      { label: 'Loading', args: { state: 'loading' }, caption: 'Before the first read answers.' },
      { label: 'Empty', args: { state: 'empty' }, caption: 'The read answered with nothing.' },
      { label: 'Failed', args: { state: 'failed' }, caption: 'The read did not answer.' },
      { label: 'Stale', args: { state: 'stale' }, caption: 'Another computer stopped answering.' },
    ],
  },
  'Compositions/Panel/Header': {
    args: { title: 'Ports', form: 'page', start: 'none', second: '', tools: 'share and refresh' },
    markup: ({ title, form, start, second, tools }) => panel({ header: panelHeader({ title, form, start: samplePanelHeader.starts[start](), second: second || null, tools: samplePanelHeader.tools[tools]() }) }),
    states: [
      { label: 'Page', args: {}, caption: 'A dashboard: its title, then its tools.' },
      { label: 'Page, reading', args: { title: 'Containers', tools: 'reading' }, caption: 'Refresh turns while the panel reads.' },
      { label: 'Page inside a panel', args: { title: 'checkout', start: 'back', second: 'Task', tools: 'refresh' }, caption: 'A page opened from a row of the panel.' },
      { label: 'Bar', args: { title: 'limits.md', form: 'bar', start: 'back', second: '~/acme-shop/docs', tools: 'document' }, caption: 'A file opened from a panel.' },
      { label: 'Bar with a mark', args: { title: 'cart-ui', form: 'bar', start: 'mark', second: '~/acme-shop', tools: 'pin and refresh' }, caption: 'Images of the agent in focus.' },
      { label: 'Bar, title only', args: { title: 'Files', form: 'bar', tools: 'none' }, caption: 'A list with nothing to refresh.' },
    ],
  },
  'Compositions/Status bar/Item': {
    args: { icon: 'lu-container', mark: 'none', text: '1', tone: 'blocked', pending: false },
    markup: ({ icon, mark: status, ...args }) => inBar(520, { right: [statusItem({ ...args, icon: icon === 'none' ? '' : icon, mark: status === 'none' ? '' : status })] }),
    states: [
      { label: 'Memory', args: { icon: 'none', text: 'Memory 8% free' }, caption: 'This computer is low on memory.' },
      { label: 'Memory folded', args: { icon: 'none', text: '8% free' }, caption: 'Memory loses its word last.' },
    ],
  },
  'Compositions/Status bar/Computer item': {
    args: { name: 'devbox', remote: true, state: 'on', folded: false },
    markup: (args) => inBar(520, { left: [computerItem({ ...args, detail: unreachable(args.name) })] }),
    states: [
      { label: 'Out of sight', args: {}, caption: 'Only while its sidebar row is out of sight.' },
      { label: 'Folded', args: { folded: true }, caption: 'The computer becomes its icon.' },
      { label: 'Unreachable', args: { state: 'unreachable' }, caption: 'While its row is out of sight; Refresh reconnects.' },
      { label: 'Reconnecting', args: { state: 'pending' }, caption: 'At 80% with a breathing dot.' },
    ],
  },
  'Compositions/Status bar/Needs you item': {
    args: { name: 'cart-ui', question, more: 1 },
    markup: (args) => inBar(760, { right: [needsItem(args)] }),
    states: [
      { label: 'One', args: { more: 0 }, caption: 'Mark, name and question, as the row says them. Click: ⌘J.' },
      { label: 'Several', args: {}, caption: 'How many more wait out of view.' },
      { label: 'Folded', args: { question: '' }, caption: 'The question goes; the name and +1 never fold.' },
    ],
  },
  'Compositions/Status bar': {
    args: { width: 1040, computer: 'none', paused: false, stepper: 'rest', minimap: false, needs: 'question', memory: 'none', panels: false, open: 'none' },
    markup: statusBar,
    states: [
      { label: 'At rest', args: { needs: 'none' }, caption: 'Nothing to say; panes per view keeps its slot.' },
      { label: 'Panes per view menu', args: { needs: 'none', stepper: 'menu' }, caption: 'Right-click: Even out, then the piece lines.' },
      { label: 'Layout paused', args: { needs: 'none', paused: true }, caption: 'The strip stopped after a failure; it resumes alone after 10 s.' },
      { label: 'Minimap', args: { needs: 'none', minimap: true }, caption: 'Proposed. Switched on in kansō settings: one mark per column before panes per view, the one in front brightest; a click goes to it.' },
      { label: 'Sidebar folded', args: { computer: 'on' }, caption: 'The focused project is on devbox.' },
      { label: 'Unreachable', args: { computer: 'unreachable', needs: 'none' }, caption: "devbox can't be reached and its row is out of sight." },
      { label: 'Needs you', args: {}, caption: 'While the waiting row is out of view.' },
      { label: 'Servers, containers and reviews', args: { width: 520, needs: 'none', panels: true }, caption: 'Each its icon and how many need a look; gone while its panel is open.' },
      { label: 'Servers open', args: { width: 520, needs: 'none', panels: true, open: 'servers' }, caption: 'The server with no pane: open, copy, stop.' },
      { label: 'Containers open', args: { width: 520, needs: 'none', panels: true, open: 'containers' }, caption: 'The stopped container: start, logs, remove.' },
      { label: 'Reviews open', args: { width: 520, needs: 'none', panels: true, open: 'reviews' }, caption: 'Each pull request waiting for you; a click opens it in PR.' },
      { label: 'Everything, 1200', args: { width: 1200, memory: 'word', panels: true }, caption: 'Every item at once.' },
      { label: 'Everything, 1040', args: { memory: 'folded', panels: true }, caption: 'The question shrinks; Memory loses its word.' },
      { label: 'Everything, 760', args: { width: 760, memory: 'folded' }, caption: 'Servers, containers and reviews give way.' },
      { label: 'Everything, 520', args: { width: 520, needs: 'folded', memory: 'folded' }, caption: 'The question is gone.' },
    ],
  },
  'Compositions/Tab bar': {
    args: { width: 1040, value: 'checkout', tab: 'at rest', panel: 'none', state: 'connected', folded: 0, overflow: false, help: false, windows: false },
    markup: ({ width, value, tab, folded, overflow, ...args }) => {
      const bar = atWidth(width, tabBar({ ...args, panels: panelDoors, value, overflow, items: tabActs[tab](tabItems(value)), folded: foldedTabs.slice(0, folded).map((label) => ({ label })) }));
      return overflow && folded ? `<div class="kanso-story__menu-room">${bar}</div>` : bar;
    },
    states: [
      { label: 'At rest', args: {}, caption: 'Only a tab out of view whose session waits carries a mark; none for working or finished. Closed doors paint nothing.' },
      { label: 'Panel open', args: { panel: 'pr' }, caption: 'The open door on the quiet fill.' },
      { label: 'Close armed', args: { tab: 'close armed' }, caption: 'A tab holding a session: the first press arms for 4 s.' },
      { label: 'Renaming', args: { tab: 'renaming' }, caption: 'Double-click renames in place, the name selected.' },
      { label: 'Renamed on devbox, waiting', args: { tab: 'renamed, waiting' }, caption: 'At 80% with a breathing dot until confirmed.' },
      { label: 'Dragging', args: { tab: 'dragging' }, caption: 'The held tab on the pressed wash; the accent bar where it lands.' },
      { label: 'Long name', args: { tab: 'long name' }, caption: 'A name stops at 170 and truncates.' },
      { label: 'Folded, 760', args: { width: 760, folded: 5, overflow: true }, caption: 'What does not fit goes behind +5, a Menu with the marks.' },
      { label: 'Connecting', args: { width: 520, state: 'connecting' }, caption: 'A project on devbox: one breathing skeleton per known tab.' },
      { label: 'Unreachable', args: { width: 520, state: 'unreachable' }, caption: 'The tabs step down; no + and no doors.' },
      { label: 'Windows and Linux', args: { windows: true }, caption: 'The window buttons after the doors, in the same button.' },
      { label: 'kansō help', args: { help: true }, caption: 'Proposed. kansō help\'s door after the panels\'.' },
    ],
  },
  'Compositions/Edges': {
    args: { side: 'right', panes: 3, stacked: false, drop: false, waiting: 'none', overflow: false },
    markup: ({ side, panes, stacked, drop, waiting, overflow }) => {
      const lit = { none: -1, nearest: 0, farthest: panes - 1 }[waiting];
      const list = Array.from({ length: panes }, (_, index) => ({ name: `pane ${index + 1}`, program: ['p-claude', 'p-codex', 'lu-terminal'][index % 3], lit: index === lit }));
      const [first, ...rest] = list;
      const edges = side === 'both'
        ? edge({ side: 'left', columns: [[first]], drop }) + edge({ columns: edgeColumns(rest, stacked), drop, overflow })
        : edge({ side, columns: edgeColumns(list, stacked), drop, overflow });
      return `<div class="kanso-story__strip${side === 'right' ? ' kanso-story__strip--end' : ''}">${edges}</div>`;
    },
    states: [
      { label: 'One left, three right', args: { side: 'both', panes: 4 }, caption: 'A tile per pane past each side; a click goes there, the name is its tooltip. No state dots.' },
      { label: 'A stacked column', args: { stacked: true }, caption: 'The panes of one column stay together.' },
      { label: 'Dragging past the edge', args: { panes: 1, drop: true }, caption: 'A pane dragged over an edge washes it in accent.' },
      { label: 'Ten beyond', args: { panes: 10 }, caption: 'Every pane keeps its tile.' },
    ],
  },
  'Compositions/Keyboard': {
    args: { os: 'mac', ...layerDefaults, key: 'h', hover: 'none', level: 0, pressed: 'none', next: 'none' },
    markup: ({ os, key, hover, level, pressed, next, ...args }) => level
      ? keyboard({ os, marks: sampleDojo.marks(level, practiceKey(pressed), practiceKey(next)), inert: true })
      : keyboardExplorer({ os, layer: keyLayer(os, args[`${os}Layer`]), picked: key, hover }),
    states: [
      { label: 'Shortcuts', args: {}, caption: 'The keys of the held modifiers; the picked key is solid.' },
      { label: 'Practice, level keys', args: { level: 3 }, caption: 'The dōjō draws this keyboard: the level\'s keys in ink, each with its arrow and finger.' },
      { label: 'Practice, pressed key', args: { level: 3, pressed: 'j' }, caption: 'The key just pressed, in solid ink.' },
      { label: 'Practice, next key', args: { level: 3, next: 'l' }, caption: 'An accent ring marks the key to press next.' },
    ],
  },
  'Compositions/Keyboard/Key': {
    args: { label: 'H', units: 1, state: 'kanso', hover: false, hint: false, corner: '', finger: '' },
    markup: (args) => stack({ variant: 'keyboard' }, stack({ variant: 'keyboard row' }, keycap(args))),
    states: [
      { label: 'kansō key', args: {}, caption: 'A key that does a kansō action.' },
      { label: 'Pressed', args: { state: 'lit' }, caption: 'The key just pressed, in solid ink.' },
      { label: 'Next key', args: { hint: true }, caption: 'An accent ring marks the key to press next.' },
      { label: 'With a glyph and a finger', args: { corner: '←', finger: 'index' }, caption: 'A glyph in the corner and the finger that presses it, under the key.' },
    ],
  },
  'Compositions/Keyboard/Picked key': {
    args: { os: 'mac', ...layerDefaults, key: 'h' },
    markup: ({ os, key, ...args }) => settingsSlice(pickedKey({ os, layer: keyLayer(os, args[`${os}Layer`]), picked: key })),
    states: [{ label: 'Default', args: {}, caption: 'What the picked key does here, and its act.' }],
  },
  'Compositions/Keyboard/Shortcut row': {
    args: { name: 'Pin the pane', chords: '⌥⌘P', state: 'rest', hover: false },
    markup: ({ chords, ...args }) => settingsSlice(shortcutRow({ ...args, chords: chords.split(',').map((chord) => chord.trim()).filter(Boolean),
      taken: { chord: '⌥⌘J', name: 'Pane below' }, source: 'keys.json: EACCES: permission denied', agent: 'checkout' })),
    states: [{ label: 'Rest', args: {}, caption: 'One action and its keys.' }],
  },
  'Panels/Dojo': {
    args: { level: 1, bests: '', picking: false, phase: 'start', score: 0, time: '0s', streak: 0, moves: 0, need: 0, reached: 0, x: 9, y: 4, goalX: 14, goalY: 4, path: '', pressed: '', mood: 'calm', feedback: firstOpen, tone: 'none', points: 0, record: '', summary: '', share: false },
    markup: (args) => dojo(dojoProps(args)),
    states: [
      { label: 'First open', args: {}, caption: 'One move starts the round.' },
      { label: 'Picking a level', args: { level: 6, bests: '88, 104, 120', picking: true, x: 0, y: 0, goalX: 15, goalY: 1, feedback: phrase('Level 6, w b e:', sampleDojo.tip(6), 'A move starts.') }, caption: '] moves along the path; the example previews the level.' },
      { label: 'In a round', args: round3, caption: 'The count against the best; the pressed key lit.' },
      { label: 'A miss', args: { ...round3, time: '51s', streak: 0, moves: 8, y: 4, path: 'l l l j j', pressed: '', mood: 'sweat', tone: 'missed', feedback: '8 moves; 5 would do. Try l.' }, caption: 'The long way: the count in working, the best path and its first key.' },
      { label: 'A perfect move', args: { ...round3, score: 78, time: '1:02', streak: 3, moves: 0, need: 4, reached: 7, x: 14, y: 6, goalX: 5, goalY: 2, mood: 'glad', tone: 'success', feedback: '3 in a row in the fewest moves.' }, caption: 'Hachi glad; the edge advances.' },
      { label: 'A text level', args: { level: 7, bests: '88, 104, 120', phase: 'round', score: 30, time: '22s', streak: 1, moves: 1, need: 2, reached: 2, x: 2, y: 2, goalX: 21, goalY: 2, pressed: 'f', feedback: 'f… now the letter to find.' }, caption: 'f waits for its letter.' },
      { label: 'Round over', args: { ...best3, bests: '88, 104, 120', points: 112, record: '', summary: '10 targets · 6 in the fewest moves · best streak 3 · 1:20', mood: 'calm', tone: 'none', feedback: 'Enter to play again, n for the next level.' }, caption: 'The round is over; the level keeps its best.' },
      { label: 'A new best', args: best3, caption: 'The round is over and beat the level\'s best.' },
      { label: 'Level cleared', args: { level: 4, bests: '88, 104, 142', x: 9, y: 4, goalX: 17, goalY: 4, mood: 'glad', tone: 'success', feedback: phrase('Level 3 done, best 142. Level 4:', sampleDojo.tip(4)) }, caption: 'The next level is current.' },
      { label: 'All cleared', args: { ...best3, level: 9, bests: '88, 104, 142, 131, 156, 149, 162, 171, 181', points: 181, record: 'all nine levels done', summary: '1,284 points across the path · 41 days practised · longest streak 12', feedback: 'All nine. [ and ] take you back to any level.' }, caption: 'Every level has a best.' },
      { label: 'Sharing', args: { ...best3, share: true }, caption: 'Scores and practice days only.' },
      { label: 'Esc once', args: { ...round3, time: '40s', moves: 1, x: 10, pressed: '', tone: 'armed', feedback: 'Press Esc again to leave the dōjō.' }, caption: 'Hachi asks again before leaving.' },
      { label: 'Stopped', args: { level: 3, bests: '88, 104', goalX: 3, goalY: 1, feedback: 'Round stopped, not counted. Enter to start again.' }, caption: 'The round is not counted.' },
      { label: 'Asleep', args: { mood: 'sleep', feedback: 'Zzz. Any move wakes me.' }, caption: 'Any move wakes Hachi.' },
      { label: 'sqlite3 missing', args: { feedback: 'Install sqlite3 to keep your rounds.' }, caption: 'The dōjō plays; rounds are not kept.' },
    ],
  },
};

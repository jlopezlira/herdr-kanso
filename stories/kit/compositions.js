// The kit's compositions: each one only calls pieces with its own props and draws no markup.
import { button, chord, diffText, dojoCell, dojoCharacter, dojoFeedback, dojoLevel, dojoProgress, dojoRecord, dojoStatistics, dojoSummary, dojoTitle, facts, headerSegment, input, keyLegend, paneName, setting, sleepLabel, toggle, failureBlock, failureLine, glyph, grow, keycap, keyPicked, list, mark, mascot, menu, phrase, pieceLines, plus, row, stack, tabs, toast } from './kit.js';

// Sidebar compositions: each one is the Row, Tab, Menu, Avatar, Mark, Chip or Button in its own configuration.
// The rows the app draws (session, project, computer, section, asleep), the tile, the view switch, the toolbar, the header, the footer and the Activity card live each in its own file, shared with the app.

// Status bar compositions the app does not draw yet; the bar, its items and its Buttons live in status-bar.js, shared with the app.
export const stepperMenu = () => menu({ title: 'Panes per view', items: [{ icon: 'lu-move-horizontal', label: 'Even out', hint: '⌘⇧0' }, ...pieceLines] });

// A failing row's right-click Menu: the source's words, the fixes, Explain, then the piece lines.
export const failureMenu = ({ source, fixes = [], agent = null }) => menu({ title: source, items: [...fixes.map((label) => ({ label })), ...(agent ? [{ icon: 'lu-bot', label: phrase('Explain to', agent) }] : []), ...pieceLines] });

// While you were away's right-click Menu; the card itself is the Activity composition, in its own file.
export const activityMenu = () => menu({ title: 'While you were away', items: [{ icon: 'lu-x', label: 'Dismiss these' }, ...pieceLines] });

// Edges: the panes past each side, one icon Button per pane, the panes of one column grouped; a click goes there, the name is the tooltip.
// Past max columns the farthest fold behind +N, a Menu; a lit pane (its Needs you hovered) takes the active fill, or +N when it is folded.
const chevrons = { left: 'lu-chevron-left', right: 'lu-chevron-right' };
const paneButton = ({ program = 'p-claude', name, lit = false }) => button({ label: name, kind: 'icon', size: 'sm', icon: program, active: lit });
export const edge = ({ side = 'right', columns = [], drop = false, max = 4, overflow = false } = {}) => {
  const shown = columns.slice(0, max), folded = columns.slice(max).flat();
  const more = folded.length ? stack({ variant: 'edge more' }, button({ label: plus(folded.length), kind: 'quiet', size: 'sm', active: overflow || folded.some((pane) => pane.lit) }),
    overflow ? stack({ variant: 'edge menu', [side]: true }, menu({ items: folded.map(({ program = 'p-claude', name }) => ({ icon: program, label: name })) })) : null) : null;
  return stack({ variant: 'edge', target: drop }, glyph(chevrons[side]), shown.map((panes) => stack({ variant: 'edge column' }, panes.map(paneButton))), more);
};

// Panel: only the container. Each look is a width; stale steps down all but the header; the header comes drawn, or none.
export const panelLooks = ['panel', 'narrow', 'window'];
export const panel = ({ look = 'panel', stale = false, header = null } = {}, ...body) => {
  if (!panelLooks.includes(look)) throw new Error(phrase('panel: unknown look', look));
  return stack({ variant: 'panel', narrow: look === 'narrow', window: look === 'window', stale }, header, body);
};
// Panel header: the Row in its title form, only the title required. A page heads a dashboard; a bar heads a document or a tool, compact over a rule.
export const panelHeaderForms = ['page', 'bar'];
export const panelHeader = ({ title, form = 'page', start = [], second = null, tools = [] }) => {
  if (!panelHeaderForms.includes(form)) throw new Error(phrase('panelHeader: unknown form', form));
  return stack({ variant: 'panel header', bar: form === 'bar' }, row({ start, name: title, title: true, second, tools }));
};
// The tools a panel may end with: Refresh, spinning while it reads, and Close where the panel closes.
export const panelRefresh = ({ reading = false } = {}) => button({ label: 'Refresh', kind: 'icon', icon: 'lu-refresh-cw', spin: reading });
export const panelClose = () => button({ label: 'Close', kind: 'icon', icon: 'lu-x' });
// A file opened from a panel goes back to its folder's list.
export const panelBack = () => button({ label: 'Markdown in this folder', kind: 'icon', icon: 'lu-chevron-left' });

// Cells

// The channel in Settings · Updates: one press switches; Dawn Mode says it can break, and the sky can be turned off.
export const channels = [{ key: 'stable', label: 'Stable Mode' }, { key: 'dawn', label: 'Dawn Mode' }];
export const channelSettings = ({ channel = 'stable', art = true } = {}) => list(
  setting({ label: 'Updates', control: tabs({ items: channels, value: channel, size: 'sm', track: true, label: true }), note: channel === 'dawn' ? 'Dawn Mode gets changes first. It can break.' : null,
    link: channel === 'dawn' ? button({ label: 'Star on GitHub', kind: 'quiet', size: 'sm' }) : null }),
  channel === 'dawn' ? setting({ label: 'Dawn sky', control: toggle({ checked: art, label: 'Dawn sky' }) }) : null);

// The header, the view switch, the rows or tiles of the current view and the footer come in drawn; the sidebar only places them.
export const sidebar = ({ collapsed = false, header = null, switcher = null, rows = [], tiles = [], away = null, footer = null } = {}) => collapsed
  ? stack({ variant: 'rail' }, header, switcher, stack({ variant: 'rail list' }, tiles), footer)
  : stack({ variant: 'sidebar' }, header, switcher, stack({ variant: 'rows' }, rows), away, footer);

// Keyboards by computer: the rows, each key's width in keys, and what each key is called; a chord joins its parts with join.
const modifierKeys = ['ctrl', 'alt', 'shift', 'cmd'];
const macRows = [
  [['\u0060'], ['1'], ['2'], ['3'], ['4'], ['5'], ['6'], ['7'], ['8'], ['9'], ['0'], ['-'], ['='], ['backspace', 1.6]],
  [['tab', 1.6], ['q'], ['w'], ['e'], ['r'], ['t'], ['y'], ['u'], ['i'], ['o'], ['p'], ['['], [']'], ['\\']],
  [['capslock', 1.9], ['a'], ['s'], ['d'], ['f'], ['g'], ['h'], ['j'], ['k'], ['l'], [';'], ["'"], ['enter', 1.7]],
  [['shift', 2.4], ['z'], ['x'], ['c'], ['v'], ['b'], ['n'], ['m'], [','], ['.'], ['/'], ['shift', 2.2]],
  [['ctrl', 1.3], ['alt', 1.3], ['cmd', 1.6], ['space', 3.5], ['cmd', 1.6], ['alt', 1.3], ['left'], ['up'], ['down'], ['right']],
];
const pcRows = [...macRows.slice(0, 4), [['ctrl', 1.3], ['cmd', 1.3], ['alt', 1.6], ['space', 3.5], ['alt', 1.6], ['ctrl', 1.3], ['left'], ['up'], ['down'], ['right']]];
const arrows = { space: null, left: '←', right: '→', up: '↑', down: '↓' };
const pcCaps = { ...arrows, backspace: 'Back', tab: 'Tab', capslock: 'Caps', enter: 'Enter', escape: 'Esc', shift: 'Shift', ctrl: 'Ctrl', alt: 'Alt' };
export const keyboards = {
  mac: { rows: macRows, caps: { ...arrows, backspace: '⌫', tab: '⇥', capslock: '⇪', enter: '↩', escape: 'esc', shift: '⇧', ctrl: '⌃', alt: '⌥', cmd: '⌘' }, join: null },
  windows: { rows: pcRows, caps: { ...pcCaps, cmd: 'Win' }, join: '+' },
  linux: { rows: pcRows, caps: { ...pcCaps, cmd: 'Super' }, join: '+' },
};
export const keyboardSystems = Object.keys(keyboards);
const named = (os, key) => Object.hasOwn(keyboards[os].caps, key);
const capOf = (os, key) => named(os, key) ? keyboards[os].caps[key] : key.toUpperCase();
export const keyNames = (os = 'mac') => [...new Set(keyboards[os].rows.flat().map(([key]) => key))];
// The held modifiers, then any key, as that computer writes a chord.
export const heldChord = ({ os = 'mac', held = [], key = null }) => chord(keyboards[os].join, ...modifierKeys.filter((mod) => held.includes(mod)).map((mod) => capOf(os, mod)), ...(key ? [capOf(os, key)] : []));

// Keyboard: the map of one layer. Holding or clicking a modifier picks the layer; a kansō key has ink, a Herdr key is quieter.
// marks sets a key by name over its layer look: state, next-key hint, corner glyph, finger or label (the dōjō); inert keys take no focus.
const keyState = { kanso: 'kanso', list: 'kanso', herdr: 'herdr', free: 'free' };
const keyAct = { kanso: 'Change', herdr: 'Herdr settings', free: 'Give it an action' };
const noLayer = { held: [], keys: {} };
export const keyboard = ({ os = 'mac', layer = noLayer, picked = null, hover = null, marks = {}, inert = false }) => stack({ variant: 'keyboard' },
  keyboards[os].rows.map((line) => stack({ variant: 'keyboard row' }, line.map(([key, units = 1]) => keycap({ label: capOf(os, key), units, hover: key === hover, inert,
    state: layer.held.includes(key) ? 'held' : key === picked ? 'picked' : keyState[layer.keys[key]?.kind] ?? 'free', ...marks[key] })))));
// The picked key: what it does here, or Nothing, with its one act; Lists opens the layer of every list and menu.
const pickedChord = ({ os, layer, picked }) => layer.keys[picked]?.chord
  ? phrase(...layer.keys[picked].chord.map((part) => named(os, part) ? keyboards[os].caps[part] : part))
  : heldChord({ os, held: layer.held, key: picked });
const layerLine = ({ os, layer }) => layer.lists ? layer.name
  : phrase(heldChord({ os, held: layer.held }), '·', Object.keys(layer.keys).length, Object.keys(layer.keys).length === 1 ? 'key' : 'keys');
export const pickedKey = ({ os = 'mac', layer, picked }) => keyPicked({ chord: pickedChord({ os, layer, picked }), meaning: layer.keys[picked]?.does ?? null,
  layer: layer.keys[picked]?.kind === 'herdr' ? 'Herdr\'s key' : layerLine({ os, layer }),
  actions: layer.lists ? [] : [button({ label: keyAct[layer.keys[picked]?.kind ?? 'free'], kind: 'quiet' }), button({ label: 'Lists', kind: 'quiet' })] });
export const keyboardExplorer = ({ os = 'mac', layer, picked, hover = null }) => stack({ variant: 'keyboard layout' }, keyboard({ os, layer, picked, hover }), pickedKey({ os, layer, picked }));

// Shortcut row: what a key does and its chords. A click captures on the row; Reset brings back what kansō ships.
export const shortcutRowStates = ['rest', 'selected', 'changed', 'unbound', 'capture', 'taken', 'failed'];
// Each state's keys, built only for that state: a row at rest needs no taken chord.
const shortcutKeys = ({ chords, state, taken }) => ({
  unbound: () => [{ text: 'No key', faint: true }],
  capture: () => chords.length ? chords.map((text) => ({ text, recording: true })) : [{ text: 'New key', recording: true }],
  taken: () => [{ text: taken.chord, recording: true }],
}[state] ?? (() => chords.map((text) => ({ text }))))();
export const shortcutRow = ({ name, chords = [], state = 'rest', taken = null, hover = false, source = null, agent = null }) => list(
  row({ name, hover, current: ['selected', 'capture', 'taken'].includes(state), keys: shortcutKeys({ chords, state, taken }),
    meta: state === 'capture' ? 'Esc keeps · ⌫ removes' : null,
    second: state === 'taken' ? phrase(taken.chord, 'already does', taken.name, '· Esc keeps yours') : null,
    action: { changed: { label: 'Reset', kind: 'quiet' }, taken: { label: 'Take it', kind: 'quiet', armed: true, verb: 'take it' } }[state] ?? null }),
  state === 'failed' ? failureBlock({ text: phrase('Couldn\'t save', chords[0], 'for', name), source, fix: 'Change', agent }) : null);

export const panelDoors = [
  { key: 'files', label: 'Files', icon: 'lu-file' }, { key: 'spend', label: 'Spend', icon: 'lu-chart-column' }, { key: 'pr', label: 'PR', icon: 'lu-git-pull-request' },
  { key: 'shipped', label: 'Shipped', icon: 'lu-trophy' }, { key: 'worktrees', label: 'Worktrees', icon: 'lu-git-fork' }, { key: 'ports', label: 'Ports', icon: 'lu-plug' },
  { key: 'containers', label: 'Containers', icon: 'lu-container' }, { key: 'memory', label: 'Memory', icon: 'lu-memory-stick' }, { key: 'images', label: 'Images', icon: 'lu-image' },
];

// Notifications. A notice is a fact with a state and a home; where you are decides whether it is said, and how.
// The lead is the home's icon in the state's colour; an agent has no icon, so its mark; a failure is always the blocked mark.
export const noticeStates = ['waits', 'done', 'failed', 'fact'];
export const noticePlaces = ['home in view', 'window on screen', 'away'];
const noticeIcons = { ...Object.fromEntries(panelDoors.map(({ key, icon }) => [key, icon])), update: 'lu-refresh-cw' }; // the footer's updateIcon (sidebar-footer.js)
export const noticeHomes = ['agent', ...Object.keys(noticeIcons)];
const noticeTone = { waits: 'blocked', done: 'done', failed: 'blocked', fact: 'muted' };
const noticeMark = { waits: 'blocked', done: 'done', failed: 'blocked', fact: 'idle' };
const noticeLead = ({ state, home }) => state === 'failed' || !noticeIcons[home] ? { mark: noticeMark[state] } : { icon: noticeIcons[home], tone: noticeTone[state] };
// The detail is the tool's words or the context, in the toast's tooltip. Away, the computer draws it: kansō only gives the words.
export const notice = ({ state = 'fact', home = 'agent', text, act = null, detail = null, place = 'window on screen' }) => place === 'window on screen'
  ? toast({ ...noticeLead({ state, home }), title: text, action: act, detail }) : null;
export const systemMessage = ({ text, detail = null, place = 'window on screen' }) => place === 'away' ? { title: text, body: detail } : null;
// Up to three on screen, the newest at the bottom.
export const toastStack = ({ notices = [], max = 3 }) => stack({ variant: 'toasts' }, notices.slice(-max).map((item) => notice(item)));

// Pane header: the program, the name, the place when it differs from the tab's, what changed, then the tools and the state's mark.
// Each look is a state: focus is the ground; blocked is the wash and the mark; a pin after the name; the header itself drags.
export const paneStates = ['none', 'working', 'blocked', 'done', 'idle'];
export const paneNameLimit = 40;
export const paneReaches = ['here', 'remote', 'unreachable'];
export const paneFolds = ['nothing', 'folder', 'branch', 'tools into ⋯', 'commits', 'files', 'verdict word', 'PR', 'close into ⋯'];
// A step of paneFolds is shown until the pane folds that far; the order lives only in paneFolds.
const shown = (fold, step) => fold < paneFolds.indexOf(step);
const paneMarks = { working: 'working', blocked: 'blocked', done: 'done' };
const paneTool = (icon, label) => button({ label, kind: 'icon', size: 'sm', icon });
const counted = (count, one, many) => phrase(count, count === 1 ? one : many);
const paneDigest = ({ files = 0, add = 0, del = 0, commits = 0, pr = null, failure = null }, fold, working) => stack({ variant: 'pane digest' },
  files && shown(fold, 'files') ? headerSegment({ act: true, tone: working ? 'dim' : null, title: 'Open the diff', parts: [{ text: counted(files, 'file', 'files') }, { text: diffText({ add, del }), tone: 'dim' }] }) : null,
  commits && shown(fold, 'commits') ? headerSegment({ act: true, tone: working ? 'dim' : null, title: phrase(counted(commits, 'commit', 'commits'), 'not on GitHub'), parts: [{ text: counted(commits, 'commit', 'commits') }] }) : null,
  pr && failure ? failureLine({ text: phrase('Can\'t read', pr.number), fix: 'Refresh', detail: failure }) : null,
  pr && !failure && shown(fold, 'PR') ? headerSegment({ act: true, parts: [{ text: pr.number, tone: 'muted' }, shown(fold, 'verdict word') && pr.verdict ? { text: phrase('·', pr.verdict), tone: pr.tone } : null],
    title: facts(shown(fold, 'commits') || !commits ? null : counted(commits, 'commit', 'commits'), shown(fold, 'files') || !files ? null : counted(files, 'file', 'files'), pr.verdict) }) : null);
// Under the pointer: split right, wider or narrower, close and ⋯. A focused agent that finished or idles keeps Sleep and Send out; otherwise they are in ⋯, and a blocked one has no Send.
const restsOut = ({ state, focused }) => focused && ['done', 'idle'].includes(state);
// ⋯ opens its Menu under itself, right-aligned to it; while it is open the tools stay out.
const paneTools = ({ name, state, focused, hover, armed, fold, more }) => stack({ variant: 'pane tools' },
  restsOut({ state, focused }) ? [paneTool('lu-moon', 'Sleep this agent'), paneTool('lu-send', 'Send to another agent')] : null,
  hover && shown(fold, 'tools into ⋯') ? [paneTool('lu-columns-2', 'Split right'), paneTool('lu-move-horizontal', 'Wider or narrower')] : null,
  hover && shown(fold, 'close into ⋯') ? button({ label: 'Close', kind: 'icon', size: 'sm', icon: 'lu-x', armed, verb: phrase('close', name) }) : null,
  hover ? stack({ variant: 'pane more' }, button({ label: 'More', kind: 'icon', size: 'sm', icon: 'lu-ellipsis', active: Boolean(more) }), more ? stack({ variant: 'pane menu' }, more) : null) : null);
export const paneHeader = ({ program = 'p-claude', name, state = 'none', focused = false, keyboard = false, hover = false, pinned = false, zoomed = false, menu: open = false, reach = 'here', held = false, armed = false, renaming = false, place = null, digest = {}, fold = 0 }) => stack(
  { variant: 'pane header', focus: focused, keyboard, blocked: state === 'blocked', unreachable: reach === 'unreachable', held },
  glyph(program),
  renaming ? input({ text: name, label: 'Name', inline: true, selected: true, limit: paneNameLimit }) : paneName({ name }),
  place?.folder && shown(fold, 'folder') ? headerSegment({ icon: 'lu-folder', parts: [{ text: place.folder }] }) : null,
  place?.branch && shown(fold, 'branch') ? headerSegment({ icon: 'lu-git-branch', parts: [{ text: place.branch }] }) : null,
  paneDigest(digest, fold, state === 'working'),
  pinned ? headerSegment({ icon: 'lu-pin', tone: 'dim', title: 'Pinned' }) : null,
  grow(),
  paneTools({ name, state, focused, hover: hover || open, armed, fold, more: open ? paneMenu({ name, state, focused, pinned, zoomed, fold }) : null }),
  reach === 'unreachable' || !paneMarks[state] ? null : mark({ status: paneMarks[state] }));
// ⋯ holds what is not out: pin, sleep, send, open with, split down, zoom, and the tools folded away.
export const paneMenu = ({ name, state = 'none', focused = false, pinned = false, zoomed = false, fold = 0 }) => menu({ title: name, items: [
  { icon: 'lu-pin', label: pinned ? 'Unpin' : 'Pin' },
  ...(state === 'none' || restsOut({ state, focused }) ? [] : [{ icon: 'lu-moon', label: 'Sleep this agent' }]),
  ...(state === 'blocked' || restsOut({ state, focused }) ? [] : [{ icon: 'lu-send', label: 'Send to another agent' }]),
  { icon: 'lu-external-link', label: 'Open with…' }, { icon: 'lu-rows-2', label: 'Split down' }, zoomed ? { icon: 'lu-minimize-2', label: 'Unzoom' } : { icon: 'lu-maximize-2', label: 'Zoom' },
  ...(shown(fold, 'tools into ⋯') ? [] : [{ icon: 'lu-columns-2', label: 'Split right' }, { icon: 'lu-move-horizontal', label: 'Wider or narrower' }]),
  ...(shown(fold, 'close into ⋯') ? [] : [{ icon: 'lu-x', label: 'Close' }]),
  ...pieceLines] });

// The dōjō: the path of levels, the board or the result, Hachi and his line, then the Keyboard with the level's keys marked.
const dojoHeader = ({ title, level, name, share, shared, end, leave }) => stack({ variant: 'dojo header' }, dojoTitle({ title, level, name }), grow(),
  share ? button({ label: 'Share', kind: 'icon', icon: 'lu-share', active: shared }) : null, end ? button(end) : null, button(leave));
const dojoPath = ({ levels, keys }) => stack({ variant: 'dojo path' }, levels.map(dojoLevel), stack({ variant: 'dojo path keys' }, keyLegend({ items: keys })));
const dojoWorld = ({ cells, lines }) => cells
  ? stack({ variant: 'dojo grid' }, cells.map(dojoCell))
  : stack({ variant: 'dojo text' }, lines.map((line) => stack({ variant: 'dojo line' }, line.map(dojoCharacter))));
const dojoPlay = ({ statistics, progress, world }) => stack({ variant: 'dojo board' }, dojoStatistics(statistics), dojoProgress(progress), dojoWorld(world));
const dojoResult = ({ record, summary, keys }) => stack({ variant: 'dojo board', result: true }, dojoRecord(record), dojoSummary({ text: summary }), stack({ variant: 'dojo result keys' }, keyLegend({ items: keys })));
export const dojo = ({ header, path, play, result, pixels, sleep, feedback, marks, share }) => stack({ variant: 'dojo' },
  dojoHeader(header),
  stack({ variant: 'dojo body' }, dojoPath(path), stack({ variant: 'dojo main' },
    result ? dojoResult(result) : dojoPlay(play),
    stack({ variant: 'dojo conversation' }, mascot({ pixels }), sleep ? sleepLabel({ text: sleep }) : null, dojoFeedback(feedback)),
    keyboard({ marks, inert: true }))),
  share ? stack({ variant: 'dojo menu' }, menu(share)) : null);

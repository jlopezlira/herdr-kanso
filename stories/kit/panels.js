import { band, bars, button, chord, device, deviceScreen, dialog, facts, keyHint, mark, markdown, menu, metric, note, pieceLines, emptyState, excerpt, failureBlock, input as kitInput, list, phrase, picture, pin, release, row as kitRow, setting, skeletonOf, stack, tabs, toggle, windowMap, code, explainButton, sentence, well, delta, heatmap, shareCard, statusItem, thumbnail, grow } from './kit.js';import { channelSettings, keyboardExplorer, newWorktree, notice, panel, panelBack, panelClose, panelHeader as kitPanelHeader, panelRefresh, shortcutRow } from './compositions.js';

export const row = (props) => kitRow({ apart: true, ...props });
const input = (props) => kitInput({ multiline: false, ...props });
export const panelHeader = (props) => kitPanelHeader({ apart: true, ...props });
export const waiting = ({ reading = false, failure = null, empty = null }, count = 3, shape = 'list row') => (failure ? failureBlock(failure) : reading ? skeletonOf({ shape, count }) : empty ? emptyState(empty) : null);
const refusable = ({ open, refused }, props) => list(row(props), open && refused ? failureBlock(refused) : null);
const kept = (...items) => items.filter(Boolean);
const within = (reach) => (verb) => ({ ...verb, disabled: verb.disabled || !reach });
const unread = ({ reading, failure }, count) => waiting({ reading, failure }, count);

export const settingsPages = [{ key: 'pieces', label: 'What shows' }, { key: 'keys', label: 'Keys' }, { key: 'news', label: 'What’s new' }, { key: 'credits', label: 'Credits' }];
const findField = (query, extra = {}) => input({ label: 'Find', lead: 'lu-search', focus: Boolean(query), ...(query ? { text: query } : {}), ...extra });
const findArrows = (moves) => [{ label: 'Previous match', icon: 'lu-chevron-up' }, { label: 'Next match', icon: 'lu-chevron-down' }].map((arrow) => button({ ...arrow, kind: 'icon', disabled: !moves }));
const possessive = (name) => chord(null, name, '’s');
export const heading = (name, extra = {}) => row({ name, heading: true, ...extra });

const orderTools = [{ label: 'Move up', icon: 'lu-chevron-up' }, { label: 'Move down', icon: 'lu-chevron-down' }];
const pieceRow = ({ name, on = true, when = null, where = null, order = false, selected = false, pending = false }) => row({
  name, detail: where, meta: on ? when : null, dimmed: !on, current: selected, pending, actions: order ? orderTools : [], tools: [toggle({ checked: on, label: name })],
});
const hiddenRow = (hover) => ([name, where]) => row({ name, hover: hover === name, detail: hover === name ? where : null, action: hover === name ? { label: 'Show', kind: 'quiet' } : null });
const hiddenList = ({ hidden, hover }) => list(heading('Hidden by you', { action: hidden.length ? { label: 'Show all', kind: 'quiet' } : null }),
  hidden.length ? hidden.map(hiddenRow(hover)) : emptyState({ icon: 'lu-eye', text: 'Nothing hidden' }));
const areaPicker = ({ area }) => stack({ variant: 'column' }, windowMap({ picked: area }), ['Hidden by you', 'Behind the scenes'].map((name) => row({ name, current: area === name })));
const areaList = ({ name, stops, pieces, order, selected, pending, changed }) => stack({ variant: 'column' },
  heading(name, { second: stops, action: changed ? { label: changed === 'undo' ? 'Back to the defaults' : 'Reset all', kind: 'quiet' } : null }),
  pieces.map((item) => pieceRow({ ...item, order, selected: item.name === selected, pending: item.name === pending })));
const foundList = ({ rows }) => rows.length
  ? stack({ variant: 'column' }, heading('Find'), rows.map(([name, where, on = true]) => pieceRow({ name, where, on })))
  : emptyState({ icon: 'lu-search', text: 'No piece matches' });
export const whatShows = ({ view = 'hidden', query = null, hidden = [], hover = null, area = null, areas = {}, found = { rows: [] }, selected = null, pending = null, changed = null }) => view === 'hidden'
  ? list(stack({ variant: 'line' }, findField(query), button({ label: 'Browse the window', kind: 'quiet' })), hiddenList({ hidden, hover }))
  : list(findField(query), stack({ variant: 'columns' }, areaPicker({ area: view === 'find' ? null : area }),
    view === 'find' ? foundList(found) : areaList({ name: area, ...areas[area], selected, pending, changed })));

const groupRow = (name, actions) => row({ name, chip: phrase(actions.length) });
const practiceRow = () => row({ name: 'Practice them', action: { label: 'hjkl dōjō', kind: 'quiet' } });
const groupBlock = (open, practice) => ([name, actions]) => (name === open
  ? list(groupRow(name, actions), actions.map((item) => shortcutRow(item)), name === practice ? practiceRow() : null)
  : groupRow(name, actions));
const herdrKeys = (count) => row({ name: 'Herdr’s keys', chip: phrase(count), flag: 'lu-external-link' });
export const settingsKeys = ({ query = null, os, layer, picked, groups = {}, herdr = 0, open = null, practice = null }) => list(findField(query), keyboardExplorer({ os, layer, picked }),
  open ? list(Object.entries(groups).map(groupBlock(open, practice)), herdrKeys(herdr)) : stack({ variant: 'columns' }, Object.entries(groups).map(groupBlock(open, practice)), herdrKeys(herdr)));

const checks = ({ auto = true, checking = false }) => setting({ label: 'Check for kansō updates', control: toggle({ checked: auto, label: 'Check for kansō updates' }),
  link: button({ label: checking ? 'Checking…' : 'Check for updates', kind: 'quiet', size: 'sm', spin: checking }) });
const releases = ({ newer, installed, older, installing = false, unfolded = [] }) => stack({ variant: 'timeline' },
  newer ? release({ ...newer, node: 'newer', action: phrase(installing ? 'Updating to' : 'Update to', newer.version) }) : null,
  release({ ...installed, node: 'here', changes: [] }),
  unfolded.length ? unfolded.map((item) => release({ ...item, node: 'newer' })) : release({ version: phrase(older.from, 'to', older.to), node: 'older' }));
const stale = ({ read }) => setting({ label: phrase('Read', read, '· GitHub not answering'), control: button({ label: 'Refresh', kind: 'quiet', size: 'sm' }) });
export const whatsNew = ({ channel = 'stable', art = true, auto, checking, reading = false, failure = null, read = null, stay = null, ...timeline }) => list(
  channelSettings({ channel, art }), checks({ auto, checking }),
  stay ? setting({ label: stay }) : null,
  read ? stale({ read }) : null,
  reading ? skeletonOf({ shape: 'line', count: 4 }) : failure ? failureBlock(failure) : releases(timeline));

const placeRow = (hover) => ({ name, note, url }) => row({ name, hover: hover === name, detail: hover === name ? note : null, meta: hover === name ? url : null, flag: hover === name ? 'lu-external-link' : null });
export const credits = ({ places = [], maintainers = [], hover = null }) => list(places.map(placeRow(hover)), row({ name: 'Maintained by', detail: maintainers }));

const pageBody = { pieces: whatShows, keys: settingsKeys, news: whatsNew, credits };
export const settings = ({ page = 'pieces', ...props }) => dialog({
  title: 'kansō settings', size: 'window',
  tools: [tabs({ items: settingsPages, value: page, size: 'sm', track: true, label: true })],
  body: pageBody[page](props),
});

const dayOf = (query, at) => ([day, hits]) => list(row({ name: day, heading: true }), hits.map((item) => excerpt({ ...item, query, current: item === at })));
const turnOpen = ({ query, at, turn }) => excerpt({ ...at, text: turn, query, lead: button({ label: 'Back', kind: 'icon', icon: 'lu-chevron-left' }) });
const findBody = ({ agent, query, days = [], at = null, open = false, turn, reading = false, missing = null }) => {
  if (!query) return null;
  if (missing) return failureBlock({ text: phrase('Can’t read', possessive(agent), 'conversation'), source: missing, fix: 'Refresh', agent });
  if (reading) return skeletonOf({ shape: 'line', count: 4 });
  if (!days.length) return emptyState({ icon: 'lu-search', text: phrase('No matches in', possessive(agent), 'conversation') });
  return open ? turnOpen({ query, at, turn }) : days.map(dayOf(query, at));
};
export const conversationFind = ({ count, ...found }) => dialog({
  size: 'find', label: 'Find in the conversation', tools: findField(found.query, { label: 'Find in the conversation', focus: true, count, tools: findArrows(Boolean(count)) }), body: list(findBody(found)),
});

const fileViews = [{ key: 'changed', label: 'Changed' }, { key: 'all', label: 'All files' }];
const fileRow = (picked) => ({ name, folder, stat, letter }) => row({ name, letter, detail: folder, meta: stat, current: name === picked });
const changedList = ({ named = [], unchanged = [], also = [], picked = null }) => (named.length || unchanged.length
  ? list(named.map(fileRow(picked)), unchanged.length ? row({ name: 'Named, unchanged', detail: unchanged, dimmed: true }) : null, also.length ? row({ name: 'Also changed', heading: true }) : null, also.map(fileRow(picked)))
  : also.map(fileRow(picked)));
const treeRow = (picked) => ({ name, level, open, count = null, letter = null, more = null, failure = null }) => waiting({ failure })
  ?? row(more ? { name: more, level, dimmed: true } : { name, level, open, letter, icon: open === undefined ? 'lu-file' : 'lu-folder', chip: count, current: name === picked });
const filesBody = ({ view, files = {}, tree = [], picked = null, ...wait }) => waiting(wait, 5, 'row')
  ?? (view === 'changed' ? changedList({ ...files, picked }) : tree.map(treeRow(picked)));
const fileMenu = (path) => menu({ title: path, items: [{ icon: 'lu-git-pull-request', label: 'Open the diff' }, { icon: 'lu-file', label: 'Open', hint: '↵' }, { icon: 'lu-external-link', label: 'Open with…' }, { icon: 'lu-copy', label: 'Copy path' }, ...pieceLines] });
const filesPanel = ({ view = 'changed', repository = true, scope = null, stale = false, look = 'panel', ...body }) => panel({ look, stale, header: panelHeader({
  title: 'Files', second: scope,
  tools: [repository ? tabs({ items: fileViews, value: view, size: 'sm' }) : null, panelRefresh({ reading: body.reading || stale })],
}) }, filesBody({ view: repository ? view : 'all', ...body }));
export const files = ({ menu: path = null, ...props }) => withBeside(filesPanel(props), path ? fileMenu(path) : null);

const shareTargets = ['Post to X', 'Post to LinkedIn', 'Post to Bluesky'];
const shareItem = (making) => (label) => (label === making ? { label: 'Making the image…', mark: 'working' } : { label, disabled: Boolean(making) });
export const shareMenu = ({ leaves, making = null }) => {
  const item = shareItem(making);
  return menu({ title: leaves, items: [...shareTargets.map(item), { separator: true }, item('Save image')] });
};
const shareButton = ({ disabled = false, active = false } = {}) => button({ label: 'Share', kind: 'icon', icon: 'lu-share', disabled, active });
const withBeside = (drawn, beside) => (beside ? stack({ variant: 'columns' }, drawn, beside) : drawn);

const stopVerb = ({ armed, stopping, keyboard }) => (stopping ? { label: 'Stopping…', disabled: true } : { label: 'Stop', armed, verb: 'stop', focus: keyboard });
const browserVerb = (narrow) => ({ label: narrow ? 'Open' : 'Open in the browser' });
const verbsOf = ({ pane }, { narrow, ...stop }) => (pane
  ? [{ label: phrase('Go to', pane) }, browserVerb(narrow), stopVerb(stop)]
  : [{ ...stopVerb(stop), kind: stop.armed ? 'quiet' : 'solid' }, browserVerb(narrow)]);
const serverRow = ({ picked, refused, narrow, armed, stopping, reach, keyboard }) => (item) => {
  const open = item.port === picked;
  return refusable({ open, refused }, {
    name: item.port, detail: item.pane ?? item.what, meta: item.size, current: open && !keyboard, selected: open && keyboard,
    second: open && !narrow ? facts(item.command, item.folder, item.age) : null,
    verbs: open ? verbsOf(item, { narrow, armed, stopping, keyboard }).map(within(reach)) : [],
  });
};
const noPaneHeading = ({ count, hover, armed }) => row({ name: 'No pane', heading: true, action: hover ? { label: phrase('Stop', count), kind: 'quiet', armed, verb: 'stop every one' } : null });
const historyFold = (open, fold = {}) => row({ name: 'History', level: 0, open, ...fold });
const historyRow = ({ name, ports, when, ran, peak, how }) => row({ name, meta: peak, second: facts(ports, when, ran, how) });
const historyLists = (lists, each) => {
  const shown = lists.filter(({ rows }) => rows.length);
  const [first] = shown;
  if (!first) return null;
  return list(shown.length > 1 ? tabs({ items: shown, value: first.key, size: 'sm' }) : row({ name: first.label, heading: true }),
    first.rows.map(each), first.more ? button({ label: phrase('Show', first.more, 'more'), kind: 'quiet', size: 'sm' }) : null);
};
const guardLine = (said) => setting({ label: said, control: button({ label: 'Turn on the guard', kind: 'quiet', size: 'sm' }) });
const historyChart = ({ ranges, range, most, summary, lists, each, ...chart }) => list(
  stack({ variant: 'line' }, tabs({ items: ranges, value: range ?? ranges[0].key, size: 'sm' }), row({ name: most, dimmed: true })),
  bars(chart), summary.length ? row({ name: facts(...summary), dimmed: true }) : null, historyLists(lists, each));
const history = ({ open = false, fold = {}, guard = null, reading = false, failure = null, lists = [], each = historyRow, ...chart }) => (open
  ? list(historyFold(true, fold), guard ? guardLine(guard) : null, waiting({ reading, failure }) ?? (guard && !chart.bars ? null : historyChart({ lists, each, ...chart })))
  : historyFold(false, fold));
const portsShown = ({ servers, picked = null, refused = null, armed = false, stopping = false, keyboard = false, heading = {}, reach = true, look, reading = false, failure = null, unattributed = null, history: past }) => {
  const { noPane = [], inPanes = [] } = servers;
  const each = serverRow({ picked, refused, armed, stopping, reach, keyboard, narrow: look === 'narrow' });
  return list(
    noPane.length || inPanes.length ? null : emptyState({ icon: 'lu-plug', text: 'No servers listening' }),
    noPane.length ? list(noPaneHeading({ count: noPane.length, ...heading }), noPane.map(each)) : null,
    inPanes.map(each), unattributed ? setting(unattributed) : null, past ? history(past) : null);
};
const portsBody = (body) => unread(body) ?? portsShown(body);
const portsPanel = ({ scope = null, stale = false, look = 'panel', ...body }) => panel({ look, stale, header: panelHeader({
  title: 'Ports', second: scope, tools: [shareButton(), panelRefresh({ reading: body.reading || stale })],
}) }, portsBody({ look, ...body, reach: !stale }));
const cameFrom = (entry, drawn) => (entry ? stack({ variant: 'column' }, stack({ variant: 'status bar' }, grow(), statusItem({ ...entry, open: true })), drawn) : drawn);
export const ports = ({ share = false, entry = null, ...props }) => withBeside(cameFrom(entry, portsPanel({ ...props, keyboard: Boolean(entry) })), share ? shareMenu({ leaves: 'Counts and sizes only' }) : null);

const documentTools = {
  source: ({ doc }) => button({ label: doc.view === 'source' ? 'Formatted' : 'Source', kind: 'icon', icon: 'lu-code', active: doc.view === 'source' }),
  refresh: ({ shot }) => panelRefresh({ reading: shot?.state === 'loading' }),
  done: () => button({ label: 'Done', size: 'sm' }),
  save: ({ saving = false }) => button({ label: saving ? 'Saving…' : 'Save', size: 'sm', spin: saving, disabled: saving }),
  discard: ({ discarding = false }) => button({ label: 'Discard', kind: 'icon', icon: 'lu-undo', armed: discarding }),
  'open with': () => button({ label: 'Open with…', kind: 'icon', icon: 'lu-external-link' }),
};
const documentHeader = ({ back, file, folder, said = [], tools = [], ...props }) => panelHeader({
  title: file, start: [panelBack(back)], second: facts(folder, ...said), tools: [...tools.map((tool) => documentTools[tool](props)), panelClose()],
});
const documentBody = ({ band: changed = null, refused = null }, ...text) => list(changed ? band(changed) : null, refused ? failureBlock(refused) : null, text);
export const dimLine = (name) => (name ? row({ name, dimmed: true }) : null);

const markdownBack = 'Markdown in this folder';
const markdownHeader = ({ file, folder, reading = false, ...props }) => (file
  ? documentHeader({ back: markdownBack, file, folder, ...props })
  : panelHeader({ title: 'Markdown', second: folder, tools: [panelRefresh({ reading }), panelClose()] }));
const markdownFile = (picked) => ([name, where = null]) => row({ name, icon: 'lu-file', meta: where, current: name === picked });
const markdownFiles = ({ groups = [], picked = null, reading = false, empty = null }) => {
  const shown = groups.filter(([, files]) => files.length);
  return waiting({ reading, empty: empty && { icon: 'lu-file', text: empty } })
    ?? shown.map(([name, files]) => list(shown.length > 1 ? heading(name) : null, files.map(markdownFile(picked))));
};
export const markdownWindow = ({ stale = false, ...props }) => panel({ look: 'window', stale, header: markdownHeader(props) },
  props.file ? documentBody(props, markdown(props.doc), dimLine(props.also)) : markdownFiles(props));

const quiet = (verb) => button({ kind: 'quiet', size: 'sm', ...verb });
const quitLabel = (stops) => (stops ? phrase('Quit Docker', chord(null, '(', phrase('stops', stops), ')')) : 'Quit Docker');
const cost = ({ held, limit, disk, stops, hover = false, armed = false }) => list(
  stack({ variant: 'line' }, metric({ value: held, unit: 'held', size: 'sm' }), quiet({ label: disk })),
  hover ? row({ name: phrase('Can grow to', limit), dimmed: true, action: { label: quitLabel(stops), kind: 'quiet', armed, verb: 'quit Docker' } }) : null);
const healthMarks = { failed: 'blocked', stopped: 'idle' };
const healthVerbs = {
  running: ({ web }) => [web ? { label: 'Open' } : null, { label: 'Logs' }, { label: 'Shell' }, { label: 'Restart' }, { label: 'Stop' }],
  failed: () => [{ label: 'Logs', kind: 'solid' }, { label: 'Start' }],
  stopped: () => [{ label: 'Start' }, { label: 'Logs' }],
};
const containerVerbs = (item, { details, armed, pending, local }) => [
  ...healthVerbs[item.health]({ web: item.web && local }), { label: details ? 'Less' : 'Details' },
  item.health === 'running' ? null : { label: 'Remove', armed, verb: 'remove' },
].filter(Boolean).map((verb) => ({ ...verb, disabled: pending }));
const detailRows = (said) => (said.length ? said.map(([name, value]) => row({ name, detail: value, depth: 1 })) : row({ name: 'No details from Docker', depth: 1, dimmed: true }));
const eachPicked = (picked, draw) => (item) => draw(item, item.name === picked);
const containerRow = ({ picked, details, said = [], armed, pending, refused, narrow, local }) => eachPicked(picked, (item, open, status = healthMarks[item.health]) => list(refusable({ open, refused: details ? null : refused }, {
  name: item.name, meta: item.meta, late: item.health === 'failed', current: open, pending: open && pending,
  start: status ? [mark({ status, size: 'sm' })] : [],
  second: open ? facts(narrow ? null : item.image, item.ports, item.age) : null,
  verbs: open ? containerVerbs(item, { details, armed, pending, local }) : [],
}), open && details ? [detailRows(said), refused ? failureBlock(refused) : null] : null));
const bulkVerbs = (containers) => {
  const running = containers.filter(({ health }) => health === 'running').length;
  return [running > 1 ? { label: 'Stop all' } : null, containers.length - running > 1 ? { label: 'Start all' } : null];
};
const projectVerbs = ({ containers }, armed) => kept(
  { label: containers.length ? 'Up again' : 'Up' }, { label: 'Rebuild' },
  containers.length ? { label: 'Down', armed, verb: 'take it down' } : null, ...bulkVerbs(containers));
const projectBlock = ({ hover, down, each }) => (project) => {
  const pointed = project.name === hover || project.name === down;
  return list(row({
    name: project.name, heading: true, hover: pointed, detail: pointed ? project.compose : null, meta: pointed ? null : project.count,
    verbs: pointed ? projectVerbs(project, project.name === down) : [],
  }), project.containers.map(each));
};
const looseBlock = (loose, each) => (loose.length ? list(row({ name: 'Not in a project', heading: true, dimmed: true }), loose.map(each)) : null);

const runForm = ({ name, port, field = null, source = null, image: picked }) => list(stack({ variant: 'line' },
  input({ label: 'Name', text: name, focus: field === 'name', error: field === 'name' }),
  input({ label: 'Port', text: port, focus: field === 'port', error: field === 'port' }),
  source ? null : button({ label: 'Run', size: 'sm' })), source ? failureBlock({ text: phrase('Could not run', picked), source, fix: 'Run' }) : null);
const imageRow = ({ picked, run, armed }) => eachPicked(picked, (item, open) => list(row({
  name: item.name, meta: item.size, dimmed: item.unused, current: open, second: open ? item.users : null,
  verbs: open ? [{ label: run ? 'Cancel' : 'Run…' }, item.unused ? { label: 'Remove', armed, verb: 'remove' } : null].filter(Boolean) : [],
}), open && run ? runForm({ ...run, image: item.name }) : null));
const disk = ({ summary, pull, spare, images, volumes, unusedVolumes, cache, picked = null, run = null, armed = null }) => list(
  row({ name: 'Disk', level: 0, open: true, meta: summary }),
  input({ label: 'Image to pull', text: pull, action: 'Pull' }),
  row({ name: 'Images', heading: true, action: { label: phrase('Remove unused ·', spare), kind: 'quiet', armed: armed === 'images', verb: 'remove them' } }),
  images.map(imageRow({ picked, run, armed: armed === 'image' })),
  row({ name: 'Volumes', heading: true, action: { label: phrase('Remove', unusedVolumes, 'unused'), kind: 'quiet', armed: armed === 'volumes', verb: 'delete their data for good' } }),
  volumes.map(({ name, users }) => row({ name, meta: users, dimmed: users === 'unused' })),
  row({ name: 'Build cache', heading: true, action: { label: phrase('Clear', cache), kind: 'quiet', armed: armed === 'cache', verb: 'clear' } }));

const dockerWaits = {
  down: ({ unopened }) => waiting({ failure: unopened, empty: { icon: 'lu-container', text: 'Docker isn’t running', action: 'Open Docker' } }),
  starting: () => list(row({ name: 'Starting Docker…', dimmed: true }), waiting({ reading: true })),
};
const containersShown = ({ projects = [], loose = [], cost: held = null, hover = null, down = null, disk: opened = null, docker = 'running', unopened = null, reading = false, failure = null, unattributed = null, look, local = true, ...picks }) => {
  if (opened) return disk(opened);
  const each = containerRow({ ...picks, local, narrow: look === 'narrow' });
  return list(held ? cost(held) : null, unattributed ? setting(unattributed) : null,
    projects.length || loose.length ? null : emptyState({ icon: 'lu-container', text: 'No containers' }),
    projects.map(projectBlock({ hover, down, each })), looseBlock(loose, each));
};
const containersBody = (body) => waiting({ failure: body.failure }) ?? dockerWaits[body.docker]?.(body) ?? waiting({ reading: body.reading }) ?? containersShown(body);
export const containers = ({ scope = null, stale = false, look = 'panel', context = false, ...body }) => panel({ look, stale, header: panelHeader({
  title: 'Containers', second: scope, tools: [panelRefresh({ reading: body.reading || body.docker === 'starting' || stale })],
}) }, containersBody({ look, ...body, local: !context && !stale }));

const freeLine = ({ value, of, swap, hover = false, low = false, paused = false }) => metric({ value, unit: facts(of, hover ? swap : null, paused ? 'paused' : null), tone: low ? 'blocked' : undefined });
const bulkLine = ({ idle, back, heavy, unused, only }, { low, armed }) => (only
  ? row({ name: only, dimmed: true })
  : row({ name: idle, meta: back, verbs: [{ label: 'Recycle all', kind: low ? 'solid' : undefined }, heavy ? { label: heavy } : null, unused ? { label: unused, armed, verb: 'close them' } : null].filter(Boolean) }));
const herdrRow = ({ size, window: held, core, limit, over = false }, open) => row({
  name: 'Herdr', meta: over ? { text: size, tone: 'blocked' } : size, current: open,
  second: open ? facts(held, core, over ? limit : null) : null,
  verbs: open ? [{ label: 'Restart window', kind: over ? 'solid' : undefined }] : [],
});
const helpersRow = ({ count, size }, armed) => row({ name: phrase(count, 'hung helpers'), meta: size, action: { label: 'End', kind: 'quiet', armed, verb: phrase('end', count) } });
const sessionVerbs = (item, { armed, unrecyclable }) => kept(
  item.state === 'idle' && !unrecyclable ? { label: 'Recycle' } : null,
  item.state === 'working' ? null : { label: 'Close', armed, verb: 'close' });
const sessionMeta = (item, done) => done ?? (item.over ? { text: item.size, tone: 'working' } : item.size);
const sessionRow = ({ picked, armed, refused, spark, unrecyclable, batch }) => {
  const done = Object.fromEntries(batch?.done ?? []);
  return eachPicked(picked, (item, open) => list(row({
    name: item.name, meta: sessionMeta(item, done[item.name]), current: open, pending: item.name === batch?.current,
    mark: item.state === 'blocked' ? 'blocked' : 'none',
    second: open ? facts(...item.said, unrecyclable) : null,
    verbs: open ? sessionVerbs(item, { armed, unrecyclable }) : [],
  }), open && spark ? bars({ bars: spark }) : null, open && refused ? failureBlock(refused) : null));
};
const batchLine = ({ said, finished }) => row({ name: said, dimmed: true, action: finished ? { label: 'Dismiss', kind: 'quiet' } : null });
const eventRow = ([name, when, late = false]) => row({ name, meta: late ? { text: when, tone: 'blocked' } : when });
const guardRules = (rules) => rules.map(([label, on]) => setting({ label, control: toggle({ checked: on, label }) }));
const memoryFoot = ({ guard, past }) => list(
  stack({ variant: 'line' }, row({ name: guard.said, level: 0, open: Boolean(guard.open) }), past.open ? null : historyFold(false)),
  guard.open ? guardRules(guard.rules) : null, past.open ? history({ ...past, each: eventRow }) : null);
const memoryWait = ({ guard: state, install }) => ({
  off: () => emptyState({ icon: 'lu-memory-stick', text: 'The memory guard is off', action: 'Turn on' }),
  turning: () => list(row({ name: 'Turning on the guard…', dimmed: true }), waiting({ reading: true })),
  refused: () => failureBlock(install),
})[state];
const memoryShown = ({ free, herdr, helpers = null, sessions = [], more = 0, bulk = null, batch = null, guard = 'on', install = null, rules = [], foot = {}, history: past = { open: false }, picked = null, armed = null, refused = null, reap = null, spark = null, unrecyclable = null, silent = null, reading = false, failure = null }) => {
  const each = sessionRow({ picked, armed: armed === 'session', refused, spark, unrecyclable, batch });
  return list(silent ? guardLine(silent) : null, freeLine(free), bulk ? bulkLine(bulk, { low: free.low, armed: armed === 'unused' }) : null,
    herdrRow(herdr, picked === 'Herdr'), helpers ? helpersRow(helpers, armed === 'helpers') : null, reap ? failureBlock(reap) : null,
    batch ? batchLine(batch) : null, sessions.length ? sessions.map(each) : row({ name: 'No agents running', dimmed: true }),
    more ? button({ label: phrase('Show', more, 'more'), kind: 'quiet', size: 'sm' }) : null,
    memoryFoot({ guard: { said: guard === 'paused' ? 'Guard paused' : 'Guard on', rules, ...foot }, past }));
};
const memoryBody = (body) => unread(body, 4) ?? memoryWait(body)?.() ?? memoryShown(body);
const memoryPanel = ({ scope = null, look = 'panel', title = 'Memory', ...body }) => panel({ look, stale: Boolean(body.stale), header: panelHeader({
  title, second: scope ?? body.stale, tools: [shareButton(), panelRefresh({ reading: body.reading })],
}) }, memoryBody(body));
export const memory = ({ share = false, notice: said = null, ...props }) => withBeside(memoryPanel(props), share ? shareMenu({ leaves: 'Counts and sizes only' }) : said ? notice(said) : null);

const planLine = ({ value, name, said, tone }) => metric({ value, unit: name, second: said, tone });
const costRow = (picked) => eachPicked(picked, (item, open) => row({ name: item.name, detail: item.tag, meta: item.cost, current: open, second: open ? item.said : null }));
const costList = ({ name = null, count = null, rows, picked = null }) => list(name ? row({ name, heading: true, meta: count }) : null, rows.map(costRow(picked)));
const stepper = (past) => stack({ variant: 'line' }, button({ label: 'Previous period', kind: 'icon', icon: 'lu-chevron-left' }), button({ label: 'Next period', kind: 'icon', icon: 'lu-chevron-right', disabled: !past }), past ? quiet({ label: 'Back to now' }) : null);
const pickers = (choices) => Object.values(choices).map((label) => quiet({ label, icon: 'lu-chevron-down' }));
const periodTabs = ({ periods, period }) => tabs({ items: periods, value: period, size: 'sm' });
const periodSwitch = (when) => list(periodTabs(when), stepper(when.past));
const spendNumber = ({ value, unit, said }, { pointer, choices, ...when }) => list(
  pointer === 'period' ? list(stack({ variant: 'line' }, metric({ value, size: 'sm' }), periodTabs(when)), stepper(when.past), stack({ variant: 'line' }, pickers(choices))) : metric({ value, unit, size: 'sm' }),
  pointer === 'number' ? row({ name: facts(...said), dimmed: true }) : null);
const spendLists = [{ key: 'projects', label: 'Projects' }, { key: 'models', label: 'Models' }, { key: 'tasks', label: 'Tasks' }];
const historyBars = ({ open = false, ...chart }) => list(historyFold(open), open ? bars(chart) : null);
const moreRows = (more) => (more ? quiet({ label: phrase('Show', more, 'more') }) : null);
const whereItWent = ({ lists, view = 'projects', pointer, picked, more = 0 }) => list(
  pointer === 'list' ? tabs({ items: spendLists, value: view, size: 'sm' }) : null, costList({ rows: lists[view], picked }), moreRows(more));
const liveList = (live) => list(row({ name: 'Active now', heading: true, pending: true }), live.map(costRow(null)));
const homeBody = ({ plans = [], plain = null, number = null, showing = null, partial = null, refresh = null, computers = null, live = [], unread = null, history: past = { open: false }, ...where }) => list(
  refresh ? failureBlock(refresh) : null,
  plans.map(planLine), plain ? metric(plain) : null, plain ? costList({ rows: plain.programs }) : null,
  unread ? list(costRow(null)(unread.program), failureBlock(unread.failure)) : null,
  number ? spendNumber(number, where) : null, showing ? row({ name: showing, dimmed: true, action: { label: 'Show everything', kind: 'quiet' } }) : null,
  partial ? row({ name: partial, dimmed: true }) : null, computers ? costList({ name: 'Computers', ...computers }) : null,
  live.length ? liveList(live) : null, where.lists ? whereItWent(where) : null, number ? historyBars(past) : null);
const detailBody = ({ value, said, lists, history: past = { open: false }, ...when }) => list(
  periodSwitch(when), metric({ value, unit: 'API value', size: 'sm' }), row({ name: facts(...said), dimmed: true }),
  lists.map(costList), historyBars(past));
const taskBody = ({ where, prompt, value, parts, models, sessions, count, project, history: past = { open: false } }) => list(
  excerpt({ who: where, text: prompt }), metric({ value, unit: 'API value', size: 'sm' }), row({ name: facts(...parts), dimmed: true }),
  costList({ name: 'Models', count: phrase(models.length), rows: models }), costList({ name: 'Sessions', count, rows: sessions }),
  historyBars(past), quiet({ label: phrase('Open', project) }));
const sourceRow = ({ name, where, on, pending = false }) => row({ name, detail: where, dimmed: !on, pending, tools: [toggle({ checked: on, label: name })] });
const planRow = (edit) => (item) => (item.name === edit?.name
  ? row({ name: item.name, second: edit.said, pending: edit.pending, actions: [{ label: 'Remove plan', icon: 'lu-x' }], tools: [input({ label: 'A month', text: edit.cost, focus: !edit.pending, error: edit.error })] })
  : row({ name: item.name, meta: item.cost, second: item.said }));
const newPlan = ({ name, cost, error = false }) => stack({ variant: 'line' }, input({ label: 'ChatGPT Pro, Claude Max…', text: name, focus: !name }), input({ label: '200', text: cost, focus: Boolean(name), error }));
const spendSettings = ({ sources = null, absent, owned, edit = null, added = null, refused = null, unsaved = null, prices, updates }) => list(
  heading('Sources'), sources ? list(sources.map(sourceRow), row({ name: absent, dimmed: true })) : skeletonOf({ shape: 'list row', count: 3 }),
  heading('Plans'), owned.map(planRow(edit)), added ? newPlan(added) : null, refused ? row({ name: refused, dimmed: true }) : null,
  unsaved ? failureBlock(unsaved) : null, quiet({ label: 'Add plan' }),
  heading('Prices'), row({ name: prices.list, second: prices.rule, action: { label: 'Open prices.json', kind: 'quiet' } }),
  heading('Updates'), row({ name: updates.name, second: updates.said }));
const spendBodies = { home: homeBody, detail: detailBody, task: taskBody, settings: spendSettings };
const settingsTool = () => button({ label: 'Settings', kind: 'icon', icon: 'lu-settings' });
const spendTools = ({ page, reading }) => [page === 'home' ? shareButton() : null, page === 'settings' ? null : settingsTool(), panelRefresh({ reading })];
const spendPanel = ({ page = 'home', title = 'Spend', second = null, look = 'panel', reading = false, failure = null, empty = null, ...body }) => panel({ look, header: panelHeader({
  title, second, start: page === 'home' ? [] : [panelBack('Back')], tools: spendTools({ page, reading }),
}) }, waiting({ reading, failure }, 5) ?? (empty ? emptyState(empty) : spendBodies[page](body)));
export const spend = ({ share = false, choosing = null, ...props }) => withBeside(spendPanel(props), share ? shareMenu({ leaves: 'Totals and days only' }) : choosing ? menu({ items: choosing }) : null);

const textOr = (wait, shown) => waiting(wait, 6, 'line') ?? shown();
const previewContent = ({ doc, shot, text, pins }) => (doc ? markdown(doc) : shot ? picture({ ...shot, pins: pinMarks(pins) }) : code(text));
const previewBody = ({ doc = null, shot = null, text = null, cut = null, pins = [], send = null, reading, failure, empty, ...props }) => textOr({ reading, failure, empty }, () => documentBody(props, previewContent({ doc, shot, text, pins }), dimLine(cut), send ? pinNotes({ pins, send }) : null));
export const preview = ({ look = 'panel', stale = false, ...props }) => panel({ look, stale, header: documentHeader({ back: 'Files', ...props }) }, previewBody(props));

const pullTones = { review: 'working', failing: 'blocked', failed: 'blocked', blocked: 'working', changes: 'blocked', draft: 'dim', approved: 'done', running: 'dim', merged: 'dim', closed: 'dim', passed: 'dim' };
export const toned = (text) => ({ text, tone: pullTones[text] });
export const quietAct = (label, key = null) => button({ label, kind: 'quiet', size: 'sm', key });
export const tonalAct = (label, key = null) => button({ label, kind: 'tonal', size: 'sm', key });
export const line = (...items) => stack({ variant: 'line' }, items);
export const pullRow = (picked) => ({ number, title, state, second = null, depth = 0, focus = false, hover = false, keys = [] }) => row({ number, name: title, second, depth, focus, hover, keys, current: number === picked, meta: toned(state) });
export const branchRow = ({ name, computer = null, second, action = null, commits = [] }) => list(
  row({ icon: 'lu-git-branch', name, detail: computer, second, selected: true, action: action ? { label: action, kind: 'quiet' } : null }),
  commits.map((commit) => row({ name: commit, depth: 1, dimmed: true })));
const pullGroup = (picked) => ({ name, pulls = [], everyone = null, branch = null, reading = false }) => list(heading(name), branch ? branchRow(branch) : null,
  pulls.map(pullRow(picked)), reading ? skeletonOf({ shape: 'list row', count: 2 }) : null, everyone ? quietAct(everyone) : null);
const pullTabs = ({ counts, tab }) => tabs({ items: [{ key: 'open', label: counts.open }, { key: 'closed', label: counts.closed }], value: tab, size: 'sm', track: true });
const pullList = ({ groups = [], picked = null, tab = null, counts = null, reading = false, failure = null, empty = null, keep = null }) => waiting({ failure })
  ?? list(tab ? pullTabs({ counts, tab }) : null, waiting({ reading }, 4), groups.map(pullGroup(picked)), empty ? emptyState(empty) : null, keep ? failureBlock(keep) : null);

export const checkRow = ({ name, state, time = null, verbs = [] }) => row({ name, verbs, mark: state === 'running' ? 'working' : 'none', meta: { ...toned(state), text: facts(state, time) } });
const verdictBody = ({ heading: head = null, lines = [], files = null, log = null, checks = [], more = null }) => (head || lines.length || files || log || checks.length
  ? well({ heading: head }, lines.map(([name, value]) => row({ name, detail: value })),
    [files, log].filter(Boolean).map((text) => code({ text, kind: 'log', first: 1 })), checks.map(checkRow), dimLine(more))
  : null);
export const pullActs = {
  ready: () => tonalAct('Ready for review'),
  update: () => tonalAct('Update branch'),
  explain: ({ agent }) => explainButton({ agent, size: 'sm' }),
  log: () => quietAct('Full log'),
  github: () => quietAct('Open log on GitHub'),
  open: () => quietAct('Open on GitHub'),
  reply: () => quietAct('Reply on GitHub'),
  merge: ({ armed = false }) => button({ label: 'Merge', kind: 'tonal', size: 'sm', armed }),
  rerun: ({ keys = false }) => quietAct('Re-run', keys ? 'E' : null),
  squash: ({ armed = false, keys = false }) => button({ label: 'Squash and merge', kind: 'tonal', size: 'sm', armed, verb: 'squash and merge', key: keys ? 'M' : null }),
  merging: () => button({ label: 'Merging…', size: 'sm', spin: true, disabled: true }),
  reopen: () => tonalAct('Reopen'),
  send: ({ agent }) => tonalAct(phrase('Send to', agent)),
};
const comment = (depth) => (said) => excerpt({ ...said, depth });
const field = ({ label, text = null, multiline = false }) => input({ label, text: text ?? undefined, icon: 'lu-send', focus: Boolean(text), multiline });
const thread = ({ where, snippet, first, replies = [], answer = null, agentAnswer = null, answered = null }, { agent, typing = null, refused = null, offline = null, explained = null }) => well({},
  comment(0)({ ...first, where, snippet: code(snippet) }), replies.map(comment(1)), answered ? row({ icon: 'lu-bot', name: answered, dimmed: true }) : null,
  answer ? comment(1)(answer) : null, field({ label: 'Reply', text: agentAnswer ?? typing }), refused ? failureBlock(refused) : null, dimLine(offline),
  line(quietAct('Resolve'), typing || agentAnswer ? null : explainButton({ agent, size: 'sm' }), explained ? row({ name: explained, dimmed: true }) : null));
const conversation = ({ thread: talk = null, resolved = null, approved = null, said = null, agent, ...state }) => list(heading('Conversation'),
  resolved ? row({ icon: 'lu-check', name: resolved.name, detail: resolved.detail, action: { label: 'Undo', kind: 'quiet' } }) : null,
  talk ? thread(talk, { agent, ...state }) : null, approved ? row({ icon: 'lu-check', name: approved.name, meta: approved.meta, dimmed: true }) : null,
  said ? well({}, comment(0)(said)) : null, field({ label: 'Comment' }));
const review = ({ changed, count, draft }, keys = false) => list(heading('Files'), changed.map(fileRow(null)), heading('Your review', { meta: count }),
  stack({ variant: 'column' }, field({ label: 'Review', text: draft, multiline: true }), line(tonalAct('Approve', keys ? 'A' : null), quietAct('Request changes', keys ? 'R' : null), quietAct('Comment', keys ? 'C' : null))));
const peopleRow = ([name, value]) => row({ name, detail: value });
const noPeople = [['Assignees', ['Assign people', 'Assign to me']], ['Reviewers', ['Request a review']], ['Labels', ['Change labels']]];
const detailsBody = ({ description = null, people = [], checks = [], files = [], cut = null, moreChecks = null, diffFailed = null, showAll = 'Show all', nobody = false }) => list(
  heading('Description'), description ? list(markdown({ source: description }), quietAct(showAll)) : dimLine('No description.'),
  heading('People and labels'), nobody ? noPeople.map(([name, verbs]) => row({ name, detail: 'None', verbs: verbs.map((label) => ({ label })) })) : people.map(peopleRow),
  heading('Checks'), checks.map(checkRow), moreChecks ? quietAct(moreChecks) : null,
  heading('Files'), files.map(fileRow(null)), diffFailed ? failureBlock(diffFailed) : null, cut ? list(quietAct(cut.more), dimLine(cut.note)) : null);
const detailsFold = ({ summary, open = false, ...body }) => list(row({ level: 0, open, name: 'Details', meta: open ? null : summary }), open ? detailsBody(body) : null);
const othersBlock = ({ label, pulls }) => list(heading(label), pulls.map(pullRow(null)), quietAct('Open the list'));
const verdictTitle = (name, { text, tone }) => row({ hero: true, name, second: { text, tone } });
export const pullBody = ({ title, verdict, acts = [], agent, armed = false, keys = false, outcome = null, refused = null, sent = null, review: asked = null, message = null, talk = null, others = null, details = null, closing = true, reading = false }) => (reading
  ? list(verdictTitle(title, verdict), skeletonOf({ shape: 'line', count: 3 }))
  : list(verdictTitle(title, verdict), verdictBody(verdict),
    acts.length ? line(acts.map((act) => pullActs[act]({ agent, armed, keys }))) : null, outcome, refused ? failureBlock(refused) : null, sent ? line(dimLine(sent), quietAct('Full log')) : null,
    message ? stack({ variant: 'column' }, row({ name: message.to, strong: true }), markdown({ source: message.text })) : null,
    asked ? review(asked, keys) : null, talk ? conversation({ agent, ...talk }) : null, others ? othersBlock(others) : null,
    details ? detailsFold(details) : null, closing ? line(quietAct('Back to draft'), quietAct('Close')) : null));

const diffInline = {
  comment: ({ draft }) => list(field({ label: 'Comment', text: draft }), line(button({ label: 'Comment', size: 'sm' }))),
  pending: ({ note, draft }) => list(comment(0)({ ...note, pending: true }), field({ label: 'Comment', text: draft }), line(button({ label: 'Add to review', size: 'sm' }))),
  thread: ({ note, replies }) => well({}, comment(0)(note), dimLine(replies), field({ label: 'Reply' })),
};
const diffBody = ({ text = null, chunks = [], between = null, empty, reading, failure, more = null, next = null, ...inline }) => textOr({ reading, failure, empty }, () => {
  const [top = text, ...rest] = chunks;
  return list(code(top), between ? diffInline[between](inline) : null, rest.map(code), more ? row({ name: more, dimmed: true, action: { label: next, kind: 'quiet' } }) : null);
});
export const pullPages = {
  pr: ({ number, scope = null, copied = false, reading = false, checking = false }) => panelHeader({ title: number, start: [panelBack('Pull requests')], second: scope,
    tools: [button({ label: copied ? 'Copied' : 'Copy link', kind: copied ? 'quiet' : 'icon', size: 'sm', icon: copied ? 'lu-check' : 'lu-copy' }), button({ label: 'Open on GitHub', kind: 'icon', icon: 'lu-external-link' }), panelRefresh({ reading: reading || checking })] }),
  file: ({ file, back, facts: said, reading = false }) => panelHeader({ title: file, start: [panelBack(back)], second: said,
    tools: [button({ label: 'Open the file', kind: 'icon', icon: 'lu-file' }), button({ label: 'Open on GitHub', kind: 'icon', icon: 'lu-external-link' }), panelRefresh({ reading })] }),
  log: ({ file, back, facts: said }) => panelHeader({ title: file, start: [panelBack(back)], second: said, tools: [button({ label: 'Copy the log', kind: 'icon', icon: 'lu-copy' }), button({ label: 'Open on GitHub', kind: 'icon', icon: 'lu-external-link' })] }),
  new: ({ facts: said }) => panelHeader({ title: 'New pull request', start: [panelBack('Pull requests')], second: said, tools: [button({ label: 'Create on GitHub', kind: 'icon', icon: 'lu-external-link' })] }),
  list: ({ scope = null, reading = false }) => panelHeader({ title: 'Pull requests', second: scope, tools: [panelRefresh({ reading })] }),
};
export const pullContent = {
  pr: pullBody,
  file: diffBody,
  log: ({ text, agent }) => list(code(text), explainButton({ agent, size: 'sm' })),
  new: ({ title, body, failure = null, creating = false }) => list(input({ label: 'Title', text: title, focus: true }), input({ label: 'Description', text: body, multiline: true }),
    failure ? failureBlock(failure) : null, line(button({ label: creating ? 'Creating…' : 'Create', size: 'sm', spin: creating, disabled: creating }), quietAct('Create as draft'))),
  list: pullList,
};
const pullPanel = ({ page = 'list', look = 'panel', stale = false, ...props }) => panel({ look, stale, header: pullPages[page](props) }, pullContent[page](props));
export const pulls = ({ picker = null, ...props }) => (picker ? stack({ variant: 'columns' }, pullPanel(props), menu(picker)) : pullPanel(props));

const pinMarks = (pins = []) => pins.flatMap(({ n, at, region, text, writing }) => [pin({ n, at, region, pending: !text }), writing ? note({ text, at: writing, typing: true }) : null]);
const pinRow = ({ n, text, hover = false }) => row({ start: [pin({ n, pending: !text })], name: text || 'No note yet', dimmed: !text, hover, tools: hover ? [button({ label: 'Remove', kind: 'icon', icon: 'lu-x' })] : [] });
const sendLabel = (agent) => (agent ? phrase('Send to', agent) : 'Send to…');
const sentLine = ({ sent, open = null }) => list(dimLine(sent), open ? line(tonalAct(open)) : null);
const pinSend = ({ agent = null, sent = null, open = null, refused = null, sending = false }) => {
  if (sent) return sentLine({ sent, open });
  if (refused) return failureBlock(refused);
  return line(button({ label: sending ? 'Sending…' : sendLabel(agent), size: 'sm', spin: sending, disabled: sending }), keyHint({ text: '⌘↩', faint: true }));
};
const pinNotes = ({ pins, send }) => list(pins.map(pinRow), pinSend(send));
const pictureFile = ({ name, folder }) => row({ name, detail: folder, action: { label: 'Open', kind: 'quiet' } });
const pinTools = {
  device: ({ frozen, reading = false }) => [button({ label: 'Pin', kind: 'icon', icon: 'lu-map-pin', active: frozen }), button({ label: 'Device', kind: 'icon', icon: 'lu-smartphone' }), panelRefresh({ reading })],
  picture: ({ kept = false, reading = false }) => [button({ label: 'Keep to this agent', kind: 'icon', icon: 'lu-lock', active: kept }), panelRefresh({ reading })],
};
const pinGround = {
  device: ({ screen, pins = [], ...look }) => device({ ...look, pins: pinMarks(pins) }, deviceScreen(screen)),
  picture: ({ image, file, pins }) => list(picture({ image, pins: pinMarks(pins) }), pictureFile(file)),
};
const agentChoice = ({ name, project }) => ({ label: name, icon: 'p-claude', hint: project });
const pinPicker = (agents) => (agents ? menu({ title: 'Send to', items: agents.map(agentChoice) }) : null);
export const pinPanel = ({ on = 'device', title, scope, frozen = true, pins: placed = [], send = {}, agents = null, ...ground }) => panel({ header: panelHeader({ title, second: scope, tools: pinTools[on]({ frozen }) }) },
  pinGround[on]({ frozen, pins: placed, ...ground }), pinPicker(agents), pinNotes({ pins: placed, send }));

const deviceKeys = {
  ios: [['Appearance light', 'lu-sun'], ['Appearance dark', 'lu-moon'], ['Shut down', 'lu-power']],
  android: [['Back', 'lu-chevron-left'], ['Home', 'lu-house'], ['Recents', 'lu-square'], ['Power', 'lu-lock'], ['Volume up', 'lu-volume-2'], ['Volume down', 'lu-volume-1']],
  emulator: [['Rotate', 'lu-rotate-ccw'], ['Shut down', 'lu-power']],
};
const deviceKey = (acting) => ([label, icon]) => button({ label, kind: 'icon', icon, spin: label === acting, disabled: Boolean(acting) });
const deviceButtons = (keys, acting) => stack({ variant: 'device tools' }, keys.map(deviceKey(acting)));
const deviceControls = {
  ios: ({ acting, url }) => list(deviceButtons(deviceKeys.ios, acting), line(tonalAct('Open in Simulator')), input({ label: 'URL', text: url, action: 'Open a URL' })),
  android: ({ acting }) => deviceButtons(deviceKeys.android, acting),
  emulator: ({ acting }) => deviceButtons([...deviceKeys.android, ...deviceKeys.emulator], acting),
};
const deviceRow = ({ name, runtime, state, picked = false }) => row({ name, detail: runtime, meta: state, current: picked });
const deviceGroup = ({ name, devices }) => list(heading(name), devices.map(deviceRow));
const simScreens = {
  picture: pinGround.device,
  off: () => device({ state: 'off' }),
  waiting: () => device({ state: 'booting' }),
  blank: () => emptyState({ icon: 'lu-image', text: 'No picture from the device' }),
  still: () => emptyState({ icon: 'lu-smartphone', text: 'Off' }),
};
const simHeader = ({ groups, scope, reading }) => (groups
  ? panelHeader({ title: 'Devices', tools: [panelBack('Back to the device'), panelRefresh({ reading })] })
  : panelHeader({ title: 'Simulator', second: scope, tools: pinTools.device({ frozen: false, reading }) }));
const simBody = ({ groups = null, scope, shows = 'picture', controls = null, acting = null, url, said = [], reading = false, failure = null, empty = null, ...look }) => list(said.map(dimLine),
  textOr({ reading, failure, empty }, () => (groups ? groups.map(deviceGroup) : simScreens[shows](look))),
  controls ? deviceControls[controls]({ acting, url }) : null);
export const simulator = ({ look = 'panel', ...props }) => panel({ look, header: simHeader(props) }, simBody(props));

const worktreeVerbs = {
  go: ({ tab }) => ({ label: phrase('Go to', tab) }),
  open: () => ({ label: 'Open in a new tab' }),
  explain: ({ tab }, { agent }) => ({ agent: tab ?? agent }),
  repair: (item, { busy }) => ({ label: busy ? 'Repairing…' : 'Repair the link', disabled: busy }),
  remove: (item, { busy, armed }) => ({ label: busy ? 'Removing…' : 'Remove', armed, verb: 'remove', disabled: busy }),
};
const verbsByKind = { open: ['go', 'explain'], held: ['open', 'explain'], broken: ['repair', 'open'], record: ['remove'], removable: ['open', 'explain', 'remove'] };
const worktreeFacts = ({ verdict, age }, { open, busy }) => (busy ? [{ text: 'Removing…' }] : open || verdict.tone ? [verdict, age] : null);
const worktreeRow = ({ picked, armed, busy, refused, agent, reach }) => eachPicked(picked, (item, open, working = item.name === busy) => refusable({ open, refused }, {
  name: item.name, detail: item.branch, meta: item.size, current: open, pending: working,
  second: worktreeFacts(item, { open, busy: working && item.kind !== 'broken' }), reason: open && !refused ? item.reason : null, path: open && !refused ? item.path : null,
  verbs: open && !refused ? verbsByKind[item.kind ?? 'removable'].map((key) => worktreeVerbs[key](item, { agent, armed, busy: working })).map(within(reach)) : [],
}));
const groupVerbs = ({ more = 0, all = 0, prune = null }, armed) => stack({ variant: 'line' },
  more ? quiet({ label: phrase('Show', more, 'more') }) : null, prune ? quiet({ label: prune }) : null,
  all > 1 ? quiet({ label: phrase('Remove all', all), armed, verb: phrase('remove', all) }) : null);
const repoBlock = ({ armed, each }) => (group) => list(heading(group.name, { meta: group.size }), group.rows.map(each),
  groupVerbs(group, group.name === armed), group.name === armed ? sentence(group.losses) : null);
const cleanUp = ({ count, size }, { armed, cleaning, ready }) => button({ label: cleaning ? 'Removing…' : phrase('Clean up', count, '·', size), size: 'sm', armed, verb: phrase('remove', count), disabled: cleaning || !ready });
const worktreeHero = ({ total, plan = null, review = true, armed = null, cleaning = false, ready = true, pointer = false, space = [], agent, look }) => list(
  metric({ value: total.value, unit: look === 'narrow' ? total.narrow : total.unit }), pointer ? sentence({ text: facts(...space) }) : null,
  stack({ variant: 'line' }, plan ? cleanUp(plan, { armed: armed === 'all', cleaning, ready }) : null, review && armed !== 'all' ? explainButton({ agent, size: 'sm' }) : null),
  armed === 'all' ? sentence({ text: plan.names }) : null);
const worktreesShown = ({ reading = false, failure = null, repos = [], many = [], hidden = 0, left = null, freed = null, stayed = null, note = null, armed = null, picked = null, busy = null, refused = null, agent = 'checkout', reach = true, ...hero }) => {
  if (!repos.length && !left) return emptyState({ icon: 'lu-git-fork', text: 'No worktrees besides your checkouts' });
  const block = repoBlock({ armed, each: worktreeRow({ picked, armed: armed === 'row', busy, refused, agent, reach }) });
  return list(worktreeHero({ ...hero, armed, agent, ready: hero.ready !== false && reach }), stayed ? row({ name: stayed, dimmed: true }) : null, note ? failureBlock(note) : null,
    [...repos, ...many].map(block), hidden ? quiet({ label: phrase('Show', hidden, 'more repositories') }) : null, left ? block(left) : null, freed ? history(freed) : null);
};
const worktreesBody = (body) => unread(body) ?? worktreesShown(body);
const newWorktreeTool = () => button({ label: 'New worktree', kind: 'icon', icon: 'lu-plus' });
const worktreesPanel = ({ phase = null, scope = null, stale = false, look = 'panel', ...body }) => panel({ look, stale, header: panelHeader({
  title: 'Worktrees', second: scope ?? phase, tools: [newWorktreeTool(), shareButton(), panelRefresh({ reading: Boolean(phase) || stale })],
}) }, worktreesBody({ look, reach: !stale, ...body }));
export const worktrees = ({ share = false, notice: said = null, creating = null, ...props }) => withBeside(worktreesPanel(props),
  share ? shareMenu({ leaves: 'Totals only' }) : said ? notice(said) : creating ? newWorktree(creating) : null);

const periodLine = (when) => stack({ variant: 'line' }, periodTabs(when), stepper(when.past));
const countLine = (counted) => sentence({ text: facts(...counted.map(({ value, unit }) => phrase(value, unit))) });
const shippedHero = ({ hero, delta: compared = null, counts: counted, contributions = null, ever = null, days = [], calendar = false }, pointer) => list(
  metric(hero), compared ? delta(compared) : null, countLine(counted), calendar ? heatmap({ days }) : null, pointer === 'number' ? sentence({ text: facts(contributions, ever) }) : null);
const newMark = { text: 'new', tone: 'accent' };
const recordRow = ({ name, value, unit, detail, fresh }) => row({ name, detail: fresh ? newMark : null, meta: phrase(value, unit), second: detail });
const shipRow = (pointer) => ({ name, lines, commits }) => row({ name, meta: lines, hover: name === pointer, second: name === pointer ? commits : null });
const shipRepos = ({ count, rows, more = 0 }, { rest = [], expanded, pointer }) => list(heading('By repository', { meta: count }),
  [...rows, ...(expanded ? rest : [])].map(shipRow(pointer)), expanded ? quiet({ label: 'Show fewer' }) : moreRows(more));
const footFold = (open, fold, drawn) => list(historyFold(open, fold), open ? drawn() : null);
const shipFolds = ({ records = null, rhythm = null, computers = null, open = [] }) => list(
  records ? footFold(open.includes('records'), { name: 'Records', meta: records.count }, () => records.rows.map(recordRow)) : null,
  rhythm ? footFold(open.includes('rhythm'), { name: 'When you ship', meta: rhythm.note }, () => bars({ bars: rhythm.hours, peak: rhythm.peak, ticks: rhythm.ticks, filled: true })) : null,
  computers ? footFold(open.includes('computers'), { name: 'Computers', meta: computers.count }, () => computers.rows.map(({ name, lines, commits }) => row({ name, meta: facts(commits, lines) }))) : null);
const shippedBody = ({ best = null, repos = null, rest, expanded = false, pointer = null, phase = null, stopped = null, ...shown }) => list(
  shippedHero(shown, pointer), phase ? sentence({ text: phase }) : null, stopped ? failureBlock(stopped) : null,
  best ? recordRow({ ...best, detail: null }) : null, repos ? shipRepos(repos, { rest, expanded, pointer }) : null, shipFolds(shown));
const shippedPanel = ({ label, period, periods, past = false, gate = null, scope = null, stale = false, reading = false, empty = null, look = 'panel', ...body }) => panel({ look, stale, header: panelHeader({
  title: 'Shipped', second: scope ?? label, tools: [shareButton({ disabled: reading || Boolean(gate) }), panelRefresh({ reading: reading || stale || Boolean(body.phase) })],
}) }, gate ? emptyState(gate) : list(periodLine({ periods, period, past }), waiting({ reading }) ?? (empty ? emptyState(empty) : shippedBody(body))));
export const shipped = ({ share = null, card = null, notice: said = null, ...props }) => withBeside(shippedPanel(props),
  share ? shareMenu({ leaves: share }) : card ? shareCard(card) : said ? notice(said) : null);

const headerTools = { refresh: () => panelRefresh(), settings: () => settingsTool() };
const sharer = ({ title, tools = [], open }) => panel({ header: panelHeader({ title, tools: [shareButton({ active: open }), ...tools.map((key) => headerTools[key]())] }) });
export const sharing = ({ title, tools, leaves, open = false, making = null, notice: said = null, card = null }) => {
  const beside = list(open ? shareMenu({ leaves, making }) : null, said ? notice(said) : null, card ? shareCard(card) : null);
  return withBeside(sharer({ title, tools, open }), beside ? stack({ variant: 'column' }, beside) : null);
};

const shotStrip = (image, shots) => stack({ variant: 'line' }, shots.map((shot) => thumbnail({ image, ...shot })));
const shownPicture = ({ image, file, pins, shots, pointer }) => list(picture({ image, pins: pinMarks(pins) }), pointer ? pictureFile(file) : null, pointer ? shotStrip(image, shots) : null);
const imagesView = ({ held = null, loading = false, failure = null, wrong = null, ...shown }) => waiting({ failure })
  ?? (held || loading ? picture(held ? { state: 'held', action: held } : { state: 'loading' }) : list(shownPicture(shown), wrong ? sentence({ text: wrong, tone: 'blocked' }) : null));
const imagesNotes = ({ pins, send, agents }) => (pins.length || send.sent || send.refused ? list(pinPicker(agents), pinNotes({ pins, send })) : null);
export const images = ({ scope = null, kept = false, reading = false, stale = false, look = 'panel', empty = null, pins = [], send = {}, agents = null, ...shown }) => panel({ look, stale, header: panelHeader({
  title: 'Images', second: scope, tools: pinTools.picture({ kept, reading: reading || stale }),
}) }, empty ? emptyState(empty) : list(imagesView({ pins, ...shown }), imagesNotes({ pins, send, agents })));

// The panels' named states: each one a preset of its panel's props, the catalog draws its record from it.
import { containers, conversationFind, files, markdownWindow, memory, ports, settings, spend, preview, pulls, worktrees, pinPanel, shipped, sharing, simulator, images } from './panels.js';
import { phrase } from './kit.js';
import { keyLayer, sampleScreens, sampleShot } from './samples.js';
import { sampleContainers, sampleDisk, sampleMemory, sampleMemoryNotices, sampleAreas, sampleFiles, sampleFilesFailures, sampleFind, samplePlainTree, samplePortHistory, samplePorts, sampleTree, sampleCustomPanel, sampleFound, sampleHerdrKeys, sampleHidden, sampleKeyGroups, sampleMaintainers, sampleMarkdown, samplePlaces, sampleReleases, sampleSpend, sampleWorktrees, sampleWorktreeNotices, sampleShipped, sampleShippedCard, sampleShippedNotices, sampleShare, sampleTaken, samplePreview, samplePull, samplePullPages, samplePulls, samplePins, sampleSimulator, sampleImages } from './panel-samples.js';

// A notice's state: the panel at rest with the notice beside it.
const noticesOf = (notices, draw) => Object.fromEntries(Object.entries(notices).map(([name, said]) => [phrase('Notice:', name), [draw({ notice: said }), 'On screen a toast; away, the computer’s notification with the same words.']]));

// Settings: each page with its samples, then each state as what changes on it.
const shows = (extra) => ({ page: 'pieces', hidden: sampleHidden, areas: sampleAreas, ...extra });
const picked = (area, extra = {}) => shows({ view: 'area', area, ...extra });
const withPanel = { ...sampleAreas, Panels: { ...sampleAreas.Panels, pieces: [...sampleAreas.Panels.pieces, sampleCustomPanel] } };
const keys = (extra) => ({ page: 'keys', os: 'mac', layer: keyLayer('mac', 'alt cmd'), picked: 'h', groups: sampleKeyGroups, herdr: sampleHerdrKeys, practice: 'Vim keys', ...extra });
// An open group: its rows at rest, the first one in the given state.
const opened = (group, first = {}) => keys({ open: group, groups: { ...sampleKeyGroups, [group]: sampleKeyGroups[group].map((item, index) => (index ? item : { ...item, ...first })) } });
const news = (extra) => ({ page: 'news', newer: sampleReleases.newer, installed: sampleReleases.installed, older: sampleReleases.older, ...extra });
const credits = (extra) => ({ page: 'credits', places: samplePlaces, maintainers: sampleMaintainers, ...extra });

export const settingsViews = {
  'What you hid': [shows({}), 'Opens on what you hid, one press each to show again.'],
  'A hidden row under the pointer': [shows({ hover: 'Minimap' }), 'Where it lives, and Show.'],
  'Nothing hidden': [shows({ hidden: [] }), 'Nothing is hidden.'],
  ...Object.fromEntries(Object.keys(sampleAreas).map((area) => [`${area} picked`, [picked(area), `Browse the window: the ${area.toLowerCase()} area’s pieces, each with its switch.`]])),
  'From a piece’s right-click': [picked('Status bar', { selected: 'Memory low' }), 'Settings for this… lands on its area with its row washed.'],
  'Just switched': [picked('Status bar', { pending: 'Reviews waiting' }), 'On at once, with the breathing dot until it is written.'],
  Changed: [picked('Pane header', { changed: 'reset' }), 'A choice differs from its default: Reset all.'],
  'After Reset all': [picked('Pane header', { changed: 'undo' }), 'Reset all can be taken back until the page changes.'],
  'Panels in order': [picked('Panels', { areas: withPanel }), 'A panel another mod adds sits with the others; each moves up or down.'],
  'Find, matches': [shows({ view: 'find', query: sampleFound.query, found: sampleFound }), 'Matches across areas, each with where it lives.'],
  'Find, nothing': [shows({ view: 'find', query: 'zzz' }), 'Find matches no piece.'],
  Keys: [keys({}), 'The keyboard of one layer with the picked key, then kansō’s groups and Herdr’s.'],
  ...Object.fromEntries(Object.keys(sampleKeyGroups).map((group) => [group, [opened(group), `The ${group.toLowerCase()} group’s keys.`]])),
  'Key, capture': [opened('Vim keys', { state: 'capture' }), 'A click on a row waits for the new key.'],
  'Key, changed': [opened('Vim keys', { state: 'changed' }), 'A key differs from the one kansō ships: Reset.'],
  'Key, unbound': [opened('Vim keys', { state: 'unbound' }), 'A key was removed.'],
  'Key, taken': [opened('Vim keys', { state: 'taken', taken: sampleTaken }), 'The key already does something: a second press takes it.'],
  'Key, not saved': [opened('Vim keys', { state: 'failed', source: 'keys.json: EACCES: permission denied' }), 'keys.json refused the write.'],
  'Numbered keys, capture': [opened('Moving along the strip', { state: 'capture', chords: ['⌘N'] }), 'A numbered family waits for a key with a digit; N takes its place.'],
  'Numbered keys, no digit': [opened('Moving along the strip', { state: 'no digit', chords: ['⌘N'] }), 'The key had no digit; N takes the digit’s place.'],
  'A newer release': [news({}), 'Stable Mode, a newer release out: its node carries the one action.'],
  'Older releases open': [news({ unfolded: [sampleReleases.installed] }), 'Older opens in place.'],
  'Dawn Mode': [news({ channel: 'dawn', newer: sampleReleases.dawn }), 'Dawn Mode, on a newer build.'],
  'Back on Stable Mode': [news({ newer: null, stay: 'Your Dawn Mode build stays until Stable Mode passes it.' }), 'Back on Stable Mode from a beta.'],
  'Up to date': [news({ newer: null }), 'The installed release is the newest.'],
  Checking: [news({ newer: null, checking: true }), 'A check is running.'],
  'Checks off': [news({ auto: false }), 'Automatic checks are off.'],
  Updating: [news({ installing: true }), 'The update is installing.'],
  'First read': [news({ reading: true }), 'The changelog is being read.'],
  'GitHub not answering': [news({ read: '14:02' }), 'The last copy, with when it was read.'],
  'Nothing kept': [news({ failure: { text: 'Can’t read what’s new', source: 'GitHub not answering, and no copy was kept', fix: 'Refresh' } }), 'Nothing to show.'],
  Credits: [credits({}), 'Where kansō comes from, and who maintains it.'],
  'A place under the pointer': [credits({ hover: 'Herdr' }), 'What it is, and the open mark.'],
};

// Find in the conversation: the query typed, then what the read gives back.
const finding = (extra) => ({ agent: sampleFind.agent, query: sampleFind.query, count: '', ...extra });
const second = sampleFind.days[0][1][1];
export const findViews = {
  Empty: [finding({ query: null }), 'Opens on an empty field; the arrows wait for a match.'],
  'Reading the conversation': [finding({ reading: true }), 'The first read, and a read again after the file was cleared; the query stays.'],
  Matches: [finding({ count: '2 of 3', days: sampleFind.days, at: second }), 'Each day a heading, each hit who and when, then its line with the match marked; the current one washed.'],
  'One turn open': [finding({ count: '2 of 3', days: sampleFind.days, at: second, open: true, turn: sampleFind.turn }), 'A hit opens its whole turn in place; back returns to the hits.'],
  'No matches': [finding({ query: 'countdown hook' }), 'Nothing found: the empty state, the count left empty.'],
  'The conversation file is gone': [finding({ missing: sampleFind.missing }), 'The file cannot be read: its path, Refresh, and Explain to the agent.'],
};
// Files: Changed with what the agent named, All files as the tree, then each read that is not the list.
const { named, unchanged, also, shell, remote, computer } = sampleFiles;
const changes = (extra) => ({ view: 'changed', files: { named, unchanged, also }, ...extra });
const tree = (extra) => ({ view: 'all', tree: sampleTree, ...extra });
export const filesViews = {
  'Changed, opened from the digest': [changes({}), 'What the agent named first, newest first; the named files that did not change on one dim line; then the rest.'],
  'All files, with marks': [tree({ picked: 'limits.ts' }), 'The tree: git’s letter in the icon’s place, a folder’s count of changed files; a folder at its limit says how many more.'],
  'Right-click a row': [changes({ files: { named, unchanged: ['plans.ts'] }, picked: 'checkout.ts', menu: sampleFiles.menu.path }), 'Open the diff, Open, Open with…, Copy path, and the piece’s own lines.'],
  'A shell pane: nothing named': [changes({ files: { also: shell } }), 'No conversation names files: the changed ones alone.'],
  'Nothing changed': [changes({ empty: { icon: 'lu-file', text: 'No uncommitted changes' } }), 'Changed with nothing to show.'],
  'Not a repository: the tree only': [{ repository: false, tree: samplePlainTree }, 'Outside git there is only the tree; a folder it cannot list says so in its place.'],
  'An empty folder': [tree({ tree: [], empty: { icon: 'lu-folder', text: 'No files' } }), 'The folder holds nothing.'],
  'First read': [{ reading: true, repository: false }, 'The skeleton, once; later reads keep the rows and spin Refresh.'],
  'The folder can’t be read': [changes({ failure: sampleFilesFailures.folder }), 'The folder’s own words, Refresh, and Explain to the agent.'],
  'No folder for this pane': [{ repository: false, empty: { icon: 'lu-folder', text: 'This pane has no folder' } }, 'The pane in front has no folder.'],
  'On another computer': [changes({ files: remote, scope: computer }), 'The computer’s name is the only scope line.'],
  'Stale: devbox stopped answering': [changes({ files: remote, scope: 'Read 14:02 · devbox unreachable · next try 14:03', stale: true }), 'The last read stays, stepped down, with when it was read and the next try.'],
  'Unreachable before the first read': [{ repository: false, scope: computer, failure: sampleFilesFailures.unreachable }, 'Nothing read yet: the computer’s words and Refresh.'],
  'Narrow, 300': [changes({ look: 'narrow', files: { named, unchanged: ['rate-limit-buckets.ts'], also } }), 'The title steps down; the folder truncates before the name.'],
};
// Ports: the four servers at rest, History folded; each state is what the pointer, a stop or a read changes.
const { noPane, inPanes } = samplePorts;
const served = (extra) => ({ servers: { noPane, inPanes }, history: { open: false }, ...extra });
const pastOpen = (extra = {}) => ({ open: true, ...samplePortHistory, ...extra });
export const portsViews = {
  'At rest: two with no pane, two in panes': [served({}), 'One line each: port, what runs it, size. No pane first; the rows after it name their pane.'],
  'Pointer on :6006': [served({ picked: ':6006' }), 'Command, folder and age, then Stop as the one primary and Open in the browser.'],
  'A pane’s server picked': [served({ picked: ':4000' }), 'Go to its pane first, then Open in the browser and Stop, all quiet.'],
  'Stop armed': [served({ picked: ':6006', armed: true }), 'Stop asks again for 4 s.'],
  Stopping: [served({ picked: ':6006', stopping: true }), 'The signal is sent; the row waits for the port to close.'],
  'A stop refused, on its row': [served({ picked: ':6006', refused: samplePorts.refused }), 'The kill’s own words, Force stop, and Explain to the agent.'],
  'Stop every one with no pane': [served({ heading: { hover: true } }), 'On the No pane heading, Stop 2; the ones in a pane stay.'],
  'Stop every one, armed': [served({ heading: { hover: true, armed: true } }), 'It asks again before it stops them.'],
  'History open': [served({ history: pastOpen() }), 'Its range, servers at once with the share with no pane, what stopped, then what opened and ended.'],
  'Share from the header': [served({ history: pastOpen(), share: true }), 'Counts and sizes only leave.'],
  'History off': [served({ history: pastOpen({ guard: samplePortHistory.said.off, bars: null }) }), 'Nothing collects history: the guard turns it on; the list stays.'],
  'History unreadable': [served({ history: pastOpen({ guard: samplePortHistory.said.bad, bars: null }) }), 'The history file is not readable; nothing is drawn from it.'],
  'History stopped': [served({ history: pastOpen({ guard: samplePortHistory.said.stale }) }), 'The collector stopped: the last chart stays, with when.'],
  'Some servers cannot be attributed': [served({ unattributed: samplePorts.unattributed }), 'Their folders cannot be read; they are listed and can be stopped.'],
  'On another computer': [served({ servers: samplePorts.remote, scope: samplePorts.computer, picked: ':8000' }), 'The focused project’s computer is read; its name is the scope.'],
  'Another computer, unreachable': [served({ servers: samplePorts.remote, scope: 'Read 14:02 · devbox unreachable · next try 14:07', stale: true, picked: ':8000' }), 'The last read stays, stepped down; Stop waits for the computer.'],
  'First read': [served({ reading: true, history: null }), 'The skeleton, once.'],
  Empty: [served({ servers: {} }), 'Nothing listens; History stays.'],
  'A read failed': [served({ failure: samplePorts.failure }), 'lsof’s own words, Refresh, and Explain to the agent.'],
  'Narrow, 300': [served({ look: 'narrow', picked: ':6006' }), 'The command folds away; Open in the browser becomes Open.'],
};
// Markdown: plan.md as cart-ui wrote it; each state is what the pointer, an edit, a review or a read changes.
const openFile = ({ file, folder, source }, { doc = {}, ...extra } = {}) => ({ file, folder, ...extra, doc: { source, ...doc } });
const plan = (extra) => openFile(sampleMarkdown.plan, extra);
const waits = phrase(sampleMarkdown.agent, 'waits for your review');
const listing = (extra) => ({ folder: '~/acme-shop', ...extra });
const [waiting, , folder] = sampleMarkdown.groups;
export const markdownViews = {
  'A document': [plan({}), 'The file formatted, its folder under the name; at rest only Close.'],
  'Pointer over the header and a block': [plan({ tools: ['source', 'refresh'], doc: { block: 3, state: 'hover' } }), 'Source and Refresh come with the pointer; the block under it is washed.'],
  Source: [plan({ tools: ['source', 'refresh'], doc: { view: 'source' } }), 'The whole file as text, edited and saved the same way; Formatted goes back.'],
  'Editing a block': [plan({ said: ['Saving…'], doc: { block: 2, state: 'editing' } }), 'A double-click edits that block alone; what you type saves as you go.'],
  'Editing a table': [openFile(sampleMarkdown.limits, { said: ['Edited'], doc: { block: 2, state: 'editing', cell: [1, 2] } }), 'A table opens as its cells, with Add row, Add column and Done under it.'],
  'Changed on disk while edited': [plan({ said: ['Edited'], band: { text: 'Changed on disk at 14:06', actions: [{ label: 'Overwrite' }, { label: 'Reload', kind: 'quiet' }] } }), 'Nothing is written until you choose: yours over it, or the file’s.'],
  'After Overwrite': [plan({ band: { text: 'Saved over the 14:06 text', actions: [{ label: 'Undo', kind: 'quiet' }] } }), 'Undo, on that line, until the next change.'],
  "Couldn’t save": [plan({ said: [waits, 'Edited'], tools: ['done'], refused: sampleMarkdown.failures.save }), 'The write was refused: its words, Save again, and Explain to the agent.'],
  'Review: an agent waits': [plan({ said: [waits, 'Edited'], tools: ['done'] }), 'md-review waits on this file: Done is the one primary, and tells the agent.'],
  'Another review waits': [plan({ said: [waits], tools: ['done'], also: 'release.md also waits for your review' }), 'Done shows the next review waiting, or closes.'],
  'Done could not tell the agent': [plan({ said: [waits], refused: sampleMarkdown.failures.told }), 'Done stays; a second press tries again.'],
  'No file: the list': [listing({ groups: sampleMarkdown.groups }), 'Reviews waiting first, then what this terminal mentioned, then the folder’s own.'],
  'The folder only': [listing({ groups: [folder] }), 'Nothing waits and the terminal named nothing: the folder’s files, no headings.'],
  'Keyboard on a row': [listing({ groups: [waiting, folder], picked: 'CHANGELOG.md' }), 'j and k move, Enter opens.'],
  Looking: [listing({ reading: true }), 'The skeleton while it looks.'],
  Empty: [{ folder: '~/infra', empty: 'No Markdown in ~/infra' }, 'The folder holds no Markdown.'],
  'On another computer': [listing({ folder: 'devbox: ~/acme-shop', groups: [folder] }), 'The list and the file come from that computer, read again every 3 s.'],
  'Another computer, not answering': [openFile(sampleMarkdown.runbook, { said: ['Read 14:02', 'devbox not answering'], stale: true }), 'The last read stays, stepped down, with when it was read.'],
  'Too large to edit': [openFile(sampleMarkdown.events, { said: ['612 KB, read only'], tools: ['refresh'] }), 'Past 400,000 characters it reads only.'],
};
// Containers: Docker's cost, acme-shop and docs-site, buildkit in no project; each state is what the pointer, an armed press or a read changes.
const { cost, projects, loose, details: said } = sampleContainers;
const docked = (extra) => ({ cost, projects, loose, ...extra });
const diskOpen = (extra = {}) => docked({ disk: { ...sampleDisk, ...extra } });
const running = (extra) => docked({ picked: 'mailpit', said, ...extra });
const { remote: elsewhere } = sampleContainers;
export const containersViews = {
  'At rest: one exited, two running, one project not started': [docked({}), 'Docker’s cost on one line; each project with its count; a running row has no dot, a failed one says how it ended.'],
  'Pointer on acme-shop': [docked({ hover: 'acme-shop' }), 'compose.yaml takes the count’s place; Up again, Rebuild and Down come under the name, and Stop all when more than one runs.'],
  'Pointer on the cost': [docked({ cost: { ...cost, hover: true } }), 'Can grow to, and Quit Docker with what it stops.'],
  'A running container picked': [running({}), 'Image, port and age, then Open, Logs, Shell, Restart, Stop and Details.'],
  'Details open': [running({ details: true }), 'Details fold inside the row.'],
  'No details from Docker': [running({ details: true, said: [] }), 'Docker gave nothing to fold open.'],
  'An exited container picked': [docked({ picked: 'api-db' }), 'Logs first, then Start, Details and Remove.'],
  'Working on a container': [running({ pending: true }), 'The breathing dot until Docker answers; its words wait.'],
  'Down armed': [docked({ down: 'acme-shop' }), 'Down asks again before it takes the project down.'],
  'Quit armed': [docked({ cost: { ...cost, hover: true, armed: true } }), 'Quit asks again, and says how many it stops.'],
  'A removal refused, on its row': [docked({ picked: 'api-db', refused: sampleContainers.refused }), 'Docker’s own words, Remove again, and Explain to the agent.'],
  'Not in a project, Remove armed': [docked({ picked: 'buildkit', armed: true }), 'A container no compose file names sits under its own dim heading.'],
  'Empty, with a stack a project can bring up': [docked({ projects: projects.slice(1), loose: [] }), 'Nothing runs; a project’s compose file offers Up.'],
  'No containers': [docked({ projects: [], loose: [] }), 'Nothing runs and no compose file is found; Pull is in Disk.'],
  'Disk open': [diskOpen(), 'The pull field, then images, volumes and the build cache, each with what it gives back.'],
  'Run an image': [diskOpen({ picked: sampleDisk.run.image, run: sampleDisk.run }), 'Run… opens the name and the port under the image.'],
  'Run, a name refused': [diskOpen({ picked: sampleDisk.run.image, run: { ...sampleDisk.run, ...sampleDisk.invalid.name } }), 'The field is marked and the rule says why.'],
  'Run, a port refused': [diskOpen({ picked: sampleDisk.run.image, run: { ...sampleDisk.run, ...sampleDisk.invalid.port } }), 'The field is marked and the rule says why.'],
  'Remove an unused image, armed': [diskOpen({ picked: 'node:20-bookworm', armed: 'image' }), 'It asks again before it removes the image.'],
  'Remove unused volumes, armed': [diskOpen({ armed: 'volumes' }), 'It says their data goes for good, and asks again.'],
  'Docker not running': [{ docker: 'down' }, 'The empty state and Open Docker.'],
  'Docker could not be opened': [{ docker: 'down', unopened: sampleContainers.unopened }, 'Open Docker failed: its words, and Open Docker again.'],
  'Starting Docker': [{ docker: 'starting' }, 'Open Docker was pressed; the skeleton until it answers.'],
  'First read': [{ reading: true }, 'The skeleton, once; later reads keep the rows and spin Refresh.'],
  'A read failed': [{ failure: sampleContainers.failure }, 'Docker’s own words, Refresh, and Explain to the agent.'],
  'Docker on another machine (a context)': [{ loose: sampleContainers.context.loose, scope: sampleContainers.context.name, context: true, picked: 'pg-primary' }, 'The context’s name is the scope; its containers are not this computer’s, so there is no cost and no Open.'],
  'On another computer': [{ ...elsewhere, scope: elsewhere.computer }, 'The focused project’s computer reads its own docker; its name is the scope.'],
  'Another computer, unreachable': [{ ...elsewhere, scope: 'Read 14:02 · devbox unreachable · next try 14:07', stale: true }, 'The last read stays, stepped down, with when it was read and the next try.'],
  'Memory not attributed': [docked({ unattributed: sampleContainers.unattributed }), 'On Windows the VM’s memory cannot be read yet: it says so.'],
  'Narrow, 300': [running({ look: 'narrow' }), 'The image hides; the words wrap.'],
};
// Memory: 31% free, Herdr, two hung helpers, five sessions; each state is what the pointer, a recycle, the guard or a read changes.
const { free, herdr, helpers, sessions, guard: rules, bulk, batch } = sampleMemory;
const held = (extra) => ({ free, herdr, helpers, sessions, rules, ...extra });
const docs = (extra) => held({ picked: 'docs', ...extra });
const low = { ...free, value: '8%', low: true };
const recalled = (extra = {}) => held({ history: { open: true, ...sampleMemory.history, ...extra } });
export const memoryViews = {
  'At rest: guard on, one session past the limit, one needing you': [held({}), 'Free memory on one line; Herdr, the hung helpers and each session a line; Guard on and History fold at the foot.'],
  'Pointer on the number': [held({ free: { ...free, hover: true }, bulk }), 'Swap joins the number; Recycle every idle one, Only the heavy ones and Close the unused come under it.'],
  'Pointer on docs': [docs({}), 'Its program, idle and up times, why it is past the limit; Recycle and Close.'],
  'A working session picked': [held({ picked: 'checkout' }), 'A working session cannot be recycled; it says working and offers nothing.'],
  'A session that cannot be recycled': [held({ picked: 'perf', unrecyclable: sampleMemory.unrecyclable }), 'Why it cannot be recycled, and Close.'],
  'Close armed': [held({ picked: 'perf', armed: 'session' }), 'Close asks again.'],
  'Its memory over time': [docs({ spark: sampleMemory.spark }), 'The picked session’s memory as a small chart.'],
  'More sessions than fit': [held({ more: sampleMemory.more }), 'The first five, then Show 3 more.'],
  'No sessions': [held({ sessions: [] }), 'One quiet line.'],
  'Low: the window past its limit': [held({ free: low, bulk, herdr: { ...herdr, over: true } }), 'The number in blocked ink, Recycle every idle one as the primary, Herdr’s size in blocked ink.'],
  'Herdr picked, past its limit': [held({ free: low, herdr: { ...herdr, over: true }, picked: 'Herdr' }), 'Window and core apart, its limit, and Restart window as the primary.'],
  'Only the session you are on is idle': [held({ bulk: { only: 'Only the agent you are on is idle; it is never recycled in bulk.' } }), 'Nothing to recycle in bulk; it says why.'],
  'Close the unused, armed': [held({ free: { ...free, hover: true }, bulk, armed: 'unused' }), 'It asks again.'],
  'End hung helpers, armed': [held({ armed: 'helpers' }), 'It asks again.'],
  'Ending the helpers refused': [held({ reap: sampleMemory.reap }), 'The system’s words under the row, End again, and Explain to the agent.'],
  'Recycling three: two done, one pending': [held({ batch: { ...batch, said: 'Recycling 3 of 3 · docs' } }), 'Each done one says before and after; the one in flight breathes.'],
  'Recycled, one refused on its row': [docs({ batch: { done: batch.done, said: batch.said, finished: true }, refused: sampleMemory.refused }), 'What came back, Dismiss, and the refusal under its row.'],
  'Guard open': [held({ foot: { open: true } }), 'Each rule with its limit and a switch.'],
  'History open': [recalled(), 'Free memory over time with its lowest, what the guard did, then Events and Heaviest.'],
  'History, nothing recorded yet': [recalled({ bars: [], most: 'nothing recorded yet', summary: [], lists: [] }), 'Right after the guard is turned on: the ranges and one quiet line.'],
  'Share from the header': [held({ share: true }), 'The Share menu says what leaves.'],
  'Guard paused': [held({ guard: 'paused', free: { ...free, paused: true } }), 'The number says paused; so does the guard’s fold.'],
  'Guard stopped answering': [held({ stale: sampleMemory.stale, silent: sampleMemory.silent }), 'The last read stays, stepped down, with Turn on the guard.'],
  'Guard off': [{ guard: 'off' }, 'The empty state and Turn on.'],
  'Turning on': [{ guard: 'turning' }, 'The skeleton under one dim line.'],
  'Turn on refused': [{ guard: 'refused', install: sampleMemory.install }, 'The installer’s words, Turn on, and Explain to the agent.'],
  'Unreadable': [{ failure: sampleMemory.unreadable }, 'What the guard wrote could not be read: its words and Turn on.'],
  'First read': [{ reading: true }, 'The skeleton, once.'],
  'Windows: the working set': [held({ title: 'Memory · working set' }), 'On Windows the guard reads the working set; the title says so.'],
  'On another computer': [{ ...sampleMemory.remote, rules, scope: sampleMemory.remote.computer }, 'The focused project’s computer, read by its own guard.'],
  'Narrow, 300': [docs({ look: 'narrow' }), 'The words wrap.'],
  ...noticesOf(sampleMemoryNotices, held),
};
// Spend: November, two plans, $41.20 today over three projects; each state is what the pointer, a period, a row or a read changes.
const { month, plans, periods, today, lists, choices, history: chart } = sampleSpend;
const home = (extra) => ({ second: month, plans, number: today, periods, period: 'day', choices, lists, ...extra });
const daysOpen = (extra = {}) => ({ history: { open: true, ...chart, ...extra } });
const openedFrom = (kind, extra = {}) => {
  const { name, value, said, ...rest } = sampleSpend[kind];
  const named = { models: 'Models', projects: 'Projects' };
  return { page: 'detail', title: name, periods, period: 'day', value, said, lists: [...Object.entries(rest).map(([key, rows]) => ({ name: named[key], count: phrase(rows.length), rows })), { name: 'Tasks', count: phrase(lists.tasks.length), rows: lists.tasks }], ...extra };
};
const { sources, absent, owned, prices, updates } = sampleSpend;
const settled = (extra) => ({ page: 'settings', title: 'Settings', second: 'Spend', sources, absent, owned, prices, updates, ...extra });
const { corrected, invalid } = sampleSpend;
export const spendViews = {
  'At rest: the month per plan, then today': [home({}), 'Each plan’s multiple for the month, then today’s number, then where it went.'],
  'Pointer on today': [home({ pointer: 'period' }), 'The switch takes the word’s place, with the arrows and the project and model pickers.'],
  'A past period': [home({ pointer: 'period', period: 'month', past: true, number: sampleSpend.past }), 'October: the next arrow and Back to now return to this month.'],
  'Pointer on the number': [home({ pointer: 'number' }), 'Its tasks, what a task costs and its tokens.'],
  'Pointer on a project': [home({ pointer: 'list', picked: 'acme-shop' }), 'Projects, Models and Tasks switch the list; the picked row says its tokens and folder.'],
  Models: [home({ pointer: 'list', view: 'models', picked: 'claude-opus-5' }), 'Each model’s cost; the picked one says its list price.'],
  Tasks: [home({ pointer: 'list', view: 'tasks' }), 'Sessions that name the same ticket are one task.'],
  'More than fit': [home({ more: sampleSpend.more }), 'The first ones, then Show 4 more.'],
  'Choosing a project': [{ ...home({ pointer: 'period' }), choosing: sampleSpend.chooser }, 'Each project with its folder and cost.'],
  'Showing one project': [home({ showing: sampleSpend.showing }), 'A project or a model chosen: one dim line says so, with Show everything.'],
  'Active now': [home({ live: sampleSpend.live }), 'Sessions running now come first, breathing; each opens its task.'],
  'History open': [home(daysOpen()), 'The period a bar a day, the peak with its value.'],
  'History, nothing that period': [home(daysOpen({ bars: chart.bars.map(() => 0), peak: null, labels: [] })), 'Every day empty.'],
  'A project opened from its row': [openedFrom('project'), 'Its period, its number and facts, then its models and tasks.'],
  'A project’s History': [openedFrom('project', daysOpen()), 'The project’s days.'],
  'A model opened from its row': [openedFrom('model'), 'Its period, its number and facts, then its projects and tasks.'],
  'A task opened from its row': [{ page: 'task', title: 'Task', ...sampleSpend.task, project: 'acme-shop' }, 'The prompt, its cost and parts, then its models and sessions, and Open acme-shop.'],
  'Under 1×: not paying for itself': [home({ plans: [plans[0], sampleSpend.under] }), 'The multiple and its sentence in working.'],
  'Too early to say: the pace instead': [home({ second: 'November 2', plans: [sampleSpend.early] }), 'Before the 7th, the pace in dim.'],
  'No plan: plain cost': [home({ plans: [], plain: sampleSpend.plain, number: null, lists: null }), 'API keys are paid as used; each program’s cost.'],
  'Several computers, summed': [home({ plans: plans.slice(0, 1), computers: sampleSpend.computers }), 'Each computer prices its own sessions; one account counts once.'],
  'A computer not answering': [home({ plans: plans.slice(0, 1), computers: { count: '3 computers', rows: [...sampleSpend.computers.rows, sampleSpend.away] } }), 'It says so, with when it was read.'],
  'A plan not read, on its row': [home({ plans: plans.slice(0, 1), unread: sampleSpend.unread }), 'The file’s own words under its row.'],
  'Still reading the history': [home({ partial: sampleSpend.partial }), 'What is read so far, and how far it is.'],
  'First read': [{ reading: true, second: sampleSpend.reading }, 'The skeleton, with how many sessions are read.'],
  Empty: [{ second: month, empty: { icon: 'lu-chart-column', text: 'No sessions in November' } }, 'Nothing used in the period.'],
  'A read failed, nothing kept': [{ failure: sampleSpend.failure }, 'The collector’s words, Refresh, and Explain to the agent.'],
  'A refresh failed: the last read stays': [home({ refresh: sampleSpend.refresh }), 'The last numbers stay under the failure.'],
  'Spend can’t run': [{ failure: sampleSpend.runtime }, 'No Node to run the collector: its words, and Explain to the agent.'],
  'Share from the header': [home({ share: true }), 'Totals and days only leave.'],
  'Settings: sources and plans, detected': [settled({}), 'A source is on when its folder holds sessions; plans are found, never typed; then prices and updates.'],
  'Sources loading': [settled({ sources: null }), 'The skeleton under Sources.'],
  'A source just switched': [settled({ sources: sources.map((item, index) => (index === 2 ? { ...item, on: true, pending: true } : item)) }), 'On at once, with the breathing dot until every number is read again.'],
  'A plan corrected in place': [settled({ edit: corrected }), 'A plan without a price takes yours; Enter keeps it.'],
  'Saving a plan': [settled({ edit: { ...corrected, pending: true } }), 'The breathing dot until prices.json is written.'],
  'A plan added': [settled({ added: {} }), 'Add plan opens its name and price.'],
  'A price refused': [settled({ added: { name: 'ChatGPT Pro', cost: invalid.price, error: true }, refused: invalid.rule }), 'The field is marked and the rule says why.'],
  'Plans not saved': [settled({ edit: corrected, unsaved: sampleSpend.unsaved }), 'prices.json refused the write: its words, Save again, and Explain to the agent.'],
  'Narrow, 300': [home({ look: 'narrow' }), 'The plans and the number stay; the rows truncate.'],
};

// Worktrees: 2.4 GB in 9 worktrees; each state is what a scan, a pick, an armed verb or the history changes.
const { verdicts: treeVerdicts, freed: freedDays, held: heldDays } = sampleWorktrees;
const atRest = (extra) => ({ total: sampleWorktrees.total, plan: sampleWorktrees.plan, space: sampleWorktrees.space, repos: sampleWorktrees.repos, left: sampleWorktrees.left, freed: { fold: freedDays.fold }, ...extra });
// One verdict picked, first in acme-shop; a folder left behind is picked where it is.
const [acme, ...otherRepos] = sampleWorktrees.repos;
const leading = (item) => ({ repos: [{ ...acme, rows: [item, ...acme.rows.filter(({ name }) => name !== item.name).slice(0, 3)] }, ...otherRepos] });
const picking = (key, extra = {}) => atRest({ ...(key === 'orphan' ? {} : leading(treeVerdicts[key])), picked: treeVerdicts[key].name, ...extra });
const freedOpen = (extra = {}) => atRest({ freed: { open: true, ...freedDays, ...extra } });
const heldOpen = { range: 'held', ...heldDays };
export const worktreesViews = {
  'At rest: 2.4 GB in 9 worktrees': [atRest({}), 'The number with Clean up and Explain; each repository a heading with its size; a row’s fact only when something is wrong; Left behind; Freed at the foot.'],
  'Pointer on the number': [atRest({ pointer: true }), 'When it was scanned and where the space is: what can go, what needs a look, what is in use, what was left behind.'],
  'A row picked, Remove armed': [picking('changes', { armed: 'row' }), 'Its facts, what removing it loses, its folder, its verbs; Remove asks again.'],
  'In a tab: go to it instead': [picking('open'), 'Open in Herdr: Go to its tab, and Explain to the agent there; no Remove.'],
  'Its repository moved: repair': [picking('broken'), 'git can’t read it: Repair the link first.'],
  'Repairing the link': [picking('broken', { busy: treeVerdicts.broken.name }), 'The verb says so and waits.'],
  'The repair refused': [picking('broken', { refused: sampleWorktrees.repair }), 'git’s words under the row, Repair the link again, and Explain.'],
  'Merged: its branch goes too': [picking('merged'), 'Nothing is lost; the merged branch goes with it.'],
  'Not merged: its branch stays': [picking('unmerged'), 'Nothing is lost; the branch keeps its commits.'],
  'Detached: its commits are on branches': [picking('detached'), 'Nothing is lost.'],
  'Commits only here': [picking('lost'), 'At rest its fact in blocked ink; picked, what is lost.'],
  'Locked': [picking('locked'), 'Locked by git: how to unlock it; no Remove.'],
  'In use today': [picking('recent'), 'At rest its fact in working ink; Clean up and Remove all leave it alone.'],
  'Still checking': [picking('checking'), 'As the last scan saw it; Remove waits for the check.'],
  'Folder gone: only the record': [picking('missing'), 'Only git’s record goes.'],
  'Folder reused: only the record': [picking('replaced'), 'Its folder stays as it is; only the record goes.'],
  'Left behind: its repository moved': [picking('orphan'), 'Git cannot say what it holds: deleting it loses whatever is there.'],
  'Removing one': [atRest({ busy: 'old-cart' }), 'The row breathes and says so.'],
  'A removal refused': [picking('unmerged', { refused: sampleWorktrees.refused }), 'git’s words under the row, Remove again, and Explain.'],
  'Changed since you looked: it stays': [atRest({ stayed: sampleWorktrees.stayed }), 'Checked again right before it goes; one quiet line says why it stayed.'],
  'Clean up armed': [atRest({ armed: 'all' }), 'It asks again and names what goes.'],
  'Cleaning up: 2 of 3': [atRest({ phase: sampleWorktrees.phases.cleaning, cleaning: true }), 'The header says how far; Clean up waits.'],
  'Some not removed': [atRest({ note: sampleWorktrees.several }), 'How many stayed and the first one’s words.'],
  'Remove all in a group, armed': [atRest({ armed: acme.name }), 'It asks again and says what is lost.'],
  'Nothing lost: the line says so': [atRest({ repos: [sampleWorktrees.relay], armed: sampleWorktrees.relay.name }), 'The same line, saying nothing is lost.'],
  'More than eight repositories': [atRest({ many: sampleWorktrees.many, hidden: sampleWorktrees.hidden }), 'The eight that take the most, then Show 3 more repositories.'],
  'First scan': [{ phase: sampleWorktrees.phases.first, reading: true }, 'The skeleton, with how far the scan is.'],
  'Checking again, the last scan kept': [atRest({ phase: sampleWorktrees.phases.checking, ready: false }), 'What the last scan kept shows at once; Clean up waits for the check.'],
  None: [{}, 'No worktrees besides your checkouts.'],
  'The scan failed': [{ failure: sampleWorktrees.failure }, 'git’s words, Refresh, and Explain.'],
  'On another computer, then unreachable': [{ ...sampleWorktrees.remote, review: false, stale: true }, 'The last read stays, stepped down, with when it tries again.'],
  'Narrow, 300': [atRest({ look: 'narrow' }), 'The unit shortens; the rows stay.'],
  'Freed, open': [freedOpen(), 'A bar a day with the best one, then what was removed, deleted and cleared, and what went outside the panel.'],
  'On disk each day': [freedOpen(heldOpen), 'What the worktrees held each day a scan ran.'],
  'Nothing freed yet': [freedOpen({ ...heldOpen, ...sampleWorktrees.never }), 'What they hold each day, and one quiet line.'],
  'History loading': [freedOpen({ reading: true }), 'The list stays; only the history waits.'],
  'History can’t be read': [freedOpen({ failure: sampleWorktrees.unread }), 'The store’s words under the fold; the list stays.'],
  'No sqlite3': [freedOpen({ failure: sampleWorktrees.noSqlite }), 'What to install; the list stays.'],
  'Share from the header': [atRest({ share: true }), 'Totals only leave.'],
  'New worktree from here': [atRest({ creating: sampleWorktrees.creating }), 'The New worktree dialog, on the repository picked.'],
  ...noticesOf(sampleWorktreeNotices, atRest),
};
// Shipped: this week; each state is what a period, the pointer, a fold or a read changes.
const { periods: shipPeriods, week: thisWeek, records: shipRecords, rhythm: shipRhythm, computers: shipComputers } = sampleShipped;
const shipping = (extra) => ({ periods: shipPeriods, ...thisWeek, records: shipRecords, rhythm: shipRhythm, computers: shipComputers, ...extra });
const shipFirst = { periods: shipPeriods, period: thisWeek.period, label: thisWeek.label };
export const shippedViews = {
  'At rest: this week, +12,480 lines': [shipping({}), 'The number with what was taken away, how it compares and what it counts; a new best; each repository; Records, When you ship and Computers folded.'],
  'Pointer on the number': [shipping({ pointer: 'number' }), 'The contributions and what you shipped since joining GitHub.'],
  'Pointer on a repository': [shipping({ pointer: 'acme-shop' }), 'Its commits under it.'],
  'Every repository': [shipping({ expanded: true }), 'Show fewer folds them back to three.'],
  'A day: contributions': [shipping({ ...sampleShipped.day, best: null }), 'A day leads with contributions; its repositories are its week’s.'],
  'A past period': [shipping({ ...sampleShipped.past, best: null }), 'Both arrows and Back to now; the totals are that period’s.'],
  'The streak, clicked': [shipping({ calendar: true }), 'A year of days under the count line, each one’s contributions with the pointer.'],
  'Records, open': [shipping({ open: ['records'] }), 'Each best with when it was set, the new one marked; the longest streak is one.'],
  'When you ship and Computers, open': [shipping({ open: ['rhythm', 'computers'] }), 'A bar an hour, the busiest marked; each computer’s commits and lines.'],
  'No records yet': [shipping({ best: null, records: null }), 'No Records fold until there is a best.'],
  'First read': [{ ...shipFirst, reading: true }, 'The skeleton under the period; Share waits.'],
  'Still adding up': [{ ...shipFirst, ...sampleShipped.addingUp, phase: sampleShipped.phases.first }, 'The lines so far and how far the first read is; no comparison and no records until every repository is in.'],
  'Updating': [shipping({ phase: sampleShipped.phases.again }), 'The last totals stay; one quiet line says what is read.'],
  'Adding up stopped': [shipping({ stopped: sampleShipped.stopped }), 'GitHub’s words under the number; the last totals stay.'],
  'No sqlite3': [shipping({ stopped: sampleShipped.noSqlite, best: null, repos: null, records: null, rhythm: null, computers: null }), 'What to install; GitHub’s own counts stay.'],
  'Nothing in this period': [{ ...shipFirst, ...sampleShipped.empty }, 'One quiet line; the period stays switchable.'],
  'Not signed in to GitHub': [{ ...shipFirst, gate: sampleShipped.signedOut }, 'Sign in, in place of the panel.'],
  'GitHub CLI not installed': [{ ...shipFirst, gate: sampleShipped.noCli }, 'Where to get it, in place of the panel.'],
  'GitHub not answering': [shipping({ stale: true, scope: sampleShipped.offline }), 'The last read stays, stepped down, with when it tries again.'],
  'Narrow, 300': [shipping({ look: 'narrow' }), 'The number and the rows stay; the facts wrap.'],
  'Share: what leaves, then where': [shipping({ share: sampleShipped.leaves }), 'Totals only, no names.'],
  'The card it makes': [shipping({ card: sampleShippedCard }), 'Totals, the streak, the records and the hours; never a repository or a computer. 1200 wide, shown at half.'],
  ...noticesOf(sampleShippedNotices, shipping),
};
// Share: Memory, Spend and the dōjō; each state is what opening, a row, the image or its result changes.
const { panels: sharers, network } = sampleShare;
const menuOpen = (key, extra = {}) => ({ ...sharers[key], open: true, ...extra });
const cardOf = (name) => [{ title: sampleShare.cards[name].title, card: sampleShare.cards[name] }, 'Shown at half of its 1200 width; light or dark as the theme.'];
export const shareViews = {
  'Closed: the icon in the header': [sharers.memory, 'Share shows only when there is something to share.'],
  'Open: what leaves, then where': [menuOpen('memory'), 'The menu’s first line says what leaves; Post to X, LinkedIn or Bluesky, then Save image.'],
  'Spend: totals and days only': [menuOpen('spend'), 'The same menu; its first line is Spend’s.'],
  'The dōjō: after a round': [menuOpen('dojo'), 'Scores and practice days only.'],
  'Making the image': [menuOpen('spend', { making: network }), 'The row says so; the others wait until the image is made.'],
  'The image could not be made': [menuOpen('memory', { notice: sampleShare.failed }), 'The menu stays; the notice says what to install, and a row tries again.'],
  ...noticesOf(sampleShare.notices, (extra) => ({ ...sharers.memory, ...extra })),
  'Card: Shipped': cardOf('Shipped'),
  'Card: Spend': cardOf('Spend'),
  'Card: Memory': cardOf('Memory'),
  'Card: Ports': cardOf('Ports'),
  'Card: the dōjō': cardOf('Dōjō'),
};
// Preview: limits.ts as Files opens it, then limits.md; each state is what an edit, a save or a read changes.
const { code, edit, markdown: note, log, binary, gone, shot, pictured, huge, pins } = samplePreview;
// The pins once their notes are typed.
const placedPins = pins.map(({ writing, ...placed }) => placed);
const shownShot = (state, extra = {}) => ({ file: shot.file, folder: shot.folder, tools: ['open with'], shot: { image: sampleShot, state, action: `Load ${shot.size}` }, ...extra });
const away = (folder) => `devbox · ${folder}`;
const notePicture = (state) => shownNote({ folder: away(note.folder), doc: { source: pictured, shot: { image: sampleShot, state, size: shot.size } } });
const shownCode = (extra) => ({ ...code, tools: ['open with'], ...extra });
const editedText = { ...code.text, text: code.text.text.replace(edit.from, edit.to), line: edit.line };
const edited = (extra) => shownCode({ text: editedText, ...extra });
const shownNote = ({ doc = {}, ...extra } = {}) => ({ file: note.file, folder: note.folder, tools: ['source', 'open with'], ...extra, doc: { source: note.source, ...doc } });
const overDisk = { text: 'Changed on disk at 14:06', actions: [{ label: 'Overwrite' }, { label: 'Reload', kind: 'quiet' }] };
export const previewViews = {
  'Opened from Files': [shownCode({}), 'The file as numbered code, its folder under the name; Open with… and Close.'],
  'Pointer over the header': [shownCode({ tools: ['refresh', 'open with'] }), 'Refresh comes with the pointer, Retry after a failed read.'],
  'Edited: Save appears': [edited({ tools: ['save', 'discard', 'open with'] }), 'The edited line washed; Save is the one primary, or ⌘S; Discard drops the edit.'],
  'Discard armed': [edited({ tools: ['save', 'discard', 'open with'], discarding: true }), 'Discard asks again for 4 s.'],
  Saving: [edited({ tools: ['save', 'open with'], saving: true }), 'Save spins until the file is written.'],
  Saved: [edited({ said: ['Saved'] }), 'Saved, under the name, until the next edit.'],
  'Changed on disk while edited': [edited({ band: overDisk }), 'Nothing is written until you choose: yours over it, or the file’s.'],
  'After Overwrite or Reload': [edited({ said: ['Saved'], band: { text: 'Saved over the 14:06 text', actions: [{ label: 'Undo', kind: 'quiet' }] } }), 'One Undo, no question before.'],
  'The computer is gone': [edited({ folder: away(code.folder), said: ['Not saved'], band: { text: 'devbox unreachable. Saves when it answers.' } }), 'The edit waits and saves on its own when the computer is back.'],
  "Couldn’t save": [edited({ tools: ['save', 'discard', 'open with'], refused: samplePreview.failures.save }), 'The write was refused: its words, Save again, and Explain to the agent.'],
  'Over 1 MB: read only': [{ ...log, said: ['read only'], tools: ['open with'], cut: 'Cut at 1 MB' }, 'The first megabyte, read only; Open with… for the rest.'],
  Binary: [{ ...binary, tools: ['open with'], empty: { icon: 'lu-file', text: 'Binary file · 812 KB', action: 'Open with…' } }, 'Nothing to read here: Open with… another app.'],
  'Gone from disk': [{ ...gone, empty: { icon: 'lu-file', text: 'No longer on disk' } }, 'The file was removed or moved.'],
  'First read': [shownCode({ reading: true }), 'The skeleton while it reads.'],
  "Can’t read": [shownCode({ failure: samplePreview.failures.read }), 'The read was refused: its words, Refresh, and Explain to the agent.'],
  'A picture on this computer': [shownShot('shown'), 'The picture fitted to the panel, its pixel size beside the folder on hover.'],
  'Another computer, over 2 MB: Load': [shownShot('held', { folder: away(shot.folder) }), 'Nothing is brought over until Load, with its size.'],
  'Picture loading': [shownShot('loading', { folder: away(shot.folder), tools: ['refresh', 'open with'] }), 'The picture’s shape breathes; Refresh spins.'],
  'Over 20 MB': [{ ...huge, folder: away(huge.folder), tools: ['open with'], empty: { icon: 'lu-file', text: 'Over 20 MB: too large to bring over', action: 'Open with…' } }, 'Too large to bring over: Open with… another app.'],
  'Pins: click, drag, type': [shownShot('shown', { pins, send: { agent: samplePull.agent } }), 'Proposed: a click drops a numbered pin, a drag rings a region, the note is typed beside it; Send to the agent, or ⌘↩.'],
  'Pins sent': [shownShot('shown', { pins: placedPins, send: { sent: samplePull.sent } }), 'Proposed: the list was the message; the pins stay with when it went.'],
  'A picture that can’t be shown': [shownShot('shown', { failure: samplePreview.failures.picture }), 'The refused picture: its words, Refresh, and Explain to the agent.'],
  'Markdown, formatted': [shownNote(), 'Markdown formatted; Source shows the file as text.'],
  'Markdown, a click edits that block': [shownNote({ tools: ['save', 'discard', 'source', 'open with'], doc: { block: 2, state: 'editing' } }), 'A click edits that block alone; a click below the last adds one.'],
  'Markdown, a table cell by cell': [shownNote({ tools: ['save', 'discard', 'source', 'open with'], doc: { block: 3, state: 'editing', cell: [2, 1] } }), 'A table opens as its cells, with Add row, Add column and Done under it.'],
  'Markdown, Source': [shownNote({ doc: { view: 'source' } }), 'The whole file as text; Formatted goes back.'],
  'Markdown, cut at 1 MB': [shownNote({ said: ['read only'], tools: ['open with'], cut: 'Cut at 1 MB' }), 'Past 1 MB the start is shown, read only.'],
  'A picture inside a note': [notePicture('held'), 'On another computer a picture waits as its name and size, with Load.'],
  'A picture inside a note, loading': [notePicture('loading'), 'Its shape breathes in the note.'],
  'A picture inside a note, can’t be shown': [notePicture('failed'), 'One quiet line; the rest of the note reads on.'],
  'Another computer, not answering': [shownNote({ folder: away(note.folder), said: ['Read 14:02', 'devbox not answering'], stale: true }), 'The last read stays, stepped down, with when it was read.'],
  'Narrow, 300': [shownNote({ look: 'narrow' }), 'The title steps down; the table keeps its columns.'],
};
const stated = (views, draw) => ({
  args: { view: Object.keys(views)[0] },
  markup: ({ view }) => draw(views[view][0]),
  states: Object.entries(views).map(([label, [, caption]]) => ({ label, args: { view: label }, caption })),
});
const control = (views) => ({ view: { name: 'what it shows', control: { type: 'select' }, options: Object.keys(views) } });

// Pull requests: the list, then pull request 142 and its neighbours on each verdict, its conversation, details, pickers and pages.
const { asked, projects: pullProjects, branches, closed: closedPulls, others, counts, stale: pullStale, contexts, keep } = samplePulls;
const [acmeShop, ...otherProjects] = pullProjects;
const askedGroup = { name: 'Asked of you', pulls: asked };
const listed = (extra = {}) => ({ groups: [askedGroup, ...pullProjects], ...extra });
const withBranch = (branch, extra = {}) => ({ groups: [askedGroup, { ...acmeShop, branch }, ...otherProjects], ...extra });
const { verdicts, refusals, thread: talkSample, answers, events, details: detailSample, review: reviewSample } = samplePull;
const openedPull = (verdict = verdicts.failed, extra = {}) => ({ page: 'pr', number: verdict.number ?? samplePull.number, title: verdict.title ?? samplePull.title, agent: verdict.agent ?? samplePull.agent, verdict, details: { summary: detailSample.summary }, ...extra });
const failedActs = ['explain', 'log', 'github'];
const talked = (extra = {}) => openedPull(verdicts.failed, { acts: failedActs, talk: { thread: talkSample, ...extra } });
const { cut: filesCut, moreChecks, ...detailsShown } = detailSample;
const detailed = (extra = {}) => openedPull(verdicts.failed, { acts: failedActs, scope: samplePull.branch, details: { ...detailsShown, open: true, ...extra } });
const person = (checked, extra = {}) => ({ name, second }) => ({ label: name, second, checked: checked.includes(name), ...extra });
const { people, labels, notes } = samplePullPages;
const picker = (title, items) => ({ ...detailed(), picker: { title, items: [{ field: 'Find' }, ...items] } });
const reviewers = (checked) => people.slice(0, 3).map(person(checked));
const pageOf = (page, { file, facts: said, ...rest }, extra = {}) => ({ page, file, facts: said, back: samplePull.number, ...rest, ...extra });
export const pullsViews = {
  'At rest: what waits on you, then each project': [listed(), 'Asked of you first, then each project’s open ones; each row ends on its state, in its tone.'],
  'A branch with no pull request: its row first': [withBranch(branches.none), 'The branch in front leads its project, with Create pull request.'],
  'A branch not on GitHub: Push': [withBranch(branches.unpushed), 'Its commits under it, and Push.'],
  'The pane in front is on devbox: Pull': [{ groups: [{ ...acmeShop, branch: branches.behind, pulls: acmeShop.pulls.slice(0, 1), everyone: null }] }, 'The computer beside the branch, and Pull.'],
  'Its pull request was merged': [{ groups: [{ ...acmeShop, branch: branches.merged, pulls: acmeShop.pulls.slice(0, 1), everyone: null }] }, 'The merged one is named on the branch row.'],
  'The default branch: no branch row': [{ groups: [{ ...acmeShop, pulls: [acmeShop.pulls[0], acmeShop.pulls[2]], everyone: null }] }, 'main has no pull request of its own.'],
  'No branch checked out': [withBranch(branches.detached), 'The branch row says why, with nothing to press.'],
  'No remote': [withBranch(branches.noRemote), 'The branch row says why.'],
  'Not a GitHub remote': [withBranch(branches.elsewhere), 'The remote is named, so you know where it lives.'],
  'First read': [{ reading: true }, 'Nothing read yet: the skeleton, once.'],
  'Everyone’s, being read': [{ groups: [{ ...acmeShop, pulls: acmeShop.pulls.slice(0, 1), everyone: null, reading: true }] }, 'Everyone’s in acme-shop was pressed; the rest reads in place.'],
  'Nothing open anywhere': [{ empty: contexts.nothing }, 'One quiet line.'],
  'Nothing open, a branch without one': [{ groups: [{ name: acmeShop.name, branch: branches.none }], empty: contexts.nothingElse }, 'The branch row, then the quiet line.'],
  'Not signed in to GitHub': [{ empty: contexts.signIn }, 'Sign in, the one thing to do.'],
  'GitHub CLI not installed': [{ empty: contexts.cli }, 'Where to get it.'],
  'Rate limited': [listed({ scope: pullStale.limited, stale: true }), 'The last read stays, stepped down, with when GitHub lets it read again.'],
  'GitHub not answering': [listed({ scope: pullStale.silent, stale: true }), 'The last read stays, with the next try.'],
  Closed: [{ counts, tab: 'closed', groups: [{ name: 'This branch', pulls: closedPulls.slice(0, 1) }, { name: 'Yours', pulls: closedPulls.slice(1) }] }, 'Open and Closed when there are closed ones; merged and closed say so.'],
  'Closed, being read': [{ counts, tab: 'closed', reading: true }, 'The skeleton under the tabs.'],
  'Nothing closed yet': [{ counts, tab: 'closed', empty: contexts.nothingClosed }, 'One quiet line.'],
  'Couldn’t keep pull requests': [listed({ keep }), 'The list still shows; the local store’s own words, and Refresh.'],
  'Narrow, 300': [listed({ look: 'narrow' }), 'Titles cut; the state stays.'],
  'Create a pull request, in the panel': [{ page: 'new', ...samplePullPages.create }, 'Title and description from the commits; Create, or Create as draft.'],
  'Create refused': [{ page: 'new', ...samplePullPages.create, failure: samplePullPages.refused }, 'gh’s words, the text kept, and Create on GitHub.'],
  'Opened: the verdict and what it rests on': [talked(), 'The title, GitHub’s verdict in its tone, the failing lines, then the acts it allows.'],
  'First paint, from the header': [openedPull(verdicts.failed, { reading: true }), 'The title and the verdict from the list, the rest as a skeleton.'],
  'Draft: the author’s choice, not a fault': [openedPull(verdicts.draft, { acts: ['ready'] }), 'Ready for review, the one act.'],
  'Checks running: a wait': [openedPull(verdicts.running, { checking: true }), 'Each running check with its time; Refresh spins.'],
  'GitHub still deciding': [openedPull(verdicts.deciding), 'Nothing to press yet.'],
  'Conflicts: the files': [openedPull(verdicts.conflicts, { acts: ['explain'] }), 'The files that conflict, and Explain to the branch’s agent.'],
  'Conflicts, no agent': [openedPull(verdicts.conflicts, { acts: ['open'] }), 'Without an agent, Open on GitHub.'],
  'Behind its base: the commits it lacks': [openedPull(verdicts.behind, { acts: ['update', 'explain'] }), 'Update branch, or Explain.'],
  'Blocked by branch rules: the unmet rules': [openedPull(verdicts.rules, { acts: ['explain'] }), 'Each rule the base asks, with how far it is.'],
  'Review required: who was asked': [openedPull(verdicts.review, { acts: ['explain'] }), 'Who was asked, and when.'],
  'No permission: who can merge': [openedPull(verdicts.permission, { acts: ['explain'] }), 'What you have, and who can merge.'],
  'Checks that did not finish': [openedPull(verdicts.unfinished, { acts: ['explain'] }), 'Which, and why.'],
  'Its agent waits on you': [openedPull(verdicts.waits, { acts: ['log', 'github'] }), 'No Explain: the agent waits on you first.'],
  'Explained, one press': [openedPull(verdicts.failed, { sent: samplePull.sent, acts: ['github'] }), 'The press is said, with the time.'],
  'Explain refused': [openedPull(verdicts.changes, { refused: refusals.explain }), 'hc’s words, and Explain again.'],
  'Changes requested: Reply on GitHub': [openedPull(verdicts.changes, { acts: ['explain', 'reply'], talk: { said: events.comment } }), 'The request, Explain, and Reply on GitHub.'],
  'Send to the agent: the message first': [openedPull(verdicts.changes, { acts: ['send'], message: samplePull.message }), 'What goes to the agent shows before Send.'],
  'Ready to merge': [openedPull(verdicts.ready, { acts: ['merge'] }), 'Merge, the one act.'],
  'Merge armed': [openedPull(verdicts.ready, { acts: ['merge'], armed: true }), 'Merge asks again.'],
  Merging: [openedPull(verdicts.ready, { acts: ['merging'] }), 'Merging… until GitHub answers.'],
  'Merge refused': [openedPull(verdicts.ready, { refused: refusals.merge }), 'gh’s words, Squash and merge, and Explain.'],
  'Closed: Reopen': [openedPull(verdicts.closed, { acts: ['reopen'] }), 'Reopen, the one act.'],
  'Link copied': [openedPull(verdicts.ready, { acts: ['merge'], copied: true }), 'Copied, for a moment, where Copy link was.'],
  'On another computer': [openedPull(verdicts.failed, { acts: failedActs, scope: samplePull.remote.computer }), 'The computer under the number.'],
  'That computer unreachable': [openedPull(verdicts.failed, { scope: samplePull.remote.stale, stale: true, refused: refusals.unreachable }), 'The last read, stepped down; Explain refused in place.'],
  'Other open pull requests': [openedPull(verdicts.ready, { acts: ['merge'], others: { label: counts.others, pulls: others } }), 'The rest of the repository’s open ones, and Open the list.'],
  'Narrow, 300 (open)': [talked({ look: 'narrow' }), 'The acts wrap; the details stay folded.'],
  'The conversation, under the verdict': [openedPull(verdicts.failed, { acts: failedActs, talk: { thread: talkSample, approved: events.approved, said: events.comment } }), 'Each thread on its lines, then reviews and comments; Comment last.'],
  'Replying: click, type, ⌘↵': [talked({ typing: answers.answer.text }), 'The reply field opens in the thread.'],
  'Sent: in the thread at once': [talked({ thread: { ...talkSample, answer: answers.answer } }), 'The reply shows at once, pending until GitHub confirms.'],
  'Reply refused: the text kept': [talked({ typing: answers.answer.text, refused: refusals.reply }), 'gh’s words; the text stays, Reply again.'],
  'Offline: kept and said once': [talked({ thread: { ...talkSample, answer: answers.answer }, offline: events.offline }), 'The reply waits and says so once.'],
  'Resolved: one line, Undo after': [openedPull(verdicts.failed, { acts: failedActs, talk: { resolved: events.resolved, said: events.comment } }), 'A resolved thread folds to one line with Undo.'],
  'Explain to the agent, then post its answer': [openedPull(verdicts.changes, { talk: { thread: { ...talkSample, agentAnswer: answers.agentAnswer, answered: answers.answered }, explained: samplePull.sent } }), 'The agent’s answer fills Reply; you post it.'],
  'Asked of you: review here, one submit': [openedPull(reviewSample, { review: reviewSample }), 'The files, then one review: Approve, Request changes or Comment.'],
  'Review sent: it joins the conversation': [openedPull({ ...reviewSample, text: 'Review required' }, { talk: { approved: events.mine, said: events.comment } }), 'Your review shows at once in the conversation.'],
  'Details open': [detailed(), 'Description, people and labels, checks and files.'],
  'No description': [detailed({ description: null }), 'One quiet line.'],
  'Nobody assigned': [detailed({ nobody: true }), 'Each says None with its verb.'],
  'More checks': [detailed({ moreChecks }), 'Five checks, then Show 3 more.'],
  'Files cut off': [detailed({ cut: filesCut }), 'Show 92 more, and what GitHub lists.'],
  'The diff could not be read': [detailed({ diffFailed: refusals.diff }), 'gh’s words under the files, and Refresh.'],
  'Reviewers: three clicks, no waiting': [picker('Request a review', reviewers(['sam', 'stan']).map((item) => (item.label === 'stan' ? { ...item, mark: 'working' } : item))), 'Each click is kept at once; a pending one breathes.'],
  'Reviewers: one refused, the others untouched': [picker('Request a review', [...reviewers(['sam']).slice(0, 2), { failure: refusals.reviewer }, ...reviewers(['stan']).slice(2)]), 'The refusal under its person; the rest stay.'],
  'Labels, from the local store': [picker('Change labels', [...labels.map(({ name, second, dot }) => ({ label: name, second, dot, checked: name !== 'docs' })), { label: notes.first, disabled: true }]), 'The labels at once, with a dot each; the first 100.'],
  'Picker, the first open': [picker('Request a review', [{ loading: true }, { loading: true }]), 'The skeleton, once ever.'],
  'Picker, no match': [picker('Request a review', [{ label: notes.none, disabled: true }]), 'One quiet line.'],
  'Picker, offline: changes wait': [picker('Request a review', [...people.slice(1, 3).map(person(['sloane', 'stan'], { mark: 'working' })), { label: notes.offline, disabled: true }]), 'The changes wait and say so once.'],
  'Assign people': [picker('Assign people', people.map(person(['jj']))), 'The people with access.'],
  'No labels': [picker('Change labels', [{ label: notes.noLabels, disabled: true }]), 'One quiet line.'],
  'More people than listed': [picker('Request a review', [...people.slice(0, 2).map(person(['sam'])), { label: notes.truncated, disabled: true }, { label: 'Open on GitHub', icon: 'lu-external-link' }]), 'Open on GitHub for the rest.'],
  'A file’s diff': [pageOf('file', samplePullPages.diff), 'Numbered lines, added and deleted in their wash, hunks named.'],
  'A line: click it, or the + in its gutter': [pageOf('file', samplePullPages.diff, { text: samplePullPages.pointed }), 'The line under the pointer is lit.'],
  'A comment on that line, right there': [pageOf('file', samplePullPages.diff, { chunks: samplePullPages.commented.chunks, draft: samplePullPages.commented.text, between: 'comment' }), 'The field opens under the line; Comment.'],
  'Asked of you: comments wait for the review': [pageOf('file', samplePullPages.pending, { between: 'pending' }), 'A pending comment, then Add to review.'],
  'A thread on its line, answerable there': [pageOf('file', samplePullPages.threaded, { between: 'thread' }), 'The thread sits on its line, with Reply.'],
  'A long diff, 400 lines at a time': [pageOf('file', samplePullPages.long), 'How many are left, and Show the next 400.'],
  'Diff: reading': [pageOf('file', samplePullPages.reading, { reading: true }), 'The skeleton; Refresh spins.'],
  'No text diff': [pageOf('file', samplePullPages.picture), 'A picture or a binary file says so.'],
  'Full log: a page': [pageOf('log', samplePullPages.log, { agent: samplePull.agent }), 'The whole log, failures in their tone, and Explain.'],
};
// Pins: the Simulator frozen for pinning on iOS and Android, kept, rotated, stalled, remote, refused and sent; Images with the same pins.
const { scopes, ios: iosPins, typing, android, rotated, stalled, file: pinFile, agents: pinAgents, sent: pinsSent, refusals: pinRefusals } = samplePins;
const toCheckout = { agent: 'checkout' };
const onDevice = (scope, placed, extra = {}) => ({ title: 'Simulator', scope, screen: sampleScreens.ios, pins: placed, send: toCheckout, ...extra });
const onPixel = (scope, placed, extra = {}) => onDevice(scope, placed, { screen: sampleScreens.android, ...extra });
const pinsViews = {
  'iOS, pinning: a region, a note being typed': [onDevice(scopes.frozen, typing), 'Proposed: Pin freezes the frame and rings it; a click drops a numbered pin, a drag rings a region, the note is typed beside it.'],
  'Android, pinning: touches wait': [onPixel(scopes.touches, android), 'Proposed: the same pins on Android; touches wait while it is frozen, and a pin without a note says so.'],
  'Sent: live again': [onDevice(scopes.live, [], { frozen: false, send: { sent: pinsSent, open: 'Open in Simulator' } }), 'Proposed: the list was the message; the pins clear and the picture is live again.'],
  'No agent in front: the picker': [onDevice(scopes.frozen, iosPins.slice(0, 2), { send: {}, agents: pinAgents }), 'Proposed: with no pane in front, Send to… opens the agents to pick from.'],
  'Kept from before, not sent': [onDevice(scopes.kept, [iosPins[0], { ...iosPins[1], hover: true }]), 'Proposed: unsent pins stay per agent and picture; × on hover removes one.'],
  'Images: the same pins, no tool': [{ on: 'picture', title: 'Images', scope: scopes.images, image: sampleShot, file: pinFile, pins, send: toCheckout }, 'Pins are always on in Images: the same marks, list and Send.'],
  'Images: sending': [{ on: 'picture', title: 'Images', scope: scopes.images, image: sampleShot, file: pinFile, pins: placedPins, send: { sending: true } }, 'Sending… until hc answers, as Images does today.'],
  'Rotated since the freeze': [onPixel(scopes.rotated, rotated, { rotated: true, screen: { ...sampleScreens.android, lines: sampleScreens.android.lines.slice(1, 3) } }), 'Proposed: a rotation is said once in the scope; the pins stay on the frame they were dropped on.'],
  'The picture had stalled': [onPixel(scopes.stalled, stalled), 'Proposed: pinning a stalled picture says so; the pins are on what you saw.'],
  'The agent is on devbox': [onDevice(scopes.devbox, iosPins.slice(0, 1), { send: { agent: 'migrate' } }), 'Proposed: to an agent on another computer the frame is copied first.'],
  'Send refused': [onDevice(scopes.frozen, iosPins.slice(0, 1), { send: { refused: pinRefusals.send } }), 'Proposed: hc’s words, the pins kept, and Send again.'],
  'Copy to devbox refused': [onDevice(scopes.devbox, iosPins.slice(0, 1), { send: { refused: pinRefusals.copy } }), 'Proposed: the copy’s words, the pins kept, and Send again.'],
};

// Simulator: iOS and Android on their picture with their buttons, the list behind Device, then each state in the screen's place.
const { groups: deviceGroups, scopes: simScopes, said: simSaid, touch, narrow: narrowLines, url, failures: simFailures, empty: noDevices } = sampleSimulator;
const onIphone = (extra = {}) => ({ scope: simScopes.iphone, screen: sampleScreens.ios, controls: 'ios', ...extra });
const onEmulator = (extra = {}) => ({ scope: simScopes.pixel, screen: sampleScreens.android, controls: 'emulator', ...extra });
const simulatorViews = {
  'iOS: the picture': [onIphone(), 'The picked device’s picture fitted to the panel, its buttons and Open in Simulator under it, and a URL to open.'],
  'Android: touch, keys, the device’s buttons': [onEmulator({ touch }), 'A click is a tap, a drag a swipe; the device’s buttons under it, Rotate and Shut down on an emulator.'],
  'A connected Android phone': [onEmulator({ controls: 'android' }), 'A phone on the cable has its keys, no Rotate and no Shut down.'],
  'Keys go to the device': [onEmulator({ focus: true }), 'After a touch, typing, Enter, Backspace and the arrows go to the device.'],
  'Devices: the list replaces the screen': [{ groups: deviceGroups }, 'Device opens every device by platform, the picked one washed; back returns to its picture.'],
  'First read': [{ scope: [], reading: true }, 'The skeleton while the tools answer; Refresh spins.'],
  'No devices': [{ scope: [], empty: noDevices }, 'The tools are here and list nothing.'],
  Off: [{ scope: simScopes.off, shows: 'off' }, 'The empty frame and Boot.'],
  Starting: [{ scope: simScopes.starting, shows: 'waiting' }, 'The frame breathes and the scope counts down.'],
  'Start timed out': [{ scope: simScopes.off, failure: simFailures.start }, 'The Failure block with Start again and Explain.'],
  'The first frame': [onIphone({ shows: 'waiting' }), 'On, before its first picture: the frame breathes, the buttons are there.'],
  'The picture stalled': [onEmulator({ scope: simScopes.stalled, state: 'stalled' }), 'The last picture stepped down; the scope says how old it is.'],
  'No picture from the device': [onIphone({ shows: 'blank' }), 'The device answers without a picture; its buttons stay.'],
  'A command failed': [{ scope: simScopes.pixel, failure: simFailures.command }, 'The Failure block in the tool’s words, Refresh and Explain.'],
  'A command running': [onIphone({ acting: 'Appearance dark' }), 'The pressed button spins; the others wait for it.'],
  'A URL typed': [onIphone({ url }), 'Open a URL comes with the text; Enter does the same.'],
  'A URL that did not open': [onIphone({ url, failure: simFailures.url }), 'simctl’s words in the Failure block; the URL stays in its field.'],
  Offline: [{ scope: simScopes.offline, shows: 'still' }, 'A device adb sees but cannot reach says so in the scope; no Boot.'],
  Unauthorized: [{ scope: simScopes.unauthorized, shows: 'still' }, 'A phone that has not allowed this computer says so in the scope.'],
  'Emulator missing': [{ scope: simScopes.image, said: [simSaid.noEmulator], shows: 'still' }, 'Without the emulator binary an Android image cannot start: one line, no Boot.'],
  'Another computer’s project': [onEmulator({ said: [simSaid.remote] }), 'The devices are this computer’s, said once under the header.'],
  'Can’t read the devices': [{ scope: [], failure: simFailures.read }, 'The Failure block with Refresh.'],
  'Narrow, 300: the device scales': [onIphone({ look: 'narrow', narrow: true, screen: { ...sampleScreens.ios, lines: narrowLines } }), 'The device scales down with the panel.'],
};

// Images: the first of checkout's three pictures with Preview's two pins; each state is what the pointer, a pin, Send or a read changes.
const onPicture = (extra) => ({ scope: sampleImages.count, image: sampleShot, file: sampleImages.file, shots: sampleImages.shots, pins: placedPins, send: { agent: sampleImages.agent }, ...extra });
const agentOnly = { scope: sampleImages.agent };
export const imagesViews = {
  'At rest: two notes, ready to send': [onPicture({}), 'The picture with its pins, a row a note, Send to checkout with ⌘↩; the count beside the title.'],
  'Pointer on the picture': [onPicture({ pointer: true }), 'Its file, folder and time with Open, then the strip of the others; ← → too.'],
  'A new pin: its note typed beside it': [onPicture({ pins }), 'A click drops a pin, a drag rings a region; the note is typed beside it.'],
  'No pins yet': [onPicture({ pins: [] }), 'Nothing under the picture: no pins, no Send.'],
  'Kept to checkout': [onPicture({ kept: true }), 'The lock stays while the panel keeps to this agent; the pane in focus no longer moves it.'],
  'Sending': [onPicture({ send: { sending: true } }), 'Sending… until hc answers; the pins stay.'],
  'Sent': [onPicture({ pins: [], send: { sent: sampleImages.sent } }), 'The pins were the message; when it went stays under the picture.'],
  'Not sent': [onPicture({ send: { refused: sampleImages.notSent } }), 'hc’s words, the pins kept, and Send again.'],
  'Its agent waits on you': [onPicture({ send: { refused: sampleImages.waiting } }), 'No Send while the agent needs you; Go to it.'],
  'No agent in front: the picker': [onPicture({ pins: placedPins.slice(0, 1), send: {}, agents: samplePins.agents }), 'Send to… opens the agents to pick from; the pin stays.'],
  'Not a picture': [onPicture({ wrong: sampleImages.wrong }), 'The last picture stays; one line says what was dropped.'],
  'Loading the picture': [{ ...agentOnly, kept: true, reading: true, loading: true }, 'The picture’s shape breathes; Refresh spins.'],
  'Another computer: not brought over yet': [{ scope: sampleImages.held.scope, held: sampleImages.held.action }, 'Nothing is brought over until Load, with its size.'],
  'Another computer, unreachable': [onPicture({ scope: sampleImages.offline, stale: true }), 'The last picture stays, stepped down, with when it tries again.'],
  'A read failed': [{ ...agentOnly, failure: sampleImages.failure }, 'The tool’s words, Refresh, and Explain.'],
  'No pictures in this conversation': [{ ...agentOnly, empty: sampleImages.empty }, 'One quiet line.'],
  'No conversation': [{ ...agentOnly, empty: sampleImages.noConversation }, 'The agent has written no conversation yet.'],
  'No agent in focus': [{ empty: sampleImages.noAgent }, 'One quiet line.'],
  'Narrow, 300': [onPicture({ look: 'narrow' }), 'The picture fits; the notes wrap.'],
};
const panels = { 'Panels/Settings': [settingsViews, settings], 'Panels/Find': [findViews, conversationFind], 'Panels/Files': [filesViews, files], 'Panels/Ports': [portsViews, ports], 'Panels/Markdown': [markdownViews, markdownWindow], 'Panels/Containers': [containersViews, containers], 'Panels/Memory': [memoryViews, memory], 'Panels/Spend': [spendViews, spend], 'Panels/Worktrees': [worktreesViews, worktrees], 'Panels/Shipped': [shippedViews, shipped], 'Panels/Share': [shareViews, sharing], 'Panels/Images': [imagesViews, images], 'Panels/Preview': [previewViews, preview], 'Panels/PR': [pullsViews, pulls], 'Panels/Pins': [pinsViews, pinPanel], 'Panels/Simulator': [simulatorViews, simulator] };
export const panelPages = Object.fromEntries(Object.entries(panels).map(([page, [views, draw]]) => [page, stated(views, draw)]));
export const panelPlaygrounds = Object.fromEntries(Object.entries(panels).map(([page, [views]]) => [page, { ...panelPages[page], argTypes: control(views) }]));

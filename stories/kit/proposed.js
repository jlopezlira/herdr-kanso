import { panel, panelBack, panelDoors, panelHeader, panelRefresh } from './compositions.js';
import { activity } from './activity.js';
import { tabBar } from './tab-bar.js';
import { toolbar } from './toolbar.js';
import { emptyState, facts, failureBlock, glyph, skeletonOf, toast } from './pieces.js';
import { atWidth, toolsRoom } from './frames.js';
import { sampleAddMenu, sampleSidebar } from './samples.js';
import { todoAdd, todoDone, todoRow, todoScopes, todoSend } from './todo.js';
import { promptEntry, promptOpened } from './timeline.js';
import { resumeEntry, resumeMenu } from './resume.js';

const todos = [
  { text: 'Retry-After is in seconds, not milliseconds', when: 'Today 17:00' },
  { text: 'Release notes for 3.31', when: 'Yesterday', late: true },
  { text: 'Drop the old webhook route' },
];
const moreTodos = [
  { text: 'Pin the Storybook port in the README' }, { text: 'Remote panes count their calls at rest', when: 'Fri 15:00' },
  { text: 'Dawn sky on Windows' }, { text: 'Spend: retain queued changes', when: 'Mon 09:00' }, { text: 'Credits page lists every source' },
  { text: 'Ports panel on a second computer' }, { text: 'Arrange keeps zoom' }, { text: 'Sleep forgets a closed tab' }, { text: 'Find in a long reply' },
];
const doneTodos = [{ text: 'Rename kd to demo', when: '14:02 · checkout', done: true }, { text: 'Pin Node 22.15', when: '11:40 · you', done: true }];
const openOf = (items) => items.filter((item) => !item.done).length;
const todoPanel = ({ all = false, draft = '', reading = false, open = null }, ...body) => panel({ header: panelHeader({ title: 'To-do', tools: [panelRefresh({ reading })] }) },
  todoScopes({ project: 'kansō', open, all }), todoAdd({ draft }), body);
const todoList = ({ items = todos, all = false, draft = '', doneOpen = false, after = null }) => todoPanel({ all, draft, open: openOf(items.filter((item) => (item.project ?? 'kansō') === 'kansō')) },
  items.map(({ below = null, ...item }) => [todoRow(item), below]), todoDone({ count: doneTodos.length, open: doneOpen }), doneOpen ? doneTodos.map(todoRow) : null, after);
const withLook = (index, look) => todos.map((item, at) => (at === index ? { ...item, ...look } : item));
const sendTo = todoSend({
  sessions: [{ program: 'p-claude', name: 'checkout', status: 'working' }, { program: 'p-codex', name: 'payment webhook', status: 'done' }],
  programs: [{ program: 'p-claude', name: 'Claude Code' }, { program: 'p-codex', name: 'Codex' }],
});
const everyProject = [{ ...todos[0], text: 'Retry-After in seconds' }, ...todos.slice(1)].map((item) => ({ ...item, project: 'kansō' }))
  .concat([{ text: 'Hero copy for the beta', when: 'Fri 15:00', project: 'site' }, { text: 'Webhook retries', project: 'amtelser' }]);

const toDo = [
  ['Empty', todoPanel({ open: 0 }, emptyState({ icon: 'lu-circle-check', text: 'Nothing to do in kansō' })), 'One list per project, kept in kanso.db through kdb.js; you and every conversation in the project write the same rows.'],
  ['Loading', todoPanel({ reading: true }, skeletonOf({ shape: 'row', count: 3 })), 'Before kanso.db answers the first read.'],
  ['A few', todoList({}), 'Open first, the due time on the right, red once it has passed; Done folds under them.'],
  ['Many', todoList({ items: [...todos, ...moreTodos] }), 'The list scrolls under the add field; Done stays folded at the end.'],
  ['Failure', todoPanel({}, failureBlock({ text: "Can't read the to-do list", source: 'kanso.db: database is locked', fix: 'Refresh', agent: 'checkout' })), 'kanso.db did not answer: the list is not drawn from memory.'],
  ['Keyboard on a row', todoList({ items: withLook(1, { focus: true }) }), '↑ ↓ move, Space ticks, Enter edits, ⌘↩ sends to a conversation, ⌫ deletes.'],
  ['Under the pointer', todoList({ items: withLook(0, { hover: true }) }), 'Send, Edit and Delete in the due time\'s place; the circle ticks.'],
  ['Adding', todoList({ draft: 'Release notes #site @fri 3pm' }), '#project tags it, @when sets its due time; Enter adds it.'],
  ['Editing', todoList({ items: withLook(2, { editing: true }) }), 'Double-click or Enter edits in place, the text selected; Esc keeps the old one.'],
  ['Send to a conversation', todoList({ items: withLook(0, { hover: true, below: sendTo }) }), 'A conversation in this project, or a new one; it ticks the to-do when it finishes.'],
  ['Ticked, saving', todoList({ items: withLook(0, { done: true, pending: true }) }), 'Ticked at once; it breathes until kanso.db confirms.'],
  ['Done, open', todoList({ doneOpen: true }), 'When and who ticked each; Clear empties Done, with Undo.'],
  ['Deleted', todoList({ items: todos.slice(1), after: toast({ title: 'Deleted a to-do', action: 'Undo' }) }), 'One press deletes; Undo brings it back.'],
  ['All projects', todoList({ items: everyProject, all: true }), 'Every project\'s open to-dos, its name before the due time.'],
];

const prompts = [
  { text: 'Make the switcher open on the session you were in before', at: '16:21', facts: [{ text: 'working', tone: 'working' }, '2m 14s', '6.8k tokens'], reply: 'Reading the switcher and its tests first.', live: true, context: '418k' },
  { text: 'Why does Retry-After loop on every 429?', at: '16:02', facts: ['4m', '9.1k tokens', '3 files', '6 commands'], reply: 'The header is in seconds and we read it as milliseconds, so the wait was a thousand times too short.' },
  { text: 'Run the Storybook lint and fix what fails', at: '15:40', facts: ['1m', '2.3k tokens', '1 file', '2 commands'], reply: 'One record used a raw value; it now uses the spacing token.' },
];
const olderPrompts = [['Rename the demo window to kd', '15:12'], ['Add the circle icons from Lucide', '14:58'], ['Draw the empty state for Ports', '14:31'], ['Move Credits under the footer', '14:05'], ['Pin Node 22.15 in the engines', '13:47']]
  .map(([text, at]) => ({ text, at, facts: ['2m', '3.4k tokens', '2 files', '1 command'], reply: 'Done, and the checks pass.' }));
const counted = (count, one) => (count ? `${count} ${one}${count === 1 ? '' : 's'}` : null);
const timelineHeader = ({ conversation, shown }) => panelHeader({ title: 'Timeline', start: conversation ? [glyph('p-claude')] : [],
  second: conversation ? facts(conversation, counted(shown.length, 'prompt'), shown[0]?.context && `context ${shown[0].context}`) : null });
const timelinePanel = ({ conversation = 'checkout', shown = [], focus = -1 }, ...body) => panel({ header: timelineHeader({ conversation, shown }) },
  shown.map((item, at) => promptEntry({ ...item, focus: at === focus })), body);
const read = prompts[1];
const opened = panel({ header: panelHeader({ title: facts(`#${prompts.length - 1}`, read.at), form: 'bar', start: [panelBack({ label: 'Timeline' })], second: facts(...read.facts) }) }, promptOpened({
  asked: read.text, at: read.at, also: [{ text: 'Also check the cart client', at: '16:04' }],
  reply: '# Retry-After\n\nThe header is in seconds and we read it as milliseconds, so the wait was a thousand times too short.\n\n- `limits.ts` reads it as seconds\n- the cart client waits once, then gives up after three tries',
  files: [{ path: 'src/api/limits.ts', add: 12, del: 4 }, { path: 'src/cart/client.ts', add: 3, del: 1 }, { path: 'tests/limits.test.ts', add: 28, del: 0 }],
}));
const timelineDoor = { key: 'timeline', label: 'Timeline', icon: 'lu-history' };
const awayPrompts = prompts.map(({ text, at, facts }) => ({ icon: 'lu-message-square', subject: text, fact: facts.slice(0, 2).map((fact) => fact.text ?? fact).join(' · '), age: at }));

const timeline = [
  ['Empty', timelinePanel({}, emptyState({ icon: 'lu-history', text: 'No prompts yet in checkout' })), 'The conversation in focus has not been asked anything.'],
  ['No conversation', timelinePanel({ conversation: null }, emptyState({ icon: 'lu-history', text: 'Focus a conversation to see its prompts' })), 'A terminal or nothing is in focus: it follows the last conversation you were in, else this line.'],
  ['Loading', timelinePanel({}, skeletonOf({ shape: 'two lines', count: 3 })), 'Before the conversation file is first read.'],
  ['A few', timelinePanel({ shown: prompts }), 'Newest first: the prompt and its time, how long, tokens, files and commands, then the reply\'s first sentence. The turn in progress is live.'],
  ['Many', timelinePanel({ shown: [...prompts, ...olderPrompts] }), 'The list scrolls; nothing folds.'],
  ['Failure', timelinePanel({}, failureBlock({ text: "Can't read checkout's conversation", source: 'transcript: no such file', fix: 'Refresh' })), 'The conversation file is gone or unreadable.'],
  ['Keyboard on a row', timelinePanel({ shown: prompts, focus: 1 }), '↑ ↓ move, Enter opens the prompt, Esc comes back.'],
  ['Opened', opened, 'The whole prompt, what you sent while it worked, the reply as Markdown and the files it changed.'],
  ['Where it lives, its own panel', [atWidth(1040, tabBar({ items: [{ key: 'checkout', label: 'checkout' }], value: 'checkout', panels: [...panelDoors, timelineDoor], panel: 'timeline' })), timelinePanel({ shown: prompts })].join(''), 'Option A: a door in the tab bar opens the Timeline beside the panes.'],
  ['Where it lives, in Activity', sampleSidebar({ away: activity({ events: awayPrompts }) }), 'Option B: each prompt is an event in Activity, under the sidebar.'],
];

const conversations = [
  { program: 'p-claude', title: 'Switcher opens back', place: 'kansō', age: '12m' },
  { program: 'p-codex', title: 'Webhook retries', place: 'amtelser', age: '2h' },
  { title: 'Local model tests', place: 'site', age: '1d' },
  { program: 'p-claude', title: 'Release notes for 3.31', place: 'kansō', age: '3d' },
];
const moreConversations = ['Dawn sky on Windows', 'Ports on dark', 'Arrange keeps zoom', 'Credits page', 'Spend queue', 'Find in a long reply'].map((title, index) => (
  { program: index % 2 ? 'p-codex' : 'p-claude', title, place: 'kansō', age: `${index + 4}d` }));
const inPlus = (menu) => toolsRoom(toolbar({ view: 'agents', addMenu: menu }));

const resume = [
  ['In the + menu', inPlus(sampleAddMenu({ resume: resumeEntry })), '+ on Status and Threads: Resume a conversation… opens the list in the menu\'s place.'],
  ['A few', resumeMenu({ conversations }), 'Claude Code, Codex and Pi together, newest first: the title, the project and how long ago. A pick opens it in its project.'],
  ['Many', resumeMenu({ conversations: [...conversations, ...moreConversations], more: 26 }), 'Ten, then how many more; the list scrolls.'],
  ['Loading', resumeMenu({ state: 'loading' }), 'Each program\'s past conversations are read on open.'],
  ['Empty', resumeMenu({ state: 'empty' }), 'Nothing to resume on this computer.'],
  ['Failure', resumeMenu({ conversations: conversations.slice(0, 2), state: 'failed', failure: { text: "Can't read Codex", fix: 'Refresh', detail: 'sessions folder: permission denied' } }), 'The programs that answered stay; the one that failed says so.'],
  ['Keyboard on a row', resumeMenu({ conversations, picked: 1 }), '↑ ↓ move, Enter resumes, Esc goes back to the + menu.'],
  ['Another computer', resumeMenu({ conversations: [conversations[0], { program: 'p-codex', title: 'Nightly tests', place: 'site · dark', age: '5h' }, ...conversations.slice(2)] }), 'The computer after the project; it resumes there.'],
];

export const proposedPages = { 'Panels/To-do': toDo, 'Panels/Timeline': timeline, 'Compositions/Resume': resume };

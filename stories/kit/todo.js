import { button, input, menu, phrase, row, tabs } from './kit.js';

const todoTools = [{ label: 'Send to a conversation', icon: 'lu-send' }, { label: 'Edit', icon: 'lu-pencil' }, { label: 'Delete', icon: 'lu-x' }];
const tick = (done) => button({ label: done ? 'Not done' : 'Done', kind: 'icon', size: 'sm', icon: done ? 'lu-circle-check' : 'lu-circle' });

export const todoScopes = ({ project, open, all = false }) => tabs({
  items: [{ key: 'project', label: phrase(project, open) }, { key: 'all', label: 'All' }], value: all ? 'all' : 'project', size: 'sm', track: true, label: true,
});

export const todoAdd = ({ draft }) => input({ text: draft, label: 'Add a to-do, #project @when', icon: 'lu-plus' });

export const todoRow = ({ text, when = null, late = false, project = null, done = false, hover = false, focus = false, pending = false, editing = false }) => editing
  ? input({ text, label: 'To-do', inline: true, selected: true })
  : row({ start: [tick(done)], name: text, dimmed: done, detail: project ? [{ text: project, tone: 'dim' }] : [],
    meta: when ? { text: when, tone: late ? 'blocked' : 'dim' } : null, actions: todoTools, hover, focus, pending });

export const todoDone = ({ count, open = false }) => row({ icon: open ? 'lu-chevron-down' : 'lu-chevron-right', name: 'Done', heading: true, chip: count,
  action: open ? { label: 'Clear', kind: 'quiet' } : null });

export const todoSend = ({ sessions = [], programs = [] }) => menu({ title: 'Send to', items: [
  ...sessions.map(({ program, name, status = null }) => ({ icon: program, label: name, mark: status })),
  { heading: 'New conversation' },
  ...programs.map(({ program, name }) => ({ icon: program, label: name })),
] });

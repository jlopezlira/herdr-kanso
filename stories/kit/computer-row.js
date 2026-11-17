// The computer row: this computer or a remote one in the sidebar, the row in its heading configuration.
import { phrase, row } from './kit.js';

const icon = (name, label) => ({ icon: name, label });

export const computerStates = ['on', 'off', 'unreachable', 'login'];
const words = { off: 'Off', unreachable: 'Unreachable', login: 'Needs login' };
// What is wrong has one button: Turn on, Refresh, or Sign in.
const fixes = { off: (name) => icon('lu-power', phrase('Turn', name, 'on')), unreachable: () => icon('lu-refresh-cw', 'Refresh'), login: () => icon('lu-key', 'Sign in') };
const syncTool = (label) => icon('lu-arrow-right-left', label);

// `pending`: turning on until hc answers, its tools wait; `word` and `tip`: a word on an on row (Sync can't run) and what the word means.
// `sync`: Sync is on, its tool stays out with this as its tip; off, Sync shows under the pointer with the other tools.
export const computerRow = ({ name, remote = true, state = 'on', status = 'blocked', count = 0, hover = false, focus = false, pending = false, word = null, tip = null, sync = null }) => {
  const said = words[state] ?? word;
  const fix = fixes[state];
  const on = state === 'on';
  return row({
    icon: remote ? 'lu-server' : 'lu-monitor', name, heading: true, hover, focus, pending,
    mark: count && on ? status : 'none', meta: said ? { text: said, tip } : count || null,
    action: fix ? { kind: 'icon', ...fix(name) } : on && remote && sync ? { kind: 'icon', ...syncTool(sync) } : null,
    actions: on && !pending ? [remote && icon('lu-power', 'Turn off'), icon('lu-plus', phrase('New project on', name)), remote && !sync && syncTool('Sync')].filter(Boolean) : [],
  });
};

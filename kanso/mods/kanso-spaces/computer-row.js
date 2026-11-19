// The computer row: this computer or a remote one in the sidebar, the row in its heading configuration, heading the group of its projects (Proposed).
import { icon, phrase, row } from './kit.js';

export const computerStates = ['on', 'off', 'unreachable', 'login'];
const words = { off: 'Off', unreachable: 'Unreachable', login: 'Needs login' };
// What is wrong has one button: Turn on, Refresh, or Sign in.
const fixes = { off: (name) => icon('lu-power', phrase('Turn', name, 'on')), unreachable: () => icon('lu-refresh-cw', 'Refresh'), login: () => icon('lu-key', 'Sign in') };
const syncTool = (label) => icon('lu-arrow-right-left', label);

// `action` is always out; `actions` show under the pointer or the keyboard. Turning on (`pending`), they wait.
// `sync`: Sync is on, out as the action with this as its tip; off, Sync is one of the actions.
const toolsOf = ({ name, remote = true, state = 'on', pending = false, sync = null }) => {
  const fix = fixes[state];
  const on = state === 'on';
  return {
    action: fix ? fix(name) : on && remote && sync ? syncTool(sync) : null,
    actions: on && !pending ? [remote && icon('lu-power', 'Turn off'), icon('lu-plus', phrase('New project on', name)), remote && !sync && syncTool('Sync')].filter(Boolean) : [],
  };
};

// The tools the row shows, in screen order (its actions with `hover` or `focus`, then its action): each is a keyboard stop, named by its icon.
export const computerTools = ({ hover = false, focus = false, ...props }) => {
  const { action, actions } = toolsOf(props);
  return [...(hover || focus ? actions : []), action].filter(Boolean);
};

// `word` and `tip`: a word on an on row (Sync can't run) and what the word means; `lit`: the icon of the tool the keyboard's ring is on.
export const computerRow = ({ name, remote = true, state = 'on', status = 'blocked', count = 0, hover = false, focus = false, pending = false, word = null, tip = null, sync = null, lit = null }) => {
  const said = words[state] ?? word;
  const { action, actions } = toolsOf({ name, remote, state, pending, sync });
  const ring = (tool) => (tool?.icon === lit ? { ...tool, focus: true } : tool);
  return row({
    icon: remote ? 'lu-server' : 'lu-monitor', name, heading: true, group: true, names: true, hover, focus, pending,
    mark: count && state === 'on' ? status : 'none', meta: said ? { text: said, tip } : count || null,
    action: action && { kind: 'icon', ...ring(action) }, actions: actions.map(ring),
  });
};

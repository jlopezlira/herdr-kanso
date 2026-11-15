// Pages whose story is built from Storybook controls instead of drawn states.
import sprite from '../proto-sprite.svg?raw';
import { asleep, computerRow, computerStates, header, projectRow, section, sessionRow, sidebarFooter, tile, toolbar, views, viewSwitch } from './compositions.js';
import { avatar, avatarSizes, button, card, chip, code, dawn, dialog, escape, input, kinds, levels, mark, markdown, marks, markSizes, menu, metric, row, rowDepths, sides, skeletonOf, skeletonShapes, tabs, thumbnail, toast, toggle, tooltip, windowControls } from './pieces.js';
import { sampleSidebar } from './samples.js';

const icons = ['none', ...[...sprite.matchAll(/id="(lu-[^"]+)"/g)].map(([, id]) => id).sort()];
const frame = (markup) => `<div class="kanso-story"><div class="kanso-story__theme kanso-story__frame kanso-story--free">${markup}</div></div>`;

const select = (name, options) => ({ name, control: { type: 'select' }, options });


export const playgrounds = {
  'Primitives/Button': {
    args: { label: 'Create', kind: 'solid', size: 'md', icon: 'none', disabled: false, armed: false, verb: '', active: false, spin: false },
    argTypes: {
      label: { name: 'label', control: { type: 'text' } },
      kind: select('kind', Object.keys(kinds)),
      size: select('size', ['sm', 'md', 'lg']),
      icon: select('icon', icons),
      disabled: { name: 'disabled', control: { type: 'boolean' } },
      armed: { name: 'armed', control: { type: 'boolean' } },
      verb: { name: 'verb', control: { type: 'text' }, if: { arg: 'armed' } },
      active: { name: 'active', control: { type: 'boolean' } },
      spin: { name: 'spin', control: { type: 'boolean' } },
    },
    markup: button,
  },
  'Primitives/Avatar': {
    args: { initial: 'S', image: '', size: 'md', tone: '' },
    argTypes: {
      initial: { name: 'Initial', control: { type: 'text' } },
      image: { name: 'Image URL', control: { type: 'text' } },
      size: select('Size', Object.keys(avatarSizes)),
      tone: select('Tone', ['', 'teal', 'yellow', 'blue', 'violet', 'green', 'red']),
    },
    markup: avatar,
  },
  'Primitives/Chip': {
    args: { label: '3 files', quiet: false },
    argTypes: { label: { name: 'Label', control: { type: 'text' } }, quiet: { name: 'quiet', control: { type: 'boolean' } } },
    markup: chip,
  },
  'Primitives/Code': {
    args: { text: 'export function bucket(customer) {\n  const plan = planOf(customer);\n  return { plan, tokens: LIMIT[plan] };\n}', kind: 'source', first: 11, line: 12 },
    argTypes: {
      text: { name: 'Code', control: { type: 'text' } },
      kind: select('Kind', ['source', 'diff', 'snippet', 'log']),
      first: { name: 'First line', control: { type: 'number', min: 1 } },
      line: { name: 'Highlighted line', control: { type: 'number', min: 0 } },
    },
    markup: (args) => `<div class="kanso-panel">${code(args)}</div>`,
  },
  'Primitives/Dialog': {
    args: { title: 'Rename checkout', scope: '', value: 'checkout', placeholder: 'Name', loading: false, note: '', tone: 'dim', primary: 'Rename', state: 'default', secondary: 'Cancel' },
    argTypes: {
      title: { name: 'Title', control: { type: 'text' } },
      scope: { name: 'Scope', control: { type: 'text' } },
      value: { name: 'Value', control: { type: 'text' } },
      placeholder: { name: 'Placeholder', control: { type: 'text' } },
      loading: { name: 'Content loading', control: { type: 'boolean' } },
      note: { name: 'Note', control: { type: 'text' } },
      tone: select('Note tone', ['dim', 'muted', 'error']),
      primary: { name: 'Primary', control: { type: 'text' } },
      state: { ...select('Primary state', ['default', 'disabled', 'loading', 'armed']), if: { arg: 'loading', truthy: false } },
      secondary: { name: 'Secondary', control: { type: 'text' } },
    },
    markup: dialog,
  },
  'Primitives/Drag handle': {
    args: { state: 'default' },
    argTypes: { state: select('State', ['default', 'hover']) },
    markup: ({ state }) => `<svg class="kanso-icon kanso-icon--row kanso-grip${state === 'default' ? '' : ' kanso-text--fg'}"><title>Hold and drag onto another pane to move this one there</title><use href="#lu-grip-vertical"/></svg>`,
  },
  'Primitives/Field': {
    args: { text: '', label: 'Comment', icon: 'lu-send', error: false, disabled: false, multiline: false, inline: false, selected: false, loading: false, limit: 80 },
    argTypes: {
      text: { name: 'text', control: { type: 'text' } },
      label: { name: 'label', control: { type: 'text' } },
      icon: select('icon', icons),
      error: { name: 'error', control: { type: 'boolean' } },
      disabled: { name: 'disabled', control: { type: 'boolean' } },
      multiline: { name: 'multiline', control: { type: 'boolean' } },
      inline: { name: 'inline', control: { type: 'boolean' } },
      selected: { name: 'selected', control: { type: 'boolean' } },
      loading: { name: 'loading', control: { type: 'boolean' } },
      limit: { name: 'limit', control: { type: 'number', min: 1 } },
    },
    markup: input,
  },
  'Primitives/Key hint': {
    args: { text: '⌘↵', faint: false, recording: false },
    argTypes: {
      text: { name: 'text', control: { type: 'text', maxLength: 6 } },
      faint: { name: 'faint', control: { type: 'boolean' } },
      recording: { name: 'recording', control: { type: 'boolean' } },
    },
    markup: ({ text, faint, recording }) => `<span class="kanso-key${faint ? ' kanso-text--dim' : ''}${recording ? ' kanso-key--recording kanso-ring--accent kanso-text--accent' : ''}">${escape(text.slice(0, 6))}</span>`,
  },
  'Primitives/Mark': {
    args: { status: 'working', size: 'md' },
    argTypes: {
      status: select('status', Object.keys(marks)),
      size: select('size', Object.keys(markSizes)),
    },
    markup: mark,
  },
  'Primitives/Markdown': {
    args: { source: '# Rate limits\n\nEach customer gets a bucket of requests. A request takes one token; the bucket refills one token every 2 s.\n\n| Plan | Per minute | Burst |\n| --- | --- | --- |\n| Free | 40 | 10 |\n| Pro | 400 | 60 |\n\n## Retry-After\n\nAn empty bucket answers `429` with `Retry-After` in seconds.', block: 3, state: 'hover' },
    argTypes: {
      source: { name: 'Markdown', control: { type: 'text' } },
      state: select('Block state', ['rest', 'hover', 'editing']),
      block: { name: 'Block', control: { type: 'number', min: 1 }, if: { arg: 'state', neq: 'rest' } },
    },
    markup: (args) => `<div class="kanso-panel">${markdown(args)}</div>`,
  },
  'Primitives/Menu': {
    args: {
      title: 'src/api/checkout.ts',
      items: [
        { label: 'Open the diff', icon: 'lu-git-pull-request' },
        { label: 'Open', icon: 'lu-file', hint: '↵', selected: true },
        { separator: true },
        { label: 'Hide this section', icon: 'lu-eye-off' },
        { label: 'Delete worktree', icon: 'lu-x', verb: 'delete', armed: false },
      ],
    },
    argTypes: {
      title: { name: 'title', control: { type: 'text' } },
      items: { name: 'items', control: { type: 'object' }, description: '{ label, icon, hint, badge, verb, armed, selected } or { separator: true }' },
    },
    markup: menu,
  },
  'Primitives/Metric': {
    args: { value: '31%', unit: 'free of 16 GB · 2.4 GB swap', facts: '14 tasks | $2.94 a task | 9.1M tokens', loading: false },
    argTypes: {
      value: { name: 'Value', control: { type: 'text' } },
      unit: { name: 'Unit', control: { type: 'text' } },
      facts: { name: 'Facts (separated by |)', control: { type: 'text' } },
      loading: { name: 'Loading', control: { type: 'boolean' } },
    },
    markup: metric,
  },
  'Primitives/Window controls': { args: {}, argTypes: {}, markup: windowControls },
  'Primitives/Dawn': { args: {}, argTypes: {}, markup: () => dawn() },
  'Compositions/Toolbar': {
    args: { column: false, open: false },
    argTypes: { column: { name: 'column', control: { type: 'boolean' } }, open: { name: 'open', control: { type: 'boolean' }, if: { arg: 'column' } } },
    markup: toolbar,
  },
  'Compositions/Header': {
    args: { collapsed: false, dawn: false },
    argTypes: { collapsed: { name: 'collapsed', control: { type: 'boolean' } }, dawn: { name: 'Dawn Mode', control: { type: 'boolean' } } },
    markup: header,
  },
  'Compositions/Sidebar/Session row': {
    args: { program: 'p-claude', name: 'Atlas', activity: 'Reviewing step 01', time: '3m', place: '', status: 'working', depth: 1, current: false, pinned: false, commands: 0, hover: false, focus: false, dimmed: false },
    argTypes: {
      program: select('program', ['p-claude', 'p-codex', 'lu-terminal']),
      name: { name: 'name', control: { type: 'text' } },
      activity: { name: 'activity', control: { type: 'text' } },
      time: { name: 'time', control: { type: 'text' } },
      place: { name: 'project', control: { type: 'text' } },
      status: select('mark', ['none', 'working', 'blocked', 'done', 'idle']),
      depth: { name: 'depth', control: { type: 'inline-radio' }, options: [0, 1, 2] },
      current: { name: 'current', control: { type: 'boolean' } },
      pinned: { name: 'pinned', control: { type: 'boolean' } },
      commands: { name: 'commands', control: { type: 'number', min: 0 } },
      hover: { name: 'hover', control: { type: 'boolean' } },
      focus: { name: 'focus', control: { type: 'boolean' } },
      dimmed: { name: 'dimmed', control: { type: 'boolean' } },
    },
    markup: (args) => `<div class="kanso-sidebar">${sessionRow(args)}</div>`,
  },
  'Compositions/Sidebar/Project row': {
    args: { name: 'kansō', folder: 'herdr-kanso', branch: 'main', sync: '↓12', open: false, status: 'blocked', count: 0, hover: false, focus: false },
    argTypes: {
      name: { name: 'name', control: { type: 'text' } },
      folder: { name: 'folder', control: { type: 'text' } },
      branch: { name: 'branch', control: { type: 'text' } },
      sync: { name: 'sync', control: { type: 'text' } },
      open: { name: 'open', control: { type: 'boolean' } },
      count: { name: 'folded count', control: { type: 'number', min: 0 } },
      status: { ...select('mark', ['blocked', 'working', 'done', 'idle']), if: { arg: 'count' } },
      hover: { name: 'hover', control: { type: 'boolean' } },
      focus: { name: 'focus', control: { type: 'boolean' } },
    },
    markup: (args) => `<div class="kanso-sidebar">${projectRow(args)}</div>`,
  },
  'Compositions/Sidebar/Computer row': {
    args: { name: 'dark', remote: true, state: 'on', status: 'blocked', count: 0, hover: false, focus: false },
    argTypes: {
      name: { name: 'name', control: { type: 'text' } },
      remote: { name: 'remote', control: { type: 'boolean' } },
      state: select('state', computerStates),
      count: { name: 'folded count', control: { type: 'number', min: 0 } },
      status: { ...select('mark', ['blocked', 'working', 'done', 'idle']), if: { arg: 'count' } },
      hover: { name: 'hover', control: { type: 'boolean' } },
      focus: { name: 'focus', control: { type: 'boolean' } },
    },
    markup: (args) => `<div class="kanso-sidebar">${computerRow(args)}</div>`,
  },
  'Compositions/Sidebar/Asleep': {
    args: { names: ['site', 'dojo'], open: false },
    argTypes: { names: { name: 'names', control: { type: 'object' } }, open: { name: 'open', control: { type: 'boolean' } } },
    markup: (args) => `<div class="kanso-sidebar">${asleep(args)}</div>`,
  },
  'Compositions/Sidebar/Section': {
    args: { title: 'Needs you', status: 'blocked', count: 0 },
    argTypes: { title: { name: 'title', control: { type: 'text' } }, status: select('mark', ['none', 'blocked']), count: { name: 'count', control: { type: 'number', min: 0 } } },
    markup: (args) => `<div class="kanso-sidebar">${section(args)}</div>`,
  },
  'Compositions/Sidebar/View switch': {
    args: { view: 'spaces', column: false },
    argTypes: { view: { name: 'view', control: { type: 'inline-radio' }, options: views.map((item) => item.key) }, column: { name: 'column', control: { type: 'boolean' } } },
    markup: (args) => `<div class="${args.column ? 'kanso-rail' : 'kanso-sidebar'}">${viewSwitch(args)}</div>`,
  },
  'Compositions/Sidebar/Tile': {
    args: { initial: 'A', tone: 'teal', status: 'blocked', count: 4, open: false },
    argTypes: {
      initial: { name: 'initial', control: { type: 'text' } },
      tone: select('tone', ['', 'teal', 'yellow', 'blue', 'violet', 'green', 'red']),
      status: select('mark', ['none', 'blocked', 'working', 'done', 'idle']),
      count: { name: 'count', control: { type: 'number', min: 0 } },
      open: { name: 'open', control: { type: 'boolean' } },
    },
    markup: (args) => `<div class="kanso-rail">${tile(args)}</div>`,
  },
  'Compositions/Sidebar/Footer': {
    args: { update: '' },
    argTypes: { update: { name: 'update', control: { type: 'text' } } },
    markup: (args) => `<div class="kanso-sidebar">${sidebarFooter(args)}</div>`,
  },
  'Compositions/Sidebar': {
    args: { collapsed: false, dawn: false, view: 'spaces', switcher: true, menu: false },
    argTypes: {
      collapsed: { name: 'collapsed', control: { type: 'boolean' } },
      dawn: { name: 'Dawn Mode', control: { type: 'boolean' } },
      switcher: { name: 'view switch', control: { type: 'boolean' } },
      view: { name: 'view', control: { type: 'inline-radio' }, options: views.map((item) => item.key) },
      menu: { name: 'views menu', control: { type: 'boolean' }, if: { arg: 'collapsed' } },
    },
    markup: sampleSidebar,
  },
  'Primitives/Switch': {
    args: { checked: false, label: 'Toggle', disabled: false },
    argTypes: {
      checked: { name: 'checked', control: { type: 'boolean' } },
      label: { name: 'label', control: { type: 'text' } },
      disabled: { name: 'disabled', control: { type: 'boolean' } },
    },
    markup: toggle,
  },
  'Primitives/Row': {
    args: { icon: 'lu-file', name: 'checkout.ts', detail: 'src/api', meta: '+14 −3', mark: 'none', second: '', heading: false, depth: 0, tools: false, current: false, selected: false, hover: false, focus: false, dimmed: false, pending: false },
    argTypes: {
      icon: select('icon', icons.concat(['p-claude', 'p-codex'])),
      name: { name: 'name', control: { type: 'text' } },
      detail: { name: 'detail', control: { type: 'text' } },
      meta: { name: 'meta', control: { type: 'text' } },
      mark: select('mark', ['none', ...Object.keys(marks)]),
      second: { name: 'second', control: { type: 'text' } },
      heading: { name: 'heading', control: { type: 'boolean' } },
      depth: { name: 'depth', control: { type: 'inline-radio' }, options: rowDepths },
      tools: { name: 'tools on hover', control: { type: 'boolean' } },
      current: { name: 'current', control: { type: 'boolean' } },
      selected: { name: 'selected', control: { type: 'boolean' } },
      hover: { name: 'hover', control: { type: 'boolean' } },
      focus: { name: 'focus', control: { type: 'boolean' } },
      dimmed: { name: 'dimmed', control: { type: 'boolean' } },
      pending: { name: 'pending', control: { type: 'boolean' } },
    },
    markup: ({ tools, ...args }) => `<div class="kanso-panel">${row({ ...args, actions: tools ? [{ icon: 'lu-pin', label: 'Pin' }, { icon: 'lu-ellipsis', label: 'More' }] : [] })}</div>`,
  },
  'Primitives/Skeleton': {
    args: { shape: 'row', count: 3 },
    argTypes: {
      shape: select('shape', Object.keys(skeletonShapes)),
      count: { name: 'count', control: { type: 'range', min: 1, max: 6 }, if: { arg: 'shape', neq: 'header' } },
    },
    markup: (args) => `<div class="kanso-panel">${skeletonOf(args)}</div>`,
  },
  'Primitives/Tab': {
    args: {
      items: [
        { key: 'spaces', label: 'Projects', icon: 'lu-folder', tip: 'Projects ⌃1' },
        { key: 'agents', label: 'Status', icon: 'lu-activity', dot: true, tip: 'Status ⌃2' },
        { key: 'threads', label: 'Threads', icon: 'lu-message-square', tip: 'Threads ⌃3' },
      ],
      value: 'spaces',
      size: 'md',
      track: false,
      disabled: false,
      icon: true,
      label: true,
    },
    argTypes: {
      items: { name: 'items', control: { type: 'object' }, description: '{ key, label, icon, mark, dot, tip, closable, armed }' },
      value: { name: 'value', control: { type: 'text' } },
      size: select('size', ['sm', 'md', 'lg']),
      track: { name: 'track', control: { type: 'boolean' } },
      disabled: { name: 'disabled', control: { type: 'boolean' } },
      icon: { name: 'icon', control: { type: 'boolean' } },
      label: { name: 'label', control: { type: 'boolean' } },
    },
    markup: tabs,
  },
  'Primitives/Thumbnail': {
    args: { image: 'https://images.placeholders.dev/120x80', label: 'cart-countdown.png', selected: false, loading: false },
    argTypes: {
      image: { name: 'image', control: { type: 'text' } },
      label: { name: 'label', control: { type: 'text' } },
      selected: { name: 'selected', control: { type: 'boolean' } },
      loading: { name: 'loading', control: { type: 'boolean' } },
    },
    markup: thumbnail,
  },
  'Primitives/Toast': {
    args: { level: 'error', icon: 'none', title: "Can't reach devbox", body: '', action: 'Refresh', explain: '' },
    argTypes: {
      level: select('level', Object.keys(levels)),
      icon: { ...select('icon', icons), description: "Any icon; it takes the level's colour" },
      title: { name: 'title', control: { type: 'text' } },
      body: { name: 'body', control: { type: 'text' } },
      action: { name: 'action', control: { type: 'text' } },
      explain: { name: 'explain', control: { type: 'text' }, description: 'The session an error can be explained to' },
    },
    markup: toast,
  },
  'Primitives/Tooltip': {
    args: { text: 'Adding up', detail: '14 repositories to go', key: '', icon: 'lu-refresh-cw', side: 'auto', open: true },
    argTypes: {
      text: { name: 'text', control: { type: 'text' } },
      detail: { name: 'detail', control: { type: 'text' } },
      key: { name: 'key', control: { type: 'text', maxLength: 6 } },
      icon: { ...select('icon', icons.filter((id) => id !== 'none')), description: 'The unnamed control it names' },
      side: { ...select('side', sides), description: 'Auto: the side with the most room around the control' },
      open: { name: 'open', control: { type: 'boolean' }, description: 'Off: shown on hover and keyboard focus' },
    },
    markup: tooltip,
  },
  'Primitives/Card': {
    args: { author: 'sam', image: '', age: '1h', body: 'Batches of 50, flushed every 2 s.', loading: false },
    argTypes: {
      author: { name: 'Author', control: { type: 'text' } },
      image: { name: 'Image URL', control: { type: 'text' } },
      age: { name: 'Age', control: { type: 'text' } },
      body: { name: 'Body', control: { type: 'text' } },
      loading: { name: 'Loading', control: { type: 'boolean' } },
    },
    markup: (args) => `<div class="kanso-panel">${card(args)}</div>`,
  },
};

export const playgroundStory = ({ args, argTypes, markup }) => ({
  name: 'Variants',
  args,
  argTypes,
  render: (values) => frame(markup(values)),
  parameters: { docs: { source: { type: 'dynamic', transform: (_code, context) => markup(context.args) } } },
});

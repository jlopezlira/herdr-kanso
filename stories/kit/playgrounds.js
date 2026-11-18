// Pages whose story is built from Storybook controls instead of drawn states.
import sprite from '../proto-sprite.svg?raw';
import { activityMenu, paneFolds, paneHeader, panelHeaderForms, panelLooks, paneReaches, paneStates, noticeHomes, noticePlaces, noticeStates, systemMessage, toastStack, heldChord, keyboard, keyboardExplorer, keyboards, keyboardSystems, keyNames, shortcutRowStates, channelSettings, channels, failureMenu, panelDoors, tabBarStates } from './compositions.js';
import { activity, awayMax } from './activity.js';
import { sidebarFooter } from './sidebar-footer.js';
import { tile } from './tile.js';
import { views, viewSwitch } from './view-switch.js';
import { projectRow } from './project-row.js';
import { computerRow, computerStates } from './computer-row.js';
import { section } from './section.js';
import { asleep } from './asleep.js';
import { sessionRow } from './session-row.js';
import { computerItem, computerItemStates } from './status-bar.js';
import { avatar, avatarSizes, button, card, chip, code, dawn, dialog, emptyState, escape, failureBlock, input, keycapStates, keyHint, kinds, levels, mark, markdown, marks, markSizes, menu, metric, row, rowDepths, sides, skeletonOf, skeletonShapes, stack, statePatterns, tabs, thumbnail, toast, toggle, tooltip, windowControls } from './pieces.js';
import { barWidths, inBar } from './frames.js';
import { edgeSides, layerDefaults, memoryShown, needsShown, panelContents, panelReads, panelRowLooks, statedPages, stepperShown, tabActs } from './states.js';
import { appNotices, awayEvents, keyLayer, keyLayerMods, pullRequest, sampleDojo, sampleHeader, sampleNotices, samplePanelHeader, sampleRefusal, sampleSettingsMenu, sampleSidebar, sessionCommandsTip, sessionTools, statusMenus, unreachable } from './samples.js';

const icons = ['none', ...[...sprite.matchAll(/id="(lu-[^"]+)"/g)].map(([, id]) => id).sort()];
const frame = (markup) => `<div class="kanso-story"><div class="kanso-story__theme kanso-story__frame kanso-story--free">${markup}</div></div>`;

const inSidebar = (markup) => stack({ variant: 'sidebar frame' }, markup), inRail = (markup) => stack({ variant: 'rail frame' }, markup);
const select = (name, options) => ({ name, control: { type: 'select' }, options });
const boolArg = (name, more) => ({ name, control: { type: 'boolean' }, ...more });
const flags = (...names) => Object.fromEntries(names.map((name) => [name, boolArg(name)]));
const textArg = (name, more) => ({ name, control: { type: 'text' }, ...more });
const numberArg = (name, min, more) => ({ name, control: { type: 'number', min }, ...more });
const foldedArgs = { count: numberArg('folded count', 0), status: { ...select('mark', ['blocked', 'working', 'done', 'idle']), if: { arg: 'count' } } };
const agentArgs = { program: select('program', ['p-claude', 'p-codex', 'lu-terminal']), name: textArg('name') };
const computerArgs = { name: textArg('name'), remote: boolArg('remote') };
const radioArg = (name, options, more) => ({ name, control: { type: 'inline-radio' }, options, ...more });

// One layer control per computer, each labelled the way that computer writes its modifiers.
const pickable = keyNames().filter((key) => !['ctrl', 'alt', 'shift', 'cmd'].includes(key));
const layerArgs = Object.fromEntries(keyboardSystems.map((os) => [`${os}Layer`, { name: 'layer', control: { type: 'select', labels: Object.fromEntries(keyLayerMods[os].map((mods) => [mods, mods === 'lists' ? 'Lists' : heldChord({ os, held: mods.split(' ') })])) }, options: keyLayerMods[os], if: { arg: 'os', eq: os } }]));
const osArg = radioArg('computer', keyboardSystems);

export const playgrounds = {
  'Primitives/Button': {
    args: { label: 'Create', kind: 'solid', size: 'md', icon: 'none', disabled: false, armed: false, verb: '', active: false, spin: false, face: false, truncate: false },
    argTypes: {
      label: textArg('label'),
      kind: select('kind', Object.keys(kinds)),
      size: select('size', ['sm', 'md', 'lg']),
      icon: select('icon', icons),
      ...flags('disabled', 'armed'),
      verb: textArg('verb', { if: { arg: 'armed' } }),
      ...flags('active', 'spin'),
      face: boolArg('Drawn face (content)'),
      // Proposed: a long label trimmed at the button's widest, as the Spend menus show a long project.
      truncate: boolArg('Trimmed label'),
    },
    // Proposed: a face the caller draws, such as a pet's picture and name in the dōjō or a panel's key tile in Settings; the label is what it says.
    markup: ({ face, ...args }) => button({ ...args, content: face ? `${mark({ status: 'idle' })}<span class="kanso-content__text">${escape(args.label)}</span><span class="kanso-content__secondary">Kanso</span>` : '' }),
  },
  'Primitives/Avatar': {
    args: { initial: 'S', image: '', size: 'md', tone: '' },
    argTypes: {
      initial: textArg('Initial'),
      image: textArg('Image URL'),
      size: select('Size', Object.keys(avatarSizes)),
      tone: select('Tone', ['', 'teal', 'yellow', 'blue', 'violet', 'green', 'red']),
    },
    markup: avatar,
  },
  'Primitives/Chip': {
    args: { label: '3 files', quiet: false },
    argTypes: { label: textArg('Label'), quiet: boolArg('quiet') },
    markup: chip,
  },
  'Primitives/Code': {
    args: { text: 'export function bucket(customer) {\n  const plan = planOf(customer);\n  return { plan, tokens: LIMIT[plan] };\n}', kind: 'source', first: 11, line: 12 },
    argTypes: {
      text: textArg('Code'),
      kind: select('Kind', ['source', 'diff', 'snippet', 'log']),
      first: numberArg('First line', 1),
      line: numberArg('Highlighted line', 0),
    },
    markup: (args) => `<div class="kanso-panel">${code(args)}</div>`,
  },
  'Primitives/Dialog': {
    args: { title: 'Rename checkout', scope: '', value: 'checkout', placeholder: 'Name', loading: false, note: '', tone: 'dim', primary: 'Rename', state: 'default', secondary: 'Cancel' },
    argTypes: {
      title: textArg('Title'),
      scope: textArg('Scope'),
      value: textArg('Value'),
      placeholder: textArg('Placeholder'),
      loading: boolArg('Content loading'),
      note: textArg('Note'),
      tone: select('Note tone', ['dim', 'muted', 'error']),
      primary: textArg('Primary'),
      state: { ...select('Primary state', ['default', 'disabled', 'loading', 'armed']), if: { arg: 'loading', truthy: false } },
      secondary: textArg('Secondary'),
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
      text: textArg('text'),
      label: textArg('label'),
      icon: select('icon', icons),
      ...flags('error', 'disabled', 'multiline', 'inline', 'selected', 'loading'),
      limit: numberArg('limit', 1),
    },
    markup: input,
  },
  'Primitives/Key hint': {
    args: { text: '⌘↵', faint: false, recording: false },
    argTypes: {
      text: { name: 'text', control: { type: 'text', maxLength: 6 } },
      ...flags('faint', 'recording'),
    },
    markup: ({ text, faint, recording }) => keyHint({ text: text.slice(0, 6), faint, recording }),
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
      source: textArg('Markdown'),
      state: select('Block state', ['rest', 'hover', 'editing']),
      block: numberArg('Block', 1, { if: { arg: 'state', neq: 'rest' } }),
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
      title: textArg('title'),
      items: { name: 'items', control: { type: 'object' }, description: '{ label, icon, hint, badge, verb, armed, selected } or { separator: true }' },
    },
    markup: menu,
  },
  'Primitives/Metric': {
    args: { value: '31%', unit: 'free of 16 GB · 2.4 GB swap', facts: '14 tasks | $2.94 a task | 9.1M tokens', loading: false },
    argTypes: {
      value: textArg('Value'),
      unit: textArg('Unit'),
      facts: textArg('Facts (separated by |)'),
      loading: boolArg('Loading'),
    },
    markup: (args) => `<div class="kanso-panel">${metric(args)}</div>`,
  },
  'Primitives/Window controls': { args: {}, argTypes: {}, markup: windowControls },
  'Primitives/Dawn': { args: {}, argTypes: {}, markup: () => dawn() },
  'Compositions/Toolbar': {
    ...statedPages['Compositions/Toolbar'],
    argTypes: {
      view: radioArg('view', views.map((item) => item.key)),
      column: boolArg('collapsed'),
      open: boolArg('tools open', { if: { arg: 'column' } }),
      sorted: boolArg('sorted'),
      order: textArg('order in use'),
      menu: boolArg('Sort menu'),
      add: boolArg('+ menu'),
    },
  },
  'Compositions/Header': {
    args: { collapsed: false, dawn: false, art: true, title: true },
    argTypes: { collapsed: boolArg('collapsed'), dawn: boolArg('Dawn Mode'),
      art: boolArg('Dawn sky', { if: { arg: 'dawn' } }), title: boolArg('lights row') },
    markup: sampleHeader,
  },
  'Compositions/Dawn Mode': {
    args: { channel: 'dawn', art: true, collapsed: false },
    argTypes: {
      channel: radioArg('channel', channels.map((item) => item.key)),
      art: boolArg('Dawn sky', { if: { arg: 'channel', eq: 'dawn' } }),
      collapsed: boolArg('collapsed'),
    },
    markup: ({ channel, art, collapsed }) => `<p class="kanso-story__caption">Sidebar header</p>${sampleHeader({ collapsed, dawn: channel === 'dawn', art })}`
      + `<p class="kanso-story__caption">Settings · Updates</p><div class="kanso-story__slice kanso-story__settings">${channelSettings({ channel, art })}</div>`,
  },
  'Compositions/Notifications': {
    args: { example: 'your own', state: 'failed', home: 'agent', text: 'Can\'t reach devbox', act: 'Refresh', detail: 'ssh: connect to host devbox port 22: Connection refused', place: 'window on screen', stacked: 1 },
    argTypes: {
      example: select('a notice the app sends', ['your own', ...Object.keys(appNotices)]),
      state: { ...select('state', noticeStates), if: { arg: 'example', eq: 'your own' } },
      home: { ...select('home', noticeHomes), if: { arg: 'example', eq: 'your own' } },
      text: textArg('sentence', { if: { arg: 'example', eq: 'your own' } }),
      act: textArg('word to act', { if: { arg: 'example', eq: 'your own' } }),
      detail: textArg('detail', { if: { arg: 'example', eq: 'your own' } }),
      place: radioArg('where you are', noticePlaces),
      stacked: radioArg('on screen', [1, 2, 3], { if: { arg: 'place', eq: 'window on screen' } }),
    },
    markup: ({ example, stacked, place, act, detail, ...args }) => {
      const item = example === 'your own' ? { ...args, act: act || null, detail: detail || null, place } : { act: null, detail: null, ...appNotices[example], place };
      const sent = systemMessage(item);
      if (sent) return `<p class="kanso-story__caption">Sent to the computer's notifications</p><p class="kanso-story__caption">Title: ${escape(sent.title)}</p>${sent.body ? `<p class="kanso-story__caption">Text: ${escape(sent.body)}</p>` : ''}`;
      if (place !== 'window on screen') return '<p class="kanso-story__caption">Not sent: its home is on screen.</p>';
      return toastStack({ notices: [...sampleNotices, item].slice(-stacked) });
    },
  },
  'Compositions/Pane header': {
    args: { program: 'p-claude', name: 'checkout', state: 'working', focused: true, keyboard: false, hover: false, menu: false, pinned: false, zoomed: false, reach: 'here', held: false, armed: false, renaming: false,
      elsewhere: false, files: 3, commits: 2, pr: 'test / unit failed', github: true, fold: 0 },
    argTypes: {
      ...agentArgs,
      state: select('state', paneStates),
      focused: boolArg('focused'),
      keyboard: boolArg('focus from the keyboard'),
      hover: boolArg('pointer on it'),
      menu: boolArg('⋯ open'),
      pinned: boolArg('pinned'),
      zoomed: boolArg('zoomed', { if: { arg: 'menu' } }),
      reach: radioArg('computer', paneReaches),
      held: boolArg('held to move'),
      armed: boolArg('close armed', { if: { arg: 'hover' } }),
      renaming: boolArg('renaming'),
      elsewhere: boolArg('folder differs from the tab'),
      files: numberArg('files changed', 0),
      commits: numberArg('commits not on GitHub', 0),
      pr: { name: 'pull request', control: { type: 'select' }, options: ['none', 'ready', 'checks running', 'test / unit failed', 'changes requested', 'conflicts with main', 'behind main'] },
      github: boolArg('GitHub answers', { if: { arg: 'pr', neq: 'none' } }),
      fold: { name: 'folded', control: { type: 'select', labels: Object.fromEntries(paneFolds.map((label, step) => [step, label])) }, options: paneFolds.map((_, step) => step) },
    },
    markup: ({ files, commits, pr, github, elsewhere, ...args }) => {
      const tone = { ready: 'done', 'checks running': 'working', 'behind main': 'working' }[pr] ?? 'blocked';
      const digest = { files, add: files * 14, del: files * 2, commits, pr: pr === 'none' ? null : { number: pullRequest(142), verdict: pr, tone }, failure: github ? null : 'gh: HTTP 502: Bad Gateway (https://api.github.com/graphql)' };
      const place = elsewhere ? { folder: args.reach === 'here' ? 'checkout-v2' : '~/checkout-v2', branch: 'limits-table' } : null;
      return `<div class="kanso-pane kanso-story__pane">${paneHeader({ ...args, digest, place })}</div>`;
    },
  },
  'Compositions/Keyboard/Key': {
    ...statedPages['Compositions/Keyboard/Key'],
    argTypes: {
      label: { name: 'label', control: { type: 'text', maxLength: 3 } },
      units: radioArg('width in keys', [...new Set(Object.values(keyboards).flatMap(({ rows }) => rows.flat().map(([, units = 1]) => units)))].sort((a, b) => a - b)),
      state: select('state', keycapStates),
      hover: boolArg('hover'),
      hint: boolArg('next key'),
      corner: { name: 'corner glyph', control: { type: 'text', maxLength: 2 } },
      finger: { name: 'finger', control: { type: 'text', maxLength: 8 } },
    },
  },
  'Compositions/Keyboard/Picked key': {
    ...statedPages['Compositions/Keyboard/Picked key'],
    argTypes: { os: osArg, ...layerArgs, key: select('key', pickable) },
  },
  'Compositions/Keyboard/Shortcut row': {
    ...statedPages['Compositions/Keyboard/Shortcut row'],
    argTypes: {
      name: textArg('does'),
      chords: textArg('chords, comma between'),
      state: select('state', shortcutRowStates),
      hover: boolArg('hover'),
    },
  },
  'Compositions/Keyboard': {
    ...statedPages['Compositions/Keyboard'],
    argTypes: {
      os: osArg, ...layerArgs, key: select('picked', pickable), hover: select('hover', ['none', ...keyNames()]),
      level: { name: 'dōjō level', control: { type: 'range', min: 0, max: sampleDojo.levels.length, step: 1 } },
      pressed: select('pressed key', ['none', ...sampleDojo.keys]), next: select('next key', ['none', ...sampleDojo.keys]),
    },
  },
  'Compositions/Sidebar/Session row': {
    args: { program: 'p-claude', name: 'Atlas', activity: 'Reviewing step 01', time: '3m', place: '', status: 'working', depth: 1, current: false, pinned: false, commands: 0, hover: false, focus: false, dimmed: false, step: '', stuck: false, pinnable: true, menu: true, selected: false, settle: false, refresh: false, drop: 'none', guide: 'none' },
    argTypes: {
      ...agentArgs,
      activity: textArg('activity'),
      time: textArg('time'),
      place: textArg('project'),
      status: select('mark', ['none', 'working', 'blocked', 'done', 'idle']),
      depth: radioArg('depth', [0, 1, 2]),
      ...flags('current', 'pinned'),
      commands: numberArg('commands', 0),
      ...flags('hover', 'focus', 'dimmed'),
      step: textArg('step time'),
      stuck: boolArg('stuck'),
      pinnable: boolArg('pin tool'),
      menu: boolArg('More tool'),
      selected: boolArg('keyboard ring'),
      settle: boolArg('Settle tool'),
      refresh: boolArg('Refresh'),
      drop: select('drop line', ['none', 'before', 'after']),
      guide: select('guide', ['none', 'tee', 'end', 'pass']),
    },
    markup: ({ step, stuck, settle, drop, guide, ...args }) => inSidebar(sessionRow({ ...args, step: step ? { time: step, stuck } : null, tools: settle ? sessionTools : [],
      drop: drop === 'none' ? null : drop, guides: guide === 'none' ? [] : [null, guide], commandsTip: args.commands ? sessionCommandsTip : null, placeTip: args.place || null })),
  },
  'Compositions/Sidebar/Project row': {
    args: { name: 'kansō', folder: 'herdr-kanso', branch: 'main', sync: '↓12', open: false, status: 'blocked', count: 0, hover: false, focus: false, tree: 'none', dimmed: false, pending: false, missing: false, drop: 'none' },
    argTypes: {
      name: textArg('name'),
      folder: textArg('folder'),
      branch: textArg('branch'),
      sync: textArg('sync'),
      open: boolArg('open'),
      ...foldedArgs,
      ...flags('hover', 'focus'),
      tree: select('worktree guide', ['none', 'tee', 'end']),
      dimmed: boolArg('dimmed'),
      pending: boolArg('pulling'),
      missing: boolArg('folder not found'),
      drop: select('drop line', ['none', 'before', 'after']),
    },
    markup: ({ tree, drop, sync, ...args }) => inSidebar(projectRow({ ...args, tree: tree === 'none' ? null : tree, drop: drop === 'none' ? null : drop,
      sync: sync ? { text: sync, tip: 'Pull from origin/main', label: 'Pull' } : null })),
  },
  'Compositions/Sidebar/Computer row': {
    args: { name: 'dark', remote: true, state: 'on', status: 'blocked', count: 0, hover: false, focus: false, pending: false, word: '', sync: '', lit: '' },
    argTypes: {
      ...computerArgs,
      state: select('state', computerStates),
      ...foldedArgs,
      ...flags('hover', 'focus'),
      pending: boolArg('turning on'),
      word: textArg('word'),
      sync: textArg('sync on, its tip'),
      lit: select('keyboard on tool', ['', 'lu-power', 'lu-plus', 'lu-arrow-right-left', 'lu-refresh-cw', 'lu-key']),
    },
    markup: ({ word, sync, lit, ...args }) => inSidebar(computerRow({ ...args, word: word || null, sync: sync || null, lit: lit || null })),
  },
  'Compositions/Sidebar/Asleep': {
    args: { names: ['site', 'dojo'], open: false, title: 'Asleep', focus: false, selected: -1 },
    argTypes: { names: { name: 'names', control: { type: 'object' } }, open: boolArg('open'), title: textArg('title'), focus: boolArg('focus'), selected: numberArg('keyboard on row', -1) },
    markup: (args) => inSidebar(asleep(args)),
  },
  'Compositions/Sidebar/Section': {
    args: { title: 'Needs you', status: 'blocked', count: 0, add: '', hover: false, focus: false },
    argTypes: { title: textArg('title'), status: select('mark', ['none', 'blocked', 'asleep']), count: numberArg('count', 0), add: textArg('+ label'), ...flags('hover', 'focus') },
    markup: ({ add, ...args }) => inSidebar(section({ ...args, add: add || null })),
  },
  'Compositions/Sidebar/View switch': {
    args: { view: 'spaces', column: false, open: false, asks: false, carry: false },
    argTypes: { view: radioArg('view', views.map((item) => item.key)), column: boolArg('column'), open: boolArg('menu', { if: { arg: 'column' } }), asks: boolArg('someone needs you'), carry: boolArg('button carries the dot (Proposed)', { if: { arg: 'column' } }) },
    markup: (args) => (args.column ? inRail : inSidebar)(viewSwitch(args)),
  },
  'Compositions/Sidebar/Tile': {
    args: { initial: 'A', tone: 'teal', status: 'blocked', count: 4, open: false, label: 'kansō', icon: '', marked: false, strong: false },
    argTypes: {
      initial: textArg('initial'),
      tone: select('tone', ['', 'teal', 'yellow', 'blue', 'violet', 'green', 'red']),
      status: select('mark', ['none', 'blocked', 'working', 'done', 'idle', 'asleep']),
      count: numberArg('count', 0),
      open: boolArg('open'),
      label: textArg('label'),
      icon: select('icon', ['', 'lu-pin', 'lu-clock', 'lu-check', 'lu-layers', 'lu-message-square']),
      ...flags('marked', 'strong'),
    },
    markup: (args) => inRail(tile(args)),
  },
  'Compositions/Sidebar/Footer': {
    args: { update: '', busy: false, refused: false, menu: false, collapsed: false },
    argTypes: { update: textArg('update'), busy: boolArg('updating', { if: { arg: 'update' } }), refused: boolArg('refused', { if: { arg: 'update' } }),
      menu: boolArg('Settings menu'), collapsed: boolArg('collapsed') },
    markup: ({ update, refused, menu: open, collapsed, ...args }) => (collapsed ? inRail : inSidebar)(sidebarFooter({ ...args, collapsed, update: update || null,
      refused: refused ? sampleRefusal : null, menu: open ? sampleSettingsMenu() : null })),
  },
  'Compositions/Sidebar': {
    args: { collapsed: false, dawn: false, art: true, view: 'spaces', switcher: true, menu: false },
    argTypes: {
      collapsed: boolArg('collapsed'),
      dawn: boolArg('Dawn Mode'),
      art: boolArg('Dawn sky', { if: { arg: 'dawn' } }),
      switcher: boolArg('view switch'),
      view: radioArg('view', views.map((item) => item.key)),
      menu: boolArg('views menu', { if: { arg: 'collapsed' } }),
    },
    markup: sampleSidebar,
  },
  'Compositions/Panel': {
    ...statedPages['Compositions/Panel'],
    argTypes: {
      title: textArg('title'),
      scope: textArg('scope'),
      header: radioArg('header', panelHeaderForms),
      state: radioArg('read', Object.keys(panelReads)),
      look: radioArg('look', panelLooks),
      content: select('body', Object.keys(panelContents)),
      last: radioArg('the last row', Object.keys(panelRowLooks)),
    },
  },
  'Compositions/Panel/Header': {
    ...statedPages['Compositions/Panel/Header'],
    argTypes: {
      title: textArg('title'),
      form: radioArg('form', panelHeaderForms),
      start: radioArg('before the title', Object.keys(samplePanelHeader.starts)),
      second: textArg('second line'),
      tools: select('tools', Object.keys(samplePanelHeader.tools)),
    },
  },
  'Compositions/Status bar/Item': {
    ...statedPages['Compositions/Status bar/Item'],
    argTypes: {
      icon: select('icon', icons),
      mark: select('mark', ['none', 'working', 'blocked', 'done', 'idle']),
      text: textArg('text'),
      tone: select('tone', ['', 'working', 'blocked', 'done']),
      pending: boolArg('pending'),
    },
  },
  'Compositions/Status bar/Computer item': {
    ...statedPages['Compositions/Status bar/Computer item'],
    argTypes: {
      ...computerArgs,
      state: select('state', computerItemStates),
      folded: boolArg('folded'),
    },
  },
  'Compositions/Status bar/Needs you item': {
    ...statedPages['Compositions/Status bar/Needs you item'],
    argTypes: {
      name: textArg('name'),
      question: textArg('question'),
      more: numberArg('more waiting', 0),
    },
  },
  'Compositions/Status bar': {
    ...statedPages['Compositions/Status bar'],
    argTypes: {
      width: radioArg('width', barWidths),
      computer: select('computer', ['none', ...computerItemStates]),
      paused: boolArg('layout paused'),
      stepper: radioArg('panes per view', stepperShown, { if: { arg: 'paused', truthy: false } }),
      minimap: boolArg('minimap', { if: { arg: 'paused', truthy: false } }),
      needs: radioArg('needs you', Object.keys(needsShown)),
      memory: radioArg('memory low', Object.keys(memoryShown)),
      panels: boolArg('servers, containers, reviews'),
      open: { ...select('open', ['none', ...Object.keys(statusMenus)]), if: { arg: 'panels' } },
    },
  },
  'Compositions/Activity': {
    args: { events: 3, row: 'none', menu: false, docked: false },
    argTypes: {
      events: { name: 'events', control: { type: 'number', min: 0, max: 6 } },
      // Proposed: `more`, the keyboard on +N more.
      row: radioArg('second row', ['none', 'hover', 'focus', 'more']),
      menu: boolArg('right-click menu'),
      docked: boolArg('in the sidebar'),
    },
    markup: ({ events, row: state, menu: open, docked }) => {
      const card = activity({ events: awayEvents.slice(0, events), hover: state === 'hover' ? 1 : -1, focus: { focus: 1, more: awayMax }[state] ?? -1 }) ?? '';
      const menu = open && events ? activityMenu() : '';
      return docked ? sampleSidebar({ away: card }) + menu : `<div class="kanso-story__slice">${card}${menu}</div>`;
    },
  },
  'Compositions/State patterns': {
    args: { state: 'failure', menu: false },
    argTypes: {
      state: radioArg('state', statePatterns),
      menu: boolArg('right-click menu', { if: { arg: 'state', eq: 'failure' } }),
    },
    markup: ({ state, menu: open }) => {
      const at = (place, markup) => `<p class="kanso-story__caption">${place}</p>${markup}`;
      const slice = (...parts) => `<div class="kanso-story__slice">${parts.join('')}</div>`;
      const panel = (markup) => `<div class="kanso-panel kanso-story__panel">${markup}</div>`;
      const source = unreachable('dark');
      return {
        failure: () => at('Status bar', inBar(520, { left: [computerItem({ name: 'dark', state: 'unreachable', detail: source })] }))
          + at('Sidebar', slice(computerRow({ name: 'dark', state: 'unreachable' }), open ? failureMenu({ source, fixes: ['Refresh', 'Sign in…'], agent: 'Atlas' }) : ''))
          + at('Panel', panel(failureBlock({ text: "Can't list worktrees on dark", source: 'git worktree list: timed out after 30 s', fix: 'Refresh', agent: 'Atlas' })))
          + at('Toast', toast({ level: 'error', icon: 'none', title: "Couldn't pull checkout", action: 'Retry' })),
        empty: () => at('Panel', panel(emptyState({ icon: 'lu-git-pull-request', text: 'No pull requests on this branch', action: 'Create' }))),
        pending: () => at('Status bar', inBar(520, { left: [computerItem({ name: 'devbox', state: 'pending' })] }))
          + at('Sidebar', slice(row({ name: 'acme-shop', heading: true, detail: [{ icon: 'lu-git-branch', text: 'main' }, '↓0'], pending: true })))
          + at('Panel', panel(row({ name: 'Approved, with 2 line comments', meta: 'now', pending: true }))),
        loading: () => at('Sidebar', slice(skeletonOf({ shape: 'row', count: 3 }))) + at('Panel', panel(skeletonOf({ shape: 'list row', count: 3 }))),
      }[state]();
    },
  },
  'Compositions/Tab bar': {
    ...statedPages['Compositions/Tab bar'],
    argTypes: {
      width: radioArg('width', barWidths.slice(1)),
      value: radioArg('chosen tab', ['checkout', 'cart-ui', 'tests']),
      tab: select('a tab', Object.keys(tabActs)),
      panel: select('open door', ['none', ...panelDoors.map((item) => item.key)]),
      state: radioArg('computer', tabBarStates),
      folded: { name: 'folded tabs', control: { type: 'number', min: 0, max: 5 } },
      overflow: boolArg('folded menu open', { if: { arg: 'folded' } }),
      windows: boolArg('Windows and Linux'),
    },
  },
  'Compositions/Edges': {
    ...statedPages['Compositions/Edges'],
    argTypes: {
      side: radioArg('side', edgeSides),
      panes: { name: 'panes past the edge', control: { type: 'number', min: 1, max: 10 } },
      stacked: boolArg('first column stacked'),
      drop: boolArg('dragging over'),
      waiting: radioArg('Needs you hovered', ['none', 'nearest', 'farthest']),
      overflow: boolArg('folded menu open'),
    },
  },
  'Primitives/Switch': {
    args: { checked: false, label: 'Toggle', disabled: false },
    argTypes: {
      checked: boolArg('checked'),
      label: textArg('label'),
      disabled: boolArg('disabled'),
    },
    markup: toggle,
  },
  'Primitives/Row': {
    args: { icon: 'lu-file', name: 'checkout.ts', detail: 'src/api', meta: '+14 −3', mark: 'none', second: '', heading: false, title: false, depth: 0, tools: false, current: false, selected: false, hover: false, focus: false, dimmed: false, pending: false, wrap: false, drop: 'none', wash: 'none', guide: 'none' },
    argTypes: {
      icon: select('icon', icons.concat(['p-claude', 'p-codex'])),
      name: textArg('name'),
      detail: textArg('detail'),
      meta: textArg('meta'),
      mark: select('mark', ['none', ...Object.keys(marks)]),
      second: textArg('second'),
      heading: boolArg('heading'),
      title: boolArg('title form'),
      depth: radioArg('depth', rowDepths),
      tools: boolArg('tools on hover'),
      ...flags('current', 'selected', 'hover', 'focus', 'dimmed', 'pending'),
      // Proposed: the name wraps, as a pull request's review thread shows its comment.
      wrap: boolArg('wrapped name'),
      drop: select('drop line', ['none', 'before', 'after']),
      wash: select('wash', ['none', 'blocked']),
      guide: select('guide at depth 2', ['none', 'tee', 'end', 'pass']),
    },
    markup: ({ tools, drop, wash, guide, ...args }) => `<div class="kanso-panel">${row({ ...args, drop: drop === 'none' ? null : drop, wash: wash === 'none' ? null : wash, guides: guide === 'none' ? [] : [null, guide],
      actions: tools ? [{ icon: 'lu-pin', label: 'Pin' }, { icon: 'lu-ellipsis', label: 'More' }] : [] })}</div>`,
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
      value: textArg('value'),
      size: select('size', ['sm', 'md', 'lg']),
      ...flags('track', 'disabled', 'icon', 'label'),
    },
    markup: tabs,
  },
  'Primitives/Thumbnail': {
    args: { image: 'https://images.placeholders.dev/120x80', label: 'cart-countdown.png', selected: false, loading: false, color: '' },
    argTypes: {
      image: textArg('image'),
      label: textArg('label'),
      ...flags('selected', 'loading'),
      // Proposed: the picture's own colour, its ground until the picture is drawn, as Images shows a picture it has not copied.
      color: textArg('picture colour', { description: 'Proposed. A CSS colour, such as var(--working); seen with no image.' }),
    },
    markup: thumbnail,
  },
  'Primitives/Toast': {
    args: { level: 'error', icon: 'none', title: "Can't reach devbox", body: '', action: 'Refresh', explain: '' },
    argTypes: {
      level: select('level', Object.keys(levels)),
      icon: { ...select('icon', icons), description: "Any icon; it takes the level's colour" },
      title: textArg('title'),
      body: textArg('body'),
      action: textArg('action'),
      explain: textArg('explain', { description: 'The session an error can be explained to' }),
    },
    markup: toast,
  },
  'Primitives/Tooltip': {
    args: { label: 'Adding up', detail: '14 repositories to go', chord: '', icon: 'lu-refresh-cw', side: 'auto', open: true },
    argTypes: {
      label: textArg('label'),
      detail: textArg('detail'),
      chord: { name: 'chord', control: { type: 'text', maxLength: 6 }, description: 'As the computer writes it; the app reads it from the key table' },
      icon: { ...select('icon', icons.filter((id) => id !== 'none')), description: 'The unnamed control it names' },
      side: { ...select('side', sides), description: 'Auto: the side with the most room around the control' },
      open: boolArg('open', { description: 'Off: shown on hover and keyboard focus' }),
    },
    markup: tooltip,
  },
  'Primitives/Card': {
    args: { author: 'sam', image: '', age: '1h', body: 'Batches of 50, flushed every 2 s.', loading: false, avatar: true, where: '', step: '' },
    argTypes: {
      author: textArg('Author'),
      image: textArg('Image URL'),
      age: textArg('Age'),
      body: textArg('Body'),
      loading: boolArg('Loading'),
      avatar: boolArg('Avatar'),
      where: textArg('Where (path:line)'),
      step: textArg('Step'),
    },
    markup: ({ avatar: face, ...args }) => `<div class="kanso-panel">${card({ ...args, initial: face ? args.author : '' })}</div>`,
  },
  'Panels/Dojo': {
    ...statedPages['Panels/Dojo'],
    argTypes: {
      level: { name: 'level', control: { type: 'range', min: 1, max: sampleDojo.levels.length, step: 1 } },
      bests: textArg('bests'),
      picking: boolArg('picking a level'),
      phase: radioArg('phase', sampleDojo.phases),
      score: { name: 'score', control: { type: 'number' } },
      time: textArg('time'),
      streak: { name: 'streak', control: { type: 'number' } },
      moves: { name: 'moves', control: { type: 'number' } },
      need: { name: 'fewest moves', control: { type: 'number' } },
      reached: { name: 'targets reached', control: { type: 'range', min: 0, max: sampleDojo.targets, step: 1 } },
      x: { name: 'x', control: { type: 'number' } },
      y: { name: 'y', control: { type: 'number' } },
      goalX: { name: 'goal x', control: { type: 'number' } },
      goalY: { name: 'goal y', control: { type: 'number' } },
      path: textArg('best path'),
      pressed: textArg('pressed key'),
      mood: radioArg('Hachi', sampleDojo.moods),
      feedback: textArg('line'),
      tone: radioArg('tone', sampleDojo.tones),
      points: { name: 'points', control: { type: 'number' } },
      record: textArg('record'),
      summary: textArg('summary'),
      share: boolArg('share menu'),
    },
  },
};

export const playgroundStory = ({ args, argTypes, markup }) => ({
  name: 'Variants',
  args,
  argTypes,
  render: (values) => frame(markup(values)),
  parameters: { docs: { source: { type: 'dynamic', transform: (_code, context) => markup(context.args) } } },
});

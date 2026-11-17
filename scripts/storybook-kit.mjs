import { elements, escapeMarkup as escape, frame } from './storybook-markup.mjs';
import { THEMES, colour, contrast } from './tokens.mjs';
import { header, sidebarFooter, tile, viewSwitch } from '../stories/kit/compositions.js';
import { projectRow } from '../stories/kit/project-row.js';
import { computerRow } from '../stories/kit/computer-row.js';
import { section } from '../stories/kit/section.js';
import { asleep } from '../stories/kit/asleep.js';
import { sessionRow } from '../stories/kit/session-row.js';
import { button, dawn as dawnSky, input, mark, markdownBlock, marks, row, stack, thumbnail, windowControls } from '../stories/kit/pieces.js';
import { sampleSidebar, sessionTools } from '../stories/kit/samples.js';
import { statedPages } from '../stories/kit/states.js';
export { elements } from './storybook-markup.mjs';

// Each named state of a stated page, drawn from its preset; coverage plans can point at them.
export const statedRecords = () => Object.entries(statedPages).flatMap(([page, { args, markup, states }]) => states.map(({ label, args: preset, caption }) => (
  { id: `kit/${page.replace('Compositions/', '')}/${label}`, source: 'kit', page, label, html: frame(markup({ ...args, ...preset })), caption })));

export function kitRecords(records) {
  const originals = records.filter((record) => record.html !== undefined && !['kit', 'tokens'].includes(record.source));
  const results = [];
  const add = (name, label, html, caption) => results.push({ id: `kit/${name}/${label}`, source: 'kit', page: `Primitives/${name === 'Segmented' ? 'Tab' : name}`, label, html: frame(html), caption });
  const first = (className, prefer = 'compositions-controls/') => [...originals.filter((record) => record.id.includes(prefer)), ...originals].flatMap((record) => elements(record.html, className))[0];
  const definitions = [
    ['Button', 'kanso-button', ['Default', 'Hover', 'Focus', 'Active', 'Disabled', 'Dimmed']],
    ['Field', 'kanso-field', ['Default', 'Hover', 'Focus', 'Disabled', 'Failure']],
    ['Segmented', 'kanso-segmented', ['Default', 'Hover', 'Focus', 'Disabled']],
    ['Switch', 'kanso-switch', ['Default', 'On', 'Hover', 'Focus', 'Active', 'Disabled']],
    ['Mark', 'kanso-mark', ['Default']], ['Chip', 'kanso-badge', ['Default']], ['Avatar', 'kanso-avatar--round', ['Default']],
    ['Row', 'kanso-row', ['Default', 'Hover', 'Focus', 'Active', 'Dimmed'], 'compositions-panel-pieces/SectionAndRows/'],
    ['Tab', 'kanso-tab', ['Default', 'Hover', 'Focus', 'Active', 'Disabled']],
    ['Menu', 'kanso-menu', ['Default']], ['Dialog', 'kanso-dialog', ['Default']],
    ['Skeleton', 'kanso-skeleton__list', ['Loading'], 'panels/files/FilesFirstRead/'], ['Drag handle', 'kanso-grip', ['Default']], ['Key hint', 'kanso-key', ['Default']],
  ];
  const modifiers = { Hover: 'kanso-control--hover', Focus: 'kanso-control--focus', Active: 'kanso-control--active', Disabled: 'kanso-control--off', Dimmed: 'kanso-control--dim', Failure: 'kanso-field--invalid', On: 'kanso-control--on' };
  for (const [name, className, states, prefer] of definitions) {
    const source = first(className, prefer);
    if (!source) continue;
    for (const label of states) {
      const modifier = modifiers[label];
      const html = modifier ? source.replace(/class="([^"]*)"/, (_, classes) => `class="${classes} ${modifier}"${label === 'Disabled' ? ' aria-disabled="true"' : ''}`) : source;
      add(name, label, html, `${label} appearance of the shared ${name.toLowerCase()}.`);
    }
  }
  add('Row', 'Wrapped', `<div class="kanso-panel">${row({ name: 'This retries forever when the bucket is empty: Retry-After is in seconds, so wait that long once and give up after three tries instead of looping on every 429 the server answers.', second: ['src/api/limits.ts:42', 'mara', '2 replies'], wrap: true })}</div>`,
    'Proposed. A review thread: its comment wraps, up to 240 characters, over the path, author and replies.');
  add('Thumbnail', 'Colour, not drawn yet', `<div class="kanso-panel"><div class="kanso-picture__thumbnails">${thumbnail({ label: 'cart-countdown.png', color: 'var(--working)', selected: true })}${thumbnail({ label: 'checkout.png', color: 'var(--accent)' })}${thumbnail({ label: 'receipt.png' })}</div></div>`,
    'Proposed. Images: a picture not copied for drawing yet shows its own colour; one with none keeps the plain square.');
  add('Markdown', 'Editing, in its field', `<div class="kanso-panel"><div class="kanso-markdown">${markdownBlock({ source: '# Rate limits' })}${markdownBlock({ state: 'editing', content: input({ text: 'Each customer gets a bucket of requests.', label: 'Write…', icon: 'none', multiline: true, limit: 400 }) })}</div></div>`,
    'Proposed. The block being edited holds the text field, its Markdown as written, where the formatted block was.');
  const photo = 'https://images.placeholders.dev/96x96';
  const avatar = (size, inner) => `<span class="kanso-avatar kanso-avatar--round${size ? ` kanso-avatar--${size}` : ''}">${inner}</span>`;
  const img = `<img src="${photo}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  add('Avatar', 'Image', avatar('', img), 'A picture from a URL, local or external, cropped to the circle.');
  add('Avatar', 'Small', `<span class="kanso-actions">${avatar('sm', 'S')}${avatar('sm', img)}</span>`, 'Inside a line of text.');
  add('Avatar', 'Large', `<span class="kanso-actions">${avatar('lg', 'S')}${avatar('lg', img)}</span>`, 'A card or a header.');
  add('Avatar', 'Image failed', avatar('', `<img src="https://invalid.example/avatar.png" alt="" onerror="this.remove()">S`), 'When the picture cannot load, the initial stays.');
  for (const state of ['working', 'blocked', 'done', 'idle']) {
    const html = first(`kanso-mark--${state}`);
    if (html) add('Mark', state[0].toUpperCase() + state.slice(1), html, `The owning item is ${state}.`);
  }
  const armed = first('kanso-action--armed');
  if (armed) add('Button', 'Armed', armed, 'A second press within four seconds confirms an irreversible action.');
  const button = first('kanso-button'), working = first('kanso-mark--working');
  if (button && working) add('Button', 'Loading', button.replace(/>[\s\S]*<\/([a-z]+)>$/, ` aria-busy="true">${working}Working…</$1>`), 'The action is waiting for its result.');
  const headerRecord = originals.find((record) => record.id.includes('layouts-sidebar-header-three-ways/'));
  const headers = headerRecord ? elements(headerRecord.html, 'kanso-sidebar--header-preview') : [];
  const pillHeader = headers.find((html) => html.includes('kanso-badge--count'));
  const byId = (id) => originals.find((record) => record.id === id)?.html ?? '';
  add('Window controls', 'Default', windowControls(), 'The three lights, where the system draws them.');
  add('Dawn', 'Default', dawnSky(), 'The sky of Dawn Mode; the sun rises once on load.');
  for (const [id, label, html, caption] of [
    ['kit/Header/Open', 'Expanded', header(), 'The lights; + on the left; sort, search and hide on the right.'],
    ['kit/Header/Collapsed', 'Collapsed', header({ collapsed: true }), 'The lights; + and show stacked in the rail, Sort and Search under a caret.'],
    ['kit/Header/Dawn', 'Expanded, Dawn Mode', header({ dawn: true }), 'The dawn behind the lights and the tools.'],
    ['kit/Header/Dawn collapsed', 'Collapsed, Dawn Mode', header({ collapsed: true, dawn: true }), 'The dawn behind the lights, centred on the rail.'],
  ]) if (html) results.push({ id, source: 'kit', page: 'Compositions/Header', label, html: frame(html), caption });
  const inSidebar = (html) => stack({ variant: 'sidebar frame' }, html), inRail = (html) => stack({ variant: 'rail frame' }, html);
  const atlas = { name: 'Atlas', activity: 'Reviewing step 01', time: '3m' }, juno = { name: 'Juno', status: 'idle', depth: 2 }, iris = { program: 'p-codex', name: 'Iris', status: 'done', depth: 2 };
  for (const [page, label, html, caption, id] of [
    ['Session row', 'Working', inSidebar(sessionRow(atlas)), 'What it is on and for how long.', 'proto/compositions-sidebar-rows/AgentTwoLines/Default'],
    ['Session row', 'Working, under the pointer', inSidebar(sessionRow({ ...atlas, hover: true })), 'Pin and ⋯ in the time\'s place.'],
    ['Session row', 'Needs you', inSidebar(sessionRow({ program: 'p-codex', name: 'Nova', activity: 'Run npm publish?', time: '2m', status: 'blocked' })), 'The question, in foreground.'],
    ['Session row', 'Finished', inSidebar(sessionRow({ program: 'p-codex', name: 'Iris', status: 'done', current: true })), 'One line, the mark.'],
    ['Session row', 'Finished, a command still runs', inSidebar(sessionRow({ program: 'p-codex', name: 'tests', status: 'done', commands: 1 })), 'The count; the command in its tooltip.'],
    ['Session row', 'Idle', inSidebar(sessionRow({ name: 'Orion', status: 'idle' })), 'Its name, muted.', 'proto/compositions-sidebar-rows/AgentOneLine/Default'],
    ['Session row', 'Terminal', inSidebar(sessionRow({ program: 'lu-terminal', name: 'shell', status: 'none' })), 'A name, no ensō.'],
    ['Session row', 'Pinned', inSidebar(sessionRow({ ...atlas, pinned: true })), 'The pin stays before the mark.'],
    ['Session row', 'Keyboard ring', inSidebar(sessionRow({ name: 'Orion', status: 'idle', focus: true })), 'Where the keyboard is.'],
    ['Session row', 'Sent a message', inSidebar(sessionRow({ name: 'Iris', activity: 'Message from Atlas', time: '1m', status: 'done' })), 'Not opened yet: the message and its time.'],
    ['Session row', 'What it is on', inSidebar([sessionRow(atlas), sessionRow({ ...juno, activity: 'Waiting for you', time: '12m' }), sessionRow({ ...iris, activity: 'Boards 01 to 04 done', time: '6m' })].join('')), 'The user\'s choice: every row says what it is on.'],
    ['Session row', 'Sub-session', inSidebar([sessionRow(atlas), sessionRow(juno), sessionRow(iris)].join('')), 'Under its parent.', 'proto/compositions-sidebar-rows/SubAgent/Default'],
    ['Session row', 'Sub-session needs you', inSidebar([sessionRow(atlas), sessionRow({ ...juno, activity: 'Allow network access?', time: '1m', status: 'blocked' }), sessionRow(iris)].join('')), 'Its own mark and line.'],
    ['Session row', 'Status and Threads', inSidebar([sessionRow({ name: 'Atlas', place: 'kansō', depth: 0 }), sessionRow({ name: 'Nova', place: 'amtelser · dark', status: 'idle', depth: 0 })].join('')), 'The project after the name, the computer when not this one.'],
    ['Session row', 'Computer unreachable', inSidebar(sessionRow({ name: 'ops', status: 'idle', dimmed: true })), 'Dim, the ensō idle; its computer row says why.'],
    ['Session row', 'Stuck on a step', inSidebar(sessionRow({ name: 'Atlas', activity: 'Reviewing step 01', step: { time: '14m', stuck: true }, time: '20m' })), 'How long on this step, in the blocked colour once it is long.'],
    ['Session row', 'Under the pointer, pinned', inSidebar(sessionRow({ name: 'Atlas', status: 'done', pinned: true, hover: true })), 'Unpin takes the pin\'s place.'],
    ['Session row', 'Conversation tools', inSidebar(sessionRow({ name: 'Iris', status: 'done', depth: 0, pinnable: false, tools: sessionTools, hover: true })), 'Settle, and the menu; pin stays in the menu.'],
    ['Session row', "Can't read", inSidebar(sessionRow({ name: 'Iris', status: 'idle', depth: 0, place: "Can't read", placeTip: 'The transcript is gone', refresh: true, dimmed: true })), 'Refresh beside the word.'],
    ['Session row', 'Dragged over', inSidebar(sessionRow({ name: 'Atlas', status: 'idle', drop: 'before' })), 'Where the dragged row lands.'],
    ['Session row', 'Tree', inSidebar(stack({ variant: 'rows' }, sessionRow({ name: 'Atlas' }), sessionRow({ program: 'p-codex', name: 'Juno', status: 'idle', depth: 2, guides: [null, 'tee'] }), sessionRow({ program: 'p-codex', name: 'Iris', status: 'done', depth: 2, guides: [null, 'end'] }))), 'Each sub-session hangs from its parent.'],
    ['Project row', 'At rest', inSidebar(projectRow({ name: 'kansō', folder: 'herdr-kanso', branch: 'main', sync: '↓12' })), 'Name, folder, branch and sync.'],
    ['Project row', 'Folded', inSidebar(projectRow({ name: 'kansō', folder: 'herdr-kanso', branch: 'main', count: 3 })), 'The most urgent mark and how many.'],
    ['Project row', 'Under the pointer', inSidebar(projectRow({ name: 'kansō', folder: 'herdr-kanso', branch: 'main', sync: { text: '↓12', tip: 'Pull 12 from origin/main', label: 'Pull' }, hover: true })), '+ and ⋯ under the pointer; ↓ pulls on one press.'],
    ['Project row', 'Pulling', inSidebar(projectRow({ name: 'kansō', folder: 'herdr-kanso', branch: 'main', sync: '↓12', pending: true })), 'It breathes until git answers.'],
    ['Project row', 'Worktree', inSidebar(stack({ variant: 'rows' }, projectRow({ name: 'kansō', branch: 'main' }), projectRow({ name: 'fix-toast', tree: 'end', dimmed: true }))), 'Under its checkout, on the guide.'],
    ['Project row', 'Folder not found', inSidebar(projectRow({ name: 'search', dimmed: true, missing: true })), 'Locate finds where it went.'],
    ['Project row', 'Dragged over', inSidebar(projectRow({ name: 'kansō', drop: 'after' })), 'Where the dragged project lands.'],
    ['Computer row', 'This computer', inSidebar(computerRow({ name: 'light', remote: false })), 'This computer first.'],
    ['Computer row', 'Off', inSidebar(computerRow({ name: 'dark', state: 'off' })), 'A choice, not a failure.'],
    ['Computer row', 'Unreachable', inSidebar(computerRow({ name: 'devbox', state: 'unreachable' })), 'Refresh as its button.'],
    ['Computer row', 'Needs login', inSidebar(computerRow({ name: 'devbox', state: 'login' })), 'Sign in as its button.'],
    ['Computer row', 'Turning on', inSidebar(computerRow({ name: 'dark', pending: true })), 'It breathes until hc answers.'],
    ['Computer row', 'Under the pointer', inSidebar(computerRow({ name: 'dark', hover: true, sync: 'Sync dark: synced 2m ago' })), 'Turn off and +; Sync stays out while it is on.'],
    ['Computer row', 'Keyboard on a tool', inSidebar(computerRow({ name: 'dark', hover: true, lit: 'lu-plus' })), 'Each tool is a stop after the row; Enter presses it.'],
    ['Asleep', 'Folded', inSidebar(asleep({ names: ['site', 'dojo'] })), 'One folded line, its count.'],
    ['Asleep', 'Open', inSidebar(asleep({ names: ['site', 'dojo'], open: true })), 'The names dim, Wake at the right.'],
    ['Section', 'Default', inSidebar(section({ title: 'Needs you', status: 'blocked' })), 'A heading in Status and Threads.'],
    ['Asleep', 'A sleeping tab', inSidebar(asleep({ names: ['Atlas'], title: 'review', open: true, selected: 0 })), 'Named by its tab; the keyboard on a row.'],
    ['Section', 'A project\'s conversations', inSidebar(section({ title: 'kansō', add: 'New conversation in kansō', hover: true })), '+ under the pointer starts one there.'],
    ['Section', 'Folded', inSidebar(section({ title: 'Idle', count: 2 })), 'How many, once it is folded.'],
    ['View switch', 'Row', inSidebar(viewSwitch()), 'Sidebar open: the three views by name.'],
    ['View switch', 'Column', inRail(viewSwitch({ column: true })), 'Sidebar collapsed: the three views as icons.'],
    ['Tile', 'Project', inRail(tile({ initial: 'A', status: 'blocked', count: 4, open: true })), 'A project in the rail.'],
    ['Tile', 'Status', inRail(tile({ status: 'working', count: 3 })), 'A state in the rail.'],
    ['Footer', 'Default', inSidebar(sidebarFooter()), 'Settings.'],
    ['Footer', 'Update', inSidebar(sidebarFooter({ update: 'Update kansō to 3.31.0' })), 'An update adds a row on top.'],
    ['Sidebar', 'Open', sampleSidebar(), 'Header, views, rows and footer.'],
    ['Sidebar', 'Collapsed', sampleSidebar({ collapsed: true }), 'The rail.'],
    ['Sidebar', 'Dawn', sampleSidebar({ dawn: true }), 'Open, in Dawn Mode.'],
    ['Sidebar', 'Dawn collapsed', sampleSidebar({ collapsed: true, dawn: true }), 'The rail, in Dawn Mode.', 'kit/Rail/Dawn'],
    ['Sidebar', 'Status', sampleSidebar({ view: 'agents' }), 'Open on Status.', 'kit/Rail/Open'],
    ['Sidebar', 'Status collapsed', sampleSidebar({ collapsed: true, view: 'agents' }), 'The rail on Status.', 'kit/Rail/Collapsed'],
    ['Sidebar', 'Views menu', sampleSidebar({ collapsed: true, menu: true }), 'The rail: its one view button opens Projects, Status and Threads.'],
  ]) results.push({ id: id ?? `kit/${page}/${label}`, source: 'kit', page: page === 'Sidebar' ? 'Compositions/Sidebar' : `Compositions/Sidebar/${page}`, label, html: frame(html), caption });
  const choices = elements(byId('proto/components-choosing-the-channel/ChoosingTheChannel/Default'), 'kanso-update');
  const sky = elements(byId('proto/tokens-dawn/TheBand/Default'), 'kanso-dawn--preview')[0];
  const mark = elements(byId('proto/approved-dawn/Reference/12'), 'kanso-settings__piece-choice')[0];
  for (const [label, html, caption, id] of [
    ['Pill', pillHeader, 'Dawn Mode, right of the lights.'],
    ['Hidden / Stable Mode', headers.at(-1), 'No mark. Stable Mode always shows this.'],
    ['Sunrise', sky && `${sky}<button class="kanso-dawn__replay" type="button">Play the sunrise</button>`, 'Once on open and on switch, 2.6 s. Reduced motion shows the last frame.'],
    ['Channel mark', mark && `<div class="kanso-update">${mark}</div>`, 'Artwork, Pill or Hidden.'],
    ['Switch row · Stable Mode', choices[0], 'One press switches.'],
    ['Switch row · Dawn Mode', choices[1], 'One press switches.'],
    ['Switch row · Dawn Mode beta', choices[2], 'One press switches.'],
  ]) if (html) results.push({ id: id ?? `kit/Dawn Mode/${label}`, source: 'kit', page: 'Compositions/Dawn Mode', label, html: frame(html), caption });
  const spend = originals.find((record) => record.id === 'panels/spend/SpendWellUsedTheMonthPerPlanThenToday/Default');
  if (spend) for (const [label, total, unit, factor] of [
    ['Today', '$41.20', 'today', 1], ['Month', '$824.00', 'this month', 20], ['30 days', '$1,236.00', 'over 30 days', 30],
    ['Year', '$9,888.00', 'this year', 240], ['All time', '$14,832.00', 'all time', 360],
  ]) {
    const html = spend.html.replace(/<span class="kanso-segmented">[^]*?<\/span><span class="kanso-layout__grow">/, `<span class="kanso-segmented">${['Today', 'Month', '30 days', 'Year', 'All time'].map((period) => `<span${period === label ? ' class="kanso-control--on"' : ''}>${period}</span>`).join('')}</span><span class="kanso-layout__grow">`)
      .replace('$41.20', total).replace('API value today', `API value ${unit}`)
      .replace(/(<span class="kanso-panel__row-value">)\$([\d.]+)/g, (_, tag, value) => `${tag}$${(Number(value) * factor).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    results.push({ id: `kit/Spend/${label}`, source: 'kit', page: 'Panels/Spend', label, html, caption: `Sample API value ${unit}. Choose a period to update the total and breakdown.` });
  }
  return results;
}

const contrastRecord = (tokens) => {
  const surfaces = ['surface-1', 'surface-0', 'surface-2', 'surface-4', 'surface-3', 'hover', 'selected'];
  const pairs = [...['fg', 'muted', 'dim'].flatMap((text) => surfaces.map((surface) => [text, surface, 4.5])), ...['line-strong', 'focus', 'working', 'blocked', 'done', 'idle'].flatMap((edge) => surfaces.map((surface) => [edge, surface, 3]))];
  const sample = ([fore, surface, min]) => min === 4.5 ? `<span class="kanso-tokens__contrast kanso-text--${fore} kanso-fill--${surface}">Aa</span>` : `<span class="kanso-tokens__contrast kanso-fill--${surface}${marks[fore] ? '' : ` kanso-ring--${fore}`}">${marks[fore] ? mark({ status: fore }) : ''}</span>`;
  const ratio = ([fore, surface]) => THEMES.map((theme) => `<span class="kanso-tokens__value kanso-tokens__value--${theme}">${contrast(colour(tokens, theme, fore), colour(tokens, theme, surface)).toFixed(1)}:1</span>`).join('');
  const html = `<table class="kanso-tokens"><thead><tr><th></th><th>Colour</th><th>On</th><th>Ratio</th><th>Minimum</th></tr></thead><tbody>${pairs.map((pair) => `<tr><td class="kanso-tokens__example">${sample(pair)}</td><td class="kanso-tokens__name">--${pair[0]}</td><td class="kanso-tokens__name">--${pair[1]}</td><td class="kanso-tokens__name">${ratio(pair)}</td><td>${pair[2]}:1</td></tr>`).join('')}</tbody></table>`;
  return { id: 'tokens/Contrast', source: 'tokens', page: 'Tokens/Contrast, light and dark', label: 'Reference', caption: 'Ratios from kanso/tokens.json.', html: frame(html) };
};

// The utility family that shows a type token: weights and tracking have their own, sizes use type.
const SAMPLE_CLASS = { fw: 'weight', ls: 'tracking' };
// One token group's reference page.
const reference = (name, html) => ({ id: `tokens/${name}`, source: 'tokens', page: `Tokens/${name}`, label: 'Reference', caption: 'Values and roles from kanso/tokens.json.', html: frame(html) });

// Measurements reserved for the Storybook frame stay available to its CSS, outside the token references.
const frameToken = ({ name }) => /^k-(?:w-window(?:-(?:wide|narrow|small))?$|room-|h-strip$|dawn-preview)/.test(name);
const measure = (name, height = false) => `<span class="kanso-tokens__measure${height ? ' kanso-tokens__measure--height' : ''}" data-${height ? 'height' : 'width'}="var(--${name})"></span>`;
const motionSample = (name) => {
  if (/^k-(hover|ease)-/.test(name)) return button({ label: 'Hover', kind: 'tonal' });
  if (name === 'k-arm-ms') return button({ label: 'Close', kind: 'tonal', armed: true });
  if (name === 'k-spin-ms') return mark({ status: 'working' });
  if (name === 'k-skel-ms') return '<span class="kanso-skeleton kanso-tokens__skeleton"></span>';
  if (/^k-(fade|glide)-/.test(name)) return '<span class="kanso-tokens__glide"><i></i></span>';
  if (/^k-beat-/.test(name)) return '<span class="kanso-tokens__beat"></span>';
  const glint = '<span class="kanso-text--glint">checkout</span>';
  return name === 'k-glint-ms' ? glint : `<span class="kanso-tokens__glint">${glint}${measure(name)}</span>`;
};

export function tokenRecords(tokens) {
  const scale = { Colour: ['colour', 'opacity'], Type: ['type'], Spacing: ['space'], Radius: ['radius'], Motion: ['motion'], Icons: ['icon'] };
  const sizes = Object.keys(tokens).filter((key) => key !== 'board' && !Object.values(scale).flat().includes(key));
  const groups = { ...scale, Sizes: sizes };
  const sample = ({ group, name: n }) => {
    const [, kind, step] = /^k-(\w+)-(.+)$/.exec(n) ?? [];
    if (group === 'colour') return `<span class="kanso-tokens__${n === 'shadow' ? 'shadow kanso-shadow' : `swatch kanso-fill--${escape(n)}`}"></span>`;
    if (group === 'opacity') return `<span class="kanso-tokens__swatch kanso-tokens__${n === 'k-wash-blocked' ? 'blocked' : kind === 'tint' ? 'tint' : 'opacity'}" data-token="${n}"></span>`;
    if (group === 'type') return kind === 'lh' ? `<span class="kanso-tokens__lines kanso-leading--${step}">Two lines<br>of text</span>` : `<span class="kanso-${SAMPLE_CLASS[kind] ?? 'type'}--${step}">Aa Quiet sessions</span>`;
    if (group === 'space') return `<span class="kanso-tokens__space kanso-gap--${step}"><i></i><i></i></span>`;
    if (group === 'radius' || n.endsWith('radius')) return `<span class="kanso-tokens__radius" data-radius="var(--${n})"></span>`;
    if (group === 'icon') return `<svg class="kanso-icon kanso-icon--${step}" aria-hidden="true"><use href="#lu-bot"/></svg>`;
    if (group === 'motion') return motionSample(n);
    return measure(n, group === 'height' || group === 'skeleton' || /(?:-h|-height|-tall|-line)$/.test(n));
  };
  const role = (text) => text.replace(/:? ?ui\.js [\w.]+/g, '').replace(/ ?\(\d+ merged here\)/g, '').replace(/^4-based$/, 'base step').trim();
  return Object.entries(groups).map(([name, keys]) => {
    const rows = keys.flatMap((key) => key === 'colour'
      ? [...new Set(Object.values(tokens.colour).flatMap((values) => values.map((row) => row.name)))].map((n) => {
        const values = Object.entries(tokens.colour).map(([theme, values]) => `<span class="kanso-tokens__value kanso-tokens__value--${theme}">${escape(values.find((row) => row.name === n)?.value ?? '')}</span>`).join('');
        return { ...tokens.colour.dark.find((row) => row.name === n), group: key, values };
      })
      : tokens[key].filter((row) => !frameToken(row)).map((row) => ({ ...row, group: key, role: name === 'Sizes' ? `${key[0].toUpperCase()}${key.slice(1)}: ${row.role}` : row.role })));
    const html = `<table class="kanso-tokens"><thead><tr><th></th><th>Token</th><th>Value</th><th>Use</th></tr></thead><tbody>${rows.map((row) => `<tr><td class="kanso-tokens__example" data-token="${row.name}">${sample(row)}</td><td class="kanso-tokens__name">--${escape(row.name)}</td><td class="kanso-tokens__name">${row.values ?? escape(row.value)}</td><td>${escape(role(row.role))}</td></tr>`).join('')}</tbody></table>`;
    return reference(name, html);
  }).concat(contrastRecord(tokens));
}

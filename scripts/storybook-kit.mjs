import { elements, escapeMarkup as escape, frame } from './storybook-markup.mjs';
import { THEMES, colour, contrast } from './tokens.mjs';
import { asleep, computerRow, header, projectRow, section, sessionRow, sidebarFooter, tile, viewSwitch } from '../stories/kit/compositions.js';
import { dawn as dawnSky, stack, windowControls } from '../stories/kit/pieces.js';
import { sampleSidebar } from '../stories/kit/samples.js';
import { statedPages } from '../stories/kit/states.js';
export { elements } from './storybook-markup.mjs';

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
  for (const [page, label, html, caption, id] of [
    ['Session row', 'Working', inSidebar(sessionRow({ name: 'Atlas', activity: 'Reviewing step 01', time: '3m' })), 'What it is on and for how long.'],
    ['Session row', 'Needs you', inSidebar(sessionRow({ program: 'lu-terminal', name: 'Nova', activity: 'Run npm publish?', time: '2m', status: 'blocked' })), 'The question, in foreground.'],
    ['Session row', 'Finished', inSidebar(sessionRow({ program: 'p-codex', name: 'Iris', status: 'done', current: true })), 'One line, the mark.'],
    ['Session row', 'Sub-session', inSidebar(sessionRow({ program: 'p-codex', name: 'Juno', status: 'idle', depth: 2 })), 'Under its parent.'],
    ['Project row', 'At rest', inSidebar(projectRow({ name: 'kansō', folder: 'herdr-kanso', branch: 'main', sync: '↓12' })), 'Name, folder, branch and sync.'],
    ['Project row', 'Folded', inSidebar(projectRow({ name: 'kansō', folder: 'herdr-kanso', branch: 'main', count: 3 })), 'The most urgent mark and how many.'],
    ['Computer row', 'This computer', inSidebar(computerRow({ name: 'light', remote: false })), 'This computer first.'],
    ['Computer row', 'Off', inSidebar(computerRow({ name: 'dark', state: 'off' })), 'A choice, not a failure.'],
    ['Computer row', 'Unreachable', inSidebar(computerRow({ name: 'devbox', state: 'unreachable' })), 'Refresh as its button.'],
    ['Asleep', 'Folded', inSidebar(asleep({ names: ['site', 'dojo'] })), 'One folded line, its count.'],
    ['Asleep', 'Open', inSidebar(asleep({ names: ['site', 'dojo'], open: true })), 'The names dim, Wake at the right.'],
    ['Section', 'Default', inSidebar(section({ title: 'Needs you', status: 'blocked' })), 'A heading in Status and Threads.'],
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
  for (const [page, { args, markup, states }] of Object.entries(statedPages)) {
    for (const { label, args: preset, caption } of states) results.push({ id: `kit/${page.replace('Compositions/', '')}/${label}`, source: 'kit', page, label, html: frame(markup({ ...args, ...preset })), caption });
  }
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
  const surfaces = ['canvas', 'chrome', 'bg', 'raised', 'popover', 'hover', 'selected'];
  const pairs = [...['fg', 'muted', 'dim'].flatMap((text) => surfaces.map((surface) => [text, surface, 4.5])), ...['input', 'focus', 'working', 'blocked', 'done', 'idle'].map((edge) => [edge, 'bg', 3])];
  const sample = ([fore, surface, min]) => min === 4.5 ? `<span class="kanso-tokens__contrast kanso-text--${fore} kanso-fill--${surface}">Aa</span>` : `<span class="kanso-tokens__contrast kanso-ring--${fore} kanso-fill--${surface}"></span>`;
  const ratio = ([fore, surface]) => THEMES.map((theme) => `<span class="kanso-tokens__value kanso-tokens__value--${theme}">${contrast(colour(tokens, theme, fore), colour(tokens, theme, surface)).toFixed(1)}:1</span>`).join('');
  const html = `<table class="kanso-tokens"><thead><tr><th></th><th>Colour</th><th>On</th><th>Ratio</th><th>Minimum</th></tr></thead><tbody>${pairs.map((pair) => `<tr><td class="kanso-tokens__example">${sample(pair)}</td><td class="kanso-tokens__name">--${pair[0]}</td><td class="kanso-tokens__name">--${pair[1]}</td><td class="kanso-tokens__name">${ratio(pair)}</td><td>${pair[2]}:1</td></tr>`).join('')}</tbody></table>`;
  return { id: 'tokens/Contrast', source: 'tokens', page: 'Tokens/Contrast, light and dark', label: 'Reference', caption: 'Ratios from kanso/tokens.json.', html: frame(html) };
};

export function tokenRecords(tokens) {
  const groups = { Colour: ['colour'], Type: ['type'], Spacing: ['space', 'height', 'switch'], Radius: ['radius'], Motion: ['motion'], Icons: ['icon'] };
  return Object.entries(groups).map(([name, keys]) => {
    if (keys[0] === 'colour') {
      const names = [...new Set(Object.values(tokens.colour).flatMap((values) => values.map((row) => row.name)))];
      const value = (theme, n) => tokens.colour[theme].find((row) => row.name === n);
      const html = `<table class="kanso-tokens"><thead><tr><th></th><th>Token</th><th>Value</th><th>Use</th></tr></thead><tbody>${names.map((n) => `<tr><td><span class="kanso-tokens__swatch ${n === 'shadow' ? 'kanso-shadow' : `kanso-fill--${escape(n)}`}"></span></td><td class="kanso-tokens__name">--${escape(n)}</td><td class="kanso-tokens__name">${Object.keys(tokens.colour).map((theme) => `<span class="kanso-tokens__value kanso-tokens__value--${theme}">${escape(value(theme, n)?.value ?? '')}</span>`).join('')}</td><td>${escape((value('dark', n) ?? value('light', n)).role)}</td></tr>`).join('')}</tbody></table>`;
      return { id: `tokens/${name}`, source: 'tokens', page: `Tokens/${name}`, label: 'Reference', caption: 'Values and roles from kanso/tokens.json.', html: frame(html) };
    }
    const rows = keys.flatMap((key) => tokens[key].map((row) => ({ ...row, group: key })));
    const sample = ({ group, name: n }) => {
      const [, kind, step] = /^k-(\w+)-(.+)$/.exec(n);
      if (group === 'type') return kind === 'lh' ? `<span class="kanso-tokens__lines kanso-leading--${step}">Two lines<br>of text</span>` : `<span class="kanso-${kind === 'fw' ? 'weight' : 'type'}--${step}">Aa Quiet sessions</span>`;
      if (group === 'space') return `<span class="kanso-tokens__space kanso-gap--${step}"><i></i><i></i></span>`;
      if (group === 'radius') return `<span class="kanso-tokens__radius kanso-radius--${step}"></span>`;
      if (group === 'height') return `<span class="kanso-tokens__height kanso-height--${step}"></span>`;
      if (group === 'switch') return '<span class="kanso-switch kanso-control--on"><i></i></span>';
      if (group === 'icon') return `<svg class="kanso-icon kanso-icon--${step}" aria-hidden="true"><use href="#lu-bot"/></svg>`;
      if (group === 'motion') return /^k-(hover|ease)-/.test(n) ? '<span class="kanso-tokens__wash"></span>' : n === 'k-arm-ms' ? '<span class="kanso-tokens__arm"></span>' : n === 'k-skel-ms' ? '<span class="kanso-skeleton kanso-skeleton--breathing kanso-tokens__skeleton"></span>' : n === 'k-spin-ms' ? '<svg class="kanso-mark kanso-mark--working"><use href="#e-work"/></svg>' : '<span class="kanso-text--glint">checkout</span>';
      return '';
    };
    const role = (text) => text.replace(/:? ?ui\.js [\w.]+/g, '').replace(/ ?\(\d+ merged here\)/g, '').replace(/^4-based$/, 'base step').trim();
    const html = `<table class="kanso-tokens"><thead><tr><th></th><th>Token</th><th>Value</th><th>Use</th></tr></thead><tbody>${rows.map((row) => `<tr><td class="kanso-tokens__example">${sample(row)}</td><td class="kanso-tokens__name">--${escape(row.name)}</td><td class="kanso-tokens__name">${escape(row.value)}</td><td>${escape(role(row.role))}</td></tr>`).join('')}</tbody></table>`;
    return { id: `tokens/${name}`, source: 'tokens', page: `Tokens/${name}`, label: 'Reference', caption: 'Values and roles from kanso/tokens.json.', html: frame(html) };
  }).concat(contrastRecord(tokens));
}

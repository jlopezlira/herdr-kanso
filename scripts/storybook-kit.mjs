import { elements, escapeMarkup as escape, frame } from './storybook-markup.mjs';
export { elements } from './storybook-markup.mjs';

export function kitRecords(records) {
  const originals = records.filter((record) => record.html !== undefined && !['kit', 'tokens'].includes(record.source));
  const results = [];
  const add = (name, label, html, caption) => results.push({ id: `kit/${name}/${label}`, source: 'kit', page: `Primitives/${name}`, label, html: frame(html), caption });
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
    ['Skeleton', 'kanso-skeleton__list', ['Loading'], 'panels/files/FilesFirstRead/'], ['Drag handle', 'kanso-header__grip', ['Default']], ['Key hint', 'kanso-key', ['Default']],
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
  for (const state of ['working', 'blocked', 'done', 'idle']) {
    const html = first(`kanso-mark--${state}`);
    if (html) add('Mark', state[0].toUpperCase() + state.slice(1), html, `The owning item is ${state}.`);
  }
  const armed = first('kanso-action--armed');
  if (armed) add('Button', 'Armed', armed, 'A second press within four seconds confirms an irreversible action.');
  const button = first('kanso-button'), working = first('kanso-mark--working');
  if (button && working) add('Button', 'Loading', button.replace(/>[\s\S]*<\/([a-z]+)>$/, ` aria-busy="true">${working}Working…</$1>`), 'The action is waiting for its result.');
  const sidebar = first('kanso-sidebar');
  const rail = first('kanso-rail');
  const headerRecord = originals.find((record) => record.id.includes('layouts-sidebar-header-three-ways/'));
  const headers = headerRecord ? elements(headerRecord.html, 'kanso-sidebar--header-preview') : [];
  const dawn = headers.find((html) => html.includes('kanso-dawn'));
  const band = dawn && elements(dawn, 'kanso-dawn')[0];
  for (const [name, variants] of [
    ['Header', { Open: headers.find((html) => !html.includes('kanso-dawn')) ?? first('kanso-header'), Collapsed: first('kanso-rail__brand'), Dawn: dawn }],
    ['Sidebar', { Open: sidebar, Collapsed: rail, Dawn: sidebar && band ? sidebar.replace(/(<div[^>]*>)/, `$1${band}`) : undefined }],
    ['Rail', { Open: sidebar, Collapsed: rail, Dawn: rail && band ? rail.replace(/(<div class="kanso-rail__brand"[^>]*>)/, `$1${band}`) : undefined }],
  ]) for (const [label, html] of Object.entries(variants)) if (html) results.push({ id: `kit/${name}/${label}`, source: 'kit', page: `Compositions/${name}`, label, html: frame(html), caption: `${label} navigation arrangement, composed from the shared kit.` });
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

export function tokenRecords(tokens) {
  const groups = { Colour: ['colour'], Type: ['type'], Spacing: ['space', 'height', 'switch'], Radius: ['radius'], Motion: ['motion'], Icons: ['icon'] };
  return Object.entries(groups).map(([name, keys]) => {
    const rows = keys.flatMap((key) => key === 'colour'
      ? Object.entries(tokens.colour).flatMap(([theme, values]) => values.map((row) => ({ ...row, group: theme })))
      : tokens[key].map((row) => ({ ...row, group: key })));
    const html = `<table class="kanso-tokens"><thead><tr><th>Group</th><th>Token</th><th>Value</th><th>Use</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escape(row.group)}</td><td>--${escape(row.name)}</td><td>${escape(row.value)}</td><td>${escape(row.role)}</td></tr>`).join('')}</tbody></table>`;
    return { id: `tokens/${name}`, source: 'tokens', page: `Tokens/${name}`, label: 'Reference', caption: 'Values and roles from kanso/tokens.json.', html: frame(html) };
  });
}

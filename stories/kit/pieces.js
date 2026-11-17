// The kit's pieces: every function here returns markup; compositions.js only calls them.
import { diffText, facts, plus } from '../../kanso/mods/kanso-panel/ui-facts.js';
import { diffNumbers } from '../../kanso/mods/kanso-spaces/pure.js';

export const escape = (text) => String(text).replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

// Children are pieces, arrays of pieces, or null/false for nothing.
export const list = (...children) => children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false).join('');

// A label made of words and values, such as a name inside an action's title.
export const phrase = (...parts) => parts.join(' ');
// A chord: its keys' names joined as the computer writes them, ⌥⌘H or Alt+L.
export const chord = (join, ...parts) => parts.join(join ?? '');

export const grow = (inner = '') => `<span class="kanso-layout__grow">${inner}</span>`;

// Atoms

export const kinds = { solid: 'kanso-button--solid', tonal: 'kanso-button--tonal', quiet: 'kanso-button--quiet kanso-text--fg', icon: 'kanso-button--icon' };
// `content`: markup drawn in place of the icon and label, such as a picture with its name; `label` is then what the button says.
export const button = ({ label, kind = 'solid', size = 'md', icon = 'none', disabled = false, verb = '', armed = false, active = false, spin = false, key = '', content = '' }) => {
  const classes = ['kanso-button', kinds[kind], size === 'md' ? '' : `kanso-button--${size}`, disabled ? 'kanso-control--off' : '', armed ? 'kanso-action kanso-action--armed' : '', active ? 'kanso-button--active' : '', spin ? 'kanso-button--spinning' : '', content ? 'kanso-button--drawn' : ''].filter(Boolean).join(' ');
  const lead = icon === 'none' ? (spin ? mark({ status: 'working', size: 'sm' }) : '') : iconSvg(icon, 'control');
  const text = kind === 'icon' ? '' : escape(label);
  const again = `Press again to ${escape(verb || label.toLowerCase())}`;
  const inner = content || (armed && kind !== 'icon' ? `<span>${text}</span><span>${again}</span>` : `${lead}${text}${key ? ` ${keyHint({ text: key })}` : ''}`);
  return `<span class="${classes}" tabindex="0" title="${armed && kind === 'icon' ? again : escape(label)}"${disabled ? ' aria-disabled="true"' : ''}${spin ? ' aria-busy="true"' : ''}>${inner}</span>`;
};

export const windowControls = () => '<span class="kanso-window-controls"><i></i><i></i><i></i></span>';

export const dawn = ({ id = 'dawn' } = {}) => `<svg class="kanso-dawn kanso-dawn--rising" viewBox="0 0 256 56" preserveAspectRatio="xMidYMin slice" aria-hidden="true"><defs><linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="44" gradientUnits="userSpaceOnUse"><stop class="kanso-dawn__stop kanso-dawn__stop--top" offset="0"/><stop class="kanso-dawn__stop kanso-dawn__stop--mid" offset=".45"/><stop class="kanso-dawn__stop kanso-dawn__stop--low" offset=".8"/><stop class="kanso-dawn__stop kanso-dawn__stop--edge" offset="1"/></linearGradient><radialGradient id="${id}-glow" cx="124" cy="44" r="78" gradientUnits="userSpaceOnUse" gradientTransform="translate(0 15.4) scale(1.65)"><stop class="kanso-dawn__stop kanso-dawn__stop--sun" offset="0"/><stop class="kanso-dawn__stop kanso-dawn__stop--haze" offset=".35"/><stop class="kanso-dawn__stop kanso-dawn__stop--edge-clear" offset="1"/></radialGradient><linearGradient id="${id}-fade" x1="0" y1="44" x2="0" y2="56" gradientUnits="userSpaceOnUse"><stop class="kanso-dawn__stop kanso-dawn__stop--mist" offset="0"/><stop class="kanso-dawn__stop kanso-dawn__stop--chrome-clear" offset="1"/></linearGradient><clipPath id="${id}-clip"><rect x="0" y="0" width="256" height="44"/></clipPath></defs><rect width="256" height="44" fill="url(#${id}-sky)"/><rect class="kanso-dawn__night kanso-dawn__night--top" width="256" height="44"/><g clip-path="url(#${id}-clip)"><rect class="kanso-dawn__glow" width="256" height="44" fill="url(#${id}-glow)"/><g class="kanso-dawn__stars"><circle cx="14" cy="7" r=".7" opacity=".8"/><circle cx="44" cy="13" r=".5" opacity=".55"/><circle cx="212" cy="6" r=".6" opacity=".7"/><circle cx="240" cy="15" r=".5" opacity=".45"/><circle cx="84" cy="5" r=".45" opacity=".5"/></g><g class="kanso-dawn__clouds kanso-dawn__clouds--sun" stroke-linecap="round" fill="none"><path d="M28 31h58" stroke-width="1.6" opacity=".55"/><path d="M52 36h30" stroke-width="1.2" opacity=".5"/><path d="M162 28h64" stroke-width="1.6" opacity=".5"/><path d="M176 34h30" stroke-width="1.2" opacity=".45"/><path d="M6 39h40" stroke-width="1" opacity=".4"/><path d="M214 40h36" stroke-width="1" opacity=".4"/></g><g class="kanso-dawn__sun"><circle class="kanso-dawn__disc" cx="124" cy="44" r="10" opacity=".5"/><circle cx="124" cy="44" r="13" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="70 12" transform="rotate(-150 124 44)" class="kanso-dawn__circle kanso-dawn__circle--sun"/></g></g><rect y="44" width="256" height="12" fill="url(#${id}-fade)"/><path class="kanso-dawn__horizon kanso-dawn__horizon--sun" d="M0 44.5H256" stroke-width="1" opacity=".55"/></svg>`;

export const avatarSizes = { sm: ' kanso-avatar--sm', md: '', lg: ' kanso-avatar--lg' };
export const avatar = ({ initial, image, size, tone }) => {
  const picture = image ? `<img src="${escape(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  return `<span class="kanso-avatar kanso-avatar--round${avatarSizes[size] ?? ""}${tone ? ` kanso-text--host-${escape(tone)}` : ""}">${picture}${escape(initial.slice(0, 1))}</span>`;
};

// `initial`: the avatar's letter, none when empty; `where`: a path in mono; `step`: what it was doing; `content`: pieces in place of the prose `body`.
export const card = ({ author, image, age, body, loading, initial = author, where = '', step = '', content = '' }) => {
  const header = author ? `<div class="kanso-card__header">${initial ? avatar({ initial, image, size: 'md' }) : ''}<b>${escape(author)}</b>${step ? `${iconSvg('lu-chevron-right', 'inline', 'dim')}<span class="kanso-text--muted">${escape(step)}</span>` : ''}${where ? `<span class="kanso-text--dim kanso-text--code">${escape(where)}</span>` : ''}${grow()}<span class="kanso-text--dim">${escape(age)}</span></div>` : '';
  return `<div class="kanso-card${loading ? ' kanso-skeleton--shape' : ''}">${header}${content || `<div class="kanso-prose">${escape(body)}</div>`}</div>`;
};

const syntax = /("[^"\n]*"|'[^'\n]*'|`[^`]*`)|\b(\d+)\b|\b(import|from|export|default|function|const|let|var|return|if|else|for|while|async|await|new|class)\b/g;
const highlight = (line) => {
  let html = '', at = 0;
  for (const match of line.matchAll(syntax)) {
    const tone = match[1] ? 'string' : match[2] ? 'number' : 'keyword';
    html += `${escape(line.slice(at, match.index))}<span class="kanso-code__token--${tone}">${escape(match[0])}</span>`;
    at = match.index + match[0].length;
  }
  return html + escape(line.slice(at));
};
const signs = { '+': 'added', '-': 'deleted', '@': 'hunk' };
const failure = /\b(fail(ed|ure)?|\w*error|\w*exception)\b|^\s*>/i;
export const code = ({ text, kind, first, line }) => {
  const lines = text.split('\n');
  const numbers = kind === 'diff' ? diffNumbers(lines, first) : lines.map((_, index) => first + index);
  const rows = lines.map((source, index) => {
    const sign = kind === 'diff' ? signs[source[0]] : undefined;
    const classes = ['kanso-code__line', sign ? `kanso-code__line--${sign}` : '', numbers[index] === line ? 'kanso-control--on' : ''].filter(Boolean).join(' ');
    if (sign === 'hunk') return `<div class="${classes}">${escape(source)}</div>`;
    if (kind === 'log') return `<div class="${classes}"><span class="kanso-code__number"></span><span class="kanso-code__sign"> </span>${failure.test(source) ? `<span class="kanso-text--blocked">${escape(source)}</span>` : escape(source)}</div>`;
    const body = sign || (kind === 'diff' && source[0] === ' ') ? source.slice(1) : source;
    return `<div class="${classes}"><span class="kanso-code__number">${numbers[index] ?? ''}</span><span class="kanso-code__sign">${sign === 'added' ? '+' : sign === 'deleted' ? '-' : ' '}</span>${kind === 'source' ? highlight(body) : escape(body)}</div>`;
  }).join('');
  return `<div class="kanso-code">${rows}</div>`;
};

const shape = (markup) => markup.replace(' kanso-text--fg', '').replace(/class="([^"]*)"/, 'class="$1 kanso-skeleton--shape"');
const words = (text, skeleton) => skeleton ? `<span class="kanso-skeleton--shape kanso-skeleton--text">${escape(text)}</span>` : escape(text);
// A dialog asks for a name when it has a value or a placeholder; body goes under it, notes above the note.
export const dialog = ({ title, scope, value, placeholder, body = '', loading, notes = [], note, tone, primary, kind = 'solid', state, secondary }) => {
  const action = (label, look, emphasis) => (loading ? shape : String)(button({ label, kind: emphasis, ...(loading ? {} : { disabled: look === 'disabled', spin: look === 'loading', armed: look === 'armed' }) }));
  const field = value ? `${escape(value)}<span class="kanso-caret"></span>` : `<span class="kanso-caret"></span><span class="kanso-dialog__placeholder">${escape(placeholder)}</span>`;
  const asks = value || placeholder;
  const lines = [...notes, ...(note ? [{ text: note, tone }] : [])];
  return `<div class="kanso-dialog kanso-popover"><div class="kanso-dialog__header"><span class="kanso-dialog__title">${words(title, loading)}</span></div>`
    + (scope ? `<div class="kanso-dialog__scope">${words(scope, loading)}</div>` : '')
    + (asks ? `<div class="kanso-field${loading ? ' kanso-skeleton--shape' : ' kanso-control--focus'} kanso-dialog__section" tabindex="0">${field}</div>` : '')
    + body
    + lines.map(({ text, tone: look = 'dim' }) => `<div class="kanso-dialog__note${look === 'dim' ? '' : ` kanso-dialog__note--${look}`}">${words(text, loading)}</div>`).join('')
    + `<div class="kanso-dialog__footer">${secondary ? action(secondary, 'default', 'quiet') : ''}${action(primary, state, kind)}</div></div>`;
};

export const input = ({ text: value, label: placeholder, icon, error, disabled, multiline, inline: rename, selected, loading, limit }) => {
  const editable = !disabled && !loading;
  const enter = multiline ? '' : ` onkeydown="if (event.key === 'Enter') event.preventDefault()"`;
  const cap = ` onbeforeinput="if (event.inputType.startsWith('insert') && this.innerText.length >= ${limit}) event.preventDefault()"`;
  const text = `<div class="kanso-field__editor" role="textbox" aria-label="${escape(placeholder)}" aria-multiline="${multiline}" contenteditable="${editable}"${editable ? ' tabindex="0"' : ''}${enter}${cap}>${selected ? `<span class="kanso-field__selection">${escape(value.slice(0, limit))}</span>` : escape(value.slice(0, limit))}</div>`;
  const action = icon === 'none' || rename ? '' : `<span class="kanso-button kanso-button--icon" tabindex="0"><svg class="kanso-icon kanso-icon--row"><use href="#${icon}"/></svg></span>`;
  const classes = `kanso-field${multiline ? ' kanso-field--multiline' : ''}${rename ? ' kanso-field--inline' : ''}${loading ? ' kanso-skeleton--shape' : `${error ? ' kanso-field--invalid' : ''}${disabled ? ' kanso-control--off' : ''}`}`;
  return `<div class="${classes}"${disabled ? ' aria-disabled="true"' : ''}>${text}${action}</div>`;
};

const inline = (text) => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const cells = (row, tag) => `<tr>${row.split('|').slice(1, -1).map((cell) => `<${tag}>${inline(cell.trim())}</${tag}>`).join('')}</tr>`;
const blocksOf = (source) => source.trim().split(/\n\s*\n/).map((block) => {
  const lines = block.split('\n');
  if (block.startsWith('## ')) return `<div class="kanso-markdown__subheading">${inline(block.slice(3))}</div>`;
  if (block.startsWith('# ')) return `<div class="kanso-markdown__heading">${inline(block.slice(2))}</div>`;
  if (lines.every((line) => line.trim().startsWith('|'))) return `<table class="kanso-markdown__table">${lines.filter((line) => !/^\s*\|[\s:|-]+\|\s*$/.test(line)).map((line, index) => cells(line.trim(), index ? 'td' : 'th')).join('')}</table>`;
  if (lines.every((line) => line.startsWith('- '))) return `<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`;
  return `<p>${lines.map(inline).join(' ')}</p>`;
});
export const markdown = ({ source, block, state }) => `<div class="kanso-markdown">${blocksOf(source).map((html, index) => {
  const on = index + 1 === block ? { hover: ' kanso-row--hover', editing: ' kanso-editor--editing kanso-control--focus' }[state] ?? '' : '';
  return `<div class="kanso-markdown__block${on}"${on.includes('editing') ? ' contenteditable="true"' : ''}>${html}</div>`;
}).join('')}</div>`;

export const menu = ({ title, items }) => {
  const rows = (Array.isArray(items) ? items : []).map((item) => {
    if (item.separator) return '<div class="kanso-menu__separator"></div>';
    if (item.heading) return `<div class="kanso-menu__heading">${escape(item.heading)}</div>`;
    const lead = item.icon ? glyph(item.icon) : '<span class="kanso-menu__spacer"></span>';
    const classes = `kanso-menu__item${item.armed ? ' kanso-action--armed' : item.selected ? ' kanso-control--selected' : item.hover ? ' kanso-control--hover' : ''}`;
    const label = item.armed ? `Press again to ${escape(item.verb || String(item.label ?? '').toLowerCase())}` : escape(item.label ?? '');
    return `<div class="${classes}" role="menuitem" tabindex="0">${lead}${grow(label)}`
      + (item.badge ? `<span class="kanso-menu__badge">${escape(item.badge)}</span>` : '')
      + (item.hint ? `<span class="kanso-menu__hint">${escape(item.hint)}</span>` : '') + (item.mark ? mark({ status: item.mark }) : '') + '</div>';
  }).join('');
  return `<div class="kanso-menu kanso-popover" role="menu">${title ? `<div class="kanso-menu__heading">${escape(title)}</div>` : ''}${rows}</div>`;
};

export const metric = ({ value, unit, facts = '', loading = false }) => {
  const piece = (text, element) => `<span class="${element}${loading ? ' kanso-skeleton--shape kanso-skeleton--text' : ''}">${escape(text)}</span>`;
  const list = facts.split('|').map((fact) => fact.trim()).filter(Boolean);
  return `<div class="kanso-metric">${piece(value, 'kanso-metric__value')}${unit ? piece(unit, 'kanso-metric__unit') : ''}</div>`
    + (list.length ? `<div class="kanso-panel__facts">${list.map((fact) => loading ? `<span class="kanso-skeleton--shape kanso-skeleton--text">${escape(fact)}</span>` : `<span>${escape(fact)}</span>`).join('')}</div>` : '');
};

// An icon by name: a program's own art or a Lucide icon, at a control's or a row's size; a tone colours it.
const iconSvg = (icon, size, tone = '') => `<svg class="${tone ? `kanso-text--${escape(tone)} ` : ''}${icon.startsWith('p-') ? 'kanso-icon--program' : size === 'row' ? 'kanso-icon kanso-icon--row' : 'kanso-icon'}"><use href="#${escape(icon)}"/></svg>`;
export const glyph = (icon, tone = '') => iconSvg(icon, 'row', tone);
const flip = "if (this.getAttribute('aria-disabled')) return; this.setAttribute('aria-checked', this.classList.toggle('kanso-control--on'))";
export const toggle = ({ checked, label, disabled }) => `<span class="kanso-switch${checked ? ' kanso-control--on' : ''}${disabled ? ' kanso-control--off' : ''}" role="switch" aria-checked="${checked}" aria-label="${escape(label)}" tabindex="0"${disabled ? ' aria-disabled="true"' : ''} onclick="${flip}" onkeydown="if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); this.click(); }"><i></i></span>`;
// The lines that end every piece's right-click Menu.
export const pieceLines = [{ separator: true }, { icon: 'lu-check', label: 'Only when needed' }, { icon: 'lu-eye-off', label: 'Hide this' }, { icon: 'lu-sliders-vertical', label: 'Settings for this…' }];
export const marks = { working: 'e-work', blocked: 'e-blk', done: 'e-done', idle: 'e-idle', asleep: 'lu-moon' };
export const markSizes = { sm: ' kanso-icon--inline', md: '', lg: ' kanso-icon--control' };
export const mark = ({ status, size = 'md' }) => `<svg class="kanso-mark kanso-mark--${status}${markSizes[size]}"><use href="#${marks[status]}"/></svg>`;

export const chip = ({ label, quiet = false, pill = false, tone = '' }) => `<span class="kanso-badge${quiet ? ' kanso-badge--quiet' : ''}${pill ? ' kanso-badge--pill' : ''}${tone ? ` kanso-text--${escape(tone)}` : ''}">${escape(String(label))}</span>`;
// A fact's `tone` colours it and its `tip` names what it holds.
const marked = ({ tone, tip }, base = '') => `${base || tone ? ` class="${[base, tone && `kanso-text--${escape(tone)}`].filter(Boolean).join(' ')}"` : ''}${tip ? ` title="${escape(tip)}"` : ''}`;
const fact = (part) => typeof part === 'string' ? `<span>${escape(part)}</span>` : `${part.icon ? `<svg class="kanso-icon kanso-icon--inline"><use href="#${escape(part.icon)}"/></svg>` : ''}<span${marked(part)}>${escape(part.text)}</span>`;
const factOf = (part) => (typeof part === 'object' ? part : { text: part });
const countOf = (count) => (typeof count === 'object' ? `<span${marked(count)}>${chip({ label: count.label })}</span>` : chip({ label: count }));
const guide = (kind, level) => (kind ? `<span class="kanso-row__guide kanso-row__guide--${escape(kind)} kanso-row__guide--level-${level}"></span>` : '');
const rowTool = (action) => button({ kind: 'icon', size: 'sm', ...action });
export const rowDepths = [0, 1, 2];
// `actions` show on hover or focus and take the meta's place; `action` and the drawn `tools` are always shown; `keys` are the row's key hints, last.
// The title form is a panel's heading: the name at title size, the second line its scope.
// `second` and `meta` take facts with a tone, `chip` a tip; `drop` is where a dragged row lands, `wash` a state's ground, `guides` one per depth above it ('tee', 'end', 'pass', or null), under that depth's icon; without them a deeper row hangs from its parent.
export const row = ({ icon = 'none', tone = '', name, detail, meta, chip: count, flag, mark: status = 'none', second, heading, title, depth = 0, glint, selected, current, dimmed, pending, hover, focus, actions = [], action, start = [], tools = [], keys = [], drop, wash, guides = [] }) => {
  const lines = guides.length ? guides : depth > 1 ? [null, 'pass'] : [];
  const lead = `${lines.map(guide).join('')}${list(start)}${icon === 'none' ? '' : glyph(icon, tone)}`;
  const label = `<span class="kanso-row__name${glint ? ' kanso-text--glint' : ''}">${escape(name)}</span>`;
  const facts = [].concat(detail ?? []).filter(Boolean);
  const tail = `${facts.length ? `<span class="kanso-row__detail">${facts.map(fact).join('')}</span>` : ''}${grow()}`
    + `${meta ? `<span${marked(factOf(meta), 'kanso-row__meta')}>${escape(factOf(meta).text)}</span>` : ''}${flag ? `<span class="kanso-row__flag">${glyph(flag)}</span>` : ''}`
    + `${actions.length ? `<span class="kanso-row__actions">${actions.map(rowTool).join('')}</span>` : ''}${count ? countOf(count) : ''}${action ? button({ size: 'sm', ...action }) : ''}${list(tools)}${keys.map(keyHint).join('')}`
    + `${pending ? '<span class="kanso-state-line__pending-dot"></span>' : ''}${!status || status === 'none' ? '' : mark({ status })}`;
  const states = [second && 'kanso-row--two-lines', heading && 'kanso-row--heading', title && 'kanso-row--title', depth && `kanso-row--depth-${depth}`, selected && 'kanso-control--selected', current && 'kanso-row--selected',
    dimmed && 'kanso-control--dim', pending && 'kanso-state-line--pending', hover && 'kanso-control--hover', focus && 'kanso-control--focus',
    drop && `kanso-row--drop-${drop}`, wash && `kanso-row--wash-${wash}`, lines.length && 'kanso-row--tree'].filter(Boolean).map((name) => ` ${name}`).join('');
  return second
    ? `<div class="kanso-row${states}" tabindex="0"><div class="kanso-content__primary">${lead}${label}${tail}</div><div class="kanso-content__secondary">${typeof second === 'string' ? escape(second) : second.filter(Boolean).map(fact).join('')}</div></div>`
    : `<div class="kanso-row${states}" tabindex="0">${lead}${label}${tail}</div>`;
};

const bar = (shape) => `<span class="kanso-skeleton kanso-skeleton--${shape}"></span>`;
export const skeletonShapes = {
  row: () => `<div class="kanso-row">${bar('icon')}${bar('line')}${grow()}</div>`,
  'list row': () => `<div class="kanso-row">${bar('line')}${grow()}${bar('meta')}</div>`,
  header: () => `<div class="kanso-panel__header">${bar('title')}${grow()}${bar('control')}</div>`,
  line: () => `<div class="kanso-row">${bar('line')}</div>`,
  // Proposed: the app's loading states this kit lacked.
  'two lines': () => `<div class="kanso-row kanso-row--two-lines"><div class="kanso-content__primary">${bar('line')}${grow()}${bar('meta')}</div><div class="kanso-content__secondary">${bar('detail')}</div></div>`,
  picture: () => bar('picture'),
  metric: () => `<div class="kanso-skeleton__metric">${bar('value')}${bar('line')}<div class="kanso-skeleton__stats">${bar('stat').repeat(3)}</div></div>`,
  tile: () => `<div class="kanso-skeleton__tile">${bar('tile')}</div>`,
  device: () => bar('device'),
};
const drawnOnce = ['header', 'picture', 'metric', 'device'];
export const skeletonOf = ({ shape, count }) => `<div class="kanso-skeleton__list kanso-skeleton--breathing" role="status" aria-label="Loading">${Array.from({ length: drawnOnce.includes(shape) ? 1 : count }, (_, i) => skeletonShapes[shape](i)).join('')}</div>`;

export const tabNameLimit = 64;
const choose = "if (this.closest('.kanso-control--off')) return; for (const tab of this.parentNode.children) { tab.classList.toggle('kanso-tabs__tab--on', tab === this); tab.setAttribute('aria-selected', tab === this); }";
export const tabs = ({ items, value, size, track, disabled, icon, label: named }) => `<div class="kanso-tabs${size === 'md' ? '' : ` kanso-tabs--${size}`}${track ? ' kanso-tabs--track' : ''}${disabled ? ' kanso-control--off' : ''}" role="tablist"${disabled ? ' aria-disabled="true"' : ''}>${(Array.isArray(items) ? items : []).map((item) => {
  const on = item.key === value;
  const label = escape(item.label ?? '');
  const square = icon && !named;
  const states = [on && 'kanso-tabs__tab--on', square && 'kanso-tabs__tab--icon', item.armed && 'kanso-action--armed', item.pending && 'kanso-state-line--pending', item.held && 'kanso-control--held'].filter(Boolean).map((name) => ` ${name}`).join('');
  const name = item.editing ? input({ text: item.label ?? '', label: item.label ?? '', icon: 'none', inline: true, selected: true, limit: tabNameLimit }) : `<span class="kanso-tabs__label">${label}</span>`;
  return `${item.drop ? '<i class="kanso-tabs__insertion"></i>' : ''}<span class="kanso-tabs__tab${states}" role="tab" aria-selected="${on}" aria-label="${label}" tabindex="0" title="${square ? label : escape(item.tip ?? '')}" onclick="${choose}">`
    + `${icon && item.icon ? glyph(item.icon) : ''}${named || !item.icon ? name : ''}${item.pending ? '<i class="kanso-state-line__pending-dot"></i>' : ''}${item.mark && !square ? mark({ status: item.mark }) : ''}`
    + `${(item.dot || (square && item.mark === 'blocked')) && !on ? '<i class="kanso-tabs__dot"></i>' : ''}${on && item.closable && !square && !item.editing ? '<svg class="kanso-icon kanso-tabs__close"><use href="#lu-x"/></svg>' : ''}</span>`;
}).join('')}</div>`;

export const thumbnail = ({ image, label, selected, loading }) => `<span class="kanso-thumbnail${selected ? ' kanso-control--selected' : ''}${loading ? ' kanso-skeleton--shape' : ''}" role="button" aria-pressed="${selected}" aria-label="${escape(label)}" title="${escape(label)}" tabindex="0">${image && !loading ? `<img src="${escape(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>`;

export const levels = { error: 'blocked', warning: 'working', success: 'done', info: 'accent' };
const lead = (level) => level === 'error' ? '<svg class="kanso-mark kanso-mark--blocked" aria-hidden="true"><use href="#e-blk"/></svg>'
  : level === 'success' ? '<svg class="kanso-icon kanso-icon--row kanso-text--done" aria-hidden="true"><use href="#lu-check"/></svg>'
  : `<i class="kanso-toast__dot kanso-fill--${levels[level]}"></i>`;
// `mark` stands in for the level's mark; `tone` colours an icon apart from the level; `detail` is the tool's words, in the tooltip.
export const toast = ({ level = 'info', icon = 'none', title, body, action, explain, mark: status, tone, detail }) => {
  const fix = action ? button({ label: action, kind: 'tonal', size: 'sm' }) : '';
  const ask = explain ? explainButton({ agent: explain, size: 'sm' }) : '';
  const text = body ? `<span class="kanso-toast__text"><span>${escape(title)}</span><span class="kanso-toast__body">${escape(body)}</span></span>` : `<span class="kanso-content__text">${escape(title)}</span>`;
  const head = status ? mark({ status }) : icon === 'none' ? lead(level) : glyph(icon, tone || levels[level]);
  return `<div class="kanso-toast kanso-popover${body ? ' kanso-toast--two-lines' : ''}" role="status"${detail ? ` title="${escape(detail)}"` : ''}>${head}${text}${fix}${ask}</div>`;
};

// Explain to <agent>: the bot icon and the agent named in words.
export const explainButton = ({ agent, size = 'md' }) => button({ label: `Explain to ${agent}`, kind: 'tonal', size, icon: 'lu-bot' });

export const sides = ['auto', 'top', 'bottom', 'left', 'right'];
// Auto takes the side with the most room around the control, measured when it opens.
const place = "const tip = this.nextElementSibling, box = this.getBoundingClientRect(), room = { top: box.top, bottom: innerHeight - box.bottom, left: box.left, right: innerWidth - box.right }; const side = Object.keys(room).reduce((a, b) => room[b] > room[a] ? b : a); tip.className = tip.className.replace(/kanso-tooltip--(top|bottom|left|right)/, 'kanso-tooltip--' + side)";
// A tooltip: the label, the chord (as the computer writes it) and any detail in dim. The app writes the same words, its chord from the key table.
export const tooltip = ({ label, detail, chord, icon, open, side }) => `<span class="kanso-tooltip__trigger"><span class="kanso-button kanso-button--icon" tabindex="0" aria-label="${escape(label)}"${side === 'auto' ? ` onmouseenter="${place}" onfocus="${place}"` : ''}><svg class="kanso-icon"><use href="#${icon}"/></svg></span>`
  + `<span class="kanso-tooltip kanso-popover kanso-tooltip--${side === 'auto' ? 'bottom' : side}${open ? ' kanso-tooltip--open' : ''}" role="tooltip">${escape(label)}${chord ? ` <span>${escape(chord)}</span>` : ''}${detail ? ` <span>· ${escape(detail)}</span>` : ''}</span></span>`;

// A setting: its label, its control at the right, and an optional note under both with one quiet link.
export const setting = ({ label, control, note, link }) => `<div class="kanso-setting"><span class="kanso-setting__label">${escape(label)}</span>${control ?? ''}`
  + `${note || link ? `<div class="kanso-setting__note">${note ? escape(note) : ''}${link ? ` ${link}` : ''}</div>` : ''}</div>`;

// A key hint: the chord beside the action it runs; faint when it says nothing now, recording while a key is captured.
export const keyHint = ({ text, faint = false, recording = false }) => `<span class="kanso-key${faint ? ' kanso-text--dim' : ''}${recording ? ' kanso-key--recording kanso-ring--accent kanso-text--accent' : ''}">${escape(text)}</span>`;

// One key of the keyboard map; `units` is its width in keys. A lit key is pressed, a hinted one is the next to press; the corner glyph and the finger sit on the key.
const keycapClass = { free: '', herdr: ' kanso-keyboard__key--available', kanso: ' kanso-keyboard__key--bound', held: ' kanso-control--held', picked: ' kanso-control--on', lit: ' kanso-keyboard__key--lit' };
export const keycapStates = Object.keys(keycapClass);
export const keycap = ({ label, units = 1, state = 'free', hover = false, hint = false, corner = '', finger = '', inert = false }) => `<span class="kanso-keyboard__key${keycapClass[state]}${hint ? ' kanso-keyboard__key--hint' : ''}${hover ? ' kanso-control--hover' : ''}${units === 1 ? '' : ` kanso-keyboard__key--units-${String(units).replace('.', '-')}`}"${inert ? '' : ' role="button" tabindex="0"'}>${escape(label ?? '')}`
  + `${corner ? `<span class="kanso-keyboard__corner">${escape(corner)}</span>` : ''}${finger ? `<span class="kanso-keyboard__finger">${escape(finger)}</span>` : ''}</span>`;

// The picked key: its chord, what it does or Nothing, its layer, then the acts on it.
export const keyPicked = ({ chord, meaning = null, layer = null, actions = [] }) => `<div class="kanso-keyboard__selection"><span class="kanso-keyboard__chord">${escape(chord)}</span>`
  + `<span class="kanso-keyboard__meaning${meaning ? '' : ' kanso-text--muted'}">${escape(meaning ?? 'Nothing')}</span>${layer ? `<span class="kanso-keyboard__layer">${escape(layer)}</span>` : ''}`
  + `${list(actions) ? `<div class="kanso-actions">${list(actions)}</div>` : ''}</div>`;

// Pane header pieces: one fact per segment, its parts each in their own tone; `act` opens the fact's home.
export const headerSegment = ({ parts = [], icon = null, tone = null, title = null, act = false }) => `<span class="kanso-pane-header__segment${act ? ' kanso-pane-header__segment--act' : ''}${tone ? ` kanso-text--${escape(tone)}` : ''}"`
  + `${act ? ' role="button" tabindex="0"' : ''}${title ? ` title="${escape(title)}"` : ''}>${icon ? `<svg class="kanso-icon kanso-icon--inline"><use href="#${escape(icon)}"/></svg>` : ''}`
  + `${parts.filter(Boolean).map(({ text, tone: ink }) => `<span${ink ? ` class="kanso-text--${escape(ink)}"` : ''}>${escape(text)}</span>`).join('')}</span>`;
export const paneName = ({ name }) => `<span class="kanso-pane-header__name">${escape(name)}</span>`;
// Facts as words (diffText, facts, plus): the app's own, so the Storybook and the panels say them the same.
export { diffText, facts, plus };

// Status bar pieces: each item is a Mark or an icon with its words, in the bar's meta size.
const inlineIcon = (name) => `<svg class="kanso-icon kanso-icon--inline"><use href="#${escape(name)}"/></svg>`;
export const statusItem = ({ icon = '', mark: status = '', text = '', tone = '', pending = false, open = false } = {}) => `<span class="kanso-status-bar__item${tone ? ` kanso-text--${escape(tone)}` : ''}${pending ? ' kanso-state-line--pending' : ''}${open ? ' kanso-status-bar__item--open' : ''}">`
  + `${status ? mark({ status, size: 'sm' }) : icon ? inlineIcon(icon) : ''}${text === '' || text === null ? '' : `<span>${escape(String(text))}</span>`}${pending ? '<i class="kanso-state-line__pending-dot"></i>' : ''}</span>`;

// The failure pattern on a bar: the blocked mark, our words, one small quiet fix.
export const failureLine = ({ text, fix, detail = '' }) => `<span class="kanso-state-line"${detail ? ` title="${escape(detail)}"` : ''}>${mark({ status: 'blocked' })}${escape(text)}${button({ label: fix, kind: 'quiet', size: 'sm' })}</span>`;
// The failure pattern in a panel, where the list would start: our words, the source's words, the fix, then Explain.
export const failureBlock = ({ text, source = '', fix, agent = '' }) => `<div class="kanso-state-block" role="alert">${mark({ status: 'blocked' })}<div class="kanso-state-block__what">${escape(text)}</div>`
  + `${source ? `<div class="kanso-state-block__why" title="${escape(source)}">${escape(source)}</div>` : ''}<div class="kanso-state-block__actions">${button({ label: fix, kind: 'solid' })}${agent ? explainButton({ agent }) : ''}</div></div>`;
// The empty pattern: the view's icon, one sentence, at most one action.
export const emptyState = ({ icon = '', text, action = '' }) => `<div class="kanso-state-empty">${icon ? glyph(icon) : ''}<div class="kanso-content__text">${escape(text)}</div>${action ? button({ label: action, kind: 'tonal' }) : ''}</div>`;
export const statePatterns = ['failure', 'empty', 'pending', 'loading'];

export const needsItem = ({ name, question = '', more = 0 }) => `<span class="kanso-status-bar__item kanso-status-bar__needs">${mark({ status: 'blocked', size: 'sm' })}<span class="kanso-status-bar__name">${escape(name)}</span>`
  + `${question ? `<span class="kanso-status-bar__question">${escape(question)}</span>` : ''}${more ? `<span class="kanso-status-bar__more">${plus(more)}</span>` : ''}</span>`;

// Panes per view: the number at rest, − and + on hover; its keys are in the tooltips.
export const stepper = ({ value = 2, open = false, hover = false } = {}) => `<span class="kanso-status-bar__item kanso-status-bar__stepper${open ? ' kanso-status-bar__item--open' : ''}${hover ? ' kanso-control--hover' : ''}">${button({ label: 'Fewer panes per view ⌘⇧−', kind: 'icon', size: 'sm', icon: 'lu-minus' })}`
  + `<span class="kanso-status-bar__value" title="${Number(value)} per view · scroll to change, click to even out">${Number(value)}</span>${button({ label: 'More panes per view ⌘⇧=', kind: 'icon', size: 'sm', icon: 'lu-plus' })}</span>`;

export const tabSkeleton = () => '<span class="kanso-skeleton kanso-skeleton--breathing kanso-tab-bar__skeleton"></span>';

// The dōjō's pieces: the title, a level on the path, the round's numbers, a cell, a character, Hachi, the line under him and a key.
export const dojoTitle = ({ title, level, name }) => `<span class="kanso-content__text">${escape(title)}</span><span class="kanso-level__label">level ${Number(level)} · ${escape(name)}</span>`;
export const dojoLevel = ({ number, name, best = '', done = false, current = false, focus = false }) => `<div class="kanso-dojo__level${done ? ' kanso-row--done' : ''}${current ? ' kanso-control--current' : ''}${focus ? ' kanso-control--focus' : ''}">`
  + `<span class="kanso-level__node"></span><span class="kanso-dojo__name"><span class="kanso-annotation--inactive">${Number(number)}</span>${escape(name)}</span><span class="kanso-content__secondary">${escape(best)}</span></div>`;
// Keys and what they do, one group per action.
export const keyLegend = ({ items }) => items.map(({ keys, label }) => `<span class="kanso-dojo__legend">${keys.map((text) => keyHint({ text })).join('')}<span>${escape(label)}</span></span>`).join('');
export const dojoStatistics = ({ score, time, streak, moves = null, need = 0 }) => `<div class="kanso-dojo__statistics"><span>score <b>${Number(score)}</b></span><span>${escape(time)}</span><span>streak <b>${Number(streak)}</b></span>${grow()}`
  + `${moves === null ? '' : `<span class="kanso-section__count"><b${moves > need ? ' class="kanso-text--working"' : ''}>${Number(moves)}</b> ${moves === 1 ? 'move' : 'moves'} · this one takes ${Number(need)} at best</span>`}</div>`;
export const dojoProgress = ({ reached, total }) => `<div class="kanso-dojo__progress-strip">${Array.from({ length: total }, (_, index) => `<i class="${index < reached ? 'kanso-content__description' : index === reached ? 'kanso-row__name' : ''}"></i>`).join('')}</div>`;
// A spot on the board: where you are, the goal, the best path with its first key.
const spot = ({ current, goal, trail }) => `${current ? ' kanso-cell--current' : ''}${goal ? ' kanso-cell--goal' : ''}${trail ? ' kanso-text--truncate' : ''}`;
export const dojoCell = ({ hint = '', goal, ...look }) => `<i class="kanso-dojo__cell${spot({ goal, ...look })}">${goal ? '<b></b>' : hint ? `<em>${escape(hint)}</em>` : ''}</i>`;
export const dojoCharacter = ({ character, ...look }) => `<i class="kanso-dojo__character${spot(look)}">${character === ' ' ? '&nbsp;' : escape(character)}</i>`;
const inks = { O: 'outline', F: 'fur', C: 'cream', D: 'light', K: 'eye', N: 'nose', T: 'accent', B: 'blue' };
export const mascot = ({ pixels }) => `<div class="kanso-dojo__mascot">${pixels.flat().map((ink) => `<i class="${inks[ink] ? `kanso-mascot__pixel--${inks[ink]}` : ''}"></i>`).join('')}</div>`;
export const dojoTones = { none: '', success: ' kanso-feedback--success', missed: ' kanso-feedback--missed', armed: ' kanso-button kanso-button--quiet kanso-action--armed' };
export const dojoFeedback = ({ text, tone = 'none' }) => `<div class="kanso-dojo__feedback${dojoTones[tone]}">${escape(text)}</div>`;
export const dojoRecord = ({ value, unit, record = '' }) => `<div class="kanso-dojo__result-heading">${metric({ value, unit })}${record ? `<span class="kanso-dojo__record">${escape(record)}</span>` : ''}</div>`;
export const dojoSummary = ({ text }) => `<div class="kanso-dojo__result-label">${escape(text)}</div>`;
export const sleepLabel = ({ text }) => `<span class="kanso-dojo__sleep-label">${escape(text)}</span>`;

// One layout piece for the wrappers that only place other pieces; each variant keeps its own class and states.
export const stacks = {
  toolbar: { block: 'kanso-toolbar', states: ['column'] },
  'toolbar group': { block: 'kanso-toolbar__group', states: ['open'] },
  'toolbar sort': { block: 'kanso-toolbar__sort', tag: 'span', states: ['sorted'] },
  'toolbar add': { block: 'kanso-toolbar__add', tag: 'span' },
  'toolbar menu': { block: 'kanso-toolbar__menu', tag: 'span' },
  header: { block: 'kanso-header', states: ['collapsed'] },
  'header title': { block: 'kanso-header__title' },
  sidebar: { block: 'kanso-sidebar', tag: 'aside' },
  rows: { block: 'kanso-sidebar__rows' },
  'row group': { block: 'kanso-sidebar__row-group' },
  'view switch': { block: 'kanso-sidebar__view-switch' },
  'view menu': { block: 'kanso-sidebar__view-menu' },
  footer: { block: 'kanso-sidebar__footer' },
  rail: { block: 'kanso-rail', tag: 'aside' },
  'rail list': { block: 'kanso-rail__list' },
  'rail tile': { block: 'kanso-rail__tile', focusable: true },
  'rail footer': { block: 'kanso-rail__footer' },
  'sidebar frame': { block: 'kanso-sidebar' },
  'rail frame': { block: 'kanso-rail' },
  'status bar': { block: 'kanso-status-bar', states: ['grid'] },
  'status bar left': { block: 'kanso-status-bar__left' },
  'status bar middle': { block: 'kanso-status-bar__middle' },
  'status bar right': { block: 'kanso-status-bar__right' },
  'status bar popup': { block: 'kanso-status-bar__popup' },
  edge: { block: 'kanso-edge', states: ['target'] },
  'edge column': { block: 'kanso-edge__column', tag: 'span' },
  'edge more': { block: 'kanso-edge__more', tag: 'span' },
  'edge menu': { block: 'kanso-edge__menu', tag: 'span', states: ['left', 'right'] },
  'tab bar': { block: 'kanso-tab-bar' },
  'tab bar more': { block: 'kanso-tab-bar__more', tag: 'span' },
  'tab bar menu': { block: 'kanso-tab-bar__menu', tag: 'span' },
  'tab bar doors': { block: 'kanso-tab-bar__doors', tag: 'span' },
  away: { block: 'kanso-away', tag: 'section' },
  keyboard: { block: 'kanso-keyboard' },
  'keyboard row': { block: 'kanso-keyboard__row' },
  'keyboard layout': { block: 'kanso-keyboard__layout' },
  toasts: { block: 'kanso-toasts' },
  'pane header': { block: 'kanso-pane-header', states: ['focus', 'keyboard', 'blocked', 'unreachable', 'held'] },
  'pane digest': { block: 'kanso-pane-header__digest', tag: 'span' },
  'pane tools': { block: 'kanso-pane-header__tools', tag: 'span' },
  'pane more': { block: 'kanso-pane-header__more', tag: 'span' },
  'pane menu': { block: 'kanso-pane-header__menu', tag: 'span' },
  panel: { block: 'kanso-panel', states: ['narrow', 'window', 'stale'] },
  'panel header': { block: 'kanso-panel-header', states: ['bar'] },
  dojo: { block: 'kanso-dojo' },
  'dojo header': { block: 'kanso-dojo__header' },
  'dojo body': { block: 'kanso-dojo__body' },
  'dojo path': { block: 'kanso-dojo__path' },
  'dojo path keys': { block: 'kanso-dojo__path-keys' },
  'dojo main': { block: 'kanso-dojo__main' },
  'dojo board': { block: 'kanso-dojo__board', states: ['result'] },
  'dojo grid': { block: 'kanso-dojo__grid' },
  'dojo text': { block: 'kanso-dojo__text' },
  'dojo line': { block: 'kanso-dojo__line' },
  'dojo conversation': { block: 'kanso-dojo__conversation' },
  'dojo result keys': { block: 'kanso-dojo__result-keys' },
  'dojo menu': { block: 'kanso-dojo__menu' },
};
export const stack = ({ variant, on = false, ...flags }, ...children) => {
  if (!Object.hasOwn(stacks, variant)) throw new Error(`stack: unknown variant "${variant}"`);
  const { block, tag = 'div', states = [], focusable = false } = stacks[variant];
  const unknown = Object.keys(flags).find((flag) => !states.includes(flag));
  if (unknown) throw new Error(`stack: variant "${variant}" has no state "${unknown}"`);
  const classes = [block, ...states.filter((state) => flags[state]).map((state) => `${block}--${state}`), on ? 'kanso-control--on' : ''].filter(Boolean).join(' ');
  return `<${tag} class="${classes}"${focusable ? ' tabindex="0"' : ''}>${list(children)}</${tag}>`;
};

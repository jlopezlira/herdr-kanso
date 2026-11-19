// The kit's pieces: every function here returns markup; compositions.js only calls them.
import { diffText, facts, plus } from '../../kanso/mods/kanso-panel/ui-facts.js';
import { diffNumbers, markdownBlocks } from '../../kanso/mods/kanso-spaces/pure.js';

export const escape = (text) => String(text).replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

// Children are pieces, arrays of pieces, or null/false for nothing.
export const list = (...children) => children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false).join('');

// A label made of words and values, such as a name inside an action's title.
export const phrase = (...parts) => parts.join(' ');
// A tool: its icon and the label its tooltip reads.
export const icon = (name, label) => ({ icon: name, label });
// A chord: its keys' names joined as the computer writes them, ⌥⌘H or Alt+L.
export const chord = (join, ...parts) => parts.join(join ?? '');

export const grow = (inner = '') => `<span class="kanso-layout__grow">${inner}</span>`;
export const dot = (tone) => `<i class="kanso-dot kanso-dot--${escape(tone)}"></i>`;

// Atoms

export const kinds = { solid: 'kanso-button--solid', tonal: 'kanso-button--tonal', quiet: 'kanso-button--quiet kanso-text--fg', icon: 'kanso-button--icon' };
// `content`: markup drawn in place of the icon and label, such as a picture with its name; `label` is then what the button says.
// Proposed: `truncate` cuts a long label at --k-w-button-label, such as a menu's chosen project, so the button never grows past it.
// `tip`: the tooltip, when it says more than the label; `focus`: the keyboard's ring is on it.
const liveStates = ({ hover, focus, pressed }) => [hover && 'kanso-control--hover', focus && 'kanso-control--focus', pressed && 'kanso-control--active'].filter(Boolean);
export const button = ({ label, kind = 'solid', size = 'md', icon = 'none', disabled = false, verb = '', armed = false, active = false, spin = false, key = '', tip = '', hover = false, focus = false, pressed = false, content = '', truncate = false, flush = false, name = '' }) => {
  const classes = ['kanso-button', kinds[kind], size === 'md' ? '' : `kanso-button--${size}`, disabled ? 'kanso-control--off' : '', armed ? 'kanso-action kanso-action--armed' : '', active ? 'kanso-button--active' : '', spin ? 'kanso-button--spinning' : '', ...liveStates({ hover, focus, pressed }), content ? 'kanso-button--drawn' : '', flush ? 'kanso-button--flush' : '', truncate ? 'kanso-button--truncate' : ''].filter(Boolean).join(' ');
  const lead = icon === 'none' ? (spin ? mark({ status: 'working', size: 'sm' }) : '') : iconSvg(icon, 'control');
  const text = kind === 'icon' ? '' : truncate ? `<span class="kanso-button__label">${escape(label)}</span>` : escape(label);
  const again = `Press again to ${escape(verb || label.toLowerCase())}`;
  const inner = content || (armed && kind !== 'icon' ? `<span>${text}</span><span>${again}</span>` : `${lead}${text}${key ? ` ${keyHint({ text: key })}` : ''}`);
  return `<span class="${classes}"${disabled ? ' aria-disabled="true"' : ' tabindex="0"'} title="${armed && kind === 'icon' ? again : escape(tip || label)}"${spin ? ' aria-busy="true"' : ''}>${inner}</span>`;
};

export const windowControls = () => '<span class="kanso-window-controls"><i></i><i></i><i></i></span>';

export const dawn = ({ id = 'dawn' } = {}) => `<svg class="kanso-dawn kanso-dawn--rising" viewBox="0 0 256 56" preserveAspectRatio="xMidYMin slice" aria-hidden="true"><defs><linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="44" gradientUnits="userSpaceOnUse"><stop class="kanso-dawn__stop kanso-dawn__stop--top" offset="0"/><stop class="kanso-dawn__stop kanso-dawn__stop--mid" offset=".45"/><stop class="kanso-dawn__stop kanso-dawn__stop--low" offset=".8"/><stop class="kanso-dawn__stop kanso-dawn__stop--edge" offset="1"/></linearGradient><radialGradient id="${id}-glow" cx="124" cy="44" r="78" gradientUnits="userSpaceOnUse" gradientTransform="translate(0 15.4) scale(1.65)"><stop class="kanso-dawn__stop kanso-dawn__stop--sun" offset="0"/><stop class="kanso-dawn__stop kanso-dawn__stop--haze" offset=".35"/><stop class="kanso-dawn__stop kanso-dawn__stop--edge-clear" offset="1"/></radialGradient><linearGradient id="${id}-fade" x1="0" y1="44" x2="0" y2="56" gradientUnits="userSpaceOnUse"><stop class="kanso-dawn__stop kanso-dawn__stop--mist" offset="0"/><stop class="kanso-dawn__stop kanso-dawn__stop--chrome-clear" offset="1"/></linearGradient><clipPath id="${id}-clip"><rect x="0" y="0" width="256" height="44"/></clipPath></defs><rect width="256" height="44" fill="url(#${id}-sky)"/><rect class="kanso-dawn__night kanso-dawn__night--top" width="256" height="44"/><g clip-path="url(#${id}-clip)"><rect class="kanso-dawn__glow" width="256" height="44" fill="url(#${id}-glow)"/><g class="kanso-dawn__stars"><circle cx="14" cy="7" r=".7" opacity=".8"/><circle cx="44" cy="13" r=".5" opacity=".55"/><circle cx="212" cy="6" r=".6" opacity=".7"/><circle cx="240" cy="15" r=".5" opacity=".45"/><circle cx="84" cy="5" r=".45" opacity=".5"/></g><g class="kanso-dawn__clouds kanso-dawn__clouds--sun" stroke-linecap="round" fill="none"><path d="M28 31h58" stroke-width="1.6" opacity=".55"/><path d="M52 36h30" stroke-width="1.2" opacity=".5"/><path d="M162 28h64" stroke-width="1.6" opacity=".5"/><path d="M176 34h30" stroke-width="1.2" opacity=".45"/><path d="M6 39h40" stroke-width="1" opacity=".4"/><path d="M214 40h36" stroke-width="1" opacity=".4"/></g><g class="kanso-dawn__sun"><circle class="kanso-dawn__disc" cx="124" cy="44" r="10" opacity=".5"/><circle cx="124" cy="44" r="13" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="70 12" transform="rotate(-150 124 44)" class="kanso-dawn__circle kanso-dawn__circle--sun"/></g></g><rect y="44" width="256" height="12" fill="url(#${id}-fade)"/><path class="kanso-dawn__horizon kanso-dawn__horizon--sun" d="M0 44.5H256" stroke-width="1" opacity=".55"/></svg>`;

export const avatarSizes = { sm: ' kanso-avatar--sm', md: '', lg: ' kanso-avatar--lg' };
export const avatar = ({ initial, image, size, tone, round = true }) => {
  const picture = image ? `<img src="${escape(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  return `<span class="kanso-avatar${round ? ' kanso-avatar--round' : ''}${avatarSizes[size] ?? ""}${tone ? ` kanso-text--host-${escape(tone)}` : ""}">${picture}${escape(initial.slice(0, 1))}</span>`;
};

export const well = ({ heading = '' } = {}, ...children) => `<div class="kanso-card">${heading ? `<div class="kanso-card__header"><b>${escape(heading)}</b></div>` : ''}${list(children)}</div>`;
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
    html += `${escape(line.slice(at, match.index))}<span class="kanso-code__token kanso-code__token--${tone}">${escape(match[0])}</span>`;
    at = match.index + match[0].length;
  }
  return html + escape(line.slice(at));
};
const signs = { '+': 'added', '-': 'deleted', '@': 'hunk' };
const failure = /\b(fail(ed|ure)?|\w*error|\w*exception)\b|^\s*>/i;
const gutter = (number, comment) => (number !== null && number !== undefined && number === comment ? button({ label: 'Comment on this line', kind: 'icon', size: 'sm', icon: 'lu-plus' }) : number ?? '');
export const code = ({ text, kind, first, line, comment }) => {
  const lines = text.split('\n');
  const numbers = kind === 'diff' ? diffNumbers(lines, first) : lines.map((_, index) => first + index);
  const rows = lines.map((source, index) => {
    const sign = kind === 'diff' ? signs[source[0]] : undefined;
    const classes = ['kanso-code__line', sign ? `kanso-code__line--${sign}` : '', numbers[index] === line ? 'kanso-control--on' : ''].filter(Boolean).join(' ');
    if (sign === 'hunk') return `<div class="${classes}">${escape(source)}</div>`;
    if (kind === 'log') return `<div class="${classes}"><span class="kanso-code__number"></span><span class="kanso-code__sign"> </span>${failure.test(source) ? `<span class="kanso-text--blocked">${escape(source)}</span>` : escape(source)}</div>`;
    const body = sign || (kind === 'diff' && source[0] === ' ') ? source.slice(1) : source;
    return `<div class="${classes}"><span class="kanso-code__number">${gutter(numbers[index], comment)}</span><span class="kanso-code__sign">${sign === 'added' ? '+' : sign === 'deleted' ? '-' : ' '}</span><span class="kanso-code__text">${kind === 'source' ? highlight(body) : escape(body)}</span></div>`;
  }).join('');
  return `<div class="kanso-code">${rows}</div>`;
};

const shape = (markup) => markup.replace(' kanso-text--fg', '').replace(/class="([^"]*)"/, 'class="$1 kanso-skeleton--shape"');
const words = (text, skeleton) => skeleton ? `<span class="kanso-skeleton--shape kanso-skeleton--text">${escape(text)}</span>` : escape(text);
// A dialog asks for a name when it has a value or a placeholder; body goes under it, notes above the note.
const dialogSizes = { md: '', window: ' kanso-dialog--window', find: ' kanso-dialog--find' };
export const dialog = ({ title, label = title, tools = '', size = 'md', scope, value, placeholder, body = '', loading, notes = [], note, tone, primary, kind = 'solid', state, secondary }) => {
  const action = (label, look, emphasis) => (loading ? shape : String)(button({ label, kind: emphasis, ...(loading ? {} : { disabled: look === 'disabled', spin: look === 'loading', armed: look === 'armed' }) }));
  const field = value ? `${escape(value)}<span class="kanso-caret"></span>` : `<span class="kanso-caret"></span><span class="kanso-dialog__placeholder">${escape(placeholder)}</span>`;
  const asks = value || placeholder;
  const lines = [...notes, ...(note ? [{ text: note, tone }] : [])];
  const header = title || list(tools) ? `<div class="kanso-dialog__header">${title ? `<span class="kanso-dialog__title">${words(title, loading)}</span>` : ''}${list(tools)}</div>` : '';
  const sized = size !== 'md';
  return `<div class="kanso-dialog${dialogSizes[size]} kanso-popover"${sized ? ` role="dialog" aria-label="${escape(label)}"` : ''}>${header}`
    + (scope ? `<div class="kanso-dialog__scope">${words(scope, loading)}</div>` : '')
    + (asks ? `<div class="kanso-field${loading ? ' kanso-skeleton--shape' : ' kanso-control--focus'} kanso-dialog__section" tabindex="0">${field}</div>` : '')
    + (sized && body ? `<div class="kanso-dialog__body">${body}</div>` : body)
    + lines.map(({ text, tone: look = 'dim' }) => `<div class="kanso-dialog__note${look === 'dim' ? '' : ` kanso-dialog__note--${look}`}">${words(text, loading)}</div>`).join('')
    + (primary || secondary ? `<div class="kanso-dialog__footer">${secondary ? action(secondary, 'default', 'quiet') : ''}${primary ? action(primary, state, kind) : ''}</div>` : '') + '</div>';
};

export const input = ({ text: value = '', label: placeholder, icon = 'none', error, disabled, multiline, inline: rename, selected, loading, limit = 80, lead = 'none', count = null, tools = [], action: word = '', choose = false, focus = false, hover = false }) => {
  const editable = !disabled && !loading && !choose;
  const enter = multiline ? '' : ` onkeydown="if (event.key === 'Enter') event.preventDefault()"`;
  const cap = ` onbeforeinput="if (event.inputType.startsWith('insert') && this.innerText.length >= ${limit}) event.preventDefault()"`;
  const text = `<div class="kanso-field__editor" role="textbox" aria-label="${escape(placeholder)}" aria-multiline="${multiline}" contenteditable="${editable}"${editable ? ' tabindex="0"' : ''}${enter}${cap}>${selected ? `<span class="kanso-field__selection">${escape(value.slice(0, limit))}</span>` : escape(value.slice(0, limit))}</div>`;
  const iconTool = icon === 'none' ? '' : `<span class="kanso-button kanso-button--icon" tabindex="0"><svg class="kanso-icon kanso-icon--row"><use href="#${icon}"/></svg></span>`;
  const wordTool = value || choose ? button({ label: word, kind: 'tonal', size: 'sm' }) : '';
  const action = rename ? '' : word ? wordTool : iconTool;
  const classes = `kanso-field${multiline ? ' kanso-field--multiline' : ''}${rename ? ' kanso-field--inline' : ''}${loading ? ' kanso-skeleton--shape' : `${error ? ' kanso-field--invalid' : ''}${disabled ? ' kanso-control--off' : ''}${focus ? ' kanso-control--focus' : ''}${hover ? ' kanso-control--hover' : ''}`}`;
  const after = `${count === null ? '' : `<span class="kanso-field__count">${escape(count)}</span>`}${list(tools)}`;
  return `<div class="${classes}"${disabled ? ' aria-disabled="true"' : ''}>${lead && lead !== 'none' && !rename ? iconSvg(lead, 'row') : ''}${text}${action}${after}</div>`;
};

const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matches = (query) => new RegExp(`(${query.trim().split(/\s+/).filter(Boolean).map(literal).join('|') || '(?!)'})`, 'gi');
export const found = ({ text, query = '' }) => String(text).split(matches(query)).map((part, index) => index % 2 ? `<mark class="kanso-search__match">${escape(part)}</mark>` : escape(part)).join('');
export const excerpt = ({ who, when = '', where = '', text, query = '', lead = '', snippet = '', current = false, pending = false, depth = 0 }) => `<div class="kanso-excerpt${current ? ' kanso-excerpt--current' : ''}${depth ? ' kanso-excerpt--reply' : ''}" tabindex="0">`
  + `<div class="kanso-excerpt__who">${list(lead)}<span>${escape(who)}</span>${where ? `<span class="kanso-excerpt__where">${escape(where)}</span>` : ''}<span class="kanso-text--dim">${escape(when)}</span>${pending ? '<span class="kanso-text--dim">pending</span>' : ''}</div>`
  + `${snippet}<div class="kanso-excerpt__text">${found({ text, query })}</div></div>`;

const inline = (text) => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const tableActions = () => `<div class="kanso-markdown__actions">${['Add row', 'Add column', 'Done'].map((label) => button({ label, kind: 'quiet', size: 'sm' })).join('')}</div>`;
const remover = (what, shown = true) => `<td class="kanso-markdown__remover kanso-markdown__remover--${what}">${shown ? button({ label: `Remove this ${what}`, kind: 'icon', size: 'sm', icon: 'lu-x' }) : ''}</td>`;
const cellOf = (text, tag, focus) => `<${tag}${focus ? ' class="kanso-markdown__cell kanso-markdown__cell--focus" contenteditable="true"' : ''}>${inline(text.trim())}</${tag}>`;
const rowCells = (row) => row.trim().split('|').slice(1, -1);
const cells = (row, tag, at, cell) => `<tr>${rowCells(row).map((text, column) => cellOf(text, tag, cell?.[0] === at && cell?.[1] === column)).join('')}${cell ? remover('row', at > 0) : ''}</tr>`;
const columnRemovers = (head) => {
  const columns = rowCells(head);
  return `<tr>${columns.map(() => remover('column', columns.length > 1)).join('')}${remover('row', false)}</tr>`;
};
const isTable = (lines) => lines.every((line) => line.trim().startsWith('|'));
const isFence = (lines) => lines[0].startsWith('```');
const tableOf = (lines, cell) => {
  const rows = lines.filter((line) => !/^\s*\|[\s:|-]+\|\s*$/.test(line));
  return `<table class="kanso-markdown__table${cell ? ' kanso-markdown__table--editing' : ''}">${cell ? columnRemovers(rows[0]) : ''}${rows.map((line, index) => cells(line, index ? 'td' : 'th', index, cell)).join('')}</table>${cell ? tableActions() : ''}`;
};
const imageLine = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const pictureBlock = (path, { state = 'shown', size = '', image = '' }) => state === 'held' ? row({ icon: 'lu-file', name: path.split('/').at(-1), detail: size, action: { label: 'Load', kind: 'quiet' } })
  : state === 'failed' ? '<p class="kanso-text--dim">Cannot show this picture</p>'
  : picture({ image, state });
// One block's markup from its Markdown: a heading, a table, a list or a paragraph.
const blockOf = (block, cell = null, shot = {}) => {
  const lines = block.split('\n');
  const image = block.trim().match(imageLine);
  if (image) return pictureBlock(image[2], shot);
  if (isFence(lines)) return `<pre class="kanso-markdown__code">${escape(lines.slice(1, lines.at(-1).startsWith('```') ? -1 : undefined).join('\n'))}</pre>`;
  if (block.startsWith('## ')) return `<div class="kanso-markdown__subheading">${inline(block.slice(3))}</div>`;
  if (block.startsWith('# ')) return `<div class="kanso-markdown__heading">${inline(block.slice(2))}</div>`;
  if (isTable(lines)) return tableOf(lines, cell);
  if (lines.every((line) => line.startsWith('- '))) return `<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`;
  return `<p>${lines.map(inline).join(' ')}</p>`;
};
// A block's words: its Markdown drawn, with no padding of their own.
export const markdownWords = ({ source }) => blockOf(source);
const BLOCK_STATES = { hover: ' kanso-row--hover', editing: ' kanso-editor--editing kanso-control--focus' };
// One block of a document: at rest, under the pointer, or being edited. Proposed: `content`, markup drawn in place of its formatted source (the editor's field, a picture).
export const markdownBlock = ({ source, state = 'rest', content = '', cell = null, shot = {} }) => {
  const edited = cell && state === 'editing' && isTable(source.split('\n')) ? cell : null;
  const on = edited ? '' : BLOCK_STATES[state] ?? '';
  return `<div class="kanso-markdown__block${on}"${on.includes('editing') ? ' contenteditable="true"' : ''}>${content || blockOf(source, edited, shot)}</div>`;
};
export const markdown = ({ source, block, state, cell = [1, 0], view = 'document', shot = {} }) => view === 'source'
  ? `<div class="kanso-markdown"><div class="kanso-markdown__source">${escape(source.trim())}</div></div>`
  : `<div class="kanso-markdown">${markdownBlocks(source).map((one, index) => markdownBlock({ source: one, state: index + 1 === block ? state : 'rest', cell, shot })).join('')}</div>`;

export const band = ({ text, actions = [] }) => `<div class="kanso-band" role="status"><span class="kanso-band__text">${escape(text)}</span>${actions.map(button).join('')}</div>`;

const menuHeading = (text, status) => `<div class="kanso-menu__heading">${status ? `${grow(escape(text))}${mark({ status, size: 'sm' })}` : escape(text)}</div>`;
const menuLead = (item) => item.picture || item.letter ? avatar({ initial: item.letter ?? '', image: item.picture, size: 'sm', tone: item.tone, round: false })
  : item.dot ? `<span class="kanso-menu__spacer">${dot(item.dot)}</span>` : item.icon ? glyph(item.icon) : '<span class="kanso-menu__spacer"></span>';
const menuLabel = (label, second) => grow(second ? `<span class="kanso-menu__label">${label}</span><span class="kanso-menu__second">${escape(second)}</span>` : label);
const menuItem = (item) => {
  const classes = `kanso-menu__item${item.second ? ' kanso-menu__item--two-lines' : ''}${item.armed ? ' kanso-action--armed' : item.selected ? ' kanso-control--selected' : item.hover ? ' kanso-control--hover' : ''}${item.disabled ? ' kanso-control--off' : ''}`;
  const label = item.armed ? `Press again to ${escape(item.verb || String(item.label ?? '').toLowerCase())}` : escape(item.label ?? '');
  return `<div class="${classes}" role="menuitem" tabindex="${item.disabled ? -1 : 0}"${item.disabled ? ' aria-disabled="true"' : ''}${item.checked === undefined ? '' : ` aria-checked="${item.checked}"`}>${menuLead(item)}${menuLabel(label, item.second)}`
    + (item.badge ? `<span class="kanso-menu__badge">${escape(item.badge)}</span>` : '')
    + (item.hint ? `<span class="kanso-menu__hint">${escape(item.hint)}</span>` : '') + (item.mark ? mark({ status: item.mark }) : '') + (item.checked ? glyph('lu-check') : '') + '</div>';
};
const menuEntry = (item) => item.separator ? '<div class="kanso-menu__separator"></div>'
  : item.field ? `<div class="kanso-menu__field">${input({ label: item.field, icon: 'lu-search', multiline: false })}</div>`
  : item.failure ? failureBlock(item.failure)
  : item.heading ? menuHeading(item.heading, item.mark)
  : menuItem(item);
export const menu = ({ title, items }) => `<div class="kanso-menu kanso-popover" role="menu">${title ? menuHeading(title) : ''}${(Array.isArray(items) ? items : []).map(menuEntry).join('')}</div>`;

export const metric = ({ value, unit, small = '', second = '', facts = '', loading = false, size = 'md', tone = '' }) => {
  const piece = (text, element) => `<span class="${element}${loading ? ' kanso-skeleton--shape kanso-skeleton--text' : ''}">${escape(text)}</span>`;
  const list = facts.split('|').map((fact) => fact.trim()).filter(Boolean);
  const beside = second ? `<span class="kanso-metric__beside">${piece(unit, 'kanso-metric__unit')}${piece(second, 'kanso-metric__second')}</span>` : unit ? piece(unit, 'kanso-metric__unit') : '';
  return `<div class="kanso-metric${size === 'sm' ? ' kanso-metric--sm' : ''}${second ? ' kanso-metric--beside' : ''}${tone ? ` kanso-metric--${escape(tone)}` : ''}">${piece(value, 'kanso-metric__value')}${small ? piece(small, 'kanso-metric__small') : ''}${beside}</div>`
    + (list.length ? `<div class="kanso-panel__facts">${list.map((fact) => loading ? `<span class="kanso-skeleton--shape kanso-skeleton--text">${escape(fact)}</span>` : `<span>${escape(fact)}</span>`).join('')}</div>` : '');
};

// An icon by name: a program's own art or a Lucide icon, at a control's or a row's size; a tone colours it.
const iconSvg = (icon, size, tone = '', spinning = false) => `<svg class="${tone ? `kanso-text--${escape(tone)} ` : ''}${icon.startsWith('p-') ? 'kanso-icon--program' : size === 'row' ? 'kanso-icon kanso-icon--row' : 'kanso-icon'}${spinning ? ' kanso-icon--spinning' : ''}"><use href="#${escape(icon)}"/></svg>`;
export const glyph = (icon, tone = '', spinning = false) => iconSvg(icon, 'row', tone, spinning);
const flip = "if (this.getAttribute('aria-disabled')) return; this.setAttribute('aria-checked', this.classList.toggle('kanso-control--on'))";
export const toggle = ({ checked, label, disabled, hover = false, focus = false, pressed = false }) => `<span class="${['kanso-switch', checked && 'kanso-control--on', disabled && 'kanso-control--off', ...liveStates({ hover, focus, pressed })].filter(Boolean).join(' ')}" role="switch" aria-checked="${checked}" aria-label="${escape(label)}" tabindex="0"${disabled ? ' aria-disabled="true"' : ''} onclick="${flip}" onkeydown="if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); this.click(); }"><i></i></span>`;
// The lines that end every piece's right-click Menu.
export const pieceLines = [{ separator: true }, { icon: 'lu-check', label: 'Only when needed' }, { icon: 'lu-eye-off', label: 'Hide this' }, { icon: 'lu-sliders-vertical', label: 'Settings for this…' }];
export const marks = { working: 'e-work', blocked: 'e-blk', done: 'e-done', idle: 'e-idle', asleep: 'lu-moon' };
export const markSizes = { sm: ' kanso-icon--inline', md: '', lg: ' kanso-icon--control' };
export const mark = ({ status, size = 'md' }) => `<svg class="kanso-mark kanso-mark--${status}${markSizes[size]}"><use href="#${marks[status]}"/></svg>`;

export const chip = ({ label, quiet = false, pill = false, tone = '' }) => `<span class="kanso-badge${quiet ? ' kanso-badge--quiet' : ''}${pill ? ' kanso-badge--pill' : ''}${tone ? ` kanso-text--${escape(tone)}` : ''}">${escape(String(label))}</span>`;
// A fact's `tone` colours it and its `tip` names what it holds.
const marked = ({ tone, tip }, base = '') => `${base || tone ? ` class="${[base, tone && `kanso-text--${escape(tone)}`].filter(Boolean).join(' ')}"` : ''}${tip ? ` title="${escape(tip)}"` : ''}`;
// A fact with a `label` is a press: a quiet small Button showing its text, its tip saying what it does.
const fact = (part) => typeof part === 'string' ? `<span>${escape(part)}</span>` : part.label ? button({ label: part.text, kind: 'quiet', size: 'sm', tip: part.tip || part.label })
  : `${part.icon ? `<svg class="kanso-icon kanso-icon--inline"><use href="#${escape(part.icon)}"/></svg>` : ''}<span${marked(part)}>${escape(part.text)}</span>`;
const factOf = (part) => (typeof part === 'object' ? part : { text: part });
const countOf = (count) => (typeof count === 'object' ? `<span${marked(count)}>${chip({ label: count.label })}</span>` : chip({ label: count }));
const guide = (kind, level) => (kind ? `<span class="kanso-row__guide kanso-row__guide--${escape(kind)} kanso-row__guide--level-${level}"></span>` : '');
const detailFact = (part) => `${part.tone ? dot(part.tone) : ''}${fact(part)}`;
const rowTool = (action) => button({ kind: 'icon', size: 'sm', ...action });
const letterTones = { A: 'dim', D: 'dim', U: 'blocked', M: '' };
const fileLetter = (letter) => `<span class="kanso-row__letter${letterTones[letter] ? ` kanso-row__letter--${letterTones[letter]}` : ''}">${letter === 'M' ? '' : escape(letter)}</span>`;
const fold = (open) => `<span class="kanso-row__fold">${open === undefined ? '' : inlineIcon(open ? 'lu-chevron-down' : 'lu-chevron-right')}</span>`;
export const sentence = ({ text, tone = 'dim' }) => `<div class="kanso-sentence kanso-sentence--${escape(tone)}">${escape(text)}</div>`;
const rowVerb = (verb) => verb.agent ? explainButton({ agent: verb.agent, size: 'sm' }) : button({ kind: 'quiet', size: 'sm', ...verb });
export const rowDepths = [0, 1, 2];
// `actions` show on hover or focus and take the meta's place; `action` and the drawn `tools` are always shown; `keys` are the row's key hints, last.
// The title form is a panel's heading: the name at title size, the second line its scope.
// Proposed: `group` makes a heading the head of a group, its name strong in the foreground one step up the type scale (a computer over its projects).
// Proposed: `names` is the sidebar's row: every name at the name size, a head strong and a session medium, in the `nameInk` ('fg', 'muted' or 'dim') its state gives it, the lead icon muted.
// Proposed: `wrap` lets the name run over as many lines as it needs, such as a review thread's comment, instead of one truncated line.
// `second`, `detail` and `meta` take facts with a tone and a tip, a detail fact with a `label` is a press, `chip` takes a tip; `drop` is where a dragged row lands, `wash` a state's ground, `guides` one per depth above it ('tee', 'end', 'pass', or null), under that depth's icon; without them a deeper row hangs from its parent.
export const row = ({ icon = 'none', tone = '', name, detail, meta, chip: count, flag, mark: status = 'none', second, heading, group, title, hero, depth = 0, glint, wrap, names, nameInk, strong, late, selected, current, dimmed, busy, pending, hover, focus, actions = [], action, verbs = [], start = [], tools = [], keys = [], drop, wash, guides = [], letter, level, open, number, reason, path, apart }) => {
  const lines = guides.length ? guides : depth > 1 ? [null, 'pass'] : [];
  const slot = letter ? fileLetter(letter) : icon === 'none' ? '' : glyph(icon, tone, busy);
  const lead = `${lines.map(guide).join('')}${list(start)}${level === undefined ? '' : fold(open)}${slot}${number ? `<span class="kanso-row__number">${escape(number)}</span>` : ''}`;
  const label = `<span class="kanso-row__name${glint ? ' kanso-text--glint' : ''}">${escape(name)}</span>`;
  const facts = [].concat(detail ?? []).filter(Boolean);
  const metaFact = meta && { ...factOf(meta), ...(late && { tone: 'blocked' }) };
  const tail = `${facts.length ? `<span class="kanso-row__detail">${facts.map(detailFact).join('')}</span>` : ''}${grow()}`
    + `${metaFact ? `<span${marked(metaFact, 'kanso-row__meta')}>${escape(metaFact.text)}</span>` : ''}${flag ? `<span class="kanso-row__flag">${glyph(flag)}</span>` : ''}`
    + `${actions.length ? `<span class="kanso-row__actions">${actions.map(rowTool).join('')}</span>` : ''}${count ? countOf(count) : ''}${action ? button({ size: 'sm', ...action }) : ''}${list(tools)}${keys.map(keyHint).join('')}`
    + `${pending ? '<span class="kanso-state-line__pending-dot"></span>' : ''}${!status || status === 'none' ? '' : mark({ status })}`;
  const twoLines = Boolean(second || reason || path) || verbs.length > 0;
  const states = [twoLines && 'kanso-row--two-lines', level !== undefined && `kanso-row--nested kanso-row--level-${Number(level)}`, strong && 'kanso-row--strong', heading && 'kanso-row--heading', group && 'kanso-row--group', title && 'kanso-row--title', hero && 'kanso-row--hero', depth && `kanso-row--depth-${depth}`, selected && 'kanso-control--selected', current && 'kanso-row--selected',
    dimmed && 'kanso-control--dim', busy && 'kanso-row--busy', pending && 'kanso-state-line--pending', hover && 'kanso-control--hover', focus && 'kanso-control--focus',
    drop && `kanso-row--drop-${drop}`, wash && `kanso-row--wash-${wash}`, lines.length && 'kanso-row--tree', wrap && 'kanso-row--wrap', names && 'kanso-row--names', names && nameInk && `kanso-row--ink-${nameInk}`].filter(Boolean).map((name) => ` ${name}`).join('');
  const under = `${second ? `<div class="kanso-content__secondary">${typeof second === 'string' ? escape(second) : [].concat(second).filter(Boolean).map(fact).join(apart ? '<span>·</span>' : '')}</div>` : ''}${reason ? sentence(reason) : ''}`
    + `${path ? `<div class="kanso-row__path">${escape(path)}</div>` : ''}${verbs.length ? `<div class="kanso-content__actions">${verbs.map(rowVerb).join('')}</div>` : ''}`;
  const access = busy ? ' aria-busy="true"' : ' tabindex="0"';
  return twoLines
    ? `<div class="kanso-row${states}"${access}><div class="kanso-content__primary">${lead}${label}${tail}</div>${under}</div>`
    : `<div class="kanso-row${states}"${access}>${lead}${label}${tail}</div>`;
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
  const states = [on && 'kanso-tabs__tab--on', square && 'kanso-tabs__tab--icon', item.armed && 'kanso-action--armed', item.pending && 'kanso-state-line--pending', item.held && 'kanso-control--held', ...liveStates(item)].filter(Boolean).map((name) => ` ${name}`).join('');
  const name = item.editing ? input({ text: item.label ?? '', label: item.label ?? '', icon: 'none', inline: true, selected: true, limit: tabNameLimit }) : `<span class="kanso-tabs__label">${label}</span>`;
  const landing = item.drop ? '<i class="kanso-tabs__insertion"></i>' : '';
  return `${item.drop === 'after' ? '' : landing}<span class="kanso-tabs__tab${states}" role="tab" aria-selected="${on}" aria-label="${label}" tabindex="0" title="${square ? label : escape(item.tip ?? '')}" onclick="${choose}">`
    + `${icon && item.icon ? glyph(item.icon) : ''}${named || !item.icon ? name : ''}${item.pending ? '<i class="kanso-state-line__pending-dot"></i>' : ''}${item.mark && !square ? mark({ status: item.mark }) : ''}`
    + `${(item.dot || (square && item.mark === 'blocked')) && !on ? '<i class="kanso-tabs__dot"></i>' : ''}${on && item.closable && !square && !item.editing ? '<svg class="kanso-icon kanso-tabs__close"><use href="#lu-x"/></svg>' : ''}</span>${item.drop === 'after' ? landing : ''}`;
}).join('')}</div>`;

const percent = (value) => `${Number(value)}%`;
const placed = ([x, y], content) => `<foreignObject class="kanso-annotation__spot" x="${percent(x)}" y="${percent(y)}">${content}</foreignObject>`;
const ringed = ([x, y, width, height], content) => `<foreignObject class="kanso-annotation__area" x="${percent(x)}" y="${percent(y)}" width="${percent(width)}" height="${percent(height)}"><span class="kanso-annotation__region">${content}</span></foreignObject>`;
export const pin = ({ n = '', at, region, pending = false }) => {
  const badge = `<span class="kanso-annotation${pending ? ' kanso-annotation--inactive' : ''}">${escape(String(n))}</span>`;
  return region ? ringed(region, badge) : at ? placed(at, badge) : badge;
};
export const note = ({ text = '', at = [0, 0], typing = false }) => placed(at, `<div class="kanso-annotation__note">${text ? escape(text) : '<span class="kanso-text--dim">Note</span>'}${typing ? '<span class="kanso-caret"></span>' : ''}</div>`);
const pinLayer = (pins, look = '') => pins.length ? `<div class="kanso-annotation__layer${look}"><svg class="kanso-annotation__plane">${list(pins)}</svg></div>` : '';

const screenLine = ({ label, value, held, hint }) => `<div class="kanso-simulator__line${held ? ' kanso-simulator__line--working' : ''}"><span>${escape(label)}</span><span${hint ? ' class="kanso-text--dim"' : ''}>${escape(value)}</span></div>`;
export const deviceScreen = ({ time, signal, title, lines = [], primary }) => `<div class="kanso-simulator__app"><div class="kanso-content__time"><span>${escape(time)}</span><span>${escape(signal)}</span></div>`
  + `<div class="kanso-content__text">${escape(title)}</div><div class="kanso-simulator__lines">${lines.map(screenLine).join('')}</div>${primary ? `<div class="kanso-simulator__payment">${escape(primary)}</div>` : ''}</div>`;
export const deviceStates = ['on', 'off', 'booting', 'stalled'];
export const device = ({ state = 'on', frozen, focus, touch, rotated, narrow, pins = [] }, screen = '') => {
  const shape = `${rotated ? ' kanso-simulator--rotated' : ''}${narrow ? ' kanso-simulator--narrow' : ''}`;
  if (state === 'off') return `<div class="kanso-simulator__frame">${button({ label: 'Boot' })}</div>`;
  if (state === 'booting') return `<div class="kanso-simulator__frame kanso-simulator__frame--booting kanso-skeleton kanso-skeleton--breathing" aria-busy="true"></div>`;
  const states = `${shape}${frozen ? ' kanso-simulator--frozen' : ''}${focus ? ' kanso-simulator--focus' : ''}${state === 'stalled' ? ' kanso-simulator--stalled' : ''}`;
  return `<div class="kanso-simulator${states}"><div class="kanso-simulator__screen">${screen}</div>${touch ? pinLayer([pin({ at: touch, pending: true })], ' kanso-annotation__layer--touch') : ''}${pinLayer(pins)}</div>`;
};
export const pictureStates = ['shown', 'loading', 'held'];
export const picture = ({ image = '', state = 'shown', action = '', pins = [] }) => state === 'loading' ? '<div class="kanso-picture__loading kanso-skeleton kanso-skeleton--breathing" aria-busy="true"></div>'
  : state === 'held' ? `<div class="kanso-picture__loading">${button({ label: action })}</div>`
  : `<div class="kanso-picture">${image}${pinLayer(pins)}</div>`;

const thumbArt = (image) => image.startsWith('<') ? image : `<img src="${escape(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
// Proposed: `color`, the picture's own colour as its ground while the picture is not drawn.
export const thumbnail = ({ image, label, selected, loading, color = '', focus = false }) => `<span class="kanso-thumbnail${selected ? ' kanso-control--selected' : ''}${loading ? ' kanso-skeleton--shape' : ''}${color && !loading ? ' kanso-thumbnail--color' : ''}${focus ? ' kanso-control--focus' : ''}"${color ? ` data-color="${escape(color)}"` : ''} role="button" aria-pressed="${selected}" aria-label="${escape(label)}" title="${escape(label)}" tabindex="0">${image && !loading ? thumbArt(image) : ''}</span>`;

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

// Proposed: the minimap, switched on in kansō settings: a Button per column; each pane a line in its tone (`current`, `seen`, else out of view), `width` hairlines long.
const columnPanes = ({ width, panes }) => `<span class="kanso-status-bar__column${panes.length > 1 ? ' kanso-status-bar__column--stacked' : ''}">`
  + `${panes.map((tone) => `<i class="kanso-status-bar__pane kanso-status-bar__pane--${escape(tone)}" data-width="calc(var(--k-w-line) * ${Number(width)})"></i>`).join('')}</span>`;
const minimap = (columns) => (columns.length ? `<span class="kanso-status-bar__columns">${columns.map((column, i) => button({ label: `Column ${i + 1}`, kind: 'quiet', size: 'sm', content: columnPanes(column) })).join('')}</span>` : '');
// Panes per view: the number at rest, − and + on hover; its keys are in the tooltips. Proposed: `columns`, the minimap before it.
export const stepper = ({ value = 2, open = false, hover = false, columns = [] } = {}) => `<span class="kanso-status-bar__item kanso-status-bar__stepper${open ? ' kanso-status-bar__item--open' : ''}${hover ? ' kanso-control--hover' : ''}">${minimap(columns)}${button({ label: 'Fewer panes per view ⇧⌘−', kind: 'icon', size: 'sm', icon: 'lu-minus' })}`
  + `<span class="kanso-status-bar__value" title="${Number(value)} per view · scroll to change, click to even out">${Number(value)}</span>${button({ label: 'More panes per view ⇧⌘=', kind: 'icon', size: 'sm', icon: 'lu-plus' })}</span>`;

export const windowAreas = ['Sidebar', 'Tab bar', 'Pane header', 'Body', 'Panels', 'Notifications', 'Status bar'];
const areaClass = (name) => name.toLowerCase().replace(/ /g, '-');
export const windowMap = ({ picked = null, hover = null } = {}) => `<div class="kanso-settings__window-map">${windowAreas.map((name) => name === 'Body'
  ? `<span class="kanso-settings__area kanso-settings__area--body"></span>`
  : `<span class="kanso-settings__area kanso-settings__area--${areaClass(name)}${name === picked ? ' kanso-settings__area--on' : ''}${name === hover ? ' kanso-settings__area--hover' : ''}" role="button" tabindex="0" aria-pressed="${name === picked}">${escape(name)}</span>`).join('')}</div>`;

const releaseDots = { newer: '', here: ' kanso-update__timeline-dot--current', older: ' kanso-update__timeline-dot--small' };
const changeLines = (changes) => changes.map(({ kind, text }, index) => `<div class="kanso-update__change"><span>${kind === changes[index - 1]?.kind ? '' : escape(kind)}</span><span>${escape(text)}</span></div>`).join('');
export const release = ({ version, date = null, node = 'newer', action = null, changes = [] }) => {
  const when = date ? `<span class="kanso-update__timeline-date">${escape(date)}</span>` : '';
  const heading = node === 'older'
    ? `<div class="kanso-update__fold">Older<span class="kanso-update__timeline-date">${escape(version)}</span>${inlineIcon('lu-chevron-right')}</div>`
    : `<div class="kanso-update__timeline-heading"><span class="kanso-update__version-name">${escape(version)}</span>${when}${node === 'here' ? chip({ label: 'you are here' }) : ''}${action ? button({ label: action }) : ''}</div>`;
  return `<div class="kanso-update__timeline-release kanso-update__timeline-release--${node}"><span class="kanso-update__timeline-dot${releaseDots[node]}"></span>${heading}${changeLines(changes)}</div>`;
};

const share = (value) => Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 10000) / 100;
const barState = (value, index, peak, low) => index === peak ? ' kanso-bars__bar--peak' : low.includes(index) ? ' kanso-bars__bar--low' : Number(value) ? '' : ' kanso-bars__bar--empty';
const barSlot = ({ value, state, part, label, said }, index, { length }) => `<svg class="kanso-bars__slot" x="${share(index / length)}%" width="${share(1 / length)}%"${said ? ` role="listitem" aria-label="${escape(said)}"` : ''}>${said ? `<title>${escape(said)}</title>` : ''}`
  + `<rect class="kanso-bars__bar${state}" x="50%" y="100%" height="${share(value)}%"/>${part ? `<rect class="kanso-bars__part" x="50%" y="100%" height="${share(value * part)}%"/>` : ''}`
  + `${label ? `<text class="kanso-bars__label" x="50%" y="${share(1 - value)}%">${escape(label)}</text>` : ''}</svg>`;
export const bars = ({ bars: values = [], peak = null, low = [], part = [], labels = [], said = [], spoken = '', ticks = [], filled = false }) => `<div class="kanso-bars${filled ? ' kanso-bars--filled' : ''}${labels.some(Boolean) ? ' kanso-bars--labelled' : ''}">`
  + `<svg class="kanso-bars__plot"${spoken ? ` role="list" aria-label="${escape(spoken)}"` : ''}>${values.map((value, index) => ({ value, state: barState(value, index, peak, low), part: part[index], label: labels[index], said: said[index] })).map(barSlot).join('')}</svg>`
  + `${ticks.length ? `<div class="kanso-bars__ticks">${ticks.map((tick) => `<span>${escape(tick)}</span>`).join('')}</div>` : ''}</div>`;
export const delta = ({ text, up = true }) => `<div class="kanso-panel__delta">${up ? '↑' : '↓'} ${escape(text)}</div>`;
export const meter = ({ share: value = 0, label = '' }) => `<svg class="kanso-meter" role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${Number(value)}"${label ? ` aria-label="${escape(label)}"` : ''}><rect class="kanso-meter__fill" width="${share(value)}%" height="100%"/></svg>`;
export const heatmap = ({ days = [] }) => `<div class="kanso-days">${days.map((level) => `<span class="kanso-days__day${level === null ? ' kanso-days__day--none' : Number(level) ? ` kanso-days__day--${Number(level)}` : ''}"></span>`).join('')}</div>`;
const shareLine = (title, right = '') => `<div class="kanso-share__header">${escape(title)}${right ? `<span>${escape(right)}</span>` : ''}</div>`;
const shareStat = ({ value, unit }) => `<div><div class="kanso-content__value">${escape(value)}</div><div class="kanso-metric__unit">${escape(unit)}</div></div>`;
const shareBlocks = {
  streak: ({ title, right, n, unit, days }) => `${shareLine(title, right)}${metric({ value: n, unit, size: 'sm' })}${heatmap({ days })}`,
  bars: ({ title, right, values, ticks }) => {
    const highest = Math.max(...values);
    return `${shareLine(title, right)}${bars({ bars: values.map((value) => value / highest), ticks, peak: values.indexOf(highest), filled: true })}`;
  },
  list: ({ title, rows }) => `${shareLine(title)}${list(rows.map(({ name, detail, value, unit }) => row({ name, detail, meta: [value, unit].filter(Boolean).join(' ') })))}`,
};
const shareBlock = (block) => `<div class="kanso-share__block">${shareBlocks[block.kind](block)}</div>`;
export const shareCard = ({ title, subtitle = '', right = '', hero = {}, stats = [], note: said = '', blocks = [] }) => `<div class="kanso-share">${shareLine(title, right)}${subtitle ? sentence({ text: subtitle, tone: 'muted' }) : ''}`
  + `${metric({ value: hero.big ?? '—', small: hero.small, unit: hero.unit })}${hero.label ? sentence({ text: hero.label, tone: 'muted' }) : ''}${hero.delta?.text ? delta(hero.delta) : ''}`
  + `${stats.length ? `<div class="kanso-panel__statistics">${stats.map(shareStat).join('')}</div>` : ''}${said ? sentence({ text: said, tone: 'muted' }) : ''}${blocks.map(shareBlock).join('')}`
  + `<div class="kanso-share__footer">${mark({ status: 'done', size: 'sm' })}kansō for Herdr</div></div>`;

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
  // The lights are the window's own: the row draws their place first, and the app leaves it to Herdr.
  'header title': { block: 'kanso-header__title', lead: windowControls },
  sidebar: { block: 'kanso-sidebar', tag: 'aside' },
  rows: { block: 'kanso-sidebar__rows' },
  // Proposed: `computer`, a computer's group, wider apart from the group above it than projects are.
  'row group': { block: 'kanso-sidebar__row-group', states: ['computer'] },
  'view switch': { block: 'kanso-sidebar__view-switch' },
  'view menu': { block: 'kanso-sidebar__view-menu' },
  // Proposed: the collapsed view button carrying the dot while someone needs you.
  'view button': { block: 'kanso-sidebar__view-button', tag: 'span' },
  footer: { block: 'kanso-sidebar__footer' },
  // Proposed: Settings and its open menu; a refused update's block under its row.
  'footer settings': { block: 'kanso-sidebar__footer-settings' },
  'footer menu': { block: 'kanso-sidebar__footer-menu' },
  'footer refusal': { block: 'kanso-sidebar__footer-refusal' },
  rail: { block: 'kanso-rail', tag: 'aside' },
  'rail list': { block: 'kanso-rail__list' },
  // Proposed: `strong`, something in the group is unread or woke; `rail count`, a tile's state mark beside its count.
  'rail tile': { block: 'kanso-rail__tile', focusable: true, states: ['strong'] },
  'rail count': { block: 'kanso-rail__count', tag: 'span' },
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
  'device tools': { block: 'kanso-panel__tools' },
  timeline: { block: 'kanso-update__timeline' },
  columns: { block: 'kanso-layout kanso-layout--columns' },
  column: { block: 'kanso-layout kanso-layout--column' },
  line: { block: 'kanso-layout kanso-layout--line' },
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
  // Proposed: a dialog's rows; `scroll`, past six rows the list scrolls (Send).
  'dialog list': { block: 'kanso-dialog__list', states: ['scroll'] },
};
// `label`: what a focusable stack is called, its tooltip and its spoken name.
export const stack = ({ variant, on = false, label = '', ...flags }, ...children) => {
  if (!Object.hasOwn(stacks, variant)) throw new Error(`stack: unknown variant "${variant}"`);
  const { block, tag = 'div', states = [], focusable = false, lead = null } = stacks[variant];
  const unknown = Object.keys(flags).find((flag) => !states.includes(flag));
  if (unknown) throw new Error(`stack: variant "${variant}" has no state "${unknown}"`);
  const classes = [block, ...states.filter((state) => flags[state]).map((state) => `${block}--${state}`), on ? 'kanso-control--on' : ''].filter(Boolean).join(' ');
  return `<${tag} class="${classes}"${focusable ? ' tabindex="0"' : ''}${label ? ` title="${escape(label)}" aria-label="${escape(label)}"` : ''}>${lead ? lead() : ''}${list(children)}</${tag}>`;
};

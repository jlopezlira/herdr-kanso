import tokens from '../kanso/tokens.json';
import icons from './icons.json';
import sprite from './icons.svg?raw';
import { escape, html, principle, states } from './docs';

const component = `### Adding an icon

This list is the only set. If you need another icon, take it from Lucide ([lucide.dev/icons](https://lucide.dev/icons), version 1.72.0, ISC license). Copy its markup unchanged, add it here with an \`lu-\` id and the meaning it carries, and only then use it. One name per meaning, never a custom icon.

### Icon guidelines

Every icon is Lucide 1.72.0, the icon's own markup, unchanged: 24 grid, stroke 2, round caps and joins. Ids are \`lu-\` and the Lucide name. One name per meaning across every board: one close (\`lu-x\`), one more (\`lu-ellipsis\`), one pin, one sync, one share, one layers, one terminal. A plain shell is \`lu-terminal\`, the same as the Terminal row in the + menu.

**Not icons, kept:** the ensō marks and spinner, the blocked mark, the Claude Code and Codex marks, Hachi's pixel art, the Dawn artwork, the kansō wordmark, the macOS window lights, the board pointer.

**Flagged:** Android has no Lucide icon (proposal: the word "Android" on the button). iOS uses \`lu-apple\`, the fruit, as the app does.

${principle('koko')}`;

export default {
  title: 'Icons',
  tags: ['autodocs'],
  parameters: { docs: { description: { component } } },
};

const use = (id, className = 'i', style = '') => `<svg class="${className}" aria-hidden="true"${style ? ` style="${style}"` : ''}><use href="#${id}"/></svg>`;
const sized = (size) => `width:var(--${size});height:var(--${size})`;
const withSprite = (node) => {
  node.insertAdjacentHTML('afterbegin', sprite);
  return node;
};

const set = {
  render: () => withSprite(html(`<div class="story-grid">${icons.map((icon) =>
    `<div class="story-row">${use(icon.id, 'i', `${sized('k-ic-control')};color:var(--muted)`)}<div><code>${escape(icon.id)}</code><div>${escape(icon.meaning)}</div></div></div>`).join('')}</div>`)),
};

export { set as Set };

export const Sizes = {
  render: () => withSprite(html(`<div class="story-stack">${tokens.icon.map((t) =>
    `<div class="story-row"><span class="story-label"><code>--${t.name}</code> ${t.value}</span>${use('lu-folder', 'i', sized(t.name))}</div>`).join('')}</div>`)),
};

const marks = [['e-work', 'm-work'], ['e-done', 'm-done'], ['e-blk', 'm-blk'], ['e-idle', 'm-idle'], ['e-mikan'], ['p-claude'], ['p-codex'], ['p-bolt']];
export const Marks = {
  parameters: { docs: { description: { story: 'Marks, not icons: the ensō marks and spinner, the blocked mark, the Claude Code and Codex marks.' } } },
  render: () => withSprite(html(`<div class="story-stack">${marks.map(([id, mark]) =>
    `<div class="story-row"><span class="story-label"><code>${id}</code></span>${use(id, mark ? `i ${mark}` : 'i')}</div>`).join('')}</div>`)),
};

export const InAControl = {
  name: 'In a control',
  render: () => {
    const node = states((state) => `<button type="button" class="ib" data-state="${state}" aria-label="More actions">${use('lu-ellipsis')}</button>`, ['rest', 'hover', 'active', 'focus-visible']);
    node.insertAdjacentHTML('beforeend', `<div class="story-row"><span class="story-label">button</span><button type="button" class="btn">${use('lu-folder-plus')}New project</button></div>`);
    return withSprite(node);
  },
};

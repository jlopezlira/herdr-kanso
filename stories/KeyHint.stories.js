import { docs, html } from './docs';

export default {
  title: 'Key hint',
  tags: ['autodocs'],
  ...docs('Key hints use the compact height, the small radius and the mono face. Hierarchy comes from size and weight.', 'A new drawing or size for a key hint.', 'fukinsei'),
};
const hint = (text) => `<kbd class="kit-kbd">${text}</kbd>`;

export const Shortcut = { render: () => html(hint('⌃K')) };
export const Combination = { render: () => html(hint('⌘⌥⇧H')) };
export const NamedKey = { name: 'Named key', render: () => html(hint('esc')) };
export const Row = { render: () => html(`<div class="story-row">${['⌃K', '⌘⌥⇧H', 'esc'].map(hint).join('')}</div>`) };

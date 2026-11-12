import { docs, html } from './docs';

export default {
  title: 'Key hint',
  tags: ['autodocs'],
  ...docs('Key hints use the compact height, the small radius and the mono face. Hierarchy comes from size and weight.', 'A new drawing or size for a key hint.', 'fukinsei'),
};
export const Shortcut = { render: () => html('<kbd class="kit-kbd">Ctrl K</kbd>') };

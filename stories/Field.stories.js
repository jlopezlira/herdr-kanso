import folder from '../kanso/mods/kanso-chrome/icons/folder.svg?raw';
import { docs, html, icon, states } from './docs';

export default {
  title: 'Field',
  tags: ['autodocs'],
  ...docs('One text field everywhere. Change tone on hover, focus and press; never the size or position of a box.', 'A new drawing of a field for each form.'),
};

const field = (state, inner = false) => `<label class="kit-field${state === 'error' ? ' bad' : ''}" data-state="${state}"><input aria-label="Project name" placeholder="Project name"${state === 'error' ? ' aria-invalid="true"' : ''}>${inner ? `<button class="ib" type="button" aria-label="Choose folder">${icon(folder)}</button>` : ''}</label>`;
export const Rest = { render: () => html(field('rest')) };
export const Hover = { render: () => html(field('hover')) };
export const Focus = { render: () => html(field('focus-visible')) };
export const InnerIconButton = { render: () => html(field('rest', true)) };
export const Error = { render: () => html(field('error')) };
export const AllStates = { render: () => states((state) => field(state, true), ['rest', 'hover', 'focus-visible', 'error']) };

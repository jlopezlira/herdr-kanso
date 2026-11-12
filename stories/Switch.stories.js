import { docs, html } from './docs';

export default {
  title: 'Switch',
  tags: ['autodocs'],
  ...docs('The primary fill and the switch that is on share solid and solidfg. Change tone on hover, focus and press.', 'Changing the size or position of the control on hover or press.'),
};

const toggle = (on, state = 'rest') => {
  const node = html(`<button class="kit-switch${on ? ' on' : ''}" role="switch" aria-label="Notifications" aria-checked="${on}" data-state="${state}"><i aria-hidden="true"></i></button>`);
  node.onclick = () => node.setAttribute('aria-checked', String(node.classList.toggle('on')));
  return node;
};
export const Off = { render: () => toggle(false) };
export const On = { render: () => toggle(true) };
export const Hover = { render: () => toggle(false, 'hover') };
export const OnHover = { render: () => toggle(true, 'hover') };
export const Focus = { render: () => toggle(false, 'focus-visible') };
export const OnFocus = { render: () => toggle(true, 'focus-visible') };

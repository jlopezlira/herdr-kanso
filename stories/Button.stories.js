import tokens from '../kanso/tokens.json';
import { docs, html, states } from './docs';

export default {
  title: 'Button',
  tags: ['autodocs'],
  ...docs('One height, one weight, one gap, four kinds. An armed action uses the same control in the same box: "Press again to <verb>". Both labels share one cell so nothing moves.', 'Hover on a disabled control, hover in place of a state, or resizing a box when its label changes.'),
};

const kinds = ['primary', 'secondary', 'quiet', 'armed'];
const button = (kind, state) => {
  const armed = kind === 'armed';
  const className = kind === 'quiet' ? 'ql' : `btn${kind === 'secondary' ? ' secondary' : ''}${armed ? ' kit-act kit-armed' : ''}`;
  return `<button type="button" class="${className}" data-state="${state}"${state === 'disabled' ? ' disabled' : ''}>${armed ? '<span>Remove</span><span>Press again to remove</span>' : 'Open project'}</button>`;
};
const matrix = (kind) => states((state) => `<div class="acts">${button(kind, state)}</div>`, ['rest', 'hover', 'active', 'focus-visible', 'disabled']);

export const Primary = { render: () => matrix('primary') };
export const Secondary = { render: () => matrix('secondary') };
export const Quiet = { render: () => matrix('quiet') };
export const Armed = { render: () => matrix('armed') };
export const Rest = { render: () => html(`<div class="acts">${kinds.map((kind) => button(kind, 'rest')).join('')}</div>`) };
export const Hover = { render: () => html(`<div class="acts">${kinds.map((kind) => button(kind, 'hover')).join('')}</div>`) };
export const Active = { render: () => html(`<div class="acts">${kinds.map((kind) => button(kind, 'active')).join('')}</div>`) };
export const FocusVisible = { render: () => html(`<div class="acts">${kinds.map((kind) => button(kind, 'focus-visible')).join('')}</div>`) };
export const Disabled = { render: () => html(`<div class="acts">${kinds.map((kind) => button(kind, 'disabled')).join('')}</div>`) };
export const TwoPressAction = {
  render: () => {
    const node = html('<div class="story-stack"><div class="acts"><button type="button" class="btn kit-act"><span>Remove</span><span>Press again to remove</span></button></div><span role="status">Ready</span></div>');
    const control = node.querySelector('button');
    const status = node.querySelector('[role="status"]');
    let timer;
    control.onclick = () => {
      clearTimeout(timer);
      if (control.classList.contains('kit-armed')) {
        control.classList.remove('kit-armed');
        status.textContent = 'Removed';
      } else {
        control.classList.add('kit-armed');
        status.textContent = 'Waiting for a second press';
        timer = setTimeout(() => {
          control.classList.remove('kit-armed');
          status.textContent = 'Ready';
        }, Number.parseFloat(tokens.motion.find((t) => t.name === 'k-arm-ms').value));
      }
    };
    return node;
  },
};

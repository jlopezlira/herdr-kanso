import { docs, html } from './docs';

export default {
  title: 'Segmented',
  tags: ['autodocs'],
  ...docs('One control for tabs and period pills. The selected segment uses the same foreground step over the same track.', 'A raised pill or a different treatment between themes.'),
};

const segmented = (state, selected = 'Recent') => {
  const node = html(`<div class="kit-seg" role="tablist" aria-label="Activity period">${['Recent', 'All'].map((label) => `<span role="tab" tabindex="${label === selected ? '0' : '-1'}" aria-selected="${label === selected}" class="${label === selected ? 'on' : ''}" data-state="${state}">${label}</span>`).join('')}</div>`);
  const tabs = [...node.children];
  const select = (tab) => {
    for (const item of tabs) {
      item.classList.toggle('on', item === tab);
      item.setAttribute('aria-selected', String(item === tab));
      item.tabIndex = item === tab ? 0 : -1;
    }
  };
  tabs.forEach((tab, index) => {
    tab.onclick = () => select(tab);
    tab.onkeydown = (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + 1) % tabs.length];
        select(next);
        next.focus();
      } else if ([' ', 'Enter'].includes(event.key)) {
        event.preventDefault();
        select(tab);
      }
    };
  });
  return node;
};
export const Off = { render: () => segmented('rest', 'All') };
export const On = { render: () => segmented('rest') };
export const Hover = { render: () => segmented('hover') };
export const Focus = { render: () => segmented('focus-visible') };

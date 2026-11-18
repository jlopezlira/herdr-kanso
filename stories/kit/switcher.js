import { menu } from './kit.js';

export const switcher = ({ sessions = [], picked = 1 }) => menu({
  items: sessions.map(({ program = 'p-claude', name, place = null, status = 'none' }, index) => ({
    icon: program, label: name, hint: place, mark: status === 'none' ? null : status, selected: index === picked,
  })),
});

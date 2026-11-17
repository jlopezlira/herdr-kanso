// Proposed, in review: the switcher, every session on every computer, most recent first, the Menu in its own configuration.
import { menu } from './kit.js';

// `sessions`: most recent first, the one you are in on top; `picked`: the row letting go lands on, the one you were in before when it opens.
// Each row is its program, its name, its place (the project, and the computer when not this one) and its mark only when it has a state.
export const switcher = ({ sessions = [], picked = 1 }) => menu({
  items: sessions.map(({ program = 'p-claude', name, place = null, status = 'none' }, index) => ({
    icon: program, label: name, hint: place, mark: status === 'none' ? null : status, selected: index === picked,
  })),
});

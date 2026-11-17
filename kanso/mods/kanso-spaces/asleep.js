// The asleep section: what sleeps, folded to one heading or open with each one and Wake.
import { list, phrase, row } from './kit.js';

// `title`: a sleeping tab or project names its heading; `focus`: the keyboard is on the heading; `selected`: the one sleeping row it is on.
export const asleep = ({ names = [], open = false, title = 'Asleep', focus = false, selected = -1 } = {}) => list(row({ name: title, heading: true, focus, mark: 'asleep', meta: open ? null : phrase(names.length) }),
  open ? names.map((name, index) => row({ name, depth: 1, dimmed: true, selected: index === selected, action: { label: 'Wake', kind: 'quiet' } })) : null);

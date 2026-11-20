// The rail's tile: one group on the collapsed sidebar, a project, a state or a shelf.
import { avatar, chip, glyph, mark, stack } from './kit.js';

// A project leads with its initial, a shelf with its icon, a state with its mark.
const lead = ({ initial, tone, status, icon }) => {
  if (initial) return avatar({ initial, tone, size: 'md' });
  return icon ? glyph(icon) : mark({ status, size: 'lg' });
};
// Proposed: `label` names the group, its tooltip; `icon` leads a shelf or a group with no state of its own;
// `marked`: the mark of the most urgent state inside stands beside the count; `strong`: something inside is unread or woke.
export const tile = ({ initial = null, tone = 'teal', status = 'none', count = 0, open = false, label = null, icon = null, marked = false, strong = false }) => {
  const many = count ? chip({ label: count, quiet: true, tone: status === 'blocked' ? 'blocked' : null }) : null;
  return stack({ variant: 'rail tile', on: open, strong, label }, lead({ initial, tone, status, icon }),
    marked && many && status !== 'none' ? stack({ variant: 'rail count' }, mark({ status, size: 'sm' }), many) : many);
};

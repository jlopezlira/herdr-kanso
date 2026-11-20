// While you were away: what nothing in view says, four rows then +N more; nothing new takes no space.
import { button, phrase, plus, row, stack } from './kit.js';

// The rows the card shows before +N more. `focus`: the keyboard on a row, or Proposed, at `max`, on +N more.
export const awayMax = 4;
const awayRow = (hover, focus) => ({ icon: lead, tone = null, subject, fact: what, detail = null, age }, index) => row({ icon: lead, tone, name: subject, detail: what, second: detail, meta: age, hover: index === hover, focus: index === focus });
export const activity = ({ events = [], max = awayMax, hover = -1, focus = -1 } = {}) => events.length ? stack({ variant: 'away' },
  row({ name: 'While you were away', heading: true, action: { label: 'Dismiss these', kind: 'icon', icon: 'lu-x' } }),
  events.slice(0, max).map(awayRow(hover, focus)), events.length > max ? button({ label: phrase(plus(events.length - max), 'more'), kind: 'quiet', size: 'sm', flush: true, focus: focus === max }) : null) : null;

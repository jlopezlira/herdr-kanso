import { emptyState, failureLine, menu, phrase, plus, skeletonOf } from './kit.js';

export const resumeEntry = { icon: 'lu-history', label: 'Resume a conversation…' };

const resumeNotes = {
  ready: () => [],
  loading: () => [{ note: skeletonOf({ shape: 'row', count: 3 }) }],
  empty: () => [{ note: emptyState({ icon: 'lu-history', text: 'No past conversations' }) }],
  failed: ({ failure }) => [{ note: failureLine(failure) }],
};

export const resumeStates = Object.keys(resumeNotes);

export const resumeMenu = ({ conversations = [], state = 'ready', picked = -1, more = 0, failure = null }) => menu({ title: 'Resume a conversation', items: [
  { icon: 'lu-chevron-left', label: 'Back' },
  ...conversations.map(({ program = null, title, place, age }, index) => ({ icon: program, label: title, hint: phrase(place, '·', age), selected: index === picked })),
  ...(more ? [{ label: phrase(plus(more), 'more') }] : []),
  ...resumeNotes[state]({ failure }),
] });

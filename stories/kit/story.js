import { content, statesFor } from './catalog.js';
import { escape } from './pieces.js';
import { playgroundStory, playgrounds } from './playgrounds.js';

export function componentStory(page) {
  if (playgrounds[page]) return playgroundStory(playgrounds[page]);
  const states = statesFor(page);
  const labels = { all: 'All states', ...Object.fromEntries(states.map((state) => [state.value, state.label])) };
  const pick = (state) => states.find((item) => item.value === state) ?? states[0];
  const proposal = (item) => {
    const caption = item.caption === undefined ? '' : content(item.caption);
    return caption.startsWith('Proposed.') ? `<p class="kanso-story__variant-caption">${escape(caption)}</p>` : '';
  };
  const drawn = (item) => `${proposal(item)}${content(item.markup)}`;
  const all = () => `<div class="kanso-story__gallery">${states.map((item) => `<section class="kanso-story__variant"><h3 class="kanso-story__variant-label">${item.label}</h3>${drawn(item)}</section>`).join('')}</div>`;
  return {
    name: 'Variants',
    args: { state: page === 'Tokens/Icons' ? 'all' : states[0]?.value ?? 'all' },
    argTypes: { state: { name: 'State', control: { type: 'select', labels }, options: ['all', ...states.map((state) => state.value)], description: 'Choose a variant of this component.' } },
    render: ({ state }) => state === 'all' ? all() : drawn(pick(state)),
    parameters: { docs: { source: { type: 'dynamic', transform: (_code, context) => content(pick(context.args.state).markup) } } },
  };
}

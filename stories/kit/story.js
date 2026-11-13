import { content, statesFor } from './catalog.js';

export function componentStory(page) {
  const states = statesFor(page);
  const labels = { all: 'All states', ...Object.fromEntries(states.map((state) => [state.value, state.label])) };
  const pick = (state) => states.find((item) => item.value === state) ?? states[0];
  const all = () => `<div class="kanso-story__gallery">${states.map((item) => `<section class="kanso-story__variant"><h3 class="kanso-story__variant-label">${item.label}</h3>${content(item.markup)}</section>`).join('')}</div>`;
  return {
    name: 'Variants',
    args: { state: 'all' },
    argTypes: { state: { name: 'State', control: { type: 'select', labels }, options: ['all', ...states.map((state) => state.value)], description: 'Choose a variant of this component.' } },
    render: ({ state }) => state === 'all' ? all() : content(pick(state).markup),
    parameters: { docs: { source: { type: 'dynamic', transform: (_code, context) => content(pick(context.args.state).markup) } } },
  };
}

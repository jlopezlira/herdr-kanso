import { content, statesFor } from './catalog.js';

export function componentStory(page) {
  const states = statesFor(page);
  const labels = Object.fromEntries(states.map((state) => [state.value, state.label]));
  return {
    name: 'Variants',
    args: { state: states[0].value },
    argTypes: { state: { name: 'State', control: { type: 'select', labels }, options: states.map((state) => state.value), description: 'Choose a variant of this component.' } },
    render: ({ state }) => content((states.find((item) => item.value === state) ?? states[0]).markup),
    parameters: { docs: { source: { type: 'dynamic', transform: (_code, context) => content((states.find((item) => item.value === context.args.state) ?? states[0]).markup) } } },
  };
}

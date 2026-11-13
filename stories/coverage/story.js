export const story = ({ caption, variants }) => {
  const states = Object.keys(variants);
  return {
    args: { state: states[0] },
    argTypes: { state: { control: 'select', options: states, description: 'The source-visible state of this component.' } },
    render: ({ state }) => variants[state]?.html ?? variants[states[0]].html,
    parameters: { docs: { description: { story: caption } } },
  };
};

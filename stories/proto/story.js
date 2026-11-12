export const story = ({ html, caption }) => ({ render: () => html, parameters: { docs: { description: { story: caption } } } });

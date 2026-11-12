import stories from './tokens-colour-and-wash.json';
import { story } from './story.js';

export default { title: "Tokens/Colour and wash" };

export const Washes = { name: "Washes", ...story(stories.Washes) };
export const Edges = { name: "Edges", ...story(stories.Edges) };
export const StateColours = { name: "State colours", ...story(stories.StateColours) };

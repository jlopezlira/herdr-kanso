import stories from './tokens-type.json';
import { story } from './story.js';

export default { title: "Tokens/Type" };

export const SixSizes = { name: "Six sizes", ...story(stories.SixSizes) };
export const TextRoles = { name: "Text roles", ...story(stories.TextRoles) };
export const OneLineNeverWraps = { name: "One line never wraps", ...story(stories.OneLineNeverWraps) };

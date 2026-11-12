import stories from './tokens-every-value.json';
import { story } from './story.js';

export default { title: "Tokens/Every value" };

export const EveryValue = { name: "Every value", ...story(stories.EveryValue) };

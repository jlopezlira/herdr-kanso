import stories from './tokens-dawn.json';
import { story } from './story.js';

export default { title: "Tokens/Dawn" };

export const TheBand = { name: "The band", ...story(stories.TheBand) };

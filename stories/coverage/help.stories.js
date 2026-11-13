import stories from './help.json';
import { story } from './story.js';

export default { title: "Coverage/Help", id: "coverage-help" };

export const Help = { name: "Help navigation", ...story(stories.Help) };
export const Guide = { name: "Guide section", ...story(stories.Guide) };
export const KeyboardExplorer = { name: "Keyboard explorer", ...story(stories.KeyboardExplorer) };

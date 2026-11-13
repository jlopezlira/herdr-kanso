import stories from './strip.json';
import { story } from './story.js';

export default { title: "Coverage/Strip", id: "coverage-strip" };

export const PaneTools = { name: "Pane tools", ...story(stories.PaneTools) };
export const StripNavigation = { name: "Strip navigation", ...story(stories.StripNavigation) };

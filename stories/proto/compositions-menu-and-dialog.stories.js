import stories from './compositions-menu-and-dialog.json';
import { story } from './story.js';

export default { title: "Compositions/Menu and dialog" };

export const Sleep = { name: "Sleep", ...story(stories.Sleep) };
export const Arrangement = { name: "Arrangement", ...story(stories.Arrangement) };
export const SourceLine = { name: "Source line", ...story(stories.SourceLine) };
export const FindRow = { name: "Find row", ...story(stories.FindRow) };

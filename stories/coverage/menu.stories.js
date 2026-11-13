import stories from './menu.json';
import { story } from './story.js';

export default { title: "Coverage/Pane menu", id: "coverage-menu" };

export const PaneMenu = { name: "Pane menu", ...story(stories.PaneMenu) };

import stories from './components-panel-menu.json';
import { story } from './story.js';

export default { title: "Components/Panel menu" };

export const PanelMenu = { name: "Panel menu", ...story(stories.PanelMenu) };

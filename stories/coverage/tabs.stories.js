import stories from './tabs.json';
import { story } from './story.js';

export default { title: "Coverage/Tabs", id: "coverage-tabs" };

export const Tabs = { name: "Tab", ...story(stories.Tabs) };
export const PanelToolbar = { name: "Panel toolbar", ...story(stories.PanelToolbar) };

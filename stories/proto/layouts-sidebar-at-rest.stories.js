import stories from './layouts-sidebar-at-rest.json';
import { story } from './story.js';

export default { title: "Layouts/Sidebar at rest" };

export const SidebarAtRest = { name: "Sidebar at rest", ...story(stories.SidebarAtRest) };

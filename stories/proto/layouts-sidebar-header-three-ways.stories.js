import stories from './layouts-sidebar-header-three-ways.json';
import { story } from './story.js';

export default { title: "Layouts/Sidebar header, three ways" };

export const SidebarHeaderThreeWays = { name: "Sidebar header, three ways", ...story(stories.SidebarHeaderThreeWays) };

import stories from './components-tab-bar.json';
import { story } from './story.js';

export default { title: "Components/Tab bar" };

export const TabBar = { name: "Tab bar", ...story(stories.TabBar) };

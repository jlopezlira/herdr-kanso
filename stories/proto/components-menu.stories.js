import stories from './components-menu.json';
import { story } from './story.js';

export default { title: "Components/Menu" };

export const Menu = { name: "Menu", ...story(stories.Menu) };

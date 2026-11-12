import stories from './components-tab-states.json';
import { story } from './story.js';

export default { title: "Components/Tab states" };

export const TabStates = { name: "Tab states", ...story(stories.TabStates) };

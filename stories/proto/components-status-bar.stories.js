import stories from './components-status-bar.json';
import { story } from './story.js';

export default { title: "Components/Status bar" };

export const StatusBar = { name: "Status bar", ...story(stories.StatusBar) };

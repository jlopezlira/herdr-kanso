import stories from './components-status-bar-working.json';
import { story } from './story.js';

export default { title: "Components/Status bar, working" };

export const StatusBarWorking = { name: "Status bar, working", ...story(stories.StatusBarWorking) };

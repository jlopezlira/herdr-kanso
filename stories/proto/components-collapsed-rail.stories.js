import stories from './components-collapsed-rail.json';
import { story } from './story.js';

export default { title: "Components/Collapsed rail" };

export const CollapsedRail = { name: "Collapsed rail", ...story(stories.CollapsedRail) };

import stories from './compositions-bars.json';
import { story } from './story.js';

export default { title: "Compositions/Bars" };

export const ToastWithItsSource = { name: "Toast with its source", ...story(stories.ToastWithItsSource) };
export const StaleBody = { name: "Stale body", ...story(stories.StaleBody) };

import stories from './components-pick-list.json';
import { story } from './story.js';

export default { title: "Components/Pick list" };

export const PickList = { name: "Pick list", ...story(stories.PickList) };

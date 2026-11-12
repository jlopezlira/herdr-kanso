import stories from './components-title-and-tools.json';
import { story } from './story.js';

export default { title: "Components/Title and tools" };

export const TitleAndTools = { name: "Title and tools", ...story(stories.TitleAndTools) };

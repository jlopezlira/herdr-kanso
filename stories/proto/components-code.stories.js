import stories from './components-code.json';
import { story } from './story.js';

export default { title: "Components/Code" };

export const Code = { name: "Code", ...story(stories.Code) };

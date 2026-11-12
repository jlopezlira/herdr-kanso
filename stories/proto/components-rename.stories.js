import stories from './components-rename.json';
import { story } from './story.js';

export default { title: "Components/Rename" };

export const Rename = { name: "Rename", ...story(stories.Rename) };

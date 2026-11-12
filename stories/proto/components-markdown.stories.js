import stories from './components-markdown.json';
import { story } from './story.js';

export default { title: "Components/Markdown" };

export const Markdown = { name: "Markdown", ...story(stories.Markdown) };

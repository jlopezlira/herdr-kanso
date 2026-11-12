import stories from './components-markdown-window.json';
import { story } from './story.js';

export default { title: "Components/Markdown window" };

export const MarkdownWindow = { name: "Markdown window", ...story(stories.MarkdownWindow) };

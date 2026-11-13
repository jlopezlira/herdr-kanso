import stories from './markdown-panel.json';
import { story } from './story.js';

export default { title: "Coverage/Markdown panel", id: "coverage-markdown-panel" };

export const MarkdownFiles = { name: "Markdown files", ...story(stories.MarkdownFiles) };
export const MarkdownReview = { name: "Markdown review", ...story(stories.MarkdownReview) };

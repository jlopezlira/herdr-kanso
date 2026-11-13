import stories from './prompt-editor.json';
import { story } from './story.js';

export default { title: "Coverage/Prompt editor", id: "coverage-prompt-editor" };

export const MultilinePrompt = { name: "Multiline prompt", ...story(stories.MultilinePrompt) };

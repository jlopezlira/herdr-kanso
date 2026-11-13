import stories from './prompt.json';
import { story } from './story.js';

export default { title: "Coverage/Prompt", id: "coverage-prompt" };

export const Prompt = { name: "Prompt", ...story(stories.Prompt) };

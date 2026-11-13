import stories from './arrange.json';
import { story } from './story.js';

export default { title: "Coverage/Arrangements", id: "coverage-arrange" };

export const Arrangements = { name: "Arrangements", ...story(stories.Arrangements) };
export const SaveArrangement = { name: "Save arrangement", ...story(stories.SaveArrangement) };

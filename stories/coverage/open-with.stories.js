import stories from './open-with.json';
import { story } from './story.js';

export default { title: "Coverage/Open with", id: "coverage-open-with" };

export const OpenWith = { name: "Open with", ...story(stories.OpenWith) };

import stories from './dojo.json';
import { story } from './story.js';

export default { title: "Coverage/Dōjō", id: "coverage-dojo" };

export const Practice = { name: "Practice level", ...story(stories.Practice) };
export const PracticeFeedback = { name: "Practice feedback", ...story(stories.PracticeFeedback) };
export const PracticeResult = { name: "Practice result", ...story(stories.PracticeResult) };
export const PracticePet = { name: "Practice companion", ...story(stories.PracticePet) };

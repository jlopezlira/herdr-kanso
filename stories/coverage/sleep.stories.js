import stories from './sleep.json';
import { story } from './story.js';

export default { title: "Coverage/Sleep", id: "coverage-sleep" };

export const SleepDialog = { name: "Sleep dialog", ...story(stories.SleepDialog) };

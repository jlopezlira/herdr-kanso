import stories from './spend.json';
import { story } from './story.js';

export default { title: "Coverage/Spend", id: "coverage-spend" };

export const Spend = { name: "Spend", ...story(stories.Spend) };
export const SpendBreakdown = { name: "Spend breakdown", ...story(stories.SpendBreakdown) };
export const SpendSettings = { name: "Spend settings", ...story(stories.SpendSettings) };
export const SpendChart = { name: "Spend chart", ...story(stories.SpendChart) };

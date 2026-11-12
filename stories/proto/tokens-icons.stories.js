import stories from './tokens-icons.json';
import { story } from './story.js';

export default { title: "Tokens/Icons" };

export const LucideFourSizes = { name: "Lucide, four sizes", ...story(stories.LucideFourSizes) };
export const TheSet = { name: "The set", ...story(stories.TheSet) };
export const ProgramMarks = { name: "Program marks", ...story(stories.ProgramMarks) };
export const EnsoMarks = { name: "Ensō marks", ...story(stories.EnsoMarks) };
export const PendingDotAndGlint = { name: "Pending dot and glint", ...story(stories.PendingDotAndGlint) };
export const TheWholeSet = { name: "The whole set", ...story(stories.TheWholeSet) };

import stories from './compositions-states.json';
import { story } from './story.js';

export default { title: "Compositions/States" };

export const FailureOnALine = { name: "Failure on a line", ...story(stories.FailureOnALine) };
export const FailureBlock = { name: "Failure block", ...story(stories.FailureBlock) };
export const Empty = { name: "Empty", ...story(stories.Empty) };
export const Pending = { name: "Pending", ...story(stories.Pending) };
export const Toast = { name: "Toast", ...story(stories.Toast) };
export const ThePatternEverywhere = { name: "The pattern, everywhere", ...story(stories.ThePatternEverywhere) };

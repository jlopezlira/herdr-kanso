import stories from './components-log.json';
import { story } from './story.js';

export default { title: "Components/Log" };

export const Log = { name: "Log", ...story(stories.Log) };

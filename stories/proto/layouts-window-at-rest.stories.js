import stories from './layouts-window-at-rest.json';
import { story } from './story.js';

export default { title: "Layouts/Window at rest" };

export const WindowAtRest = { name: "Window at rest", ...story(stories.WindowAtRest) };

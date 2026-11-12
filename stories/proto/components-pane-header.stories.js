import stories from './components-pane-header.json';
import { story } from './story.js';

export default { title: "Components/Pane header" };

export const PaneHeader = { name: "Pane header", ...story(stories.PaneHeader) };

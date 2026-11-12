import stories from './components-pane-standing-in.json';
import { story } from './story.js';

export default { title: "Components/Pane standing in" };

export const PaneStandingIn = { name: "Pane standing in", ...story(stories.PaneStandingIn) };

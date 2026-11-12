import stories from './components-dialog.json';
import { story } from './story.js';

export default { title: "Components/Dialog" };

export const Dialog = { name: "Dialog", ...story(stories.Dialog) };

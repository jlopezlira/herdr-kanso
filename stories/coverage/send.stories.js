import stories from './send.json';
import { story } from './story.js';

export default { title: "Coverage/Send", id: "coverage-send" };

export const SendDialog = { name: "Send dialog", ...story(stories.SendDialog) };

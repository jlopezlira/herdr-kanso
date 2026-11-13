import stories from './chrome.json';
import { story } from './story.js';

export default { title: "Coverage/Chrome", id: "coverage-chrome" };

export const SettingsMenu = { name: "Settings menu", ...story(stories.SettingsMenu) };
export const UpdateNotice = { name: "Update notice", ...story(stories.UpdateNotice) };
export const RuntimeNotice = { name: "Runtime notice", ...story(stories.RuntimeNotice) };

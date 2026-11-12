import stories from './layouts-settings-on-dawn.json';
import { story } from './story.js';

export default { title: "Layouts/Settings on Dawn" };

export const SettingsOnDawn = { name: "Settings on Dawn", ...story(stories.SettingsOnDawn) };

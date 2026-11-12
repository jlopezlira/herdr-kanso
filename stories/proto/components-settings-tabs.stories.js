import stories from './components-settings-tabs.json';
import { story } from './story.js';

export default { title: "Components/Settings tabs" };

export const Settings = { name: "Settings", ...story(stories.Settings) };
export const SettingsWhatShows = { name: "Settings, what shows", ...story(stories.SettingsWhatShows) };
export const Keys = { name: "Keys", ...story(stories.Keys) };
export const WindowMap = { name: "Window map", ...story(stories.WindowMap) };
export const WhatsNew = { name: "What's new", ...story(stories.WhatsNew) };
export const Credits = { name: "Credits", ...story(stories.Credits) };

import stories from './settings.json';
import { story } from './story.js';

export default { title: "Coverage/Settings", id: "coverage-settings" };

export const Pieces = { name: "Pieces", ...story(stories.Pieces) };
export const Bindings = { name: "Bindings", ...story(stories.Bindings) };
export const ReleaseControls = { name: "Release controls", ...story(stories.ReleaseControls) };
export const CreditsLoading = { name: "Credits assets", ...story(stories.CreditsLoading) };

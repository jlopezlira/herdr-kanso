import stories from './sim.json';
import { story } from './story.js';

export default { title: "Coverage/Simulator", id: "coverage-sim" };

export const Devices = { name: "Simulator devices", ...story(stories.Devices) };
export const DeviceControls = { name: "Simulator controls", ...story(stories.DeviceControls) };
export const PictureState = { name: "Simulator picture state", ...story(stories.PictureState) };

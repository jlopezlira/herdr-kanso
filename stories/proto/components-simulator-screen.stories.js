import stories from './components-simulator-screen.json';
import { story } from './story.js';

export default { title: "Components/Simulator screen" };

export const SimulatorScreen = { name: "Simulator screen", ...story(stories.SimulatorScreen) };

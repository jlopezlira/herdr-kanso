import stories from './components-edges-and-minimap.json';
import { story } from './story.js';

export default { title: "Components/Edges and minimap" };

export const Edge = { name: "Edge", ...story(stories.Edge) };
export const MinimapSlot = { name: "Minimap slot", ...story(stories.MinimapSlot) };

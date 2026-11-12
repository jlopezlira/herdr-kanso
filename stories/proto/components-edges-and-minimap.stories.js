import stories from './components-edges-and-minimap.json';
import { story } from './story.js';

export default { title: "Components/Edges and minimap" };

export const EdgesAndMinimap = { name: "Edges and minimap", ...story(stories.EdgesAndMinimap) };

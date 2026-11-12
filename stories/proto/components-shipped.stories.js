import stories from './components-shipped.json';
import { story } from './story.js';

export default { title: "Components/Shipped" };

export const Shipped = { name: "Shipped", ...story(stories.Shipped) };

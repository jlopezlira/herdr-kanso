import stories from './layouts-right-click-any-piece.json';
import { story } from './story.js';

export default { title: "Layouts/Right-click any piece" };

export const RightClickAnyPiece = { name: "Right-click any piece", ...story(stories.RightClickAnyPiece) };

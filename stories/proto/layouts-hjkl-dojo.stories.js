import stories from './layouts-hjkl-dojo.json';
import { story } from './story.js';

export default { title: "Layouts/hjkl dōjō" };

export const HjklDojo = { name: "hjkl dōjō", ...story(stories.HjklDojo) };

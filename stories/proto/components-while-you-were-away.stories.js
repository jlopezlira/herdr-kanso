import stories from './components-while-you-were-away.json';
import { story } from './story.js';

export default { title: "Components/While you were away" };

export const WhileYouWereAway = { name: "While you were away", ...story(stories.WhileYouWereAway) };

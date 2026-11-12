import stories from './components-annotated-picture.json';
import { story } from './story.js';

export default { title: "Components/Annotated picture" };

export const AnnotatedPicture = { name: "Annotated picture", ...story(stories.AnnotatedPicture) };

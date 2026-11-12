import stories from './components-new-project.json';
import { story } from './story.js';

export default { title: "Components/New project" };

export const NewProject = { name: "New project", ...story(stories.NewProject) };

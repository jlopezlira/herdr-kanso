import stories from './components-new-worktree.json';
import { story } from './story.js';

export default { title: "Components/New worktree" };

export const NewWorktree = { name: "New worktree", ...story(stories.NewWorktree) };

import stories from './components-worktree-row-open.json';
import { story } from './story.js';

export default { title: "Components/Worktree row, open" };

export const WorktreeRowOpen = { name: "Worktree row, open", ...story(stories.WorktreeRowOpen) };

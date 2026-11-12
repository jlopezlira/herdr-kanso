import stories from './compositions-sidebar-rows.json';
import { story } from './story.js';

export default { title: "Compositions/Sidebar rows" };

export const Computer = { name: "Computer", ...story(stories.Computer) };
export const Project = { name: "Project", ...story(stories.Project) };
export const AgentOneLine = { name: "Agent, one line", ...story(stories.AgentOneLine) };
export const AgentTwoLines = { name: "Agent, two lines", ...story(stories.AgentTwoLines) };
export const SubAgent = { name: "Sub-agent", ...story(stories.SubAgent) };
export const Asleep = { name: "Asleep", ...story(stories.Asleep) };
export const Footer = { name: "Footer", ...story(stories.Footer) };
export const WorktreeRow = { name: "Worktree row", ...story(stories.WorktreeRow) };
export const DropTarget = { name: "Drop target", ...story(stories.DropTarget) };
export const ProjectsStatusThreads = { name: "Projects, Status, Threads", ...story(stories.ProjectsStatusThreads) };
export const StatusViewTile = { name: "Status view tile", ...story(stories.StatusViewTile) };
export const Find = { name: "Find", ...story(stories.Find) };
export const AddComputer = { name: "Add computer", ...story(stories.AddComputer) };
export const DawnBand = { name: "Dawn band", ...story(stories.DawnBand) };

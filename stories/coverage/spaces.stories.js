import stories from './spaces.json';
import { story } from './story.js';

export default { title: "Coverage/Sidebar", id: "coverage-spaces" };

export const Sidebar = { name: "Sidebar", ...story(stories.Sidebar) };
export const SidebarStatus = { name: "Sidebar status", ...story(stories.SidebarStatus) };
export const SidebarThreads = { name: "Sidebar threads", ...story(stories.SidebarThreads) };
export const SidebarSort = { name: "Sidebar sort", ...story(stories.SidebarSort) };
export const ProjectGit = { name: "Project git control", ...story(stories.ProjectGit) };
export const ProjectMenu = { name: "Project menu", ...story(stories.ProjectMenu) };
export const AgentMenu = { name: "Agent menu", ...story(stories.AgentMenu) };
export const NewConversation = { name: "New conversation", ...story(stories.NewConversation) };
export const ProjectCreation = { name: "Project creation", ...story(stories.ProjectCreation) };
export const ComputerMenu = { name: "Computer menu", ...story(stories.ComputerMenu) };
export const Asleep = { name: "Asleep", ...story(stories.Asleep) };
export const NeedsQueue = { name: "Needs queue", ...story(stories.NeedsQueue) };
export const AwayEvents = { name: "Away events", ...story(stories.AwayEvents) };
export const CreateWorktree = { name: "Create worktree", ...story(stories.CreateWorktree) };
export const ActionNotice = { name: "Action notice", ...story(stories.ActionNotice) };

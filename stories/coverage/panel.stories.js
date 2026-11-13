import stories from './panel.json';
import { story } from './story.js';

export default { title: "Coverage/Panels", id: "coverage-panel" };

export const Files = { name: "Files", ...story(stories.Files) };
export const Preview = { name: "Preview", ...story(stories.Preview) };
export const MarkdownEditing = { name: "Markdown editing", ...story(stories.MarkdownEditing) };
export const ConversationFind = { name: "Conversation find", ...story(stories.ConversationFind) };
export const Images = { name: "Images", ...story(stories.Images) };
export const Ports = { name: "Ports", ...story(stories.Ports) };
export const PortHistory = { name: "Port history", ...story(stories.PortHistory) };
export const PullRequest = { name: "Pull request", ...story(stories.PullRequest) };
export const PullRequestContext = { name: "Pull request context", ...story(stories.PullRequestContext) };
export const PullRequestList = { name: "Pull request list", ...story(stories.PullRequestList) };
export const PullRequestDetails = { name: "Pull request details", ...story(stories.PullRequestDetails) };
export const PullRequestPicker = { name: "Pull request picker", ...story(stories.PullRequestPicker) };
export const WorktreeVerdict = { name: "Worktree verdict", ...story(stories.WorktreeVerdict) };
export const Worktrees = { name: "Worktrees", ...story(stories.Worktrees) };
export const WorktreeHistory = { name: "Worktree history", ...story(stories.WorktreeHistory) };
export const Shipped = { name: "Shipped", ...story(stories.Shipped) };
export const Share = { name: "Share", ...story(stories.Share) };
export const VerdictBody = { name: "Verdict body", ...story(stories.VerdictBody) };
export const CodeLimits = { name: "Code length limit", ...story(stories.CodeLimits) };
export const HistoryChart = { name: "Panel history chart", ...story(stories.HistoryChart) };
export const ActionNotice = { name: "Action notice", ...story(stories.ActionNotice) };
export const ShareCard = { name: "Share card", ...story(stories.ShareCard) };

import stories from './compositions-files-and-pr.json';
import { story } from './story.js';

export default { title: "Compositions/Files and PR" };

export const FileRow = { name: "File row", ...story(stories.FileRow) };
export const Snippet = { name: "Snippet", ...story(stories.Snippet) };
export const Reply = { name: "Reply", ...story(stories.Reply) };
export const Checks = { name: "Checks", ...story(stories.Checks) };
export const ChangedOnDisk = { name: "Changed on disk", ...story(stories.ChangedOnDisk) };
export const Picture = { name: "Picture", ...story(stories.Picture) };
export const SkeletonTwoLines = { name: "Skeleton, two lines", ...story(stories.SkeletonTwoLines) };

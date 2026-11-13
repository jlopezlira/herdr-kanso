import stories from './files.json';
import { story } from '../proto/story.js';

export default { title: "Panels/Files" };

export const FilesAtRestComparison = { name: "Files, At rest, comparison", ...story(stories.FilesAtRestComparison) };
export const FilesAtRestBefore = { name: "Files, At rest, Before", ...story(stories.FilesAtRestBefore) };
export const FilesAtRestNow = { name: "Files, At rest, Now", ...story(stories.FilesAtRestNow) };
export const FilesOnThePointer = { name: "Files, On the pointer", ...story(stories.FilesOnThePointer) };
export const FilesAtRestNowLight = { name: "Files, At rest, Now, light", ...story(stories.FilesAtRestNowLight) };
export const FilesChangedOpenedFromTheDigest = { name: "Files, Changed, opened from the digest", ...story(stories.FilesChangedOpenedFromTheDigest) };
export const FilesAllFilesWithMarks = { name: "Files, All files, with marks", ...story(stories.FilesAllFilesWithMarks) };
export const FilesRightClickARow = { name: "Files, Right-click a row", ...story(stories.FilesRightClickARow) };
export const FilesAShellPaneNothingNamed = { name: "Files, A shell pane: nothing named", ...story(stories.FilesAShellPaneNothingNamed) };
export const FilesNothingChanged = { name: "Files, Nothing changed", ...story(stories.FilesNothingChanged) };
export const FilesNotARepositoryTheTreeOnly = { name: "Files, Not a repository: the tree only", ...story(stories.FilesNotARepositoryTheTreeOnly) };
export const FilesFirstRead = { name: "Files, First read", ...story(stories.FilesFirstRead) };
export const FilesErrorTheFoldersOwnWords = { name: "Files, Error: the folder's own words", ...story(stories.FilesErrorTheFoldersOwnWords) };
export const FilesNoFolderForThisPane = { name: "Files, No folder for this pane", ...story(stories.FilesNoFolderForThisPane) };
export const FilesOnAnotherComputer = { name: "Files, On another computer", ...story(stories.FilesOnAnotherComputer) };
export const FilesStaleDevboxStoppedAnswering = { name: "Files, Stale: devbox stopped answering", ...story(stories.FilesStaleDevboxStoppedAnswering) };
export const FilesUnreachableBeforeTheFirstRead = { name: "Files, Unreachable before the first read", ...story(stories.FilesUnreachableBeforeTheFirstRead) };
export const FilesLight = { name: "Files, Light", ...story(stories.FilesLight) };
export const FilesLightAllFiles = { name: "Files, Light, all files", ...story(stories.FilesLightAllFiles) };
export const FilesNarrow300 = { name: "Files, Narrow, 300", ...story(stories.FilesNarrow300) };

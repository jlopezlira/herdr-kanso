import stories from './skeleton.json';
import { story } from '../proto/story.js';

export default { title: "Panels/Skeleton" };

export const SkeletonHeaderScopePeriodTheNumber = { name: "Skeleton, Header, scope, period, the number", ...story(stories.SkeletonHeaderScopePeriodTheNumber) };
export const SkeletonSectionsAndTheOneRowRestHoverSelectedArmed = { name: "Skeleton, Sections and the one row: rest, hover, selected, armed", ...story(stories.SkeletonSectionsAndTheOneRowRestHoverSelectedArmed) };
export const SkeletonWithAMarkAndTheOneLineForm = { name: "Skeleton, With a mark, and the one-line form", ...story(stories.SkeletonWithAMarkAndTheOneLineForm) };
export const SkeletonFirstRead = { name: "Skeleton, First read", ...story(stories.SkeletonFirstRead) };
export const SkeletonEmpty = { name: "Skeleton, Empty", ...story(stories.SkeletonEmpty) };
export const SkeletonAReadFailedWhereTheListWouldStart = { name: "Skeleton, A read failed: where the list would start", ...story(stories.SkeletonAReadFailedWhereTheListWouldStart) };
export const SkeletonStaleAnotherComputerStoppedAnswering = { name: "Skeleton, Stale: another computer stopped answering", ...story(stories.SkeletonStaleAnotherComputerStoppedAnswering) };
export const SkeletonNarrow300Title15MetaTruncates = { name: "Skeleton, Narrow, 300: title 15, meta truncates", ...story(stories.SkeletonNarrow300Title15MetaTruncates) };

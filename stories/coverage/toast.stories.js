import stories from './toast.json';
import { story } from './story.js';

export default { title: "Coverage/Notices", id: "coverage-toast" };

export const Notice = { name: "Notice", ...story(stories.Notice) };
export const NoticeStack = { name: "Notice stack", ...story(stories.NoticeStack) };

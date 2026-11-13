import stories from './guard.json';
import { story } from './story.js';

export default { title: "Coverage/Memory", id: "coverage-guard" };

export const Memory = { name: "Memory", ...story(stories.Memory) };
export const MemoryAgent = { name: "Memory agent", ...story(stories.MemoryAgent) };
export const MemoryRecovery = { name: "Memory recovery", ...story(stories.MemoryRecovery) };
export const MemoryHistory = { name: "Memory history", ...story(stories.MemoryHistory) };
export const MemoryChart = { name: "Memory chart", ...story(stories.MemoryChart) };
export const SystemNotice = { name: "System notice", ...story(stories.SystemNotice) };

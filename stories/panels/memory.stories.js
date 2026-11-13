import stories from './memory.json';
import { story } from '../proto/story.js';

export default { title: "Panels/Memory" };

export const MemoryRestGuardOnOneAgentNeedsYouOnePastTheLimit = { name: "Memory, Rest: guard on, one agent needs you, one past the limit", ...story(stories.MemoryRestGuardOnOneAgentNeedsYouOnePastTheLimit) };
export const MemoryLowTheWindowPastItsLimit = { name: "Memory, Low · the window past its limit", ...story(stories.MemoryLowTheWindowPastItsLimit) };
export const MemoryRecycle3IdleTwoConfirmedOnePending = { name: "Memory, Recycle 3 idle: two confirmed, one pending", ...story(stories.MemoryRecycle3IdleTwoConfirmedOnePending) };
export const MemoryRecycledOneRefusedOnItsRowAnAgentArmed = { name: "Memory, Recycled · one refused, on its row · an agent armed", ...story(stories.MemoryRecycledOneRefusedOnItsRowAnAgentArmed) };
export const MemoryGuardOff = { name: "Memory, Guard off", ...story(stories.MemoryGuardOff) };
export const MemoryTurnOnPending = { name: "Memory, Turn on, pending", ...story(stories.MemoryTurnOnPending) };
export const MemoryTurnOnRefusedInTheInstallersWords = { name: "Memory, Turn on refused, in the installer's words", ...story(stories.MemoryTurnOnRefusedInTheInstallersWords) };
export const MemoryStaleTheGuardStoppedAnswering = { name: "Memory, Stale: the guard stopped answering", ...story(stories.MemoryStaleTheGuardStoppedAnswering) };
export const MemoryFirstRead = { name: "Memory, First read", ...story(stories.MemoryFirstRead) };
export const MemoryWindowsTheGuardReadsTheWorkingSet = { name: "Memory, Windows: the guard reads the working set", ...story(stories.MemoryWindowsTheGuardReadsTheWorkingSet) };
export const MemoryAnotherComputerNarrow300 = { name: "Memory, Another computer · narrow, 300", ...story(stories.MemoryAnotherComputerNarrow300) };
export const MemoryHistoryOpenFreeOverTimeThenWhatTheGuardDid = { name: "Memory, History open: free over time, then what the guard did", ...story(stories.MemoryHistoryOpenFreeOverTimeThenWhatTheGuardDid) };
export const MemoryOnlyTheAgentYouAreOnIsIdleNoBulkRecycle = { name: "Memory, Only the agent you are on is idle: no bulk recycle", ...story(stories.MemoryOnlyTheAgentYouAreOnIsIdleNoBulkRecycle) };
export const MemoryAtRestNow = { name: "Memory, At rest, Now", ...story(stories.MemoryAtRestNow) };
export const MemoryAtRestNowLight = { name: "Memory, At rest, Now, light", ...story(stories.MemoryAtRestNowLight) };
export const MemoryPointerOnDocs = { name: "Memory, Pointer on docs", ...story(stories.MemoryPointerOnDocs) };

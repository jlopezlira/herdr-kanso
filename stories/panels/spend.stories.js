import stories from './spend.json';
import { story } from '../proto/story.js';

export default { title: "Panels/Spend" };

export const SpendWellUsedTheMonthPerPlanThenToday = { name: "Spend, Well used: the month per plan, then today", ...story(stories.SpendWellUsedTheMonthPerPlanThenToday) };
export const SpendUnderUsedUnder1SaidInWorking = { name: "Spend, Under-used: under 1×, said in working", ...story(stories.SpendUnderUsedUnder1SaidInWorking) };
export const SpendMonthJustStartedTooEarlyToSayThePaceInstead = { name: "Spend, Month just started: too early to say, the pace instead", ...story(stories.SpendMonthJustStartedTooEarlyToSayThePaceInstead) };
export const SpendSeveralComputersEachOnesSessionsSummed = { name: "Spend, Several computers: each one's sessions summed", ...story(stories.SpendSeveralComputersEachOnesSessionsSummed) };
export const SpendNoPlanAPIKeysArePlainCost = { name: "Spend, No plan: API keys are plain cost", ...story(stories.SpendNoPlanAPIKeysArePlainCost) };
export const SpendSettingsSourcesAndPlansDetected = { name: "Spend, Settings: sources and plans, detected", ...story(stories.SpendSettingsSourcesAndPlansDetected) };
export const SpendAPlanCorrectedInPlace = { name: "Spend, A plan corrected in place", ...story(stories.SpendAPlanCorrectedInPlace) };
export const SpendFirstRead = { name: "Spend, First read", ...story(stories.SpendFirstRead) };
export const SpendEmptyNothingThisMonth = { name: "Spend, Empty: nothing this month", ...story(stories.SpendEmptyNothingThisMonth) };
export const SpendAReadFailedNothingKept = { name: "Spend, A read failed, nothing kept", ...story(stories.SpendAReadFailedNothingKept) };
export const SpendAPlanThatCouldNotBeReadOnItsRow = { name: "Spend, A plan that could not be read, on its row", ...story(stories.SpendAPlanThatCouldNotBeReadOnItsRow) };
export const SpendAProjectOpenedFromItsRow = { name: "Spend, A project, opened from its row", ...story(stories.SpendAProjectOpenedFromItsRow) };
export const SpendATaskOpenedFromItsRow = { name: "Spend, A task, opened from its row", ...story(stories.SpendATaskOpenedFromItsRow) };
export const SpendNarrow300 = { name: "Spend, Narrow, 300", ...story(stories.SpendNarrow300) };
export const SpendAtRestNow = { name: "Spend, At rest, Now", ...story(stories.SpendAtRestNow) };
export const SpendAtRestNowLight = { name: "Spend, At rest, Now, light", ...story(stories.SpendAtRestNowLight) };
export const SpendPointerOnToday = { name: "Spend, Pointer on today", ...story(stories.SpendPointerOnToday) };

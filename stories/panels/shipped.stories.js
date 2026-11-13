import stories from './shipped.json';
import { story } from '../proto/story.js';

export default { title: "Panels/Shipped" };

export const ShippedAtRestComparison = { name: "Shipped, At rest, comparison", ...story(stories.ShippedAtRestComparison) };
export const ShippedAtRestBefore = { name: "Shipped, At rest, Before", ...story(stories.ShippedAtRestBefore) };
export const ShippedAtRestNow = { name: "Shipped, At rest, Now", ...story(stories.ShippedAtRestNow) };
export const ShippedOnThePointer = { name: "Shipped, On the pointer", ...story(stories.ShippedOnThePointer) };
export const ShippedAtRestNowLight = { name: "Shipped, At rest, Now, light", ...story(stories.ShippedAtRestNowLight) };
export const ShippedThisWeek = { name: "Shipped, This week", ...story(stories.ShippedThisWeek) };
export const ShippedLight = { name: "Shipped, Light", ...story(stories.ShippedLight) };
export const ShippedADayNarrow300 = { name: "Shipped, A day, narrow 300", ...story(stories.ShippedADayNarrow300) };
export const ShippedFirstRead = { name: "Shipped, First read", ...story(stories.ShippedFirstRead) };
export const ShippedStillAddingUp = { name: "Shipped, Still adding up", ...story(stories.ShippedStillAddingUp) };
export const ShippedNothingInThisPeriod = { name: "Shipped, Nothing in this period", ...story(stories.ShippedNothingInThisPeriod) };
export const ShippedNotSignedInToGitHub = { name: "Shipped, Not signed in to GitHub", ...story(stories.ShippedNotSignedInToGitHub) };
export const ShippedGitHubCLINotInstalled = { name: "Shipped, GitHub CLI not installed", ...story(stories.ShippedGitHubCLINotInstalled) };
export const ShippedGitHubNotAnswering = { name: "Shipped, GitHub not answering", ...story(stories.ShippedGitHubNotAnswering) };
export const ShippedShareWhatLeavesThenWhere = { name: "Shipped, Share: what leaves, then where", ...story(stories.ShippedShareWhatLeavesThenWhere) };
export const ShippedTheCardItMakes1200WideShownAtHalf = { name: "Shipped, The card it makes (1200 wide, shown at half)", ...story(stories.ShippedTheCardItMakes1200WideShownAtHalf) };
export const ShippedLightCard = { name: "Shipped, Light card", ...story(stories.ShippedLightCard) };

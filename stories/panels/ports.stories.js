import stories from './ports.json';
import { story } from '../proto/story.js';

export default { title: "Panels/Ports" };

export const PortsRestTwoWithNoPaneTwoInPanes = { name: "Ports, Rest: two with no pane, two in panes", ...story(stories.PortsRestTwoWithNoPaneTwoInPanes) };
export const PortsArmedOneStopPending = { name: "Ports, Armed · one stop pending", ...story(stories.PortsArmedOneStopPending) };
export const PortsInAPaneSelectedAStopRefusedOnItsRow = { name: "Ports, In a pane, selected · a stop refused, on its row", ...story(stories.PortsInAPaneSelectedAStopRefusedOnItsRow) };
export const PortsHistoryOpenShareFromTheHeader = { name: "Ports, History open · Share from the header", ...story(stories.PortsHistoryOpenShareFromTheHeader) };
export const PortsAnotherComputer = { name: "Ports, Another computer", ...story(stories.PortsAnotherComputer) };
export const PortsAnotherComputerUnreachable = { name: "Ports, Another computer, unreachable", ...story(stories.PortsAnotherComputerUnreachable) };
export const PortsFirstRead = { name: "Ports, First read", ...story(stories.PortsFirstRead) };
export const PortsEmpty = { name: "Ports, Empty", ...story(stories.PortsEmpty) };
export const PortsAReadFailed = { name: "Ports, A read failed", ...story(stories.PortsAReadFailed) };
export const PortsFromTheStatusBarTheRowIsSelectedAndStopHasFocus = { name: "Ports, From the status bar: the row is selected and Stop has focus", ...story(stories.PortsFromTheStatusBarTheRowIsSelectedAndStopHasFocus) };
export const PortsNarrow300TheCommandFoldsAway = { name: "Ports, Narrow, 300: the command folds away", ...story(stories.PortsNarrow300TheCommandFoldsAway) };
export const PortsAtRestNow = { name: "Ports, At rest, Now", ...story(stories.PortsAtRestNow) };
export const PortsAtRestNowLight = { name: "Ports, At rest, Now, light", ...story(stories.PortsAtRestNowLight) };
export const PortsPointerOn6006 = { name: "Ports, Pointer on:6006", ...story(stories.PortsPointerOn6006) };

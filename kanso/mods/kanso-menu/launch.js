import { openOverlay, spaces } from "herdr";
import { DIALOG } from "./ui.js";

export const sendOverlay = ({ pane }) => ({ mod: "kanso-send", kind: "dialog", width: DIALOG.wide, props: { pane } });

export const sleepOverlay = ({ space, tab, pane }) => ({ mod: "kanso-sleep", kind: "dialog", width: DIALOG.wide, props: { sleep: { scope: "agent", space, tab, pane } } });

export const openSend = (p) => openOverlay(sendOverlay(p));

export const openSleep = (p) => {
  const space = spaces().find((s) => s.tabs.some((t) => t.id === p.tab));
  if (space) openOverlay(sleepOverlay({ space: space.id, tab: p.tab, pane: p.pane }));
};

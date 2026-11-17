// The Open with popup, on the machine the pane's space lives on.
import { spaces, openOverlay } from "herdr";

export function openWithPopup(pane) {
  const space = spaces().find((s) => s.tabs.some((x) => x.id === pane.tab));
  openOverlay({ mod: "open-with", kind: "popup", width: 340, props: { folder: pane.cwd, machine: space?.machine ?? null } });
}

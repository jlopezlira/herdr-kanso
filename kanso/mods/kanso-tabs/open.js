// The way into the arrangements dialog, from the tab bar and from the strip.
import { openOverlay } from "herdr";

export const openArrange = () => openOverlay({ mod: "kanso-arrange", kind: "dialog", width: 480 });

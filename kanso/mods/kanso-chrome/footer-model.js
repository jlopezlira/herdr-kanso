// The sidebar footer as data: its rows' words, its sizes, and the Settings menu's entries.
import { H } from "./ui.js";
import { FOOTER } from "./ui-stack.js";
import { parseRelease } from "./release.js";

export const KANSO_SETTINGS = "kanso-tabs.settings";
export const COLLAPSED = "sidebar.collapsed";
// At the sidebar's narrowest our words can wrap once; the block is fitted for that.
export const REFUSAL_LINES = 2;
export const ITEM = Object.freeze({ kanso: "kanso", herdr: "herdr", updateHerdr: "update-herdr" });

// A Dawn Mode build is a prerelease: its row names the build, not kansō.
export const updateLabel = (version, busy) => {
  if (busy) return "Updating kansō";
  return parseRelease(version)?.channel ? `Update to ${version}` : `Update kansō to ${version}`;
};

/** The open footer's height, in the kit's footer room: its rows, and `refusedPx` (a refused update's block, or 0) with its margins. */
export const footerHeight = (rows, refusedPx = 0) => FOOTER.top + rows * H.line + FOOTER.bottom
  + (refusedPx ? FOOTER.refusalAbove + Math.ceil(refusedPx) + FOOTER.refusalBelow : 0);

/** The rail footer's height: its squares (the kit's large icon button), a hair apart. */
export const railHeight = (rows) => FOOTER.top + rows * H.line + (rows - 1) * FOOTER.railGap + FOOTER.railBottom;

/** A refused update's failure block: our words, the tool's, and Update to try again. */
export const refusalBlock = (why, agent = "") => ({ text: "kansō didn't update", source: why, fix: "Update", agent });

export const explainRefusal = (why) => `kansō could not update itself. The tool said: ${why}\nExplain in plain words what went wrong and how to fix it.`;

/** The chord bound to kansō settings, or null. `bindings`: Herdr's keys(). */
export const settingsChord = (bindings) => bindings.find((binding) => binding.action === KANSO_SETTINGS)?.keys ?? null;

/** kansō settings with its key, Herdr settings and, while Herdr has `ready` waiting, its update after a line. */
export const settingsEntries = ({ ready = null, hint = null } = {}) => [
  { key: ITEM.kanso, icon: "sliders-vertical", label: "kansō settings", hint },
  { key: ITEM.herdr, icon: "panels-top-left", label: "Herdr settings" },
  ...(ready ? [{ separator: true }, { key: ITEM.updateHerdr, icon: "refresh-cw", label: `Update Herdr to ${ready}`, verb: "restart Herdr" }] : []),
];

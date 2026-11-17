// The sidebar footer as data: its rows in their words, its sizes, and the Settings menu's entries.
import { G, H, CHROME_SQUARE } from "./ui.js";
import { parseRelease } from "./release.js";

export const KANSO_SETTINGS = "kanso-tabs.settings";
export const COLLAPSED = "sidebar.collapsed";
// At the sidebar's narrowest our words can wrap once; the block is fitted for that.
export const REFUSAL_LINES = 2;
export const ROW = Object.freeze({ update: "kanso-update", settings: "settings" });
export const ITEM = Object.freeze({ kanso: "kanso", herdr: "herdr", updateHerdr: "update-herdr" });

// Open, rows touch between 8 above and 16 below, their edge 8 in (a kit row reaches 8 past its parent); in the rail, squares a hair apart above 12.
export const PAD = Object.freeze({ top: G.sm, bottom: G.lg, side: G.lg, railBottom: G.md, railGap: G.hair });
// A refused update's block sits under its row, a hair below it and 8 above the next.
export const REFUSAL = Object.freeze({ above: G.hair, below: G.sm });

// A Dawn Mode build is a prerelease: its row names the build, not kansō.
export const updateLabel = (version, busy) => {
  if (busy) return "Updating kansō";
  return parseRelease(version)?.channel ? `Update to ${version}` : `Update kansō to ${version}`;
};

/** kansō's update while one is offered (quiet once pressed), then Settings. */
export const footerRows = ({ update = null, busy = false } = {}) => [
  ...(update ? [{ key: ROW.update, icon: "refresh-cw", name: updateLabel(update, busy), quiet: busy }] : []),
  { key: ROW.settings, icon: "settings", name: "Settings", quiet: true },
];

/** The open footer's height: its rows, and `refusedPx` (a refused update's block, or 0) with its margins. */
export const footerHeight = (rows, refusedPx = 0) => PAD.top + rows * H.line + PAD.bottom
  + (refusedPx ? REFUSAL.above + Math.ceil(refusedPx) + REFUSAL.below : 0);

/** The rail footer's height: its squares, a hair apart. */
export const railHeight = (rows) => PAD.top + rows * CHROME_SQUARE + (rows - 1) * PAD.railGap + PAD.railBottom;

/** A refused update's failure block: our words, the tool's, and Update to try again. */
export const refusalBlock = (why, retry = null) => ({ what: "kansō didn't update", why, fixes: [{ label: "Update", onClick: retry }] });

/** The chord bound to kansō settings, or null. `bindings`: Herdr's keys(). */
export const settingsChord = (bindings) => bindings.find((binding) => binding.action === KANSO_SETTINGS)?.keys ?? null;

/** kansō settings with its key, Herdr settings and, while Herdr has `ready` waiting, its update after a line. */
export const settingsEntries = ({ ready = null, hint = null } = {}) => [
  { key: ITEM.kanso, icon: "sliders-vertical", label: "kansō settings", hint },
  { key: ITEM.herdr, icon: "panels-top-left", label: "Herdr settings" },
  ...(ready ? [{ separator: true }, { key: ITEM.updateHerdr, icon: "refresh-cw", label: `Update Herdr to ${ready}`, verb: "restart Herdr" }] : []),
];

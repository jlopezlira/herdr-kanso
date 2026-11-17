// The shell of a full-page mod view: whether the page is on screen, and the centered column it draws in.
import { v_flex, h_flex } from "gpui-base";
import { layout } from "herdr";
import { G } from "./ui.js";
import { tryOr } from "./pure.js";

// The path down to the mod's block, or null when it is not in the layout (a pane or overlay copy).
const pathOf = (node, mod) => {
  if (node?.content?.mod === mod) return [node];
  for (const kid of node?.children ?? []) {
    const below = pathOf(kid, mod);
    if (below) return [node, ...below];
  }
  return null;
};

// Hidden itself, or a stack showing another child than the one below it on the path.
const covered = (path, at) => {
  const node = path[at], below = path[at + 1];
  return Boolean(node.hidden) || (node.type === "stack" && node.active && below && node.active !== below.id);
};

// True when the mod's block is in the layout but not on screen: Herdr keeps hidden copies (and their timers) alive.
export function hiddenInLayout(mod) {
  const path = tryOr(() => pathOf(layout(), mod), null);
  if (!path) return false;
  return path.some((node, at) => covered(path, at));
}

// The page's one wide row: a centered column that never outgrows 1080, `build` fills it.
export function pageFrame(narrow, gap, build) {
  const column = v_flex().w_full().max_w(1080).gap(gap);
  return h_flex().flex_none().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28)
    .child(build(column));
}

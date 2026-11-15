// Where the sidebar's tree guide lines go: they are see-through, so no pixel is painted twice.
// One row's bars, inside the row: `end` is └, `tee` ├, `pass` │; `reach` climbs to meet the line above.
export function guideBars(kind, { x, elbow, h, reach }) {
  const mid = h / 2;
  const down = { left: x, top: -reach, w: 1, h: (kind === "end" ? mid : h) + reach };
  if (kind === "pass") return [down];
  const inset = kind === "end" ? 0 : 1;
  return [down, { left: x + inset, top: mid, w: elbow - inset, h: 1 }];
}

// A worktree's climb: to its sibling's row when only closed folds lie between, else `overlap` into a row with no line.
export function climb(above, gap, overlap) {
  const at = above.findLastIndex((it) => it.row);
  if (at < 0 || !above[at].tree) return overlap;
  const between = above.slice(at + 1);
  return between.every((it) => it.h === 0) ? gap * (between.length + 1) : overlap;
}

// A sub-agent's climb in column `c`: into its parent's row (no line in its own column) when first, else the gap to the row above.
export const reachOf = (lines, c, { first, gap = 1 }, into) => (first && c === lines.length - 1 ? into : gap);

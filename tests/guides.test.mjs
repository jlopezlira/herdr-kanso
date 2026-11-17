// The sidebar's tree guides are see-through: rows join with no gap and no pixel painted twice.
import test from "node:test";
import assert from "node:assert/strict";
import { guideBars, climb, reachOf } from "../kanso/mods/kanso-spaces/guides.js";

const ROW = 32, GAP = 1, OVERLAP = 4;

// Every bar at its place in the list, counted per pixel.
const paint = (bars) => bars.reduce((px, b) => {
  const cells = Array.from({ length: b.w * b.h }, (_, i) => `${b.left + (i % b.w)},${b.top + Math.floor(i / b.w)}`);
  return cells.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), px);
}, new Map());
const twice = (px) => [...px].filter(([, n]) => n > 1).map(([k]) => k);
const column = (px, x) => [...px.keys()].filter((k) => k.startsWith(`${x},`)).map((k) => Number(k.split(",")[1])).toSorted((a, b) => a - b);
const unbroken = (ys) => ys.every((y, i) => i === 0 || y === ys[i - 1] + 1);

// Worktree rows as the projects view lays them out: each item `h` tall, GAP apart.
const worktrees = (rows) => rows.reduce((acc, r) => {
  const items = r.tree ? [{ row: true, tree: true, h: ROW, last: r.last, reach: climb(acc.items, GAP, OVERLAP) }] : [{ row: true, tree: false, h: ROW }];
  const all = [...items, ...(r.box == null ? [] : [{ h: r.box }])];
  return all.reduce((a, it) => ({ items: [...a.items, it], ys: [...a.ys, a.y], y: a.y + it.h + GAP }), acc);
}, { items: [], ys: [], y: 0 });
const worktreeBars = ({ items, ys }) => items.flatMap((it, i) => (it.tree
  ? guideBars(it.last ? "end" : "tee", { x: 13, elbow: 11, h: ROW, reach: it.reach }).map((b) => ({ ...b, top: b.top + ys[i] }))
  : []));

// The worktree guides' pixels, none of them painted twice.
const paintedOnce = (laid) => {
  const px = paint(worktreeBars(laid));
  assert.deepEqual(twice(px), []);
  return px;
};

test("A project's worktree guides join row to row, past a closed fold, without painting any pixel twice", () => {
  const laid = worktrees([{ tree: false }, { tree: true }, { tree: true, box: 0 }, { tree: true }, { tree: true, last: true }]);
  const px = paintedOnce(laid);
  const ys = column(px, 13);
  assert.ok(unbroken(ys), "the line has no gap");
  const heads = laid.items.map((it, i) => [it, laid.ys[i]]).filter(([it]) => it.tree).map(([, y]) => y);
  assert.equal(ys[0], heads[0] - OVERLAP, "it starts inside the project's row");
  assert.equal(ys.at(-1), heads.at(-1) + ROW / 2, "it ends at the last bend");
});

test("A worktree guide stops above an open fold, as before, and still paints nothing twice", () => {
  const laid = worktrees([{ tree: false }, { tree: true, box: 40 }, { tree: true, last: true }]);
  const px = paintedOnce(laid);
  assert.equal(laid.items[3].reach, OVERLAP);
});

test("A bend is painted once where the line meets it", () => {
  for (const kind of ["tee", "end"]) {
    const px = paint(guideBars(kind, { x: 7, elbow: 15, h: 44, reach: 1 }));
    assert.deepEqual(twice(px), [], kind);
  }
});

// Sub-agent rows: lines per column, 15px columns, `gap` above each row (0 inside a slab).
const agentBars = (rows) => rows.reduce((acc, r) => {
  const bars = r.lines.flatMap((l, c) => (l ? guideBars({ "└": "end", "├": "tee", "│": "pass" }[l], { x: c * 15 + 7, elbow: 15, h: ROW, reach: reachOf(r.lines, c, r, OVERLAP) }) : [])
    .map((b) => ({ ...b, top: b.top + acc.y + (r.gap ?? 1) })));
  return { bars: [...acc.bars, ...bars], y: acc.y + (r.gap ?? 1) + ROW };
}, { bars: [], y: -1 }).bars;

test("Sub-agent guides join row to row, in and out of a slab, without painting any pixel twice", () => {
  for (const gaps of [[1, 1, 1, 1], [0, 0, 0, 0], [1, 0, 1, 0]]) {
    const rows = [
      { lines: [] },
      { lines: ["├"], first: true },
      { lines: ["│", "├"], first: true },
      { lines: ["│", "└"] },
      { lines: ["└"] },
    ].map((r, i) => ({ ...r, gap: i ? gaps[i - 1] : 1 }));
    const px = paint(agentBars(rows));
    assert.deepEqual(twice(px), [], `gaps ${gaps}`);
    assert.ok(unbroken(column(px, 7)), `the first column has no gap with gaps ${gaps}`);
    assert.ok(unbroken(column(px, 22)), `the second column has no gap with gaps ${gaps}`);
  }
});

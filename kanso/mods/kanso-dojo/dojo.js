// hjkl dōjō, kansō help's vim game, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// The game's world and its moves, with nothing drawn: a board of cells
// (levels 1 to 5) or a few lines of code (6 to 9), a cursor, a target,
// vim's motions on them, and the fewest moves from one to the other
// (a breadth-first search over the moves a level allows), which gives the
// score and the hint.
import { range } from "./pure.js";

export const GRID = { w: 18, h: 8 };

// Lines of code to move through; each one is a line a person could write.
export const SNIPPETS = [
  [
    "const herd = agents.filter((a) => a.idle);",
    "for (const a of herd) await sleep(a, \"night\");",
    "function wake(tab) { return tab.panes.map(open); }",
    "if (!ready) return; // wait for the strip",
    "let mark = enso(\"working\").spin(900);",
  ],
  [
    "export default class Strip extends View {",
    "  init(props, cx) { this.cols = []; }",
    "  focus(pane) { run(\"pane.focus\", { pane }); }",
    "  width(col) { return col.w ?? 1 / this.n; }",
    "}",
  ],
  [
    "git switch -c feat/vim-keys && git push -u origin",
    "hc send t57 \"stop the browsers, they cost memory\"",
    "sqlite3 vim.db \"SELECT level, MAX(score) FROM rounds;\"",
    "npm test -- --watch tests/flow.test.mjs",
    "claude --model opus --resume 5993c9d5",
  ],
];

// The levels: the motions each one takes, where its targets go, and a tip.
export const LEVELS = [
  { n: 1, name: "h l", world: "grid", motions: ["h", "l"], aim: "row", tip: "h moves left, l right. Your right index finger rests on j; h is one key to its left." },
  { n: 2, name: "j k", world: "grid", motions: ["j", "k"], aim: "column", tip: "j goes down (its tail hangs below the line), k goes up. Index on j, middle finger on k." },
  { n: 3, name: "h j k l", world: "grid", motions: ["h", "j", "k", "l"], aim: "any", tip: "All four without looking down: index on j, middle on k, ring on l, and h one to the left of the index." },
  { n: 4, name: "0 $ gg G", world: "grid", motions: ["h", "j", "k", "l", "0", "$", "gg", "G"], aim: "edges", tip: "0 and $ jump to the ends of a row, gg and G to the first and the last row." },
  { n: 5, name: "Counts", world: "grid", motions: ["h", "j", "k", "l"], counts: true, aim: "far", tip: "A number first moves that many: 5l is five to the right, 3j three down." },
  { n: 6, name: "w b e", world: "text", motions: ["h", "j", "k", "l", "w", "b", "e"], aim: "words", tip: "w jumps to the next word, b back to the start of a word, e to the end of one." },
  { n: 7, name: "f t", world: "text", motions: ["h", "l", "f", "t", "F", "T"], aim: "line", tip: "f and a letter jumps onto the next one on the line, t just before it; F and T look back." },
  { n: 8, name: "0 ^ $", world: "text", motions: ["h", "j", "k", "l", "0", "^", "$", "gg", "G"], aim: "ends", tip: "0 is the line's very start, ^ its first letter, $ its end; gg and G the first and last line." },
  { n: 9, name: "All of it", world: "text", motions: ["h", "j", "k", "l", "w", "b", "e", "f", "t", "F", "T", "0", "^", "$", "gg", "G"], aim: "any", tip: "Everything so far. Reach for the move that gets there in one." },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const same = (a, b) => a.x === b.x && a.y === b.y;

// A world: { kind: "grid", w, h } or { kind: "text", lines }.
export const gridWorld = () => ({ kind: "grid", w: GRID.w, h: GRID.h });
export const textWorld = (i) => ({ kind: "text", lines: SNIPPETS[i % SNIPPETS.length] });

// Characters as vim's small words see them: a blank, a word letter, other.
const kind = (ch) => (ch === undefined || ch === " " || ch === "\t" ? 0 : /\w/.test(ch) ? 1 : 2);
const firstNonBlank = (line) => Math.max(0, line.search(/\S/));
const lastCol = (line) => Math.max(0, line.length - 1);
// From `i`, a step at a time, while `go` holds: where it stops.
const walk = (i, step, go) => (go(i) ? walk(i + step, step, go) : i);

// Every character position in reading order, with the line break as a blank.
function flat(lines) {
  return lines.flatMap((l, y) => [...l.split("").map((ch, x) => ({ x, y, ch })), { x: l.length, y, ch: undefined, eol: true }]);
}
function indexOf(f, at) { return f.findIndex((p) => p.x === at.x && p.y === at.y && !p.eol); }

// vim's w, b and e on small words, across lines.
function word(lines, at, m) {
  const f = flat(lines);
  const from = indexOf(f, at);
  if (from < 0) return at;
  const k = (j) => kind(f[j]?.ch);
  // w: past the word under the cursor, then past the blanks after it.
  const w = (c = k(from)) => walk(c ? walk(from, 1, (i) => i < f.length && k(i) === c) : from, 1, (i) => i < f.length && k(i) === 0);
  // e: one on, past the blanks, then to the last letter of that word.
  const e = (start = walk(from + 1, 1, (i) => i < f.length && k(i) === 0), c = k(start)) => walk(start, 1, (i) => i + 1 < f.length && k(i + 1) === c && c);
  // b: one back, back over the blanks, then to the first letter of that word.
  const b = (start = walk(from - 1, -1, (i) => i > 0 && k(i) === 0), c = k(start)) => walk(start, -1, (i) => i > 0 && k(i - 1) === c && c);
  const i = m === "w" ? w() : m === "e" ? e() : m === "b" ? b() : from;
  const p = f[clamp(i, 0, f.length - 1)];
  if (!p || p.eol) return at;
  return { x: p.x, y: p.y };
}

// The cursor after a motion. `motion`: "h", "5l", "w", "fa", "$", "gg"...
// Inside the world always; a motion that can't move leaves it where it is.
export function move(world, at, motion) {
  const m = String(motion);
  const count = /^[1-9]\d*/.exec(m); // 0 alone is the line start, not a count
  const n = count ? Number(count[0]) : 1;
  const k = count ? m.slice(count[0].length) : m;
  if (world.kind === "grid") {
    const { w, h } = world;
    const to = { h: [at.x - n, at.y], l: [at.x + n, at.y], k: [at.x, at.y - n], j: [at.x, at.y + n], 0: [0, at.y], $: [w - 1, at.y], gg: [at.x, 0], G: [at.x, h - 1] }[k];
    return to ? { x: clamp(to[0], 0, w - 1), y: clamp(to[1], 0, h - 1) } : at;
  }
  const L = world.lines, line = L[at.y] ?? "";
  const col = (y, x) => ({ x: clamp(x, 0, lastCol(L[y])), y });
  switch (k[0]) {
    case "h": return col(at.y, at.x - n);
    case "l": return col(at.y, at.x + n);
    case "j": { const y = clamp(at.y + n, 0, L.length - 1); return col(y, at.x); }
    case "k": { const y = clamp(at.y - n, 0, L.length - 1); return col(y, at.x); }
    case "0": return { x: 0, y: at.y };
    case "^": return { x: firstNonBlank(line), y: at.y };
    case "$": return { x: lastCol(line), y: at.y };
    case "w": case "b": case "e": return range(n).reduce((p) => word(L, p, k), at);
    case "f": case "t": { const c = k[1]; const i = line.indexOf(c, at.x + 1 + (k[0] === "t" ? 1 : 0)); return i < 0 ? at : { x: k[0] === "t" ? i - 1 : i, y: at.y }; }
    case "F": case "T": { const c = k[1]; const from = at.x - 1 - (k[0] === "T" ? 1 : 0); const i = from < 0 ? -1 : line.lastIndexOf(c, from); return i < 0 ? at : { x: k[0] === "T" ? i + 1 : i, y: at.y }; }
    default:
      if (k === "gg") return { x: firstNonBlank(L[0]), y: 0 };
      if (k === "G") return { x: firstNonBlank(L[L.length - 1]), y: L.length - 1 };
      return at;
  }
}

// The motions a level allows from `at`, each a word you would type.
export function motionsFrom(world, at, level) {
  const own = level.motions.flatMap((m) => {
    if (m !== "f" && m !== "t" && m !== "F" && m !== "T") return [m];
    const line = world.lines?.[at.y] ?? "";
    return [...new Set(line.replace(/\s/g, ""))].map((c) => `${m}${c}`);
  });
  const counted = level.counts ? ["h", "j", "k", "l"].flatMap((d) => range(8, 2).map((c) => `${c}${d}`)) : [];
  return [...own, ...counted];
}

// The fewest motions from `a` to `b`, and the first of them (the hint).
export function shortest(world, a, b, level) {
  if (same(a, b)) return { dist: 0, first: null };
  const key = (p) => `${p.x},${p.y}`;
  // Wave `d`: every move from the cells the last wave reached first, in
  // order. A cell reached before is not reached again.
  const search = (wave, seen, d) => {
    if (d > 40 || !wave.length) return { dist: Infinity, first: null };
    // The wave's moves, cell by cell, until one lands on `b`.
    const { hit, parts } = wave.reduce((acc, { p, first }) => {
      if (acc.hit) return acc;
      const steps = motionsFrom(world, p, level).map((m) => { const q = move(world, p, m); return { q, kq: key(q), f: first ?? m }; });
      return { hit: steps.find((x) => same(x.q, b) && !seen.has(x.kq)) ?? null, parts: [...acc.parts, steps] };
    }, { hit: null, parts: [] });
    if (hit) return { dist: d, first: hit.f };
    const steps = parts.flat();
    const firstAt = new Map(steps.map((x, i) => [x.kq, i]).toReversed());
    const fresh = steps.filter((x, i) => !seen.has(x.kq) && firstAt.get(x.kq) === i);
    return search(fresh.map((x) => ({ p: x.q, first: x.f })), new Set([...seen, ...fresh.map((x) => x.kq)]), d + 1);
  };
  return search([{ p: a, first: null }], new Set([key(a)]), 1);
}

// A new target for a level, reachable, never on the cursor.
export function newTarget(world, at, level, rand = Math.random) {
  const pick = (n) => Math.floor(rand() * n);
  // A cell of the board, kept to the row or column, pushed to an edge or
  // far enough as the level aims.
  const onGrid = () => {
    const { w, h } = world;
    const x = pick(w), y = pick(h);
    const edge = level.aim === "edges" && rand() < 0.75 ? (rand() < 0.5 ? "x" : "y") : null;
    const t = {
      x: edge === "x" ? (rand() < 0.5 ? 0 : w - 1) : level.aim === "column" ? at.x : x,
      y: edge === "y" ? (rand() < 0.5 ? 0 : h - 1) : level.aim === "row" ? at.y : y,
    };
    return level.aim === "far" && Math.abs(t.x - at.x) < 3 && Math.abs(t.y - at.y) < 3 ? null : t;
  };
  // A letter of the code, never a blank, on a line with something on it.
  const inText = () => {
    const L = world.lines;
    const y = level.aim === "line" ? at.y : pick(L.length);
    const line = L[y];
    if (!line.trim()) return null;
    const starts = () => [...line.matchAll(/\w+|[^\w\s]+/g)].flatMap((m) => [m.index, m.index + m[0].length - 1]);
    const x = level.aim === "words" ? ((s) => s[pick(s.length)])(starts())
      : level.aim === "ends" ? [0, firstNonBlank(line), lastCol(line)][pick(3)]
      : pick(line.length);
    return line[x] === " " ? null : { x, y };
  };
  const attempt = () => {
    const t = world.kind === "grid" ? onGrid() : inText();
    if (!t || same(t, at)) return null;
    const s = shortest(world, at, t, level);
    if (s.dist === Infinity || (world.kind === "text" && level.aim !== "ends" && s.dist < 1)) return null;
    return { target: t, need: s.dist };
  };
  // Up to 300 tries; none that fits leaves the target on the cursor.
  return range(300).reduce((got) => got ?? attempt(), null) ?? { target: at, need: 0 };
}

// Points for reaching a target in `moves` when `need` would do: 10, 5 more
// in the fewest, and 2 for each target of the streak before it.
export const points = (moves, need, streak) => 10 + (moves <= need ? 5 + 2 * streak : 0);

// Shared by the panels of the kanso-panel mod: where the focused pane is,
// diff rows, files shown, folders from home, work in parallel, the panel stack.
import { div } from "gpui-kit";
import { EditorState, TextView } from "gpui-base";
import { spaces, panes, focused, layout, theme, settings, home } from "herdr";
import { walkLayout, commitLayout } from "./layout.js";

// A folder from home: "~", "~/Apps/web", or as it is elsewhere.
export function tilde(path) {
  if (!path) return "";
  const h = home();
  return path === h ? "~" : path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path;
}

// Pairs and answers are gathered in runs of this many, so a long list is not
// copied once per item.
const RUN = 64;

// Runs `work` on every item, `n` at a time: the answers, in the items' order.
// The lanes share one iterator over the items, so each takes the next one
// left as soon as it is free; a lane keeps the [index, answer] pairs it got
// in runs of RUN.
export async function pool(items, n, work) {
  const queue = items.entries();
  const lane = async (runs, got) => {
    const next = queue.next();
    if (next.done) return got.length ? [...runs, got] : runs;
    const [i, item] = next.value;
    const pair = [i, await work(item, i)];
    return got.length + 1 >= RUN
      ? lane([...runs, [...got, pair]], [])
      : lane(runs, [...got, pair]);
  };
  const lanes = await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => lane([], [])));
  return lanes.flat(2).toSorted((a, b) => a[0] - b[0]).map(([, answer]) => answer);
}

// `list` mapped in order with a running state: step(state, item, i) answers
// [state, value]. A reduce that keeps every value; the values are gathered in
// runs of 64, so a long list is not copied once per item.
export function mapWith(list, step, init) {
  const done = Array.from({ length: Math.ceil(list.length / RUN) }, (_, r) => r).reduce((acc, r) => {
    const run = list.slice(r * RUN, (r + 1) * RUN).reduce((inner, item, k) => {
      const [state, value] = step(inner.state, item, r * RUN + k);
      return { state, values: [...inner.values, value] };
    }, { state: acc.state, values: [] });
    return { state: run.state, runs: [...acc.runs, run.values] };
  }, { state: init, runs: [] });
  return done.runs.flat();
}

// The terminal's font, for diffs and code.
export const monoFont = () => settings().font_family ?? "JetBrains Mono";

// A relative path that stays inside its root: no absolute path, no ".." segment.
export function insideRoot(path) {
  if (!path || typeof path !== "string" || path.includes("\0")) return false;
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) return false;
  return path.split(/[\\/]/).every((part) => part !== "..");
}

// Where the focused pane is: its folder, the machine it is on (null: this
// computer) and its space.
export function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
// The context a read belongs to: the folder and the machine (not the space).
export const key = () => { const { cwd, on } = location(); return JSON.stringify({ cwd, on }); };

// Numbers each diff line once, so a frame only draws the rows on screen.
// `max` lines at most, each cut at `width` characters (both optional).
// The state carried down the lines is { old, next }: the line numbers the
// next removed and added (or kept) lines have, set by each hunk header.
export function diffRows(lines, { max, width } = {}) {
  return mapWith(max ? lines.slice(0, max) : lines, (at, line) => {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) return [{ old: +m[1], next: +m[2] }, { kind: "@", text: line }];
    const kind = line[0], body = line.slice(1) || " ", text = width ? body.slice(0, width) : body;
    if (kind === "-") return [{ old: at.old + 1, next: at.next }, { kind, number: at.old, text }];
    if (kind === "+") return [{ old: at.old, next: at.next + 1 }, { kind, number: at.next, text }];
    if (kind === " ") return [{ old: at.old + 1, next: at.next + 1 }, { kind, number: at.next, text }];
    return [at, { kind: "", text: line }];
  }, { old: 0, next: 0 });
}

// ---- Showing a file --------------------------------------------------------------

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const MAX_TEXT = 400000;
export const ext = (path) => (path.includes(".") ? path.split(".").at(-1).toLowerCase() : "");
export const isMarkdown = (path) => ["md", "markdown", "mdx"].includes(ext(path));

// A read-only editor state for a code or text file, in the terminal's font,
// highlighted in the theme's ANSI hues. Release it when done.
export function codeState(path, text) {
  const t = theme(), e = ext(path) || "txt";
  return EditorState.new({ language: LANG[e] ?? e, readonly: true,
    value: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "\n… (file truncated)" : text,
    font_family: monoFont(), font_size: 12,
    syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
}

// Markdown as the SDK renders it (`TextView.markdown`), selectable, in a
// scrolling column with the panel's margins.
export function markdownView(id, text, t) {
  return div().id(`${id}-scroll`).flex_1().min_h(0).overflow_y_scrollbar()
    .child(div().px(16).py(12).text_size(13).text_color(t.foreground)
      .child(TextView.markdown(id, text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "\n\n… (file truncated)" : text).selectable(true)));
}

// ---- The panel stack --------------------------------------------------------------

// Puts one block in the side panel (as kanso-tabs' panel buttons do) or,
// with no id, empties it: Herdr then ends the panel's mod.
export function showPanel(id, content) {
  if (!walkLayout(layout(), "panel-body")) return false;
  return commitLayout({ panel: id ? { id, type: "block", content } : null });
}

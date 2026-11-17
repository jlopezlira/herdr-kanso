import { collect } from "./blocks.js";
import { paths } from "./platform-paths.js";
import { div } from "gpui-kit";
import { EditorState, TextView } from "gpui-base";
import { spaces, panes, focused, layout, theme, home } from "herdr";
import { walkLayout, commitLayout } from "./layout.js";
import { monoFont } from "./ui.js";

export function tilde(path) {
  if (!path) return "";
  const h = home();
  return paths.shorten(path, h);
}

// Pairs are gathered in runs of 64 so a long list is not copied once per item.
const RUN = 64;

// Runs `work` on every item, `n` at a time; the answers come back in the items' order.
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

// step(state, item, i) answers [state, value]; the values are gathered in runs of RUN.
export function mapWith(list, step, init) {
  return collect(list.length, (state, index) => {
    const [next, value] = step(state, list[index], index);
    return { state: next, emit: value };
  }, init, () => true);
}

export function insideRoot(path) {
  if (!path || typeof path !== "string" || path.includes("\0")) return false;
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) return false;
  return path.split(/[\\/]/).every((part) => part !== "..");
}

export function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
// A read's context is the folder and the machine, not the space.
export const key = () => { const { cwd, on } = location(); return JSON.stringify({ cwd, on }); };

// Each line is numbered once, so a frame only draws the rows on screen.
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

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const MAX_TEXT = 400000;
export const ext = (path) => (path.includes(".") ? path.split(".").at(-1).toLowerCase() : "");
export const isMarkdown = (path) => ["md", "markdown", "mdx"].includes(ext(path));

// Release the returned state when done.
export function codeState(path, text, options = {}) {
  const t = theme(), e = ext(path) || "txt";
  const limit = options.limit ?? MAX_TEXT;
  const big = text.length > limit;
  const readonly = options.readonly !== false || big;
  const state = EditorState.new({ language: LANG[e] ?? e, readonly,
    value: big ? text.slice(0, limit) + "\n… (file truncated)" : text,
    line_numbers: options.line_numbers !== false, folding: options.folding !== false,
    font_family: monoFont(), font_size: 12,
    syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
  if (options.onChange && !readonly) state.on("change", (_e, cx) => options.onChange(state.value(), cx));
  return state;
}

export function markdownView(id, text, t) {
  return div().id(`${id}-scroll`).flex_1().min_h(0).overflow_y_scrollbar()
    .child(div().flex_none().w_full().px(16).py(12).text_size(13).text_color(t.foreground)
      .child(TextView.markdown(id, text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "\n\n… (file truncated)" : text).selectable(true)));
}

// With no id the panel is emptied, and Herdr then ends the panel's mod.
export function showPanel(id, content) {
  if (!walkLayout(layout(), "panel-body")) return false;
  return commitLayout({ panel: id ? { id, type: "block", content } : null });
}

// A failure's props for the kit's failureBlock: our words, and the tool's words when there are any.
export const said = (text, source = null) => ({ text, source: source === null || source === undefined ? "" : String(source) });

// platform-database.js keeps its own sqliteOk: it is copied into mods without lib.js.
export const commandOk = (result, fallback = null) => {
  if (result.code !== 0) throw new Error((result.stderr || fallback || result.stdout).trim().split("\n")[0]);
  return result;
};

export const statePath = (state) => typeof state?.path === "string" ? state.path : "";
export const nearestRemaining = (previous, at, still) => previous.slice(at + 1).find(still)
  ?? previous.slice(0, Math.max(at, 0)).toReversed().find(still) ?? null;

export async function restorePath(state, restore) {
  const path = statePath(state);
  return path ? restore.call(this, path, state) : false;
}

export const spawnAndNotify = (cx, work) => { cx.spawn(work); cx.notify(); };

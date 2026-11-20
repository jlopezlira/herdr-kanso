import { paths } from "./platform-paths.js";
import { spaces, panes, focused, layout, home } from "herdr";
import { walkLayout, commitLayout } from "./layout.js";

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

export const ext = (path) => (path.includes(".") ? path.split(".").at(-1).toLowerCase() : "");
export const isMarkdown = (path) => ["md", "markdown", "mdx"].includes(ext(path));

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

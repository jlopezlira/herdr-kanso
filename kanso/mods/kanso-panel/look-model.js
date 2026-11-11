import { paths } from "./platform-paths.js";
// Images' reading of a terminal: the pictures an agent printed, and what you tell it about one.
import { KINDS, kindOf } from "./kinds.js";

const EXT = [...new Set(Object.values(KINDS).flat())].toSorted((a, b) => b.length - a.length).join("|");
// A path as agents print it: bare, quoted, in backticks, brackets or parentheses, after "file://".
const PATH = new RegExp(`(?<=^|[\\s"'\`(\\[<=:])(?:file://)?([\\w@+.~/-]*\\.(?:${EXT}))(?=$|[\\s"'\`)\\]>,;:!?]|\\.(?:\\s|$))`, "gim");
// One with spaces, whole between matching quotes or backticks: "/tmp/home page.png".
const QUOTED = new RegExp(`(["'\`])(?:file://)?([^\\s"'\`][^"'\`\\n]* [^"'\`\\n]*\\.(?:${EXT}))\\1`, "gim");
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// Links open in the browser: a URL's path is never one of these.
const LINK = /\b(?!file:)[a-z][\w+.-]*:\/\/\S*/gi;
// Every kind Images lists is one it draws.
const SHOWN = Object.keys(KINDS);

// The paths in a terminal's text, newest (lowest) first, each once. A quoted one with a folder in it is
// one path, not the bare name after its last space; without a folder ("'see shot.png'") it may be a
// sentence, so the bare name stays too, and only the files that exist are kept.
export function mentions(text, max = 40) {
  const clean = String(text ?? "").replace(ANSI, "").replace(LINK, " ");
  const quoted = [...clean.matchAll(QUOTED)].map((m) => ({ path: m[2], from: m.index, end: m.index + m[0].length }));
  const whole = quoted.filter((q) => /[\\/]/.test(q.path));
  const windows = [...clean.matchAll(new RegExp(`(?:[A-Za-z]:[\\\\/]|\\\\\\\\)[^\\s"\'\x60<>|]*?\\.(?:${EXT})(?=$|[\\s"\'\x60),;]|\\.(?:\\s|$))`, "gim"))].filter((m) => !whole.some((q) => m.index > q.from && m.index < q.end)).map((m) => ({ path: m[0], from: m.index, end: m.index + m[0].length }));
  const bare = [...clean.matchAll(PATH)].filter((m) => ![...whole, ...windows].some((q) => m.index >= q.from && m.index < q.end))
    .map((m) => ({ path: m[1], end: m.index + m[0].length }));
  // By where each ends, so a quoted path counts after the bare name inside it.
  const found = [...bare, ...windows, ...quoted].toSorted((a, b) => a.end - b.end).map((x) => x.path);
  return [...new Set(found.toReversed())].slice(0, max);
}

// Absolute and tidied: "~/" from home, a relative one from the terminal's folder; null without one.
export function resolvePath(raw, cwd, homeDir) {
  const p = String(raw ?? "");
  if (p.startsWith("~") && !/^~[\\/]/.test(p)) return null;
  const abs = /^~[\\/]/.test(p) ? paths.join(homeDir, p.slice(2)) : paths.isAbsolute(p) ? p : cwd ? paths.join(cwd, p) : null;
  return abs ? paths.normalize(abs) : null;
}

export const itemOf = (path) => ({ path, name: paths.basename(path), kind: kindOf(path) });

export const shows = (item) => SHOWN.includes(item?.kind);

// The newest one Images shows that the last read did not have.
export function arrived(found, before) {
  const old = new Set((before ?? []).map((i) => i.path));
  return found.find((i) => shows(i) && !old.has(i.path)) ?? null;
}

// A click on the picture, as fractions of its width and height from the top left.
export function pinFrom(local, bounds) {
  if (!local || !bounds?.width || !bounds?.height) return null;
  const part = (n) => Math.min(1, Math.max(0, n));
  return { x: part(local.x / bounds.width), y: part(local.y / bounds.height) };
}

const pct = (n) => `${Math.round(n * 100)}%`;

// The pins with a note, numbered as drawn (a pin without one is skipped, its number kept).
export const noted = (pins) => pins.map((p, i) => ({ ...p, n: i + 1 })).filter((p) => String(p.note ?? "").trim());

// "About <path>:" and one line per noted pin, where it sits on the picture you saw (`picture`: its file) and what
// you said there.
export function aboutMessage(item, pins, picture = item.path) {
  const lines = noted(pins).map((p) => `${p.n} (${pct(p.x)} across, ${pct(p.y)} down): ${String(p.note).trim()}`);
  const where = picture === item.path ? "" : ` (the pins are on ${picture})`;
  return `About ${item.path}${where}:\n${lines.join("\n")}`;
}

// One name per file in Images' copies, so a fresh copy replaces the last one.
export const keyOf = (path) => (([...String(path)].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7)) >>> 0).toString(36);

export const colorOf = (text) => {
  const m = /#([0-9a-fA-F]{6})\b/.exec(String(text ?? ""));
  return m ? `#${m[1].toLowerCase()}` : null;
};

// Oldest first. A full read numbers from the start; a path no longer found is dropped.
export function indexRows(prior, found, { replaced = false } = {}) {
  const old = new Map((prior ?? []).map((r) => [r.path, r]));
  const paths = [...new Set((found ?? []).filter(Boolean))];
  const color = (path) => old.get(path)?.color ?? null;
  if (replaced || !(prior ?? []).length) return paths.map((path, i) => ({ path, ord: i + 1, color: color(path) }));
  const start = (prior ?? []).reduce((m, r) => Math.max(m, Number(r.ord) || 0), 0);
  const have = new Set(paths);
  const kept = (prior ?? []).filter((r) => have.has(r.path)).map((r) => ({ path: r.path, ord: Number(r.ord) || 0, color: r.color ?? null }));
  const known = new Set(kept.map((r) => r.path));
  return [...kept, ...paths.filter((p) => !known.has(p)).map((path, i) => ({ path, ord: start + i + 1, color: color(path) }))];
}

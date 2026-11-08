// Look's reading of a terminal: the files an agent printed, and what you tell it about one.
import { KINDS, kindOf } from "./kinds.js";

const EXT = [...new Set(Object.values(KINDS).flat())].toSorted((a, b) => b.length - a.length).join("|");
// A path as agents print it: bare, quoted, in backticks, brackets or parentheses, after "file://".
const PATH = new RegExp(`(?<=^|[\\s"'\`(\\[<=:])(?:file://)?([\\w@+.~/-]*\\.(?:${EXT}))(?=$|[\\s"'\`)\\]>,;:!?]|\\.(?:\\s|$))`, "gim");
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// Links open in the browser: a URL's path is never one of these.
const LINK = /\b(?!file:)[a-z][\w+.-]*:\/\/\S*/gi;
// Look shows these itself; the rest it opens elsewhere.
const SHOWN = ["image", "convert", "pdf"];

// The paths in a terminal's text, newest (lowest) first, each once.
export function mentions(text, max = 40) {
  const found = [...String(text ?? "").replace(ANSI, "").replace(LINK, " ").matchAll(PATH)].map((m) => m[1]);
  return [...new Set(found.toReversed())].slice(0, max);
}

// Absolute and tidied: "~/" from home, a relative one from the terminal's folder; null without one.
export function resolvePath(raw, cwd, homeDir) {
  const p = String(raw ?? "");
  if (p.startsWith("~") && !p.startsWith("~/")) return null; // another user's home
  const abs = p.startsWith("~/") ? `${homeDir}${p.slice(1)}` : p.startsWith("/") ? p : cwd ? `${cwd}/${p}` : null;
  if (!abs) return null;
  const parts = abs.split("/").reduce((acc, part) => (part === "" || part === "." ? acc : part === ".." ? acc.slice(0, -1) : [...acc, part]), []);
  return `/${parts.join("/")}`;
}

export const itemOf = (path) => ({ path, name: path.split("/").at(-1), kind: kindOf(path) });

export const shows = (item) => SHOWN.includes(item?.kind);

// The newest one Look shows that the last read did not have.
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

// "About <path>: <text>", and where each pin sits on the picture you saw (`picture`: its file).
export function aboutMessage(item, text, pins = [], picture = item.path) {
  const head = `About ${item.path}: ${String(text).trim()}`;
  if (!pins.length) return head;
  const at = pins.map((p, i) => `${i + 1} at ${pct(p.x)} across, ${pct(p.y)} down`).join("; ");
  return `${head}\nPins on ${picture}, from its top left corner: ${at}.`;
}

// One name per file in Look's copies, so a fresh copy replaces the last one.
export const keyOf = (path) => (([...String(path)].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7)) >>> 0).toString(36);

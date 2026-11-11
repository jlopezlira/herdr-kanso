// What the status bar says, and where a click goes. No host calls.
import { parseOr } from "./pure.js";

export const QUESTION_W = 260;
export const MEMORY_MS = 60_000;
// A now.json older than three minutes is not a current fact (the guard's own rule).
export const MEMORY_STALE_MS = 3 * 60_000;
export const NEEDS_COMMAND = "kanso-spaces.needs-you.next";
export const MEMORY_COMMAND = "kanso-tabs.memory";

const firstLine = (text) => {
  const line = String(text ?? "").split(/\r?\n/).find((part) => part.trim()) ?? "";
  const flat = line.replace(/\s+/g, " ").trim();
  return flat || null;
};

const clean = (text) => (text ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const sameName = (a, b) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function questionOf({ msg, title, name, program } = {}) {
  const said = firstLine(msg);
  if (said) return said;
  if (!name) return null;
  const live = clean(title), raw = String(title ?? "").trim();
  const telling = live && !/^[~/]|^[A-Za-z]:\\/.test(raw) && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@")
    && live.toLowerCase() !== program?.key && live !== program?.name;
  return telling && !sameName(live, name) ? live : null;
}

const waiting = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => row?.status === "blocked" && row.address && row.pane);

const tipLine = (row, question) => [row.name || "Agent", row.project, question].filter(Boolean).join(" · ");

export function needsItem(rows, questions = {}) {
  const list = waiting(rows);
  if (!list.length) return null;
  const ask = (row) => questions[row.address] || null;
  const more = list.length - 1;
  return {
    name: list[0].name || "Agent",
    question: ask(list[0]),
    more: more > 0 ? `+${more}` : null,
    mark: "blocked",
    nameTone: "foreground",
    questionTone: "muted",
    moreTone: "dim",
    questionWidth: QUESTION_W,
    command: NEEDS_COMMAND,
    tooltip: list.map((row) => tipLine(row, ask(row))).join("\n"),
  };
}

export function computerOf(space, layouts) {
  const remote = space?.machine ? String(space.machine) : "";
  const name = remote || "This computer";
  const icon = remote ? "server" : "monitor";
  const layout = remote ? (layouts ?? []).find((row) => row?.name === remote)?.layout : null;
  if (remote && layout === "unavailable") {
    const words = `${name} · unreachable`;
    return { icon, words, tone: "blocked", command: `kanso-spaces.retry-machine:${name}`, tooltip: words };
  }
  return { icon, words: name, tone: "muted", command: null, tooltip: null };
}

export function memoryLow(text, now = Date.now()) {
  const raw = typeof text === "string" ? parseOr(text, null) : text;
  if (!raw || raw.v !== 1 || typeof raw.at !== "number" || now - raw.at > MEMORY_STALE_MS) return null;
  const free = raw.machine?.freePct, floor = raw.limits?.lowFreePct;
  if (typeof free !== "number" || !Number.isFinite(free)) return null;
  if (typeof floor !== "number" || !Number.isFinite(floor) || !(free < floor)) return null;
  const words = `Memory ${Math.round(free)}% free`;
  return { words, tone: "blocked", command: MEMORY_COMMAND, tooltip: words };
}


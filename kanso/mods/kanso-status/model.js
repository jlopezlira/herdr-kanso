// What the status bar says, and where a click goes. No host calls.
import { machineTitle, parseOr, oneLine, memoryFree, plural, tellsSomething } from "./pure.js";

export const MEMORY_MS = 60_000;
// A now.json older than three minutes is not a current fact (the guard's own rule).
export const MEMORY_STALE_MS = 3 * 60_000;
export const NEEDS_COMMAND = "kanso-spaces.needs-you.next";
export const MEMORY_COMMAND = "kanso-tabs.memory";
export const STATUS_COMMAND = "kanso-spaces.view-agents";
export const PALETTE_COMMAND = "app.palette";

const clean = (text) => (text ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const sameName = (a, b) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function questionOf({ msg, title, name, program } = {}) {
  const said = oneLine(msg);
  if (said) return said;
  if (!name) return null;
  const live = clean(title), raw = String(title ?? "").trim();
  return tellsSomething(live, raw, program) && !sameName(live, name) ? live : null;
}

const waiting = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => row?.status === "blocked" && row.address && row.pane);

const tipLine = (row, question) => [row.name || "Agent", row.project, question].filter(Boolean).join(" · ");

export function waitingItem(rows, questions = {}) {
  const list = waiting(rows);
  if (!list.length) return null;
  const ask = (row) => questions[row.address] || null;
  return {
    name: list[0].name || "Agent",
    question: ask(list[0]),
    more: list.length - 1,
    command: NEEDS_COMMAND,
    tooltip: list.map((row) => tipLine(row, ask(row))).join("\n"),
  };
}

export function computerOf(space, layouts, alias = "") {
  const remote = space?.machine ? String(space.machine) : "";
  const name = machineTitle(remote, "", alias);
  const icon = remote ? "server" : "monitor";
  const layout = remote ? (layouts ?? []).find((row) => row?.name === remote)?.layout : null;
  // A failure on the bar's line: the mark, our words, Refresh.
  if (remote && layout === "unavailable") {
    const words = `Can't reach ${name}`;
    return { icon, words, command: `kanso-spaces.retry-machine:${remote}`, tooltip: words, fix: "Refresh", pending: false };
  }
  return { icon, words: name, command: null, tooltip: null, pending: layout === "loading" };
}

// A stand-in for the sidebar's computer row: only while that row is out of sight, or the computer can't be reached.
export const computerShown = (computer, collapsed) => Boolean(computer) && (collapsed === true || Boolean(computer.fix));

export function workingItem(agents) {
  const count = (Array.isArray(agents) ? agents : []).filter((agent) => agent?.status === "working").length;
  return { count, mark: count > 0 ? "working" : "idle", words: String(count), command: STATUS_COMMAND, tooltip: `${plural(count, "agent", "agents")} working` };
}

export const paletteTip = (platform) => `Command palette ${platform === "macos" ? "⌘⇧P" : "Ctrl+Shift+P"}`;

export function memoryLow(text, now = Date.now()) {
  const raw = typeof text === "string" ? parseOr(text, null) : text;
  if (!raw || raw.v !== 1 || typeof raw.at !== "number" || now - raw.at > MEMORY_STALE_MS) return null;
  const free = raw.machine?.freePct, floor = raw.limits?.lowFreePct;
  if (typeof free !== "number" || !Number.isFinite(free)) return null;
  if (typeof floor !== "number" || !Number.isFinite(floor) || !(free < floor)) return null;
  const words = memoryFree(free);
  return { words, tone: "blocked", command: MEMORY_COMMAND, tooltip: words };
}


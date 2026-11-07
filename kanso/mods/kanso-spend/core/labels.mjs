// Label rules match pi-usage (scan.ts) so a Pi session reads the same in both places.
// Only the first prompt's first line (120 chars) and ticket refs are kept, never the transcript.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import * as zlib from "node:zlib";
import { mapSeries, parseOr, tryOrAsync } from "../pure.js";
import { atomicWriteJson, isPlainObject } from "./util.mjs";

export const LABELS_VERSION = 2;
const USER_SCAN = 4;
const MAX_LINES = 4000;
const MAX_BYTES = 8 * 1024 * 1024;
const RELABEL_MS = 10 * 60 * 1000;

// Tickets ported from pi-usage scan.ts.

const JIRA = /(?<![\w-])([A-Z]{2}[A-Z0-9_]{0,8}-\d{1,6})(?![\w-])/g;
const NOT_TICKETS = new Set(["UTF", "ISO", "SHA", "GPT", "RFC", "ES", "MD", "AES", "RSA", "HTTP", "TLS", "SSL", "IPV", "CVE", "WCAG", "ECMA", "PEP", "COVID", "MP", "H", "TS", "X", "K", "V", "BASE", "ARM", "TOP", "GPU", "CPU", "P", "M", "IP", "UUID", "LTS", "NODE", "ED", "HMAC", "PBKDF"]);
const LINKS = [
  { pattern: /https?:\/\/[\w.-]+\.atlassian\.net\/browse\/([A-Z][A-Z0-9]+-\d+)/g, ref: (m) => m[1] },
  { pattern: /https?:\/\/[\w.-]+\.atlassian\.net\/wiki\/\S*?\/pages\/(\d+)/g, ref: (m) => `confluence:${m[1]}` },
  { pattern: /https?:\/\/linear\.app\/[\w-]+\/issue\/([A-Z][A-Z0-9]+-\d+)/g, ref: (m) => m[1] },
  { pattern: /https?:\/\/app\.clickup\.com\/t\/(?:\d+\/)?([\w-]+)/g, ref: (m) => `clickup:${m[1]}` },
  { pattern: /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)/g, ref: (m) => `${m[1]}#${m[2]}` },
  { pattern: /https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/([\w-]{8})[\w-]*/g, ref: (m) => `gdoc:${m[1]}` },
  { pattern: /https?:\/\/(?:www\.)?notion\.(?:so|site)\/(?:[\w-]+\/)?([\w-]*?)-?([0-9a-f]{32})/g, ref: (m) => `notion:${m[1] || m[2].slice(0, 8)}` },
];

export function ticketsIn(text) {
  const links = LINKS.flatMap(({ pattern, ref }) => [...text.matchAll(pattern)].map((match) => ref(match)));
  const keys = [...text.matchAll(JIRA)].map((match) => match[1]).filter((key) => !NOT_TICKETS.has(key.slice(0, key.indexOf("-"))));
  return [...new Set([...links, ...keys])];
}

function snippet(text) {
  const line = String(text).split("\n").map((part) => part.trim()).find(Boolean);
  return line ? (line.length > 120 ? `${line.slice(0, 119)}…` : line) : undefined;
}

const textOf = (content) => (typeof content === "string" ? content
  : Array.isArray(content) ? content.map((part) => (part && typeof part === "object" && typeof part.text === "string"
    && (part.type === "text" || part.type === "input_text" || part.type === undefined) ? part.text : "")).join("\n")
    : "");

/** Harness boilerplate injected as a user turn is not the user's prompt. */
function cleanPrompt(text) {
  const whole = String(text ?? "");
  const request = whole.indexOf("## My request for Codex:");
  const asked = request >= 0 ? whole.slice(request + "## My request for Codex:".length) : whole;
  const trimmed = asked.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (!trimmed) return "";
  if (/^<[a-z_-]+[\s>]/i.test(trimmed)) return "";
  if (/^(# AGENTS\.md|# Files mentioned by the user|Caveat:)/.test(trimmed)) return "";
  return trimmed;
}

function userTexts(adapter, entry) {
  if (!isPlainObject(entry)) return { texts: [] };
  if (adapter === "claude") {
    if (entry.type !== "user" || entry.isMeta || entry.isSidechain) return { texts: [] };
    return { texts: [textOf(entry.message?.content)] };
  }
  if (adapter === "codex") {
    const payload = entry.payload;
    if (entry.type === "response_item" && payload?.type === "message" && payload.role === "user") {
      return { texts: (payload.content ?? []).map((part) => (typeof part?.text === "string" ? part.text : "")) };
    }
    return { texts: [] };
  }
  if (adapter === "pi") {
    if (entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim()) return { texts: [], name: entry.name.trim() };
    if (entry.type === "message" && entry.message?.role === "user") return { texts: [textOf(entry.message.content)] };
  }
  return { texts: [] };
}

async function foldUntil(iterator, step, acc) {
  const { value, done } = await iterator.next();
  if (done) return acc;
  const next = step(acc, value);
  return next.stop ? next.acc : foldUntil(iterator, step, next.acc);
}

function readLine(adapter, seen, line) {
  const counted = { ...seen, lines: seen.lines + 1, bytes: seen.bytes + line.length };
  if (counted.lines > MAX_LINES || counted.bytes > MAX_BYTES) return { stop: true, acc: counted };
  // Cheap prefilter: skip lines that cannot hold a user turn or a name.
  if (!line.includes('"user"') && !line.includes("session_info")) return { acc: counted };
  const found = userTexts(adapter, parseOr(line, null));
  const named = found.name ? { ...counted, name: found.name } : counted;
  const next = found.texts.map(cleanPrompt).filter(Boolean).reduce((acc, text) => ({
    ...acc,
    users: acc.users + 1,
    // "." or "ok" says nothing about the task; wait for a real prompt.
    prompt: !acc.prompt && (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 8 ? snippet(text) : acc.prompt,
    tickets: [...acc.tickets, ...ticketsIn(text).filter((ticket) => !acc.tickets.includes(ticket))],
  }), named);
  // Pi can rename a session later; keep reading Pi heads to the line cap.
  return { stop: next.users >= USER_SCAN && adapter !== "pi", acc: next };
}

export async function readLabel(adapter, filePath) {
  const empty = { prompt: undefined, name: undefined, tickets: [] };
  const source = createReadStream(filePath);
  const zst = filePath.endsWith(".zst");
  if (zst && typeof zlib.createZstdDecompress !== "function") return empty;
  const stream = zst ? source.pipe(zlib.createZstdDecompress()) : source;
  if (zst) stream.on("error", () => {});
  source.on("error", () => {});
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    const { prompt, name, tickets } = await foldUntil(reader[Symbol.asyncIterator](), (seen, line) => readLine(adapter, seen, line), { ...empty, users: 0, lines: 0, bytes: 0 });
    return { prompt, name, tickets };
  } finally {
    reader.close();
    source.destroy();
    if (stream !== source) stream.destroy();
  }
}

export function labelText(label, sessionId) {
  return label?.name || label?.tickets?.[0] || label?.prompt || `Session ${String(sessionId).split(":").at(-1).slice(0, 8)}`;
}

export function labelsPath(storePath) {
  return path.join(path.dirname(storePath), "labels.json");
}

export async function loadLabels(storePath) {
  try {
    const parsed = JSON.parse(await readFile(labelsPath(storePath), "utf8"));
    if (parsed?.version === LABELS_VERSION && isPlainObject(parsed.sessions)) return parsed;
  } catch { /* first run */ }
  return { version: LABELS_VERSION, sessions: {} };
}

/** pi-usage keeps names, prompts and tickets for every Pi session it saw. */
async function piUsageLabels(home) {
  // Nothing when pi-usage is not installed.
  return tryOrAsync(async () => {
    const parsed = JSON.parse(await readFile(path.join(home, ".prjct/pi-usage/scan.json"), "utf8"));
    return new Map(Object.values(parsed?.files ?? {}).filter((file) => file?.id)
      .map((file) => [`pi:${file.id}`, { name: file.name, prompt: file.prompt, tickets: Array.isArray(file.tickets) ? file.tickets : [] }]));
  }, new Map());
}

/** Refreshes the label cache; a label is re-read when its transcript grew, because a /name or ticket can arrive later. */
export async function updateLabels(store, storePath, { home = os.homedir(), deadline = Infinity } = {}) {
  const cache = await loadLabels(storePath);
  const now = Date.now();
  const rows = Object.values(store.files ?? {}).flatMap((file) => (file.rows ?? [])
    .filter((row) => typeof row.session === "string").map((row) => ({ session: row.session, file })));
  const sessions = [...Map.groupBy(rows, (row) => row.session)].map(([session, [{ file }]]) => [session, file]);
  // A live session grows every turn but its label rarely changes: re-read a known one at most every few minutes.
  const stale = sessions.filter(([session, file]) => {
    const cached = cache.sessions[session];
    return !(cached && cached.size === file.size) && !(cached && now - (cached.readAt ?? 0) < RELABEL_MS);
  });
  const fromPiUsage = stale.length ? await piUsageLabels(home) : null;
  const answers = await mapSeries(stale, async ([session, file]) => {
    const cached = cache.sessions[session];
    const known = fromPiUsage.get(session);
    if (known && (known.name || known.prompt || known.tickets.length)) return [session, { ...known, size: file.size, readAt: now }];
    if (Date.now() >= deadline) return "pending";
    // Only Pi files are re-read once labelled: their /name can change later; other labels do not.
    if (cached && file.adapter !== "pi" && (cached.prompt || cached.tickets?.length)) return [session, { ...cached, size: file.size, readAt: now }];
    try {
      const fileStat = await stat(file.path);
      const label = await readLabel(file.adapter, file.path);
      return [session, { ...label, size: file.size ?? fileStat.size, readAt: now }];
    } catch {
      return [session, { tickets: [], size: file.size, readAt: now }];
    }
  });
  const fresh = answers.filter((answer) => answer !== "pending");
  const pending = answers.length - fresh.length;
  if (!fresh.length) return { labels: cache, pending };
  const labels = { ...cache, sessions: { ...cache.sessions, ...Object.fromEntries(fresh) } };
  await atomicWriteJson(labelsPath(storePath), labels);
  return { labels, pending };
}

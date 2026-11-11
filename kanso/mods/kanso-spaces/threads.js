import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { transcriptApi } from "./platform-transcripts.js";
// Kanso only reads what already lives on this computer, only while the Threads view is open, and never sends the agent anything.
import { home } from "herdr";
import { tryOr } from "./pure.js";

export const claudeFile = (home, cwd, session) => paths.join(home, ".claude", "projects", String(cwd ?? "").replace(/[^A-Za-z0-9]/g, "-"), `${session}.jsonl`);

export function parseLocated(text, home) {
  const [kind, a, b] = (text ?? "").replace(/\n$/, "").split("\t");
  if (kind === "codex" && a) {
    const name = tryOr(() => JSON.parse(b).thread_name?.trim() || null); // null: no name yet
    return { kind, file: a, name };
  }
  if (kind === "claude" && a) {
    try {
      const s = JSON.parse(a);
      if (s.sessionId && s.cwd) return { kind, file: claudeFile(home, s.cwd, s.sessionId), name: null };
    } catch { /* a record being written */ }
  }
  return null;
}

const lines = (text) => (text ?? "").split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// Skips the wrappers agents put around what a person typed: commands, reminders, context, the compaction note.
function typed(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || /^(<|\/|# AGENTS\.md|Caveat:|\[Request interrupted|This session is being continued)/.test(t)) return null;
  return t;
}
function claudePrompt(e) {
  if (e?.type !== "user" || e.isMeta || e.isSidechain) return null;
  const c = e.message?.content;
  if (typeof c === "string") return typed(c);
  if (Array.isArray(c) && !c.some((p) => p?.type === "tool_result")) return typed(c.filter((p) => p?.type === "text").map((p) => p.text).join(" "));
  return null;
}
const codexPrompt = (e) => (e?.type === "event_msg" && e.payload?.type === "user_message" ? typed(e.payload.message) : null);
const ms = (stamp) => { const n = stamp ? Date.parse(stamp) : NaN; return Number.isNaN(n) ? null : n; };

export function readThread(kind, titleLine, head, recent, tail, name = null) {
  const prompt = kind === "codex" ? codexPrompt : claudePrompt;
  const firstPrompt = lines(head).map(prompt).find(Boolean) ?? null;
  // Only what you wrote lately: an agent that has only heard from other agents shows none.
  const last = lines(recent).findLast((e) => prompt(e));
  const title = name ?? (kind === "claude" ? lines(titleLine).find((e) => e?.type === "ai-title" && e.aiTitle)?.aiTitle ?? null : null);
  return {
    title: title ?? firstPrompt,
    prompt: last ? prompt(last) : null,
    said: ms(last?.timestamp),
    began: ms(lines(head).find((e) => e?.timestamp)?.timestamp),
    at: ms(lines(tail).findLast((e) => e?.timestamp)?.timestamp),
  };
}

export class ThreadLocator {
  constructor() { this.missing = new Map(); }

  retain(list) {
    const addresses = new Set(list.map((item) => item.address));
    this.missing = new Map([...this.missing].filter(([address]) => addresses.has(address)));
  }

  async locate({ address, pid, kind, home }, known) {
    if (!pid || known?.pid === pid) { this.missing.delete(address); return pid ? known : null; }
    const previous = this.missing.get(address), now = Date.now();
    if (previous?.pid === pid && now < previous.next) return null;
    const located = await localService(transcriptApi).locate(pid, kind, home);
    if (located.state === "unavailable") return { pid, unavailable: located.reason };
    const where = parseLocated(located.stdout, home);
    if (where) { this.missing.delete(address); return where; }
    const wait = Math.min(previous?.pid === pid ? previous.wait * 2 : 60000, 600000);
    this.missing.set(address, { pid, wait, next: now + wait });
    return null;
  }
}

// `pid` ties the reading to the process it came from, so a program started later in the same terminal is never taken for it.
async function findThread({ address, app }, known, home, got, locator) {
  const pid = got?.foreground?.pid;
  const checked = { at: Date.now(), status: got?.status, turn: got?.turn };
  if (pid && known?.pid === pid && known.checked?.status === checked.status && known.checked?.turn === checked.turn && checked.at - (known.checked?.at ?? -Infinity) < 300000) return known;
  const kind = app === "codex" || /codex/.test(got?.foreground?.argv?.[0] ?? "") ? "codex" : "claude";
  const where = await locator.locate({ address, pid, kind, home }, known);
  if (!where?.file) return where?.unavailable ? where : null;
  const size = await localService(transcriptApi).size(where.file);
  if (!size) return null;
  if (known?.file === where.file && known.size === size && known.name === where.name && known.pid === pid) return { ...known, checked };
  const r = await localService(transcriptApi).thread(where.file);
  if (r.code !== 0 && !r.stdout) return null;
  const [titleLine, head, recent, tail] = r.stdout.split("\n\u001e\n");
  return { kind, file: where.file, name: where.name, size, pid, checked, ...readThread(kind, titleLine, head, recent, tail, where.name) };
}

// Read up to four terminals concurrently.
const AT_ONCE = 4;

export async function findThreads(list, known = {}, terms = [], locator = new ThreadLocator()) {
  locator.retain(list);
  const byAddress = new Map(terms.map((term) => [term.address, term]));
  const here = home();
  const queue = list.values();
  const lane = async (got = []) => {
    const { value: item, done } = queue.next();
    if (done) return got;
    return lane([...got, [item.address, await findThread(item, known[item.address], here, byAddress.get(item.address), locator)]]);
  };
  const found = await Promise.all(Array.from({ length: Math.min(AT_ONCE, list.length) }, lane));
  return Object.fromEntries(found.flat().filter(([, thread]) => thread));
}

// Conversation liveness shares the task process table.
export const ALIVE_MS = 10000;
export const ALIVE_BEHIND_MS = 30000;

// Sorted, so the same processes always give the same signature.
export const pidsOf = (threads) => [...new Set(Object.values(threads ?? {}).map((th) => th?.pid).filter((p) => Number.isInteger(p) && p > 0))]
  .toSorted((a, b) => a - b);

// `listed`: anything with has(pid), that Set or checkTasks' table by pid, so neither is read twice.
export const aliveIn = (listed, pids) => new Set(pids.filter((p) => listed.has(p)));

// `last`: the signature and start of the last look, its own or checkTasks'; none yet is due.
export const aliveDue = (last, sig, now, every) => last?.at == null || last.sig !== sig || now - last.at >= every;

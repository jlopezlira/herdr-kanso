import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { transcriptApi } from "./platform-transcripts.js";
// Kanso only reads what already lives on this computer, only while the Threads view is open, and never sends the agent anything.
import { hc, home } from "herdr";
import { tryOr, tryOrAsync } from "./pure.js";

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

// `pid` ties the reading to the process it came from, so a program started later in the same terminal is never taken for it.
async function findThread({ address, app }, known, home) {
  const got = await tryOrAsync(async () => {
    const r = await hc(["get", address, "--json"]);
    return r.code === 0 ? JSON.parse(r.stdout) : null;
  });
  const pid = got?.foreground?.pid;
  if (!pid) return null;
  const kind = app === "codex" || /codex/.test(got.foreground.argv?.[0] ?? "") ? "codex" : "claude";
  const located = await localService(transcriptApi).locate(pid, kind, home);
  if (located.state === "unavailable") return { pid, unavailable: located.reason };
  const where = parseLocated(located.stdout, home);
  if (!where) return null;
  const size = await localService(transcriptApi).size(where.file);
  if (!size) return null;
  if (known?.file === where.file && known.size === size && known.name === where.name && known.pid === pid) return known;
  const r = await localService(transcriptApi).thread(where.file);
  if (r.code !== 0 && !r.stdout) return null;
  const [titleLine, head, recent, tail] = r.stdout.split("\n\u001e\n");
  return { kind, file: where.file, name: where.name, size, pid, ...readThread(kind, titleLine, head, recent, tail, where.name) };
}

// How many terminals are looked at at once: each takes three or four processes.
const AT_ONCE = 4;

export async function findThreads(list, known = {}) {
  const homeDir = home();
  const queue = list.values();
  const lane = async (got = []) => {
    const { value: item, done } = queue.next();
    if (done) return got;
    return lane([...got, [item.address, await findThread(item, known[item.address], homeDir)]]);
  };
  const found = await Promise.all(Array.from({ length: Math.min(AT_ONCE, list.length) }, lane));
  return Object.fromEntries(found.flat().filter(([, thread]) => thread));
}

// Whether each conversation's process still runs. Conversations are found every 15-60 s, so asking every 10 s
// (every minute behind other windows or with the sidebar collapsed) misses nothing; a new set of pids is asked at once.
export const ALIVE_MS = 10000;
export const ALIVE_BEHIND_MS = 60000;

// Sorted, so the same processes always give the same signature.
export const pidsOf = (threads) => [...new Set(Object.values(threads ?? {}).map((th) => th?.pid).filter((p) => Number.isInteger(p) && p > 0))]
  .toSorted((a, b) => a - b);

// What `ps -o pid= -p` lists: one pid a line.
export const pidsListed = (text) => new Set(String(text ?? "").split("\n").map((line) => Number(line.trim())).filter((p) => p > 0));
// `listed`: anything with has(pid), that Set or checkTasks' table by pid, so neither is read twice.
export const aliveIn = (listed, pids) => new Set(pids.filter((p) => listed.has(p)));

// `last`: the signature and start of the last look, its own or checkTasks'; none yet is due.
export const aliveDue = (last, sig, now, every) => last?.at == null || last.sig !== sig || now - last.at >= every;

// Kanso only reads what already lives on this computer, only while the Threads view is open, and never sends the agent anything.
import { exec, hc } from "herdr";
import { tryOr, tryOrAsync } from "./pure.js";

const TAIL = 8192;
const RS = "\u001e";

// Codex may run under a launcher, so its children are asked too.
const LOCATE = String.raw`pid="$1"; kind="$2"
if [ "$kind" = claude ]; then
  f="$HOME/.claude/sessions/$pid.json"; [ -f "$f" ] && printf 'claude\t%s\n' "$(tr -d '\n' < "$f")"
  exit 0
fi
for p in "$pid" $(pgrep -P "$pid" 2>/dev/null); do
  f=$(lsof -a -p "$p" -d 0-999 -Fn 2>/dev/null | sed -n 's/^n\(.*rollout-.*\.jsonl\)$/\1/p' | head -1)
  [ -n "$f" ] || continue
  id=$(basename "$f" .jsonl | grep -o '[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}$')
  name=$(grep -h "\"id\":\"$id\"" "$HOME/.codex/session_index.jsonl" 2>/dev/null | tail -1)
  printf 'codex\t%s\t%s\n' "$f" "$name"
  exit 0
done`;

// Files grow to tens of MB: only the first and last 4 MB are searched, and lines over 16 KB (a pasted image) are left out to spare the heap.
// Claude Code writes the title again every few turns, so the whole file is searched only when the end has none.
const READ = String.raw`f="$1"; said() { grep -h -e '"type":"user"' -e '"user_message"' | grep -v '"tool_result"' | awk 'length($0) < 16000'; }
t=$(tail -c 4000000 "$f" | grep -h '"type":"ai-title"' | awk 'length($0) < 16000' | tail -1)
[ -n "$t" ] || t=$(grep -h '"type":"ai-title"' "$f" | awk 'length($0) < 16000' | tail -1)
printf '%s\n\036\n' "$t"
head -c 4000000 "$f" | said | head -n 60; printf '\n\036\n'
tail -c 4000000 "$f" | said | tail -n 40; printf '\n\036\n'
tail -c ${TAIL} "$f"`;

export const claudeFile = (home, cwd, session) => `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}/${session}.jsonl`;

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
  const where = parseLocated((await exec("sh", ["-c", LOCATE, "sh", String(pid), kind])).stdout, home);
  if (!where) return null;
  const size = Number((await exec("sh", ["-c", "wc -c < \"$1\"", "sh", where.file])).stdout.trim());
  if (!size) return null;
  if (known?.file === where.file && known.size === size && known.name === where.name && known.pid === pid) return known;
  const r = await exec("sh", ["-c", READ, "sh", where.file]);
  if (r.code !== 0 && !r.stdout) return null;
  const [titleLine, head, recent, tail] = r.stdout.split(`\n${RS}\n`);
  return { kind, file: where.file, name: where.name, size, pid, ...readThread(kind, titleLine, head, recent, tail, where.name) };
}

// How many terminals are looked at at once: each takes three or four processes.
const AT_ONCE = 4;

export async function findThreads(list, known = {}) {
  const home = (await exec("sh", ["-c", "printf %s \"$HOME\""])).stdout;
  const queue = list.values();
  const lane = async (got = []) => {
    const { value: item, done } = queue.next();
    if (done) return got;
    return lane([...got, [item.address, await findThread(item, known[item.address], home)]]);
  };
  const found = await Promise.all(Array.from({ length: Math.min(AT_ONCE, list.length) }, lane));
  return Object.fromEntries(found.flat().filter(([, thread]) => thread));
}

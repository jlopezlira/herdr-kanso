// The Threads view's data: each open agent conversation, named on its own.
// Which conversation a terminal holds: `hc get` names the process in front
// of it; Claude Code notes that process's conversation in
// ~/.claude/sessions/<pid>.json, and Codex keeps its conversation file
// open. The name is the one the agent gives the conversation itself, kept
// up to date as it goes: Claude Code's "ai-title" in the conversation's
// file, Codex's thread name in ~/.codex/session_index.jsonl; else the
// first thing you wrote. All of it already lives on this computer: Kanso
// only reads it, only while the Threads view is open, and never sends the
// agent anything.
import { exec, hc } from "herdr";

const TAIL = 8192;
const RS = "\u001e";

// The conversation of the process in front of a terminal, in one line:
// "claude <tab> <its session record>" or "codex <tab> <file> <tab> <its
// index line>". Codex may run under a launcher: its children are asked too.
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

// One conversation file, in four parts split by a record separator: its
// last title line, the first and last lines with a message from
// a person (tool results left out), its last few KB. Files grow to tens of
// MB, so only their first and last 4 MB are searched (Claude Code writes
// the title again every few turns; the whole file only when the end has none).
// Lines over 16 KB (a pasted image, in base64) are left out: they would only
// fill the mod runtime's heap.
const READ = String.raw`f="$1"; said() { grep -h -e '"type":"user"' -e '"user_message"' | grep -v '"tool_result"' | awk 'length($0) < 16000'; }
t=$(tail -c 4000000 "$f" | grep -h '"type":"ai-title"' | awk 'length($0) < 16000' | tail -1)
[ -n "$t" ] || t=$(grep -h '"type":"ai-title"' "$f" | awk 'length($0) < 16000' | tail -1)
printf '%s\n\036\n' "$t"
head -c 4000000 "$f" | said | head -n 60; printf '\n\036\n'
tail -c 4000000 "$f" | said | tail -n 40; printf '\n\036\n'
tail -c ${TAIL} "$f"`;

// Claude Code's folder for a working directory: every character that is
// not a letter or a digit becomes "-".
export const claudeFile = (home, cwd, session) => `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}/${session}.jsonl`;

// LOCATE's answer as { kind, file, name (Codex's thread name) }, or null.
export function parseLocated(text, home) {
  const [kind, a, b] = (text ?? "").replace(/\n$/, "").split("\t");
  if (kind === "codex" && a) {
    let name = null;
    try { name = JSON.parse(b).thread_name?.trim() || null; } catch { /* no name yet */ }
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

// What a person typed, without the wrappers agents put around commands,
// reminders and context ("<command-name>…", "<environment_context>…"),
// slash commands, or the note a compacted conversation starts with.
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

// A conversation from its file: { title, prompt (the last thing you
// wrote), said (when you wrote it, ms), at (ms of the last entry) }. The
// title is the one the agent gave it (`name`, Codex's; Claude Code's from
// the file), else the first thing you wrote.
export function readThread(kind, titleLine, head, recent, tail, name = null) {
  const prompt = kind === "codex" ? codexPrompt : claudePrompt;
  const firstPrompt = lines(head).map(prompt).find(Boolean) ?? null;
  // Only what you wrote lately: an agent that has only heard from other agents shows none.
  const last = lines(recent).reverse().find((e) => prompt(e));
  const title = name ?? (kind === "claude" ? lines(titleLine).find((e) => e?.type === "ai-title" && e.aiTitle)?.aiTitle ?? null : null);
  return {
    title: title ?? firstPrompt,
    prompt: last ? prompt(last) : null,
    said: ms(last?.timestamp),
    began: ms(lines(head).find((e) => e?.timestamp)?.timestamp),
    at: ms(lines(tail).reverse().find((e) => e?.timestamp)?.timestamp),
  };
}

// One terminal's conversation, or null: where it is (`hc get`, then
// LOCATE), its size, and when the file grew, what it says (READ).
async function findThread({ address, app }, known, home) {
  let got = null;
  try { const r = await hc(["get", address, "--json"]); if (r.code === 0) got = JSON.parse(r.stdout); } catch { return null; }
  const pid = got?.foreground?.pid;
  if (!pid) return null;
  const kind = app === "codex" || /codex/.test(got.foreground.argv?.[0] ?? "") ? "codex" : "claude";
  const where = parseLocated((await exec("sh", ["-c", LOCATE, "sh", String(pid), kind])).stdout, home);
  if (!where) return null;
  const size = Number((await exec("sh", ["-c", "wc -c < \"$1\"", "sh", where.file])).stdout.trim());
  if (!size) return null;
  if (known?.file === where.file && known.size === size && known.name === where.name) return known;
  const r = await exec("sh", ["-c", READ, "sh", where.file]);
  if (r.code !== 0 && !r.stdout) return null;
  const [titleLine, head, recent, tail] = r.stdout.split(`\n${RS}\n`);
  return { kind, file: where.file, name: where.name, size, ...readThread(kind, titleLine, head, recent, tail, where.name) };
}

// How many terminals are looked at at once: each takes three or four processes.
const AT_ONCE = 4;

// The open conversations of these terminals ({ address, app }, on this
// computer), by terminal. `known`: the last answer; a file whose size
// hasn't changed since is not read again.
export async function findThreads(list, known = {}) {
  const home = (await exec("sh", ["-c", "printf %s \"$HOME\""])).stdout;
  const out = {};
  let next = 0;
  const lane = async () => {
    while (next < list.length) {
      const item = list[next++];
      const thread = await findThread(item, known[item.address], home);
      if (thread) out[item.address] = thread;
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, list.length) }, lane));
  return out;
}

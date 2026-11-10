// Find in an agent's conversation on disk: each turn's text, matched without case or accents.
import { join } from "path";
import { etimeMs } from "./procs.js";
import { FIND } from "./find-key.js";
export { FIND };

export const START_SLACK = 120000; // ps counts whole seconds from a start a little before the record was written
export const LINE_MAX = 100000;
export const SLICE_BUDGET = 2000000;
export const DRAW = 50;
export const EXCERPT = 64;
const WORDS = 22;
const MARK = /\p{M}/u;
// A tool's delivery note is not a turn: the words are already in what was said.
const DELIVERY = /^(?:message\s+)?(?:successfully\s+)?(?:delivered|sent)(?:\s+to(?:\s+the)?\s+user)?\.?$/i;

// Claude Code names the folder after the working folder: anything not a letter or digit becomes "-", and a
// folder over 200 characters is cut there with a hash of the whole (Claude Code 2.1).
export function projectDir(cwd) {
  const path = String(cwd ?? "");
  const slug = path.replace(/[^A-Za-z0-9]/g, "-");
  if (slug.length <= 200) return slug;
  const h = Array.from({ length: path.length }, (_, i) => path.charCodeAt(i)).reduce((n, c) => ((n << 5) - n + c) | 0, 0);
  return `${slug.slice(0, 200)}-${Math.abs(h).toString(36)}`;
}
export const sessionPath = (homeDir, pid) => join(homeDir, ".claude", "sessions", `${pid}.json`);
export const transcriptPath = (session, homeDir) =>
  session?.sessionId && session.cwd && homeDir
    ? join(homeDir, ".claude", "projects", projectDir(session.cwd), `${session.sessionId}.jsonl`)
    : null;

export function sessionLive(record, pid, started) {
  if (!record || record.pid !== pid || !record.sessionId) return false;
  const at = Number(record.startedAt);
  return Number.isFinite(started) && Number.isFinite(at) && Math.abs(started - at) <= START_SLACK;
}

function foldPoint(ch) {
  if (ch.length === 1) {
    const c = ch.charCodeAt(0);
    if (c < 128) return c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : ch;
  }
  return [...ch.normalize("NFD").toLowerCase()].filter((p) => !MARK.test(p)).join("");
}

// One code point at a time, so a mark stays inside the slice that shows it ("código" for "codigo").
export function foldSpan(s) {
  const src = String(s ?? "");
  const walked = [...src].reduce((acc, ch) => {
    const piece = foldPoint(ch);
    return { at: acc.at + ch.length, text: acc.text + piece, map: acc.map.concat([...piece].map(() => acc.at)) };
  }, { at: 0, text: "", map: [] });
  return { text: walked.text, map: walked.map.concat([src.length]) };
}
export const fold = (s) => [...String(s ?? "")].reduce((out, ch) => out + foldPoint(ch), "");
export const blankQuery = (query) => !fold(String(query ?? "").trim());

export const indexTurns = (turns, from = 0) => turns.slice(from).map((turn, k) => ({ i: from + k, text: fold(turn.text ?? "") }));

function hitsIn(span, q) {
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...span.text.matchAll(new RegExp(escaped, "g"))].map((m) => ({ turn: span.i, at: m.index, len: q.length }));
}

export function searchIndex(index, query) {
  const q = fold(String(query ?? "").trim());
  if (!q) return [];
  return index.flatMap((span) => hitsIn(span, q)).toReversed();
}
export const searchTurns = (turns, query) => searchIndex(indexTurns(turns), query);

export function matchSpan(text, hit) {
  const src = String(text ?? "");
  const { map } = foldSpan(src);
  return { start: map[hit.at] ?? 0, end: map[hit.at + hit.len] ?? src.length };
}

function takeWords(words, budget) {
  return words.reduce((acc, w) => {
    if (acc.stop) return acc;
    const cost = w.length + (acc.words.length ? 1 : 0);
    if (acc.words.length && acc.used + cost > budget) return { ...acc, stop: true };
    return { words: acc.words.concat([w]), used: acc.used + cost, stop: false };
  }, { words: [], used: 0, stop: false }).words;
}

function sideWords(text, budget, fromEnd) {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || budget <= 0) return { words: [], more: words.length > 0 };
  const kept = takeWords(fromEnd ? words.toReversed() : words, budget);
  return { words: fromEnd ? kept.toReversed() : kept, more: kept.length < words.length };
}

function shrinkTo(left, right, cap) {
  if (left.length + right.length <= cap) return { left, right };
  if (left.length >= right.length && left.length) return shrinkTo(left.slice(1), right, cap);
  return right.length ? shrinkTo(left, right.slice(0, -1), cap) : { left, right };
}

export function partsOf(text, hit, radius = EXCERPT) {
  if (!hit) return [];
  const src = String(text ?? "");
  const { start, end } = matchSpan(src, hit);
  const match = src.slice(start, end).replace(/\s+/g, " ").trim();
  const left = sideWords(src.slice(0, start), radius, true);
  const right = sideWords(src.slice(end), radius, false);
  const cut = shrinkTo(left.words, right.words, WORDS);
  return [
    left.more || cut.left.length < left.words.length ? { text: "\u2026", mark: false } : null,
    cut.left.length ? { text: cut.left.join(" "), mark: false } : null,
    match ? { text: match, mark: true } : null,
    cut.right.length ? { text: cut.right.join(" "), mark: false } : null,
    right.more || cut.right.length < right.words.length ? { text: "\u2026", mark: false } : null,
  ].filter(Boolean);
}

const markedWord = (w, mark) => ({ w, mark: Boolean(mark) });

function takeLine(text, mark) {
  return String(text ?? "").split(/\s+/).filter(Boolean).map((w) => markedWord(w, mark));
}

function addLine(lines, text, mark, fresh) {
  const words = takeLine(text, mark);
  if (!fresh && lines.length) return lines.slice(0, -1).concat([lines.at(-1).concat(words)]);
  return lines.concat([words]);
}

export function wordsByLine(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const lines = list.reduce((acc, part) => String(part?.text ?? "").split("\n").reduce(
    (state, bit, i) => addLine(state, bit, part?.mark, i > 0),
    acc,
  ), []);
  return lines.length ? lines : [[]];
}

export function drawWindow(count, at, cap = DRAW) {
  const n = Math.max(0, count | 0);
  if (!n) return { start: 0, end: 0 };
  const a = Math.max(0, Math.min(at | 0, n - 1));
  const span = Math.min(Math.max(1, cap), n);
  const start = Math.max(0, Math.min(a - Math.floor(span / 2), n - span));
  return { start, end: start + span };
}

function placeFocus(acc, row) {
  if (acc.found) return acc;
  if (row.focus === null) return { at: acc.at + row.items.length, found: false };
  return { at: acc.at + row.focus, found: true };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayKey(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(ms, now = Date.now()) {
  const key = dayKey(ms);
  if (!key) return "";
  if (key === dayKey(now)) return "Today";
  const clock = new Date(now);
  const prev = new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() - 1);
  if (key === dayKey(prev.getTime())) return "Yesterday";
  const day = new Date(ms);
  const month = MONTHS[day.getMonth()];
  return day.getFullYear() === clock.getFullYear() ? `${month} ${day.getDate()}` : `${month} ${day.getDate()}, ${day.getFullYear()}`;
}

export function layOut(hits, at, cap = DRAW, whenOf = () => null, now = Date.now()) {
  const list = Array.isArray(hits) ? hits : [];
  const win = drawWindow(list.length, at, cap);
  const slice = list.slice(win.start, win.end);
  const rows = slice.map((hit, k) => {
    const i = win.start + k;
    const label = dayLabel(whenOf(hit), now);
    const prev = k ? dayLabel(whenOf(slice[k - 1]), now) : "";
    const day = label && label !== prev ? [{ kind: "day", label, index: i }] : [];
    return { focus: i === at ? day.length : null, items: day.concat([{ kind: "hit", hit, index: i, head: true }]) };
  });
  return { items: rows.flatMap((row) => row.items), focus: rows.reduce(placeFocus, { at: 0, found: false }).at, start: win.start, end: win.end };
}

export const whoOf = (turn) => turn?.role === "user" ? "You" : turn?.role === "tool" ? String(turn.name || "tool").slice(0, 24) : "Agent";

export function whenLabel(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function placeOf(at, n) {
  if (!n) return "";
  const i = ((at % n) + n) % n;
  return `${i + 1} of ${n}`;
}
export function countLabel(query, at, n) {
  if (blankQuery(query)) return "";
  if (!n) return "No matches";
  return placeOf(at, n);
}

export function findChord(modifiers) {
  const m = modifiers ?? {};
  return Boolean(m.platform || m.meta || m.control);
}

export function keptQuery(state, terminal) {
  const q = state?.queries?.[terminal];
  return typeof q === "string" && !blankQuery(q) ? q : "";
}

export function withQuery(queries, terminal, query) {
  const base = queries && typeof queries === "object" && !Array.isArray(queries) ? queries : {};
  const rest = Object.fromEntries(Object.entries(base).filter(([key]) => key !== terminal));
  return !terminal || blankQuery(query) ? rest : { ...rest, [terminal]: String(query) };
}
export const stepMatch = (at, n, dir) => (n ? (at + dir + n) % n : 0);

// A query typed since the last search is applied and left on the newest match; the next Enter moves.
export function enterMatch(box, index, shift) {
  const pending = String(box.pending ?? "");
  if (pending !== box.query) return { ...box, query: pending, hits: searchIndex(index, pending), at: 0, moved: "query" };
  if (!box.hits.length) return { ...box, moved: "none" };
  return { ...box, at: stepMatch(box.at, box.hits.length, shift ? -1 : 1), moved: "move" };
}

export function chooseMatch(state, index, action) {
  const pending = String(state.pending ?? "");
  const key = action?.key;
  if (key === "type") return { query: pending, hits: searchIndex(index, pending), at: 0, open: false, moved: "type" };
  if (key === "click") {
    const at = action.at ?? -1;
    if (!state.hits?.length || at < 0 || at >= state.hits.length) return { ...state, open: false, moved: "none" };
    return { ...state, at, open: true, moved: "click" };
  }
  if (key === "back") return { ...state, open: false, moved: "back" };
  const newer = key === "up" || key === "shift";
  if (!(newer || key === "down" || key === "enter")) return { ...state, moved: "none" };
  if (pending !== state.query) {
    const next = enterMatch({ ...state, pending }, index, newer);
    return { ...next, open: false };
  }
  if (!state.hits?.length) return { ...state, open: false, moved: "none" };
  const next = enterMatch({ ...state, pending }, index, newer);
  return { ...next, open: Boolean(state.open) && next.hits.length > 0 };
}

export function retarget(index, query, prev) {
  const hits = searchIndex(index, query);
  if (!prev || !hits.length) return { hits, at: 0 };
  const i = hits.findIndex((h) => h.turn === prev.turn && h.at === prev.at);
  return { hits, at: i >= 0 ? i : 0 };
}

export const extendIndex = (index, turns, from, reindex) =>
  (reindex || index.length > turns.length ? indexTurns(turns) : index.concat(indexTurns(turns, from)));

const atOf = (stamp) => {
  if (typeof stamp === "number" && Number.isFinite(stamp)) return stamp;
  const n = Date.parse(stamp);
  return Number.isNaN(n) ? null : n;
};

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((p) => {
    if (typeof p === "string") return [p];
    if (!p || typeof p !== "object") return [];
    if (String(p.type ?? "").toLowerCase().includes("image")) return [];
    return typeof p.text === "string" ? [p.text] : [];
  }).join("\n");
}

function toolName(command) {
  const word = String(command ?? "").trim().split(/\s+/)[0] ?? "";
  const base = word.split(/[/\\]/).filter(Boolean).at(-1) || "tool";
  return base.slice(0, 24);
}

export function readable(turn) {
  const text = String(turn?.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return turn?.role !== "tool" || !DELIVERY.test(text);
}
const keep = (turn) => readable(turn);
const add = (state, turn) => (keep(turn) ? { ...state, turns: state.turns.concat([turn]) } : state);

function claudeLine(tools, obj) {
  if (!obj || (obj.type !== "user" && obj.type !== "assistant")) return null;
  if (obj.isMeta || obj.isSidechain) return { tools, turns: [] };
  const at = atOf(obj.timestamp);
  const role = obj.type === "user" ? "user" : "assistant";
  const content = obj.message?.content;
  if (typeof content === "string") return { tools, turns: [{ role, text: content, at }] };
  if (!Array.isArray(content)) return { tools, turns: [] };
  const step = content.reduce((acc, p) => {
    if (!p || typeof p !== "object") return acc;
    if (p.type === "tool_use" && p.id) return { ...acc, tools: { ...acc.tools, [p.id]: toolName(p.name) } };
    if (p.type === "thinking" || String(p.type ?? "").toLowerCase().includes("image")) return acc;
    if (p.type === "tool_result") {
      const turn = { role: "tool", name: acc.tools[p.tool_use_id] || "tool", text: textOf(p.content), at };
      return keep(turn) ? { ...acc, turns: acc.turns.concat([turn]) } : acc;
    }
    return typeof p.text === "string" ? { ...acc, texts: acc.texts.concat([p.text]) } : acc;
  }, { tools, turns: [], texts: [] });
  const text = step.texts.join("\n");
  const said = text.trim() ? [{ role, text, at }] : [];
  return { tools: step.tools, turns: said.concat(step.turns) };
}

function codexItem(obj) {
  if (obj?.type !== "event_msg" || obj.payload?.type !== "item_completed") return undefined;
  const item = obj.payload.item ?? {};
  const at = atOf(obj.timestamp);
  if (item.type === "UserMessage" || item.type === "AgentMessage") {
    const text = textOf(item.content);
    return text.trim() ? { role: item.type === "UserMessage" ? "user" : "assistant", text, at } : null;
  }
  if (item.type === "CommandExecution") {
    const text = typeof item.aggregated_output === "string" ? item.aggregated_output : textOf(item.aggregated_output);
    return text.trim() ? { role: "tool", name: toolName(item.command), text, at } : null;
  }
  if (item.type === "FileChange") {
    const text = [item.stdout, item.stderr].filter((s) => typeof s === "string").join("\n");
    return text.trim() ? { role: "tool", name: "file", text, at } : null;
  }
  return null;
}

function dropResponse(state) {
  if (state.legacyFrom !== "response") return { ...state, legacyFrom: "event" };
  const kept = state.turns.filter((t) => t.role === "tool");
  return kept.length === state.turns.length
    ? { ...state, legacyFrom: "event" }
    : { ...state, turns: kept, epoch: state.epoch + 1, legacyFrom: "event" };
}

function legacyLine(state, obj) {
  if (!obj || typeof obj !== "object") return null;
  const at = atOf(obj.timestamp);
  if (obj.type === "event_msg") {
    const p = obj.payload ?? {};
    if (p.type !== "user_message" && p.type !== "agent_message") return null;
    const text = typeof p.message === "string" ? p.message : textOf(p.message);
    return { state: dropResponse(state), turns: [{ role: p.type === "user_message" ? "user" : "assistant", text, at }] };
  }
  const item = obj.type === "response_item" ? (obj.payload ?? {}) : obj;
  const kind = obj.type === "response_item" ? item.type : obj.type;
  if (kind === "message") {
    if (state.legacyFrom === "event" || (item.role !== "user" && item.role !== "assistant")) return { state, turns: [] };
    return { state: { ...state, legacyFrom: "response" }, turns: [{ role: item.role, text: textOf(item.content), at }] };
  }
  if (kind === "custom_tool_call" || kind === "function_call") {
    const tools = item.call_id && item.name ? { ...state.tools, [item.call_id]: toolName(item.name) } : state.tools;
    return { state: { ...state, tools }, turns: [] };
  }
  if (kind === "custom_tool_call_output" || kind === "function_call_output") {
    const text = typeof item.output === "string" ? item.output : textOf(item.output);
    return { state, turns: [{ role: "tool", name: state.tools[item.call_id] || "tool", text, at }] };
  }
  return null;
}

function absorb(state, obj) {
  if (state.mode !== "claude") {
    const item = codexItem(obj);
    if (item !== undefined) {
      const cleared = state.mode === "modern" ? state : {
        ...state, mode: "modern", turns: state.turns.length ? [] : state.turns, epoch: state.turns.length ? state.epoch + 1 : state.epoch,
      };
      return item ? add(cleared, item) : cleared;
    }
  }
  if (state.mode === "modern") return state;
  if (state.mode !== "legacy") {
    const got = claudeLine(state.tools, obj);
    if (got) return got.turns.reduce(add, { ...state, mode: "claude", tools: got.tools });
  }
  if (state.mode === "claude") return state;
  const legacy = legacyLine(state, obj);
  if (!legacy) return state;
  return legacy.turns.reduce(add, { ...legacy.state, mode: "legacy" });
}

export function freshRead() {
  return { from: 0, size: 0, mode: null, turns: [], legacyFrom: null, tools: {}, rest: "", epoch: 0 };
}

export function moreTurns(state, chunk, eof = false) {
  const lines = `${state.rest}${chunk ?? ""}`.split("\n");
  const rest = eof ? "" : (lines.at(-1) ?? "");
  const body = eof ? lines : lines.slice(0, -1);
  const next = body.reduce((acc, raw) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line) return acc;
    try { return absorb(acc, JSON.parse(line)); } catch { return acc; }
  }, { ...state, rest });
  return { state: next, rebuild: next.mode !== state.mode || next.epoch !== state.epoch || next.turns.length < state.turns.length };
}

export function readTurns(text) {
  return moreTurns(freshRead(), String(text ?? ""), true).state.turns;
}

export function parseSlice(text) {
  const s = String(text ?? "");
  const nl = s.indexOf("\n");
  if (nl < 0) return null;
  const head = s.slice(0, nl).trim().split(/\s+/);
  if (head.length !== 2 || !/^\d+$/.test(head[0]) || !/^\d+$/.test(head[1])) return null;
  return { end: Number(head[0]), size: Number(head[1]), body: s.slice(nl + 1) };
}

export function applySlice(state, parsed) {
  if (!parsed) return { ok: false };
  if (parsed.size < state.size) return { ok: true, reset: true, state };
  const from = state.turns.length;
  const read = moreTurns(state, parsed.body, parsed.end >= parsed.size);
  return { ok: true, reset: false, reindex: read.rebuild, from: read.rebuild ? 0 : from, state: { ...read.state, from: parsed.end, size: parsed.size } };
}

// The next read starts at `end`. A line over the limit is a pasted picture and is left out; a chunk with none is too.
export const SLICE_PY = String.raw`import os, sys
path, frm_s, budget_s, longest_s = sys.argv[1:]
try:
    size = os.path.getsize(path)
except OSError:
    sys.exit(2)
frm = int(frm_s)
budget = int(budget_s)
longest = int(longest_s)
if frm < 0 or frm > size:
    frm = 0
fh = open(path, "rb")
start = frm
data = b""
end = start
while start < size:
    fh.seek(start)
    data = fh.read(min(budget, size - start))
    end = start + len(data)
    if b"\n" not in data and end < size:
        fh.seek(start)
        skipped = 0
        while True:
            block = fh.read(1048576)
            if not block:
                start = size
                data = b""
                end = size
                break
            i = block.find(b"\n")
            if i >= 0:
                start = start + skipped + i + 1
                break
            skipped += len(block)
        if start >= size:
            break
        continue
    if end < size or not data.endswith(b"\n"):
        i = data.rfind(b"\n")
        if i >= 0:
            data = data[:i + 1]
            end = start + i + 1
        else:
            data = b""
            end = start
    break
kept = []
for line in data.decode("utf-8", "replace").split("\n"):
    if line.endswith("\r"):
        line = line[:-1]
    if len(line) >= longest:
        continue
    kept.append(line)
sys.stdout.write(str(end) + " " + str(size) + "\n")
sys.stdout.write("\n".join(kept))
fh.close()
`;

export async function readSlice(exec, file, from = 0, budget = SLICE_BUDGET, longest = LINE_MAX) {
  const args = ["-c", SLICE_PY, file, String(from), String(budget), String(longest)];
  const run = (cmd) => Promise.resolve(exec(cmd, args, { timeout: 60000 })).catch(() => null);
  const first = await run("python3");
  const r = first && (first.code === 0 || first.code === 2) ? first : await run("python");
  if (!r || r.code !== 0 || typeof r.stdout !== "string") return null;
  return parseSlice(r.stdout);
}

// The program in front, or Herdr's app name ("claude-code"), says whose conversation this is.
export function kindOf(program, hint = "") {
  const text = `${String(program ?? "").split(/[/\\]/).at(-1)} ${hint}`.toLowerCase();
  if (/(^|[^a-z])codex/.test(text)) return "codex";
  if (/(^|[^a-z])claude/.test(text)) return "claude";
  return null;
}

const CODEX_LSOF = String.raw`pid="$1"
for p in "$pid" $(pgrep -P "$pid" 2>/dev/null); do
  f=$(lsof -a -p "$p" -d 0-999 -Fn 2>/dev/null | sed -n 's/^n\(.*rollout-.*\.jsonl\)$/\1/p' | head -1)
  if [ -n "$f" ]; then printf '%s\n' "$f"; exit 0; fi
done
exit 1`;

const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };

export function resolveFind(where) {
  return where?.file ? { action: "find", file: where.file, kind: where.kind ?? null } : { action: "terminal.search" };
}

export async function locateConversation(host, address, hint = "") {
  if (!address || String(address).includes("/")) return { kind: null, file: null };
  const got = await host.hc(["get", address, "--json"]).catch(() => null);
  const front = got?.code === 0 ? parsed(got.stdout)?.foreground : null;
  const pid = front?.pid;
  if (!pid) return { kind: null, file: null };
  const kind = kindOf(front.argv?.[0], hint);
  if (kind === "claude") {
    const record = parsed(await host.readTextFile(sessionPath(host.home(), pid)).catch(() => null));
    const up = record?.sessionId ? await host.exec("ps", ["-o", "etime=", "-p", String(pid)]).catch(() => null) : null;
    const started = up?.code === 0 ? Date.now() - etimeMs(String(up.stdout).trim()) : NaN;
    if (!sessionLive(record, pid, started)) return { kind: null, file: null };
    const file = transcriptPath(record, host.home());
    return file ? { kind: "claude", file } : { kind: null, file: null };
  }
  if (kind === "codex") {
    const r = await host.exec("sh", ["-c", CODEX_LSOF, "sh", String(pid)]).catch(() => null);
    const file = r?.code === 0 ? String(r.stdout).split("\n").map((l) => l.trim()).find(Boolean) : null;
    return file ? { kind: "codex", file } : { kind: null, file: null };
  }
  return { kind: null, file: null };
}

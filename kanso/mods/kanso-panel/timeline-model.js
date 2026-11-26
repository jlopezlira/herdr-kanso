import { recordsIn, absorbEach } from "./find.js";
import { eventsOf } from "./transcript-events.js";
import { typedText, span, clock, plural } from "./pure.js";

export const KEPT_PROMPTS = 200;
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const RUNS = new Set(["Bash"]);
const CODEX_RUNS = new Set(["shell", "exec_command", "local_shell", "unified_exec", "exec"]);
const PATCHED = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
const REFUSED = /^(?:error|failed|apply_patch verification failed)/i;
const SENTENCE = /^(.{1,240}?[.!?])(?:\s|$)/s;
const DOT = " \u{b7} ";

export const freshTimeline = () => ({ from: 0, size: 0, rest: "", mode: null, legacyFrom: null, turn: false, calls: {}, count: 0, prompts: [] });

const openOf = (state) => {
  const last = state.prompts.at(-1);
  return last && last.end == null ? last : null;
};

const touch = (state, change) => (openOf(state) ? { ...state, prompts: [...state.prompts.slice(0, -1), change(state.prompts.at(-1))] } : state);
const seen = (state, at) => (at == null ? state : touch(state, (p) => ({ ...p, last: at })));

function close(state, at, ms = null, stopped = false) {
  return touch(state, (p) => {
    const end = at ?? p.last ?? p.at;
    return { ...p, end, ms: ms ?? Math.max(0, (end ?? 0) - (p.at ?? 0)), stopped };
  });
}

function begin(state, text, at) {
  const ended = openOf(state) ? close(state, openOf(state).last ?? at) : state;
  const n = ended.count + 1;
  const next = { n, text, at, last: at, also: [], end: null, ms: null, files: [], commands: 0, reply: "", stopped: false };
  return { ...ended, calls: {}, count: n, prompts: [...ended.prompts, next].slice(-KEPT_PROMPTS) };
}

const also = (state, text, at) => touch(state, (p) => ({ ...p, last: at ?? p.last, also: [...p.also, { text, at }] }));
const replied = (state, text, at) => (String(text ?? "").trim() ? touch(seen(state, at), (p) => ({ ...p, reply: String(text).trim() })) : seen(state, at));
const edited = (state, files) => touch(state, (p) => ({ ...p, files: [...new Set([...p.files, ...files.filter(Boolean).map(String)])] }));
const ran = (state) => touch(state, (p) => ({ ...p, commands: p.commands + 1 }));
const typed = (text) => (typedText(text) ? String(text).trim() : null);
const patched = (text) => [...String(text ?? "").matchAll(PATCHED)].map((m) => m[1].trim());

function asked(state, e) {
  const text = typed(e.text);
  if (!text) return seen(state, e.at);
  return state.mode !== "claude" && state.turn && openOf(state) ? also(state, text, e.at) : begin(state, text, e.at);
}

function said(state, e) {
  if (e.role === "assistant") return replied(state, e.text, e.at);
  const raw = String(e.text ?? "").trim();
  if (raw.startsWith("[Request interrupted")) return close(state, e.at, null, true);
  return e.human ? asked(state, e) : seen(state, e.at);
}

function called(state, e) {
  const name = String(e.name ?? "");
  const used = seen(state, e.at);
  if (RUNS.has(name) || CODEX_RUNS.has(name)) return ran(used);
  const files = EDITS.has(name) ? [e.input?.file_path ?? e.input?.notebook_path] : name === "apply_patch" ? patched(e.input) : [];
  return files.length && e.id ? { ...used, calls: { ...used.calls, [e.id]: files } } : used;
}

function answered(state, e) {
  const files = state.calls[e.id];
  const used = seen(state, e.at);
  if (!files) return used;
  const rest = Object.fromEntries(Object.entries(used.calls).filter(([id]) => id !== e.id));
  const ok = !e.error && !REFUSED.test(String(e.text ?? "").trim());
  return ok ? edited({ ...used, calls: rest }, files) : { ...used, calls: rest };
}

const STEPS = {
  say: said,
  queued: (state, e) => { const text = e.human ? typed(e.text) : null; return text ? also(state, text, e.at) : state; },
  call: called,
  result: answered,
  command: (state, e) => ran(seen(state, e.at)),
  files: (state, e) => (e.ok ? edited(seen(state, e.at), e.paths) : seen(state, e.at)),
  start: (state) => ({ ...state, turn: true }),
  end: (state, e) => ({ ...close(state, e.at, e.ms, e.stopped), turn: false }),
};

function legacy(state, e) {
  if (e.kind !== "say" || !e.from) return state;
  if (e.from === "event") return state.legacyFrom === "response" ? { ...freshTimeline(), mode: "legacy", legacyFrom: "event", from: state.from, size: state.size, rest: state.rest } : { ...state, legacyFrom: "event" };
  return state.legacyFrom === "event" ? null : { ...state, legacyFrom: "response" };
}

export function absorbRecord(state, obj) {
  const { format, events } = eventsOf(obj);
  if (!format) return state;
  const base = format === "modern" && state.mode !== "modern" ? { ...state, mode: "modern", prompts: [], count: 0, calls: {} }
    : format === "claude" || format === "legacy" ? (state.mode === "modern" ? null : { ...state, mode: state.mode ?? format }) : state;
  if (!base) return state;
  return events.reduce((acc, e) => {
    if (base.mode === "legacy") {
      const routed = legacy(acc, e);
      if (routed === null) return acc;
      return STEPS[e.kind] ? STEPS[e.kind](routed, e) : routed;
    }
    return STEPS[e.kind] ? STEPS[e.kind](acc, e) : acc;
  }, base);
}

export function moreTimeline(state, chunk, eof = false) {
  const { rest, records } = recordsIn(state.rest, chunk, eof);
  return absorbEach(records, absorbRecord, { ...state, rest });
}

export function applyTimeline(state, slice) {
  if (!slice) return { ok: false, reset: false, state };
  if (slice.size < state.size) return { ok: true, reset: true, state: freshTimeline() };
  const next = moreTimeline(state, slice.body, slice.end >= slice.size);
  return { ok: true, reset: false, state: { ...next, from: slice.end, size: slice.size } };
}

export const readTimeline = (text) => moreTimeline(freshTimeline(), String(text ?? ""), true).prompts;

const plain = (text) => String(text ?? "").replace(/```[\s\S]*?```/g, " ").replace(/[`*_#>]+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();

export function firstSentence(text) {
  const t = plain(text);
  return SENTENCE.exec(t)?.[1] ?? t;
}

export const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

export function factsOf(p, { working = false, now = Date.now() } = {}) {
  if (working) return [{ text: "working", tone: "working" }, span(now - (p.at ?? now))];
  const end = p.end ?? p.last ?? p.at;
  return [
    end == null ? null : clock(end, now),
    p.ms == null ? (end == null || p.at == null ? null : span(end - p.at)) : span(p.ms),
    p.files.length ? plural(p.files.length, "file", "files") : null,
    p.stopped ? "stopped" : null,
  ].filter(Boolean);
}

export function detailOf(p, { now = Date.now() } = {}) {
  return [
    `#${p.n}`,
    p.at == null ? null : clock(p.at, now),
    p.ms == null ? null : span(p.ms),
    p.files.length ? plural(p.files.length, "file", "files") : null,
    p.commands ? plural(p.commands, "command", "commands") : null,
    p.stopped ? "stopped" : null,
  ].filter(Boolean).join(DOT);
}

export function shortPath(path, folder) {
  const p = String(path ?? "");
  const base = String(folder ?? "").replace(/[\\/]+$/, "");
  return base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
}

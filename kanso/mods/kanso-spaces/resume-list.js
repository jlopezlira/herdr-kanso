import { duration } from "./agents.js";
import { folderName, trimmed } from "./projects.js";
import { parseOr } from "./pure.js";

export const RECENT = 30;
const KINDS = [["claude", /[\\/]\.claude[\\/]/], ["codex", /[\\/]\.codex[\\/]/], ["pi", /[\\/]\.pi[\\/]/]];
const base = (file) => String(file).split(/[\\/]/).at(-1).replace(/\.jsonl$/, "");

export const listedOf = (stdout, machine = null) => String(stdout ?? "").split("\n").flatMap((line) => {
  const [file = "", raw = "", found = ""] = line.split("\t");
  const cwd = parseOr(`"${raw}"`);
  const program = KINDS.find(([, pattern]) => pattern.test(file))?.[0];
  const id = program === "claude" ? base(file) : found;
  return program && cwd && id ? [{ program, file, cwd, id, machine }] : [];
});

export const STARTING = "kanso.resume.starting";
export const STARTING_MS = 30000;
export const keyOf = (c) => `${c?.machine ?? ""}\t${String(c?.id ?? "").toLowerCase()}`;

export const onceEach = (list) => list.filter((c, i) => list.findIndex((d) => keyOf(d) === keyOf(c)) === i);

const writtenSince = (rows, h, taken) => rows.find((c) => c.program === h.program && !taken.has(keyOf(c)) && (c.machine ?? "") === (h.machine ?? "")
  && trimmed(c.cwd ?? "") === trimmed(h.cwd ?? "") && (c.at ?? -Infinity) >= h.since);

export function heldBy(rows, held) {
  const named = new Map(held.filter((h) => h.id).map((h) => [keyOf(h), h]));
  return held.filter((h) => !h.id).reduce((by, h) => {
    const c = writtenSince(rows, h, by);
    return c ? new Map([...by, [keyOf(c), h]]) : by;
  }, named);
}

export const startingNow = (record, now = Date.now()) => Object.fromEntries(Object.entries(record ?? {}).filter(([, at]) => now - at < STARTING_MS));

export const recordsOf = (stdout) => String(stdout ?? "").split("\n\x1c\n");

export const newestFirst = (list) => list.toSorted((a, b) => (b.at ?? 0) - (a.at ?? 0));

export const findsIn = (query) => {
  const q = String(query ?? "").trim().toLowerCase();
  return (c) => !q || [c.title, c.cwd, c.machine].some((s) => String(s ?? "").toLowerCase().includes(q));
};

export const resumeHint = (c, { scoped, now = Date.now() }) => [scoped ? null : folderName(c.cwd), scoped ? null : c.machine, c.at == null ? null : duration(Math.max(0, now - c.at))].filter(Boolean).join(" \u{b7} ");

export const openSpaceAt = (list, folder, machine) => list.find((w) => (w.machine ?? "") === (machine ?? "") && trimmed(w.folder ?? "") === trimmed(folder ?? "")) ?? null;

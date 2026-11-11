import { serviceOn } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { processApi } from "./platform-processes.js";
import { transcriptApi } from "./platform-transcripts.js";
// A Claude agent's conversation on disk: every path it printed, whole. Its screen abbreviates long paths
// ("…/shot.png") and redraws, so what it made a while ago is no longer there; the transcript keeps it.
import { hc, readTextFile } from "herdr";
import { KINDS } from "./kinds.js";
import { isAgent } from "./deliver.js";
import { resolvePath } from "./look-model.js";
import { projectDir, transcriptPath, sessionPath, START_SLACK, sessionLive } from "./find.js";

export { projectDir, transcriptPath, START_SLACK };
export const MOST = 2000; // the latest distinct paths kept from a conversation: a long one names a thousand after a picture
const LONGEST = 100000; // a line longer than this is a pasted picture in base64, never a message: skipped unread
export const PICTURES = "pictures";
export const NAMED = "files";
export const NAMED_CAP = 8;
export const NAMED_PIECE = "files.named";
const FILE_EXT = "[A-Za-z0-9]{1,12}";
const PATH_CHAR = /[A-Za-z0-9@+._~/-]/;
// What was appended since the last look (`$2`, the offset after the last whole line; `$5` the cksum of those
// bytes). A line not finished is left for the next read, so a path cut at the offset is not skipped. A prefix
// that no longer matches, or a shorter file, is read from the start. Prints that offset, where it read from,
// the prefix's cksum, then the last `$4` distinct matches; exit 3 when no new whole line was appended.
const EXT = [...new Set(Object.values(KINDS).flat())].toSorted((a, b) => b.length - a.length).join("|");
// A path up to one of Look's extensions, whole (not "linkedin.c" out of a URL), after something that is not part
// of one. grep prints that something and the character after (a byte each, maybe half of a "…"): sed takes them
// off, and `pathOf` does the same here, in case. Before grep, JSON's "\\n" and "\\"" became spaces and every
// character that is no part of a path was doubled, so paths on escaped lines, or a space or a comma apart, are
// each their own: the delimiter grep takes with one leaves one for the next.
// Files names any extension; Images keeps the picture ones. One scan, the kind picks the pattern.
export function patternFor(kind = PICTURES) {
  return `(^|[^A-Za-z0-9@+._~/-])[A-Za-z0-9@+._~/-]*\\.(${kind === NAMED ? FILE_EXT : EXT})([^A-Za-z0-9]|$)`;
}
export const PATTERN = patternFor(PICTURES);
export const namedShown = (hidden) => !(Array.isArray(hidden) && hidden.includes(NAMED_PIECE));

export function agentAddress(focus, terms, paneList) {
  const address = focus?.terminal;
  if (!address) return null;
  const term = (terms ?? []).find((item) => item.address === address);
  return term && isAgent(term, (paneList ?? []).find((item) => item.terminal === address)) ? address : null;
}

// One match as a path: the delimiters grep printed with it go, and the "\n" a JSON string starts it with
// ("\n./docs/a.md" is "./docs/a.md"); a URL's tail (":" before "//host.com") is no path.
export function pathOf(match) {
  if (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(String(match))) return paths.normalize(String(match).trim());
  const p = String(match).replace(/^(?:\\[nrt])+/, "").replace(/^[^A-Za-z0-9@+._~/-]/, "").replace(/[^A-Za-z0-9]$/, "");
  return p.includes("//") || !p ? null : p;
}

const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };

// The record Claude Code writes per process (~/.claude/sessions/<pid>.json), for the program in front of
// this terminal (`front`); null for another program, a shell, or a record of an earlier process with that pid.
// The program in front of a terminal: its pid and name, or null when the terminal can't be read.
export async function frontOf(address) {
  const got = await hc(["get", address, "--json"]).catch(() => null);
  const front = got?.code === 0 ? parsed(got.stdout)?.foreground : null;
  return front?.pid ? { pid: front.pid, program: paths.basename(String(front.argv?.[0] ?? "")).replace(/\.(?:exe|cmd|bat)$/i, "") } : null;
}

export async function sessionOf(address, homeDir, front = null, on = null) {
  // The record is Claude Code's: another program with a pid Claude had must not read Claude's conversation.
  const pid = front?.program === "claude" ? front.pid : null;
  if (!pid) return null;
  const record = parsed(await readTextFile(sessionPath(homeDir, pid), { on }).catch(() => null));
  if (record?.pid !== pid || !record.sessionId) return null;
  // Nor is a record of an earlier Claude that had this pid: the process must have started when the record says.
  const started = await (await serviceOn(processApi, on)).startTime(pid).catch(() => NaN);
  return sessionLive(record, pid, started) ? record : null;
}

// One transcript file from a stored offset. `code` 3: nothing new and whole. `mark` is the cksum of the bytes read.
export async function scanFile(file, from = "0", mark = "", on = null, kind = PICTURES) {
  const ext = kind === NAMED ? FILE_EXT : EXT;
  const r = await (await serviceOn(transcriptApi, on)).scan(file, from ?? "0", mark ?? "", patternFor(kind), ext, MOST, LONGEST).catch(() => null);
  if (r?.code === 3) return { code: 3, size: String(from ?? "0"), from: String(from ?? "0"), mark: String(mark ?? ""), paths: [] };
  if (!r || r.code !== 0) return { code: r?.code ?? 1, size: null, from: null, mark: "", paths: [] };
  const [size, start, got, ...lines] = String(r.stdout).split("\n");
  return { code: 0, size, from: start, mark: got ?? "", paths: lines.map(pathOf).filter(Boolean) };
}

// The paths a conversation mentions, oldest first, with the program in front, the file and the offset read up to.
// `before` (the last answer) is read on from when it is this file; otherwise `recall` (what was stored) is.
// Comes back as it was while no new whole line was appended. `replaced`: the file shrank or its prefix changed,
// so it was read whole. `failed`: the read did not happen. None without a conversation.
export async function transcriptPaths(address, homeDir, before = null, recall = null, on = null, kind = PICTURES) {
  const front = await frontOf(address);
  const file = transcriptPath(await sessionOf(address, homeDir, front, on), homeDir);
  if (!file) return { front, file: null, size: null, from: null, mark: "", paths: [], rows: [], replaced: false, failed: false };
  const known = before?.file === file ? before : (await recall?.(file)) ?? { paths: [], size: "0", rows: [], mark: "" };
  const r = await scanFile(file, known.size ?? "0", known.mark ?? "", on, kind);
  const rows = known.rows ?? [];
  if (r.code === 3) return { front, file, size: known.size, from: String(known.size ?? "0"), mark: known.mark ?? "", paths: known.paths ?? [], rows, replaced: false, failed: false };
  if (r.code !== 0) return { front, file, size: known.size ?? null, from: null, mark: known.mark ?? "", paths: known.paths ?? [], rows, replaced: false, failed: true };
  // Appended to what was read before (none when the file was read whole again); each once, where it was last said.
  const all = [...(r.from === "0" ? [] : (known.paths ?? [])), ...r.paths];
  const replaced = r.from === "0" && String(known.size ?? "0") !== "0";
  return { front, file, size: r.size, from: r.from, mark: r.mark, paths: [...new Set(all.toReversed())].toReversed().slice(-MOST), rows, replaced, failed: false };
}

const doubled = (text) => [...String(text ?? "").replace(/\\[ntr"]/g, " ")].map((ch) => (PATH_CHAR.test(ch) ? ch : ch + ch)).join("");

// Oldest first, each path once, at its last mention. The same read the shell scan prints.
export function pathsIn(text, kind = PICTURES) {
  const found = [...doubled(text).matchAll(new RegExp(patternFor(kind), "g"))].map((m) => pathOf(m[0])).filter(Boolean);
  const last = found.reduce((acc, path, i) => new Map([...acc, [path, i]]), new Map());
  return [...last.entries()].toSorted((a, b) => a[1] - b[1]).map(([path]) => path).slice(-MOST);
}

// Newest first, inside the project, each once, at most NAMED_CAP. `files` is the ones that exist.
export function namedList(found, { root, cwd, homeDir, files } = {}) {
  const there = new Set(files ?? []);
  const abs = (found ?? []).map((raw) => resolvePath(raw, cwd, homeDir)).filter(Boolean);
  return [...new Set(abs.toReversed())].flatMap((path) => {
    const rel = paths.relative(root, path);
    if (!rel || !there.has(path)) return [];
    const folder = paths.dirname(rel);
    return [{ path: rel, name: paths.basename(rel), folder: folder === "." ? "" : folder }];
  }).slice(0, NAMED_CAP);
}

export const namedIn = (text, opts) => namedList(pathsIn(text, NAMED), opts);

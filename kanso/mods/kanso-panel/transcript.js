// A Claude agent's conversation on disk: every path it printed, whole. Its screen abbreviates long paths
// ("…/shot.png") and redraws, so what it made a while ago is no longer there; the transcript keeps it.
import { exec, hc, readTextFile } from "herdr";
import { KINDS } from "./kinds.js";
import { etimeMs } from "./procs.js";

export const START_SLACK = 120000; // ps counts whole seconds from a start a little before the record was written
export const MOST = 2000; // the latest distinct paths kept from a conversation: a long one names a thousand after a picture
const LONGEST = 100000; // a line longer than this is a pasted picture in base64, never a message: skipped unread
// What was appended since the last look (`$2`, the offset after the last whole line; `$5` the cksum of those
// bytes). A line not finished is left for the next read, so a path cut at the offset is not skipped. A prefix
// that no longer matches, or a shorter file, is read from the start. Prints that offset, where it read from,
// the prefix's cksum, then the last `$4` distinct matches; exit 3 when no new whole line was appended.
const SCAN = `f="$1"; from="$2"; mark="$5"; [ -f "$f" ] || exit 2; s=$(wc -c < "$f" | tr -d " "); reset=0
if [ "$s" -lt "$from" ]; then from=0; reset=1
elif [ "$from" != 0 ]; then
  now=$(head -c "$from" "$f" | cksum | cut -d " " -f 1)
  if [ -z "$mark" ] || [ "$now" != "$mark" ]; then from=0; reset=1; fi
fi
end=$(python3 - "$f" <<'PY'
import sys
fh=open(sys.argv[1],"rb"); fh.seek(0,2); pos=fh.tell(); found=None
while pos>0 and found is None:
    take=min(1048576,pos); pos-=take; fh.seek(pos); i=fh.read(take).rfind(b"\\n")
    if i>=0: found=pos+i+1
fh.close(); sys.stdout.write("0" if found is None else str(found))
PY
) || exit 1
[ "$reset" = 0 ] && [ "$end" = "$from" ] && exit 3
if [ "$end" = 0 ]; then sum=""
else sum=$(head -c "$end" "$f" | cksum | cut -d " " -f 1); fi
echo "$end"; echo "$from"; echo "$sum"
if [ "$end" -gt "$from" ]; then
  LC_ALL=C tail -c "+$((from + 1))" "$f" | head -c "$((end - from))" | LC_ALL=C awk 'length($0) < ${LONGEST}' | LC_ALL=C sed -E 's/\\\\[ntr"]/ /g; s/([^A-Za-z0-9@+._~\\/-])/\\1\\1/g' | LC_ALL=C grep -oE "$3" \\
    | LC_ALL=C sed -E 's/^[^A-Za-z0-9@+._~\\/-]//; s/[^A-Za-z0-9]$//' \\
    | LC_ALL=C awk '{ at[$0] = NR } END { for (m in at) print at[m], m }' | sort -n | tail -n "$4" | cut -d " " -f 2-
fi
exit 0`;
const EXT = [...new Set(Object.values(KINDS).flat())].toSorted((a, b) => b.length - a.length).join("|");
// A path up to one of Look's extensions, whole (not "linkedin.c" out of a URL), after something that is not part
// of one. grep prints that something and the character after (a byte each, maybe half of a "…"): sed takes them
// off, and `pathOf` does the same here, in case. Before grep, JSON's "\\n" and "\\"" became spaces and every
// character that is no part of a path was doubled, so paths on escaped lines, or a space or a comma apart, are
// each their own: the delimiter grep takes with one leaves one for the next.
export const PATTERN = `(^|[^A-Za-z0-9@+._~/-])[A-Za-z0-9@+._~/-]*\\.(${EXT})([^A-Za-z0-9]|$)`;

// Claude Code keeps each conversation under a folder named after its working folder: every character not a
// letter or digit as "-", and a folder over 200 characters cut there with a hash of the whole (Claude Code 2.1).
export function projectDir(cwd) {
  const path = String(cwd ?? "");
  const slug = path.replace(/[^A-Za-z0-9]/g, "-");
  if (slug.length <= 200) return slug;
  const h = Array.from({ length: path.length }, (_, i) => path.charCodeAt(i)).reduce((n, c) => ((n << 5) - n + c) | 0, 0);
  return `${slug.slice(0, 200)}-${Math.abs(h).toString(36)}`;
}
export const transcriptPath = (session, homeDir) =>
  session?.sessionId && session.cwd ? `${homeDir}/.claude/projects/${projectDir(session.cwd)}/${session.sessionId}.jsonl` : null;

// One match as a path: the delimiters grep printed with it go, and the "\n" a JSON string starts it with
// ("\n./docs/a.md" is "./docs/a.md"); a URL's tail (":" before "//host.com") is no path.
export function pathOf(match) {
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
  return front?.pid ? { pid: front.pid, program: String(front.argv?.[0] ?? "").split("/").at(-1) } : null;
}

export async function sessionOf(address, homeDir, front = null) {
  // The record is Claude Code's: another program with a pid Claude had must not read Claude's conversation.
  const pid = front?.program === "claude" ? front.pid : null;
  if (!pid) return null;
  const record = parsed(await readTextFile(`${homeDir}/.claude/sessions/${pid}.json`).catch(() => null));
  if (record?.pid !== pid || !record.sessionId) return null;
  // Nor is a record of an earlier Claude that had this pid: the process must have started when the record says.
  const up = await exec("ps", ["-o", "etime=", "-p", String(pid)]).catch(() => null);
  const started = up?.code === 0 ? Date.now() - etimeMs(up.stdout.trim()) : NaN;
  return Math.abs(started - Number(record.startedAt)) <= START_SLACK ? record : null;
}

// One transcript file from a stored offset. `code` 3: nothing new and whole. `mark` is the cksum of the bytes read.
export async function scanFile(file, from = "0", mark = "") {
  const r = await exec("sh", ["-c", SCAN, "sh", file, String(from ?? "0"), PATTERN, String(MOST), String(mark ?? "")], { timeout: 60000 }).catch(() => null);
  if (r?.code === 3) return { code: 3, size: String(from ?? "0"), from: String(from ?? "0"), mark: String(mark ?? ""), paths: [] };
  if (!r || r.code !== 0) return { code: r?.code ?? 1, size: null, from: null, mark: "", paths: [] };
  const [size, start, got, ...lines] = String(r.stdout).split("\n");
  return { code: 0, size, from: start, mark: got ?? "", paths: lines.map(pathOf).filter(Boolean) };
}

// The paths a conversation mentions, oldest first, with the program in front, the file and the offset read up to.
// `before` (the last answer) is read on from when it is this file; otherwise `recall` (what was stored) is.
// Comes back as it was while no new whole line was appended. `replaced`: the file shrank or its prefix changed,
// so it was read whole. `failed`: the read did not happen. None without a conversation.
export async function transcriptPaths(address, homeDir, before = null, recall = null) {
  const front = await frontOf(address);
  const file = transcriptPath(await sessionOf(address, homeDir, front), homeDir);
  if (!file) return { front, file: null, size: null, from: null, mark: "", paths: [], rows: [], replaced: false, failed: false };
  const known = before?.file === file ? before : (await recall?.(file)) ?? { paths: [], size: "0", rows: [], mark: "" };
  const r = await scanFile(file, known.size ?? "0", known.mark ?? "");
  const rows = known.rows ?? [];
  if (r.code === 3) return { front, file, size: known.size, from: String(known.size ?? "0"), mark: known.mark ?? "", paths: known.paths ?? [], rows, replaced: false, failed: false };
  if (r.code !== 0) return { front, file, size: known.size ?? null, from: null, mark: known.mark ?? "", paths: known.paths ?? [], rows, replaced: false, failed: true };
  // Appended to what was read before (none when the file was read whole again); each once, where it was last said.
  const all = [...(r.from === "0" ? [] : (known.paths ?? [])), ...r.paths];
  const replaced = r.from === "0" && String(known.size ?? "0") !== "0";
  return { front, file, size: r.size, from: r.from, mark: r.mark, paths: [...new Set(all.toReversed())].toReversed().slice(-MOST), rows, replaced, failed: false };
}

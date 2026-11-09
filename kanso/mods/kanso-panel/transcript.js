// A Claude agent's conversation on disk: every path it printed, whole. Its screen abbreviates long paths
// ("…/shot.png") and redraws, so what it made a while ago is no longer there; the transcript keeps it.
import { exec, hc, readTextFile } from "herdr";
import { KINDS } from "./kinds.js";
import { etimeMs } from "./procs.js";

export const START_SLACK = 120000; // ps counts whole seconds from a start a little before the record was written
export const MOST = 2000; // the latest distinct paths kept from a conversation: a long one names a thousand after a picture
const LONGEST = 100000; // a line longer than this is a pasted picture in base64, never a message: skipped unread
// What was appended since the last look (`$2`, the size then; the whole file when it shrank), in bytes, through
// grep, JSON's escaped line breaks and quotes made spaces first: a transcript runs to tens of MB and a regular
// expression in here must never touch it. Prints the size
// now, where it read from, then the last `$4` distinct matches, each where it was last said; exit 3 when nothing
// was appended.
const SCAN = `f="$1"; from="$2"; [ -f "$f" ] || exit 2; s=$(wc -c < "$f" | tr -d " ")
[ "$s" = "$from" ] && exit 3
[ "$s" -lt "$from" ] && from=0
echo "$s"; echo "$from"
LC_ALL=C tail -c "+$((from + 1))" "$f" | LC_ALL=C awk 'length($0) < ${LONGEST}' | LC_ALL=C sed -E 's/\\\\[ntr"]/ /g; s/([^A-Za-z0-9@+._~\\/-])/\\1\\1/g' | LC_ALL=C grep -oE "$3" \\
  | LC_ALL=C sed -E 's/^[^A-Za-z0-9@+._~\\/-]//; s/[^A-Za-z0-9]$//' \\
  | LC_ALL=C awk '{ at[$0] = NR } END { for (m in at) print at[m], m }' | sort -n | tail -n "$4" | cut -d " " -f 2-; exit 0`;
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
// this terminal; null for another program, a shell, or a record of an earlier process with that pid.
export async function sessionOf(address, homeDir) {
  const got = await hc(["get", address, "--json"]).catch(() => null);
  const front = got?.code === 0 ? parsed(got.stdout)?.foreground : null;
  // The record is Claude Code's: another program with a pid Claude had must not read Claude's conversation.
  const pid = front?.pid && /(^|\/)claude$/.test(String(front.argv?.[0] ?? "")) ? front.pid : null;
  if (!pid) return null;
  const record = parsed(await readTextFile(`${homeDir}/.claude/sessions/${pid}.json`).catch(() => null));
  if (record?.pid !== pid || !record.sessionId) return null;
  // Nor is a record of an earlier Claude that had this pid: the process must have started when the record says.
  const up = await exec("ps", ["-o", "etime=", "-p", String(pid)]).catch(() => null);
  const started = up?.code === 0 ? Date.now() - etimeMs(up.stdout.trim()) : NaN;
  return Math.abs(started - Number(record.startedAt)) <= START_SLACK ? record : null;
}

// The paths a conversation mentions, oldest first, with the file and size they were read up to. `before` (the
// last answer) is read on from and comes back as it was while the file has not grown; none without a conversation.
export async function transcriptPaths(address, homeDir, before = null) {
  const file = transcriptPath(await sessionOf(address, homeDir), homeDir);
  if (!file) return { file: null, size: null, paths: [] };
  const known = before?.file === file ? before : { paths: [], size: "0" };
  const r = await exec("sh", ["-c", SCAN, "sh", file, String(known.size ?? "0"), PATTERN, String(MOST)], { timeout: 60000 }).catch(() => null);
  if (r?.code === 3) return { file, size: known.size, paths: known.paths };
  if (r?.code !== 0) return { file, size: null, paths: [] };
  const [size, from, ...lines] = r.stdout.split("\n");
  const fresh = lines.map(pathOf).filter(Boolean);
  // Appended to what was read before (none when the file was read whole again); each once, where it was last said.
  const all = [...(from === "0" ? [] : known.paths), ...fresh];
  return { file, size, paths: [...new Set(all.toReversed())].toReversed().slice(-MOST) };
}

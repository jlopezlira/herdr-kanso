// A Claude agent's conversation on disk: every path it printed, whole. Its screen abbreviates long paths
// ("…/shot.png") and redraws, so what it made a while ago is no longer there; the transcript keeps it.
import { exec, hc, readTextFile } from "herdr";

const TAIL = 256 * 1024; // bytes read from the end: the latest turns, not a day of them

// Claude Code keeps each conversation under a folder named after its working folder.
export const projectDir = (cwd) => String(cwd ?? "").replace(/[^A-Za-z0-9]/g, "-");
export const transcriptPath = (session, homeDir) =>
  session?.sessionId && session.cwd ? `${homeDir}/.claude/projects/${projectDir(session.cwd)}/${session.sessionId}.jsonl` : null;

const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };

// Every string in a value, one per line: what the agent and its tools said, without the JSON around it
// (a whole message in quotes would read as one quoted path with spaces and hide the paths inside it).
const strings = (v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
// The lines of a transcript's end, the first (cut) one left out.
export const spoken = (tail) => String(tail ?? "").split("\n").slice(1).flatMap((line) => strings(parsed(line))).join("\n");

// The record Claude Code writes per process (~/.claude/sessions/<pid>.json), for the program in front of
// this terminal; null for another program, a shell, or a record of an earlier process with that pid.
export async function sessionOf(address, homeDir) {
  const got = await hc(["get", address, "--json"]).catch(() => null);
  const pid = got?.code === 0 ? parsed(got.stdout)?.foreground?.pid : null;
  if (!pid) return null;
  const record = parsed(await readTextFile(`${homeDir}/.claude/sessions/${pid}.json`).catch(() => null));
  return record?.pid === pid && record.sessionId ? record : null;
}

// The end of the conversation, or "" when there is none to read.
export async function transcriptTail(address, homeDir) {
  const file = transcriptPath(await sessionOf(address, homeDir), homeDir);
  if (!file) return "";
  const r = await exec("tail", ["-c", String(TAIL), file]).catch(() => null);
  return r?.code === 0 ? spoken(`\n${r.stdout}`) : "";
}

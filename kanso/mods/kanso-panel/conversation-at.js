import { projectDir } from "./platform-transcripts.js";
import { processApi } from "./platform-processes.js";
import { paths } from "./platform-paths.js";
import { parseOr as parsed } from "./pure.js";

export const START_SLACK = 120000; // ps counts whole seconds from a start a little before the record was written
const NONE = Object.freeze({ kind: null, file: null });
const ID_AT_END = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.jsonl)?$/i;
const PI = /(^|[^a-z])pi($|[^a-z])/;

export const sessionPath = (homeDir, pid) => paths.join(homeDir, ".claude", "sessions", `${pid}.json`);
export const transcriptPath = (session, homeDir) =>
  session?.sessionId && session.cwd && homeDir
    ? paths.join(homeDir, ".claude", "projects", projectDir(session.cwd), `${session.sessionId}.jsonl`)
    : null;

export function sessionLive(record, pid, started) {
  if (!record || record.pid !== pid || !record.sessionId) return false;
  const at = Number(record.startedAt);
  return Number.isFinite(started) && Number.isFinite(at) && Math.abs(started - at) <= START_SLACK;
}

export const agentHint = (agent) => [agent?.app, agent?.program?.key].filter(Boolean).join(" ");
export const idIn = (word) => ID_AT_END.exec(String(word ?? ""))?.[1].toLowerCase() ?? null;
const programOf = (front) => paths.basename(front?.argv?.[0] ?? "").replace(/\.(exe|cmd|bat)$/i, "");
const processesOf = (host) => host.platform?.processes ?? processApi("linux", host.exec);

// The program in front, or Herdr's app name ("claude-code"), says whose conversation this is.
export function kindOf(program, hint = "") {
  const text = `${String(program ?? "").split(/[/\\]/).at(-1)} ${hint}`.toLowerCase();
  if (/(^|[^a-z])codex/.test(text)) return "codex";
  if (/(^|[^a-z])claude/.test(text)) return "claude";
  return null;
}

async function terminalOf(host, address) {
  const got = address ? await host.hc(["get", address, "--json"]).catch(() => null) : null;
  return got?.code === 0 ? parsed(got.stdout) : null;
}

async function conversationOf(host, got, hint) {
  const front = got?.foreground;
  const pid = front?.pid;
  if (!pid) return NONE;
  const kind = kindOf(programOf(front), hint);
  const processes = processesOf(host);
  if (kind === "claude") {
    const record = parsed(await host.readTextFile(sessionPath(host.home(), pid)).catch(() => null));
    const started = record?.sessionId ? await processes.startTime(pid).catch(() => NaN) : NaN;
    if (!sessionLive(record, pid, started)) return NONE;
    const file = transcriptPath(record, host.home());
    return file ? { kind: "claude", file } : NONE;
  }
  if (kind === "codex") {
    const ownFiles = await processes.openFiles([pid]);
    if (ownFiles.state === "unavailable") return { ...NONE, unavailable: ownFiles.reason };
    const table = await processes.list();
    const children = (table.byParent.get(pid) ?? []).map((row) => row.pid);
    const childFiles = children.length ? await processes.openFiles(children) : { values: [] };
    const file = [...ownFiles.values, ...childFiles.values].find((row) => /rollout-.*\.jsonl$/.test(row.path))?.path ?? null;
    return file ? { kind: "codex", file } : NONE;
  }
  return NONE;
}

export const conversationIn = async (host, address, hint = "") => conversationOf(host, await terminalOf(host, address), hint);

export async function heldIn(host, address, hint = "") {
  const got = await terminalOf(host, address);
  const front = got?.foreground;
  if (!front?.pid) return null;
  const words = [got.argv, front.argv].flatMap((argv) => (Array.isArray(argv) ? argv : []));
  const resumed = words.map(idIn).findLast(Boolean) ?? null;
  const program = PI.test(`${programOf(front)} ${hint}`.toLowerCase()) ? "pi" : kindOf(programOf(front), hint);
  const id = (program === "pi" ? null : idIn((await conversationOf(host, got, hint)).file)) ?? resumed;
  if (id) return { id };
  if (program !== "pi" && program !== "codex") return null;
  const since = await processesOf(host).startTime(front.pid).catch(() => NaN);
  const cwd = front.cwd ?? got.cwd ?? null;
  return cwd && Number.isFinite(since) ? { program, cwd, since } : null;
}

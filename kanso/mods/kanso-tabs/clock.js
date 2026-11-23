import { hc } from "herdr";
import { localName } from "./platform-host.js";
import { shellQuote, psQuote } from "./platform-command.js";
import { clockName, resumeWaiter, waiterArgs, scheduleWaiter, CLOCK_LABEL } from "./clock-model.js";
import { limitOf, resumeArmed, commandOf, RESUME_GRACE_MS } from "./limits-model.js";

export const RESUME_KIND = "resume";
export const RESUME_TYPED = "resume-typed";
const quiet = (p) => Promise.resolve(p).catch(() => null);

export async function stopWaiter(name) {
  await quiet(hc(["kill", name]));
  await quiet(hc(["rm", name]));
}

async function startWaiter(name, kind, argv, labels = {}) {
  await stopWaiter(name);
  const r = await hc(waiterArgs(name, kind, argv, labels));
  if (r.code !== 0) throw new Error(String(r.stderr || r.stdout || "hc could not start the clock").trim().split("\n").at(-1));
  return r;
}

export const typedLine = (platform, words) => (platform === "windows" ? `& ${words.map(psQuote).join(" ")}` : words.map(shellQuote).join(" "));

export function armResume({ address, until, command = [] }) {
  const platform = localName();
  const line = command.length ? typedLine(platform, command) : "";
  const argv = resumeWaiter({ platform, address, until, token: String(until), command: line, grace: RESUME_GRACE_MS });
  return startWaiter(clockName(RESUME_KIND, address), line ? RESUME_TYPED : RESUME_KIND, argv);
}

export const disarmResume = (address) => stopWaiter(clockName(RESUME_KIND, address));

const live = (term) => !term?.state || term.state === "live";
export const waitersOf = (terms) => new Map((terms ?? []).filter((t) => live(t) && t.name && t.labels?.[CLOCK_LABEL]).map((t) => [t.name, t.labels[CLOCK_LABEL]]));

export function resumesToArm(terms) {
  const waiters = waitersOf(terms);
  return (terms ?? []).filter((t) => live(t) && resumeArmed(t.labels)).flatMap((t) => {
    const kind = waiters.get(clockName(RESUME_KIND, t.address));
    const command = commandOf(t.labels);
    if (kind === RESUME_TYPED || (kind === RESUME_KIND && !command.length)) return [];
    return [{ address: t.address, until: limitOf(t.labels).until, command }];
  });
}

export async function reconcileResumes(terms) {
  for (const arm of resumesToArm(terms)) await quiet(armResume(arm));
}

export function armSchedule(name, job, labels = {}) {
  return startWaiter(name, "schedule", scheduleWaiter({ ...job, platform: localName() }), labels);
}

import { spaces, terminals, readTextFile, home } from "herdr";
import { platformOf } from "./platform-host.js";
import { copiesToViewer } from "./platform-viewer.js";
import { ADD_WORKTREE } from "./platform-repositories.js";
import { parseOr } from "./pure.js";
import { worktreeBase } from "./kdb.js";
import { keyOfSpace } from "./projects.js";
import { clockName, waiterPlan, agentLaunch, localId, slugOf, lastOutcome, CLOCK_LABEL } from "./clock-model.js";
import { armSchedule, stopWaiter, runLog } from "./clock.js";

export const SCHEDULE_KIND = "schedule";
export const RUN_FAILURES = "kanso.runs.failed";
export const SPACE_LABEL = "kanso.space";
export const REV_LABEL = "kanso.rev";
export const scheduleName = (id) => clockName("sched", id);
export const nowName = (id) => clockName("now", id);

export const scheduleOf = (row) => ({
  id: row.id, project: row.project, agent: row.agent, agentName: row.agent_name ?? row.agent, run: parseOr(row.run, []), prompt: row.prompt,
  when: parseOr(row.when_json, null), tree: Boolean(row.tree), base: row.base ?? "", paused: Boolean(row.paused), created: Number(row.created), updated: Number(row.updated),
});

export const placeOfKey = (key) => {
  const i = String(key).indexOf(":");
  return { machine: String(key).slice(0, i) || null, folder: String(key).slice(i + 1) };
};

export const spaceOf = (s, list, homeDir) => list.find((w) => keyOfSpace(w, homeDir) === s.project)?.id ?? `sp${s.id}`;

export function clockTodo(list, terms, spacesNow, homeDir) {
  const waiters = new Map((terms ?? []).filter((t) => (!t.state || t.state === "live") && t.labels?.[CLOCK_LABEL] === SCHEDULE_KIND).map((t) => [t.name, t.labels]));
  const active = list.filter((s) => !s.paused);
  const names = new Set(active.map((s) => scheduleName(s.id)));
  const arm = active.filter((s) => {
    const labels = waiters.get(scheduleName(s.id));
    return !labels || labels[SPACE_LABEL] !== localId(spaceOf(s, spacesNow, homeDir)) || labels[REV_LABEL] !== String(s.updated);
  });
  return { arm, stop: [...waiters.keys()].filter((name) => !names.has(name)) };
}

async function argvFor(s, machine) {
  const platform = await platformOf(machine);
  return agentLaunch(platform, copiesToViewer(platform)(s.run), s.prompt);
}

async function start(name, s, plan, homeDir) {
  const { machine, folder } = placeOfKey(s.project);
  const space = spaceOf(s, spaces(), homeDir);
  const job = { id: s.id, ...plan, on: machine, folder, space, tree: s.tree, from: s.base, dir: worktreeBase(machine), slug: slugOf(s.prompt), add: ADD_WORKTREE, argv: await argvFor(s, machine) };
  return armSchedule(name, job, { [SPACE_LABEL]: localId(space), [REV_LABEL]: String(s.updated) });
}

export async function armFor(s, { now = Date.now(), lastRun = null, homeDir = home() } = {}) {
  const plan = s.paused ? null : waiterPlan(s.when, { now, since: Math.max(s.updated, lastRun ?? 0) });
  return plan ? start(scheduleName(s.id), s, plan, homeDir) : null;
}

export const runNow = (s, { now = Date.now(), homeDir = home() } = {}) => start(nowName(s.id), s, { mode: "at", spec: String(Math.floor(now / 1000)) }, homeDir);

export const outcomeOf = async (id) => lastOutcome(await readTextFile(runLog(id)).catch(() => null));

export async function reconcileSchedules(db, homeDir = home()) {
  const list = (await db.schedules()).map(scheduleOf);
  const outcomes = new Map(await Promise.all(list.map(async (s) => [s.id, await outcomeOf(s.id)])));
  const { arm, stop } = clockTodo(list, terminals(), spaces(), homeDir);
  for (const name of stop) await stopWaiter(name);
  for (const s of arm) await armFor(s, { lastRun: outcomes.get(s.id).lastRun, homeDir }).catch(() => null);
  return list.flatMap((s) => (outcomes.get(s.id).failed ? [{ s, failed: outcomes.get(s.id).failed }] : []));
}

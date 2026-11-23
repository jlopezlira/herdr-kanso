import { spaces, terminals, home } from "herdr";
import { platformOf } from "./platform-host.js";
import { copiesToViewer } from "./platform-viewer.js";
import { ADD_WORKTREE } from "./platform-repositories.js";
import { parseOr } from "./pure.js";
import { worktreeBase } from "./kdb.js";
import { keyOfSpace } from "./projects.js";
import { clockName, waiterPlan, agentLaunch, localId, slugOf, outcomesOf, NO_RUNS, CLOCK_LABEL } from "./clock-model.js";
import { armSchedule, stopWaiter } from "./clock.js";

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

async function start(db, name, s, plan, homeDir) {
  const { machine, folder } = placeOfKey(s.project);
  const space = spaceOf(s, spaces(), homeDir);
  const job = { id: s.id, db: db.file, ...plan, on: machine, folder, space, tree: s.tree, from: s.base, dir: worktreeBase(machine), slug: slugOf(s.prompt), add: ADD_WORKTREE, argv: await argvFor(s, machine) };
  return armSchedule(name, job, { [SPACE_LABEL]: localId(space), [REV_LABEL]: String(s.updated) });
}

export async function armFor(db, s, { now = Date.now(), lastTry = null, homeDir = home() } = {}) {
  const plan = s.paused ? null : waiterPlan(s.when, { now, since: Math.max(s.updated, lastTry ?? 0) });
  return plan ? start(db, scheduleName(s.id), s, plan, homeDir) : null;
}

export const runNow = (db, s, { now = Date.now(), homeDir = home() } = {}) => start(db, nowName(s.id), s, { mode: "at", spec: String(Math.floor(now / 1000)) }, homeDir);

export const runOutcomes = async (db) => outcomesOf(await db.scheduleRuns());
export const outcomeIn = (outcomes, id) => outcomes.get(id) ?? NO_RUNS;

export async function reconcileSchedules(db, homeDir = home()) {
  const list = (await db.schedules()).map(scheduleOf);
  const outcomes = await runOutcomes(db);
  const { arm, stop } = clockTodo(list, terminals(), spaces(), homeDir);
  for (const name of stop) await stopWaiter(name);
  for (const s of arm) await armFor(db, s, { lastTry: outcomeIn(outcomes, s.id).lastTry, homeDir }).catch(() => null);
  return list.flatMap((s) => (outcomeIn(outcomes, s.id).failed ? [{ s, failed: outcomeIn(outcomes, s.id).failed }] : []));
}

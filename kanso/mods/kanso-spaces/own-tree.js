import { panes, agents, exec } from "herdr";
import { paths } from "./platform-paths.js";
import { addWorktree } from "./projects.js";
import { worktreeBase } from "./kdb.js";
import { treeBranch } from "./several.js";

const two = (n) => String(n).padStart(2, "0");
const stamp = (now) => { const d = new Date(now); return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`; };
const TRIES = 5;
export const machineOf = (address) => (String(address ?? "").includes("/") ? String(address).split("/")[0] : "");
export const cwdIn = (shown) => (a) => a.cwd ?? shown.find((p) => p.terminal === a.address)?.cwd ?? null;

export async function rootOf(folder, machine) {
  const r = await exec("git", ["-C", folder, "rev-parse", "--show-toplevel"], machine ? { on: machine } : {}).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() : "";
}

export async function prefixOf(folder, machine) {
  const r = await exec("git", ["-C", folder, "rev-parse", "--show-prefix"], machine ? { on: machine } : {}).catch(() => null);
  return r?.code === 0 ? r.stdout.trim().replace(/\/$/, "") : "";
}

export async function workingIn(root, machine, { list = agents(), shown = panes(), rootFor = rootOf } = {}) {
  const cwdOf = cwdIn(shown);
  const here = list.filter((a) => a.program?.agent && machineOf(a.address) === (machine ?? "") && cwdOf(a));
  const roots = await Promise.all(here.map((a) => rootFor(cwdOf(a), machine || null)));
  return here.filter((_a, i) => roots[i] && paths.equal(paths.canonical(roots[i]), paths.canonical(root)));
}

async function madeTree(place, machine, name, tries = 1) {
  const branch = tries > 1 ? `${name}-${tries}` : name;
  const made = await addWorktree({ folder: place.folder, machine, branch, base: worktreeBase(machine) });
  const taken = !made.error ? !made.made : /already exists|already checked out|already used/i.test(made.error);
  if (!taken) return made.error ? { error: made.error } : { path: made.path, branch };
  return tries < TRIES ? madeTree(place, machine, name, tries + 1) : { error: made.error || `${branch} already has a worktree at ${made.path}` };
}

export async function ownTree(place, agent, now = Date.now(), { rootFor = rootOf, prefixFor = prefixOf, list, shown } = {}) {
  if (!place.folder || !agent) return null;
  const machine = place.machine || null;
  const root = await rootFor(place.folder, machine);
  if (!root) return null;
  const busy = await workingIn(root, place.machine, { rootFor, ...(list ? { list } : {}), ...(shown ? { shown } : {}) });
  if (!busy.length) return null;
  const made = await madeTree(place, machine, treeBranch(stamp(now), agent.key));
  if (made.error) return { error: made.error, busy };
  const inside = await prefixFor(place.folder, machine);
  return { path: inside ? paths.join(made.path, inside) : made.path, branch: made.branch, busy };
}

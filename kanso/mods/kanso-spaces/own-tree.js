import { panes, agents } from "herdr";
import { paths } from "./platform-paths.js";
import { worktreesOf, addWorktree } from "./projects.js";
import { worktreeBase } from "./kdb.js";
import { treeBranch } from "./several.js";

const two = (n) => String(n).padStart(2, "0");
const stamp = (now) => { const d = new Date(now); return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`; };
export const machineOf = (address) => (String(address ?? "").includes("/") ? String(address).split("/")[0] : "");
export const cwdIn = (shown) => (a) => a.cwd ?? shown.find((p) => p.terminal === a.address)?.cwd ?? null;

export function workingIn(folder, machine, { list = agents(), shown = panes(), trees = [] } = {}) {
  const nested = trees.filter((t) => !paths.equal(paths.canonical(t.path), paths.canonical(folder)) && paths.within(paths.canonical(t.path), paths.canonical(folder))).map((t) => t.path);
  const cwdOf = cwdIn(shown);
  const real = (value) => paths.canonical(value);
  return list.filter((a) => a.program?.agent && machineOf(a.address) === (machine ?? "")).filter((a) => {
    const cwd = cwdOf(a);
    return Boolean(cwd) && paths.within(real(cwd), real(folder)) && !nested.some((tree) => paths.within(real(cwd), real(tree)));
  });
}

export async function ownTree(place, agent, now = Date.now()) {
  if (!place.folder || !agent) return null;
  const machine = place.machine || null;
  const trees = await worktreesOf(place.folder, machine);
  if (!trees.length) return null;
  const busy = workingIn(place.folder, place.machine, { trees });
  if (!busy.length) return null;
  const branch = treeBranch(stamp(now), agent.key);
  const made = await addWorktree({ folder: place.folder, machine, branch, base: worktreeBase(machine) });
  if (made.error) return { error: made.error, busy };
  return made.made ? { path: made.path, branch, busy } : { error: `${branch} already has a worktree at ${made.path}`, busy };
}

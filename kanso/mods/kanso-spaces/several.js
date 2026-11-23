import { hc, spaces } from "herdr";
import { platformOf } from "./platform-host.js";
import { viewerFor } from "./platform-viewer.js";
import { addWorktree } from "./projects.js";
import { worktreeBase, newId } from "./kdb.js";
import { runArgs, agentLaunch } from "./clock-model.js";

export const treeBranch = (task, key) => `${String(task).trim().replace(/\s+/g, "-").replace(/[~^:?*[\\\]]+|\.\.|@\{/g, "")}-${key}`;
const lastLine = (text) => String(text ?? "").trim().split("\n").filter(Boolean).at(-1) || "hc could not start it.";

export async function severalRun(place) {
  const machine = place.machine || null;
  const platform = await platformOf(machine);
  return { place, machine, platform, viewed: await viewerFor(machine), space: place.space ?? `sp${newId()}`, tab: `tb${newId()}` };
}

async function startOne(run, agent, { task, from, prompt }) {
  const { place, machine, platform, viewed, space, tab } = run;
  const branch = treeBranch(task, agent.key);
  const launch = agentLaunch(platform, viewed(agent.run), prompt);
  const made = await addWorktree({ folder: place.folder, machine, branch, base: worktreeBase(machine), from });
  if (made.error) return { agent, error: made.error };
  if (!made.made) return { agent, error: `${branch} already has a worktree at ${made.path}. Name the task another way.` };
  const out = await hc([...runArgs({ cwd: made.path, space, on: machine, name: agent.name, tab }), ...launch]);
  return out.code === 0 ? { agent } : { agent, error: lastLine(out.stderr || out.stdout) };
}

export const startInTree = (run, agent, ask) => startOne(run, agent, ask).catch((e) => ({ agent, error: lastLine(e?.message ?? e) }));

export const shownTab = (run) => {
  const id = run.machine ? `${run.machine}/${run.tab}` : run.tab;
  const w = spaces().find((s) => (s.tabs ?? []).some((t) => t.id === id));
  return w ? { space: w.id, tab: id } : null;
};

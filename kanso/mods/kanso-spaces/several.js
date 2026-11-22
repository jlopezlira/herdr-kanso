import { hc, spaces } from "herdr";
import { serviceFor, localName } from "./platform-host.js";
import { viewerFor } from "./platform-viewer.js";
import { addWorktree } from "./projects.js";
import { worktreeBase, newId } from "./kdb.js";
import { runArgs, agentLaunch } from "./clock-model.js";

export const treeBranch = (task, key) => `${String(task).trim().replace(/\s+/g, "-").replace(/[~^:?*[\\\]]+|\.\.|@\{/g, "")}-${key}`;
const lastLine = (text) => String(text ?? "").trim().split("\n").filter(Boolean).at(-1) || "hc could not start it.";

export async function severalRun(place) {
  const machine = place.machine || null;
  const platform = machine ? await serviceFor((p) => p, machine).catch(() => "linux") : localName();
  return { place, machine, platform, viewed: await viewerFor(machine), space: place.space ?? `sp${newId()}`, tab: `tb${newId()}` };
}

export async function startInTree(run, agent, { task, from, prompt }) {
  const { place, machine, platform, viewed, space, tab } = run;
  const made = await addWorktree({ folder: place.folder, machine, branch: treeBranch(task, agent.key), base: worktreeBase(machine), from });
  if (made.error) return { agent, error: made.error };
  const args = [...runArgs({ cwd: made.path, space, on: machine, name: agent.name, tab }), ...agentLaunch(platform, viewed(agent.run), prompt)];
  const out = await hc(args).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
  return out.code === 0 ? { agent } : { agent, error: lastLine(out.stderr || out.stdout) };
}

export const shownTab = (run) => {
  const id = run.machine ? `${run.machine}/${run.tab}` : run.tab;
  const w = spaces().find((s) => (s.tabs ?? []).some((t) => t.id === id));
  return w ? { space: w.id, tab: id } : null;
};

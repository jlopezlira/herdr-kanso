import { exec, appHome, agents } from "herdr";
import { paths } from "./platform-paths.js";
import { deliver } from "./deliver.js";

export const TODO_SCRIPT = ["kanso-panel", "kanso-todo"];
const here = (address) => !/^[^/]+\//.test(String(address ?? ""));

export const runTodo = (verb) => exec("sh", [paths.join(appHome(), "mods", ...TODO_SCRIPT), verb], { timeout: 120_000 })
  .catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));

export const todoOn = async () => {
  const r = await runTodo("status");
  return r.code === 0 ? r.stdout.trim().split("\n").at(-1) === "on" : null;
};

export async function tellAgents(timer) {
  const rule = await runTodo("rule");
  if (rule.code !== 0 || !rule.stdout.trim()) return 0;
  const told = agents().filter((a) => here(a.address) && a.status !== "blocked");
  const sent = await Promise.all(told.map((a) => deliver(timer, a.address, rule.stdout.trim(), "kansō").catch(() => ({ code: 1 }))));
  return sent.filter((s) => s.code === 0).length;
}

export const toldWords = (n) => (n ? `Told ${n} running ${n === 1 ? "agent" : "agents"}; new conversations read it when they start.` : "New conversations read it when they start.");

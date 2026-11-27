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
  if (rule.code !== 0 || !rule.stdout.trim()) return { tried: 0, sent: 0, unsure: 0, waiting: 0, failed: true };
  const local = agents().filter((a) => here(a.address));
  const told = local.filter((a) => a.status !== "blocked");
  const waiting = local.length - told.length;
  const sent = await Promise.all(told.map((a) => deliver(timer, a.address, rule.stdout.trim(), "kansō").catch(() => ({ code: 1 }))));
  return { tried: told.length, sent: sent.filter((s) => s.code === 0).length, unsure: sent.filter((s) => s.code !== 0 && s.unconfirmed).length, waiting, failed: false };
}

const agentsWord = (n) => (n === 1 ? "agent" : "agents");

export function toldWords({ tried = 0, sent = 0, unsure = 0, waiting = 0, failed = false } = {}, installed = true) {
  if (failed) return "The rule could not be read, so no agent was told.";
  const later = installed ? " New conversations read it when they start." : "";
  const held = waiting ? ` ${waiting} ${waiting === 1 ? "is" : "are"} waiting on ${waiting === 1 ? "its" : "their"} own question; answer, then tell agents again.` : "";
  if (!tried) return waiting ? `No agent was told.${held}${later}` : `No agent is running here now.${later}`;
  const refused = tried - sent - unsure;
  const parts = [
    sent === tried ? `Told ${sent} running ${agentsWord(sent)}.` : `Told ${sent} of ${tried} running agents.`,
    unsure ? `${unsure} did not answer; look at ${unsure === 1 ? "it" : "them"} before telling again.` : "",
    refused ? `${refused} could not be reached.` : "",
  ];
  return parts.filter(Boolean).join(" ") + held + later;
}

// Apache-2.0.
// The agent Explain starts: the first installed one, and the tab it opens, or why none could.
import { run, notify, knownAgents } from "herdr";

export const findExplainer = async () => (await knownAgents({ on: null }).catch(() => [])).find((agent) => agent.installed) ?? null;

export const explainWith = (explainer, tab) => {
  if (!explainer) { notify({ title: "Could not start the agent", body: "no agent is installed", level: "error" }); return; }
  run("tab.new", { ...tab, argv: explainer.run });
};

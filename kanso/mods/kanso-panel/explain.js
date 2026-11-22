// Apache-2.0.
import { run, notify, knownAgents } from "herdr";
import { viewerFor } from "./platform-viewer.js";

export const findExplainer = async () => (await knownAgents({ on: null }).catch(() => [])).find((agent) => agent.installed) ?? null;

export const explainWith = async (explainer, tab) => {
  if (!explainer) { notify({ title: "Could not start the agent", body: "no agent is installed", level: "error" }); return; }
  run("tab.new", { ...tab, argv: (await viewerFor(null))(explainer.run) });
};

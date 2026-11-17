import { run } from "herdr";
import { commitLayout } from "./layout.js";
import { gitControls, gitTask, pullKey } from "./sidebar-rows.js";

export function openAhead(space) {
  if (!space?.id) return;
  if (!space.active) run("space.select", { id: space.id });
  commitLayout({ panel: { id: "pr", type: "block", content: { mod: "kanso-panel", props: { panel: "pr" } } } });
}

// What ↑ and ↓ are, named: the project row draws each as a press, ↑ opening the pull request panel, ↓ pulling.
export const AHEAD = "Commits not on GitHub";
const PRESSES = { ahead: AHEAD, behind: "Pull" };

// The project row's git words: its repository when the name differs, its branch or a detached commit, and ↑↓ as presses; `pending` while a pull runs.
export function gitFacts(g, tree, name, place, pulling) {
  const folder = place?.cwd ?? "";
  const on = place?.on ?? null;
  const controls = gitControls(g, { folder, on, pulling: pulling === pullKey(folder, on) });
  const { repo, branch, commit } = gitTask(g, name, tree);
  return {
    folder: repo || null, branch: branch || commit || null,
    sync: controls.map((control) => ({ text: control.label, tip: control.tip, label: PRESSES[control.kind] })),
    pending: controls.some((control) => control.pulling),
  };
}

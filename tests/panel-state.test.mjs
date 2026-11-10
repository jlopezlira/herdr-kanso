// A project's open panel, and what that panel was showing, comes back with the project.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { load, clone, temporary, exec } from "./helpers.mjs";

const enabled = ["files", "pr", "shipped", "worktrees", "ports", "look", "containers", "insights", "memory"];
const exists = (path) => path === "/a/README.md";

test("switching project A to B to A restores A's panel and its state", async () => {
  const { projectOpen, fileMemory, OPEN } = await load("kanso-panel/panel-state.js", ["projectOpen", "fileMemory", "OPEN"]);
  const rows = new Map();
  const put = (project, panel, state) => rows.set(`${project}\0${panel}`, state);
  const get = (project, panel) => rows.get(`${project}\0${panel}`);
  put("A", OPEN, { id: "preview" });
  put("A", "preview", { path: "/a/README.md", back: "files", on: null });
  const leave = projectOpen({ record: get("B", OPEN), legacy: undefined, enabled, now: "preview", first: false });
  assert.equal(leave.mount, null, "B has nothing open, so the panel closes");
  const back = projectOpen({ record: get("A", OPEN), legacy: undefined, enabled, now: null, first: false });
  assert.equal(back.mount, "preview");
  assert.deepEqual(clone(fileMemory(get("A", "preview"), exists)), { path: "/a/README.md", back: "files", on: null });
});

test("a restart reads the same panel and state back from the database", async (t) => {
  const dir = await temporary(t);
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec, appHome: () => dir });
  const { projectOpen, fileMemory, OPEN } = await load("kanso-panel/panel-state.js", ["projectOpen", "fileMemory", "OPEN"]);
  const first = new Kdb(join(dir, "kanso"));
  await first.savePanelState("A", OPEN, { id: "preview" });
  await first.savePanelState("A", "preview", { path: "/a/README.md", back: "files", on: null });
  await first.savePanelState("B", OPEN, { id: null });
  const again = new Kdb(join(dir, "kanso"));
  const back = projectOpen({ record: await again.panelState("A", OPEN), legacy: undefined, enabled, now: null, first: false });
  assert.equal(back.mount, "preview");
  assert.deepEqual(clone(fileMemory(await again.panelState("A", "preview"), exists)), { path: "/a/README.md", back: "files", on: null });
  assert.equal(projectOpen({ record: await again.panelState("B", OPEN), legacy: undefined, enabled, now: "files", first: false }).mount, null);
});

test("a missing file or a closed pull request falls back to empty", async () => {
  const { fileMemory, filesMemory, prMemory, lookMemory } = await load("kanso-panel/panel-state.js", ["fileMemory", "filesMemory", "prMemory", "lookMemory"]);
  assert.equal(fileMemory({ path: "/gone.md", back: "files", on: null }, () => false), null);
  assert.deepEqual(clone(filesMemory({ cwd: "/p", folders: ["docs"], file: "docs/gone.md" }, "/p", () => false)), { cwd: "/p", folders: ["docs"], file: null });
  assert.equal(prMemory({ url: "https://github.com/a/b/pull/3" }, () => "closed"), null);
  assert.equal(prMemory({ url: "https://github.com/a/b/pull/3" }, () => "missing"), null);
  assert.equal(lookMemory({ path: "/gone.png" }, () => false), null);
});

test("a project with nothing open stays closed", async () => {
  const { projectOpen } = await load("kanso-panel/panel-state.js", ["projectOpen"]);
  assert.equal(projectOpen({ record: undefined, legacy: undefined, enabled, now: "files", first: false }).mount, null);
  assert.equal(projectOpen({ record: { id: null }, legacy: "pr", enabled, now: "pr", first: false }).mount, null);
  assert.equal(projectOpen({ record: undefined, legacy: undefined, enabled, now: "preview", first: true }).adopt, true, "the first project keeps whatever the layout already shows");
});

test("the same two hooks save and restore whatever a panel declares", async () => {
  const { takeState, giveState } = await load("kanso-panel/panel-state.js", ["takeState", "giveState"]);
  const panel = {
    path: "/a/README.md", back: "files",
    saveState() { return { path: this.path, back: this.back }; },
    restoreState(state) { this.path = state.path; this.back = state.back; },
  };
  const saved = takeState(panel);
  panel.path = "";
  assert.equal(await giveState(panel, saved), true);
  assert.equal(panel.path, "/a/README.md");
  assert.equal(takeState({}), undefined, "a panel with no hooks keeps nothing of its own");
  assert.equal(await giveState({}, saved), false);
});

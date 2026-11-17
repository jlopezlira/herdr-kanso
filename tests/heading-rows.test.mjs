// The sidebar's project, computer, section and asleep rows: the Storybook's compositions, copied as they are and drawn by the app kit.
import test from "node:test";
import assert from "node:assert/strict";
import { load, nodes, texts, tipsOf, themed, KIT_NIGHT, drawingHost, drawn, clone, repoText, sameCopies } from "./helpers.mjs";
import { loadSidebar, mountedState, recorder } from "./sidebar-fixtures.mjs";

const FILES = ["project-row", "computer-row", "section", "asleep"];
const read = repoText;
const compositions = async () => themed({
  ...await load("kanso-spaces/project-row.js", ["projectRow"], drawingHost()),
  ...await load("kanso-spaces/computer-row.js", ["computerRow", "computerTools"], drawingHost()),
  ...await load("kanso-spaces/section.js", ["section"], drawingHost()),
  ...await load("kanso-spaces/asleep.js", ["asleep"], drawingHost()),
  ...await load("kanso-panel/ui.js", ["tokens"], drawingHost()),
  kit: await load("kanso-panel/kit.js", ["row", "list", "phrase"], drawingHost()),
}, KIT_NIGHT);
const cx = { stop_propagation() {}, notify() {}, timer: { after() {} } };

test("The sidebar's copies of the project, computer, section and asleep rows are the Storybook's, byte for byte", () => {
  sameCopies(FILES);
});

test("Each composition is the kit row with its own props: the app draws what a hand-made kit row with those props draws", async () => {
  const { projectRow, computerRow, section, asleep, kit, c } = await compositions();
  const same = (piece, props) => assert.deepEqual(drawn(piece("r", c)), drawn(kit.row(props)("r", c)));
  same(section({ title: "Needs you", status: "blocked" }), { name: "Needs you", heading: true, mark: "blocked", meta: null, hover: false, focus: false, actions: [] });
  same(computerRow({ name: "dark", state: "unreachable" }), { icon: "lu-server", name: "dark", heading: true, hover: false, focus: false, pending: false, mark: "none",
    meta: { text: "Unreachable", tip: null }, action: { kind: "icon", icon: "lu-refresh-cw", label: "Refresh" }, actions: [] });
  const [head, ...rows] = asleep({ names: ["site", "dojo"], open: true });
  assert.equal(rows.length, 2, "open, a row per sleeper under the heading");
  assert.deepEqual(texts(head("h", c)).filter((text) => text === "2"), [], "open, the heading drops its count");
  assert.deepEqual(asleep({ names: ["site", "dojo"] }).length, 1, "folded, the heading alone");
  assert.equal(kit.phrase("New agent in", "kansō"), "New agent in kansō");
  assert.deepEqual(clone(kit.list(null, [1, [2, false]], undefined, 3)), [1, 2, 3]);
  const worktree = projectRow({ name: "fix", tree: "end", dimmed: true })("w", c);
  assert.ok(nodes(worktree).some((kid) => kid.calls.some((call) => call[0] === "svg" && call[1].endsWith("git-branch.svg"))), "a worktree leads with its branch");
});

test("A computer row shows its Storybook state: Turn on when off, Refresh when unreachable, Sign in for a login, and its tools only when on", async () => {
  const { computerRow, c } = await compositions();
  const shown = (props) => tipsOf(computerRow({ name: "dark", ...props })("m", c));
  assert.deepEqual(shown({ state: "off" }), ["Turn dark on"]);
  assert.deepEqual(shown({ state: "unreachable", tip: "ssh timed out" }), ["ssh timed out", "Refresh"]);
  assert.deepEqual(shown({ state: "login" }), ["Sign in"]);
  assert.deepEqual(shown({ state: "on" }), [], "on, at rest: nothing but its name");
  assert.deepEqual(shown({ state: "on", hover: true }), ["Turn off", "New project on dark", "Sync"]);
  assert.deepEqual(shown({ state: "on", sync: "Sync dark: synced 2 min ago" }), ["Sync dark: synced 2 min ago"], "Sync on stays out");
  assert.deepEqual(shown({ state: "on", hover: true, pending: true }), [], "turning on, its tools wait");
  assert.deepEqual(tipsOf(computerRow({ name: "This computer", remote: false, hover: true })("m", c)), ["New project on This computer"], "this computer: + alone");
});

test("A computer row says which tools it shows, the keyboard's stops, and rings the one the keyboard is on", async () => {
  const { computerRow, computerTools, c } = await compositions();
  const stops = (props) => clone(computerTools({ name: "dark", ...props }).map((tool) => tool.icon));
  assert.deepEqual(stops({ state: "off" }), ["lu-power"]);
  assert.deepEqual(stops({ state: "unreachable", hover: true }), ["lu-refresh-cw"]);
  assert.deepEqual(stops({ state: "login", focus: true }), ["lu-key"]);
  assert.deepEqual(stops({ state: "on" }), [], "on, at rest: none");
  assert.deepEqual(stops({ state: "on", focus: true }), ["lu-power", "lu-plus", "lu-arrow-right-left"], "the keyboard on it: each tool, in screen order");
  assert.deepEqual(stops({ state: "on", sync: "Sync dark" }), ["lu-arrow-right-left"], "Sync on stays out");
  assert.deepEqual(stops({ state: "on", hover: true, sync: "Sync dark" }), ["lu-power", "lu-plus", "lu-arrow-right-left"], "and comes last");
  assert.deepEqual(stops({ state: "on", hover: true, pending: true }), [], "turning on, its tools wait");
  assert.deepEqual(stops({ state: "on", hover: true, remote: false }), ["lu-plus"], "this computer: + alone");
  const ringed = (props) => nodes(computerRow({ name: "dark", hover: true, ...props })("m", c)).filter((kid) => kid.calls.some((call) => call[0] === "border_color" && call[1] === c.accent)).map((kid) => kid.tag);
  assert.deepEqual(ringed({ lit: "lu-plus" }), ["m-tool-1"], "the keyboard on +");
  assert.deepEqual(ringed({ state: "login", lit: "lu-key" }), ["m-action"], "the keyboard on Sign in");
  assert.deepEqual(ringed({}), [], "no ring without the keyboard");
});

test("A detail fact with a label is a press wired by that label; the kit refuses a handler with no tool", async () => {
  const { projectRow, c } = await compositions();
  const hits = [];
  const el = projectRow({ name: "app", branch: "main", sync: [{ text: "↑2", tip: "2 commits not on GitHub", label: "Ahead" }, { text: "↓3", tip: "Pull 3", label: "Pull" }] })("space-app", c, {
    on: { Ahead: () => hits.push("ahead"), Pull: () => hits.push("pull") },
  });
  for (const id of ["space-app-detail-1", "space-app-detail-2"]) nodes(el).find((kid) => kid.tag === id).calls.find((call) => call[0] === "on_click").at(-1)({}, cx);
  assert.deepEqual(hits, ["ahead", "pull"]);
  assert.deepEqual(tipsOf(el).filter((tip) => tip.startsWith("Pull") || tip.includes("GitHub")), ["2 commits not on GitHub", "Pull 3"]);
  assert.throws(() => projectRow({ name: "app" })("space-app", c, { on: { Pull: () => {} } }), /has no tool Pull/);
});

async function sidebar(state = {}) {
  const ran = [], overlays = [];
  const drawnNow = recorder();
  const spaces = state.spaces ?? [{ id: "sp1", name: "app", folder: "/work/app", machine: null, active: true, tabs: [{ id: "tab1" }] }];
  const { Spaces } = await loadSidebar(drawnNow.host, {
    spaces: () => spaces, agents: () => state.agents ?? [], terminals: () => [], machines: () => [{ name: null, layout: "ready" }],
    shared: () => null, run: (cmd, args) => ran.push([cmd, clone(args ?? null)]), openOverlay: (o) => overlays.push(clone(o.props)),
    window: () => ({ platform: "macos", active: true }),
  });
  const view = Object.assign(new Spaces(), mountedState({ shown: new Set(spaces.map((s) => s.id)), view: state.view ?? "spaces", hoverSpace: state.hoverSpace ?? null, ...state.own }));
  view.render();
  return { view, ran, overlays, ...drawnNow };
}

test("A project row still opens, folds, renames, opens its menu, starts an agent and pulls, from the composition's handlers", async () => {
  const git = { [JSON.stringify([null, "/work/app"])]: { name: "herdr-kanso", branch: "main", ahead: 0, behind: 3, upstream: "origin/main" } };
  const d = await sidebar({ hoverSpace: "sp1", spaces: [{ id: "sp1", name: "app", folder: "/work/app", machine: null, active: false, tabs: [] }], own: { git } });
  const pulls = [];
  d.view.pull = (place) => pulls.push(place.cwd);
  d.handlers["on_click:space-sp1-detail-2"]({}, cx);
  assert.deepEqual(pulls, ["/work/app"], "↓ pulls in its folder");
  d.handlers["on_click:space-sp1-tool-0"]({}, cx);
  assert.equal(d.overlays.at(-1).newAgent.folder, "/work/app", "+ asks which agent there");
  d.handlers["on_click:space-sp1-tool-1"]({}, cx);
  assert.deepEqual(d.overlays.at(-1), { spaceMenu: { id: "sp1" } }, "⋯ opens its menu");
  d.handlers["on_mouse_down:right:space-sp1"]({}, cx);
  assert.deepEqual(d.overlays.at(-1), { spaceMenu: { id: "sp1" } }, "and so does a right click");
  d.handlers["on_mouse_down:left:space-sp1"]({ click_count: 1 }, cx);
  d.handlers["on_mouse_up:left:space-sp1"]({}, cx);
  assert.deepEqual(d.ran.at(-1), ["space.select", { id: "sp1" }], "a press goes to it");
  d.handlers["on_mouse_down:left:space-sp1"]({ click_count: 2 }, cx);
  assert.deepEqual(d.ran.at(-1), ["space.rename", { id: "sp1" }], "two rename it");
  d.handlers["on_mouse_up:left:space-sp1"]({}, cx);
  d.handlers["on_mouse_up:left:space-sp1"]({}, cx);
  assert.equal(d.ran.filter(([cmd]) => cmd === "space.select").length, 2, "a release with no press on the row (a tool's) opens nothing");
});

test("A section folds on a press, and a project's conversations offer + under the pointer", async () => {
  const { section, c } = await compositions();
  const added = [];
  const head = section({ title: "app", add: "New conversation in app", hover: true })("thread-app", c, { on: { plus: () => added.push("plus") } });
  assert.deepEqual(tipsOf(head), ["New conversation in app"]);
  nodes(head).find((kid) => kid.tag === "thread-app-tool-0").calls.find((call) => call[0] === "on_click").at(-1)({}, cx);
  assert.deepEqual(added, ["plus"]);
  assert.deepEqual(tipsOf(section({ title: "app", add: "New conversation in app" })("thread-app", c, { on: { plus: () => {} } })), [], "at rest, no +");
  const agents = [{ address: "t1", pane: "p1", tab: "tab1", space: "sp1", space_name: "app", status: "idle", program: { agent: true }, title: "t1", seq: 1 }];
  const d = await sidebar({ view: "agents", agents });
  const fold = Object.keys(d.handlers).find((key) => key.startsWith("on_click:section-"));
  assert.ok(fold, "a section heading is a press");
  d.handlers[fold]({}, cx);
  assert.equal(d.view.sectionsFolded.size, 1, "a press folds it");
});

test("Nothing in the sidebar draws these rows by hand any more", () => {
  const sidebarCode = ["main.js", "sidebar-draw.js", "agents.js"].map((file) => read(`kanso/mods/kanso-spaces/${file}`)).join("\n");
  for (const gone of ["asleepRow", "gitTail", "asleepTail", "machineButton", "machineActions", "syncButton", "agentFold", "connector(", "  dots(", "  plus(id", "bareHead(t, id, name, count, ink"]) {
    assert.equal(sidebarCode.includes(gone), false, gone);
  }
  for (const name of ["projectRow(", "computerRow(", "section(", "asleep("]) assert.ok(read("kanso/mods/kanso-spaces/main.js").includes(name), name);
});

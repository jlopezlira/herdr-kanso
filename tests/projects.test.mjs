// Projects: folders you added stay when their last agent closes; worktrees go in Kanso's folder.
import { loadSpaces, temporaryKdbFile } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, realpath, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { load, clone, temporary, exec, until, elements, watchPopups, watchLines, failure, context, gitOk, fileExists as exists, gpuiHost } from "./helpers.mjs";
import { loadSidebar, mountedState, recorder } from "./sidebar-fixtures.mjs";

const NAMES = ["placeKey", "keyOfSpace", "keyOfProject", "closedProjects", "shownNames", "startingProjects", "parseWorktreeList", "addWorktree", "worktreesOf", "missingFolders", "folderName", "trimmed"];
const projects = () => load("kanso-spaces/projects.js", NAMES, { exec });
const database = async (t) => (await temporaryKdbFile(t)).fresh();
const git = gitOk("-c", "init.defaultBranch=main");

const recording = (calls, overlays) => ({ run: (cmd, args) => calls.push([cmd, clone(args ?? null)]), openOverlay: (o) => overlays.push(clone(o.props)) });

// Spaces on a database in its own temporary folder: `calls` keeps what it runs, `overlays` what it opens; `host(calls)` adds to its host.
const projectSpaces = async (t, host) => {
  const { dir, fresh } = await temporaryKdbFile(t);
  const calls = [], overlays = [], shared = new Map();
  const { Spaces } = await loadSpaces({
    exec, appHome: () => dir, home: () => "/Users/me", spaces: () => [], machines: () => [],
    shared: (k) => shared.get(k) ?? null, setShared: (k, v) => shared.set(k, v),
    ...recording(calls, overlays),
    ...host(calls),
  });
  return { Spaces, kdb: fresh(), calls, overlays, shared };
};

test("the spaces open when projects came in become projects; home and duplicates do not", async () => {
  const { startingProjects } = await projects();
  const sp = [
    { folder: "/Users/me/Apps/agile/", machine: null }, { folder: "/Users/me/Apps/agile", machine: null },
    { folder: "/Users/me", machine: null }, { folder: "", machine: null }, { folder: "/srv/api", machine: "odin" },
  ];
  assert.deepEqual(clone(startingProjects(sp, "/Users/me")), [
    { name: "agile", folder: "/Users/me/Apps/agile", machine: "" },
    { name: "api", folder: "/srv/api", machine: "odin" },
  ]);
});

test("a project with no space open is closed; same names show their parent folder", async () => {
  const { closedProjects, shownNames } = await projects();
  const list = [
    { id: "a", name: "web", folder: "/Users/me/acme/web", machine: "" },
    { id: "b", name: "web", folder: "/Users/me/fluenty/web", machine: "" },
    { id: "c", name: "fury", folder: "/Users/me/fury", machine: "" },
    { id: "d", name: "api", folder: "/srv/api", machine: "odin" },
  ];
  const sp = [{ folder: "/Users/me/acme/web/", machine: null }, { folder: "/srv/api", machine: "odin" }, { folder: "", machine: null }];
  assert.deepEqual(clone(closedProjects(list, sp, "/Users/me").map((p) => p.id)), ["b", "c"]);
  assert.deepEqual(clone([...shownNames(list)]), [["a", "acme/web"], ["b", "fluenty/web"], ["c", "fury"], ["d", "api"]]);
});

test("projects are kept in the database: added once, removed without coming back, migrated once", async (t) => {
  const db = await database(t);
  await db.migrateProjects([{ name: "agile", folder: "/a/agile", machine: "" }, { name: "fury", folder: "/a/fury", machine: "" }], 1);
  await db.migrateProjects([{ name: "late", folder: "/a/late", machine: "" }], 2);
  assert.deepEqual(clone((await db.projects()).map((p) => p.name)), ["agile", "fury"], "once for every window and start");
  const again = await db.addProject({ name: "other", folder: "/a/agile" }, 3);
  assert.equal(again.existed, true);
  assert.equal(again.row.name, "agile", "one you keep keeps its name");
  assert.equal((await db.projects()).length, 2, "a place added twice is one project");
  const fury = (await db.projects()).find((p) => p.name === "fury");
  assert.equal(await db.removeProject(fury.id, 4), true);
  assert.deepEqual(clone((await db.projects()).map((p) => p.name)), ["agile"]);
  await db.migrateProjects([{ name: "fury", folder: "/a/fury", machine: "" }], 5);
  assert.deepEqual(clone((await db.projects()).map((p) => p.name)), ["agile"], "removed stays removed");
  const back = await db.addProject({ name: "fury app", folder: "/a/fury" }, 6);
  assert.equal(back.existed, false, "added again by you: it comes back");
  assert.equal(back.row.name, "fury app", "under the name you give it now");
  assert.equal(back.row.id, fury.id, "the same project, with its own id");
  await assert.rejects(db.relocateProject(fury.id, "/a/agile"), /already a project/);
  const gone = await db.addProject({ name: "gone", folder: "/a/gone" }, 7);
  await db.removeProject(gone.row.id, 8);
  await db.relocateProject(fury.id, "/a/gone");
  assert.equal((await db.projects()).find((p) => p.id === fury.id).folder, "/a/gone", "a removed project does not hold its folder");
  await db.relocateProject(fury.id, "/b/fury");
  await db.setProjectAgent(fury.id, "codex");
  assert.deepEqual(clone((await db.projects()).map((p) => [p.name, p.folder, p.agent])), [["agile", "/a/agile", null], ["fury app", "/b/fury", "codex"]]);
});

test("a worktree is made in Kanso's folder, and a branch that has one already is found there", async (t) => {
  const { addWorktree, worktreesOf, missingFolders } = await projects();
  const dir = await realpath(await temporary(t));
  const repo = join(dir, "acme");
  await mkdir(repo);
  await git(repo, "init", "-q");
  await writeFile(join(repo, "a.txt"), "a");
  await git(repo, "add", ".");
  await git(repo, "commit", "-qm", "a");
  const base = join(dir, "kanso", "worktrees");

  const made = await addWorktree({ folder: repo, branch: "feat/x", base });
  assert.equal(made.made, true, made.error);
  assert.match(relative(base, made.path).replace(/\\/g, "/"), /^acme-[0-9a-f]+\/feat-x-[0-9a-f]+$/);
  const dash = await addWorktree({ folder: repo, branch: "feat-x", base });
  assert.equal(dash.made, true, "feat-x is another branch: another folder");
  assert.notEqual(dash.path, made.path);
  assert.ok(await exists(join(made.path, "a.txt")));
  assert.equal(await git(made.path, "branch", "--show-current"), "feat/x");

  const same = await addWorktree({ folder: repo, branch: "feat/x", base });
  assert.deepEqual(clone(same), { path: made.path, made: false }, "found, not made twice");
  await rm(made.path, { recursive: true, force: true });
  const again = await addWorktree({ folder: repo, branch: "feat/x", base });
  assert.equal(again.made, true, "its folder was deleted: made again, not reported as there");
  assert.ok(await exists(again.path));
  const fromTree = await addWorktree({ folder: again.path, branch: "main", base });
  assert.deepEqual(clone(fromTree), { path: repo, made: false }, "main is the checkout itself");

  await git(repo, "branch", "old");
  const old = await addWorktree({ folder: repo, branch: "old", base });
  assert.equal(old.made, true, "a branch you have, checked out in its own folder");
  assert.equal(await git(old.path, "branch", "--show-current"), "old");

  assert.match((await addWorktree({ folder: repo, branch: "bad..name", base })).error, /branch name/);
  assert.match((await addWorktree({ folder: repo, branch: "-x", base })).error, /can't start/);
  assert.match((await addWorktree({ folder: repo, branch: " ", base })).error, /Name the branch/);
  assert.match((await addWorktree({ folder: dir, branch: "x", base })).error, /not a git repository/);
  assert.match((await addWorktree({ folder: join(dir, "gone"), branch: "x", base })).error, /not there/);

  const trees = await worktreesOf(repo);
  assert.deepEqual(clone(trees.map((x) => [x.main, x.branch]).toSorted((a, b) => Number(b[0]) - Number(a[0]) || a[1].localeCompare(b[1]))), [[true, "main"], [false, "feat-x"], [false, "feat/x"], [false, "old"]]);
  assert.equal(trees[0].main, true, "the checkout comes first");
  assert.deepEqual(clone([...(await missingFolders([repo, join(dir, "gone")]))]), [join(dir, "gone")]);
});

test("worktree lists are read from git's porcelain", async () => {
  const { parseWorktreeList } = await projects();
  const out = "worktree /r\nHEAD a\nbranch refs/heads/main\n\nworktree /w\nHEAD b\ndetached\nprunable gitdir file points to non-existent location\n\n";
  assert.deepEqual(clone(parseWorktreeList(out)), [
    { path: "/r", branch: "main", main: true, detached: false, prunable: false },
    { path: "/w", branch: null, main: false, detached: true, prunable: true },
  ]);
});

test("the top + adds a project in Projects and starts a conversation in Threads; a closed project keeps its row, and its + asks which agent", async () => {
  const { host, handlers } = recorder();
  const calls = [], overlays = [];
  const registry = [{ id: "p-fury", name: "fury", folder: "/Users/me/fury", machine: "", agent: "codex", missing: false }];
  const { Spaces } = await loadSidebar(host, {
    shared: (k) => (k === "kanso.registry" ? registry : null),
    spaces: () => [{ id: "sp-agile", name: "agile", folder: "/Users/me/agile", machine: null, active: true, tabs: [] }],
    run: (cmd, args) => calls.push([cmd, clone(args ?? null)]),
    openOverlay: (o) => overlays.push(clone({ kind: o.kind, props: o.props })),
    knownAgents: async () => [{ key: "claude", name: "Claude Code", installed: true, run: ["claude"] }, { key: "codex", name: "Codex", installed: true, run: ["codex"] }],
  });
  const view = Object.assign(new Spaces(), mountedState({ shown: new Set(["sp-agile"]) }));
  const addFromTop = () => {
    view.render();
    handlers["on_click:spaces-header-0-0-0"]({}, { stop_propagation() {}, notify() {} });
  };
  addFromTop();
  const startHere = { kind: "popup", props: { newAgent: { folder: "/Users/me/agile", machine: "", name: "agile", project: null, space: "sp-agile" }, start: true } };
  assert.equal(typeof overlays.at(-1).props.height, "number", "opened as tall as its menu draws, which it is told");
  startHere.props.height = overlays.at(-1).props.height;
  assert.deepEqual(overlays.at(-1), startHere, "in Projects, the top + opens the open project's menu, which goes on to New project and Arrange");
  view.view = "threads";
  addFromTop();
  assert.deepEqual(overlays.at(-1), startHere, "in Threads it is the same menu");
  view.view = "spaces";
  view.render();
  assert.equal(handlers[`on_click:closed-project-:/Users/me/fury-tool-0`], undefined, "at rest a kept project shows only its name");
  view.hoverSpace = ":/Users/me/fury";
  view.render();
  const plus = handlers[`on_click:closed-project-:/Users/me/fury-tool-0`];
  assert.ok(plus, "fury has no space open: it keeps its row, with its + under the pointer");
  plus({}, { stop_propagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [], "nothing starts on its own");
  assert.equal(overlays.at(-1).props.newAgent.folder, "/Users/me/fury", "it asks which agent, in fury's folder");
});

test("a local folder that is gone marks only this computer's project, never another machine's at the same path", async () => {
  const { Spaces } = await loadSpaces({
    spaces: () => [], home: () => "", shared: () => [], setShared: () => {}, fileApi: () => ({ existing: async () => [] }),
  });
  const list = [{ id: "here", name: "api", folder: "/srv/api", machine: "" }, { id: "odin", name: "api", folder: "/srv/api", machine: "odin" }];
  assert.deepEqual(clone((await new Spaces().publishRegistry({ projects: async () => list })).map((p) => [p.id, p.missing])), [["here", true], ["odin", false]]);
});

test("New project with a conversation: the name you give it, its folder, then which agent, asked", async (t) => {
  const closed = [];
  const { Spaces, kdb, calls, overlays, shared } = await projectSpaces(t, () => ({
    props: () => ({ newProject: { start: true }, overlay: "ov1" }), closeOverlay: (id) => closed.push(id), notify: () => {},
  }));
  const view = new Spaces();
  Object.assign(view, { navStore: { kdb }, projectFolder: "/Users/me/Apps/fury-api", projectName: { value: () => "Fury" } });
  const { cx, drain } = context();
  view.createProject(cx);
  await drain();
  assert.deepEqual(calls, [], "no agent is assumed");
  assert.deepEqual(closed, ["ov1"]);
  assert.deepEqual([overlays.at(-1).newAgent.folder, overlays.at(-1).newAgent.name], ["/Users/me/Apps/fury-api", "Fury"], "it asks which agent, for the project just made");
  assert.deepEqual(clone(shared.get("kanso.registry").map((p) => [p.name, p.folder])), [["Fury", "/Users/me/Apps/fury-api"]]);

  const noFolder = new Spaces();
  Object.assign(noFolder, { navStore: view.navStore, projectFolder: null, projectName: { value: () => "x" } });
  noFolder.createProject(cx);
  assert.equal(noFolder.projectError, "Choose its folder.");
});

test("Remove project takes it out for good, closes its open space, and only then closes the menu", async (t) => {
  const { Spaces, kdb, calls, shared } = await projectSpaces(t, (calls) => ({
    props: () => ({ overlay: "ov1" }), closeOverlay: (id) => calls.push(["close", id]),
  }));
  const { row } = await kdb.addProject({ name: "fury", folder: "/Users/me/fury" });
  const view = Object.assign(new Spaces(), { navStore: { kdb } });
  view.removeProject(row, { id: "sp-fury" });
  await until(() => calls.length === 2);
  assert.deepEqual(calls, [["space.close", { id: "sp-fury" }], ["close", "ov1"]], "the space goes, then the menu");
  assert.deepEqual(clone(await kdb.projects()), []);
  assert.deepEqual(clone(shared.get("kanso.registry") ?? []), [], "every view draws it gone");
});

test("New conversation: nothing lit until the keyboard moves; a project chosen asks which agent, under the project's own name", async () => {
  const calls = [], overlays = [];
  const registry = [
    { id: "p-a", name: "api", folder: "/work/client-a/api", machine: "", agent: "codex", missing: false },
    { id: "p-b", name: "api", folder: "/work/client-b/api", machine: "", agent: "codex", missing: false },
  ];
  const keys = [], scrolled = [];
  let rendering = false;
  const node = () => { const p = new Proxy({}, { get: (_t, k) => {
    if (k === "when") return (c, f) => (c ? f(p) : p);
    if (k === "on_key_down") return (f) => { keys.push(f); return p; };
    return () => p;
  } }); return p; };
  const { Spaces } = await loadSpaces({
    ...elements(node),
    // Herdr: a scroll handle made during render throws; it belongs in init().
    ScrollHandle: { new: () => { if (rendering) throw new Error("ScrollHandle.new() cannot run during render"); return { scroll_to_item: (i) => scrolled.push(i), release: () => true }; } },
    theme: () => ({ foreground: "#fff", muted: "#888", dim: "#666", border: "#333" }),
    shared: (k) => (k === "kanso.registry" ? registry : null), setShared: () => {},
    spaces: () => [], home: () => "/Users/me", appHome: () => "/tmp/kanso-none", exec: async () => (failure("")), props: () => ({ overlay: "ov1", newConversation: true }), closeOverlay: () => {},
    ...recording(calls, overlays),
  });
  const view = Object.assign(new Spaces(), { kdb: { projects: () => new Promise(() => {}) } });
  view.init({}, { focus_handle: () => ({ focus() {} }), spawn: () => {}, notify() {} });
  const shown = watchPopups(view);
  rendering = true;
  view.newConversationView(MENU_THEME);
  rendering = false;
  const projects = shown[0][0].scroll;
  assert.equal(view.menuAt, -1, "no row is chosen for you");
  assert.ok(projects.every((item) => !item.selected), "nothing is lit");
  keys.at(-1)({ key: "down", modifiers: {} }, { stop_propagation() {}, notify() {} });
  assert.deepEqual(scrolled, [0], "the first j lights the first row, and the run follows");
  projects[1].onSecondaryClick({ notify() {} });
  assert.equal(overlays.at(-1).newAgent.folder, "/work/client-b/api", "a right click on a project asks too");
  projects[0].onClick({ notify() {} });
  assert.deepEqual(calls, [], "nothing starts on its own");
  assert.deepEqual([overlays.at(-1).newAgent.folder, overlays.at(-1).newAgent.name], ["/work/client-a/api", "api"], "a click on a project asks which agent, under the project's own name, not the label that tells the two apart");
});

const MENU_THEME = { foreground: "#fff", muted: "#888", dim: "#666", border: "#333" };

// An element that takes any call and draws nothing; `when` runs its branch.
const blank = () => { const p = new Proxy({}, { get: (_t, k) => (k === "when" ? (c, f) => (c ? f(p) : p) : () => p) }); return p; };

test("New conversation's menu ends with Add computer, last for the keyboard too, unless it is switched off, and opens tall enough for every row", async () => {
  const menuOf = async (stored, open = 0) => {
    const calls = [], made = [], heights = [];
    const { Spaces } = await loadSpaces({
      ...elements(blank), theme: () => ({ foreground: "#fff", muted: "#888", dim: "#666", border: "#333" }),
      shared: (k) => (k === "kanso.pieces" ? stored : null), setShared: () => {},
      spaces: () => Array.from({ length: open }, (_, i) => ({ id: `sp-${i}`, name: `p${i}`, folder: `/work/p${i}`, machine: null, tabs: [] })),
      home: () => "/Users/me", props: () => ({ overlay: "ov1", newConversation: true }), closeOverlay: () => {},
      run: (cmd, args) => calls.push([cmd, clone(args ?? null)]), openOverlay: (o) => heights.push(o.height),
    });
    const view = Object.assign(new Spaces(), { menuAt: -1 });
    watchLines(view, made);
    view.newConversationView(MENU_THEME);
    view.newConversationMenu();
    return { view, calls, made, height: heights.at(-1) };
  };
  const { view, calls, made, height } = await menuOf(null);
  assert.deepEqual(made, ["New project with a conversation\u2026", "Open a folder, no project\u2026", "Add computer\u2026"]);
  view.menuActs.at(-1)({});
  assert.deepEqual(calls, [["mod.open", { name: "machine-add" }]], "the last row the keyboard reaches opens Add computer");
  assert.equal(height, 8 + 28 + 0 + 9 + 3 * 32, "no project: 4 at each edge, the title, the line and three items");
  assert.equal((await menuOf(null, 12)).height, 8 + 28 + 11 * 32 + 9 + 3 * 32, "a long run stops at 11 items and Add computer still fits under it");
  const off = await menuOf({ "footer.machine": "hide" }, 12);
  assert.deepEqual(off.made.slice(-2), ["New project with a conversation\u2026", "Open a folder, no project\u2026"], "switched off in kansō settings, it is left out");
  assert.ok(!off.made.includes("Add computer\u2026"));
  assert.equal(off.height, 8 + 28 + 11 * 32 + 9 + 2 * 32, "and its room goes with it");
});

const AGENT_THEME = { foreground: "#fff", muted: "#888", dim: "#666", border: "#333", selected: "#444" };
const agentMenu = (host) => loadSpaces({
  ...elements(blank), theme: () => (AGENT_THEME),
  shared: () => null, setShared: () => {}, spaces: () => [], home: () => "/Users/me", closeOverlay: () => {}, ...host,
});

test("which agent: only the ones installed, nothing chosen for you, and one picked starts there", async () => {
  const calls = [], made = [];
  const place = { space: null, folder: "/work/api", machine: "", project: null, name: "api" };
  const { Spaces } = await agentMenu({ props: () => ({ overlay: "ov1", newAgent: place }), run: (cmd, args) => calls.push([cmd, clone(args ?? null)]) });
  const view = Object.assign(new Spaces(), { kdb: { setProjectAgent: async () => {} }, menuAt: -1 });
  view.known = [
    { key: "claude", name: "Claude Code", installed: false, run: ["claude"] },
    { key: "codex", name: "Codex", installed: true, run: ["codex"] },
    { key: "pi", name: "pi", installed: true, run: ["pi"] },
  ];
  watchLines(view, made);
  view.newAgentView(AGENT_THEME);
  assert.deepEqual(made.slice(0, 3), ["Terminal", "Codex", "pi"], "Terminal first, then the agents; Claude Code is not installed here: not offered");
  view.menuActs[1]({});
  assert.deepEqual(calls, [["space.new", { folder: "/work/api", machine: "", argv: ["codex"] }]]);

  // A worktree just made: the agent chosen starts in its own tab there, named by its branch.
  calls.length = 0; made.length = 0;
  place.tree = { folder: "/kanso/worktrees/api/feat-x", branch: "feat-x" };
  const tree = Object.assign(new Spaces(), { kdb: view.kdb, menuAt: -1, known: view.known });
  watchLines(tree, made);
  tree.newAgentView(AGENT_THEME);
  assert.ok(!made.includes("New worktree\u2026"), "no worktree in a worktree");
  tree.menuActs[2]({});
  assert.deepEqual(calls, [["space.new", { folder: "/work/api", machine: "" }], ["tab.new", { folder: "/kanso/worktrees/api/feat-x", name: "feat-x", argv: ["pi"] }]]);
});

const claudeHere = () => ({ "kanso.agents.installed": { "": [{ key: "claude", name: "Claude Code", installed: true, run: ["claude"] }] } });
const tenAgents = () => Array.from({ length: 10 }, (_, i) => ({ key: `a${i + 1}`, name: `Agent ${i + 1}`, installed: true, run: [`a${i + 1}`] }));
const settledRead = async (view) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(view.checking, false, "the read is over");
};
const menuKit = () => load("kanso-spaces/ui-menu.js", ["menuHeight"], gpuiHost());
const devbox = () => ({ space: "sp-api", folder: "/work/api", machine: "devbox", project: null, name: "api" });
const plusMenu = (Spaces, state) => {
  const scrolled = [];
  const view = Object.assign(new Spaces(), { kdb: { setProjectAgent: async () => {} }, menuAt: -1, handle: {}, agentScroll: { scroll_to_item: (i) => scrolled.push(i) } }, state);
  const lines = [], items = [];
  view.menuLine = ((line) => (text, act, opts) => { lines.push([text, opts?.hint ?? null]); return line(text, act, opts); })(view.menuLine.bind(view));
  view.popup = (_t, _title, list) => { items.push(...list); return null; };
  view.newAgentView(AGENT_THEME);
  const keys = { track_focus() { return keys; }, on_key_down(fn) { keys.press = fn; return keys; } };
  view.menuKeys(keys);
  return { view, lines, items, scrolled, press: (key, modifiers = {}) => keys.press({ key, modifiers }, { stop_propagation() {}, notify() {} }) };
};

test("The + menu is the approved one: where it opens, Terminal with its key, the agents keyed 1 to 9, a new project, the worktrees inside a repository, then Arrange with its key", async () => {
  const calls = [], overlays = [];
  const place = devbox();
  const { Spaces } = await agentMenu({
    props: () => ({ overlay: "ov1", newAgent: place, start: true }), run: (cmd, args) => calls.push([cmd, clone(args ?? null)]), openOverlay: (o) => overlays.push(clone({ height: o.height, props: o.props })),
    keys: () => [{ keys: "cmd-t", action: "tab.new" }, { keys: "cmd-alt-t", action: "kanso-strip.arrange" }],
  });
  const menu = (state) => plusMenu(Spaces, state);
  const known = [{ key: "claude", name: "Claude Code", installed: true, run: ["claude"] }, { key: "codex", name: "Codex", installed: true, run: ["codex"] }];
  const { view, lines } = menu({ known, repo: true, trees: [{ path: "/work/api-feat", branch: "feat" }] });
  assert.deepEqual(lines.map(([text]) => text), ["Terminal", "Claude Code", "Codex", "New project", "New worktree\u2026", "Open worktree\u2026", "Arrange\u2026"]);
  assert.deepEqual(lines.map(([, hint]) => hint), ["⌘T", "1", "2", null, null, null, "⌥⌘T"]);
  view.menuActs[5]({});
  assert.deepEqual(overlays.at(-1), { height: 4 + 28 + 32 + 4, props: { trees: { place, trees: [{ path: "/work/api-feat", branch: "feat" }] } } }, "Open worktree… lists the others, as tall as its menu draws");
  view.menuDigits[1]({ notify() {} });
  assert.deepEqual(calls, [["space.select", { id: "sp-api" }], ["tab.new", { space: "sp-api", folder: "/work/api", argv: ["codex"] }]], "2 starts the second agent");
  assert.equal(menu({ known, repo: false }).lines.some(([text]) => text.includes("worktree")), false, "outside a repository: no worktree rows");
  assert.deepEqual(menu({ known: null }).lines.map(([text]) => text), ["Terminal", "New project", "Arrange\u2026"], "the first time no agent is offered until the computer answers");
  const failed = menu({ known: null, agentsFailed: "ssh: connect timed out" });
  assert.equal(failed.lines.some(([text]) => text === "Claude Code"), false);
});

test("The + menu keeps every installed agent, numbers the first nine, starts one only on a plain digit, and a failed read offers Refresh and Explain on the keyboard", async () => {
  const calls = [];
  const store = claudeHere();
  const { Spaces } = await agentMenu({
    props: () => ({ overlay: "ov1", newAgent: devbox(), start: true }), run: (cmd, args) => calls.push([cmd, clone(args ?? null)]),
    shared: (key) => store[key] ?? null, keys: () => [],
    spaces: () => [{ id: "sp-api", machine: "devbox", active: true, tabs: [] }, { id: "sp-home", machine: null, active: false, tabs: [] }],
  });
  const menu = (state) => plusMenu(Spaces, state);
  const ten = tenAgents();
  const many = menu({ known: ten });
  assert.deepEqual(many.lines.filter(([text]) => text.startsWith("Agent")).map(([text, hint]) => [text, hint]),
    ten.map((a, i) => [a.name, i < 9 ? String(i + 1) : null]), "ten agents, ten rows, the first nine numbered");
  many.press("2", { alt: true });
  many.press("2", { platform: true });
  many.press("2", { shift: true });
  assert.deepEqual(calls, [], "a digit with Alt, Command or Shift is not the menu's");
  many.press("g", { shift: true });
  assert.equal(many.view.menuAt, many.view.menuActs.length - 1, "Shift-G still goes to the last row");
  many.press("2");
  assert.deepEqual(calls.at(-1), ["tab.new", { space: "sp-api", folder: "/work/api", argv: ["a2"] }]);
  calls.length = 0;
  const known = [{ key: "codex", name: "Codex", installed: true, run: ["codex"] }];
  const failed = menu({ known, agentsFailed: "ssh: connect timed out" });
  const failure = failed.items.find((line) => line.failure)?.failure;
  assert.equal(failed.lines.some(([text]) => text === "Codex"), false, "the failure stands in the agents' place, as the board draws it");
  assert.equal(failed.items.filter((line) => line.loading).length, 0, "and no loading rows once the read is over");
  assert.deepEqual([failure.text, failure.fix, failure.agent], ["Can't list agents on devbox", "Refresh", "Claude Code"]);
  failed.press("j"); failed.press("j");
  assert.equal(menu({ known, agentsFailed: "ssh: connect timed out", menuAt: 1 }).items.find((line) => line.failure).failure.lit, "fix", "the keyboard reaches Refresh after Terminal");
  failed.view.menuAt = 2;
  failed.press("enter");
  assert.deepEqual(calls.at(-1), ["tab.new", { name: "Explain devbox", argv: ["claude"],
    task: "kansō could not list the agents installed on devbox. The error: ssh: connect timed out. Explain why, and how to fix it. Do not change anything.", space: "sp-home" }],
  "Enter on Explain asks this computer's agent, in a space on this computer, never devbox's");
});

test("Explain is this computer's: with no local space it opens one here, a refusal says nothing, and with no agent installed here it is not offered", async () => {
  const calls = [];
  const store = claudeHere();
  const host = (run) => agentMenu({
    props: () => ({ overlay: "ov1", newAgent: devbox(), start: true }), run, shared: (key) => store[key] ?? null, keys: () => [],
    spaces: () => [{ id: "sp-api", machine: "devbox", active: true, tabs: [] }], home: () => "/Users/me",
  });
  const { Spaces } = await host((cmd, args) => calls.push([cmd, clone(args ?? null)]));
  const failed = { known: [], agentsFailed: "ssh: connect timed out" };
  const view = plusMenu(Spaces, failed);
  view.view.menuActs[2]({});
  assert.deepEqual(calls.at(-1)?.slice(0, 1), ["space.new"]);
  assert.deepEqual([calls.at(-1)[1].machine, calls.at(-1)[1].folder, calls.at(-1)[1].argv], ["", "/Users/me", ["claude"]], "a new space on this computer");
  const { Spaces: Refusing } = await host(() => { throw new Error("refused"); });
  assert.doesNotThrow(() => plusMenu(Refusing, failed).view.menuActs[2]({}), "a refusal is quiet");
  store["kanso.agents.installed"][""] = [];
  const none = plusMenu(Spaces, failed);
  const failure = none.items.find((line) => line.failure).failure;
  assert.equal(failure.agent, "", "no agent installed here: no Explain");
  assert.equal(none.view.menuActs.length, view.view.menuActs.length - 1, "one action fewer: no Explain");
});

test("A read that fails after an earlier answer keeps that list and says it failed, with its retry", async () => {
  const store = { "kanso.agents.installed": { devbox: [{ key: "codex", name: "Codex", installed: true, run: ["codex"] }], "": [] } };
  const place = devbox();
  const { Spaces } = await agentMenu({ shared: (key) => store[key] ?? null, setShared: (key, value) => { store[key] = value; }, knownAgents: async () => { throw new Error("ssh: connect timed out"); } });
  const view = new Spaces();
  view.askAgents(place, { notify() {}, timer: { after: () => ({ cancel() {} }) } });
  assert.equal(view.checking, true);
  assert.equal(view.known.length, 1, "the last answer at once");
  await settledRead(view);
  assert.equal(view.agentsFailed, "ssh: connect timed out");
  assert.equal(view.known.length, 1, "and still shown");
});

test("Ten agents fit the + popup: they scroll in the kit's run within its height, and the keyboard's row stays in view", async () => {
  const { menuHeight } = await menuKit();
  const ten = tenAgents();
  for (const height of [400, 300]) {
    const { Spaces } = await agentMenu({ props: () => ({ overlay: "ov1", newAgent: devbox(), start: true, height }), keys: () => [] });
    const menu = plusMenu(Spaces, { known: ten, repo: true, trees: [devbox()] });
    assert.ok(menuHeight({ items: menu.items }) <= height, `${height}: drawn within the popup`);
    const run = menu.items.find((line) => line.scroll);
    assert.equal(run.scroll.length, 10, "every agent in the run");
    assert.ok(run.rows < 10, "some scroll");
    for (let i = 0; i < 7; i += 1) menu.press("j");
    assert.equal(menu.scrolled.at(-1), 5, "the sixth agent brought into view");
  }
});

test("The + popup opens tall enough for everything it can settle into: loading, the failure with its actions, or the agents' run, with the footer in reach", async () => {
  const { menuHeight } = await menuKit();
  for (const cached of [undefined, [], tenAgents().slice(0, 1), tenAgents()]) {
    for (const start of [true, false]) {
      const store = claudeHere();
      store["kanso.agents.installed"].devbox = cached;
      const frame = {};
      const { Spaces } = await agentMenu({ shared: (key) => store[key] ?? null, openOverlay: (o) => Object.assign(frame, o), props: () => frame.props, keys: () => [] });
      new Spaces().newAgentMenu(devbox(), start);
      const states = { loading: { known: null, checking: true }, failed: { known: cached ?? null, agentsFailed: "ssh: connect timed out" }, none: { known: [] }, ten: { known: tenAgents() } };
      for (const [name, state] of Object.entries(states)) {
        const shown = plusMenu(Spaces, { repo: start, trees: start ? [devbox()] : [], ...state });
        const label = `cached ${cached?.length ?? "none"}, ${start ? "toolbar" : "project"} +, ${name}`;
        assert.ok(menuHeight({ items: shown.items }) <= frame.height, `${label}: ${menuHeight({ items: shown.items })} drawn in ${frame.height}`);
        const run = shown.items.find((line) => line.scroll);
        if (name === "ten") assert.ok(run.rows >= 1 && run.scroll.length === 10, `${label}: every agent in a run that shows`);
      }
    }
  }
});

test("A read that failed and is over shows the failure, not loading rows", async () => {
  const store = claudeHere();
  const { Spaces } = await agentMenu({ shared: (key) => store[key] ?? null, setShared: (key, value) => { store[key] = value; }, knownAgents: async ({ on }) => { if (on) throw new Error("timed out"); return []; },
    props: () => ({ overlay: "ov1", newAgent: devbox(), start: true }), keys: () => [] });
  const view = new Spaces();
  view.askAgents(devbox(), { notify() {}, timer: { after: () => ({ cancel() {} }) } });
  await settledRead(view);
  const shown = plusMenu(Spaces, { known: view.known, agentsFailed: view.agentsFailed, checking: view.checking });
  assert.equal(shown.items.filter((line) => line.loading).length, 0);
  assert.ok(shown.items.some((line) => line.failure));
});

test("The + popup lets go of the scroll handle it made", async () => {
  const counted = { made: 0, released: 0 };
  const { Spaces } = await agentMenu({
    props: () => ({ overlay: "ov1", newAgent: devbox(), start: true }), keys: () => [], knownAgents: async () => [], exec: async () => ({ code: 0, stdout: "" }),
    ScrollHandle: { new: () => { counted.made += 1; return { release() { counted.released += 1; } }; } },
  });
  const view = new Spaces();
  view.init({}, { notify() {}, timer: { after: () => ({ cancel() {} }) }, focus_handle: () => ({ focus() {} }) });
  view.close();
  assert.deepEqual(counted, { made: 1, released: 1 });
});

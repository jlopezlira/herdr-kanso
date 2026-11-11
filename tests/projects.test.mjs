// Projects: folders you added stay when their last agent closes; worktrees go in Kanso's folder.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, stat, realpath, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { load, clone, temporary, exec, until } from "./helpers.mjs";

const NAMES = ["placeKey", "keyOfSpace", "keyOfProject", "closedProjects", "shownNames", "startingProjects", "parseWorktreeList", "addWorktree", "worktreesOf", "missingFolders", "folderName", "trimmed"];
const projects = () => load("kanso-spaces/projects.js", NAMES, { exec });
const database = async (t) => {
  const dir = await temporary(t);
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec, appHome: () => dir });
  return new Kdb(join(dir, "kanso"));
};
const git = async (cwd, ...args) => {
  const r = await exec("git", ["-c", "core.autocrlf=false", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const exists = (p) => stat(p).then(() => true, () => false);

test("the spaces open when projects came in become projects; home and duplicates do not", async () => {
  const { startingProjects } = await projects();
  const sp = [
    { folder: "/Users/me/Apps/agile/", machine: null }, { folder: "/Users/me/Apps/agile", machine: null },
    { folder: "/Users/me", machine: null }, { folder: "", machine: null }, { folder: "/srv/api", machine: "odin" },
  ];
  // odin:/Users/me: a space at odin's home, kept under this computer's home.
  assert.deepEqual(clone(startingProjects(sp, [":/Users/me/Apps/fury", ":/Users/me", "odin:/srv/api", "odin:/srv/web", "odin:/Users/me"], "/Users/me")), [
    { name: "agile", folder: "/Users/me/Apps/agile", machine: "" },
    { name: "api", folder: "/srv/api", machine: "odin" },
    { name: "fury", folder: "/Users/me/Apps/fury", machine: "" },
    { name: "web", folder: "/srv/web", machine: "odin" },
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
  const handlers = {};
  const node = () => {
    let id = null;
    const proxy = new Proxy({}, {
      get(_t, prop) {
        if (prop === "id") return (x) => { id = x; return proxy; };
        if (prop === "on_click" || prop === "on_mouse_up") return (...a) => { if (id) handlers[`${prop}:${id}`] = a.at(-1); return proxy; };
        if (prop === "when") return (cond, fn) => (cond ? fn(proxy) : proxy);
        return () => proxy;
      },
    });
    return proxy;
  };
  const calls = [], overlays = [];
  const registry = [{ id: "p-fury", name: "fury", folder: "/Users/me/fury", machine: "", agent: "codex", missing: false }];
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    div: node, svg: node, image: node, h_flex: node, v_flex: node, Button: { new: node }, Popover: { new: node },
    ORDERS: { updated: "Updated" }, DEFAULT_ORDER: "updated", NAME_LABEL: "kanso.name", PIN_LABEL: "kanso.pin",
    orderSessions: (l) => l, withTerminals: () => [], terminals: () => [], nest: () => [], bySection: () => [],
    track: () => null, elapsed: () => null, activityOf: () => null, agentLabel: () => "", duration: () => "", findThreads: async () => ({}),
    props: () => ({}), FLUSH: -24, STATUS_ORDERS: { latest: "Latest" }, THREAD_ORDERS: { said: "Said" },
    theme: () => ({ foreground: "#fff", muted: "#888", dim: "#666", chrome: "#111", hover: "#222", ansi2: "#0f0" }),
    shared: (k) => (k === "kanso.registry" ? registry : null), setShared: () => {},
    spaces: () => [{ id: "sp-agile", name: "agile", folder: "/Users/me/agile", machine: null, active: true, tabs: [] }],
    panes: () => [], agents: () => [], machines: () => [{ name: null, layout: "ready" }],
    run: (cmd, args) => calls.push([cmd, clone(args ?? null)]), home: () => "/Users/me",
    openOverlay: (o) => overlays.push(clone({ kind: o.kind, props: o.props })),
    knownAgents: async () => [{ key: "claude", name: "Claude Code", installed: true, run: ["claude"] }, { key: "codex", name: "Codex", installed: true, run: ["codex"] }],
  });
  const view = new Spaces();
  Object.assign(view, { view: "spaces", git: {}, shown: new Set(["sp-agile"]), born: {}, custom: {}, order: "updated", machines: [], folded: new Set(), agentsFolded: new Set(), orderPicker: node });
  view.render();
  handlers["on_click:space-new"]({}, { stop_propagation() {}, notify() {} });
  assert.deepEqual(overlays.at(-1), { kind: "dialog", props: { newProject: { start: false } } }, "in Projects, the top + asks a new project's name and folder");
  view.view = "threads";
  view.render();
  handlers["on_click:space-new"]({}, { stop_propagation() {}, notify() {} });
  assert.deepEqual(overlays.at(-1), { kind: "popup", props: { newConversation: true } }, "in Threads, it asks which project the conversation is in");
  view.view = "spaces";
  view.render();
  const plus = handlers[`on_mouse_up:closed-plus-:/Users/me/fury`];
  assert.ok(plus, "fury has no space open: it keeps its row, with its +");
  plus({}, { stop_propagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, [], "nothing starts on its own");
  assert.equal(overlays.at(-1).props.newAgent.folder, "/Users/me/fury", "it asks which agent, in fury's folder");
});

test("a local folder that is gone marks only this computer's project, never another machine's at the same path", async () => {
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    spaces: () => [], home: () => "", shared: () => [], setShared: () => {}, fileApi: () => ({ existing: async () => [] }),
  });
  const list = [{ id: "here", name: "api", folder: "/srv/api", machine: "" }, { id: "odin", name: "api", folder: "/srv/api", machine: "odin" }];
  assert.deepEqual(clone((await new Spaces().publishRegistry({ projects: async () => list })).map((p) => [p.id, p.missing])), [["here", true], ["odin", false]]);
});

test("New project with a conversation: the name you give it, its folder, then which agent, asked", async (t) => {
  const dir = await temporary(t);
  const calls = [], closed = [], shared = new Map(), overlays = [];
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec, appHome: () => dir });
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    exec, appHome: () => dir, home: () => "/Users/me", spaces: () => [], machines: () => [],
    props: () => ({ newProject: { start: true }, overlay: "ov1" }), closeOverlay: (id) => closed.push(id),
    shared: (k) => shared.get(k) ?? null, setShared: (k, v) => shared.set(k, v), notify: () => {},
    run: (cmd, args) => calls.push([cmd, clone(args ?? null)]), openOverlay: (o) => overlays.push(clone(o.props)),
  });
  const view = new Spaces();
  Object.assign(view, { navStore: { kdb: new Kdb(join(dir, "kanso")) }, projectFolder: "/Users/me/Apps/fury-api", projectName: { value: () => "Fury" } });
  const { cx, drain } = (await import("./helpers.mjs")).context();
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
  const dir = await temporary(t);
  const calls = [], shared = new Map();
  const { Kdb } = await load("kanso-spaces/kdb.js", ["Kdb"], { exec, appHome: () => dir });
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    exec, appHome: () => dir, home: () => "/Users/me", spaces: () => [], machines: () => [],
    props: () => ({ overlay: "ov1" }), closeOverlay: (id) => calls.push(["close", id]),
    shared: (k) => shared.get(k) ?? null, setShared: (k, v) => shared.set(k, v),
    run: (cmd, args) => calls.push([cmd, clone(args ?? null)]),
  });
  const kdb = new Kdb(join(dir, "kanso"));
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
  const keys = [], scrolled = [], items = {};
  let inRenderer = false, rendering = false;
  const HANDLERS = ["on_click", "on_mouse_down", "on_mouse_up"];
  const node = () => { const p = new Proxy({}, { get: (_t, k) => {
    if (k === "when") return (c, f) => (c ? f(p) : p);
    if (k === "on_key_down") return (f) => { keys.push(f); return p; };
    if (k === "on_item_click" || k === "on_item_secondary_click") return (f) => { items[k] = f; return p; };
    // Herdr: a handler registered inside a virtual list's item renderer throws.
    if (HANDLERS.includes(k) && inRenderer) return () => { throw new Error(`${k} inside an item renderer`); };
    return () => p;
  } }); return p; };
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    div: node, svg: node, image: node, h_flex: node, v_flex: node, Popover: { new: node }, Scrollbar: { vertical: node },
    v_virtual_list: (_id, n, _size, _key, render) => { inRenderer = true; try { render({ start: 0, end: n }); } finally { inRenderer = false; } return node(); },
    // Herdr: a scroll handle made during render throws; it belongs in init().
    VirtualListScrollHandle: { new: () => { if (rendering) throw new Error("VirtualListScrollHandle.new() cannot run during render"); return { scroll_to_item: (i) => scrolled.push(i), release: () => true }; } },
    theme: () => ({ foreground: "#fff", muted: "#888", dim: "#666", border: "#333" }),
    shared: (k) => (k === "kanso.registry" ? registry : null), setShared: () => {},
    spaces: () => [], home: () => "/Users/me", appHome: () => "/tmp/kanso-none", exec: async () => ({ code: 1, stdout: "", stderr: "" }), props: () => ({ overlay: "ov1", newConversation: true }), closeOverlay: () => {},
    run: (cmd, args) => calls.push([cmd, clone(args ?? null)]), openOverlay: (o) => overlays.push(clone(o.props)),
  });
  const view = Object.assign(new Spaces(), { kdb: { projects: () => new Promise(() => {}) } });
  view.init({}, { focus_handle: () => ({ focus() {} }), spawn: () => {}, notify() {} });
  rendering = true;
  view.newConversationView({ foreground: "#fff", muted: "#888", dim: "#666", border: "#333" });
  rendering = false;
  assert.equal(view.menuAt, -1, "no row is chosen for you");
  keys.at(-1)({ key: "down", modifiers: {} }, { stop_propagation() {}, notify() {} });
  assert.deepEqual(scrolled, [0], "the first j lights the first row, and the list follows");
  items.on_item_click("conv-p-a", { notify() {} });
  assert.deepEqual(calls, [], "nothing starts on its own");
  assert.deepEqual([overlays.at(-1).newAgent.folder, overlays.at(-1).newAgent.name], ["/work/client-a/api", "api"], "a click on a row (the list's, by its key) asks which agent, under the project's own name, not the label that tells the two apart");
});

test("which agent: only the ones installed, nothing chosen for you, and one picked starts there", async () => {
  const calls = [], made = [];
  const node = () => { const p = new Proxy({}, { get: (_t, k) => (k === "when" ? (c, f) => (c ? f(p) : p) : () => p) }); return p; };
  const place = { space: null, folder: "/work/api", machine: "", project: null, name: "api" };
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], {
    div: node, svg: node, image: node, h_flex: node, v_flex: node, Popover: { new: node },
    theme: () => ({ foreground: "#fff", muted: "#888", dim: "#666", border: "#333", selected: "#444" }),
    shared: () => null, setShared: () => {}, spaces: () => [], home: () => "/Users/me", props: () => ({ overlay: "ov1", newAgent: place }), closeOverlay: () => {},
    run: (cmd, args) => calls.push([cmd, clone(args ?? null)]),
  });
  const view = Object.assign(new Spaces(), { kdb: { setProjectAgent: async () => {} }, menuAt: -1 });
  view.known = [
    { key: "claude", name: "Claude Code", installed: false, run: ["claude"] },
    { key: "codex", name: "Codex", installed: true, run: ["codex"] },
    { key: "pi", name: "pi", installed: true, run: ["pi"] },
  ];
  const real = view.menuItem.bind(view);
  view.menuItem = (t, id, text, act, opts) => { made.push(text); return real(t, id, text, act, opts); };
  view.newAgentView({ foreground: "#fff", muted: "#888", dim: "#666", border: "#333", selected: "#444" });
  assert.deepEqual(made.slice(0, 3), ["Codex", "pi", "Terminal"], "Claude Code is not installed here: not offered");
  view.menuActs[0]({});
  assert.deepEqual(calls, [["space.new", { folder: "/work/api", machine: "", argv: ["codex"] }]]);

  // A worktree just made: the agent chosen starts in its own tab there, named by its branch.
  calls.length = 0; made.length = 0;
  place.tree = { folder: "/kanso/worktrees/api/feat-x", branch: "feat-x" };
  const tree = Object.assign(new Spaces(), { kdb: view.kdb, menuAt: -1, known: view.known });
  const treeItem = tree.menuItem.bind(tree);
  tree.menuItem = (t, id, text, act, opts) => { made.push(text); return treeItem(t, id, text, act, opts); };
  tree.newAgentView({ foreground: "#fff", muted: "#888", dim: "#666", border: "#333", selected: "#444" });
  assert.ok(!made.includes("In a new worktree\u2026"), "no worktree in a worktree");
  tree.menuActs[1]({});
  assert.deepEqual(calls, [["space.new", { folder: "/work/api", machine: "" }], ["tab.new", { folder: "/kanso/worktrees/api/feat-x", name: "feat-x", argv: ["pi"] }]]);
});

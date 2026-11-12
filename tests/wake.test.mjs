// Wake end to end, on Sleep's own code with a stand-in Herdr: the agent opens
// in the space it slept in, on its conversation, and a wake that lost its
// hold ends what it opened.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { processApi } from "../kanso/mods/kanso-panel/platform-processes.js";
import { databaseTimer, load, clone, temporary, exec, psMissing, nativeWindow } from "./helpers.mjs";

const HOME = "/nonexistent-home";
const C1 = "00000000-0000-4000-8000-000000000001";
const withSessionLookup = (runningSession) => (platform, run) => ({ ...processApi(platform, run), runningSession });

// Herdr as far as a wake needs it: three spaces under one folder, tabs and
// panes that appear when asked for, the strip placing each pane, and a
// claude that comes back on the conversation it was asked to resume.
function herdr(dir) {
  const spaces = ["shield", "agile", "herdr-kanso"].map((name) => ({ id: `sp-${name}`, name, folder: "/f", tabs: [{ id: `tb-${name}`, name: "1" }] }));
  const panes = [], strip = {}, killed = [], ran = [];
  let n = 0;
  const run = (cmd, args) => {
    ran.push([cmd, args]);
    if (cmd === "tab.new") {
      const tab = { id: `tb-new-${++n}`, name: args.name };
      spaces.find((w) => w.id === args.space).tabs.push(tab);
      const pane = { pane: `p${n}`, terminal: `t-new-${n}`, tab: tab.id, argv: args.argv };
      panes.push(pane);
      strip[tab.id] = { cols: [{ panes: [pane.pane] }] };
    }
    if (cmd === "terminal.kill") killed.push(args.terminal);
    if (cmd === "space.new") spaces.push({ id: "sp-made", name: args.name, folder: args.folder, tabs: [{ id: "tb-start", name: "1" }] });
  };
  const labels = [], state = {};
  const hc = async (args) => {
    if (args[0] === "label") { if (state.failLabels) return { code: 1, stdout: "" }; labels.push(args.slice(1)); }
    if (args[0] !== "get") return { code: 0, stdout: "" };
    const p = panes.find((q) => q.terminal === args[1]);
    return p ? { code: 0, stdout: JSON.stringify({ pid: 1, foreground: p.fg ?? { pid: 77, argv: p.argv } }) } : { code: 1, stdout: "" };
  };
  const shared = (k) => (k === "strip.state" ? strip : null);
  const host = {
    window: nativeWindow, exec, appHome: () => dir, home: () => HOME, spaces: () => spaces, panes: () => panes, terminals: () => panes.map((p) => ({ address: p.terminal, argv: p.argv })),
    shared, setShared: () => {}, hc, run, props: () => ({}), closeOverlay: () => { host.closed = true; }, theme: () => ({}),
    readTextFile: async () => JSON.stringify({ pid: 77, sessionId: C1 }),
    div: () => null, svg: () => null, v_flex: () => null, h_flex: () => null,
  };
  return { host, spaces, panes, killed, ran, labels, set failLabels(v) { state.failLabels = v; } };
}
// What the sidebar does once every agent of a sleep has left (sleepwork.js): the row is asleep.
const settle = async (store, id) => (await store.kdb.holdWork(id, "w-test")) && store.kdb.finishSleep(id, "w-test");
const cx = () => {
  const tasks = [];
  const c = { notify() {}, sleep: async () => {}, spawn(fn) { const t = fn(c); tasks.push(t); return t; }, timer: { after() {}, every() {} } };
  return { c, drain: async () => { while (tasks.length) await tasks.shift(); } };
};

async function asleepInKanso(t, tweak = () => {}) {
  const dir = await temporary(t);
  const world = herdr(dir);
  tweak(world);
  const mod = await load("kanso-sleep/main.js", ["Sleep", "Store", "Kdb"], world.host);
  const store = new mod.Store(new mod.Kdb(databaseTimer), join(dir, "none"));
  const kanso = world.spaces[2];
  await store.kdb.observe([{ conversation: C1, given: "Hashiko", space: kanso.id, pos: 2, status: "idle", terminal: "t3q" }]);
  const id = await store.sleep(":/f", { name: "Hashiko", space: { id: kanso.id, name: kanso.name }, per: null, saved: 1,
    cols: [{ w: 1, panes: [{ argv: ["claude"], cwd: "/w/kanso", resume: C1, name: "Hashiko", given: "Hashiko", terminal: "t3q", tab: "tb-herdr-kanso" }] }] });
  await settle(store, id);
  const view = new mod.Sleep();
  Object.assign(view, { store, busy: null, error: null, view: "list" });
  return { world, view, store, id };
}

test("a wake opens the agent in the space it slept in, on its conversation, and it is no longer asleep", async (t) => {
  const { world, view, store, id } = await asleepInKanso(t);
  const [shown] = await store.asleep();
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.equal(view.error, null, String(view.error));
  const opened = world.ran.find(([cmd]) => cmd === "tab.new")[1];
  assert.equal(opened.space, "sp-herdr-kanso", "herdr-kanso, not shield, though all three share the folder");
  assert.deepEqual(clone(opened.argv), ["claude", "--resume", C1]);
  assert.equal(opened.folder, "/w/kanso");
  assert.deepEqual(clone(await store.asleep(true)), [], "awake: its row is gone");
  assert.equal(world.host.closed, true);
  assert.deepEqual(clone(world.labels), [["t-new-1", `kanso.wakes=${C1}`], ["t-new-1", "kanso.name=Hashiko"]], "its terminal says what it brings back, and the name you gave it goes back on it");
  assert.equal((await store.kdb.read(`SELECT status FROM agents WHERE id='${C1}'`))[0].status, "unknown", "its status is what it is seen with next, no longer asleep");
  assert.ok(!(await store.claim(id)));
});

test("a wake whose hold another window took ends what it opened and says so", async (t) => {
  const { world, view, store } = await asleepInKanso(t);
  const [shown] = await store.asleep();
  // Another window takes the row once this one has opened the agent.
  const renew = store.renew.bind(store);
  let calls = 0;
  store.renew = async (rid, token) => { if (++calls > 1) await store.kdb.run(`UPDATE sleeps SET waking='other',waking_at=${Date.now()} WHERE id='${rid}';`); return renew(rid, token); };
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.match(String(view.error), /another window woke it meanwhile/);
  assert.deepEqual(clone(world.killed), ["t-new-1"], "what this wake opened is ended, so the agent never runs twice");
  assert.equal((await store.asleep(true)).length, 1, "the other window's wake still holds the row");
});

test("a wake that stalled past its hold opens nothing: the other window's wake is the one", async (t) => {
  const { world, view, store } = await asleepInKanso(t);
  const [shown] = await store.asleep();
  // This wake stalls after its checks; meanwhile another window takes the row.
  const renew = store.renew.bind(store);
  store.renew = async (rid, token) => { await store.kdb.run(`UPDATE sleeps SET waking='other',waking_at=${Date.now()} WHERE id='${rid}';`); return renew(rid, token); };
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.match(String(view.error), /another window woke it meanwhile/);
  assert.equal(world.ran.filter(([cmd]) => cmd === "tab.new").length, 0, "nothing opened, so it never runs twice, not even for a moment");
  assert.equal((await store.asleep(true)).length, 1);
});

// The space in front belongs to `front`. A project is this computer when its machine is "".
async function spaceForProject(create, front) {
  const made = [];
  const sp = [{ id: "front", name: "shop", folder: "/shop", machine: front, active: true, tabs: [{ id: "tb", name: "Tab 1" }] }];
  const host = { home: () => HOME, spaces: () => sp, panes: () => [], terminals: () => [], shared: () => null, setShared: () => {},
    run: (cmd, args) => { made.push([cmd, args]); if (cmd === "space.new") sp.push({ id: "made", name: args.name, folder: args.folder, tabs: [{ id: "s1" }] }); } };
  const { openTab } = await load("kanso-arrange/tabkit.js", ["openTab"], host);
  await assert.rejects(openTab({ name: "x", cols: [{ w: 1, panes: [{ argv: ["claude"] }] }] }, { sleep: async () => {} }, { create }), /did not open the tab/);
  return made;
}

test("a space opened for a local project names this computer, even while another computer's space is in front", async () => {
  const made = await spaceForProject({ name: "herdr-kanso", folder: "/f", key: ":/f", machine: "" }, "odin");
  assert.equal(made.find(([cmd]) => cmd === "space.new")[1].machine, "");
  assert.equal(made.find(([cmd]) => cmd === "tab.new")[1].space, "made");
});

test("a space opened for a project on another computer names that computer", async () => {
  const made = await spaceForProject({ name: "shop", folder: "/shop", key: "loki:/shop", machine: "loki" }, "odin");
  assert.equal(made.find(([cmd]) => cmd === "space.new")[1].machine, "loki");
  assert.equal(made.find(([cmd]) => cmd === "tab.new")[1].space, "made");
});

test("a space made for a wake is found by a name only it has; another window's of the same name is never taken or closed", async () => {
  const made = [];
  const sp = [];
  const host = { home: () => HOME, spaces: () => sp, panes: () => [], terminals: () => [], shared: () => null, setShared: () => {},
    // The other window's space shows up first, under the same name and folder.
    run: (cmd, args) => { made.push([cmd, args]); if (cmd === "space.new") sp.push({ id: "theirs", name: "herdr-kanso", folder: args.folder, tabs: [{ id: "s2" }] }, { id: "mine", name: args.name, folder: args.folder, tabs: [{ id: "s1" }] }); } };
  const { openTab } = await load("kanso-arrange/tabkit.js", ["openTab"], host);
  const c = { sleep: async () => {} };
  // Herdr never opens the tab: the wake fails, and cleans up after itself only.
  await assert.rejects(openTab({ name: "Hashiko", cols: [{ w: 1, panes: [{ argv: ["claude"] }] }] }, c, { create: { name: "herdr-kanso", folder: "/f", key: ":/f" } }), /did not open the tab/);
  const asked = made.find(([cmd]) => cmd === "space.new")[1].name;
  assert.match(asked, /^herdr-kanso \(opening \w+\)$/, "made under a name nobody else has");
  assert.deepEqual(clone(made.filter(([cmd]) => cmd === "space.rename").map(([, x]) => x)), [{ id: "mine", name: "herdr-kanso" }], "then given its own");
  assert.deepEqual(clone(made.filter(([cmd]) => cmd === "tab.new").map(([, x]) => x.space)), ["mine"]);
  assert.deepEqual(clone(made.filter(([cmd]) => cmd === "space.close").map(([, x]) => x.id)), ["mine"], "only its own space goes; theirs is untouched");
});

test("a wake stopped before a pane opens opens nothing more", async () => {
  const made = [];
  const sp = [{ id: "w", name: "w", folder: "/f", tabs: [] }];
  const host = { home: () => HOME, spaces: () => sp, panes: () => [], terminals: () => [], shared: () => null, setShared: () => {}, run: (cmd, args) => { made.push([cmd, args]); } };
  const { openTab } = await load("kanso-arrange/tabkit.js", ["openTab"], host);
  await assert.rejects(openTab({ name: "x", cols: [{ w: 1, panes: [{ argv: ["claude"], resume: "c1" }] }] }, { sleep: async () => {} },
    { space: sp[0], before: async (p) => { throw new Error(`no: ${p.resume}`); } }), /no: c1/);
  assert.deepEqual(made.filter(([cmd]) => cmd === "tab.new" || cmd === "terminal.open"), []);
});

test("a conversation check that outlasts the hold opens nothing: the hold is renewed after it, right before the pane opens", async (t) => {
  let store = null;
  const { world, view, store: st } = await asleepInKanso(t, (w) => {
    // While this wake looks again for its conversation elsewhere, right
    // before it opens, another window takes the row.
    let looks = 0;
    w.host.exec = async (c, args, o) => {
      if ((c === "sh" && String(args?.[1] ?? "").includes(".claude/sessions") || c === "pwsh" && args.at(-1).includes(".claude")) && store && ++looks === 2) await store.kdb.run(`UPDATE sleeps SET waking='other',waking_at=${Date.now()};`);
      return exec(c, args, o);
    };
  });
  store = st;
  const [shown] = await st.asleep();
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.match(String(view.error), /another window woke it meanwhile/);
  assert.equal(world.ran.filter(([cmd]) => cmd === "tab.new").length, 0, "never opened, not even for a moment");
});

test("a tab woken while another computer's space is in front is made on this computer", async (t) => {
  const { world, view, store } = await asleepInKanso(t);
  world.spaces.splice(2, 1);
  Object.assign(world.spaces[0], { machine: "odin", active: true });
  const shown = (await store.asleep()).find((x) => x.name === "Hashiko");
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.equal(view.error, null, String(view.error));
  assert.equal(world.ran.find(([cmd]) => cmd === "space.new")[1].machine, "");
  assert.deepEqual(world.ran.filter(([cmd]) => cmd === "tab.new").map(([, a]) => a.space), ["sp-made"]);
});

test("an agent whose space is gone wakes in a space made for it, never in another of that name and folder", async (t) => {
  const { world, view, store } = await asleepInKanso(t);
  // A second sleep from herdr-kanso, then herdr-kanso closes; a space of the same name and folder stood beside it.
  await store.sleep(":/f", { name: "Ines", space: { id: "sp-herdr-kanso", name: "herdr-kanso" }, per: null, saved: 2,
    cols: [{ w: 1, panes: [{ argv: ["claude"], cwd: "/w/kanso", resume: "00000000-0000-4000-8000-000000000002", name: "Ines", terminal: "t3r", tab: "tb-herdr-kanso" }] }] }).then((id) => settle(store, id));
  world.spaces.splice(2, 1, { id: "sp-twin", name: "herdr-kanso", folder: "/f", tabs: [{ id: "tb-twin", name: "1" }] });
  const shown = (await store.asleep()).find((x) => x.name === "Hashiko");
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.equal(view.error, null, String(view.error));
  assert.deepEqual(world.ran.filter(([cmd]) => cmd === "tab.new").map(([, a]) => a.space), ["sp-made"], "not sp-twin");
  const ines = (await store.asleep(true)).find((x) => x.name === "Ines");
  assert.equal(ines.spaceId, "sp-made", "what else slept there wakes there too");
});

test("a pane the gate stopped is never ended for it: one you opened there with the same program is yours", async () => {
  const made = [], pn = [], strip = {};
  const sp = [{ id: "w", name: "w", folder: "/f", tabs: [] }];
  const host = { home: () => HOME, spaces: () => sp, panes: () => pn, terminals: () => pn.map((p) => ({ address: p.terminal, argv: p.argv })),
    shared: (k) => (k === "strip.state" ? strip : null), setShared: () => {},
    run: (cmd, args) => {
      made.push([cmd, args]);
      if (cmd === "tab.new") { sp[0].tabs.push({ id: "tb1", name: args.name }); pn.push({ pane: "p1", terminal: "t1", tab: "tb1", argv: args.argv }); strip.tb1 = { cols: [{ panes: ["p1"] }] }; }
    } };
  const { openTab } = await load("kanso-arrange/tabkit.js", ["openTab"], host);
  let n = 0;
  const before = async () => {
    if (++n === 2) { pn.push({ pane: "p2", terminal: "t2", tab: "tb1", argv: ["claude", "--resume", "c2"] }); throw new Error("c2 already runs"); }
  };
  await assert.rejects(openTab({ name: "x", cols: [{ w: 1, panes: [{ argv: ["claude", "--resume", "c1"] }] }, { w: 1, panes: [{ argv: ["claude", "--resume", "c2"] }] }] },
    { sleep: async () => {} }, { space: sp[0], before }), /c2 already runs/);
  assert.deepEqual(made.filter(([cmd]) => cmd === "terminal.kill"), [], "t2 was never asked for: it is not this opening's");
});

test("a wake Herdr is too slow for keeps the agent held: what it asked for may still open", async (t) => {
  const { world, view, store, id } = await asleepInKanso(t, (w) => {
    const run = w.host.run;
    w.host.run = (cmd, args) => (cmd === "tab.new" ? void w.ran.push([cmd, args]) : run(cmd, args)); // asked, never shown
  });
  const [shown] = await store.asleep();
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.match(String(view.error), /may still/);
  assert.equal(await store.claim(id), null, "not wakeable again at once: a second wake could start it twice");
  assert.equal((await store.asleep(true)).length, 1, "still asleep");
});

test("a wake whose space another window made in place of the gone one opens there", async (t) => {
  const { world, view, store } = await asleepInKanso(t);
  world.spaces.splice(2, 1, { id: "sp-again", name: "herdr-kanso", folder: "/f", tabs: [{ id: "tb-again", name: "1" }] });
  await store.kdb.moveSpace("sp-other-gone", "x"); // unrelated
  await store.kdb.run("INSERT INTO meta(key,value) VALUES('moved:sp-herdr-kanso','sp-again');");
  const [shown] = await store.asleep();
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.equal(view.error, null, String(view.error));
  assert.deepEqual(world.ran.filter(([cmd]) => cmd === "space.new"), [], "no second space");
  assert.deepEqual(world.ran.filter(([cmd]) => cmd === "tab.new").map(([, a]) => a.space), ["sp-again"]);
});

test("an agent brought back after a stopped sleep: nothing is typed into, or stopped in, a program you started in its terminal", async (t) => {
  const dir = await temporary(t);
  const world = herdr(dir);
  const sent = [], kills = [];
  let fg = { pid: 4242, argv: ["vim"] };
  world.host.hc = async (args) => {
    if (args[0] === "send") { sent.push(args); fg = { pid: 999999, argv: ["vim"] }; return { code: 0, stdout: "" }; }
    if (args[0] === "get") return { code: 0, stdout: JSON.stringify({ pid: 1, foreground: fg }) };
    return { code: 0, stdout: "" };
  };
  world.host.exec = async (c, a, o) => (c === "kill" ? (kills.push(a), { code: 0, stdout: "" }) : exec(c, a, o));
  const mod = await load("kanso-sleep/sleepwork.js", ["comeBack", "stopIn"], world.host);
  const c = { sleep: async () => {} };
  const p = { terminal: "t1", cwd: "/w", resume: C1, wake: ["claude", "--resume", C1], name: "Alice" };
  assert.equal(await mod.comeBack(p, c), "out", "vim runs there: Alice is not started over it, and stays asleep");
  assert.deepEqual([sent, kills], [[], []]);
  // At its prompt when the line goes, but what runs after is not what the line started (not claude).
  fg = { pid: 0 };
  assert.equal(await mod.comeBack(p, c), "unsure", "not this one's to stop: a wake looks at that terminal first");
  assert.equal(sent.length, 1);
  assert.deepEqual(kills, [], "vim is never sent TERM or KILL");
});

test("a pane asked for that never showed is pending, and one you opened in the tab with the same program is left alone", async () => {
  const made = [], pn = [], strip = {};
  const sp = [{ id: "w", name: "w", folder: "/f", tabs: [] }];
  const host = { home: () => HOME, spaces: () => sp, panes: () => pn, shared: (k) => (k === "strip.state" ? strip : null), setShared: () => {},
    run: (cmd, args) => {
      made.push([cmd, args]);
      if (cmd === "tab.new") { sp[0].tabs.push({ id: "tb1", name: args.name }); pn.push({ pane: "p1", terminal: "t1", tab: "tb1", argv: args.argv }); strip.tb1 = { cols: [{ panes: ["p1"] }] }; }
    } };
  const { openTab } = await load("kanso-arrange/tabkit.js", ["openTab"], host);
    const c = { sleep: async (ms) => { if (ms === 3000) pn.push({ pane: "p9", terminal: "t9", tab: "tb1", argv: ["npm", "run", "dev"] }); } };
  const err = await openTab({ name: "x", cols: [{ w: 1, panes: [{ argv: ["claude"] }] }, { w: 1, panes: [{ argv: ["npm", "run", "dev"] }] }] }, c, { space: sp[0] }).catch((e) => e);
  assert.match(String(err?.message), /did not open the pane/);
  assert.equal(err.pending, 1, "the dev server was asked for and may still open");
  assert.deepEqual(made.filter(([cmd]) => cmd === "terminal.kill"), [], "yours (t9) is never ended on a guess");
});

test("an agent brought back: only the process its own line started is ever stopped, never a claude you started there after", { skip: psMissing }, async (t) => {
  const dir = await temporary(t);
  const world = herdr(dir);
  const { symlink } = await import("node:fs/promises");
  const { spawn } = await import("node:child_process");
  const bin = join(dir, "claude");
  await symlink(process.execPath, bin);
  const procs = [];
  const start = () => { const f = spawn(bin, ["-e", "setTimeout(() => {}, 20000)"]); procs.push(f); return f; };
  t.after(() => procs.forEach((f) => f.kill()));
  const kills = [];
  let fg = { pid: 0 }, then = null;
  world.host.hc = async (args) => {
    if (args[0] === "send") { fg = await then(); return { code: 0, stdout: "" }; }
    if (args[0] === "get") return { code: 0, stdout: JSON.stringify({ pid: 1, foreground: fg }) };
    return { code: 0, stdout: "" };
  };
  world.host.exec = async (c, a, o) => (c === "kill" && a[0] !== "-0" ? (kills.push(a), { code: 0, stdout: "" }) : exec(c, a, o));
  const mod = await load("kanso-sleep/sleepwork.js", ["comeBack", "stopIn"], world.host);
  const c = { sleep: async () => {} };
  const p = { terminal: "t1", cwd: "/w", resume: C1, wake: ["claude", "--resume", C1], name: "Alice" };
  // Its line's claude exits at once; you start another conversation there right after.
  then = async () => { const f = start(); await new Promise((r) => setTimeout(r, 200)); return { pid: f.pid, argv: ["claude"] }; };
  assert.equal(await mod.comeBack(p, c), "unsure");
  assert.deepEqual(kills, [], "yours is not its to stop, new as it is");
  // Its line's own claude, on its conversation, never proven back: that one alone is stopped.
  fg = { pid: 0 };
  let mine = null;
  then = async () => { mine = start(); await new Promise((r) => setTimeout(r, 200)); return { pid: mine.pid, argv: ["claude", "--resume", C1] }; };
  await mod.comeBack(p, c);
  assert.deepEqual(kills.map((k) => k[1]), [String(mine.pid), String(mine.pid)], "TERM, then KILL, to it only");
});

test("an agent woken into a tab others open panes in takes its own pane, not the next new one", async () => {
  const pn = [{ pane: "p0", terminal: "t0", tab: "tb" }], fgs = {};
  const host = { home: () => HOME, spaces: () => [], panes: () => pn, shared: () => ({ tb: { cols: [{ panes: ["p0"] }] } }), setShared: () => {},
    hc: async (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: fgs[args[1]] ?? null }) } : { code: 0, stdout: "" }),
    run: (cmd) => {
      if (cmd !== "terminal.open") return;
      // Another window's wake into the same tab shows first, then this one.
      pn.push({ pane: "pB", terminal: "tB", tab: "tb" }, { pane: "pA", terminal: "tA", tab: "tb" });
      fgs.tB = { pid: 2, argv: ["claude", "--resume", "conv-b"] }; fgs.tA = { pid: 3, argv: ["claude", "--resume", "conv-a"] };
    } };
  const { openInto } = await load("kanso-arrange/tabkit.js", ["openInto"], host);
  assert.equal(await openInto({ argv: ["claude", "--resume", "conv-a"], resume: "conv-a" }, { sleep: async () => {} }, "tb"), "pA");
});

test("a space another window made between the look and the hold is the one: never a second", async (t) => {
  const { world, view, store } = await asleepInKanso(t);
  world.spaces.splice(2, 1, { id: "sp-twin", name: "herdr-kanso", folder: "/f", tabs: [{ id: "tb-twin", name: "1" }] });
  const replacing = store.kdb.replacing.bind(store.kdb);
  store.kdb.replacing = async (...args) => {
    world.spaces.push({ id: "sp-theirs", name: "herdr-kanso", folder: "/f", tabs: [{ id: "tb-theirs", name: "1" }] });
    await store.kdb.run("INSERT INTO meta(key,value) VALUES('moved:sp-herdr-kanso','sp-theirs');");
    return replacing(...args);
  };
  const [shown] = await store.asleep();
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.equal(view.error, null, String(view.error));
  assert.deepEqual(world.ran.filter(([cmd]) => cmd === "space.new"), []);
  assert.deepEqual(world.ran.filter(([cmd]) => cmd === "tab.new").map(([, a]) => a.space), ["sp-theirs"]);
});

test("a tab woken whole takes each agent's own pane, never one you opened there meanwhile", async () => {
  const sp = [{ id: "w", name: "w", folder: "/f", tabs: [] }], pn = [], fgs = {}, strip = {};
  const host = { home: () => HOME, spaces: () => sp, panes: () => pn, shared: (k) => (k === "strip.state" ? strip : null), setShared: () => {},
    hc: async (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ foreground: fgs[args[1]] ?? null }) } : { code: 0, stdout: "" }),
    run: (cmd, args) => {
      if (cmd === "tab.new") { sp[0].tabs.push({ id: "tb1", name: args.name }); pn.push({ pane: "pA", terminal: "tA", tab: "tb1" }); fgs.tA = { pid: 2, argv: args.argv }; }
      if (cmd === "terminal.open") {
        // Yours shows first, then the agent's.
        pn.push({ pane: "pV", terminal: "tV", tab: "tb1" }, { pane: "pB", terminal: "tB", tab: "tb1" });
        fgs.tV = { pid: 5, argv: ["vim"] }; fgs.tB = { pid: 3, argv: args.argv };
      }
    } };
  const { openTab } = await load("kanso-arrange/tabkit.js", ["openTab"], host);
  const ids = await openTab({ name: "x", cols: [{ w: 1, panes: [{ argv: ["claude", "--resume", "ca"], resume: "ca" }] }, { w: 1, panes: [{ argv: ["claude", "--resume", "cb"], resume: "cb" }] }] },
    { sleep: async () => {} }, { space: sp[0] });
  assert.deepEqual(clone(ids), [["pA"], ["pB"]], "vim is not taken for the second agent");
});

test("an agent brought back after a stopped sleep is not started again when its conversation already runs elsewhere", { skip: psMissing }, async (t) => {
  const dir = await temporary(t);
  const world = herdr(dir);
  const { mkdir, writeFile, symlink } = await import("node:fs/promises");
  const { spawn } = await import("node:child_process");
  const home = await temporary(t);
  await mkdir(join(home, ".claude", "sessions"), { recursive: true });
  const bin = join(home, "claude");
  await symlink(process.execPath, bin);
  const fake = spawn(bin, ["-e", "setTimeout(() => {}, 20000)"]);
  t.after(() => fake.kill());
  await new Promise((r) => setTimeout(r, 300));
  await writeFile(join(home, ".claude", "sessions", `${fake.pid}.json`), JSON.stringify({ pid: fake.pid, sessionId: C1 }));
  const sent = [];
  world.host.home = () => home;
  world.host.hc = async (args) => (args[0] === "send" ? (sent.push(args), { code: 0, stdout: "" }) : args[0] === "get" ? { code: 0, stdout: JSON.stringify({ pid: 1, foreground: null }) } : { code: 0, stdout: "" });
  const mod = await load("kanso-sleep/sleepwork.js", ["comeBack", "stopIn"], world.host);
  assert.equal(await mod.comeBack({ terminal: "t1", cwd: "/w", resume: C1, wake: ["claude", "--resume", C1], name: "Alice" }, { sleep: async () => {} }), "out");
  assert.deepEqual(sent, [], "you resumed it elsewhere: never a second one here");
});

test("a wake that could not prove an agent back never ends what you started in its terminal since", async (t) => {
  const { world, view, store } = await asleepInKanso(t, (w) => {
    // It never proves back (no record of it); meanwhile it exits and you start vim there.
    w.host.readTextFile = async () => { const q = w.panes.find((x) => x.terminal === "t-new-1"); if (q) q.fg = { pid: 999998, argv: ["vim"] }; return JSON.stringify({ pid: 1234, sessionId: C1 }); };
  });
  const [shown] = await store.asleep();
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.deepEqual(world.killed, [], "vim is yours");
  assert.match(String(view.error), /t-new-1 runs something this wake did not start and is left open/);
  assert.equal((await store.asleep(true)).length, 1, "still asleep, to wake again");
});

test("an agent brought back never has its line typed into a script running in its terminal", async (t) => {
  const dir = await temporary(t);
  const world = herdr(dir);
  const sent = [];
  world.host.hc = async (args) => (args[0] === "send" ? (sent.push(args), { code: 0, stdout: "" })
    : args[0] === "get" ? { code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: 90, argv: ["bash", "long-job.sh"] } }) } : { code: 0, stdout: "" });
  const mod = await load("kanso-sleep/sleepwork.js", ["comeBack", "stopIn"], world.host);
  assert.equal(await mod.comeBack({ terminal: "t1", cwd: "/w", resume: C1, wake: ["claude", "--resume", C1], name: "Alice" }, { sleep: async () => {} }), "out");
  assert.deepEqual(sent, [], "bash in front is a program running, not the terminal's prompt");
});

test("a space made for a wake is never closed, nor its starter tab, once you use them", async () => {
  const made = [], pn = [], fgs = {}, strip = {};
  const sp = [];
  let opens = false;
  const host = { home: () => HOME, spaces: () => sp, panes: () => pn, shared: (k) => (k === "strip.state" ? strip : null), setShared: () => {},
    hc: async (args) => (args[0] === "get" ? { code: 0, stdout: JSON.stringify({ pid: 1, foreground: fgs[args[1]] ?? null }) } : { code: 0, stdout: "" }),
    run: (cmd, args) => {
      made.push([cmd, args]);
      if (cmd === "space.new") { sp.push({ id: "mine", name: args.name, folder: args.folder, tabs: [{ id: "s1" }] }); pn.push({ pane: "ps", terminal: "ts", tab: "s1" }); fgs.ts = { pid: 9, argv: ["vim"] }; } // you edit in it at once
      if (cmd === "tab.new" && opens) { sp[0].tabs.push({ id: "tb1", name: args.name }); pn.push({ pane: "pA", terminal: "tA", tab: "tb1" }); strip.tb1 = { cols: [{ panes: ["pA"] }] }; }
    } };
  const { openTab } = await load("kanso-arrange/tabkit.js", ["openTab"], host);
  const a = { name: "x", cols: [{ w: 1, panes: [{ argv: ["npm", "run", "dev"] }] }] }, create = { name: "w", folder: "/f", key: ":/f" }, c = { sleep: async () => {} };
  await assert.rejects(openTab(a, c, { create }), /did not open the tab/);
  assert.deepEqual(made.filter(([cmd]) => cmd === "space.close" || cmd === "tab.close"), [], "failed: what you work in stays");
  made.length = 0; sp.length = 0; pn.length = 0; opens = true;
  await openTab(a, c, { create });
  assert.deepEqual(made.filter(([cmd]) => cmd === "tab.close"), [], "woke: its starter tab stays, as you use it");
});

for (const platform of ["macos", "linux", "windows"]) {
  test(`an agent brought back gets nothing typed into a program you start while its conversation is looked for on ${platform}`, async (t) => {
    const world = herdr(await temporary(t));
    const sent = [];
    let fg = null;
    world.host.window = () => ({ platform });
    world.host.hc = async (args) => (args[0] === "send" ? (sent.push(args), { code: 0, stdout: "" })
      : args[0] === "get" ? { code: 0, stdout: JSON.stringify({ pid: 1, foreground: fg }) } : { code: 0, stdout: "" });
    world.host.processApi = withSessionLookup(async () => { fg = { pid: 4242, argv: ["vim"] }; return null; });
    const { comeBack } = await load("kanso-sleep/sleepwork.js", ["comeBack"], world.host);
    assert.equal(await comeBack({ terminal: "t1", cwd: "/w", resume: C1, wake: ["claude", "--resume", C1], name: "Alice" }, { sleep: async () => {} }), "out");
    assert.deepEqual(sent, []);
  });
}

test("a wake that could neither prove an agent back nor end it keeps its terminal to look at: the next wake waits for it", async (t) => {
  let blind = true;
  const { world, view, store } = await asleepInKanso(t, (w) => {
    const hc = w.host.hc;
    let seen = 0; // its pane is found; then Herdr stops answering for it
    w.host.hc = async (args) => (blind && args[0] === "get" && args[1] === "t-new-1" && ++seen > 1 ? { code: 1, stdout: "" } : hc(args));
  });
  const [shown] = await store.asleep();
  const first = cx();
  view.wake(shown, first.c);
  await first.drain();
  assert.deepEqual(world.killed, []);
  assert.deepEqual(clone(world.labels.at(-1)), ["t-new-1", "kanso.wakes="], "not proved back: its terminal no longer says it runs it");
  blind = false; // Herdr answers again; the agent this wake started may still be loading its conversation there
  const [again] = await store.asleep();
  const second = cx();
  view.wake(again, second.c);
  await second.drain();
  assert.match(String(view.error), /may still run in t-new-1/);
  assert.equal(world.ran.filter(([cmd]) => cmd === "tab.new").length, 1, "never a second launch");
});

test("a tab that came too late is closed only while it holds just its own pane; one you opened a pane in stays, and so does its space", async () => {
  const run = async (create) => {
    const made = [], pn = [], sp = create ? [] : [{ id: "w", name: "w", folder: "/f", tabs: [] }];
    let asked = null;
    const host = { home: () => HOME, spaces: () => sp, panes: () => pn, shared: () => null, setShared: () => {},
      hc: async () => ({ code: 0, stdout: JSON.stringify({ pid: 1, foreground: null }) }),
      run: (cmd, args) => { made.push([cmd, args]); if (cmd === "space.new") sp.push({ id: "mine", name: args.name, folder: args.folder, tabs: [] }); if (cmd === "tab.new") asked = args; } };
    const { openTab } = await load("kanso-arrange/tabkit.js", ["openTab"], host);
    // Herdr shows the tab only during the wait after giving up; you open an editor beside its pane at once.
    const c = { sleep: async (ms) => { if (ms === 3000 && asked) { sp[0].tabs.push({ id: "late", name: asked.name }); pn.push({ pane: "p1", terminal: "t1", tab: "late" }, { pane: "p2", terminal: "t2", tab: "late" }); } } };
    const err = await openTab({ name: "x", cols: [{ w: 1, panes: [{ argv: ["npm", "run", "dev"] }] }] }, c, create ? { create } : { space: sp[0] }).catch((e) => e);
    return { made: made.filter(([cmd]) => cmd === "tab.close" || cmd === "space.close"), pending: err.pending };
  };
  assert.deepEqual(clone(await run(null)), { made: [], pending: 1 }, "its tab stays, with your editor, and the wake stays pending");
  assert.deepEqual(clone(await run({ name: "w", folder: "/f", key: ":/f" })), { made: [], pending: 1 }, "so does the space made for it");
});

test("a tab that came too late, where you opened an editor and closed its pane, is yours: it stays, and so does its space", async () => {
  const run = async (create, fg) => {
    const made = [], pn = [], sp = create ? [] : [{ id: "w", name: "w", folder: "/f", tabs: [] }];
    let asked = null;
    const host = { home: () => HOME, spaces: () => sp, panes: () => pn, shared: () => null, setShared: () => {},
      hc: async () => ({ code: 0, stdout: JSON.stringify({ pid: 1, foreground: fg }) }),
      run: (cmd, args) => { made.push([cmd, args]); if (cmd === "space.new") sp.push({ id: "mine", name: args.name, folder: args.folder, tabs: [] }); if (cmd === "tab.new") asked = args; } };
    const { openTab } = await load("kanso-arrange/tabkit.js", ["openTab"], host);
    const c = { sleep: async (ms) => { if (ms === 3000 && asked) { sp[0].tabs.push({ id: "late", name: asked.name }); pn.push({ pane: "p2", terminal: "t2", tab: "late" }); } } };
    const err = await openTab({ name: "x", cols: [{ w: 1, panes: [{ argv: ["claude", "--resume", "c1"], resume: "c1" }] }] }, c, create ? { create } : { space: sp[0] }).catch((e) => e);
    return { made: made.filter(([cmd]) => cmd === "tab.close" || cmd === "space.close").map(([cmd]) => cmd), pending: err.pending };
  };
  const vim = { pid: 9, argv: ["vim", "notes.md"] }, agent = { pid: 9, argv: ["claude", "--resume", "c1"] };
  assert.deepEqual(clone(await run(null, vim)), { made: [], pending: 1 });
  assert.deepEqual(clone(await run({ name: "w", folder: "/f", key: ":/f" }, vim)), { made: [], pending: 1 });
  assert.deepEqual(clone(await run(null, agent)), { made: ["tab.close"], pending: 0 }, "its own pane alone, on its conversation: its own to close");
});

test("a wake never starts a conversation another terminal is starting, even before its session record exists", async (t) => {
  const { world, view, store } = await asleepInKanso(t);
  // A wake that timed out long ago left its claude loading the conversation in t-old.
  world.panes.push({ pane: "po", terminal: "t-old", tab: "tb-x", argv: ["claude", "--resume", C1] });
  const [shown] = await store.asleep();
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.match(String(view.error), /is starting on its conversation in t-old/);
  assert.equal(world.ran.filter(([cmd]) => cmd === "tab.new").length, 0);
});

test("a wake whose name can't be put back keeps it, for the sidebar to put back", async (t) => {
  const { world, view, store } = await asleepInKanso(t);
  const [shown] = await store.asleep();
  const { c, drain } = cx();
  world.failLabels = true;
  view.wake(shown, c);
  await drain();
  assert.deepEqual(clone(await store.asleep(true)), [], "awake");
  assert.match(String(view.error), /could not be put back/);
  assert.equal((await store.kdb.read(`SELECT restore FROM agents WHERE id='${C1}'`))[0].restore, "Hashiko");
});

test("a wake never starts a conversation that already runs", { skip: psMissing }, async (t) => {
  const { world, view, store } = await asleepInKanso(t);
  const { mkdir, writeFile } = await import("node:fs/promises");
  const home = await temporary(t);
  await mkdir(join(home, ".claude", "sessions"), { recursive: true });
  // A process named claude stands in for it (this node, by a link named claude).
  const { symlink } = await import("node:fs/promises");
  const { spawn } = await import("node:child_process");
  const bin = join(home, "claude");
  await symlink(process.execPath, bin);
  const fake = spawn(bin, ["-e", "setTimeout(() => {}, 20000)"]);
  t.after(() => fake.kill());
  await new Promise((r) => setTimeout(r, 300));
  await writeFile(join(home, ".claude", "sessions", `${fake.pid}.json`), JSON.stringify({ pid: fake.pid, sessionId: C1 }));
  // A stale record whose pid is now another program (this test's node): not it.
  await writeFile(join(home, ".claude", "sessions", `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: "00000000-0000-4000-8000-000000000009" }));
  world.host.home = () => home;
  const mod = await load("kanso-sleep/main.js", ["Sleep", "runningOn"], world.host);
  assert.equal(await mod.runningOn(C1), fake.pid, "a live claude on it");
  assert.equal(await mod.runningOn("00000000-0000-4000-8000-000000000009"), null, "a pid reused by another program is not that conversation");
  await writeFile(join(home, ".claude", "sessions", `${fake.pid}.json`), JSON.stringify({ pid: fake.pid, sessionId: C1, procStart: "Mon Jan  1 00:00:00 2001" }));
  assert.equal(await mod.runningOn(C1), null, "a claude that started at another time than its record says is not it");
  const { execFileSync } = await import("node:child_process");
  const started = execFileSync("ps", ["-p", String(fake.pid), "-o", "lstart="], { env: { ...process.env, TZ: "UTC", LC_ALL: "C" } }).toString().trim();
  await writeFile(join(home, ".claude", "sessions", `${fake.pid}.json`), JSON.stringify({ pid: fake.pid, sessionId: C1, procStart: started }));
  assert.equal(await mod.runningOn(C1), fake.pid, "one that started when its record says: it");
  await writeFile(join(home, ".claude", "sessions", `${fake.pid}.json`), JSON.stringify({ pid: fake.pid, sessionId: C1 }));
  const v = new mod.Sleep();
  Object.assign(v, { store, busy: null, error: null, view: "list" });
  const [shown] = await store.asleep();
  const { c, drain } = cx();
  v.wake(shown, c);
  await drain();
  assert.match(String(v.error), /already runs on its conversation/);
  assert.equal(world.ran.filter(([cmd]) => cmd === "tab.new").length, 0, "nothing opened");
  assert.equal((await store.asleep(true)).length, 1, "still asleep, to wake once that one has ended");
  void view;
});

test("a sleep that stopped half way: its old pid, now another claude, does not keep it asleep", { skip: psMissing }, async (t) => {
  const dir = await temporary(t);
  const world = herdr(dir);
  const { symlink } = await import("node:fs/promises");
  const { spawn } = await import("node:child_process");
  const bin = join(dir, "claude");
  await symlink(process.execPath, bin);
  const fake = spawn(bin, ["-e", "setTimeout(() => {}, 20000)"]);
  t.after(() => fake.kill());
  await new Promise((r) => setTimeout(r, 300));
  const mod = await load("kanso-sleep/main.js", ["Sleep", "Store", "Kdb", "stillThere"], world.host);
  assert.equal(await mod.stillThere(fake.pid, Date.now()), true, "a claude that ran before the sleep: still that one");
  assert.equal(await mod.stillThere(fake.pid, Date.now() - 60_000), false, "one started after the sleep: another process with that pid");
  assert.equal(await mod.stillThere(process.pid, Date.now()), false, "not claude: not it");
  const store = new mod.Store(new mod.Kdb(databaseTimer), join(dir, "none"));
  const kanso = world.spaces[2];
  const pane = { argv: ["claude"], cwd: "/w/kanso", name: "Alice", terminal: "t3q", tab: "tb-herdr-kanso", pid: fake.pid };
  // One from an older sleep (no conversation kept) and one with its conversation, both on that pid.
  await store.sleep(":/f", { name: "Alice", space: { id: kanso.id, name: kanso.name }, per: null, saved: Date.now() - 3_600_000,
    cols: [{ w: 1, panes: [pane, { ...pane, name: "Bob", terminal: "t3r", resume: C1, wake: ["claude", "--resume", C1] }] }] });
  // A sleep from an older Kanso, which ran in its dialog: the window closed under it long ago.
  await store.kdb.run(`UPDATE sleeps SET state=NULL, pending='legacy', pending_at=${Date.now() - 3_600_000};`);
  const view = new mod.Sleep();
  Object.assign(view, { store, busy: null, error: null, view: "list" });
  const [shown] = await store.asleep();
  const { c, drain } = cx();
  view.wake(shown, c);
  await drain();
  assert.doesNotMatch(String(view.error), /still runs/, "pid reused since the sleep: neither is held back by it");
  assert.equal(world.ran.filter(([cmd]) => cmd === "tab.new").length, 1, "it wakes");
});

test("ending an agent brought back stops that process only, never what you started there since", async (t) => {
  const dir = await temporary(t);
  const world = herdr(dir);
  const kills = [];
  world.host.exec = async (c, a, o) => (c === "kill" ? (kills.push(a), { code: 0, stdout: "" }) : exec(c, a, o));
  const mod = await load("kanso-sleep/sleepwork.js", ["comeBack", "stopIn"], world.host);
  world.panes.push({ pane: "p9", terminal: "t9", tab: "tb-x", argv: ["vim"] }); // its foreground is pid 77 now
  assert.equal(await mod.stopIn("t9", { sleep: async () => {} }, 111), true, "111 is gone: nothing of it to stop");
  assert.deepEqual(kills, [], "vim (77) is left alone");
});

test("a wake that can't tell whether its conversation runs does not wake", async (t) => {
  let denied = true;
  const { world, store } = await asleepInKanso(t, (w) => {
    w.host.processApi = withSessionLookup(async () => {
      if (denied) throw new Error("Session lookup denied");
      return null;
    });
  });
  const mod = await load("kanso-sleep/main.js", ["Sleep", "runningOn"], world.host);
  await assert.rejects(mod.runningOn(C1), /Session lookup denied/);
  const v = new mod.Sleep();
  Object.assign(v, { store, busy: null, error: null, view: "list" });
  const [shown] = await store.asleep();
  const { c, drain } = cx();
  v.wake(shown, c);
  await drain();
  assert.match(String(v.error), /could not be checked/);
  assert.equal(world.ran.filter(([cmd]) => cmd === "tab.new").length, 0, "nothing opened");
  denied = false;
  assert.equal(await mod.runningOn(C1), null, "readable and none there: none runs");
});

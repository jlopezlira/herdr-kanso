import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load, clone, context, exec as run, nativeWindow } from "./helpers.mjs";

const ROOT = "/repo";
const HOME = "/home/me";
const SESSION = "07e8cebe-420b-47d2-9fba-a76c2e4dd30d";
const TITLE = "Named in this conversation";

const exists = (root, rels) => rels.map((rel) => `${root}/${rel}`);

test("a conversation's paths, whatever shape, stay inside the project, newest first, each once", async () => {
  const { namedIn, pathsIn, NAMED, NAMED_CAP } = await load("kanso-panel/transcript.js", ["namedIn", "pathsIn", "NAMED", "NAMED_CAP"]);
  const text = [
    "absolute /repo/src/abs.js end",
    "relative src/rel.js",
    "lines a/b.js:12 and src/app.tsx:40:3",
    '"src/quoted.js"',
    "`src/ticked.js`",
    "```",
    "src/fenced.js",
    "```",
    "(src/paren.js)",
    "see \\n./src/escaped.js next",
    "/tmp/outside.js",
    "src/missing.js",
    "folder src/api and src/dir.js",
    "src/dup.js",
    "./src/dup.js",
    ...Array.from({ length: 10 }, (_, i) => `n${i}.js`),
  ].join("\n");
  const found = pathsIn(text, NAMED);
  assert.ok(found.includes("/repo/src/abs.js"), "absolute");
  assert.ok(found.includes("src/rel.js"), "relative");
  assert.ok(found.includes("a/b.js"), "a trailing line number is not part of the path");
  assert.ok(found.includes("src/app.tsx"), "line and column");
  assert.ok(found.includes("src/quoted.js") && found.includes("src/ticked.js") && found.includes("src/fenced.js") && found.includes("src/paren.js"));
  assert.ok(found.includes("./src/escaped.js"), "a JSON line break before a path");
  assert.ok(found.includes("/tmp/outside.js") && found.includes("src/missing.js") && found.includes("src/dir.js"));
  assert.equal(found.includes("src/api"), false, "a folder has no extension, so it is not a file");
  assert.equal(found.filter((p) => p === "src/dup.js" || p === "./src/dup.js").length, 2, "the raw text keeps both spellings; resolving makes them one");
  const files = exists(ROOT, [
    "src/abs.js", "src/rel.js", "a/b.js", "src/app.tsx", "src/quoted.js", "src/ticked.js", "src/fenced.js",
    "src/paren.js", "src/escaped.js", "src/dup.js", "src/dir.js",
    ...Array.from({ length: 10 }, (_, i) => `n${i}.js`),
  ]).filter((p) => !p.endsWith("/src/dir.js"));
  const named = namedIn(text, { root: ROOT, cwd: ROOT, homeDir: HOME, files });
  assert.equal(named.some((row) => row.path === "src/missing.js" || row.path === "src/dir.js" || row.path.startsWith("/")), false, "missing, a folder and outside the project are left out");
  const once = namedIn("src/dup.js\n./src/dup.js\nsrc/other.js\n", { root: ROOT, cwd: ROOT, homeDir: HOME, files: exists(ROOT, ["src/dup.js", "src/other.js"]) });
  assert.deepEqual(clone(once.map((row) => [row.path, row.folder])), [["src/other.js", "src"], ["src/dup.js", "src"]]);
  assert.deepEqual(clone(named.map((row) => row.path)), Array.from({ length: NAMED_CAP }, (_, i) => `n${9 - i}.js`), "the newest eight");
  const hole = namedIn(text, { root: ROOT, cwd: ROOT, homeDir: HOME, files: files.filter((p) => !p.endsWith("/n9.js") && !p.endsWith("/n8.js")) });
  assert.deepEqual(clone(hole.map((row) => row.path)), Array.from({ length: NAMED_CAP }, (_, i) => `n${7 - i}.js`));
  assert.equal(namedIn("no paths here", { root: ROOT, cwd: ROOT, homeDir: HOME, files }).length, 0);
  assert.equal(namedIn("/tmp/outside.js only", { root: ROOT, cwd: ROOT, homeDir: HOME, files }).length, 0);
});

test("the file scan and the pure read name the same paths", async () => {
  const { scanFile, pathsIn, NAMED } = await load("kanso-panel/transcript.js", ["scanFile", "pathsIn", "NAMED"], { exec: run, window: nativeWindow });
  const dir = mkdtempSync(join(tmpdir(), "kanso-named-"));
  try {
    const file = join(dir, "t.jsonl");
    const text = [
      "wrote /repo/src/abs.js today",
      "and src/rel.js",
      "see a/b.js:12",
      '"src/quoted.js"',
      "```",
      "src/fenced.js",
      "```",
      "/tmp/outside.js",
      "src/missing.js",
      "src/api",
    ].join("\n") + "\n";
    writeFileSync(file, text);
    const got = await scanFile(file, "0", "", null, NAMED);
    assert.equal(got.code, 0);
    assert.deepEqual(clone(got.paths), clone(pathsIn(text, NAMED)));
    const again = await scanFile(file, got.size, got.mark, null, NAMED);
    assert.equal(again.code, 3, "nothing new: the next read starts at the stored offset and stops");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Windows names files with the same scanner, any extension", async () => {
  const calls = [];
  const { scanFile, NAMED, PATTERN } = await load("kanso-panel/transcript.js", ["scanFile", "NAMED", "PATTERN"], {
    window: () => ({ platform: "windows" }),
    exec: async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: "8\n0\nab\nsrc/a.js\n" }; },
  });
  const got = await scanFile("C:/repo/t.jsonl", "0", "", null, NAMED);
  assert.deepEqual(clone(got.paths), ["src/a.js"]);
  const script = calls.map((c) => c.join("\n")).join("\n");
  assert.match(script, /KansoTranscript/);
  assert.match(script, /\[A-Za-z0-9\]\{1,12\}/);
  assert.equal(calls.filter((c) => c[0] === "pwsh" || c[0] === "powershell").length, 1, "one scan command");
  assert.ok(PATTERN.includes("png") && !PATTERN.includes("{1,12}"), "pictures keep their own extensions");
});

function screen() {
  const texts = [];
  const clicks = new Map();
  const calls = [];
  const make = () => {
    const self = { id: "" };
    const proxy = new Proxy(self, { get(_target, name) {
      if (name === "then") return undefined;
      if (name === "when") return (cond, apply) => { if (cond) apply(proxy); return proxy; };
      if (name === "child") return (value) => { if (typeof value === "string") texts.push(value); return proxy; };
      if (name === "children") return (list) => { for (const item of list ?? []) if (typeof item === "string") texts.push(item); return proxy; };
      return (...args) => {
        calls.push([String(name), args[0]]);
        if (name === "id") self.id = args[0];
        if (name === "on_click") clicks.set(self.id, args[0]);
        return proxy;
      };
    } });
    return proxy;
  };
  const factory = { new: make, vertical: make, markdown: make };
  return { texts, clicks, calls, make, factory };
}

function agentWorld(over = {}) {
  return {
    hidden: [], active: true, panelHidden: false, on: null, agent: true,
    session: { pid: 7, sessionId: SESSION, cwd: ROOT, startedAt: Date.now() - 5000 },
    transcript: ["/repo/src/new.js", "/repo/README.md", "/repo/src/shot.png"].join("\n") + "\n",
    files: ["/repo/src/new.js", "/repo/README.md", "/repo/src/shot.png"],
    ...over,
  };
}

const transcriptCmd = (c) => c.cmd === "hc" || c.cmd === "read" || c.cmd === "ps"
  || (c.cmd === "sh" && (String(c.args[1]).startsWith('f="$1"') || String(c.args[1]).startsWith("for f;") || String(c.args[1]).includes('printf %s')));

async function openFiles(world, { db = null, paint = null } = {}) {
  const cmds = [];
  const ui = paint ?? screen();
  const tree = ["\x055 9", "\x01", "./keep.js", "\x02", "\x03", "\x04"].join("\0") + "\0";
  const host = {
    div: ui.make, svg: ui.make, h_flex: ui.make, v_flex: ui.make, v_virtual_list: () => ui.make(),
    Scrollbar: { vertical: ui.make }, Editor: ui.factory, theme: () => ({ dim: "#888", hover: "#111", foreground: "#eee", background: "#111", border: "#222", muted: "#999", ansi1: "#f00", ansi2: "#0f0", blocked: "#f00" }),
    window: () => ({ active: world.active, platform: "macos" }),
    layout: () => ({ id: "root", children: [{ id: "panel-body", hidden: world.panelHidden }] }),
    location: () => ({ cwd: ROOT, on: world.on }),
    key: () => JSON.stringify({ cwd: ROOT, on: world.on }),
    focused: () => (world.agent ? { terminal: "t1", cwd: ROOT } : null),
    terminals: () => (world.agent ? [{ address: "t1", cwd: ROOT, status: "working", program: { agent: true, name: "checkout" }, labels: { "kanso.name": "checkout" } }] : []),
    panes: () => (world.agent ? [{ terminal: "t1", cwd: ROOT, program: { agent: true, name: "checkout" } }] : []),
    shared: (k) => (k === "kanso.hidden" ? world.hidden : null),
    setShared() {},
    home: () => HOME,
    watchFolder: async () => { throw new Error("no watch"); },
    readTextFile: async (path, options) => {
      cmds.push({ cmd: "read", args: [path], on: options?.on ?? null });
      return world.session && path.endsWith(`/${world.session.pid}.json`) ? JSON.stringify(world.session) : null;
    },
    hc: async (args) => {
      cmds.push({ cmd: "hc", args, on: null });
      if (args[0] === "get") return { code: 0, stdout: JSON.stringify({ foreground: world.session ? { pid: world.session.pid, argv: ["claude"] } : null }) };
      return { code: 0, stdout: "" };
    },
    exec: async (cmd, args = [], options = {}) => {
      cmds.push({ cmd, args, on: options.on ?? null });
      if (options.on && (cmd === "pwsh" || cmd === "powershell")) return { code: 127, stdout: "", stderr: "" };
      if (cmd === "uname") return { code: 0, stdout: "Darwin\n", stderr: "" };
      if (cmd === "stat") return { code: 0, stdout: "5 9\n", stderr: "" };
      if (cmd === "find") return { code: 0, stdout: "./keep.js\0", stderr: "" };
      if (cmd === "git") return { code: 128, stdout: "", stderr: "not a git repository" };
      if (cmd === "ps") return { code: 0, stdout: "00:05\n", stderr: "" };
      if (cmd === "sh" && String(args[1]).startsWith("root=$1")) return { code: 0, stdout: tree, stderr: "" };
      if (cmd === "sh" && String(args[1]).includes('printf %s')) return { code: 0, stdout: HOME, stderr: "" };
      if (cmd === "sh" && String(args[1]).startsWith('f="$1"')) {
        const from = args[4];
        const size = String(world.transcript.length);
        if (from === size) return { code: 3, stdout: "", stderr: "" };
        return { code: 0, stdout: `${size}\n${from}\nm\n${world.transcript}`, stderr: "" };
      }
      if (cmd === "sh" && String(args[1]).startsWith("for f;")) {
        const there = args.slice(3).filter((p) => world.files.includes(p));
        return { code: 0, stdout: there.map((p) => `${p}\n`).join(""), stderr: "" };
      }
      return { code: 1, stdout: "", stderr: cmd };
    },
  };
  const { Files } = await load("kanso-panel/files.js", ["Files"], host);
  const { cx, drain } = context();
  const afters = [];
  cx.timer = { every() {}, after(_ms, fn) { afters.push(fn); } };
  const panel = new Files(db);
  panel.init(cx);
  await drain();
  return { panel, cmds, cx, drain, afters, ui };
}

test("Files puts the named files first, and a click opens one as the tree does", async () => {
  const { T } = await load("kanso-panel/ui.js", ["T"]);
  const world = agentWorld();
  const { panel, ui } = await openFiles(world);
  assert.deepEqual(clone(panel.named.map((row) => row.path)), ["src/shot.png", "README.md", "src/new.js"]);
  assert.equal(panel.named[2].folder, "src");
  assert.equal(panel.note, "checkout");
  const actions = [];
  panel.show = (path) => actions.push(["show", path]);
  panel.read = (path) => actions.push(["read", path]);
  panel.render({});
  assert.ok(ui.texts.includes(TITLE));
  assert.ok(ui.texts.includes("src"));
  assert.ok(ui.calls.some((c) => c[0] === "text_size" && c[1] === T.body));
  assert.ok(ui.calls.some((c) => c[0] === "text_color" && c[1] === "#888"));
  ui.clicks.get("named-src/shot.png")({}, {});
  ui.clicks.get("named-README.md")({}, {});
  ui.clicks.get("named-src/new.js")({}, {});
  assert.deepEqual(actions, [["read", "src/shot.png"], ["read", "README.md"], ["show", "src/new.js"]]);
});

test("nothing named draws no section", async () => {
  const world = agentWorld({ transcript: "no file here\n", files: [] });
  const { panel, ui } = await openFiles(world);
  assert.deepEqual(clone(panel.named), []);
  panel.render({});
  assert.equal(ui.texts.includes(TITLE), false);
  const bare = screen();
  const { Files } = await load("kanso-panel/files.js", ["Files"], {
    div: bare.make, svg: bare.make, h_flex: bare.make, v_flex: bare.make,
    Scrollbar: { vertical: bare.make }, theme: () => ({}), key: () => "k",
    shared: () => null, window: () => ({ active: true }), layout: () => null,
  });
  const panel2 = new Files();
  Object.assign(panel2, { context: "k", root: ROOT, folders: new Set(), marks: {}, entries: new Map([["", []]]) });
  panel2.render({});
  assert.equal(bare.texts.includes(TITLE), false, "no agent and nothing stored: no caption");
});

test("hiding the piece reads nothing, and neither does no agent, a window behind, or a hidden panel", async () => {
  const hidden = await openFiles(agentWorld({ hidden: ["files.named"] }));
  assert.equal(hidden.cmds.filter(transcriptCmd).length, 0);
  hidden.panel.render({});
  assert.equal(hidden.ui.texts.includes(TITLE), false);
  const none = await openFiles(agentWorld({ agent: false }));
  assert.equal(none.cmds.filter(transcriptCmd).length, 0);
  assert.deepEqual(clone(none.panel.named), []);
  const behind = await openFiles(agentWorld({ active: false }));
  behind.panel.refresh(behind.cx);
  await behind.drain();
  assert.equal(behind.cmds.filter(transcriptCmd).length, 0, "behind: the folder may list, the conversation does not");
  const covered = await openFiles(agentWorld({ panelHidden: true }));
  assert.equal(covered.cmds.filter(transcriptCmd).length, 0);
});

test("a local refresh reads on from the stored offset, and a remote one uses that computer", async () => {
  const saved = [];
  const db = {
    named: async () => ({ size: "0", mark: "", paths: [] }),
    saveNamed: async (...args) => { saved.push(args); },
  };
  const world = agentWorld();
  const first = await openFiles(world, { db });
  const scans = first.cmds.filter((c) => c.cmd === "sh" && String(c.args[1]).startsWith('f="$1"'));
  const checks = first.cmds.filter((c) => c.cmd === "sh" && String(c.args[1]).startsWith("for f;"));
  assert.equal(scans.length, 1);
  assert.equal(scans[0].args[4], "0");
  assert.match(scans[0].args[5], /\[A-Za-z0-9\]\{1,12\}/);
  assert.equal(scans[0].on, null);
  assert.equal(checks.length, 1);
  assert.equal(first.cmds.filter((c) => c.cmd === "hc" && c.args[0] === "get").length, 1);
  assert.equal(first.cmds.filter((c) => c.cmd === "ps").length, 1);
  assert.equal(first.cmds.filter((c) => c.cmd === "read").length, 1);
  assert.equal(saved.length, 1);
  first.cmds.length = 0;
  world.files = ["/repo/src/new.js", "/repo/README.md"];
  first.panel.refresh(first.cx);
  await first.drain();
  const again = first.cmds.filter((c) => c.cmd === "sh" && String(c.args[1]).startsWith('f="$1"'));
  assert.equal(again.length, 1);
  assert.equal(again[0].args[4], String(world.transcript.length), "the next refresh starts at the stored offset");
  assert.deepEqual(clone(first.panel.named.map((row) => row.path)), ["README.md", "src/new.js"], "a file that is gone drops without a second copy of the conversation");

  const fresh = agentWorld();
  const stored = String(fresh.transcript.length);
  const recalled = await openFiles(fresh, { db: { named: async () => ({ size: stored, mark: "m", paths: ["/repo/src/new.js", "/repo/README.md", "/repo/src/shot.png"] }), saveNamed: async () => {} } });
  const fromStore = recalled.cmds.find((c) => c.cmd === "sh" && String(c.args[1]).startsWith('f="$1"'));
  assert.equal(fromStore.args[4], stored);
  assert.equal(fromStore.args[7], "m");
  assert.equal(recalled.panel.named.length, 3, "exit 3 keeps the paths stored from last time");

  const remote = await openFiles(agentWorld({ on: "light" }));
  const remoteScan = remote.cmds.filter((c) => c.cmd === "sh" && String(c.args[1]).startsWith('f="$1"'));
  const remoteHome = remote.cmds.filter((c) => c.cmd === "sh" && String(c.args[1]).includes('printf %s'));
  const remoteCheck = remote.cmds.filter((c) => c.cmd === "sh" && String(c.args[1]).startsWith("for f;"));
  assert.equal(remoteScan.length, 1);
  assert.equal(remoteScan[0].on, "light");
  assert.equal(remoteHome.length, 1);
  assert.equal(remoteHome[0].on, "light");
  assert.equal(remoteCheck[0].on, "light");
  assert.equal(remote.cmds.filter((c) => c.cmd === "ps" && c.on === "light").length, 1);
  assert.equal(remote.cmds.filter((c) => c.cmd === "read" && c.on === "light").length, 1);
  assert.equal(remote.cmds.filter((c) => c.cmd === "hc").every((c) => c.on === null), true, "the process in front is read here");
  assert.ok(remote.cmds.some((c) => (c.cmd === "pwsh" || c.cmd === "powershell") && c.on === "light"), "that computer is probed with the folder list");
  const before = remote.cmds.filter((c) => c.cmd === "sh" && String(c.args[1]).startsWith('f="$1"')).length;
  remote.afters.at(-1)(remote.cx);
  await remote.drain();
  assert.equal(remote.cmds.filter((c) => c.cmd === "sh" && String(c.args[1]).startsWith('f="$1"')).length, before, "a quiet poll stats the folder and does not read the conversation");
  assert.equal(remote.cmds.filter((c) => c.cmd === "stat").length, 1);
});

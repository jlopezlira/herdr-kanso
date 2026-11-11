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
const STORE = "kanso.pieces";

test("the shell scan names a conversation's paths, and only files inside the project are kept", async () => {
  const { scanFile, namedCandidates, namedFound, namedRowsFrom, NAMED, NAMED_CAP } = await load(
    "kanso-panel/transcript.js",
    ["scanFile", "namedCandidates", "namedFound", "namedRowsFrom", "NAMED", "NAMED_CAP"],
    { exec: run, window: nativeWindow },
  );
  const dir = mkdtempSync(join(tmpdir(), "kanso-named-"));
  try {
    const file = join(dir, "t.jsonl");
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
    ].join("\n") + "\n";
    writeFileSync(file, text);
    const got = await scanFile(file, "0", "", null, NAMED);
    assert.equal(got.code, 0);
    for (const path of ["/repo/src/abs.js", "src/rel.js", "a/b.js", "src/app.tsx", "src/quoted.js", "src/ticked.js", "src/fenced.js", "src/paren.js", "./src/escaped.js", "/tmp/outside.js", "src/missing.js", "src/dir.js"]) {
      assert.ok(got.paths.includes(path), path);
    }
    assert.equal(got.paths.includes("src/api"), false, "a folder has no extension, so it is not a file");
    assert.ok(got.paths.includes("src/dup.js") && got.paths.includes("./src/dup.js"), "the scan keeps both spellings");
    const again = await scanFile(file, got.size, got.mark, null, NAMED);
    assert.equal(again.code, 3, "nothing new: the next read starts at the stored offset and stops");
    const candidates = namedCandidates(got.paths, { root: ROOT, cwd: ROOT, homeDir: HOME });
    const live = new Set([
      "/repo/src/abs.js", "/repo/src/rel.js", "/repo/a/b.js", "/repo/src/app.tsx", "/repo/src/quoted.js",
      "/repo/src/ticked.js", "/repo/src/fenced.js", "/repo/src/paren.js", "/repo/src/escaped.js", "/repo/src/dup.js",
    ]);
    const there = await namedFound(candidates, async (batch) => batch.filter((path) => live.has(path)));
    const rows = namedRowsFrom(there, ROOT);
    assert.equal(rows.some((row) => row.path === "src/missing.js" || row.path === "src/dir.js" || row.path.startsWith("/")), false);
    assert.equal(rows.filter((row) => row.path === "src/dup.js").length, 1);
    assert.ok(rows.length <= NAMED_CAP);
    assert.equal(rows[0].path, "src/dup.js");
    assert.equal(rows[0].folder, "src");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("existence is asked in batches of 24 and stops once eight files exist", async () => {
  const { namedFound, NAMED_BATCH, NAMED_CAP } = await load("kanso-panel/transcript.js", ["namedFound", "NAMED_BATCH", "NAMED_CAP"]);
  const candidates = Array.from({ length: 500 }, (_, i) => `/repo/n${499 - i}.js`);
  const asked = [];
  const eight = await namedFound(candidates, async (batch) => { asked.push(batch.length); return batch; });
  assert.deepEqual(asked, [NAMED_BATCH]);
  assert.equal(eight.length, NAMED_CAP);
  assert.deepEqual(clone(eight), candidates.slice(0, NAMED_CAP));
  const later = [];
  const live = new Set(candidates.slice(30, 38));
  const found = await namedFound(candidates, async (batch) => { later.push([...batch]); return batch.filter((path) => live.has(path)); });
  assert.equal(later.length, 2);
  assert.ok(later.every((batch) => batch.length <= NAMED_BATCH));
  assert.equal(found.length, NAMED_CAP);
  const idle = [];
  assert.deepEqual(clone(await namedFound([], async (batch) => { idle.push(batch); return []; })), []);
  assert.equal(idle.length, 0);
  const none = [];
  const missed = await namedFound(["/repo/a.js"], async (batch) => { none.push(batch); return null; });
  assert.equal(missed, null);
  assert.equal(none.length, 1);
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
  const handlers = {};
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
        if (name === "on_item_click" || name === "on_item_secondary_click") handlers[name] = args[0];
        return proxy;
      };
    } });
    return proxy;
  };
  const factory = { new: make, vertical: make, markdown: make };
  return { texts, clicks, calls, handlers, make, factory };
}

function agentWorld(over = {}) {
  return {
    pieces: {}, active: true, panelHidden: false, on: null, agent: true,
    session: { pid: 7, sessionId: SESSION, cwd: ROOT, startedAt: Date.now() - 5000 },
    transcript: ["/repo/src/new.js", "/repo/README.md", "/repo/src/shot.png"].join("\n") + "\n",
    files: ["/repo/src/new.js", "/repo/README.md", "/repo/src/shot.png"],
    ...over,
  };
}

const transcriptCmd = (c) => c.cmd === "hc" || c.cmd === "read" || c.cmd === "ps"
  || (c.cmd === "sh" && (String(c.args[1]).startsWith('f="$1"') || String(c.args[1]).startsWith("for f;") || String(c.args[1]).includes("printf %s")));
const scanOf = (cmds) => cmds.filter((c) => c.cmd === "sh" && String(c.args[1]).startsWith('f="$1"'));
const existOf = (cmds) => cmds.filter((c) => c.cmd === "sh" && String(c.args[1]).startsWith("for f;"));

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
    shared: (k) => (k === STORE ? world.pieces : null),
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
      if (cmd === "stat" || cmd.endsWith("/stat")) return { code: 0, stdout: "5 9\n", stderr: "" };
      if (cmd === "find") return { code: 0, stdout: "./keep.js\0", stderr: "" };
      if (cmd === "git") return { code: 128, stdout: "", stderr: "not a git repository" };
      if (cmd === "ps") return { code: 0, stdout: "00:05\n", stderr: "" };
      if (cmd === "sh" && String(args[1]).startsWith("root=$1")) return { code: 0, stdout: tree, stderr: "" };
      if (cmd === "sh" && String(args[1]).includes("printf %s")) return { code: 0, stdout: HOME, stderr: "" };
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
  const opened = [];
  const open = panel.openRow.bind(panel);
  panel.openRow = (item, cx, secondary) => { opened.push(item?.path); return open(item, cx, secondary); };
  panel.read = (path) => actions.push(["read", path]);
  panel.render({});
  assert.ok(ui.texts.includes(TITLE));
  assert.ok(ui.texts.includes("src"));
  assert.ok(ui.calls.some((c) => c[0] === "text_size" && c[1] === T.body));
  assert.ok(ui.calls.some((c) => c[0] === "text_color" && c[1] === "#888"));
  ui.clicks.get("named-src/shot.png")({}, {});
  ui.clicks.get("named-README.md")({}, {});
  ui.clicks.get("named-src/new.js")({}, {});
  ui.handlers.on_item_click("keep.js", {});
  assert.deepEqual(actions, [["read", "src/shot.png"], ["read", "README.md"], ["read", "src/new.js"], ["read", "keep.js"]]);
  assert.deepEqual(opened, ["src/shot.png", "README.md", "src/new.js", "keep.js"]);
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
  const hidden = await openFiles(agentWorld({ pieces: { "files.named": "hide" } }));
  assert.equal(hidden.cmds.filter(transcriptCmd).length, 0);
  hidden.panel.render({});
  assert.equal(hidden.ui.texts.includes(TITLE), false);
  const shown = await openFiles(agentWorld());
  assert.ok(shown.cmds.some((c) => c.cmd === "hc"));
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

test("a conversation of 500 files is checked 24 at a time and stops at eight", async () => {
  const names = Array.from({ length: 500 }, (_, i) => `n${i}.js`);
  const world = agentWorld({
    transcript: names.map((name) => `${name}\n`).join(""),
    files: names.map((name) => `${ROOT}/${name}`),
  });
  const { panel, cmds } = await openFiles(world);
  const checks = existOf(cmds);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].args.slice(3).length, 24);
  assert.deepEqual(clone(panel.named.map((row) => row.path)), Array.from({ length: 8 }, (_, i) => `n${499 - i}.js`));
});

test("a local refresh reads on from the stored offset, and a remote one uses that computer", async () => {
  const saved = [];
  const db = {
    named: async () => ({ size: "0", mark: "", paths: [] }),
    saveNamed: async (...args) => { saved.push(args); },
  };
  const world = agentWorld();
  const first = await openFiles(world, { db });
  const scans = scanOf(first.cmds);
  const checks = existOf(first.cmds);
  assert.equal(scans.length, 1);
  assert.equal(scans[0].args[4], "0");
  assert.match(scans[0].args[5], /\[A-Za-z0-9\]\{1,12\}/);
  assert.equal(scans[0].on, null);
  assert.equal(checks.length, 1);
  assert.ok(checks[0].args.slice(3).length <= 24);
  assert.equal(first.cmds.filter((c) => c.cmd === "hc" && c.args[0] === "get").length, 1);
  assert.equal(first.cmds.filter((c) => c.cmd === "ps").length, 1);
  assert.equal(first.cmds.filter((c) => c.cmd === "read").length, 1);
  assert.equal(saved.length, 1);
  const kept = clone(first.panel.named.map((row) => row.path));
  first.cmds.length = 0;
  world.files = ["/repo/src/new.js"];
  first.panel.refresh(first.cx);
  await first.drain();
  assert.deepEqual(first.cmds.filter(transcriptCmd).map((c) => c.cmd === "sh" ? "scan" : c.cmd), ["scan"]);
  assert.equal(scanOf(first.cmds)[0].args[4], String(world.transcript.length), "the next refresh starts at the stored offset");
  assert.deepEqual(clone(first.panel.named.map((row) => row.path)), kept, "a deleted file stays until the conversation grows");
  first.cmds.length = 0;
  world.transcript += "/repo/src/more.js\n";
  world.files = ["/repo/src/new.js", "/repo/README.md", "/repo/src/more.js"];
  first.panel.refresh(first.cx);
  await first.drain();
  const grew = first.cmds.filter(transcriptCmd);
  assert.ok(scanOf(grew).length === 1 && existOf(grew).length >= 1);
  assert.equal(grew.some((c) => c.cmd === "hc" || c.cmd === "ps" || c.cmd === "read" || String(c.args?.[1] ?? "").includes("printf %s")), false);
  assert.deepEqual(clone(first.panel.named.map((row) => row.path)), ["src/more.js", "README.md", "src/new.js"]);

  const fresh = agentWorld();
  const stored = String(fresh.transcript.length);
  const recalled = await openFiles(fresh, { db: { named: async () => ({ size: stored, mark: "m", paths: ["/repo/src/new.js", "/repo/README.md", "/repo/src/shot.png"] }), saveNamed: async () => {} } });
  const fromStore = scanOf(recalled.cmds)[0];
  assert.equal(fromStore.args[4], stored);
  assert.equal(fromStore.args[7], "m");
  assert.equal(recalled.panel.named.length, 3, "the first paint still shows the paths stored from last time");
  fresh.files = [];
  recalled.cmds.length = 0;
  recalled.panel.refresh(recalled.cx);
  await recalled.drain();
  assert.deepEqual(recalled.cmds.filter(transcriptCmd).map((c) => c.cmd === "sh" ? String(c.args[1]).slice(0, 4) : c.cmd), ['f="$']);
  assert.equal(recalled.panel.named.length, 3, "an unchanged conversation does not drop a file that was deleted");

  const remote = await openFiles(agentWorld({ on: "light" }));
  const remoteScan = scanOf(remote.cmds);
  const remoteHome = remote.cmds.filter((c) => c.cmd === "sh" && String(c.args[1]).includes("printf %s"));
  const remoteCheck = existOf(remote.cmds);
  assert.equal(remoteScan.length, 1);
  assert.equal(remoteScan[0].on, "light");
  assert.equal(remoteHome.length, 1);
  assert.equal(remoteHome[0].on, "light");
  assert.equal(remoteCheck[0].on, "light");
  assert.equal(remote.cmds.filter((c) => c.cmd === "ps" && c.on === "light").length, 1);
  assert.equal(remote.cmds.filter((c) => c.cmd === "read" && c.on === "light").length, 1);
  assert.equal(remote.cmds.filter((c) => c.cmd === "hc").every((c) => c.on === null), true, "the process in front is read here");
  assert.ok(remote.cmds.some((c) => (c.cmd === "pwsh" || c.cmd === "powershell") && c.on === "light"), "that computer is probed with the folder list");
  const before = scanOf(remote.cmds).length;
  remote.afters.at(-1)(remote.cx);
  await remote.drain();
  assert.equal(scanOf(remote.cmds).length, before, "a quiet poll stats the folder and does not read the conversation");
  assert.equal(remote.cmds.filter((c) => String(c.cmd).endsWith("stat")).length, 1);
  remote.cmds.length = 0;
  remote.panel.refresh(remote.cx);
  await remote.drain();
  assert.deepEqual(remote.cmds.filter(transcriptCmd).map((c) => [c.cmd, c.on, String(c.args?.[1] ?? "").slice(0, 4)]), [["sh", "light", 'f="$']]);
});

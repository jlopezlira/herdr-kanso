import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm, stat, unlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileApi } from "../kanso/mods/kanso-panel/platform-files.js";
import { load, context, clone } from "./helpers.mjs";

const NAMES = ["bring", "copiedBytes", "copyName", "fileId", "dropCopies", "tooBig", "BYTE_CAP", "CHUNK", "slices", "cutShort", "decodeBase64", "copyFailure", "listFailure", "remoteDue", "machineOf", "appRelative", "drawablePath", "svgPixels", "markdownParts"];
const pure = await load("kanso-panel/remote-file.js", NAMES, { appHome: () => "/app", window: () => ({ platform: "macos" }) });

test("a remote copy is named by machine, path and mtime, and old copies go", () => {
  assert.equal(pure.fileId("light", "/a.png"), pure.fileId("light", "/a.png"));
  assert.notEqual(pure.fileId("light", "/a.png"), pure.fileId("dark", "/a.png"));
  assert.equal(pure.copyName("light", "/a.png", 5, 4, "png"), `${pure.fileId("light", "/a.png")}-5-4.png`);
  const now = 10_000_000;
  const id = pure.fileId("light", "/a.png");
  assert.deepEqual(pure.dropCopies([
    { name: `${id}-1-4.png`, mtime: now },
    { name: `${id}-2-4.png`, mtime: now },
    { name: "stale.png", mtime: now - 86_400_000 - 1 },
    { name: "kept.png", mtime: now },
  ], { id, keep: `${id}-2-4.png`, now, maxAge: 86_400_000 }), [`${id}-1-4.png`, "stale.png"]);
});

test("a copy stops at 20 MB, rejects a cut-short read, and decodes base64", async () => {
  assert.equal(pure.tooBig(pure.BYTE_CAP), false);
  assert.equal(pure.tooBig(pure.BYTE_CAP + 1), true);
  assert.equal(pure.tooBig(Number.NaN), true);
  assert.equal(pure.slices(0).length, 0);
  assert.deepEqual(clone(pure.slices(5, 2)), [{ offset: 0, length: 2 }, { offset: 2, length: 2 }, { offset: 4, length: 1 }]);
  assert.equal(pure.slices(Number.NaN), null);
  assert.equal(pure.cutShort({ truncated: true }), true);
  assert.equal(pure.cutShort({ stdout: "truncated by the host" }), true);
  assert.equal(pure.cutShort({ stdout: "AQIDBA==" }), false);
  assert.deepEqual([...pure.decodeBase64("AQID\nBA==")], [1, 2, 3, 4]);
  assert.throws(() => pure.decodeBase64("!!!!"), /cut short/);
  const ranges = [];
  const small = await pure.copiedBytes(async (range) => { ranges.push(range ?? "whole"); return { code: 0, stdout: "AQIDBA==" }; }, 4);
  assert.deepEqual(ranges, ["whole"]);
  assert.deepEqual([...small], [1, 2, 3, 4]);
  const parts = [];
  const bytes = await pure.copiedBytes(async (range) => {
    parts.push(range);
    return { code: 0, stdout: Buffer.from([9, 8]).toString("base64") };
  }, 4, 2);
  assert.deepEqual(clone(parts), [{ offset: 0, length: 2 }, { offset: 2, length: 2 }]);
  assert.deepEqual([...bytes], [9, 8, 9, 8]);
  await assert.rejects(pure.copiedBytes(async () => ({ code: 0, stdout: "output truncated" }), 4), /cut short/);
  await assert.rejects(pure.copiedBytes(async () => ({ code: 0, stdout: "AQ==" }), 4), /cut short/);
});

test("a failure says whether the computer is quiet or the folder cannot be read", () => {
  assert.equal(pure.copyFailure(new Error("light is unreachable"), "light"), "light did not answer");
  assert.equal(pure.copyFailure("permission denied", "light"), "Cannot read this file: permission denied");
  assert.equal(pure.copyFailure("No such file", "light"), "This file is no longer available");
  assert.equal(pure.copyFailure("The copy was cut short", "light"), "The copy was cut short");
  assert.equal(pure.listFailure(new Error("Error: Access is denied"), "light"), "Cannot list this folder: permission denied");
  assert.equal(pure.listFailure("timed out", "dark"), "dark did not answer");
  assert.equal(pure.listFailure("", null), "This machine did not answer");
  assert.equal(pure.remoteDue(null, true, false), false);
  assert.equal(pure.remoteDue("light", false, false), false);
  assert.equal(pure.remoteDue("light", true, true), false);
  assert.equal(pure.remoteDue("light", true, false), true);
  assert.equal(pure.remoteDue("light", undefined, undefined), true);
  assert.equal(pure.machineOf("light/t90"), "light");
  assert.equal(pure.machineOf("t1"), null);
  assert.equal(pure.machineOf("/repo/a.png"), null);
  assert.equal(pure.drawablePath(null, null, "/a.png"), "/a.png");
  assert.equal(pure.drawablePath("light", null, "/a.png"), null);
  assert.equal(pure.drawablePath("light", "data/kanso-panel/look/a.png", "/a.png"), "data/kanso-panel/look/a.png");
  assert.equal(pure.appRelative("/app/data/kanso-panel/remote/a.png", "/app"), "data/kanso-panel/remote/a.png");
  assert.equal(pure.appRelative("/elsewhere/a.png", "/app"), null);
  assert.deepEqual(clone(pure.svgPixels('<svg width="10px" height="20"></svg>')), { width: 10, height: 20 });
  assert.deepEqual(clone(pure.svgPixels('<svg viewBox="0 0 12 34"></svg>')), { width: 12, height: 34 });
  assert.equal(pure.svgPixels("<svg></svg>"), null);
  assert.deepEqual(clone(pure.markdownParts("Hi ![a](./a.png) and ![b](https://x/b.png)").map((part) => part.kind === "image" ? part.url : "text")), ["text", "./a.png", "text"]);
  assert.deepEqual(clone(pure.markdownParts("see ![a](https://x/a.png)").map((part) => part.kind)), ["text"]);
  assert.deepEqual(clone(pure.markdownParts("<img src='./c.gif'>").map((part) => part.url)), ["./c.gif"]);
});

for (const platform of ["macos", "linux", "windows"]) {
  test(`stat and encode on ${platform} stay on that computer's programs`, async () => {
    const calls = [];
    const run = async (cmd, args) => {
      calls.push([cmd, args]);
      const script = String(args?.at?.(-1) ?? "");
      if (cmd === "stat") return { code: 0, stdout: "4 1700000000\n", stderr: "" };
      if (cmd === "base64" || cmd === "python3") return { code: 0, stdout: "AQIDBA==\n", stderr: "" };
      if (cmd === "pwsh") return { code: 0, stdout: script.includes("ToBase64String") ? "AQIDBA==\n" : "4 1700000000\n", stderr: "" };
      return { code: 1, stdout: "", stderr: cmd };
    };
    const api = fileApi(platform, run);
    assert.deepEqual(await api.stat("/tmp/a.png"), { size: 4, mtime: 1700000000 });
    await api.encode("/tmp/a.png");
    await api.encode("/tmp/a.png", { offset: 2, length: 2 });
    if (platform === "macos") assert.deepEqual(calls.filter((c) => c[0] === "base64").map((c) => c[1]), [["-i", "/tmp/a.png"]]);
    if (platform === "linux") assert.deepEqual(calls.filter((c) => c[0] === "base64").map((c) => c[1]), [["/tmp/a.png"]]);
    if (platform === "macos" || platform === "linux") {
      assert.deepEqual(calls.find((c) => c[0] === "stat")[1], platform === "macos" ? ["-f", "%z %m", "/tmp/a.png"] : ["-c", "%s %Y", "/tmp/a.png"]);
      assert.equal(calls.some((c) => c[0] === "python3"), true);
    }
    if (platform === "windows") {
      const scripts = calls.filter((c) => c[0] === "pwsh").map((c) => String(c[1].at(-1)));
      assert.ok(scripts.some((script) => script.includes("Get-Item") && script.includes("ToUnixTimeSeconds")));
      assert.ok(scripts.some((script) => script.includes("[Convert]::ToBase64String([IO.File]::ReadAllBytes(")));
      assert.ok(scripts.some((script) => script.includes("OpenRead") && script.includes("Seek") && !script.includes("sh ")));
      assert.equal(calls.some((c) => c[0] === "sh" || c[0] === "base64"), false);
    }
  });
}

async function remoteBring(platform) {
  const dir = await mkdtemp(join(tmpdir(), "kanso-remote-"));
  const calls = [];
  const state = { stat: "4 1700000000\n", stdout: "AQIDBA==\n", fail: null };
  const exec = async (cmd, args = []) => {
    calls.push([cmd, args]);
    if (state.fail) throw state.fail;
    const script = String(args.at(-1) ?? "");
    if (cmd === "pwsh" || cmd === "powershell") {
      if (platform !== "windows") return { code: 127, stdout: "", stderr: "" };
      if (script.includes("OSVersion")) return { code: 0, stdout: "Win32NT\n", stderr: "" };
      if (script.includes("Get-Item")) return { code: 0, stdout: state.stat, stderr: "" };
      if (script.includes("ToBase64String")) return { code: 0, stdout: state.stdout, stderr: "" };
      return { code: 1, stdout: "", stderr: script.slice(0, 40) };
    }
    if (cmd === "uname") return { code: 0, stdout: platform === "macos" ? "Darwin\n" : "Linux\n", stderr: "" };
    if (cmd === "stat") return { code: 0, stdout: state.stat, stderr: "" };
    if (cmd === "base64") return { code: 0, stdout: state.stdout, stderr: "" };
    return { code: 1, stdout: "", stderr: cmd };
  };
  const loaded = await load("kanso-panel/remote-file.js", ["bring"], {
    appHome: () => dir, window: () => ({ platform: "macos" }), exec, writeFile, mkdir, readdir, unlink, stat,
  });
  return { ...loaded, dir, calls, state, done: () => rm(dir, { recursive: true, force: true }) };
}

test("a file here is not copied, and one elsewhere is kept until its mtime changes", async () => {
  const box = await remoteBring("macos");
  try {
    assert.deepEqual(clone(await box.bring("/here/a.png", null)), { path: "/here/a.png" });
    const first = await box.bring("/remote/a.png", "light");
    const encodes = () => box.calls.filter((call) => call[0] === "base64").length;
    assert.equal(encodes(), 1);
    assert.equal((await box.bring("/remote/a.png", "light")).path, first.path);
    assert.equal(encodes(), 1);
    box.state.stat = "4 1700000001\n";
    const next = await box.bring("/remote/a.png", "light");
    assert.notEqual(next.path, first.path);
    assert.deepEqual(await readdir(join(box.dir, "data/kanso-panel/remote")), [basename(next.path)]);
    assert.equal((await readFile(next.path)).length, 4);
    const before = encodes();
    box.state.stat = `${pure.BYTE_CAP + 1} 1\n`;
    await assert.rejects(box.bring("/remote/a.png", "light"), /over 20 MB/);
    assert.equal(encodes(), before);
    box.state.stat = "4 1700000002\n";
    box.state.stdout = "truncated\n";
    await assert.rejects(box.bring("/remote/b.png", "light"), /cut short/);
    box.state.fail = new Error("light is unreachable");
    await assert.rejects(box.bring("/remote/c.png", "light"), /light did not answer/);
  } finally { await box.done(); }
});

test("linux and windows copies use that computer's encoder and never a shell on windows", async () => {
  const linux = await remoteBring("linux");
  const windows = await remoteBring("windows");
  try {
    await linux.bring("/remote/a.png", "light");
    assert.ok(linux.calls.some((call) => call[0] === "base64" && call[1][0] === "/remote/a.png"));
    assert.equal(linux.calls.some((call) => call[0] === "sh"), false);
    const got = await windows.bring("C:\\pics\\a.png", "light");
    assert.ok(windows.calls.every((call) => call[0] === "pwsh" || call[0] === "powershell"));
    assert.ok(windows.calls.some((call) => String(call[1].at(-1)).includes("ReadAllBytes")));
    assert.equal((await readFile(got.path)).length, 4);
  } finally { await linux.done(); await windows.done(); }
});

const node = () => {
  const el = new Proxy({}, { get(_target, key) {
    if (key === "then") return undefined;
    return () => el;
  } });
  return el;
};

test("preview chooses a picture, markdown or text, and re-reads a remote file only while shown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kanso-preview-"));
  const reads = [];
  const ticks = [];
  let active = true, hidden = false;
  try {
    const { Preview, previewKind } = await load("kanso-panel/preview.js", ["Preview", "previewKind"], {
      appHome: () => dir,
      window: () => ({ active, platform: "macos" }),
      layout: () => ({ id: "panel-body", hidden }),
      readTextFile: async (path) => { reads.push(path); return "hello"; },
      isMarkdown: (path) => /\.md$/.test(path),
      codeState: () => ({ release() {} }),
      theme: () => ({}),
      div: node, svg: node, image: node, h_flex: node, v_flex: node, Editor: { new: node },
      exec: async (cmd, args = []) => {
        if (cmd === "pwsh" || cmd === "powershell") return { code: 127, stdout: "", stderr: "" };
        if (cmd === "uname") return { code: 0, stdout: "Darwin\n", stderr: "" };
        if (cmd === "stat") return { code: 0, stdout: "4 9\n", stderr: "" };
        if (cmd === "base64") return { code: 0, stdout: "AQIDBA==\n", stderr: "" };
        if (cmd === "sips") return { code: 0, stdout: "pixelWidth: 12\npixelHeight: 8\n", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
      writeFile, mkdir, readdir, unlink, stat,
      watchFolder: async () => { throw new Error("no watch"); },
    });
    assert.equal(previewKind("/a.png"), "picture");
    assert.equal(previewKind("/a.svg"), "picture");
    assert.equal(previewKind("/a.md"), "markdown");
    assert.equal(previewKind("/a.js"), "text");
    assert.equal(previewKind("/a.pdf"), "text");
    assert.equal(previewKind("/a.heic"), "text");
    const { cx, drain } = context();
    const quiet = { ...cx, timer: { every() {}, after() {} }, focus_handle: () => ({}) };
    const text = new Preview();
    text.init(quiet, { path: "/repo/a.js" });
    await drain();
    assert.equal(text.doc, null);
    assert.ok(text.code);
    const md = new Preview();
    md.init(quiet, { path: "/repo/a.md" });
    await drain();
    assert.ok(md.doc);
    assert.equal(md.picture, null);
    const picture = new Preview();
    picture.init(quiet, { path: "/repo/a.png" });
    await drain();
    assert.match(picture.picture.image, /^data\/kanso-panel\/preview\//);
    assert.deepEqual(clone(picture.pixels), { width: 12, height: 8 });
    const remote = new Preview();
    remote.init({ ...cx, timer: { every(_ms, fn) { ticks.push(fn); }, after() {} }, focus_handle: () => ({}) }, { path: "/repo/a.js", on: "light" });
    await drain();
    const before = reads.length;
    active = false;
    ticks[0](cx);
    await drain();
    assert.equal(reads.length, before);
    active = true;
    hidden = true;
    ticks[0](cx);
    await drain();
    assert.equal(reads.length, before);
    hidden = false;
    ticks[0](cx);
    await drain();
    assert.equal(reads.length, before + 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a remote folder says why it failed and is listed again only while shown", async () => {
  const calls = [];
  const ticks = [];
  let active = true, hidden = false, denied = false;
  const { Files } = await load("kanso-panel/files.js", ["Files"], {
    key: () => "ctx",
    location: () => ({ cwd: "/repo", on: "light" }),
    window: () => ({ active, platform: "macos" }),
    layout: () => ({ id: "panel-body", hidden }),
    exec: async () => { calls.push("exec"); throw new Error(denied ? "Permission denied" : "light is unreachable"); },
    watchFolder: async () => { throw new Error("no"); },
  });
  const { cx, drain } = context();
  const files = new Files();
  files.init({ ...cx, timer: { every(_ms, fn) { ticks.push(fn); }, after() {} } }, {});
  await drain();
  assert.equal(files.error, "light did not answer");
  const quiet = calls.length;
  active = false;
  ticks[1](cx);
  await drain();
  assert.equal(calls.length, quiet);
  active = true;
  hidden = true;
  ticks[1](cx);
  await drain();
  assert.equal(calls.length, quiet);
  hidden = false;
  ticks[1](cx);
  await drain();
  assert.ok(calls.length > quiet);
  const mid = calls.length;
  ticks[0](cx);
  await drain();
  assert.equal(calls.length, mid);
  denied = true;
  files.context = null;
  files.refresh(cx);
  await drain();
  assert.equal(files.error, "Cannot list this folder: permission denied");
});

test("a picture in Files opens in Preview, and a Markdown file on another computer draws its pictures", async () => {
  const seen = [];
  let listed;
  const element = () => {
    const target = { handlers: {}, when(condition, callback) { if (condition) callback(proxy); return proxy; } };
    const proxy = new Proxy(target, { get(object, name) {
      if (name in object) return object[name];
      return (...args) => {
        if (String(name).startsWith("on_")) object.handlers[name] = args[0];
        return proxy;
      };
    } });
    return proxy;
  };
  const { Files } = await load("kanso-panel/files.js", ["Files"], {
    div: element, svg: element, h_flex: element, v_flex: element,
    Scrollbar: { vertical: element }, theme: () => ({}), key: () => "fixture",
    isMarkdown: (path) => /\.md$/.test(path),
    v_virtual_list: (_id, count, _height, key, render) => { const el = element(); listed = { count, key, render, el }; return el; },
  });
  const panel = new Files();
  Object.assign(panel, { context: "fixture", root: "/repo", folders: new Set(), marks: {},
    entries: new Map([["", [{ name: "shot.png", dir: false }, { name: "notes.txt", dir: false }]]]) });
  const actions = [];
  panel.read = (path) => actions.push(["read", path]);
  panel.show = (path) => actions.push(["show", path]);
  panel.render({});
  listed.el.handlers.on_item_click(listed.key(0), {});
  listed.el.handlers.on_item_click(listed.key(1), {});
  assert.deepEqual(actions, [["read", "shot.png"], ["show", "notes.txt"]]);

  const dir = await mkdtemp(join(tmpdir(), "kanso-doc-"));
  try {
    const texts = [];
    const view = () => new Proxy({}, { get(_target, key) {
      if (key === "then") return undefined;
      if (key === "child") return (value) => { if (typeof value === "string") texts.push(value); return view(); };
      return () => view();
    } });
    const { MarkdownDoc } = await load("kanso-panel/doc.js", ["MarkdownDoc"], {
      appHome: () => dir,
      readTextFile: async () => "Hello\n\n![shot](./shot.png)\n",
      window: () => ({ platform: "macos" }),
      div: view, svg: view, image: (src) => { seen.push(src); return view(); }, h_flex: view, v_flex: view,
      TextView: { markdown: () => view() }, Textarea: { new: view }, Editor: { new: view },
      EditorState: { new: () => ({}) }, TextareaState: { new: () => ({ set_auto_grow() {}, on() {}, focus() {}, release() {} }) },
      exec: async (cmd) => {
        if (cmd === "pwsh" || cmd === "powershell") return { code: 127, stdout: "", stderr: "" };
        if (cmd === "uname") return { code: 0, stdout: "Darwin\n", stderr: "" };
        if (cmd === "stat") return { code: 0, stdout: "4 3\n", stderr: "" };
        if (cmd === "base64") return { code: 0, stdout: "AQIDBA==\n", stderr: "" };
        return { code: 1, stdout: "", stderr: cmd };
      },
      writeFile, mkdir, readdir, unlink, stat,
    });
    const doc = new MarkdownDoc("/repo/PLAN.md", "light");
    assert.equal(doc.canEdit, false);
    const { cx, drain } = context();
    doc.load(cx);
    await drain();
    doc.body({ border: "#111", dim: "#222", foreground: "#000", background: "#fff" }, "doc");
    assert.match(seen[0], /^data\/kanso-panel\/remote\//);
    doc.shots = new Map([["/repo/shot.png", null]]);
    doc.body({ border: "#111", dim: "#222", foreground: "#000", background: "#fff" }, "doc");
    assert.equal(texts.includes("Cannot show this picture"), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

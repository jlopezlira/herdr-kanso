import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { load, clone, temporary, exec, nativeWindow } from "./helpers.mjs";

const { insideRoot } = await load("kanso-panel/lib.js", ["insideRoot"]);

test("Files preserves newline names, dotfiles and symlinks", { skip: process.platform === "win32" && "Unix names and symlink semantics" }, async (t) => {
  const parent = await temporary(t), root = join(parent, "folder\nwith spaces");
  await mkdir(root);
  for (const name of ["first\nsecond.txt", "tabs\tand\\slashes.txt", ".hidden", "O’Brien.txt"]) {
    await writeFile(join(root, name), "text");
  }
  await mkdir(join(root, "directory")); await mkdir(join(root, ".git"));
  await symlink("directory", join(root, "link"));
  await symlink("missing", join(root, "dangling"));
  const { directory } = await load("kanso-panel/files.js", ["directory"], { exec, window: nativeWindow });
  const entries = Object.fromEntries((await directory(root, null)).map(({ name, dir }) => [name, dir]));
  assert.deepEqual(entries, {
    "first\nsecond.txt": false, "tabs\tand\\slashes.txt": false, ".hidden": false,
    "O’Brien.txt": false, directory: true, link: false, dangling: false,
  });
  await symlink(root, join(parent, "root-link"));
  assert.equal((await directory(join(parent, "root-link"), null)).length, 7);
});

test("Files falls back to the shell listing when find cannot run", { skip: process.platform === "win32" && "Unix find fallback" }, async (t) => {
  const root = await temporary(t);
  await writeFile(join(root, "file.txt"), ""); await mkdir(join(root, "directory"));
  const calls = [];
  const { directory } = await load("kanso-panel/files.js", ["directory"], { window: () => ({ platform: "macos" }),
    exec: async (command, args, options) => { calls.push(command); if (command === "find") throw new Error("not installed"); return exec(command, args, options); } });
  const entries = Object.fromEntries((await directory(root, null)).map(({ name, dir }) => [name, dir]));
  assert.deepEqual(entries, { "file.txt": false, directory: true });
  assert.deepEqual(calls, ["find", "bash"]);
});

test("Files marks the entry past the cap as a folder when it is one", async (t) => {
  const root = await temporary(t);
  for (let i = 0; i < 600; i++) await mkdir(join(root, `dir-${i}`));
  const { directory } = await load("kanso-panel/files.js", ["directory"], { exec, window: nativeWindow });
  const entries = await directory(root, null);
  assert.equal(entries.length, 501);
  assert.ok(entries.every((entry) => entry.dir));
});

test("Files reports truncation only above 500 entries", async (t) => {
  const root = await temporary(t);
  for (let i = 0; i < 500; i++) await writeFile(join(root, `file-${i}`), "");
  const { directory, Files } = await load("kanso-panel/files.js", ["directory", "Files"], {
    exec, insideRoot, window: nativeWindow, key: () => root,
  });
  const panel = new Files();
  Object.assign(panel, { root, entries: new Map(), folders: new Set(), limited: false });
  await panel.loadFolder("", root);
  assert.equal(panel.entries.get("").length, 500);
  assert.equal(panel.limited, false);
  for (let i = 500; i < 510; i++) await writeFile(join(root, `file-${i}`), "");
  assert.equal((await directory(root, null)).length, 501);
  await panel.loadFolder("", root);
  assert.equal(panel.entries.get("").length, 500);
  assert.equal(panel.limited, true);
});

test("Files virtual rows use list-level handlers for open, expand and context menu; Markdown opens to read and edit", async () => {
  let deferred = false, list;
  function element() {
    const handlers = {};
    const target = {
      handlers,
      when(condition, callback) { if (condition) callback(proxy); return proxy; },
    };
    const proxy = new Proxy(target, { get(object, name) {
      if (name in object) return object[name];
      return (...args) => {
        if (String(name).startsWith("on_")) {
          assert.equal(deferred, false, "Herdr forbids event registration inside virtual row renderers");
          handlers[name] = args[0];
        }
        return proxy;
      };
    } });
    return proxy;
  }
  const { Files } = await load("kanso-panel/files.js", ["Files"], {
    div: element, svg: element, h_flex: element, v_flex: element,
    Scrollbar: { vertical: element }, theme: () => ({}), key: () => "fixture",
    isMarkdown: (path) => /\.md$/.test(path),
    v_virtual_list: (_id, count, _height, key, render) => {
      const el = element(); list = { count, key, render, el }; return el;
    },
  });
  const panel = new Files();
  Object.assign(panel, { context: "fixture", root: "/repo", folders: new Set(), marks: {},
    entries: new Map([["", [
      { name: "directory", dir: true }, { name: "file.txt", dir: false }, { name: "PLAN.md", dir: false },
      { name: "Dockerfile", dir: false }, { name: "Makefile", dir: false }, { name: ".gitignore", dir: false },
      { name: ".env.local", dir: false }, { name: "LICENSE", dir: false },
    ]]]),
  });
  const actions = [];
  panel.toggle = (path) => actions.push(["toggle", path]);
  panel.openWith = (path) => actions.push(["openWith", path]);
  panel.read = (path) => actions.push(["read", path]);
  panel.render({});
  deferred = true;
  assert.equal(list.render({ start: 0, end: list.count }).length, 8);
  deferred = false;
  for (let i = 0; i < 8; i += 1) list.el.handlers.on_item_click(list.key(i), {});
  list.el.handlers.on_item_secondary_click(list.key(0), {}, {});
  list.el.handlers.on_item_secondary_click(list.key(1), {}, {});
  assert.deepEqual(actions, [
    ["toggle", "directory"], ["read", "file.txt"], ["read", "PLAN.md"], ["read", "Dockerfile"],
    ["read", "Makefile"], ["read", ".gitignore"], ["read", ".env.local"], ["read", "LICENSE"],
    ["openWith", "file.txt"],
  ]);
});

test("changed files are the marked paths under this folder, flat", async () => {
  const { changedFiles, Files } = await load("kanso-panel/files.js", ["changedFiles", "Files"], { window: nativeWindow });
  const marks = { "/repo/src/b.js": "M", "/repo/a.js": "A", "/repo-extra/c.js": "D", "/repo/src/nested/d.js": "U" };
  const row = (path, mark) => ({ path, entry: { name: path, dir: false }, depth: 0, mark });
  assert.deepEqual(clone(changedFiles(marks, "/repo")), [row("a.js", "A"), row("src/b.js", "M"), row("src/nested/d.js", "U")]);
  assert.deepEqual(clone(changedFiles(marks, "/repo/")), clone(changedFiles(marks, "/repo")));
  assert.deepEqual(clone(changedFiles(marks, "/repo/src")), [row("b.js", "M"), row("nested/d.js", "U")]);
  assert.deepEqual(clone(changedFiles({ "C:\\repo\\a.js": "M" }, "C:\\repo")), [row("a.js", "M")]);
  assert.deepEqual(clone(changedFiles({}, "/repo")), []);
  assert.deepEqual(clone(changedFiles(marks, "")), []);
  assert.deepEqual(clone(changedFiles(null, null)), []);
  const panel = new Files();
  Object.assign(panel, { changed: true, root: "/repo", marks, entries: new Map([["", [{ name: "other.txt", dir: false }]]]), folders: new Set(), rev: 0 });
  assert.deepEqual(clone(panel.rows()).map((item) => item.path), ["a.js", "src/b.js", "src/nested/d.js"]);
  panel.changed = false;
  assert.deepEqual(clone(panel.rows()).map((item) => item.path), ["other.txt"]);
});

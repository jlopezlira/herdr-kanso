import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { mkdtemp, readdir, readFile, rename, rm, stat, unlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileApi } from "../kanso/mods/kanso-panel/platform-files.js";
import { bindHerdrModules, load, context, clone, modSandbox } from "./helpers.mjs";

const NAMES = ["bring", "copyName", "fileId", "dropCopies", "lookStamp", "sweepLook", "tooBig", "BYTE_CAP", "ASK_BYTES", "CHECK_MS", "SLOW_MS", "CHUNK", "slices", "cutShort", "copyFailure", "listFailure", "remoteDue", "machineOf", "appRelative", "drawablePath", "svgPixels", "markdownParts", "pollStart", "pollNext", "checkOutcome", "asOf", "staleView", "askPicture", "bytesLabel", "parseTree"];
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

test("a picture copy on this computer is kept for a day, and an older copy of the same picture goes", async () => {
  const now = Date.now();
  const keep = `pic-${now}.png`;
  const older = `pic-${now - 1000}.png`;
  const stale = `other-${now - 86_400_000 - 5}.jpg`;
  const fresh = `other-${now - 1000}.jpg`;
  assert.equal(pure.lookStamp(keep), now);
  assert.equal(pure.lookStamp("notes.txt"), 0);
  assert.deepEqual(pure.dropCopies([
    { name: keep, mtime: pure.lookStamp(keep) },
    { name: older, mtime: pure.lookStamp(older) },
    { name: stale, mtime: pure.lookStamp(stale) },
    { name: fresh, mtime: pure.lookStamp(fresh) },
    { name: "notes.txt", mtime: pure.lookStamp("notes.txt") },
  ], { id: "pic", keep, now }), [older, stale, "notes.txt"]);
  const dir = await mkdtemp(join(tmpdir(), "kanso-look-"));
  await writeFile(join(dir, keep), "a");
  await writeFile(join(dir, older), "b");
  await writeFile(join(dir, fresh), "c");
  await pure.sweepLook(dir, "pic", keep);
  assert.deepEqual((await readdir(dir)).toSorted(), [fresh, keep]);
  await rm(dir, { recursive: true, force: true });
});

test("a copy stops at 20 MB and rejects a cut-short read", () => {
  assert.equal(pure.tooBig(pure.BYTE_CAP), false);
  assert.equal(pure.tooBig(pure.BYTE_CAP + 1), true);
  assert.equal(pure.tooBig(Number.NaN), true);
  assert.equal(pure.slices(0).length, 0);
  assert.equal(pure.CHUNK % 3, 0);
  assert.equal(pure.slices(pure.CHUNK).length, 1);
  assert.equal(pure.slices(pure.CHUNK + 1).length, 2);
  assert.ok(pure.slices(pure.CHUNK * 2 + 1).slice(0, -1).every((part) => part.length % 3 === 0));
  assert.deepEqual(clone(pure.slices(5, 2)), [{ offset: 0, length: 2 }, { offset: 2, length: 2 }, { offset: 4, length: 1 }]);
  assert.equal(pure.slices(Number.NaN), null);
  assert.equal(pure.cutShort({ truncated: true }), true);
  assert.equal(pure.cutShort({ stdout: "truncated by the host" }), true);
  assert.equal(pure.cutShort({ stdout: "AQIDBA==" }), false);
});

test("the mod host only has the fs, net and websocket exports Herdr declares", () => {
  assert.throws(() => bindHerdrModules('import { mkdir, stat } from "fs/promises";\n'), /Could not find export 'stat' in module 'fs\/promises'/);
  assert.throws(() => bindHerdrModules('import { createServer } from "net";\n'), /Could not find export 'createServer' in module 'net'/);
  assert.throws(() => bindHerdrModules('import { Server } from "websocket";\n'), /Could not find export 'Server' in module 'websocket'/);
  const bound = bindHerdrModules('import { exists } from "fs/promises";\nimport { connect } from "net";\nimport { WebSocket } from "websocket";\n');
  assert.equal(bound.includes("stat"), false);
  assert.match(bound, /__herdrModule\("fs\/promises"\)/);
  assert.match(bound, /__herdrModule\("net"\)/);
  assert.match(bound, /__herdrModule\("websocket"\)/);
});

test("the mod host fails on TextDecoder, atob, and Buffer", async () => {
  const sandbox = modSandbox({ Buffer: { from() { return "leaked"; } }, atob: () => "leaked", TextDecoder: class { decode() { return "leaked"; } } });
  assert.throws(() => vm.runInContext("new TextDecoder().decode('')", sandbox), /TextDecoder is not available/);
  assert.throws(() => vm.runInContext("atob('YQ==')", sandbox), /atob is not available/);
  assert.throws(() => vm.runInContext("Buffer.from('a')", sandbox), /Buffer is not available/);
  const source = await readFile(new URL("../kanso/mods/kanso-panel/remote-file.js", import.meta.url), "utf8");
  assert.equal(/TextDecoder|\batob\b|decodeBase64\(/.test(source), false);
});

test("a failure says whether the computer is quiet or the folder cannot be read", () => {
  assert.equal(pure.copyFailure(new Error("light is unreachable"), "light"), "light did not answer");
  assert.equal(pure.copyFailure("permission denied", "light"), "Cannot read this file: permission denied");
  assert.equal(pure.copyFailure("No such file", "light"), "This file is no longer available");
  assert.equal(pure.copyFailure("The copy was cut short", "light"), "The copy was cut short");
  assert.equal(pure.listFailure(new Error("Error: Access is denied"), "light"), "Cannot list this folder: permission denied");
  assert.equal(pure.listFailure("timed out", "dark"), "dark did not answer");
  assert.equal(pure.listFailure("", null), "This computer did not answer");
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

test("a quiet check backs off, and a failed check keeps the last view", () => {
  const start = pure.pollStart();
  assert.deepEqual(clone(start), { quiet: 0, wait: pure.CHECK_MS });
  const once = pure.pollNext(start, "same");
  const twice = pure.pollNext(once, "same");
  const thrice = pure.pollNext(twice, "same");
  assert.deepEqual(clone([once.wait, twice.wait, thrice.wait]), [pure.CHECK_MS, pure.CHECK_MS, pure.SLOW_MS]);
  assert.equal(pure.pollNext(thrice, "changed").wait, pure.CHECK_MS);
  assert.equal(pure.pollNext(start, "failed").wait, pure.SLOW_MS);
  assert.equal(pure.pollNext(once, "seen").wait, pure.CHECK_MS);
  assert.equal(pure.checkOutcome(null, null), "failed");
  assert.equal(pure.checkOutcome(null, { size: 1, mtime: 2 }), "seen");
  assert.equal(pure.checkOutcome({ size: 1, mtime: 2 }, { size: 1, mtime: 2 }), "same");
  assert.equal(pure.checkOutcome({ size: 1, mtime: 2 }, { size: 2, mtime: 2 }), "changed");
  assert.equal(pure.asOf(0, 120000), "as of 2 min ago");
  assert.equal(pure.asOf(0, 10000), "as of just now");
  assert.deepEqual(clone(pure.staleView(true, 0, 120000, "light did not answer")), { keep: true, hold: { at: 0 }, error: null, loading: false });
  const empty = pure.staleView(false, null, 120000, "light did not answer");
  assert.equal(empty.keep, false);
  assert.equal(empty.loading, false);
  assert.equal(empty.error, "light did not answer");
  assert.equal(pure.askPicture(pure.ASK_BYTES), false);
  assert.equal(pure.askPicture(pure.ASK_BYTES + 1), true);
  assert.equal(pure.bytesLabel(3 * 1024 * 1024), "3 MB");
  const rows = [" M src/a.js", "?? b.txt"];
  const tree = ["\x055 1700000000", "\x01", "./a.txt", "./dir", "./dir", "\x02", "\x03/repo", `${rows.join("\n")}\n`, "\x04"].join("\0") + "\0";
  const snap = pure.parseTree(tree);
  assert.deepEqual(clone(snap.stamp), { size: 5, mtime: 1700000000 });
  assert.deepEqual(clone(snap.folders), [{ rel: "", entries: [{ name: "a.txt", dir: false }, { name: "dir", dir: true }] }]);
  assert.equal(snap.top, "/repo");
  assert.deepEqual(clone(snap.rows), rows);
  const win = pure.parseTree(["\x051 2", "\x01sub", "f\tnote.txt", "d\tfolder", "\x02", "\x03", "\x04"].join("\0") + "\0");
  assert.equal(win.top, null);
  assert.deepEqual(clone(win.folders), [{ rel: "sub", entries: [{ name: "note.txt", dir: false }, { name: "folder", dir: true }] }]);
});

for (const platform of ["macos", "linux", "windows"]) {
  test(`a folder listing and its git status are one call on ${platform}`, async () => {
    const calls = [];
    const api = fileApi(platform, async (cmd, args) => {
      calls.push([cmd, args]);
      return { code: 0, stdout: "\x050 0\x00\x01\x00\x02\x00\x03\x00\x04\x00", stderr: "" };
    });
    await api.tree("/repo", ["", "src"]);
    assert.equal(calls.length, 1);
    const script = String(calls[0][0] === "sh" ? calls[0][1][1] : calls[0][1].at(-1));
    if (platform === "windows") {
      assert.equal(calls[0][0], "pwsh");
      assert.match(script, /Get-ChildItem/);
      assert.match(script, /ReadToEnd\(\)\.Replace/);
      assert.equal(script.includes("ToBase64String"), false);
      assert.equal(script.includes("sh "), false);
    } else {
      assert.equal(calls[0][0], "sh");
      assert.match(script, platform === "macos" ? /\/usr\/bin\/stat -L -f '%z %m'/ : /stat -L -c '%s %Y'/);
      assert.match(script, /find -H/);
      assert.match(script, /status --porcelain=v1 -z/);
      assert.match(script, /tr '\\000' '\\n'/);
      assert.equal(script.includes("base64"), false);
      assert.deepEqual(calls[0][1].slice(3), ["/repo", "", "src"]);
    }
  });

  test(`stat and encode on ${platform} stay on that computer's programs`, async () => {
    const calls = [];
    const run = async (cmd, args) => {
      calls.push([cmd, args]);
      const script = String(args?.at?.(-1) ?? "");
      if (cmd === "stat" || cmd === "/usr/bin/stat") return { code: 0, stdout: "4 1700000000\n", stderr: "" };
      if (cmd === "base64" || cmd === "/usr/bin/base64") return { code: 0, stdout: "AQIDBA==\n", stderr: "" };
      if (cmd === "sh" && String(args?.[1] ?? "").includes("tail -c")) return { code: 0, stdout: "AQIDBA==\n", stderr: "" };
      if (cmd === "sh" && String(args?.[1] ?? "").includes("base64 -d")) return { code: 0, stdout: "", stderr: "" };
      if (cmd === "pwsh") return { code: 0, stdout: script.includes("ToBase64String") || script.includes("WriteAllBytes") ? "AQIDBA==\n" : "4 1700000000\n", stderr: "" };
      return { code: 1, stdout: "", stderr: cmd };
    };
    const api = fileApi(platform, run);
    assert.deepEqual(await api.stat("/tmp/a.png"), { size: 4, mtime: 1700000000 });
    await api.encode("/tmp/a.png");
    await api.encode("/tmp/a.png", { offset: 2, length: 2 });
    if (platform === "macos") assert.deepEqual(calls.filter((c) => c[0] === "/usr/bin/base64").map((c) => c[1]), [["-i", "/tmp/a.png"]]);
    if (platform === "linux") assert.deepEqual(calls.filter((c) => c[0] === "base64").map((c) => c[1]), [["/tmp/a.png"]]);
    if (platform === "macos" || platform === "linux") {
      assert.deepEqual(calls.find((c) => c[0] === (platform === "macos" ? "/usr/bin/stat" : "stat"))[1], platform === "macos" ? ["-L", "-f", "%z %m", "/tmp/a.png"] : ["-L", "-c", "%s %Y", "/tmp/a.png"]);
      const range = calls.find((c) => c[0] === "sh" && String(c[1][1]).includes("tail -c"));
      assert.deepEqual(range[1], ["-c", `tail -c +"$2" "$1" | head -c "$3" | ${platform === "macos" ? "/usr/bin/base64" : "base64"}`, "slice", "/tmp/a.png", "3", "2"]);
      assert.equal(calls.some((c) => c[0] === "python3"), false);
    }
    if (platform === "windows") {
      const scripts = calls.filter((c) => c[0] === "pwsh").map((c) => String(c[1].at(-1)));
      assert.ok(scripts.some((script) => script.includes("Get-Item") && script.includes("ToUnixTimeSeconds")));
      assert.ok(scripts.some((script) => script.includes("[Convert]::ToBase64String([IO.File]::ReadAllBytes(")));
      assert.ok(scripts.some((script) => script.includes("OpenRead") && script.includes("Seek") && !script.includes("sh ")));
      assert.equal(calls.some((c) => c[0] === "sh" || c[0] === "base64" || c[0] === "python3"), false);
    }
    await api.decodeBase64File("/tmp/in.b64", "/tmp/out.bin");
    if (platform === "macos") assert.deepEqual(calls.filter((c) => c[0] === "/usr/bin/base64" && c[1][0] === "-D").map((c) => c[1]), [["-D", "-i", "/tmp/in.b64", "-o", "/tmp/out.bin"]]);
    if (platform === "linux") {
      const decode = calls.find((c) => c[0] === "sh" && String(c[1][1]).includes("base64 -d"));
      assert.deepEqual(decode[1], ["-c", "base64 -d \"$1\" > \"$2\"", "b64", "/tmp/in.b64", "/tmp/out.bin"]);
    }
    if (platform === "windows") {
      const scripts = calls.filter((c) => c[0] === "pwsh").map((c) => String(c[1].at(-1)));
      assert.ok(scripts.some((script) => script.includes("[IO.File]::WriteAllBytes(") && script.includes("[Convert]::FromBase64String(") && script.includes("ReadAllText(")));
      assert.equal(calls.some((c) => c[0] === "sh" || c[0] === "base64"), false);
    }
  });
}

async function remoteBring(platform) {
  const dir = await mkdtemp(join(tmpdir(), "kanso-remote-"));
  const calls = [];
  const writes = [];
  const state = { stat: "4 1700000000\n", stdout: "AQIDBA==\n", fail: null };
  const note = async (path, data, ...rest) => { writes.push(typeof data); return writeFile(path, data, ...rest); };
  const exec = async (cmd, args = [], options = {}) => {
    calls.push([cmd, args, options.on ?? null]);
    if ((cmd === "base64" || cmd === "/usr/bin/base64") && args[0] === "-D") {
      const text = await readFile(args[2], "utf8");
      await writeFile(args[4], Buffer.from(text.replace(/\s/g, ""), "base64"));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "sh" && String(args[1] ?? "").includes(">>")) {
      const extra = await readFile(args[3]);
      const prior = await readFile(args[4]).catch(() => Buffer.alloc(0));
      await writeFile(args[4], Buffer.concat([prior, extra]));
      return { code: 0, stdout: "", stderr: "" };
    }
    if ((cmd === "stat" || cmd === "/usr/bin/stat") && !options.on) {
      const info = await stat(args.at(-1)).catch(() => null);
      return info ? { code: 0, stdout: `${info.size} ${Math.floor(info.mtimeMs / 1000)}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "missing" };
    }
    if (cmd === "mv" && !options.on) {
      await rename(args.at(-2), args.at(-1));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (state.fail && options.on) throw state.fail;
    const script = String(args.at(-1) ?? "");
    if (cmd === "pwsh" || cmd === "powershell") {
      if (platform !== "windows") return { code: 127, stdout: "", stderr: "" };
      if (script.includes("OSVersion")) return { code: 0, stdout: "Win32NT\n", stderr: "" };
      if (script.includes("Get-Item")) return { code: 0, stdout: state.stat, stderr: "" };
      if (script.includes("ToBase64String")) return { code: 0, stdout: state.stdout, stderr: "" };
      return { code: 1, stdout: "", stderr: script.slice(0, 40) };
    }
    if (cmd === "uname") return { code: 0, stdout: platform === "macos" ? "Darwin\n" : "Linux\n", stderr: "" };
    if (cmd === "stat" || cmd === "/usr/bin/stat") return { code: 0, stdout: state.stat, stderr: "" };
    if (cmd === "sh" && String(args[1] ?? "").includes("tail -c")) return { code: 0, stdout: state.stdout, stderr: "" };
    if (cmd === "base64" || cmd === "/usr/bin/base64") return { code: 0, stdout: state.stdout, stderr: "" };
    return { code: 1, stdout: "", stderr: cmd };
  };
  const loaded = await load("kanso-panel/remote-file.js", ["bring"], {
    appHome: () => dir, window: () => ({ platform: "macos" }), exec, writeFile: note, mkdir, readdir, unlink, stat,
  });
  return { ...loaded, dir, calls, writes, state, done: () => rm(dir, { recursive: true, force: true }) };
}

test("a file here is not copied, and one elsewhere is kept until its mtime changes", async () => {
  const box = await remoteBring("macos");
  try {
    assert.deepEqual(clone(await box.bring("/here/a.png", null)), { path: "/here/a.png" });
    const first = await box.bring("/remote/a.png", "light");
    const encodes = () => box.calls.filter((call) => call[0] === "/usr/bin/base64" && call[2] === "light").length;
    assert.equal(encodes(), 1);
    assert.equal(box.writes.every((kind) => kind === "string"), true);
    assert.ok(box.calls.some((call) => call[0] === "/usr/bin/base64" && call[1][0] === "-D" && call[2] == null));
    assert.deepEqual([...(await readFile(first.path))], [1, 2, 3, 4]);
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

test("old copies go by the kept list, and by the stamp in a name the list does not have", async () => {
  const box = await remoteBring("macos");
  try {
    await box.bring("/remote/a.png", "light");
    const root = join(box.dir, "data/kanso-panel/remote");
    const sec = Math.floor(Date.now() / 1000);
    const oldStamp = "old-1-4.png";
    const newStamp = `new-${sec}-4.png`;
    const listedNow = "kept-1-4.png";
    const listedOld = `list-${sec}-4.png`;
    await writeFile(join(root, oldStamp), "old");
    await writeFile(join(root, newStamp), "new");
    await writeFile(join(root, listedNow), "stay");
    await writeFile(join(root, listedOld), "drop");
    const kept = join(box.dir, "data/kanso-panel/remote.kept");
    const prior = await readFile(kept, "utf8");
    await writeFile(kept, `${prior}\n${listedNow}\t${Date.now()}\n${listedOld}\t${Date.now() - 86_400_000 - 1}`);
    await box.bring("/remote/a.png", "light");
    const names = await readdir(root);
    assert.equal(names.includes(oldStamp), false);
    assert.equal(names.includes(listedOld), false);
    assert.equal(names.includes(newStamp), true);
    assert.equal(names.includes(listedNow), true);
    assert.equal(names.some((name) => name.endsWith("-1700000000-4.png")), true);
  } finally { await box.done(); }
});

test("a picture over 2 MB is not copied until it is asked for", async () => {
  const box = await remoteBring("macos");
  try {
    const big = pure.ASK_BYTES + 1;
    box.state.stat = `${big} 9\n`;
    assert.deepEqual(clone(await box.bring("/remote/big.png", "light")), { deferred: true, size: big, mtime: 9 });
    assert.equal(box.calls.some((call) => call[0] === "/usr/bin/base64" || call[0] === "base64" || call[0] === "python3" || String(call[1]?.[1] ?? "").includes("tail -c")), false);
    await assert.rejects(box.bring("/remote/big.png", "light", { ask: true }), /cut short/);
    assert.ok(box.calls.some((call) => call[2] === "light" && String(call[1]?.[1] ?? "").includes("tail -c")));
    assert.equal(box.calls.some((call) => call[0] === "python3"), false);
    assert.ok(box.calls.some((call) => call[0] === "sh" && String(call[1][1]).includes(">>")));
    assert.ok(box.calls.some((call) => call[0] === "/usr/bin/base64" && call[1][0] === "-D"));
    assert.equal((await readdir(join(box.dir, "data/kanso-panel/remote"))).some((name) => name.includes(".b64") || name.endsWith(".part")), false);
    box.state.stat = `${pure.ASK_BYTES} 8\n`;
    const before = box.calls.filter((call) => call[0] === "/usr/bin/base64").length;
    await assert.rejects(box.bring("/remote/exact.png", "light"), /cut short/);
    assert.ok(box.calls.filter((call) => call[0] === "/usr/bin/base64").length > before);
    const name = pure.copyName("light", "/remote/kept.png", 9, big, "png");
    const root = join(box.dir, "data/kanso-panel/remote");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, name), Buffer.alloc(big));
    const encoded = box.calls.filter((call) => call[0] === "/usr/bin/base64").length;
    box.state.stat = `${big} 9\n`;
    assert.equal((await box.bring("/remote/kept.png", "light")).path, join(root, name));
    assert.equal(box.calls.filter((call) => call[0] === "/usr/bin/base64").length, encoded);
    box.state.stat = `${pure.BYTE_CAP + 1} 1\n`;
    await assert.rejects(box.bring("/remote/huge.png", "light", { ask: true }), /over 20 MB/);
  } finally { await box.done(); }
});

test("linux and windows copies use that computer's encoder and never a shell on windows", async () => {
  const linux = await remoteBring("linux");
  const windows = await remoteBring("windows");
  try {
    await linux.bring("/remote/a.png", "light");
    assert.ok(linux.calls.some((call) => call[0] === "base64" && call[1][0] === "/remote/a.png" && call[2] === "light"));
    assert.equal(linux.calls.filter((call) => call[2] === "light").some((call) => call[0] === "sh"), false);
    const got = await windows.bring("C:\\pics\\a.png", "light");
    assert.ok(windows.calls.filter((call) => call[2] === "light").every((call) => call[0] === "pwsh" || call[0] === "powershell"));
    assert.ok(windows.calls.some((call) => call[2] == null && call[0] === "/usr/bin/base64" && call[1][0] === "-D"));
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
  const calls = [];
  const afters = [];
  let active = true, hidden = false, stamp = "4 9\n", failStat = false;
  try {
    const { Preview, previewKind } = await load("kanso-panel/preview.js", ["Preview", "previewKind"], {
      appHome: () => dir,
      window: () => ({ active, platform: "macos" }),
      layout: () => ({ id: "panel-body", hidden }),
      readTextFile: async (path) => { reads.push(path); return "hello"; },
      isMarkdown: (path) => /\.md$/.test(path),
      codeState: () => ({ release() {}, value() { return ""; }, set_value() {} }),
      theme: () => ({}),
      div: node, svg: node, image: node, h_flex: node, v_flex: node, Editor: { new: node },
      exec: async (cmd, args = []) => {
        calls.push(cmd);
        if (cmd === "pwsh" || cmd === "powershell") return { code: 127, stdout: "", stderr: "" };
        if (cmd === "uname") return { code: 0, stdout: "Darwin\n", stderr: "" };
        if (cmd === "stat" || cmd === "/usr/bin/stat") return failStat ? { code: 1, stdout: "", stderr: "timed out" } : { code: 0, stdout: stamp, stderr: "" };
        if (cmd === "base64" || cmd === "/usr/bin/base64") return { code: 0, stdout: "AQIDBA==\n", stderr: "" };
        if (cmd === "sips") return { code: 0, stdout: "pixelWidth: 12\npixelHeight: 8\n", stderr: "" };
        if (cmd === "head") return { code: 0, stdout: "hello", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      },
      writeFile, mkdir, readdir, unlink, stat,
      watchFolder: async () => { throw new Error("no watch"); },
      nextCommand: async () => { throw new Error("no commands"); },
    });
    assert.equal(previewKind("/a.png"), "picture");
    assert.equal(previewKind("/a.svg"), "picture");
    assert.equal(previewKind("/a.md"), "markdown");
    assert.equal(previewKind("/a.js"), "text");
    assert.equal(previewKind("/a.pdf"), "text");
    assert.equal(previewKind("/a.heic"), "text");
    const { cx, drain } = context();
    const miss = (ms, fn) => { if (ms === 1000) fn(); };
    cx.timer = { every() {}, after(ms, fn) { if (ms === 1000) { fn(); return; } afters.push([ms, fn]); } };
    const quiet = { ...cx, timer: { every() {}, after: miss }, focus_handle: () => ({}) };
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
    remote.init({ ...cx, focus_handle: () => ({}) }, { path: "/repo/a.js", on: "light" });
    await drain();
    const heads = () => calls.filter((cmd) => cmd === "head").length;
    const before = heads();
    assert.equal(before, 1);
    const fire = async () => { afters.at(-1)[1](cx); await drain(); };
    active = false;
    await fire();
    active = true;
    hidden = true;
    await fire();
    hidden = false;
    await fire();
    assert.equal(heads(), before, "a stat that has not changed does not read the file");
    assert.equal(remote.code != null, true);
    for (let n = 0; n < 3; n += 1) await fire();
    assert.equal(afters.at(-1)[0], 30000, "three quiet checks wait 30 s");
    assert.equal(heads(), before);
    stamp = "5 9\n";
    await fire();
    assert.equal(heads(), before + 1);
    assert.equal(afters.at(-1)[0], 5000);
    failStat = true;
    await fire();
    assert.equal(heads(), before + 1);
    assert.equal(remote.error, null);
    assert.ok(remote.held);
    assert.equal(remote.code != null, true);
    remote.held = { at: Date.now() - 120000 };
    assert.equal(pure.asOf(remote.held.at, Date.now()), "as of 2 min ago");
    assert.equal(afters.at(-1)[0], 30000);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a remote folder says why it failed and is listed again only while shown", async () => {
  const calls = [];
  const ticks = [];
  const afters = [];
  let active = true, hidden = false, denied = false, listed = false;
  const tree = ["\x055 9", "\x01", "./a.txt", "\x02", "\x03", "\x04"].join("\0") + "\0";
  const { Files } = await load("kanso-panel/files.js", ["Files"], {
    key: () => "ctx",
    location: () => ({ cwd: "/repo", on: "light" }),
    window: () => ({ active, platform: "macos" }),
    layout: () => ({ id: "panel-body", hidden }),
    exec: async (cmd) => {
      calls.push(cmd);
      if (denied) throw new Error("Permission denied");
      if (!listed) throw new Error("light is unreachable");
      if (cmd === "pwsh" || cmd === "powershell") return { code: 127, stdout: "", stderr: "" };
      if (cmd === "uname") return { code: 0, stdout: "Darwin\n", stderr: "" };
      if (cmd === "stat" || cmd === "/usr/bin/stat") return failStat ? { code: 1, stdout: "", stderr: "timed out" } : { code: 0, stdout: stamp, stderr: "" };
      if (cmd === "sh") return { code: 0, stdout: tree, stderr: "" };
      return { code: 1, stdout: "", stderr: cmd };
    },
    watchFolder: async () => { throw new Error("no"); },
  });
  let stamp = "5 9\n", failStat = false;
  const { cx, drain } = context();
  cx.timer = { every(_ms, fn) { ticks.push(fn); }, after(ms, fn) { afters.push([ms, fn]); } };
  const files = new Files();
  files.init(cx, {});
  await drain();
  assert.equal(files.error, "light did not answer");
  assert.equal(files.loading, false);
  assert.equal(afters.at(-1)[0], 30000);
  const quiet = calls.length;
  const fire = async () => { afters.at(-1)[1](cx); await drain(); };
  active = false;
  await fire();
  active = true;
  hidden = true;
  await fire();
  assert.equal(calls.length, quiet);
  hidden = false;
  await fire();
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
  denied = false;
  listed = true;
  files.context = null;
  files.refresh(cx);
  await drain();
  assert.equal(files.error, null);
  assert.deepEqual(clone(files.entries.get("").map((entry) => entry.name)), ["a.txt"]);
  const shells = calls.filter((cmd) => cmd === "sh").length;
  stamp = "5 9\n";
  await fire();
  await fire();
  assert.equal(calls.filter((cmd) => cmd === "sh").length, shells, "an unchanged folder is not listed again");
  failStat = true;
  await fire();
  assert.equal(files.error, null);
  assert.equal(files.loading, false);
  assert.ok(files.held);
  assert.deepEqual(clone(files.entries.get("").map((entry) => entry.name)), ["a.txt"]);
  files.held = { at: Date.now() - 120000 };
  assert.equal(pure.asOf(files.held.at, Date.now()), "as of 2 min ago");
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
  assert.deepEqual(actions, [["read", "shot.png"], ["read", "notes.txt"]]);

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
      exec: async (cmd, args = []) => {
        if (cmd === "mv") {
          await rename(args.at(-2), args.at(-1));
          return { code: 0, stdout: "", stderr: "" };
        }
        if ((cmd === "base64" || cmd === "/usr/bin/base64") && args[0] === "-D") {
          const text = await readFile(args[2], "utf8");
          await writeFile(args[4], Buffer.from(text.replace(/\s/g, ""), "base64"));
          return { code: 0, stdout: "", stderr: "" };
        }
        if (cmd === "pwsh" || cmd === "powershell") return { code: 127, stdout: "", stderr: "" };
        if (cmd === "uname") return { code: 0, stdout: "Darwin\n", stderr: "" };
        if (cmd === "stat" || cmd === "/usr/bin/stat") return { code: 0, stdout: "4 3\n", stderr: "" };
        if (cmd === "base64" || cmd === "/usr/bin/base64") return { code: 0, stdout: "AQIDBA==\n", stderr: "" };
        if (cmd === "head") return { code: 0, stdout: "Hello\n\n![shot](./shot.png)\n", stderr: "" };
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

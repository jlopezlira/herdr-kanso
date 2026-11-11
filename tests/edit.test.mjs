// Saving a text file and a Markdown note: one state machine, one draft per path, one remote write.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileApi, CHUNK, WRITE_RAW, base64Chunks, windowsCommandLength, writeSteps } from "../kanso/mods/kanso-panel/platform-files.js";
import { DraftBook, EDIT_LIMIT, beginSave, byteLength, commitText, applied, didSave, draftKey, keepMine, needsSave, opened, overRead, remember, restore, seenDisk, takeTheirs, tooBig, tooLarge, typed, wholeText, word } from "../kanso/mods/kanso-panel/edit.js";
import { exec, load, nativePlatform } from "./helpers.mjs";

const read = (file) => JSON.parse(readFileSync(new URL(`../kanso/${file}`, import.meta.url), "utf8"));

test("a text file and a Markdown note share one save: edited, saving, saved, conflict, failed and retried", async () => {
  const dirty = typed(opened("a\n"), "b\n");
  assert.equal(word(dirty), "Edited");
  assert.equal(needsSave(dirty), true);
  const saving = beginSave(dirty);
  assert.equal(saving.phase, "saving");
  assert.equal(word(saving), "Saving…");
  assert.equal(beginSave(saving), null);
  assert.equal(needsSave(saving), false);
  const during = typed(saving, "bc\n");
  assert.equal(during.phase, "saving");
  const saved = didSave(during, "b\n");
  assert.equal(saved.phase, "edited");
  assert.equal(saved.saved, "b\n");
  assert.equal(didSave(saving, "b\n").phase, "saved");
  assert.equal(word(didSave(saving, "b\n")), "Saved");

  const io = {
    put: async () => { throw new Error("stale"); },
    read: async () => "c\n",
    quiet: () => false,
    note: () => "Could not save",
  };
  const refused = await commitText(dirty, io);
  assert.equal(refused.result.conflict, true);
  const conflict = applied(dirty, refused.written, refused.result);
  assert.equal(conflict.phase, "conflict");
  assert.equal(word(conflict), "");
  assert.equal(needsSave(conflict), false);
  assert.equal(beginSave(conflict), null);
  const mine = keepMine(conflict);
  assert.equal(mine.saved, "c\n");
  assert.equal(mine.phase, "edited");
  assert.equal(word(mine), "Edited");
  const theirs = takeTheirs(conflict);
  assert.equal(theirs.text, "c\n");
  assert.equal(theirs.phase, "clean");
  assert.equal(needsSave(theirs), false);

  let reads = 0;
  const quiet = await commitText(dirty, {
    put: async () => { throw new Error("timed out"); },
    read: async () => { reads += 1; return "a\n"; },
    quiet: () => true,
    note: () => "light did not answer",
  });
  assert.equal(reads, 0);
  const failed = applied(dirty, quiet.written, quiet.result);
  assert.equal(failed.phase, "failed");
  assert.equal(word(failed), "light did not answer");
  assert.equal(needsSave(failed), true);
  const again = beginSave(failed);
  assert.equal(again.phase, "saving");
  const retried = await commitText(again, { put: async () => {}, read: async () => "b\n", quiet: () => false, note: () => "Could not save" });
  assert.equal(applied(again, retried.written, retried.result).phase, "saved");
});

test("a draft is kept per path and restored with Edited", () => {
  const book = new DraftBook();
  const here = draftKey("/repo/a.txt", null);
  const there = draftKey("/repo/a.txt", "light");
  const other = draftKey("/repo/b.txt", null);
  remember(book, here, typed(opened("a\n"), "mine\n"));
  remember(book, there, typed(opened("a\n"), "remote\n"));
  const back = seenDisk(restore(book.peek(here)), "a\n");
  assert.equal(back.text, "mine\n");
  assert.equal(back.phase, "edited");
  assert.equal(word(back), "Edited");
  assert.equal(book.peek(there).text, "remote\n");
  assert.equal(book.peek(other), null);
  const clash = seenDisk(restore(book.peek(here)), "theirs\n");
  assert.equal(clash.phase, "conflict");
  assert.equal(clash.text, "mine\n");
  remember(book, here, didSave({ ...back, text: "mine\n" }, "mine\n"));
  assert.equal(book.peek(here), null);
  assert.equal(book.peek(there).text, "remote\n");
  remember(book, there, typed(opened("a\n"), "newer\n"));
  remember(book, there, didSave(typed(opened("a\n"), "remote\n"), "remote\n"));
  assert.equal(book.peek(there).text, "newer\n");
});

const scriptOf = (step, dir = "") => step.script ? step.script(dir) : String(step.args(dir)[1]);
const shMissing = (() => {
  try { execFileSync("sh", ["-c", ":"], { stdio: "pipe" }); return false; } catch { return true; }
})();
const powershellHere = ["pwsh", "powershell"].some((name) => {
  try { execFileSync(name, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { stdio: "pipe" }); return true; } catch { return false; }
});

test("a file over 1 MiB of bytes stays a view", () => {
  const wide = "ü".repeat(600000);
  assert.ok(wide.length < EDIT_LIMIT);
  assert.ok(byteLength(wide) > EDIT_LIMIT);
  assert.equal(tooBig(wide), true);
  assert.equal(overRead(new Error("Text file exceeds 1 MiB")), true);
  assert.equal(wholeText(EDIT_LIMIT + 1, "hello").big, true);
  assert.equal(wholeText(EDIT_LIMIT, "a").text, "a");
  assert.equal(wholeText(null, "a".repeat(EDIT_LIMIT)).big, undefined);
  const view = opened(wide);
  assert.equal(word(view), "Too large to edit");
  assert.equal(needsSave(view), false);
  assert.equal(beginSave(view), null);
  assert.equal(beginSave(tooLarge()), null);
  assert.equal(needsSave(tooLarge()), false);
});

test("a remote save writes in place, one call when both sides fit", () => {
  assert.equal(CHUNK % 3, 0);
  assert.equal(WRITE_RAW.linux % 3, 0);
  assert.equal(WRITE_RAW.macos % 3, 0);
  assert.equal(WRITE_RAW.windows % 3, 0);
  assert.deepEqual(base64Chunks(""), [""]);
  assert.equal(base64Chunks("a".repeat(CHUNK)).length, 1);
  const parts = base64Chunks("a".repeat(CHUNK + 1));
  assert.equal(parts.length, 2);
  assert.equal(parts[0].includes("="), false);
  assert.equal(Buffer.from(parts.join(""), "base64").length, CHUNK + 1);
  assert.equal(Buffer.from(base64Chunks("a\nü").join(""), "base64").toString("utf8"), "a\nü");
  for (const platform of ["macos", "linux"]) {
    const one = writeSteps(platform, "/repo/a.txt", "hi\n", "hi\n");
    assert.equal(one.length, 1, platform);
    assert.equal(one[0].args("")[7], "shot");
    const script = scriptOf(one[0]);
    assert.match(script, /mktemp -d/);
    assert.match(script, platform === "macos" ? /\/usr\/bin\/base64 -D/ : /base64 -d/);
    assert.equal(platform === "macos" ? /base64 -d/.test(script) : /\/usr\/bin\/base64 -D/.test(script), false);
    assert.match(script, /cat "\$dir\/new" > "\$target"/);
    assert.match(script, /\[ -e "\$target" \] \|\| \[ -L "\$target" \]/);
    assert.equal(/mv -f|\.kanso-/.test(script), false);
    assert.match(script, platform === "macos" ? /\/usr\/bin\/shasum -a 256/ : /sha256sum/);
    assert.match(script, platform === "macos" ? /\/usr\/bin\/stat -L -f %z/ : /stat -L -c %s/);
    if (platform === "linux") assert.equal(script.includes("/usr/bin/"), false);
    const raw = WRITE_RAW[platform];
    const full = writeSteps(platform, "/repo/a.txt", "a".repeat(raw), "b".repeat(raw));
    assert.equal(full.length, 1, platform);
    const args = full[0].args("");
    assert.ok(args[4].length > (platform === "linux" ? 100000 : 200000), platform);
    assert.ok(args[4].length < 131072 || platform === "macos", platform);
    if (platform === "linux") assert.ok(args.every((arg) => Buffer.byteLength(String(arg)) < 131072));
    if (platform === "macos") {
      const argv = args.reduce((n, arg) => n + Buffer.byteLength(String(arg)), 0);
      assert.ok(argv > 400000 && argv < 1048576 - 200000);
    }
    assert.equal(writeSteps(platform, "/repo/a.txt", "a".repeat(raw + 1), "b").length, 2, platform);
  }
  const win = scriptOf(writeSteps("windows", "/repo/a.txt", "hi\n", "old\n")[0]);
  assert.match(win, /\$env:TEMP/);
  assert.match(win, /\[IO\.File\]::Open/);
  assert.match(win, /SetLength\(0\)/);
  assert.match(win, /Get-FileHash -LiteralPath/);
  assert.ok(win.indexOf("Get-FileHash") < win.indexOf("SetLength"));
  assert.equal(/Move-Item|::Replace|\.kanso-/.test(win), false);
  const fullWin = writeSteps("windows", "/repo/a.txt", "a".repeat(WRITE_RAW.windows), "b".repeat(WRITE_RAW.windows));
  assert.equal(fullWin.length, 1);
  assert.ok(windowsCommandLength(fullWin[0].script("")) < 32767);
  assert.equal(writeSteps("windows", "/repo/a.txt", "a".repeat(WRITE_RAW.windows + 1), "b").length, 2);
  assert.equal(writeSteps("linux", "/repo/a.txt", "", null).length, 1);
  assert.equal(writeSteps("linux", "/repo/a.txt", "a".repeat(200 * 1024), "b".repeat(200 * 1024)).length, 3);
});

test("one save is one remote call when it fits, and a failed step does not touch the target", async () => {
  for (const platform of ["macos", "linux"]) {
    const calls = [];
    const api = fileApi(platform, async (cmd) => { calls.push(cmd); return { code: 0, stdout: "", stderr: "" }; });
    await api.write("/repo/a.txt", "hi\n", "old\n");
    assert.deepEqual(calls, ["sh"], platform);
  }
  const winCalls = [];
  const win = fileApi("windows", async (cmd) => { winCalls.push(cmd); return { code: 0, stdout: "", stderr: "" }; });
  await win.write("/repo/a.txt", "hi\n", "old\n");
  assert.deepEqual(winCalls, ["pwsh"]);
  const dir = await mkdtemp(join(tmpdir(), "kanso-write-"));
  const target = join(dir, "a.txt");
  await writeFile(target, "keep");
  const calls = [];
  const api = fileApi("macos", async (cmd) => {
    calls.push(cmd);
    return { code: 1, stdout: "", stderr: "decode failed" };
  });
  await assert.rejects(() => api.write(target, "new\n", "keep"), /decode failed/);
  assert.equal(await readFile(target, "utf8"), "keep");
  assert.equal(calls.includes("rm"), false);
  assert.equal(calls.includes("mv"), false);
  const kept = [];
  const refused = fileApi("linux", async (cmd) => {
    kept.push(cmd);
    return { code: 3, stdout: "", stderr: "" };
  });
  await assert.rejects(() => refused.write("/repo/a.txt", "mine\n", "old\n"), (error) => error.conflict === true);
  assert.deepEqual(kept, ["sh"]);
  const wiped = [];
  let step = 0;
  const chunked = fileApi("linux", async (cmd, args) => {
    wiped.push([cmd, args]);
    step += 1;
    return step === 1 ? { code: 0, stdout: "/tmp/kanso-kept", stderr: "" } : { code: 1, stdout: "", stderr: "decode failed" };
  });
  await assert.rejects(() => chunked.write("/repo/a.txt", "a".repeat(WRITE_RAW.linux + 1), "b"), /decode failed/);
  const removed = wiped.filter((call) => call[0] === "rm");
  assert.equal(removed.length, 1);
  assert.deepEqual(removed[0][1], ["-rf", "/tmp/kanso-kept"]);
  await rm(dir, { recursive: true, force: true });
});

test("a real save keeps the inode, and a 200 KB linux save is 3 calls", async () => {
  const body = "a".repeat(200 * 1024);
  const linuxCalls = [];
  const linux = fileApi("linux", async (_cmd, args) => {
    linuxCalls.push(args);
    assert.ok(args.every((arg) => Buffer.byteLength(String(arg)) < 131072));
    return { code: 0, stdout: "", stderr: "" };
  });
  await linux.write("/repo/wide.txt", `${body}!`, body);
  assert.equal(linuxCalls.length, 3);
  assert.deepEqual(linuxCalls.map((args) => args[7]), ["begin", "more", "end"]);
  assert.match(linuxCalls[0][1], /stat -L -c %s/);
  assert.equal(linuxCalls[0][1].includes("/usr/bin/"), false);
  if (nativePlatform === "windows" ? !powershellHere : shMissing) return;
  const root = await mkdtemp(join(tmpdir(), "kanso-inode-"));
  const scratch = join(root, "tmp");
  await mkdir(scratch);
  const env = { ...process.env, TMPDIR: scratch, TEMP: scratch, TMP: scratch };
  const run = (cmd, args, options) => exec(cmd, args, { ...options, env });
  const api = fileApi(nativePlatform, run);
  try {
    const target = join(root, "note.txt");
    await writeFile(target, "keep");
    if (nativePlatform !== "windows") await chmod(target, 0o755);
    await api.write(target, "keep!", "keep");
    assert.equal(await readFile(target, "utf8"), "keep!");
    if (nativePlatform !== "windows") assert.equal((await stat(target)).mode & 0o777, 0o755);
    if (nativePlatform !== "windows") {
      const real = join(root, "real.txt");
      const linked = join(root, "link.txt");
      await writeFile(real, "body");
      await symlink(real, linked);
      await api.write(linked, "body!", "body");
      assert.equal((await lstat(linked)).isSymbolicLink(), true);
      assert.equal(await readFile(real, "utf8"), "body!");
    }
    const hard = join(root, "hard.txt");
    const twin = join(root, "twin.txt");
    await writeFile(hard, "same");
    await link(hard, twin);
    const inode = (await stat(hard)).ino;
    await api.write(hard, "same!", "same");
    const after = await stat(hard);
    assert.equal(after.ino, inode);
    assert.equal(after.nlink, 2);
    assert.equal(await readFile(twin, "utf8"), "same!");
    await writeFile(target, "now");
    await assert.rejects(() => api.write(target, "other", "keep"), (error) => error.conflict === true);
    assert.equal(await readFile(target, "utf8"), "now");
    const made = join(root, "made.txt");
    await api.write(made, "hello\n", null);
    assert.equal(await readFile(made, "utf8"), "hello\n");
    await assert.rejects(() => api.write(made, "nope\n", null), (error) => error.conflict === true);
    assert.equal(await readFile(made, "utf8"), "hello\n");
    const calls = [];
    const once = fileApi(nativePlatform, async (cmd, args, options) => { calls.push([cmd, args]); return run(cmd, args, options); });
    await once.write(target, "now!", "now");
    if (nativePlatform === "windows") assert.ok(calls.every((call) => call[0] === "pwsh" || call[0] === "powershell"));
    else {
      assert.deepEqual(calls.map((call) => call[0]), ["sh"]);
      const script = String(calls[0][1][1]);
      if (nativePlatform === "macos") {
        assert.match(script, /\/usr\/bin\/stat -L -f %z/);
        assert.match(script, /\/usr\/bin\/base64 -D/);
        assert.match(script, /\/usr\/bin\/shasum -a 256/);
      } else {
        assert.match(script, /stat -L -c %s/);
        assert.equal(script.includes("/usr/bin/"), false);
      }
    }
    assert.equal((await readdir(scratch)).length, 0);
    assert.equal((await readdir(root)).some((name) => name.includes(".kanso")), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Save is Cmd+S on macOS and Linux and Ctrl+S on Windows", async () => {
  const mac = read("keys.json"), win = read("keys.windows.json");
  assert.equal(mac["mod:kanso-panel"]["cmd-s"], "kanso-panel.save");
  assert.equal(mac["mod:kanso-panel"]["ctrl-s"], undefined);
  assert.equal(win["mod:kanso-panel"]["ctrl-s"], "kanso-panel.save");
  assert.equal(win["mod:kanso-panel"]["cmd-s"], undefined);
  assert.deepEqual(Object.keys(mac), Object.keys(win));
  const { describe } = await load("kanso-help/keymap.js", ["describe"]);
  assert.equal(describe("kanso-panel.save"), "Save the file");
});

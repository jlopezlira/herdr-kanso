// Saving a text file and a Markdown note: one state machine, one draft per path, one remote write.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileApi, CHUNK, base64Chunks, writeSteps, writeTemps } from "../kanso/mods/kanso-panel/platform-files.js";
import { DraftBook, draftKey, remember, opened, restore, seenDisk, typed, beginSave, didSave, keepMine, takeTheirs, word, needsSave, commitText, applied } from "../kanso/mods/kanso-panel/edit.js";
import { load } from "./helpers.mjs";

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

const scriptOf = (step) => String(step.script ?? step.args?.[1] ?? "");

test("a remote save sends base64 in the same chunks a read uses, then compares before it replaces", () => {
  assert.equal(CHUNK % 3, 0);
  assert.deepEqual(base64Chunks(""), [""]);
  assert.equal(base64Chunks("a".repeat(CHUNK)).length, 1);
  const parts = base64Chunks("a".repeat(CHUNK + 1));
  assert.equal(parts.length, 2);
  assert.equal(parts[0].includes("="), false);
  assert.equal(Buffer.from(parts.join(""), "base64").length, CHUNK + 1);
  assert.equal(Buffer.from(base64Chunks("a\nü").join(""), "base64").toString("utf8"), "a\nü");
  for (const platform of ["macos", "linux", "windows"]) {
    const one = writeSteps(platform, "/repo/a.txt", "hi\n", "hi\n");
    assert.equal(one.length, 3, platform);
    const empty = writeSteps(platform, "/repo/a.txt", "", null);
    assert.equal(empty.length, 3, platform);
    const wide = writeSteps(platform, "/repo/a.txt", "a".repeat(CHUNK + 1), "b");
    assert.equal(wide.length, 4, platform);
    const last = scriptOf(one.at(-1));
    if (platform === "windows") {
      assert.match(last, /Get-FileHash -LiteralPath/);
      assert.match(last, /Move-Item -LiteralPath/);
      assert.ok(last.indexOf("Move-Item") > last.indexOf("Get-FileHash"));
      assert.match(scriptOf(one[1]), /FromBase64String/);
      assert.equal(one.some((step) => /shasum|sha256sum|\bmv\b/.test(scriptOf(step))), false);
    } else {
      assert.match(last, platform === "macos" ? /shasum -a 256/ : /sha256sum/);
      assert.match(last, platform === "macos" ? /stat -f %z/ : /stat -c %s/);
      assert.match(last, platform === "macos" ? /base64 -D/ : /base64 -d/);
      assert.match(last, /mv -f -- "\$decoded"/);
      assert.ok(last.indexOf("mv -f") > last.indexOf(platform === "macos" ? "shasum" : "sha256sum"));
      assert.match(scriptOf(one[0]), /printf %s "\$1"/);
    }
    const temps = writeTemps("/repo/a.txt");
    assert.equal(temps.includes("/repo/a.txt"), false);
    assert.ok(temps.includes("/repo/a.txt.kanso-new"));
  }
});

test("one save of a file that fits in one chunk is 3 remote calls, and a failed step leaves the target", async () => {
  for (const platform of ["macos", "linux", "windows"]) {
    const calls = [];
    const api = fileApi(platform, async (cmd, args) => { calls.push(cmd); return { code: 0, stdout: "", stderr: "" }; });
    await api.write("/repo/a.txt", "hi\n", "old\n");
    assert.equal(calls.length, 3, platform);
    assert.equal(calls.filter((cmd) => cmd === "mv").length, 0);
  }
  const dir = await mkdtemp(join(tmpdir(), "kanso-write-"));
  const target = join(dir, "a.txt");
  await writeFile(target, "keep");
  const calls = [];
  const api = fileApi("macos", async (cmd, args) => {
    calls.push([cmd, args]);
    const script = String(args?.[1] ?? "");
    if (script.includes("base64 -D") && !script.includes("mv -f")) return { code: 1, stdout: "", stderr: "decode failed" };
    return { code: 0, stdout: "", stderr: "" };
  });
  await assert.rejects(() => api.write(target, "new\n", "keep"), /decode failed/);
  assert.equal(await readFile(target, "utf8"), "keep");
  assert.equal(calls.some((call) => call[0] === "mv"), false);
  const removed = calls.filter((call) => call[0] === "rm").at(-1)[1];
  assert.ok(removed.includes(`${target}.kanso-b64`));
  assert.ok(removed.includes(`${target}.kanso-new`));
  assert.equal(removed.includes(target), false);
  const clash = [];
  const refused = fileApi("linux", async (cmd, args) => {
    clash.push(cmd);
    if (String(args?.[1] ?? "").includes("mv -f")) return { code: 3, stdout: "", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  });
  await assert.rejects(() => refused.write("/repo/a.txt", "mine\n", "old\n"), (error) => error.conflict === true);
  assert.equal(clash.includes("mv"), false);
  assert.equal(clash.at(-1), "rm");
  await rm(dir, { recursive: true, force: true });
});

test("Save is Cmd+S on macOS and Linux and Ctrl+S on Windows", async () => {
  const mac = read("keys.json"), win = read("keys.windows.json");
  assert.equal(mac["mod:kanso-panel"]["cmd-s"], "kanso-panel.save");
  assert.equal(mac["mod:kanso-panel"]["ctrl-s"], "kanso-panel.save");
  assert.equal(win["mod:kanso-panel"]["ctrl-s"], "kanso-panel.save");
  assert.deepEqual(Object.keys(mac), Object.keys(win));
  const { describe } = await load("kanso-help/keymap.js", ["describe"]);
  assert.equal(describe("kanso-panel.save"), "Save the file");
});

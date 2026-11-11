import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { context, until } from "./helpers.mjs";
import { test, fixture, staged, pending, holder, took, version, updated, stages, killed, chromeIn } from "./update-harness.mjs";

test("A window that starts while another recovers, which then dies, recovers itself", async (t) => {
  const f = await fixture(t);
  await killed(t, f, await chromeIn());
  // The other recoverer: it holds the lock, then dies without settling anything.
  const other = await holder(t, f);
  took(other, "the other recoverer holds the lock");
  const w = await f.window(); // no install of its own to follow
  const { cx, drain } = context();
  cx.timer = { every() {} };
  w.updater.start(cx);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await version(f.home), "1.1.0", "left alone while another holds the lock");
  await other.kill();
  await drain();
  assert.equal(await version(f.home), "1.0.0", "undone once the lock is free");
  assert.equal(w.updater.available(), "1.1.0", "and the update offered again");
  assert.deepEqual(await stages(f.home), []);
});

test("A copy that starts after an install died mid-swap undoes it before it reads the version", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = await killed(t, f, await chromeIn());
  assert.equal(await version(f.home), "1.1.0", "it died with the new kanso-chrome in place");
  const fresh = new f.Updater(f.source);
  fresh.start(cx);
  await until(async () => pending(f).length === 0);
  await drain();
  assert.equal(await version(f.home), "1.0.0", "undone, not left half new");
  assert.equal(await readFile(join(f.home, "mods/kanso-chrome/main.js"), "utf8"), "// 1.0.0\n");
  assert.equal(fresh.available(), "1.1.0", "so the update is offered again");
  assert.equal(f.toasts.filter((n) => n.level === "error").length, 1, "and the one that died is told as such");
  assert.equal(updated(f.toasts).length, 0);
  assert.deepEqual(await staged(f.home), []);
});

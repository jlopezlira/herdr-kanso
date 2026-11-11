import assert from "node:assert/strict";
import { test, fixture, staged, pending, version, updated, killed, chromeIn } from "./update-harness.mjs";

test("A recovery killed partway is not taken for done: the follower tries again and reports what it left", { timeout: 240_000 }, async (t) => {
  const f = await fixture(t);
  const { cx } = await killed(t, f, await chromeIn());
  assert.equal(await version(f.home), "1.1.0", "it died half new");
  process.env.KANSO_UPDATE_STOP = "1"; // every recovery is killed after its first step
  const fresh = new f.Updater(f.source);
  await fresh.follow(cx, pending(f)[0]);
  delete process.env.KANSO_UPDATE_STOP;
  assert.equal(await version(f.home), "1.0.0", "undone, a step at a time");
  assert.equal(updated(f.toasts).length, 0, "never told as updated");
  assert.equal(f.toasts.filter((n) => n.level === "error").length, 1, "told once, as stopped");
  assert.deepEqual(pending(f), []);
  assert.deepEqual(await staged(f.home), []);
});

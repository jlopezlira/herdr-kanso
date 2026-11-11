import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { context, until } from "./helpers.mjs";
import { repo, test, fixture, staged, pending, holder, took, version, updated, stages, killed, chromeIn } from "./update-harness.mjs";

test("An install that died with the new keys in place, retried from another window, ends with the new keys", async (t) => {
  const f = await fixture(t);
  await killed(t, f, 2); // keys aside, then the merged ones in
  const now = JSON.parse(await readFile(new URL("keys.json", repo), "utf8"))["layout:kanso"];
  const live = async () => JSON.parse(await readFile(join(f.home, "keys.json"), "utf8"))["layout:kanso"];
  assert.equal((await live())["cmd-d"], now["cmd-d"], "it died with the release's keys in place");
  assert.equal(await version(f.home), "1.0.0");

  const other = await f.window();
  other.store["kanso.update"] = { latest: "1.1.0" };
  await other.updater.readInstalled();
  const { cx } = context();
  await other.updater.install(cx);
  assert.equal(other.updater.error, null, other.updater.error);
  assert.equal(await version(f.home), "1.1.0");
  const keys = await live();
  assert.equal(keys["cmd-d"], now["cmd-d"], "a shipped key follows the release");
  assert.equal(keys["cmd-shift-w"], now["cmd-shift-w"], "a new key arrives");
  assert.equal(keys["cmd-shift-o"], "mine.open", "your own key stays");
  assert.equal(updated(other.toasts).length, 1);
  assert.deepEqual(await stages(f.home), [], "the dead install's stage settled (its outcome stays for its own window to report)");
});

test("A follower whose recovery finds the lock taken waits for it, then reports once what recovery left", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = await killed(t, f, await chromeIn());
  assert.equal(await version(f.home), "1.1.0", "it died half new");
  // Another window recovering, or what the dead install started still holding its lock.
  const other = await holder(t, f);
  took(other, "the holder takes the lock recovery is waiting on");
  const fresh = new f.Updater(f.source);
  fresh.start(cx);
  await new Promise((r) => setTimeout(r, 400)); // it tries a few times meanwhile
  assert.deepEqual(pending(f).length, 1, "still followed");
  assert.equal(f.toasts.filter((n) => n.level === "error" || n.level === "success").length, 0, "nothing told before recovery ran");
  await other.kill();
  await until(async () => pending(f).length === 0);
  await drain();
  assert.equal(await version(f.home), "1.0.0", "undone");
  assert.equal(f.toasts.filter((n) => n.level === "error").length, 1, "told once, as stopped");
  assert.equal(updated(f.toasts).length, 0, "never as updated");
  assert.deepEqual(await staged(f.home), []);
});

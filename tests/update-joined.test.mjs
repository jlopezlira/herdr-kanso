import assert from "node:assert/strict";
import test from "node:test";
import { context, failure, storeShared, success, until } from "./helpers.mjs";
import { loadUpdater } from "./mod-fixtures.mjs";

test("Checking during another copy's tag lookup reports the outcome once without a second lookup", async () => {
  for (const [reply, title] of [
    [success("a\trefs/tags/v3.30.0"), "kansō is up to date"],
    [failure("offline"), "GitHub could not be reached"],
    [success("a\trefs/tags/v3.31.0"), "kansō 3.31.0 is available"],
  ]) {
    const wait = Promise.withResolvers(), seen = [], calls = [];
    const { Updater } = await loadUpdater({
      ...storeShared({ "kanso.update": { notified: "3.31.0" } }),
      appHome: () => "/app", readTextFile: async () => '{"version":"3.30.0"}',
      notify: (notice) => seen.push(notice.title),
      exec: (command) => { calls.push(command); return wait.promise; },
    });
    const cx = context().cx, silent = new Updater(), manual = new Updater();
    manual.readInstalled = () => assert.fail("a join does not wait for disk");
    const pending = silent.check(cx, true);
    await until(() => calls.length);
    await manual.check(cx, true, true);
    await manual.check(cx, true, true);
    wait.resolve(reply);
    await pending;
    assert.deepEqual(calls, ["git"]);
    assert.deepEqual(seen, [title]);
  }
});

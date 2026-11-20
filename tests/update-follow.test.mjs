import assert from "node:assert/strict";
import { until } from "./helpers.mjs";
import { test, staged, pending, version, updated, started, freshCopy, settled, abandoned, errorsTold } from "./update-harness.mjs";

test("A copy started while another prepares its install waits for it, and the outcome is told once, with its version", async (t) => {
  const { f, cx, drain } = await started(t);
  f.ctl.holdCurl = true; // the keys and layout downloads wait
  const first = f.updater.install(cx);
  await until(async () => pending(f).length === 1 && f.ctl.held > 0);
  freshCopy(f, cx);
  await new Promise((r) => setTimeout(r, 300)); // it looks a few times meanwhile
  assert.equal(pending(f).length, 1, "a mark still preparing is no dead install");
  f.ctl.release();
  await first;
  await settled(f, drain);
  assert.equal(updated(f.toasts).length, 1, "told once");
  assert.ok(!f.toasts.some((n) => /undefined/.test(n.title)));
  assert.equal(errorsTold(f), 0);
  assert.equal(await version(f.home), "1.1.0");
});

test("The copy the swap starts picks up the install's outcome and reports it", async (t) => {
  const { f, cx, drain } = await started(t);
  await f.flag("slow");
  await abandoned(f, cx); // replaced mid-install: never heard from again
  freshCopy(f, cx);
  await f.flag("go");
  await settled(f, drain);
  assert.equal(await version(f.home), "1.1.0");
  assert.equal(updated(f.toasts).length, 1, "reported once, by the fresh copy");
  assert.match(updated(f.toasts)[0].body, /layouts\/kanso\.json\.old-/, "with the notes the first copy made");
  assert.deepEqual(await staged(f.home), []);
});

import assert from "node:assert/strict";
import { context, until } from "./helpers.mjs";
import { test, fixture, staged, pending, version, updated } from "./update-harness.mjs";

test("A copy started while another prepares its install waits for it, and the outcome is told once, with its version", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  f.ctl.holdCurl = true; // the keys and layout downloads wait
  const first = f.updater.install(cx);
  await until(async () => pending(f).length === 1 && f.ctl.held > 0);
  const fresh = new f.Updater(f.source);
  fresh.start(cx);
  await new Promise((r) => setTimeout(r, 300)); // it looks a few times meanwhile
  assert.equal(pending(f).length, 1, "a mark still preparing is no dead install");
  f.ctl.release();
  await first;
  await until(async () => pending(f).length === 0);
  await drain();
  assert.equal(updated(f.toasts).length, 1, "told once");
  assert.ok(!f.toasts.some((n) => /undefined/.test(n.title)));
  assert.equal(f.toasts.filter((n) => n.level === "error").length, 0);
  assert.equal(await version(f.home), "1.1.0");
});

test("The copy the swap starts picks up the install's outcome and reports it", async (t) => {
  const f = await fixture(t);
  const { cx, drain } = context();
  cx.timer = { every() {} };
  f.updater.start(cx); await drain();
  await f.flag("slow");
  f.ctl.abandon = true;
  f.updater.install(cx); // replaced mid-install: never heard from again
  await until(async () => f.ctl.stuck > 0);
  f.ctl.abandon = false;
  const fresh = new f.Updater(f.source);
  fresh.start(cx);
  await f.flag("go");
  await until(async () => pending(f).length === 0);
  await drain();
  assert.equal(await version(f.home), "1.1.0");
  assert.equal(updated(f.toasts).length, 1, "reported once, by the fresh copy");
  assert.match(updated(f.toasts)[0].body, /layouts\/kanso\.json\.old-/, "with the notes the first copy made");
  assert.deepEqual(await staged(f.home), []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { guardHost } from "../kanso/mods/kanso-guard/guard-host.mjs";
import { exec, nativePlatform, temporary } from "./helpers.mjs";

const windowsOnly = { skip: nativePlatform !== "windows" && "Windows guard native integration" };

test("Windows guard reads its own process, working set, idle seconds and machine memory", windowsOnly, async (t) => {
  const host = guardHost({ platform: nativePlatform, run: exec, appHome: await temporary(t) });
  const rows = await host.processes(), own = rows.find((p) => p.pid === process.pid);
  assert.ok(own);
  assert.ok(own.executable);
  assert.ok(Number.isFinite(Date.parse(own.lstart)));
  assert.ok((await host.footprints([process.pid])).get(process.pid) > 0);
  const idle = await host.idleSeconds(), memory = await host.machine();
  assert.ok(Number.isFinite(idle) && idle >= 0);
  assert.ok(memory.totalMB > 0);
  assert.ok(memory.freePct >= 0 && memory.freePct <= 100);
  assert.ok(memory.swapMB >= 0 && memory.swapTotalMB >= memory.swapMB);
});

test("Windows guard stops only a child created for the native test", windowsOnly, async (t) => {
  const host = guardHost({ platform: nativePlatform, run: exec, appHome: await temporary(t) });
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
  await once(child, "spawn");
  const closed = once(child, "close");
  t.after(async () => { if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL"); await closed; });
  assert.equal(host.alive(child.pid), true);
  await host.stop(child.pid);
  if (host.alive(child.pid)) {
    const result = await host.stop(child.pid, true);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.forced, true);
    assert.match(result.note, /no graceful signal/);
  }
  await closed;
  assert.equal(host.alive(child.pid), false);
});

test("Windows guard registers, finds and removes a current-user test task", windowsOnly, async (t) => {
  const root = await temporary(t), self = join(root, "test-only.mjs"), taskName = `kanso-guard-test-${randomUUID()}`;
  await writeFile(self, "setInterval(() => {}, 1000);\n");
  const host = guardHost({ platform: nativePlatform, run: exec, appHome: root, self, taskName });
  try {
    try { await host.install(); }
    catch (error) {
      if (!/access.*denied|0x80070005|privilege.*not held|requires elevation/i.test(error.message)) throw error;
      assert.equal((await host.scheduled()).length, 0, "A partially registered task must fail instead of being skipped");
      t.skip(`Task Scheduler registration is unavailable to this CI account: ${error.message}`);
      return;
    }
    const tasks = await host.scheduled();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].TaskName, taskName);
  } finally {
    await host.uninstall();
    assert.equal((await host.scheduled()).length, 0, "The test task must never remain registered");
  }
});

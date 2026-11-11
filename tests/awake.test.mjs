// A connected remote machine is held awake: the command, the renew, and when nothing is called.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

const names = ["holdCommand", "shouldHold", "osOf", "createAwake", "LEASE_S", "RENEW_MS", "EXEC_TIMEOUT_MS"];
let api;
const loadApi = async () => api ??= await load("kanso-spaces/awake.js", names);

const row = (name, phase) => ({ name, phase });
const holds = (calls) => calls.filter((call) => call.command !== "uname");

function world(reply) {
  const calls = [];
  let now = 0;
  const pending = [];
  const awake = api.createAwake({
    now: () => now,
    run: (call) => {
      calls.push({ ...call, at: now });
      if (call.command === "uname") {
        if (reply.uname instanceof Error) return Promise.reject(reply.uname);
        return Promise.resolve(reply.uname ?? { code: 0, stdout: "Darwin\n", stderr: "" });
      }
      if (reply.hold) return reply.hold(call, { at: now, pending });
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  return { calls, pending, awake, at(n) { now = n; } };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("each system gets an argv array", async () => {
  const { holdCommand, LEASE_S, RENEW_MS, EXEC_TIMEOUT_MS } = await loadApi();
  assert.equal(LEASE_S, 300);
  assert.equal(RENEW_MS, 270_000);
  assert.ok(EXEC_TIMEOUT_MS > LEASE_S * 1000 && EXEC_TIMEOUT_MS <= 600_000);
  assert.deepEqual(clone(holdCommand("darwin", 300)), { command: "caffeinate", args: ["-i", "-t", "300"] });
  assert.deepEqual(clone(holdCommand("Darwin", 25)), { command: "caffeinate", args: ["-i", "-t", "25"] });
  assert.deepEqual(clone(holdCommand("macos", 300).args), ["-i", "-t", "300"]);
  const linux = ["--what=idle:sleep", "--who=kanso", "--why=awake", "sleep", "300"];
  assert.deepEqual(clone(holdCommand("linux", 300)), { command: "systemd-inhibit", args: linux });
  assert.deepEqual(clone(holdCommand("Linux", 300).args), linux);
  const win = holdCommand("windows", 300);
  assert.equal(win.command, "powershell");
  assert.deepEqual(clone(win.args.slice(0, 3)), ["-NoProfile", "-NonInteractive", "-Command"]);
  assert.equal(Array.isArray(win.args), true);
  const script = win.args[3];
  assert.match(script, /SetThreadExecutionState\(\[uint32\]0x80000001\)/);
  assert.match(script, /Start-Sleep -Seconds 300/);
  assert.equal(script.includes("GetSystemPowerStatus"), false);
  assert.equal(script.includes("if ("), false);
  assert.equal(holdCommand("freebsd", 300), null);
});

test("a hold is only for a machine that is connected", async () => {
  const { shouldHold, osOf } = await loadApi();
  assert.equal(shouldHold({ phase: "connected" }), true);
  for (const phase of ["off", "unavailable", "loading", "login", ""]) assert.equal(shouldHold({ phase }), false);
  assert.equal(shouldHold(), false);
  assert.equal(osOf({ code: 0, stdout: "Darwin\n" }), "darwin");
  assert.equal(osOf({ code: 0, stdout: "Linux\n" }), "linux");
  assert.equal(osOf({ threw: true }), null);
  assert.equal(osOf({ threw: true, code: 1 }), null);
  assert.equal(osOf({ missing: true, code: "ENOENT" }), "windows");
  assert.equal(osOf({ threw: true, missing: true }), "windows");
  assert.equal(osOf({ code: 1, stdout: "FreeBSD\n" }), null);
  assert.equal(osOf({ code: 0, stdout: "FreeBSD\n" }), null);
  assert.equal(osOf(null), null);
});

test("a lease renews at 270s and overlaps the one still running", async () => {
  await loadApi();
  const box = world({});
  const dark = row("dark", "connected");
  await box.awake.sync([dark]);
  assert.equal(box.calls.filter((call) => call.command === "uname").length, 1);
  assert.deepEqual(clone(holds(box.calls).map((call) => call.args)), [["-i", "-t", "300"]]);
  assert.equal(holds(box.calls)[0].timeout, api.EXEC_TIMEOUT_MS);
  assert.equal(box.calls[0].timeout, 30_000);
  assert.equal(box.pending.length, 1, "the lease stays running after sync returns");
  assert.equal(box.awake.nextWait(0), 270_000);
  assert.equal(box.awake.nextWait(269_000), 1_000);
  assert.equal(box.awake.nextWait(270_000), 0);
  box.at(269_000);
  await box.awake.sync([row("dark", "connected")]);
  assert.equal(holds(box.calls).length, 1);
  box.at(270_000);
  await box.awake.sync([row("dark", "connected")]);
  assert.deepEqual(clone(holds(box.calls).map((call) => call.args)), [["-i", "-t", "300"], ["-i", "-t", "300"]]);
  assert.equal(box.pending.length, 2);
  assert.equal(box.calls.filter((call) => call.command === "uname").length, 1);
  assert.equal(box.awake.nextWait(270_000), 270_000);
});

test("off, unreachable, loading, login, and no machines never call", async () => {
  await loadApi();
  const box = world({});
  await box.awake.sync([]);
  await box.awake.sync();
  await box.awake.sync([row("", "connected"), { phase: "connected" }]);
  for (const phase of ["off", "unavailable", "loading", "login"]) {
    box.at(box.calls.length);
    await box.awake.sync([row("dark", phase)]);
  }
  box.at(1_000_000);
  await box.awake.sync([row("dark", "off")]);
  assert.equal(box.calls.length, 0);
  assert.equal(box.awake.nextWait(), null);
});

test("a failed lease waits until the renew time, and a missing command waits for a new connection", async () => {
  await loadApi();
  const failed = world({ hold: () => Promise.resolve({ code: 1, stdout: "", stderr: "no" }) });
  await failed.awake.sync([row("dark", "connected")]);
  await tick();
  failed.at(269_000);
  await failed.awake.sync([row("dark", "connected")]);
  assert.equal(holds(failed.calls).length, 1);
  failed.at(270_000);
  await failed.awake.sync([row("dark", "connected")]);
  assert.equal(holds(failed.calls).length, 2);

  const said = world({ hold: () => Promise.resolve({ code: 1, stdout: "", stderr: "idle inhibitor not found" }) });
  await said.awake.sync([row("dark", "connected")]);
  await tick();
  assert.equal(said.awake.nextWait(0), 270_000);
  said.at(269_000);
  await said.awake.sync([row("dark", "connected")]);
  assert.equal(holds(said.calls).length, 1);
  said.at(270_000);
  await said.awake.sync([row("dark", "connected")]);
  assert.equal(holds(said.calls).length, 2);

  const missing = world({ hold: () => Promise.reject(Object.assign(new Error("caffeinate: not found"), { code: "ENOENT" })) });
  await missing.awake.sync([row("dark", "connected")]);
  await tick();
  assert.equal(missing.awake.nextWait(), null);
  missing.at(1_000_000);
  await missing.awake.sync([row("dark", "connected")]);
  assert.equal(holds(missing.calls).length, 1);
  assert.equal(missing.calls.filter((call) => call.command === "uname").length, 1);
  await missing.awake.sync([row("dark", "off")]);
  await missing.awake.sync([row("dark", "connected")]);
  assert.equal(holds(missing.calls).length, 2);
  assert.equal(missing.calls.filter((call) => call.command === "uname").length, 2);
  assert.equal(holds(missing.calls)[1].args[0], "-i");
});

test("a failure from the previous connection does not stop the next one", async () => {
  await loadApi();
  const releases = [];
  const box = world({ hold: () => new Promise((resolve, reject) => releases.push({ resolve, reject })) });
  await box.awake.sync([row("dark", "connected")]);
  await box.awake.sync([row("dark", "off")]);
  await box.awake.sync([row("dark", "connected")]);
  releases[0].reject(Object.assign(new Error("not found"), { code: "ENOENT" }));
  await new Promise((resolve) => setImmediate(resolve));
  box.at(270_000);
  await box.awake.sync([row("dark", "connected")]);
  assert.equal(box.calls.filter((call) => call.command === "uname").length, 2);
  assert.equal(holds(box.calls).length, 3);
});

test("the system is probed once per connection, and a probe that cannot start is Windows", async () => {
  await loadApi();
  const linux = world({ uname: { code: 0, stdout: "Linux\n", stderr: "" }, hold: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }) });
  await linux.awake.sync([row("a", "connected"), row("b", "connected")]);
  await linux.awake.sync([row("a", "connected"), row("b", "connected")]);
  assert.equal(linux.calls.filter((call) => call.command === "uname").length, 2);
  assert.deepEqual(holds(linux.calls).map((call) => call.command), ["systemd-inhibit", "systemd-inhibit"]);
  linux.at(270_000);
  await linux.awake.sync([row("a", "connected")]);
  assert.equal(linux.calls.filter((call) => call.command === "uname").length, 2);
  assert.equal(holds(linux.calls).length, 3);

  const windows = world({
    uname: Object.assign(new Error("not found"), { code: "ENOENT" }),
    hold: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
  });
  await windows.awake.sync([row("win", "connected")]);
  await windows.awake.sync([row("win", "connected")]);
  assert.equal(windows.calls.filter((call) => call.command === "uname").length, 1);
  assert.equal(holds(windows.calls).length, 1);
  assert.equal(holds(windows.calls)[0].command, "powershell");
  assert.match(holds(windows.calls)[0].args[3], /SetThreadExecutionState\(\[uint32\]0x80000001\)/);
  assert.equal(holds(windows.calls)[0].args[3].includes("GetSystemPowerStatus"), false);

  const shell = world({ uname: { code: 127, stdout: "", stderr: "uname: not found" }, hold: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }) });
  await shell.awake.sync([row("win", "connected")]);
  assert.equal(holds(shell.calls)[0].command, "powershell");

  const odd = world({ uname: { code: 0, stdout: "FreeBSD\n", stderr: "" } });
  await odd.awake.sync([row("bsd", "connected")]);
  assert.equal(holds(odd.calls).length, 0);
  odd.at(269_000);
  await odd.awake.sync([row("bsd", "connected")]);
  assert.equal(odd.calls.length, 1);
  odd.at(270_000);
  await odd.awake.sync([row("bsd", "connected")]);
  assert.equal(odd.calls.length, 2);
  await odd.awake.sync([row("bsd", "unavailable")]);
  await odd.awake.sync([row("bsd", "connected")]);
  assert.equal(odd.calls.filter((call) => call.command === "uname").length, 3);
  assert.equal(holds(odd.calls).length, 0);
});

test("a probe that throws without a missing command is tried again at the renew time", async () => {
  await loadApi();
  const hiccup = world({ uname: Object.assign(new Error("the machine is unreachable"), { code: "ETIMEDOUT" }) });
  await hiccup.awake.sync([row("dark", "connected")]);
  assert.equal(hiccup.calls.filter((call) => call.command === "uname").length, 1);
  assert.equal(holds(hiccup.calls).length, 0);
  assert.equal(hiccup.awake.nextWait(0), 270_000);
  hiccup.at(269_000);
  await hiccup.awake.sync([row("dark", "connected")]);
  assert.equal(hiccup.calls.length, 1);
  hiccup.at(270_000);
  await hiccup.awake.sync([row("dark", "connected")]);
  assert.equal(hiccup.calls.filter((call) => call.command === "uname").length, 2);
  assert.equal(holds(hiccup.calls).length, 0);
  assert.equal(hiccup.awake.nextWait(270_000), 270_000);
});

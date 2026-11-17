// Ports on every connected computer: each listed under its own, acted on there, and one out of reach never holds up this one.
import { loadPorts } from "./mod-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { clone, success, failure, keeping, wordsOf, timedContext } from "./helpers.mjs";


// This computer runs :3000 under /h; "light" runs :5173 under /home/jj.
const COMPUTERS = {
  "": { home: "/h", listen: "p100\ncnode\nn*:3000\n", cwd: "p100\nfcwd\nn/h/app\n", ps: "  100     1   01:00 node server.js\n" },
  light: { home: "/home/jj", listen: "p200\ncnode\nn*:5173\n", cwd: "p200\nfcwd\nn/home/jj/site\n", ps: "  200     1   02:00 node vite\n" },
};

const ok = (stdout) => (success(stdout));

// `answer(command, args, on)` may answer for a computer first; `clock.t` is the panel's time.
function computers({ unreachable = null, held = null, answer = () => null, names = ["light"], terms = [] } = {}) {
  const calls = [], opened = [], timers = [], clock = { t: 1_800_000_000_000 }, off = new Set([unreachable].filter(Boolean));
  const { element, ids } = keeping();
  const unix = (command, args, on) => {
    const m = COMPUTERS[on ?? ""];
    if (command === "pwsh" || command === "powershell") return failure("not found", 127);
    if (command === "uname") return ok("Darwin\n");
    if (command === "sh" && args.some((a) => a.includes("$HOME"))) return ok(m.home);
    if (command === "lsof") return ok(args.includes("cwd") ? m.cwd : m.listen);
    if (command === "ps") return ok(m.ps);
    return ok("");
  };
  const host = {
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [clock.t])); } static now() { return clock.t; } },
    appHome: () => "/app", home: () => "/h", theme: () => ({}), readTextFile: async () => null, terminals: () => terms,
    machines: () => [{ name: null, layout: "ready" }, ...names.map((name) => ({ name, layout: "ready" }))],
    shared: (key) => (key === "kanso.alias" ? { "": "dark" } : undefined),
    hc: async (args) => (args[0] === "machine" ? ok(JSON.stringify({ machines: [{ name: "light", target: "jj@light.local", state: "connected" }] })) : failure("")),
    exec: async (command, args, options = {}) => {
      calls.push([command, ...args, options.on ?? null]);
      if (options.on && off.has(options.on)) throw new Error("light is unreachable");
      if (options.on && held) await held;
      return answer(command, args, options.on, options) ?? unix(command, args, options.on);
    },
    div: element, v_flex: element, h_flex: element, svg: element,
    Button: { new: (id) => { ids.push(id); return element(); } },
  };
  const { cx, pending, drain } = timedContext(timers, { sleep: async () => {}, open_url: (url) => opened.push(url) });
  const on = (name) => calls.filter((c) => c.at(-1) === name);
  // Runs the one-second waits a press left, as the clock passes.
  const wait = async () => { for (const [ms, fn] of timers.splice(0)) if (ms === 1000) { clock.t += ms; fn(cx); await drain(); } };
  // A read of `view` again, with `options`; `later` ms on the clock first.
  const again = async (view, options, later = 0) => {
    clock.t += later;
    view.refresh(cx, options);
    await drain();
  };
  const stop = async (view, row) => {
    view.stop([row], cx);
    await drain();
  };
  return { host, cx, calls, ids, opened, pending, drain, clock, on, off, wait, timers, again, stop };
}

const portsView = async (f) => {
  const { Ports } = await loadPorts(f.host);
  const view = new Ports();
  view.init(f.cx);
  return view;
};
const listedPorts = async (f) => {
  const view = await portsView(f);
  await f.drain();
  return view;
};
// Ports listed on this computer and light, and light's first row.
const listed = async (options) => {
  const f = computers(options);
  const view = await listedPorts(f);
  return { f, view, row: view.remote.light.list?.[0] };
};
// Stop pressed on light's row while light is still being read.
const stopWhileRead = async () => {
  const { f, view, row } = await listed();
  view.remote = { light: { ...view.remote.light, reading: f.clock.t } };
  view.stop([row], f.cx);
  return { f, view };
};
// One held read, let go by `release()`.
const holding = () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  return { held, release };
};

test("Ports lists this computer's servers and another computer's, each under its computer's name, this one first", async () => {
  const { f, view } = await listed();
  assert.deepEqual(clone(view.list.map((s) => [s.pid, s.ports, s.machine ?? null])), [[100, [3000], null]]);
  assert.deepEqual(clone(view.remote.light.list.map((s) => [s.pid, s.ports, s.machine, s.cwd])), [[200, [5173], "light", "/home/jj/site"]]);
  assert.ok(f.calls.some((c) => c[0] === "lsof" && c.at(-1) === "light"), "light's own listening sockets are asked of light");
  const texts = wordsOf(view.render(f.cx));
  const dark = texts.indexOf("dark"), light = texts.indexOf("light");
  assert.ok(dark >= 0 && light > dark, "dark's group, then light's");
  assert.ok(texts.indexOf(":3000") > dark && texts.indexOf(":3000") < light);
  assert.ok(texts.indexOf(":5173") > light);
  assert.ok(f.ids.includes("pt-stop-light-200") && f.ids.includes("pt-open-light-200"), "light's row keeps its actions");
});

test("Stop and Open on another computer's server act on that computer", async () => {
  const { f, view, row } = await listed();
  f.calls.length = 0;
  await f.stop(view, row);
  assert.deepEqual(clone(f.calls.find((c) => c[0] === "kill")), ["kill", "-TERM", "200", "light"], "the signal runs on light");
  assert.ok(!f.calls.some((c) => c[0] === "kill" && c.at(-1) === null), "nothing is stopped here");
  view.openPort(row, f.cx);
  view.openPort(view.list[0], f.cx);
  await f.drain();
  assert.deepEqual(f.opened, ["http://localhost:3000", "http://light.local:5173"]);
});

test("A computer out of reach is one quiet line and this computer's list does not wait for it", async () => {
  const { held, release } = holding();
  const slow = computers({ held });
  const { Ports } = await loadPorts(slow.host);
  const waiting = new Ports();
  waiting.init(slow.cx);
  const [remote, local] = slow.pending.splice(0);
  await local;
  assert.deepEqual(clone(waiting.list.map((s) => s.pid)), [100], "this computer's servers are shown while light still answers");
  release();
  await remote;

  const f = computers({ unreachable: "light" });
  const loaded = await loadPorts(f.host);
  const view = new loaded.Ports();
  view.init(f.cx);
  await f.drain();
  assert.deepEqual(clone(view.list.map((s) => s.pid)), [100]);
  assert.equal(view.note, null, "no error for the computer out of reach");
  assert.equal(view.remote.light.why, "unreachable");
  const texts = wordsOf(view.render(f.cx));
  assert.ok(texts.includes("light · unreachable"), "the one line every computer out of reach gets");
  assert.ok(texts.includes(":3000"));
  assert.ok(!texts.includes(":5173"));
});

test("Another computer is read once a minute at rest, at once when asked", async () => {
  const { f, view } = await listed();
  const asked = () => f.on("light").filter((c) => c[0] === "lsof" && c.includes("-iTCP")).length;
  assert.equal(asked(), 1);
  await f.again(view);
  assert.equal(asked(), 1, "the ten-second tick leaves light alone");
  await f.again(view, { history: true, now: true });
  assert.equal(asked(), 2, "Read again asks light too");
});

test("At rest another computer costs three calls a minute: its terminals' pids and its platform are asked once", async () => {
  const f = computers({ terms: [{ address: "light/t1", state: "live" }, { address: "t9", state: "live", pid: 1 }],
    answer: (command, args) => (command === "hc" ? ok(JSON.stringify({ pid: 7 })) : null) });
  const view = await listedPorts(f);
  const hcGets = f.calls.filter((c) => c[0] === "hc");
  assert.deepEqual(clone(hcGets), [["hc", "get", "light/t1", "--json", null]], "light's terminal is asked once, this computer's already has its pid");
  assert.equal(f.on("light").filter((c) => ["pwsh", "powershell", "uname"].includes(c[0])).length, 3, "one probe: pwsh, powershell, uname");
  f.calls.length = 0;
  await f.again(view, undefined, 60_000);
  assert.deepEqual(clone(f.on("light").map((c) => c[0])), ["lsof", "lsof", "ps"]);
  assert.ok(!f.calls.some((c) => c[0] === "hc"), "the pid is kept for the view");
});

test("Each Herdr command about another computer's terminal gives up after the remote limit", async () => {
  const seen = [];
  const f = computers({ terms: [{ address: "light/t1", state: "live" }],
    answer: (command, _args, _on, options) => { if (command === "hc") { seen.push(options.timeout); return ok("{}"); } return null; } });
  const { Ports } = await loadPorts(f.host);
  new Ports().init(f.cx);
  await f.drain();
  assert.deepEqual(seen, [12000]);
});

test("A computer that keeps failing is asked after 1, 2, 4 minutes, up to 10; Read again asks at once", async () => {
  const { f, view } = await listed({ unreachable: "light" });
  const tries = () => f.on("light").filter((c) => c[0] === "pwsh").length;
  const tick = async (ms) => { await f.again(view, undefined, ms); return tries(); };
  assert.equal(tries(), 1);
  assert.equal(await tick(59_000), 1);
  assert.equal(await tick(1_000), 2, "after one minute");
  assert.equal(await tick(119_000), 2);
  assert.equal(await tick(1_000), 3, "then two");
  assert.equal(await tick(239_000), 3);
  assert.equal(await tick(1_000), 4, "then four");
  for (const wait of [480_000, 600_000]) await tick(wait);
  assert.equal(await tick(599_000), 6);
  assert.equal(await tick(1_000), 7, "never more than ten minutes apart");
  await f.again(view, { now: true });
  assert.equal(tries(), 8, "Read again does not wait");
  assert.equal(await tick(60_000), 9, "and starts the waits over");
});

test("While one read of a computer runs, no second one starts", async () => {
  const { held, release } = holding();
  const f = computers({ held });
  const view = await portsView(f);
  view.refresh(f.cx, { now: true });
  view.refresh(f.cx, { now: true });
  release();
  await f.drain();
  assert.equal(f.on("light").filter((c) => c[0] === "pwsh").length, 1);
});

test("Stop on another computer leaves a pid alone when it is no longer the server its row showed", async () => {
  let recycled = false;
  const { f, view, row } = await listed({ answer: (command, _args, on) => (on === "light" && command === "ps" && recycled ? ok("  200     1   00:03 node other\n") : null) });
  recycled = true;
  f.clock.t += 40_000;
  f.calls.length = 0;
  await f.stop(view, row);
  assert.ok(!f.calls.some((c) => c[0] === "kill"), "no signal to the new process");
  assert.ok(f.on("light").some((c) => c[0] === "ps"), "its list is read again instead");
  assert.equal(view.stopping.size, 0);
});

test("A Windows computer lists its terminals' servers and stops them with taskkill there", async () => {
  const created = new Date(1_800_000_000_000 - 300_000).toISOString();
  const f = computers({ names: ["win"], terms: [{ address: "win/t2", state: "live", pid: 30 }],
    answer: (command, args, on) => {
      if (on !== "win") return null;
      const script = args.at(-1) ?? "";
      if (command === "pwsh" && script.includes("OSVersion")) return ok("Win32NT");
      if (command === "pwsh" && script.includes("Get-NetTCPConnection")) return ok('[{"pid":300,"port":8080},{"pid":400,"port":9000}]');
      if (command === "pwsh" && script.includes("Win32_Process")) return ok(JSON.stringify([{ pid: 300, ppid: 30, command: "node app.js", name: "node.exe", created }, { pid: 400, ppid: 4, command: "svchost", name: "svchost.exe", created }]));
      if (command === "pwsh" && script.includes("$HOME")) return ok("C:\\Users\\jj");
      return ok("");
    } });
  const view = await listedPorts(f);
  assert.deepEqual(clone(view.remote.win.list.map((s) => [s.pid, s.ports, s.owner, s.machine])), [[300, [8080], "win/t2", "win"]], "only the one its terminal runs");
  await f.stop(view, view.remote.win.list[0]);
  assert.deepEqual(clone(f.calls.find((c) => c[0] === "taskkill")), ["taskkill", "/PID", "300", "win"]);
});

test("A Linux computer without lsof says so on its line instead of unreachable", async () => {
  const f = computers({ answer: (command, _args, on) => {
    if (on !== "light") return null;
    if (command === "uname") return ok("Linux\n");
    if (command === "lsof") return failure("sh: 1: lsof: not found", 127);
    return null;
  } });
  const view = await listedPorts(f);
  const texts = wordsOf(view.render(f.cx));
  assert.ok(texts.includes("light · lsof is not installed"));
  assert.ok(texts.includes(":3000"));
});

test("Stop pressed while another computer is being read waits for that read, then stops", async () => {
  const { f, view } = await stopWhileRead();
  await f.wait();
  assert.equal(view.stopping.size, 1, "the row shows Stopping…");
  assert.ok(!f.calls.some((c) => c[0] === "kill"));
  view.remote = { light: { ...view.remote.light, reading: 0 } };
  await f.wait();
  assert.deepEqual(clone(f.calls.find((c) => c[0] === "kill")), ["kill", "-TERM", "200", "light"], "the press was kept");
  assert.equal(view.stopping.size, 0);
  assert.equal(view.remote.light.said, null);
});

test("Stop on a computer that does not answer says why in one line and keeps its rows", async () => {
  const { f, view, row } = await listed();
  f.off.add("light");
  await f.stop(view, row);
  assert.ok(!f.calls.some((c) => c[0] === "kill"));
  assert.equal(view.stopping.size, 0, "Stopping… does not stay");
  const texts = wordsOf(view.render(f.cx));
  assert.ok(texts.includes("light · not stopped, unreachable"));
  assert.ok(texts.includes(":5173"), "its last rows stay");
});

test("Stop pressed while a read never ends gives up after a while and says so", async () => {
  const { f, view } = await stopWhileRead();
  for (let i = 0; i < 50 && f.timers.length; i++) await f.wait();
  assert.ok(!f.calls.some((c) => c[0] === "kill"));
  assert.equal(view.stopping.size, 0);
  assert.equal(view.remote.light.said, "not stopped, it is still being read");
});

test("A terminal Herdr gives no pid for is not asked again until it goes", async () => {
  const f = computers({ terms: [{ address: "light/t1", state: "live" }], answer: (command) => (command === "hc" ? ok("{}") : null) });
  const view = await listedPorts(f);
  await f.again(view, undefined, 60_000);
  assert.equal(f.calls.filter((c) => c[0] === "hc").length, 1);
});

test("A computer's not-stopped line shows even with no rows left and goes with its next good read", async () => {
  let gone = false;
  const { f, view, row } = await listed({ answer: (command, args, on) => (on === "light" && gone && command === "lsof" && args.includes("-iTCP") ? ok("") : null) });
  gone = true;
  await f.stop(view, row);
  assert.deepEqual(clone(view.remote.light.list), []);
  assert.ok(wordsOf(view.render(f.cx)).includes("light · not stopped, that server is gone"), "said with no rows under it");
  f.off.add("light");
  await f.again(view, undefined, 60_000);
  assert.equal(view.remote.light.said, "not stopped, that server is gone", "a failed read leaves it");
  f.off.delete("light");
  await f.again(view, { now: true });
  assert.equal(view.remote.light.said, null, "a good read clears it");
  assert.ok(!wordsOf(view.render(f.cx)).some((t) => t.includes("not stopped")));
});

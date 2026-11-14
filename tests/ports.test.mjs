// Ports on every connected computer: each listed under its own, acted on there, and one out of reach never holds up this one.
import assert from "node:assert/strict";
import test from "node:test";
import { clone, load } from "./helpers.mjs";

// Fake elements that keep their children, so a test reads the texts in the order the panel shows them.
const NODE = Symbol("node");
const element = (ids) => {
  const kids = [];
  const proxy = new Proxy(function el() {}, { get: (_target, method) => {
    if (method === NODE) return kids;
    return (...args) => {
      if (method === "when" && args[0]) args[1](proxy);
      if (method === "id") ids.push(args[0]);
      if (method === "child") kids.push(args[0]);
      if (method === "children") kids.push(...args[0]);
      return proxy;
    };
  } });
  return proxy;
};
const textsOf = (node) => (typeof node === "string" ? [node] : node?.[NODE] ? node[NODE].flatMap(textsOf) : []);

// This computer runs :3000 under /h; "light" runs :5173 under /home/jj.
const COMPUTERS = {
  "": { home: "/h", listen: "p100\ncnode\nn*:3000\n", cwd: "p100\nfcwd\nn/h/app\n", ps: "  100     1   01:00 node server.js\n" },
  light: { home: "/home/jj", listen: "p200\ncnode\nn*:5173\n", cwd: "p200\nfcwd\nn/home/jj/site\n", ps: "  200     1   02:00 node vite\n" },
};

function computers({ unreachable = null, held = null } = {}) {
  const calls = [], ids = [], opened = [], pending = [];
  const answer = (command, args, on) => {
    const m = COMPUTERS[on ?? ""];
    if (command === "powershell") return { code: 1, stdout: "", stderr: "" };
    if (command === "uname") return { code: 0, stdout: "Darwin\n", stderr: "" };
    if (command === "sh" && args.some((a) => a.includes("$HOME"))) return { code: 0, stdout: m.home, stderr: "" };
    if (command === "lsof") return { code: 0, stdout: args.includes("cwd") ? m.cwd : m.listen, stderr: "" };
    if (command === "ps") return { code: 0, stdout: m.ps, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const host = {
    appHome: () => "/app", home: () => "/h", theme: () => ({}), readTextFile: async () => null,
    machines: () => [{ name: null, layout: "ready" }, { name: "light", layout: "ready" }],
    shared: (key) => (key === "kanso.alias" ? { "": "dark" } : undefined),
    hc: async (args) => (args[0] === "machine" ? { code: 0, stdout: JSON.stringify({ machines: [{ name: "light", target: "jj@light.local", state: "connected" }] }), stderr: "" } : { code: 1, stdout: "", stderr: "" }),
    exec: async (command, args, options = {}) => {
      calls.push([command, ...args, options.on ?? null]);
      if (options.on && options.on === unreachable) throw new Error("light is unreachable");
      if (options.on && held) await held;
      return answer(command, args, options.on);
    },
    div: () => element(ids), v_flex: () => element(ids), h_flex: () => element(ids), svg: () => element(ids),
    Button: { new: (id) => { ids.push(id); return element(ids); } },
  };
  const cx = {
    notify() {}, sleep: async () => {}, open_url: (url) => opened.push(url),
    spawn(fn) { const p = fn(cx); pending.push(p); return { cancel() {} }; },
    timer: { every: () => ({ cancel() {} }), after: () => ({ cancel() {} }) },
  };
  const drain = async () => { while (pending.length) await pending.shift(); };
  return { host, cx, calls, ids, opened, pending, drain };
}

test("Ports lists this computer's servers and another computer's, each under its computer's name, this one first", async () => {
  const f = computers();
  const { Ports } = await load("kanso-panel/ports.js", ["Ports"], f.host);
  const view = new Ports();
  view.init(f.cx);
  await f.drain();
  assert.deepEqual(clone(view.list.map((s) => [s.pid, s.ports, s.machine ?? null])), [[100, [3000], null]]);
  assert.deepEqual(clone(view.remote.light.list.map((s) => [s.pid, s.ports, s.machine, s.cwd])), [[200, [5173], "light", "/home/jj/site"]]);
  assert.ok(f.calls.some((c) => c[0] === "lsof" && c.at(-1) === "light"), "light's own listening sockets are asked of light");
  const texts = textsOf(view.render(f.cx));
  const dark = texts.indexOf("dark"), light = texts.indexOf("light");
  assert.ok(dark >= 0 && light > dark, "dark's group, then light's");
  assert.ok(texts.indexOf(":3000") > dark && texts.indexOf(":3000") < light);
  assert.ok(texts.indexOf(":5173") > light);
  assert.ok(f.ids.includes("pt-stop-light-200") && f.ids.includes("pt-open-light-200"), "light's row keeps its actions");
});

test("Stop and Open on another computer's server act on that computer", async () => {
  const f = computers();
  const { Ports } = await load("kanso-panel/ports.js", ["Ports"], f.host);
  const view = new Ports();
  view.init(f.cx);
  await f.drain();
  const row = view.remote.light.list[0];
  f.calls.length = 0;
  view.stop([row], f.cx);
  await f.drain();
  assert.deepEqual(clone(f.calls.find((c) => c[0] === "kill")), ["kill", "-TERM", "200", "light"], "the signal runs on light");
  assert.ok(!f.calls.some((c) => c[0] === "kill" && c.at(-1) === null), "nothing is stopped here");
  view.openPort(row, f.cx);
  view.openPort(view.list[0], f.cx);
  await f.drain();
  assert.deepEqual(f.opened, ["http://localhost:3000", "http://light.local:5173"]);
});

test("A computer out of reach is one quiet line and this computer's list does not wait for it", async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const slow = computers({ held });
  const { Ports } = await load("kanso-panel/ports.js", ["Ports"], slow.host);
  const waiting = new Ports();
  waiting.init(slow.cx);
  const [remote, local] = slow.pending.splice(0);
  await local;
  assert.deepEqual(clone(waiting.list.map((s) => s.pid)), [100], "this computer's servers are shown while light still answers");
  release();
  await remote;

  const f = computers({ unreachable: "light" });
  const loaded = await load("kanso-panel/ports.js", ["Ports"], f.host);
  const view = new loaded.Ports();
  view.init(f.cx);
  await f.drain();
  assert.deepEqual(clone(view.list.map((s) => s.pid)), [100]);
  assert.equal(view.note, null, "no error for the computer out of reach");
  assert.equal(view.remote.light.failed, true);
  const texts = textsOf(view.render(f.cx));
  assert.ok(texts.includes("light") && texts.includes("Unreachable"));
  assert.ok(texts.includes(":3000"));
  assert.ok(!texts.includes(":5173"));
});

test("Another computer is read once a minute at rest, at once when asked", async () => {
  const f = computers();
  const { Ports } = await load("kanso-panel/ports.js", ["Ports"], f.host);
  const view = new Ports();
  view.init(f.cx);
  await f.drain();
  const asked = () => f.calls.filter((c) => c.at(-1) === "light" && c[0] === "lsof" && c.includes("-iTCP")).length;
  assert.equal(asked(), 1);
  view.refresh(f.cx);
  await f.drain();
  assert.equal(asked(), 1, "the ten-second tick leaves light alone");
  view.refresh(f.cx, { history: true, now: true });
  await f.drain();
  assert.equal(asked(), 2, "Read again asks light too");
});

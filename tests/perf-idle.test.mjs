// Idle budgets: timers that used to redraw or read when nothing had changed.
import test from "node:test";
import assert from "node:assert/strict";
import { temporary, until } from "./helpers.mjs";
import { fixture, loadMod } from "./perf-harness.mjs";

const gitOf = (f) => f.state.processes.filter((p) => p.command === "git");
const hcReads = (f) => f.state.processes.filter((p) => p.command === "hc" && p.args[0] === "read");
const asleepTimer = (f) => f.state.timers.find((timer) => timer.every && timer.ms === 30000 && String(timer.fn).includes("pollSleepWork"));

function countRedraws(f) {
  const seen = { n: 0 };
  const notify = f.cx.notify.bind(f.cx);
  f.cx.notify = () => { seen.n += 1; notify(); };
  return seen;
}

async function sidebar(t) {
  const dir = await temporary(t), f = fixture({ dir, working: 0 });
  const redraws = countRedraws(f);
  const { Kdb } = await loadMod("kanso-spaces/kdb.js", ["Kdb"], f.host);
  f.host.Kdb = Kdb;
  const db = new Kdb();
  await db.open();
  await db.migrate();
  const { Spaces } = await loadMod("kanso-spaces/main.js", ["Spaces"], f.host);
  const view = new Spaces();
  view.init({}, f.cx);
  await f.settle();
  await f.advance(1000);
  return { f, view, redraws };
}

function askGit(view, f) {
  const keys = [...new Set(Object.values(view.at ?? {}))];
  assert.ok(keys.length > 0, "the sidebar has a project to ask about");
  for (const key of keys) {
    view.git[key] = { name: "repo", branch: "main", ahead: 0, behind: 0, repo: JSON.stringify([null, "/repo"]), linked: false };
    view.checked[key] = f.state.now;
    view.unsure.delete(key);
  }
}

test("an idle sidebar redraws 0 times from the asleep tick and from an unchanged conversation", async (t) => {
  const { f, view, redraws } = await sidebar(t);
  const timer = asleepTimer(f);
  assert.ok(timer, "the asleep tick is armed");
  redraws.n = 0;
  timer.fn(f.cx);
  await f.settle();
  timer.fn(f.cx);
  await f.settle();
  view.refreshThreads(f.cx);
  await f.settle();
  assert.equal(redraws.n, 0, `asleep tick and unchanged threads redrawn ${redraws.n} times; budget 0`);
});

test("a collapsed rail asks git 0 times a minute, and opening it reads at once", async (t) => {
  const { f, view } = await sidebar(t);
  askGit(view, f);
  f.shared.set("sidebar.collapsed", true);
  f.state.processes.length = 0;
  await f.advance(60_000);
  assert.equal(gitOf(f).length, 0, `collapsed rail started ${gitOf(f).length} git processes per minute; budget 0`);
  f.shared.set("sidebar.collapsed", false);
  f.state.processes.length = 0;
  await f.advance(2500);
  assert.ok(gitOf(f).length > 0, "opening the rail reads git on the next look, not a minute later");
});

test("a window behind others asks git 0 times a minute, and coming forward reads at once", async (t) => {
  const { f, view } = await sidebar(t);
  askGit(view, f);
  f.state.active = false;
  f.state.processes.length = 0;
  await f.advance(60_000);
  assert.equal(gitOf(f).length, 0, `a window behind started ${gitOf(f).length} git processes per minute; budget 0`);
  f.state.active = true;
  f.state.processes.length = 0;
  await f.advance(2500);
  assert.ok(gitOf(f).length > 0, "coming forward reads git on the next look");
});

function armLook(f) {
  const exec = f.host.exec, readTextFile = f.host.readTextFile;
  f.state.bytes = 40;
  f.state.mtime = 1_700_000_000;
  f.host.exec = async (command, args = [], options) => {
    if (command === "stat") return { code: 0, stdout: `${f.state.bytes} ${f.state.mtime}\n`, stderr: "" };
    if (command === "ps" && args[0] === "-o") return { code: 0, stdout: "00:01\n", stderr: "" };
    return exec(command, args, options);
  };
  f.host.readTextFile = async (file) => String(file).includes(".claude/sessions/200.json")
    ? JSON.stringify({ pid: 200, sessionId: "00000000-0000-4000-8000-000000000000", cwd: "/projects/p0", startedAt: 999_000 })
    : readTextFile(file);
}

async function look(t, { active = true, shown = true } = {}) {
  const dir = await temporary(t), f = fixture({ dir });
  f.state.active = active;
  f.state.panelHidden = !shown;
  armLook(f);
  const { Look } = await loadMod("kanso-panel/look.js", ["Look"], f.host);
  const { Kdb } = await loadMod("kanso-panel/kdb.js", ["Kdb"], f.host);
  const view = new Look(new Kdb());
  view.init(f.cx, {});
  await f.settle();
  return { f, view };
}

test("Images on this computer reads 0 times while behind or hidden, and reads as soon as it is shown", async (t) => {
  const behind = await look(t, { active: false, shown: true });
  await behind.f.advance(60_000);
  assert.equal(hcReads(behind.f).length, 0, `Images behind started ${hcReads(behind.f).length} hc reads per minute; budget 0`);
  behind.f.state.active = true;
  behind.view.render(behind.f.cx);
  behind.f.state.processes.length = 0;
  await behind.f.advance(0);
  assert.ok(hcReads(behind.f).length > 0, "coming forward reads at once");

  const hidden = await look(t, { active: true, shown: false });
  await hidden.f.advance(60_000);
  assert.equal(hcReads(hidden.f).length, 0, `Images hidden started ${hcReads(hidden.f).length} hc reads per minute; budget 0`);
  hidden.f.state.panelHidden = false;
  hidden.view.render(hidden.f.cx);
  hidden.f.state.processes.length = 0;
  await hidden.f.advance(0);
  assert.ok(hcReads(hidden.f).length > 0, "showing the panel reads at once");
});

test("Images skips a conversation whose size has not changed, and reads when it grows", async (t) => {
  const { f, view } = await look(t, { active: true, shown: true });
  await until(() => view.transcript?.file);
  f.state.processes.length = 0;
  await f.advance(60_000);
  assert.equal(hcReads(f).length, 0, `an unchanged conversation started ${hcReads(f).length} hc reads per minute; budget 0`);
  f.state.bytes += 8;
  f.state.processes.length = 0;
  await until(async () => {
    if (hcReads(f).length > 0) return true;
    const due = f.state.timers.map((timer) => timer.next).filter((at) => Number.isFinite(at));
    if (!due.length) return false;
    await f.advance(Math.max(0, Math.min(...due) - f.state.now));
    return hcReads(f).length > 0;
  });
});

async function files(t, { active = true, watch = true } = {}) {
  const dir = await temporary(t), f = fixture({ dir });
  f.state.active = active;
  f.state.panelHidden = false;
  if (!watch) f.host.watchFolder = async () => { throw new Error("no watch"); };
  const { Files } = await loadMod("kanso-panel/files.js", ["Files"], f.host);
  const view = new Files();
  view.init(f.cx);
  await f.settle();
  return { f, view };
}

test("Files with a folder watch asks git once a minute, and not at all while behind", async (t) => {
  const open = await files(t);
  assert.ok(open.view.watched, "the folder watch is attached");
  open.f.state.processes.length = 0;
  await open.f.advance(50_000);
  assert.equal(gitOf(open.f).length, 0, `a watched folder asked git ${gitOf(open.f).length} times before the minute; budget 0`);
  await open.f.advance(10_000);
  assert.equal(gitOf(open.f).length, 1, "the minute fallback asks git once");

  const behind = await files(t, { active: false });
  behind.f.state.processes.length = 0;
  await behind.f.advance(60_000);
  assert.equal(gitOf(behind.f).length, 0, `Files behind started ${gitOf(behind.f).length} git processes per minute; budget 0`);
  behind.f.state.active = true;
  behind.view.render(behind.f.cx);
  behind.f.state.processes.length = 0;
  await behind.f.advance(0);
  assert.ok(gitOf(behind.f).length > 0, "coming forward lists the folder at once");
});

test("Files without a folder watch still asks git every 10 seconds", async (t) => {
  const { f, view } = await files(t, { watch: false });
  assert.equal(view.watched, null);
  f.state.processes.length = 0;
  await f.advance(10_000);
  assert.ok(gitOf(f).length > 0, "no watch: the 10 second tick still asks git");
});

test("Containers does nothing while behind, reads at once in front, and splits usage from the file walk", async (t) => {
  const { readPlan } = await loadMod("kanso-containers/main.js", ["Containers", "readPlan"], fixture().host);
  const plan = (reads) => { const row = readPlan(reads); return [Boolean(row.files), Boolean(row.stats)]; };
  assert.deepEqual(plan(1), [true, true]);
  assert.deepEqual(plan(2), [true, false]);
  assert.deepEqual(plan(13), [false, true]);
  assert.deepEqual(plan(14), [true, false]);
  assert.deepEqual(plan(25), [false, true]);
  assert.deepEqual(plan(26), [true, false]);

  const dir = await temporary(t), f = fixture({ dir });
  f.state.active = false;
  const { Containers } = await loadMod("kanso-containers/main.js", ["Containers", "readPlan"], f.host);
  const view = new Containers();
  view.init({}, f.cx);
  await f.settle();
  await f.advance(60_000);
  const docker = () => f.state.processes.filter((p) => p.command === "docker");
  assert.equal(docker().length, 0, `Containers behind started ${docker().length} docker processes per minute; budget 0`);
  f.state.active = true;
  view.render(f.cx);
  f.state.processes.length = 0;
  await f.advance(0);
  assert.ok(docker().length > 0, "coming forward reads docker at once");
});

test("Ports reads 0 times while behind, reads at once in front, and skips a redraw when the list is the same", async (t) => {
  const quiet = await temporary(t);
  const behind = fixture({ dir: quiet });
  behind.state.active = false;
  const redraws = countRedraws(behind);
  const { Ports } = await loadMod("kanso-panel/ports.js", ["Ports"], behind.host);
  const hidden = new Ports();
  hidden.init(behind.cx);
  await behind.settle();
  await behind.advance(60_000);
  const lsof = (f) => f.state.processes.filter((p) => p.command === "lsof");
  assert.equal(lsof(behind).length, 0, `Ports behind started ${lsof(behind).length} process-table reads per minute; budget 0`);
  assert.equal(redraws.n, 0, "Ports behind does not redraw");
  behind.state.active = true;
  hidden.render(behind.cx);
  behind.state.processes.length = 0;
  await behind.advance(0);
  assert.ok(lsof(behind).length > 0, "coming forward reads the ports at once");

  const dir = await temporary(t), front = fixture({ dir });
  const drawn = countRedraws(front);
  const { Ports: Open } = await loadMod("kanso-panel/ports.js", ["Ports"], front.host);
  const view = new Open();
  view.init(front.cx);
  await front.settle();
  drawn.n = 0;
  await front.advance(60_000);
  assert.equal(drawn.n, 0, `an unchanged port list redrawn ${drawn.n} times per minute; budget 0`);
});

test("Memory redraws 0 times a minute when the reading has not changed", async (t) => {
  const dir = await temporary(t), f = fixture({ dir });
  const redraws = countRedraws(f);
  const { Memory } = await loadMod("kanso-guard/main.js", ["Memory"], f.host);
  const view = new Memory();
  view.init({}, f.cx);
  await f.settle();
  await f.advance(0);
  redraws.n = 0;
  await f.advance(60_000);
  assert.equal(redraws.n, 0, `an unchanged Memory reading redrawn ${redraws.n} times per minute; budget 0`);
});

test("the footer fits from one timer, and battery and the memory warning are read every 2 minutes", async (t) => {
  const dir = await temporary(t), f = fixture({ dir });
  f.state.props = { footer: true };
  const { WorkspaceChrome } = await loadMod("kanso-chrome/main.js", ["WorkspaceChrome"], f.host);
  const view = new WorkspaceChrome();
  view.init({}, f.cx);
  await f.settle();
  assert.equal(f.state.timers.filter((timer) => timer.ms === 1500).length, 0, "the footer does not arm the fit timer");
  assert.equal(f.state.timers.filter((timer) => timer.ms === 30_000 || timer.ms === 60_000).length, 0, "battery and the memory warning are not read every 30 or 60 seconds");
  assert.equal(f.state.timers.filter((timer) => timer.ms === 120_000).length, 2);
  const pmset = () => f.state.processes.filter((p) => p.command === "pmset");
  const status = () => f.state.processes.filter((p) => p.command === "sh" && String(p.args[1]).includes("herdr-app status"));
  f.state.processes.length = 0;
  await f.advance(60_000);
  assert.equal(pmset().length, 0, "battery is not read in the first minute");
  assert.equal(status().length, 0, "the memory warning is not read in the first minute");
  await f.advance(60_000);
  assert.equal(pmset().length, 1, "battery is read at 2 minutes");
  assert.equal(status().length, 1, "the memory warning is read at 2 minutes");
});

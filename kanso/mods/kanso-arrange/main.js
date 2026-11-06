// Arrangements, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// The tab you set up every morning, kept: save the tab as it is (each pane's
// program with the flags you started it with, its folder, the columns, the
// stacks and their widths) and open it again in a new tab with one click.
// Kanso adds nothing of its own: an arrangement holds only what you ran.
// A session's resume id is left out, so each agent starts fresh.
//
// An arrangement is saved with the project it was made in (the space's
// folder, on its machine) and can be opened in any project: one from
// another project opens each pane in the folder of the project you are in.
// Saving under a name the project already has overwrites it. They live in
// a SQLite database (store.js), data/kanso-arrange/arrange.db. Opened with
// Cmd+Alt+T or a right-click on the tab bar's new tab button.
//
// Sleep puts a tab away for later: it is saved with each Claude agent's
// conversation, the agents exit and the tab closes, so nothing of it runs.
// Wake opens it again in its project, each agent back on its conversation.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, shared, setShared, hc, run, props, closeOverlay, theme, home, readTextFile, exec } from "herdr";
import { Store } from "./store.js";
const ARM_MS = 4000;

const base = (s) => String(s ?? "").split("/").pop().replace(/^-/, "");
const tilde = (cwd) => {
  if (!cwd) return "~";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
};

// A program's arguments without the session it resumed, so opening the
// arrangement starts each agent fresh: Claude Code's --resume/-r <id>,
// --session-id <id>, --continue/-c; Codex's `resume <id>`.
export function cleanArgv(argv) {
  if (!Array.isArray(argv) || !argv.length) return null;
  const [cmd, ...rest] = argv.map(String);
  const name = base(cmd), out = [cmd];
  const value = (i) => rest[i + 1] !== undefined && !rest[i + 1].startsWith("-");
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (name === "claude") {
      if (a === "--resume" || a === "-r" || a === "--session-id") { if (value(i)) i++; continue; }
      if (a.startsWith("--resume=") || a.startsWith("--session-id=") || a === "--continue" || a === "-c") continue;
    }
    if (name === "codex" && i === 0 && a === "resume") { if (value(i)) i++; continue; }
    out.push(a);
  }
  return out;
}

// What a terminal runs, from `hc get --json`: the program in the foreground
// with its arguments (one you started in its shell, or one the terminal was
// opened with), or null for a shell at its prompt.
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu", "pwsh", "elvish", "xonsh"]);
export function commandOf(rec) {
  const fg = rec?.foreground;
  if (!fg?.argv?.length || SHELLS.has(base(fg.argv[0]))) return null;
  return cleanArgv(fg.argv);
}

// The tab's panes as columns, in the strip's order, each pane with what it
// runs and where (`recs`: terminal address -> its `hc get` record).
export function captureTab(state, tabPanes, recs, extra = null) {
  const byId = new Map(tabPanes.map((p) => [p.pane, p]));
  const cols = (state?.cols?.length ? state.cols : tabPanes.map((p) => ({ panes: [p.pane], w: 1 / Math.max(1, tabPanes.length) })))
    .map((c) => ({ w: c.w, panes: c.panes.map((id) => byId.get(id)).filter(Boolean).map((p) => {
      const rec = recs.get(p.terminal);
      return { argv: commandOf(rec), cwd: rec?.foreground?.cwd || p.cwd || null, ...(extra?.get(p.terminal) ?? {}) };
    }) }))
    .filter((c) => c.panes.length);
  return { per: state?.n ?? null, cols };
}

export const describe = (argv) => (argv ? argv.join(" ") : "Shell");
// A program's name: the script a runtime runs (`node …/bin/codex` is codex).
const RUNTIMES = new Set(["node", "bun", "deno", "python", "python3", "ruby"]);
export const programOf = (argv) => (!argv?.length ? "shell" : RUNTIMES.has(base(argv[0])) && argv[1] && !argv[1].startsWith("-") ? base(argv[1]) : base(argv[0]));
export const summary = (a) => a.cols.flatMap((c) => c.panes).map((p) => programOf(p.argv)).join(", ");

// The project an arrangement belongs to: the space's folder on its machine.
const projectOf = (space) => `${space?.machine ?? ""}:${space?.folder || home()}`;
const folderOfKey = (key) => String(key ?? "").slice(String(key ?? "").indexOf(":") + 1);

// Every saved arrangement, this project's first, then the other projects'
// newest first, each with the project it was saved in (`from`).
export function listFor(projects, key) {
  const tag = (k) => (projects?.[k] ?? []).map((a) => ({ ...a, from: k }));
  const others = Object.keys(projects ?? {}).filter((k) => k !== key).flatMap(tag)
    .sort((a, b) => (b.saved ?? 0) - (a.saved ?? 0));
  return { mine: tag(key), others };
}

// The command that resumes `session` the way argv ran Claude Code, or null
// when it can't: only options known to carry over are kept; the first
// prompt and session options (--continue, --fork-session) are left out, so
// a wake neither repeats the task it started with nor forks the conversation.
const KEEP_VALUE = new Set(["--model", "--permission-mode", "--settings", "--agent", "--effort", "--fallback-model", "--append-system-prompt", "--system-prompt", "--plugin-dir", "--setting-sources", "--name", "--add-dir", "--mcp-config", "--allowedTools", "--disallowedTools"]);
const KEEP_FLAG = new Set(["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--verbose", "--chrome", "--no-chrome", "--ide", "--strict-mcp-config", "--brief", "--debug"]);
const DROP_VALUE = new Set(["--resume", "-r", "--session-id"]);
const DROP_FLAG = new Set(["--continue", "-c", "--fork-session"]);
export function resumeArgv(argv, session) {
  if (!Array.isArray(argv) || !argv.length || base(argv[0]) !== "claude" || !session) return null;
  const keep = [];
  for (let i = 1; i < argv.length; i++) {
    const a = String(argv[i]);
    if (!a.startsWith("-")) break; // the first prompt, and anything after it
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (KEEP_FLAG.has(flag) && eq < 0) keep.push(a);
    else if (KEEP_VALUE.has(flag)) { if (eq > 0) keep.push(a); else if (i + 1 < argv.length) keep.push(a, String(argv[++i])); else return null; }
    else if (DROP_VALUE.has(flag)) { if (eq < 0) i++; }
    else if (DROP_FLAG.has(flag)) { /* left out */ }
    else return null;
  }
  return [argv[0], ...keep, "--resume", session];
}

// What waking a pane runs: a Claude agent back on its conversation (the
// command saved when it slept, else rebuilt); any other program as it was.
export function wakeArgv(p) {
  if (!p.argv) return null;
  if (!p.resume || base(p.argv[0]) !== "claude") return p.argv;
  return p.wake ?? resumeArgv(p.argv, p.resume);
}

// The same tabs, panes and agents as when the sleep view opened.
const shapeOf = (list) => JSON.stringify(list.map((r) => [r.tab.id, r.capture.cols.flatMap((c) => c.panes).map((p) => [p.terminal ?? null, p.pid ?? null, p.resume ?? null, p.argv])]));
export const sameTabs = (a, b) => shapeOf(a) === shapeOf(b);

// A name not taken yet: "shield", else "shield 2", "shield 3"...
export function freeName(name, taken) {
  let n = name, k = 2;
  while (taken.has(n)) n = `${name} ${k++}`;
  return n;
}
const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
export const wakeable = (a) => ({ ...a, cols: a.cols.map((c) => ({ ...c, panes: c.panes.map((p) => ({ argv: wakeArgv(p), cwd: p.cwd })) })) });
// A sleeping tab's agents by the names they go by, the other panes by program.
export const sleepers = (a) => a.cols.flatMap((c) => c.panes).map((p) => p.name || programOf(p.argv)).join(", ");

// Why a tab can't sleep now: its agents at work or waiting on you.
export function sleepBlocker(recs) {
  for (const [, r] of recs) {
    const st = r?.status?.state;
    if (st === "working" || st === "blocked") return `${r.labels?.["kanso.name"] || r.title || r.address} is ${st === "working" ? "working" : "waiting on you"}`;
  }
  return null;
}

// Where an arrangement was made, named by the folder most of its panes ran
// in (the space's folder when none of them say).
export function originOf(a) {
  const count = new Map();
  for (const p of a.cols.flatMap((c) => c.panes)) if (p.cwd) count.set(p.cwd, (count.get(p.cwd) ?? 0) + 1);
  const top = [...count].sort((x, y) => y[1] - x[1])[0]?.[0];
  return base(top || folderOfKey(a.from)) || "~";
}

// An arrangement from another project, ready to open in `folder`: the same
// programs, flags, columns and widths, every pane in that folder.
export function rebase(a, folder) {
  return { ...a, cols: a.cols.map((c) => ({ ...c, panes: c.panes.map((p) => ({ ...p, cwd: folder || p.cwd })) })) };
}


export default class Arrange extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.view = "list";
    this.list = null; // this project's arrangements, once read
    this.others = []; // the other projects' arrangements, each with its `from`
    this.armed = null;
    this.busy = null; // "Opening 2 of 4" while an arrangement opens
    this.error = null;
    this.name = InputState.new({ placeholder: "Name" });
    this.name.on("submit", (_e, cx) => (this.view === "sleep" ? this.sleep(cx) : this.save(cx)));
    this.name.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    // Opened from a menu (the sidebar's, a pane header's): `sleep` { scope:
    // "tab" | "project", space, tab } goes straight to the sleep view;
    // `wake` { from, name } or `wakeAll` (a project) wakes at once.
    const ask = props() ?? {};
    this.space = spaces().find((s) => s.id === ask.sleep?.space) ?? spaces().find((s) => s.active) ?? null;
    this.store = new Store();
    this.target = null; // { project, name } an Overwrite replaces
    this.asleep = [];
    cx.spawn(async (cx) => {
      try { this.take(await this.store.all()); this.setAsleep(await this.store.asleep()); }
      catch (e) { this.list = []; this.error = String(e?.message ?? e); }
      if (ask.sleep) this.startSleep(cx, ask.sleep.scope === "project", ask.sleep.tab);
      const waking = ask.wakeAll ? this.asleep.filter((a) => a.from === ask.wakeAll)
        : ask.wake ? this.asleep.filter((a) => a.from === ask.wake.from && a.name === ask.wake.name) : [];
      if (waking.length) this.wake(waking[0], cx, waking.slice(1));
      else if (ask.wake || ask.wakeAll) this.error = "That tab is no longer asleep.";
      cx.notify();
    });
  }

  // What sleeps, for the sidebar and the pane headers to show (shared
  // "kanso.asleep": [{ from, name, saved, who }]).
  setAsleep(list) {
    this.asleep = list;
    setShared("kanso.asleep", list.map((a) => ({ from: a.from, name: a.name, saved: a.saved, who: sleepers(a), space: a.space ?? null })));
  }

  take(projects) {
    const { mine, others } = listFor(projects, projectOf(this.space));
    this.list = mine; this.others = others;
  }

  // The save view: what the tab runs now, read from herdr-core.
  // With `a`, an Overwrite: the tab replaces that arrangement, in the
  // project it was saved in, under its name.
  startSave(cx, a = null) {
    const tab = this.space?.tabs.find((t) => t.active);
    this.view = "save"; this.capture = null; this.error = null;
    this.target = a ? { project: a.from, name: a.name } : null;
    this.name.set_value(a ? a.name : tab?.named ? tab.name : `Arrangement ${(this.list?.length ?? 0) + 1}`);
    this.name.focus();
    cx.notify();
    const tabPanes = panes().filter((p) => p.tab === tab?.id && p.terminal);
    cx.spawn(async (cx) => {
      const recs = new Map();
      await Promise.all(tabPanes.map(async (p) => {
        const r = await hc(["get", p.terminal, "--json"]).catch(() => null);
        try { if (r?.code === 0) recs.set(p.terminal, JSON.parse(r.stdout)); } catch { /* left as a shell */ }
      }));
      this.capture = captureTab(shared("strip.state")?.[tab?.id], tabPanes, recs);
      cx.notify();
    });
  }

  save(cx) {
    const name = this.name.value().trim();
    if (!name || !this.capture?.cols.length) return;
    const entry = { name, ...this.capture, saved: Date.now() };
    const t = this.target;
    const key = t && t.name === name ? t.project : projectOf(this.space);
    cx.spawn(async (cx) => {
      try {
        this.take(await this.store.save(key, entry));
        this.view = "list"; this.target = null;
      } catch (e) { this.error = `Not saved: ${String(e?.message ?? e)}`; }
      cx.notify();
    });
  }

  remove(a, cx) {
    const key = a.from ?? projectOf(this.space);
    cx.spawn(async (cx) => {
      try {
        this.take(await this.store.remove(key, a.name));
      } catch (e) { this.error = `Not removed: ${String(e?.message ?? e)}`; }
      cx.notify();
    });
  }

  // A tab as it runs, each Claude agent with its conversation (its session
  // record, ~/.claude/sessions/<pid>.json) and the command that resumes it:
  // { tab, capture, blocker, error }. Anything it can't read stops it.
  async readTab(tab) {
    const tabPanes = panes().filter((p) => p.tab === tab.id && p.terminal);
    const recs = new Map(), extra = new Map();
    let error = this.space?.machine ? "Sleep works on this computer's agents for now" : null;
    await Promise.all(tabPanes.map(async (p) => {
      const r = await hc(["get", p.terminal, "--json"]).catch(() => null);
      try { if (r?.code === 0) recs.set(p.terminal, JSON.parse(r.stdout)); } catch { /* reported below */ }
      if (!recs.has(p.terminal)) error ??= `${p.terminal} could not be read`;
    }));
    for (const [term, r] of recs) {
      const fg = r.foreground;
      if (!fg?.pid || base(fg.argv?.[0]) !== "claude") continue;
      let ses = null;
      try { ses = JSON.parse(await readTextFile(`${home()}/.claude/sessions/${fg.pid}.json`)); } catch { /* reported below */ }
      const who = ses?.name || r.labels?.["kanso.name"] || r.title || term;
      const again = ses?.sessionId ? resumeArgv(fg.argv, ses.sessionId) : null;
      if (!ses?.sessionId || ses.pid !== fg.pid) error ??= `${who}'s conversation was not found, so it could not wake on it`;
      else if (!again) error ??= `${who} was started with options a wake can't carry over`;
      extra.set(term, { resume: ses?.sessionId ?? null, name: who, pid: fg.pid, terminal: term, wake: again });
    }
    return { tab, capture: captureTab(shared("strip.state")?.[tab.id], tabPanes, recs, extra), blocker: sleepBlocker(recs), error };
  }

  // The sleep view, for the tab you are on or (`whole`) every tab of the
  // project; each tab sleeps under its own name.
  startSleep(cx, whole = false, tabId = null) {
    const all = this.space?.tabs ?? [];
    const tabs = whole ? all : all.filter((t) => (tabId ? t.id === tabId : t.active));
    this.view = "sleep"; this.whole = whole; this.sleepers = null; this.error = null; this.sleepTabs = tabs;
    const tab = tabs[0];
    this.name.set_value(tab?.named ? tab.name : `Tab ${all.indexOf(tab) + 1}`);
    cx.notify();
    cx.spawn(async (cx) => { this.sleepers = await this.readTabs(tabs); cx.notify(); });
  }

  async readTabs(tabs) {
    const all = this.space?.tabs ?? [];
    const read = await Promise.all(tabs.map((t) => this.readTab(t)));
    read.forEach((r) => { r.name = r.tab.named ? r.tab.name : `Tab ${all.indexOf(r.tab) + 1}`; });
    return read.filter((r) => r.capture.cols.length);
  }

  // Read again at the press (what the view showed may be old), saved as
  // going to sleep, then each agent leaves with /exit (its conversation
  // stays on disk) and must be gone before its tab closes. If one won't
  // leave, the ones that left come back on their conversations and the tab
  // stays as it was.
  sleep(cx) {
    const shown = this.sleepers;
    if (this.busy || !shown?.length || shown.some((r) => r.blocker || r.error)) return;
    const typed = this.whole ? null : this.name.value().trim();
    if (!this.whole && !typed) return;
    const project = projectOf(this.space);
    this.busy = "Reading the tabs again"; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      const list = await this.readTabs(this.sleepTabs ?? []);
      const stop = list.find((r) => r.blocker || r.error);
      if (stop || !sameTabs(shown, list)) {
        this.sleepers = list; this.busy = null;
        this.error = stop ? `It can't sleep now: ${stop.blocker || stop.error}.` : "The tabs changed since this opened; here they are as they are now.";
        cx.notify();
        return;
      }
      if (!this.whole) list[0].name = typed;
      const taken = new Set((await this.store.asleep(true)).filter((a) => a.from === project).map((a) => a.name));
      for (const r of list) { r.name = freeName(r.name, taken); taken.add(r.name); }
      for (const r of list) {
        const cap = r.capture;
        const agents = cap.cols.flatMap((c) => c.panes).filter((p) => p.pid);
        const entry = { name: r.name, space: this.space?.name ?? null, per: cap.per, saved: Date.now(),
          cols: cap.cols.map((c) => ({ w: c.w, panes: c.panes.map((p) => ({ argv: p.argv, cwd: p.cwd, resume: p.resume ?? null, wake: p.wake ?? null, name: p.name ?? null })) })) };
        const left = [];
        try {
          await this.store.sleep(project, entry);
          for (const [i, p] of agents.entries()) {
            this.busy = `${p.name} is leaving, ${i + 1} of ${agents.length} in ${r.name}`; cx.notify();
            await this.leave(p, cx);
            left.push(p);
          }
          this.setAsleep(await this.store.settle(project, r.name));
          run("tab.close", { id: r.tab.id, confirmed: true });
        } catch (e) {
          const back = [];
          for (const p of left) back.push(await this.comeBack(p, cx) ? null : p.name);
          await this.store.woke(project, r.name).catch(() => {});
          this.setAsleep(await this.store.asleep().catch(() => this.asleep));
          const lost = back.filter(Boolean);
          this.busy = null;
          this.error = `Stopped: ${String(e?.message ?? e)}. ${r.name} stays open` + (left.length ? (lost.length ? `; ${lost.join(", ")} did not come back, start it with claude --resume` : "; the agents that had left are back on their conversations") : "") + ".";
          cx.notify();
          return;
        }
      }
      closeOverlay(props()?.overlay);
    });
  }

  // One agent out: its prompt cleared (a draft would go out with /exit),
  // /exit, then its process gone.
  async leave(p, cx) {
    const live = async () => (await exec("kill", ["-0", String(p.pid)]).catch(() => null))?.code === 0;
    const now = await hc(["get", p.terminal, "--json"]).catch(() => null);
    let fg = null;
    try { fg = JSON.parse(now.stdout).foreground?.pid; } catch { /* below */ }
    if (fg !== p.pid) throw new Error(`${p.name}'s terminal changed`);
    const clear = await hc(["keys", p.terminal, "ctrl+e", "ctrl+u", "ctrl+e", "ctrl+u", "ctrl+e", "ctrl+u"]).catch(() => null);
    if (clear?.code !== 0) throw new Error(`${p.name}'s prompt could not be cleared`);
    const s = await hc(["send", p.terminal, "/exit"]).catch(() => null);
    if (s?.code !== 0) throw new Error(`${p.name} did not take /exit`);
    for (let k = 0; k < 40; k++) { await cx.sleep(500); if (!(await live())) return; }
    throw new Error(`${p.name} did not exit`);
  }

  // An agent that left during a sleep that stopped: started again in its
  // terminal on its conversation. True when its session is back.
  async comeBack(p, cx) {
    const line = `cd ${shq(p.cwd || home())} && ${p.wake.map(shq).join(" ")}`;
    for (let k = 0; k < 20; k++) {
      const g = await hc(["get", p.terminal, "--json"]).catch(() => null);
      let x = null;
      try { x = JSON.parse(g.stdout); } catch { /* not yet */ }
      if (x && (!x.foreground?.pid || x.foreground.pid === x.pid || SHELLS.has(base(x.foreground.argv?.[0])))) break;
      await cx.sleep(500);
    }
    await cx.sleep(800);
    if ((await hc(["send", p.terminal, line]).catch(() => null))?.code !== 0) return false;
    return Boolean(await this.resumed(p.terminal, p.resume, cx));
  }

  // The pid of a Claude agent in `terminal` on conversation `session`, once
  // it is there (up to 30 seconds).
  async resumed(terminal, session, cx) {
    for (let k = 0; k < 30; k++) {
      await cx.sleep(1000);
      const g = await hc(["get", terminal, "--json"]).catch(() => null);
      let pid = null;
      try { pid = JSON.parse(g.stdout).foreground?.pid; } catch { /* not yet */ }
      if (!pid) continue;
      try { if (JSON.parse(await readTextFile(`${home()}/.claude/sessions/${pid}.json`))?.sessionId === session) return pid; } catch { /* not yet */ }
    }
    return null;
  }

  // Back in its project's space, each agent on its conversation, checked;
  // only then is it no longer asleep. What did not come back stays asleep
  // (only those panes). One wake at a time holds a tab (claim). A project
  // that slept whole has no space left: it gets a new one. `rest`: more to
  // wake after it (Wake all).
  wake(a, cx, rest = []) {
    if (this.busy) return;
    const space = spaces().find((sp) => projectOf(sp) === a.from) ?? null;
    const folder = folderOfKey(a.from), machine = String(a.from).slice(0, String(a.from).indexOf(":")) || undefined;
    const create = space ? null : { name: a.space || base(folder) || "~", folder, key: a.from, ...(machine ? { machine } : {}) };
    this.busy = `Waking ${a.name}`; cx.notify();
    cx.spawn(async (cx) => {
      if (!(await this.store.claim(a.from, a.name).catch(() => false))) {
        this.busy = null; this.error = `${a.name} is already waking.`; cx.notify(); return;
      }
      this.busy = null;
      const flat = a.cols.flatMap((c) => c.panes);
      this.open({ ...wakeable(a), name: a.name }, cx, { space, create, keepOpen: rest.length > 0,
        failed: async () => { this.setAsleep(await this.store.release(a.from, a.name).catch(() => this.asleep)); },
        then: async (cx, ids) => {
          const terms = ids.flat().map((id) => panes().find((q) => q.pane === id)?.terminal ?? null);
          const missed = [];
          for (const [i, p] of flat.entries()) {
            if (!p.resume) continue;
            this.busy = `Checking ${p.name ?? "an agent"} is on its conversation`; cx.notify();
            if (!terms[i] || !(await this.resumed(terms[i], p.resume, cx))) missed.push(p);
          }
          if (missed.length) {
            const keep = { ...a, cols: [{ w: 1, panes: missed }] };
            this.setAsleep(await this.store.keep(a.from, keep));
            this.error = `${missed.map((p) => p.name).join(", ")} did not come back on ${missed.length === 1 ? "its conversation" : "their conversations"}; ${missed.length === 1 ? "it stays" : "they stay"} asleep.`;
          } else this.setAsleep(await this.store.woke(a.from, a.name));
          this.busy = null;
          if (missed.length) { cx.notify(); return false; }
          if (rest.length) this.wake(rest[0], cx, rest.slice(1));
          return true;
        } });
    });
  }

  // A new pane, once Herdr has it (one not in `seen`) and the strip has put
  // it in its place: the next split's "beside this one" needs that place.
  async newPane(seen, cx, tab) {
    for (let i = 0; i < 60; i++) {
      const p = panes().find((q) => !seen.has(q.pane) && q.terminal && (!tab || q.tab === tab));
      if (p) {
        for (let j = 0; j < 20 && !shared("strip.state")?.[p.tab]?.cols?.some((c) => c.panes?.includes(p.pane)); j++) await cx.sleep(75);
        return p;
      }
      await cx.sleep(100);
    }
    throw new Error("Herdr did not open the pane");
  }

  // A new tab with the first pane, then each other pane beside or under the
  // one before it, as the strip places a split; then the columns' widths.
  open(a, cx, { space = this.space, create = null, then = null, failed = null, keepOpen = false } = {}) {
    if (this.busy) return;
    if (!then && a.from && a.from !== projectOf(space)) a = rebase(a, space?.folder || home());
    const flat = a.cols.flatMap((c, ci) => c.panes.map((p, ri) => ({ ...p, ci, ri })));
    if (!flat.length || (!space && !create)) return;
    this.busy = `Opening 1 of ${flat.length}`; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const opts = (p) => ({ folder: p.cwd || undefined, ...(p.argv ? { argv: p.argv } : {}) });
        // A new space starts with a shell tab in the project's folder; the
        // tab opens beside it with its own first pane, then the shell goes.
        let starter = null;
        if (create) {
          const { key, ...args } = create;
          run("space.new", args);
          for (let i = 0; i < 50 && !space; i++) { await cx.sleep(100); space = spaces().find((sp) => projectOf(sp) === key) ?? null; }
          if (!space) throw new Error("Herdr did not make the space");
          starter = space.tabs?.[0]?.id ?? null;
        }
        let seen = new Set(panes().map((q) => q.pane));
        run("tab.new", { space: space.id, name: a.name, ...opts(flat[0]) });
        const first = await this.newPane(seen, cx);
        const ids = [[first.pane]];
        for (let k = 1; k < flat.length; k++) {
          const p = flat[k];
          this.busy = `Opening ${k + 1} of ${flat.length}`; cx.notify();
          const dir = p.ri > 0 ? "down" : "right";
          const from = p.ri > 0 ? ids[p.ci][p.ri - 1] : ids[p.ci - 1][0];
          seen = new Set(panes().map((q) => q.pane));
          setShared("strip.intent", { dir, from, at: Date.now() });
          run("pane.focus", { pane: from });
          run("terminal.open", { ...opts(p), place: dir });
          const made = await this.newPane(seen, cx, first.tab);
          (ids[p.ci] ??= []).push(made.pane);
        }
        await cx.sleep(150);
        setShared("strip.req", { op: "widths", per: a.per, cols: ids.map((col, ci) => ({ pane: col[0], w: a.cols[ci].w })), n: Date.now() + Math.random() });
        run("pane.focus", { pane: ids[0][0] });
        if (starter) run("tab.close", { id: starter, confirmed: true });
        if (then && (await then(cx, ids)) === false) return;
        if (!keepOpen) closeOverlay(props()?.overlay);
      } catch (e) {
        if (failed) await failed().catch(() => {});
        this.busy = null;
        this.error = `Stopped: ${String(e?.message ?? e)}`;
        cx.notify();
      }
    });
  }

  arm(key, cx, act) {
    if (this.armed === key && Date.now() - this.armedAt <= ARM_MS) { this.armed = null; act(cx); return; }
    this.armed = key; this.armedAt = Date.now(); cx.notify();
    cx.timer.after(ARM_MS + 50, (cx) => { if (this.armed === key) { this.armed = null; cx.notify(); } });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const project = this.space?.name ?? tilde(this.space?.folder);
    const button = (id, text, primary, enabled, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
      .when(!enabled, (el) => el.opacity(0.45))
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => action(cx)))
      .child(text);
    const head = (title, sub) => v_flex().gap(4)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(title))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().truncate().text_size(11.5).text_color(t.dim).child(sub));
    const note = (text, tone) => div().pt(10).text_size(11.5).line_height(1.45).text_color(tone ?? t.dim).child(text);
    const shell = v_flex().id("kanso-arrange").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.view !== "list" && !this.busy) { this.view = "list"; this.target = null; this.error = null; cx.notify(); }
        else if (this.view !== "list") return; else closeOverlay(p.overlay);
        cx.stop_propagation();
      });

    if (this.view === "sleep") {
      const list = this.sleepers ?? [];
      const whole = this.whole;
      const panesOf = (r) => r.capture.cols.flatMap((c) => c.panes);
      const others = [...new Set(list.flatMap(panesOf).filter((q) => !q.pid && q.argv).map((q) => programOf(q.argv)))];
      const stop = list.find((r) => r.blocker || r.error);
      const line = (q, i) => h_flex().id(`sl-${i}`).w_full().gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(q.pid ? t.foreground : t.muted).child(q.pid ? q.name : describe(q.argv)))
        .child(div().flex_none().max_w(180).truncate().text_size(11.5).text_color(t.dim).child(q.pid ? "keeps its conversation" : tilde(q.cwd)));
      let i = 0;
      const ready = list.length > 0 && !stop && !this.busy;
      return shell
        .child(head(whole ? `Sleep ${project}` : "Sleep this tab", whole ? "Every tab's agents exit and the tabs close. Wake opens them again, each agent on its conversation." : "Its agents exit and the tab closes. Wake opens it again, each agent on its conversation."))
        .when(!whole, (el) => el
          .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
          .child(Input.new(this.name).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground)))
        .when(this.sleepers === null, (el) => el.child(note("Reading")))
        .children(list.map((r) => v_flex().pt(14).gap(4)
          .when(whole, (el) => el.child(div().pb(3).text_size(11.5).text_color(t.dim).child(r.name)))
          .children(panesOf(r).map((q) => line(q, i++)))))
        .when(this.sleepers !== null && !list.length, (el) => el.child(note("Nothing runs here to put to sleep.")))
        .when(others.length > 0, (el) => el.child(note(`${others.join(", ")} will stop now and start fresh on wake.`)))
        .when(Boolean(stop), (el) => el.child(note(`It can't sleep now: ${stop?.blocker || stop?.error}.`, t.blocked)))
        .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
        .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("sl-back", "Back", false, !this.busy, (cx) => { this.view = "list"; this.error = null; cx.notify(); }))
          .child(button("sl-go", whole ? `Sleep ${list.length} ${list.length === 1 ? "tab" : "tabs"}` : "Sleep", true, ready, (cx) => this.sleep(cx))));
    }

    if (this.view === "save") {
      const cols = this.capture?.cols ?? [];
      const line = (q, i) => h_flex().id(`cap-${i}`).w_full().gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(q.argv ? t.foreground : t.muted).child(describe(q.argv)))
        .child(div().flex_none().max_w(180).truncate().text_size(11.5).text_color(t.dim).child(tilde(q.cwd)));
      let i = 0;
      const typed = this.name.value().trim(), tg = this.target;
      const replaces = (tg && tg.name === typed) ? tg : (this.list ?? []).some((a) => a.name === typed) ? { name: typed } : null;
      return shell
        .child(head(tg ? `Overwrite ${tg.name}` : "Save this tab", tg ? "With this tab as it is now" : `An arrangement for ${project}`))
        .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child("Name"))
        .child(Input.new(this.name).h(36).px(10).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
        .child(div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(cols.length ? `${cols.length} ${cols.length === 1 ? "column" : "columns"}, left to right` : "Reading the tab"))
        // One rule per column; a stack's panes sit on the same rule.
        .child(v_flex().gap(10).children(cols.map((c, ci) => h_flex().w_full().gap(10).items_stretch()
          .child(div().w(2).flex_none().rounded_full().bg(t.border))
          .child(v_flex().flex_1().min_w(0).gap(4).children(c.panes.map((q) => line(q, `${ci}-${i++}`)))))))
        .child(note("Each program is kept with the flags you started it with. A resumed session's id is left out, so each agent starts fresh."))
        .when(Boolean(replaces), (el) => el.child(note(`This replaces the arrangement named ${replaces?.name}.`, t.muted)))
        .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("ar-back", "Back", false, true, (cx) => { this.view = "list"; this.target = null; cx.notify(); }))
          .child(button("ar-save", replaces ? "Overwrite" : "Save", true, Boolean(cols.length), (cx) => this.save(cx))));
    }

    const list = this.list ?? [];
    const others = this.others ?? [];
    const row = (a) => {
      const key = `rm:${a.from}:${a.name}`, armed = this.armed === key, id = `${a.from}:${a.name}`;
      const from = a.from === projectOf(this.space) ? null : originOf(a);
      const n = a.cols.reduce((s, c) => s + c.panes.length, 0);
      return h_flex().id(`ar-${id}`).w_full().px(10).py(8).gap(10).items_center().rounded(7)
        .when(!this.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.open(a, cx)))
        .child(svg("mods/kanso-chrome/icons/layers.svg").size(15).flex_none().text_color(t.muted))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().min_w(0).gap(8).items_baseline()
            .child(div().flex_shrink_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(a.name))
            .when(Boolean(from), (el) => el.child(div().flex_none().max_w(140).truncate().text_size(11.5).text_color(t.dim).child(`from ${from}`))))
          .child(div().truncate().text_size(11.5).text_color(t.dim).child(`${n} ${n === 1 ? "pane" : "panes"}: ${summary(a)}`)))
        .when(!this.busy, (el) => el.child(div().id(`ar-ow-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(t.dim)
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.startSave(cx, a); })
          .child("Overwrite")))
        .child(div().id(`ar-rm-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(armed ? t.blocked : t.dim)
          .hover((s) => s.text_color(armed ? t.blocked : t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.arm(key, cx, (cx) => this.remove(a, cx)); })
          .child(armed ? "Press again to delete" : "Delete"));
    };
    const label = (text) => div().pt(12).pb(4).px(10).text_size(11.5).text_color(t.dim).child(text);
    const asleep = this.asleep ?? [];
    const groups = [...asleep.reduce((m, a) => m.set(a.from, [...(m.get(a.from) ?? []), a]), new Map())];
    const spaceName = (from) => spaces().find((sp) => projectOf(sp) === from)?.name ?? (base(folderOfKey(from)) || "~");
    const when = (ms) => { const d = new Date(ms), today = new Date().toDateString() === d.toDateString(); return today ? d.toTimeString().slice(0, 5) : d.toDateString().slice(4, 10); };
    const sleeper = (a) => {
      const id = `${a.from}:${a.name}`, key = `forget:${id}`, armed = this.armed === key;
      return h_flex().id(`zz-${id}`).w_full().px(10).py(8).gap(10).items_center().rounded(7)
        .when(!this.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.wake(a, cx)))
        .child(svg("mods/kanso-chrome/icons/layers.svg").size(15).flex_none().text_color(t.muted))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().min_w(0).gap(8).items_baseline()
            .child(div().flex_shrink_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(a.name))
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`asleep since ${when(a.saved)}`)))
          .child(div().truncate().text_size(11.5).text_color(t.dim).child(sleepers(a))))
        .when(!this.busy, (el) => el.child(div().id(`zz-wake-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(t.foreground)
          .hover((s) => s.opacity(0.8)).on_click((_e, cx) => { cx.stop_propagation(); this.wake(a, cx); }).child("Wake")))
        .child(div().id(`zz-rm-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(armed ? t.blocked : t.dim)
          .hover((s) => s.text_color(armed ? t.blocked : t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.arm(key, cx, (cx) => cx.spawn(async (cx) => { this.setAsleep(await this.store.woke(a.from, a.name)); cx.notify(); })); })
          .child(armed ? "Press again to forget" : "Forget"));
    };
    return shell
      .child(head("Arrangements", `Opens in ${project}`))
      .child(v_flex().id("ar-list").pt(14).gap(2).max_h(420).overflow_y_scrollbar()
        .when(this.list === null, (el) => el.child(div().py(8).text_size(12).text_color(t.dim).child("Reading")))
        .when(asleep.length > 0, (el) => el.children(groups.map(([from, tabs]) => v_flex().gap(2)
            .child(h_flex().items_center().child(div().flex_1().child(label(`Asleep in ${spaceName(from)}`)))
              .when(tabs.length > 1 && !this.busy, (el) => el.child(div().id(`zz-all-${from}`).px(16).pt(8).text_size(11.5).text_color(t.foreground).cursor_pointer()
                .hover((s) => s.opacity(0.8)).on_click((_e, cx) => this.wake(tabs[0], cx, tabs.slice(1))).child(`Wake all ${tabs.length}`))))
            .children(tabs.map(sleeper))))
          .when(list.length + others.length > 0, (el) => el.child(label("Arrangements"))))
        .when(this.list !== null && !list.length && !others.length && !asleep.length, (el) => el.child(v_flex().py(6).gap(4)
          .child(div().text_size(13).text_color(t.muted).child("No arrangement yet."))
          .child(div().text_size(11.5).line_height(1.45).text_color(t.dim).child("Set up a tab the way you work, with your agents, their flags and your servers, then save it to open it again in one click, in this project or any other."))))
        .when(list.length > 0 && others.length > 0 && !asleep.length, (el) => el.child(label("This project")))
        .children(list.map(row))
        .when(others.length > 0, (el) => el.child(label(list.length ? "Other projects, opened here" : "From other projects, opened here")))
        .children(others.map(row)))
      .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
      .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("ar-close", "Close", false, true, () => closeOverlay(p.overlay)))
        .child(button("ar-sleep-all", `Sleep ${project}`, false, !this.busy && (this.space?.tabs.length ?? 0) > 1, (cx) => this.startSleep(cx, true)))
        .child(button("ar-sleep", "Sleep this tab", false, !this.busy, (cx) => this.startSleep(cx)))
        .child(button("ar-new", "Save this tab", !list.length && !others.length, !this.busy, (cx) => this.startSave(cx))));
  }
}

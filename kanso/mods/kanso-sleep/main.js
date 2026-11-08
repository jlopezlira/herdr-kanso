// Sleep, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Props: sleep { scope: "agent" | "tab" | "project", space, tab, pane }, wake { id } or { from, name }, wakeAll { from, space }.
// Asleep is a status of an agent in the left nav's database (the sidebar owns it); shared "kanso.asleep" is a copy of what it read.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, shared, setShared, hc, run, props, closeOverlay, theme, home, readTextFile, exec } from "herdr";
import { Store, idle, shownOf } from "./store.js";
import { spaceFor, inPlace } from "./kdb.js";
import { listKey, moveTo } from "./listkeys.js";
import { base, tilde, shq, SHELLS, captureTab, commandOf, describe, programOf, projectOf, folderOfKey, openTab, openInto } from "./tabkit.js";
import { resumeArgv, promptEmpty, isClaude } from "./resume.js";
import { range, retry, tryOr, tryOrAsync, findAsync, mapSeries, reduceSeries } from "./pure.js";

const ARM_MS = 4000;

const settled = async (fn) => {
  try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error }; }
};
// A step that throws marks the state failed; the steps after it are skipped.
const step = async (st, fn) => {
  if (st.failed) return st;
  const r = await settled(() => fn(st));
  return r.ok ? r.value : { ...st, failed: true, error: r.error };
};
// settled(fn) plus `told`: the arguments of its first tell(...) (it may tell, then throw), null when it never told.
const telling = (fn) => new Promise((done) => {
  const told = new Promise((tell) => {
    done(settled(() => fn((...args) => tell(args))).then(async (end) => { tell(null); return { ...end, told: await told }; }));
  });
});

export function wakeArgv(p) {
  if (!p.argv) return null;
  if (!p.resume || !isClaude(p.argv)) return p.argv;
  return p.wake ?? resumeArgv(p.argv, p.resume);
}
export const wakeable = (a) => ({ ...a, cols: a.cols.map((c) => ({ ...c, panes: c.panes.map((p) => ({ argv: wakeArgv(p), cwd: p.cwd, resume: p.resume ?? null, name: p.name ?? null })) })) });
export const sleepers = (a) => a.cols.flatMap((c) => c.panes).map((p) => p.name || programOf(p.argv)).join(", ");

export function sleepBlocker(recs) {
  const r = [...recs].map(([, x]) => x).find((x) => x?.status?.state === "working" || x?.status?.state === "blocked");
  return r ? `${r.labels?.["kanso.name"] || r.title || r.address} is ${r.status.state === "working" ? "working" : "waiting on you"}` : null;
}

const shapeOf = (list) => JSON.stringify(list.map((r) => [r.tab.id, r.capture.cols.flatMap((c) => c.panes).map((p) => [p.terminal ?? null, p.pid ?? null, p.resume ?? null, p.argv])]));
export const sameTabs = (a, b) => shapeOf(a) === shapeOf(b);

// The pid still on conversation `session`, matched by start time (a reused pid is not it); throws when it can't tell: never "none" for what it could not see.
const RUNNING = String.raw`d="$2"/.claude/sessions
if ! out=$(LC_ALL=C ls -d "$d" 2>&1); then case "$out" in *": No such file or directory") exit 0;; *) echo "can't look at $d: $out" >&2; exit 2;; esac; fi
if [ ! -r "$d" ] || [ ! -x "$d" ]; then echo "can't read $d" >&2; exit 2; fi
for f in "$d"/*.json; do
  [ -f "$f" ] || continue
  grep -qF "\"sessionId\":\"$1\"" "$f"; rc=$?
  if [ $rc -eq 1 ]; then continue; elif [ $rc -ne 0 ]; then echo "can't read $f" >&2; exit 2; fi
  p=$(basename "$f" .json)
  kill -0 "$p" 2>/dev/null || continue
  comm=$(LC_ALL=C ps -p "$p" -o comm= 2>/dev/null)
  [ "$(basename "$comm")" = claude ] || continue
  want=$(sed -n 's/.*"procStart":"\([^"]*\)".*/\1/p' "$f")
  if [ -n "$want" ]; then have=$(LC_ALL=C TZ=UTC ps -p "$p" -o lstart= 2>/dev/null | sed 's/^ *//;s/ *$//'); [ "$have" = "$want" ] || continue; fi
  echo "$p"; exit 0
done
exit 0`;
export async function runningOn(session) {
  const r = await exec("sh", ["-c", RUNNING, "sh", session, home()]);
  if (r.code !== 0) throw new Error((r.stderr || "the check failed").trim().split("\n")[0]);
  const pid = Number(r.stdout?.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

// At its own shell's prompt: another shell in front (a script, say) counts as running.
export const atPrompt = (x) => Boolean(x) && (!x.foreground?.pid || x.foreground.pid === x.pid);

// A pid given to another process since is not it: the start time must match.
export async function stillThere(pid, before, now = Date.now()) {
  const p = await procOf(pid, now);
  return p?.comm === "claude" && p.start <= before + 2000;
}
export async function procOf(pid, now = Date.now()) {
  const ps = await exec("ps", ["-p", String(pid), "-o", "etime=,comm="]).catch(() => null);
  const m = ps?.code === 0 ? /^\s*(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)\s+(.+?)\s*$/.exec(ps.stdout) : null;
  if (!m) return null;
  const age = (((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3])) * 60 + Number(m[4])) * 1000;
  return { comm: base(m[5]), start: now - age };
}

// A claude resuming `session` names it in its argv even before its session record exists;
// throws when a live terminal can't be read, never "none" for what it could not see.
export async function runningIn(session) {
  const live = terminals().filter((k) => !(k.state && k.state !== "live") && !String(k.address).includes("/"));
  const k = await findAsync(live, async (t) => {
    const g = await hc(["get", t.address, "--json"]).catch(() => null);
    const x = tryOr(() => JSON.parse(g.stdout));
    if (!x) throw new Error(`${t.address} could not be read`);
    return (x.foreground?.argv ?? []).map(String).includes(session);
  });
  return k ? k.address : null;
}

export function freeName(name, taken) {
  const from = (n, k) => (taken.has(n) ? from(`${name} ${k}`, k + 1) : n);
  return from(name, 2);
}

// The record, not the arguments, proves it: a --resume process may be stuck before the conversation loads.
export function isResumed(fg, record, session) {
  return Boolean(fg?.pid && record && record.pid === fg.pid && record.sessionId === session);
}

// A pane the strip has not placed yet would be left running when the tab closes.
export function coversTab(capture, terminals) {
  const got = capture.cols.flatMap((c) => c.panes).map((p) => p.terminal);
  return got.length === terminals.length && new Set(got).size === got.length && terminals.every((t) => got.includes(t));
}
export const colsOf = (list) => [{ w: 1, panes: list }];

const since = (ms) => { const d = new Date(ms); return new Date().toDateString() === d.toDateString() ? d.toTimeString().slice(0, 5) : d.toDateString().slice(4, 10); };

export default class Sleep extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.view = "list";
    this.asleep = null;
    this.armed = null;
    this.busy = null;
    this.error = null;
    const ask = props() ?? {};
    this.space = spaces().find((s) => s.id === ask.sleep?.space) ?? spaces().find((s) => s.active) ?? null;
    this.store = new Store();
    if (ask.sleep) this.startSleep(cx, ask.sleep.scope === "project", ask.sleep.tab, ask.sleep.scope === "agent" ? ask.sleep.pane : null);
    cx.spawn(async (cx) => {
      try { await this.refresh(true); }
      catch (e) { this.asleep = []; this.error = String(e?.message ?? e); cx.notify(); return; }
      const waking = ask.wakeAll ? this.asleep.filter((a) => inPlace(a, ask.wakeAll, spaces(), home()))
        : ask.wake ? this.asleep.filter((a) => (ask.wake.id ? a.id === ask.wake.id : a.from === ask.wake.from && a.name === ask.wake.name)) : [];
      if (waking.length) this.wake(waking[0], cx, waking.slice(1));
      else if (ask.wake || ask.wakeAll) this.error = "That tab is no longer asleep.";
      cx.notify();
    });
  }

  // A read overtaken by a newer "kanso.asleep.at" stamp (here or the sidebar's) is not published.
  async refresh(strict = false) {
    const started = Date.now();
    const read = await settled(() => this.store.asleep(true));
    if (!read.ok) { if (strict) throw read.error; return; }
    const all = read.value;
    // The list shows what can wake now; the sidebar also what is on its way.
    this.asleep = all.filter((a) => idle(a, started));
    if ((shared("kanso.asleep.at") ?? 0) > started) return;
    setShared("kanso.asleep.at", started);
    setShared("kanso.asleep", all.map((a) => shownOf(a, started)));
  }

  // Each Claude agent's conversation is its session record, ~/.claude/sessions/<pid>.json.
  async readTab(tab) {
    const tabPanes = panes().filter((p) => p.tab === tab.id && p.terminal && (!this.onlyPane || p.pane === this.onlyPane));
    // [record] per terminal, or null when it can't be read: reported below.
    const read = await Promise.all(tabPanes.map(async (p) => {
      const r = await hc(["get", p.terminal, "--json"]).catch(() => null);
      return { p, got: r?.code === 0 ? tryOr(() => [JSON.parse(r.stdout)]) : null };
    }));
    const recs = new Map(read.flatMap(({ p, got }) => (got ? [[p.terminal, got[0]]] : [])));
    const unread = read.filter(({ p }) => !recs.has(p.terminal)).map(({ p }) => `${p.terminal} could not be read`);
    const claudes = [...recs].filter(([, r]) => { const fg = r.foreground; return fg?.pid && isClaude(fg.argv); });
    const agents = await mapSeries(claudes, async ([term, r]) => {
      const fg = r.foreground;
      const ses = await tryOrAsync(async () => JSON.parse(await readTextFile(`${home()}/.claude/sessions/${fg.pid}.json`))); // null: reported below
      // It sleeps under the name the sidebar shows it by.
      const who = shared("kanso.names")?.[term] || r.labels?.["kanso.name"] || ses?.name || r.title || term;
      const again = ses?.sessionId ? resumeArgv(fg.argv, ses.sessionId) : null;
      const problem = !ses?.sessionId || ses.pid !== fg.pid ? `${who}'s conversation was not found, so it could not wake on it`
        : !again ? `${who} was started with options a wake can't carry over` : null;
      // given: the name you gave it; it goes back on wake.
      return { problem, entry: [term, { resume: ses?.sessionId ?? null, name: who, given: r.labels?.["kanso.name"] || null, pid: fg.pid, terminal: term, wake: again }] };
    });
    const byAgent = new Map(agents.map((g) => g.entry));
    const extra = new Map([...byAgent, ...tabPanes.filter((p) => !byAgent.has(p.terminal)).map((p) => [p.terminal, { terminal: p.terminal }])]);
    const capture = this.onlyPane
      ? { per: null, cols: tabPanes.map((p) => ({ w: 1, panes: [{ argv: commandOf(recs.get(p.terminal)), cwd: recs.get(p.terminal)?.foreground?.cwd || p.cwd || null, ...(extra.get(p.terminal) ?? {}) }] })) }
      : captureTab(shared("strip.state")?.[tab.id], tabPanes, recs, extra);
    // The first thing that stops it, in this order.
    const error = [
      this.space?.machine ? "Sleep works on this computer's agents for now" : null,
      ...unread,
      ...agents.map((g) => g.problem),
      this.onlyPane && !capture.cols[0]?.panes[0]?.pid ? "only a Claude agent can sleep on its own; this pane runs something else" : null,
      !this.onlyPane && !coversTab(capture, tabPanes.map((p) => p.terminal)) ? "a pane of it is still being placed; try again in a moment" : null,
    ].find((e) => e != null) ?? null;
    // What ran in front of each terminal at the read: after the sleep, only that process (still there) is this sleep's to end.
    const fronts = new Map([...recs].map(([t, x]) => [t, atPrompt(x) ? 0 : x?.foreground?.pid ?? null]));
    return { tab, capture, fronts, blocker: sleepBlocker(recs), error };
  }

  async readTabs(tabs) {
    const all = this.space?.tabs ?? [];
    const read = await Promise.all(tabs.map((t) => this.readTab(t)));
    return read.map((r) => ({ ...r, name: this.onlyPane ? (r.capture.cols[0]?.panes[0]?.name ?? "Agent") : r.tab.named ? r.tab.name : `Tab ${all.indexOf(r.tab) + 1}` }))
      .filter((r) => r.capture.cols.length);
  }

  startSleep(cx, whole = false, tabId = null, pane = null) {
    const all = this.space?.tabs ?? [];
    const tabs = whole ? all : all.filter((t) => (tabId ? t.id === tabId : t.active));
    this.view = "sleep"; this.whole = whole; this.onlyPane = pane; this.sleepers = null; this.error = null; this.sleepTabs = tabs;
    cx.notify();
    cx.spawn(async (cx) => {
      this.sleepers = await this.readTabs(tabs);
      if (!whole && this.sleepers.length && !this.sleepers.some((r) => r.blocker || r.error)) this.sleep(cx);
      cx.notify();
    });
  }

  // Read again at the press (the view may be old); if one agent won't leave, the ones that left come back.
  sleep(cx) {
    const shown = this.sleepers;
    if (this.view !== "sleep" || this.busy || !shown?.length || shown.some((r) => r.blocker || r.error)) return;
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
      const was = await settled(async () => new Set((await this.store.asleep(true)).filter((a) => a.from === project).map((a) => a.name)));
      if (!was.ok) { this.busy = null; this.error = String(was.error?.message ?? was.error); cx.notify(); return; }
      // Each tab under a name no other tab asleep in the project has (nor one before it here).
      const named = list.reduce(({ out, taken }, r) => {
        const name = freeName(r.name, taken);
        return { out: [...out, { ...r, name }], taken: new Set([...taken, name]) };
      }, { out: [], taken: was.value }).out;
      // { halt } when it stopped the whole sleep (said already); else its notes and whether its tab stayed open.
      const sleepOne = async (r) => {
        const cap = r.capture;
        const agents = cap.cols.flatMap((c) => c.panes).filter((p) => p.pid);
        const kept = (p) => ({ argv: p.argv, cwd: p.cwd, resume: p.resume ?? null, wake: p.wake ?? null, name: p.name ?? null, given: p.given ?? null, terminal: p.terminal ?? null, tab: r.tab.id, ...(p.pid ? { pid: p.pid } : {}) });
        const entry = { name: r.name, space: this.space ? { id: this.space.id, name: this.space.name } : null, per: cap.per, saved: Date.now(),
          cols: cap.cols.map((c) => ({ w: c.w, panes: c.panes.map(kept) })),
          ...(this.onlyPane ? { into: { tab: r.tab.named ? r.tab.name : null, tabId: r.tab.id } } : {}) };
        // sent: those /exit went to; left: those that went.
        const written = await step({ id: null, left: [], sent: [] }, async (st) => ({ ...st, id: await this.store.sleep(project, entry) }));
        const shown = await step(written, async (st) => { await this.refresh(); return st; }); // the sidebar shows it falling asleep, in its place
        const out = await reduceSeries(agents, (prev, p, i) => step(prev, async (st) => {
          // Still this sleep's (renewed): else another window has it now, and nothing more leaves.
          if (!(await this.store.holdSleep(st.id))) throw new Error("another window took it meanwhile");
          this.busy = `${p.name} is leaving, ${i + 1} of ${agents.length} in ${r.name}`; cx.notify();
          const end = await telling((tell) => this.leave(p, cx, tell));
          const sent = end.told ? [...st.sent, p] : st.sent;
          return end.ok ? { ...st, sent, left: [...st.left, p] } : { ...st, sent, failed: true, error: end.error };
        }), shown);
        const { id } = out;
        if (out.failed) {
          const e = out.error;
          // Undo only what this sleep wrote, and only while it still holds its row: another window may be waking them.
          if (id && !(await this.store.holdSleep(id).catch(() => false))) {
            await this.refresh();
            this.busy = null; this.view = "list";
            this.error = `Stopped: ${String(e?.message ?? e)}. Another window has ${r.name} now; it is left as that window has it.`;
            cx.notify();
            return { halt: true };
          }
          this.busy = "Bringing the agents back"; cx.notify();
          const slow = out.sent.filter((p) => !out.left.includes(p));
          const wentLate = await mapSeries(slow, (p) => this.gone(p.pid, cx, 30));
          const left = [...out.left, ...slow.filter((_, k) => wentLate[k])];
          // Each comes back only while this sleep still holds its row; backPid is the pid it told.
          const came = await mapSeries(left, async (p) => {
            if (id && !(await this.store.holdSleep(id).catch(() => false))) return { p, theirs: true };
            const end = await telling((tell) => this.comeBack(p, cx, tell));
            if (!end.ok) throw end.error;
            return { p, how: end.value, backPid: end.told?.[0] };
          });
          const theirs = came.filter((c) => c.theirs).map((c) => c.p);
          const lost = came.filter((c) => !c.theirs && c.how === "out").map((c) => c.p);
          const unsure = came.filter((c) => !c.theirs && c.how === "unsure").map((c) => c.p);
          const back = came.filter((c) => !c.theirs && c.how !== "out" && c.how !== "unsure");
          const missing = [...lost.map(kept), ...unsure.map((p) => ({ ...kept(p), check: p.terminal }))];
          const undone = id && !theirs.length
            ? await (missing.length ? this.store.narrow(id, colsOf(missing)) : this.store.drop(id)).catch(() => false)
            : true;
          if (theirs.length || !undone) {
            // The row still has them asleep: end what came back here, so only a wake ever starts them.
            const stopped = await mapSeries(back, (c) => this.stopIn(c.p.terminal, cx, c.backPid));
            const ended = back.filter((_, k) => stopped[k]).map((c) => c.p.name);
            const running = back.filter((_, k) => !stopped[k]).map((c) => c.p.name);
            if (id) await this.refresh();
            this.busy = null; this.view = "list";
            this.error = `Stopped: ${String(e?.message ?? e)}. ${theirs.length ? `Another window has ${r.name} now` : `${r.name} could not be updated`}`
              + (theirs.length ? `; ${theirs.map((p) => p.name).join(", ")} ${theirs.length === 1 ? "is" : "are"} left as that window has ${theirs.length === 1 ? "it" : "them"}` : "")
              + (ended.length ? `; ${ended.join(", ")} came back here and ended again, to wake from the list` : "")
              + (running.length ? `; ${running.join(", ")} could not be ended: end ${running.length === 1 ? "it" : "them"} before waking` : "") + ".";
            cx.notify();
            return { halt: true };
          }
          if (id) await this.refresh();
          this.busy = null;
          const names = (list) => list.map((p) => p.name).join(", ");
          this.error = `Stopped: ${String(e?.message ?? e)}. ${r.name} stays open`
            + (!left.length ? "" : !lost.length && !unsure.length ? "; the agents that had left are back on their conversations" : "")
            + (lost.length ? `; ${names(lost)} did not come back and ${lost.length === 1 ? "stays" : "stay"} asleep, to wake from here` : "")
            + (unsure.length ? `; ${names(unsure)} could not be checked or stopped and ${unsure.length === 1 ? "stays" : "stay"} asleep; a wake looks at ${unsure.length === 1 ? "its" : "their"} terminal first` : "") + ".";
          this.view = lost.length || unsure.length ? "list" : this.view;
          cx.notify();
          return { halt: true };
        }
        // Every agent has left: the tab is asleep, whatever comes next.
        const marked = await settled(() => this.store.settle(id));
        const note = !marked.ok ? `${r.name} is asleep but could not be marked so (${String(marked.error?.message ?? marked.error)}); it shows to wake in 10 minutes.`
          : !marked.value ? `${r.name} is asleep, but another window took it meanwhile.` : null;
        await this.refresh();
        const known = new Set(cap.cols.flatMap((c) => c.panes).map((p) => p.terminal));
        // End what slept so it can't run twice; a terminal running something you started since is yours and stays.
        const looked = await mapSeries([...known], async (t) => {
          const now = terminals().some((k) => k.address === t) ? await this.frontOf(t) : 0;
          return { t, idle: now === 0 || (now != null && now === r.fronts?.get(t)) };
        });
        const idle = looked.filter((x) => x.idle).map((x) => x.t), busy = looked.filter((x) => !x.idle).map((x) => x.t);
        const fresh = panes().some((p) => p.tab === r.tab.id && p.terminal && !known.has(p.terminal));
        if (!note && !fresh && !busy.length) { run("tab.close", { id: r.tab.id, confirmed: true }); return { notes: [], stayed: false }; }
        for (const t of idle) run("terminal.kill", { terminal: t });
        const busyNote = busy.length ? [`${r.name} is asleep; ${busy.join(", ")} ${busy.length === 1 ? "runs" : "run"} something started there meanwhile and ${busy.length === 1 ? "stays" : "stay"} open.`] : [];
        return { notes: [...(note ? [note] : []), ...busyNote], stayed: !busy.length && !note && !this.onlyPane };
      };
      const slept = await reduceSeries(named, async (acc, r) => {
        if (acc.halt) return acc;
        const one = await sleepOne(r);
        return one.halt ? { ...acc, halt: true } : { ...acc, notes: [...acc.notes, ...one.notes], stayed: one.stayed ? [...acc.stayed, r.name] : acc.stayed };
      }, { halt: false, notes: [], stayed: [] });
      if (slept.halt) return;
      const { stayed, notes } = slept;
      if (stayed.length || notes.length) {
        this.busy = null; this.view = "list";
        this.error = [...notes, ...(stayed.length ? [`${stayed.join(", ")} ${stayed.length === 1 ? "is" : "are"} asleep, but ${stayed.length === 1 ? "its tab stays" : "their tabs stay"} open: a pane opened in ${stayed.length === 1 ? "it" : "them"} meanwhile.`] : [])].join(" ");
        cx.notify();
        return;
      }
      closeOverlay(props()?.overlay);
    });
  }

  // Its prompt is cleared and seen empty first: a draft would go out with /exit.
  async leave(p, cx, onSent = () => {}) {
    const now = await hc(["get", p.terminal, "--json"]).catch(() => null);
    const fg = tryOr(() => JSON.parse(now.stdout).foreground?.pid); // null: unread, below
    if (fg !== p.pid) throw new Error(`${p.name}'s terminal changed`);
    const clear = await hc(["keys", p.terminal, "ctrl+c"]).catch(() => null);
    await cx.sleep(400);
    const screen = clear?.code === 0 ? await hc(["read", p.terminal]).catch(() => null) : null;
    if (screen?.code !== 0 || !promptEmpty(screen.stdout)) throw new Error(`${p.name}'s prompt could not be cleared`);
    const s = await hc(["send", p.terminal, "/exit"]).catch(() => null);
    onSent();
    if (s?.code !== 0) throw new Error(`${p.name} did not take /exit`);
    if (!(await this.gone(p.pid, cx, 20))) throw new Error(`${p.name} did not exit`);
  }

  // Its front pid, 0 at its prompt, null when it can't be read.
  async frontOf(terminal) {
    const g = await hc(["get", terminal, "--json"]).catch(() => null);
    try { const x = JSON.parse(g.stdout); return atPrompt(x) ? 0 : x.foreground.pid; } catch { return null; }
  }

  async gone(pid, cx, secs) {
    if (secs * 2 <= 0) return false;
    return retry(secs * 2, async () => {
      await cx.sleep(500);
      return (await exec("kill", ["-0", String(pid)]).catch(() => null))?.code !== 0;
    });
  }

  // "back" when it is again on its conversation, "out" when nothing of it runs, "unsure" when something it started could not be stopped.
  // The terminal must be at its prompt right before the line goes, and only what that line started is ever stopped.
  async comeBack(p, cx, onBack = () => {}) {
    const line = `cd ${shq(p.cwd || home())} && ${p.wake.map(shq).join(" ")}`;
    const front = async () => {
      const g = await hc(["get", p.terminal, "--json"]).catch(() => null);
      try { const x = JSON.parse(g.stdout); return { x, idle: atPrompt(x) }; } catch { return null; }
    };
    const f = await retry(20, async () => {
      const look = await front();
      if (!look?.idle) await cx.sleep(500);
      return look;
    }, { done: (look) => Boolean(look?.idle) });
    if (!f?.idle) return "out";
    await cx.sleep(800);
    // Started elsewhere meanwhile: never a second one here; what can't be checked is not started either.
    try { if ((await runningOn(p.resume)) || (await runningIn(p.resume))) return "out"; } catch { return "unsure"; }
    // The last look, right before the line goes.
    if (!(await front())?.idle) return "out";
    const sentAt = Date.now();
    if ((await hc(["send", p.terminal, line]).catch(() => null))?.code !== 0) return "out";
    // mine: the first process seen there since, on this resume and started after the line went; only that one is ever stopped.
    const check = async (fg, mine) => {
      if (mine || !fg?.pid || !(fg.argv ?? []).map(String).includes(p.resume)) return mine;
      const proc = await procOf(fg.pid);
      return proc?.comm === "claude" && proc.start >= sentAt - 2000 ? fg.pid : mine;
    };
    const { pid, mine: ours } = await this.resumed(p.terminal, p.resume, cx, check);
    if (pid) { onBack(pid); return "back"; }
    // Not back: end only what it started; anything else there is yours and a wake looks at that terminal first.
    const now = await front();
    if (!now) return "unsure";
    if (now.idle) return "out";
    if (ours && now.x.foreground?.pid === ours) return (await this.stopIn(p.terminal, cx, ours)) ? "out" : "unsure";
    return "unsure";
  }

  // `only`: stop that pid alone; anything else running there now (it ended and you started something) is left, and counts as stopped.
  async stopIn(terminal, cx, only = null) {
    const front = async () => {
      const g = await hc(["get", terminal, "--json"]).catch(() => null);
      try { const x = JSON.parse(g.stdout); const fg = x.foreground; return !fg?.pid || fg.pid === x.pid || SHELLS.has(base(fg.argv?.[0])) ? 0 : fg.pid; } catch { return null; }
    };
    // One signal: true or false when that settles it, null to send the next.
    const signal = async (sig) => {
      const pid = await front();
      if (pid === 0 || (only && pid !== only && pid != null)) return true;
      if (pid == null) return false;
      await exec("kill", [sig, String(pid)]).catch(() => null);
      return (await retry(10, async () => { await cx.sleep(300); return (await front()) === 0; })) ? true : null;
    };
    return (await reduceSeries(["-TERM", "-KILL"], async (got, sig) => (got === null ? signal(sig) : got), null)) === true;
  }

  // { pid } once a Claude is back on `session` and has stayed a moment (up to 30 seconds);
  // saw(fg, mine) sees each front process meanwhile and answers the next `mine`.
  async resumed(terminal, session, cx, saw = async (_fg, mine) => mine) {
    const look = async ({ mine }) => {
      await cx.sleep(1000);
      const g = await hc(["get", terminal, "--json"]).catch(() => null);
      const fg = tryOr(() => JSON.parse(g.stdout).foreground ?? null); // null: not yet
      const seen = await saw(fg, mine);
      if (!fg?.pid || SHELLS.has(base(fg.argv?.[0]))) return { pid: null, mine: seen };
      const record = await tryOrAsync(async () => JSON.parse(await readTextFile(`${home()}/.claude/sessions/${fg.pid}.json`))); // null: none
      return { pid: isResumed(fg, record, session) ? fg.pid : null, mine: seen };
    };
    return reduceSeries(range(30), (st) => (st.pid ? st : look(st)), { pid: null, mine: null });
  }

  // Only checked agents stop being asleep; what did not prove it back is ended, so nothing runs twice.
  // `claim` hands back the row as it is now: an old list never opens what another window changed. `rest`: more to wake after it.
  wake(shown, cx, rest = []) {
    if (this.busy) return;
    this.busy = `Waking ${shown.name}`; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      const claimed = await settled(() => this.store.claim(shown.id));
      if (!claimed.ok) { this.busy = null; this.error = `${shown.name} could not be woken: ${String(claimed.error?.message ?? claimed.error)}`; cx.notify(); return; }
      const a = claimed.value;
      if (!a) {
        await this.refresh();
        this.busy = null; this.error = `${shown.name} is waking in another window, or is no longer asleep.`; cx.notify(); return;
      }
      await this.refresh(); // the sidebar shows it waking
      // A sleep that stopped half way left its row pending: an agent that never left may still run in p.check.
      const mayRun = async (p) => {
        if (!p.check) return [];
        const gone = !terminals().some((t) => t.address === p.check);
        const g = gone ? null : await hc(["get", p.check, "--json"]).catch(() => null);
        const x = tryOr(() => (g?.code === 0 ? JSON.parse(g.stdout) : null)); // null: below
        const idleShell = atPrompt(x);
        return !gone && !idleShell ? [`${p.name ?? "an agent"} may still run in ${p.check}`] : [];
      };
      // Already running anywhere (brought back by a stopped sleep, or by hand): never a second one.
      const runsAlready = async (p) => {
        const look = await settled(async () => {
          const pid = await runningOn(p.resume);
          return { pid, term: pid ? null : await runningIn(p.resume) };
        });
        if (!look.ok) return [`whether ${p.name ?? "an agent"} already runs could not be checked (${String(look.error?.message ?? look.error)})`];
        const { pid, term } = look.value;
        return [...(pid ? [`${p.name ?? "an agent"} already runs on its conversation (pid ${pid})`] : []),
          ...(term ? [`${p.name ?? "an agent"} is starting on its conversation in ${term}`] : [])];
      };
      // An older sleep's row kept no conversation: match its old pid by program and start time.
      const stillRuns = async (p) => (a.pending && p.pid && (await stillThere(p.pid, a.saved)) ? [`${p.name ?? "an agent"} still runs (pid ${p.pid})`] : []);
      const still = (await mapSeries(a.cols.flatMap((c) => c.panes), async (p) => [...(await mayRun(p)), ...(p.resume ? await runsAlready(p) : await stillRuns(p))])).flat();
      if (still.length) {
        await this.store.release(a.id, a.token).catch(() => {});
        await this.refresh();
        this.busy = null; this.error = `${a.name} can't wake yet: ${still.join("; ")}. End ${still.length === 1 ? "it" : "them"} there, then wake.`; cx.notify(); return;
      }
      // From here this wake holds the row: whatever stops it lets the row go.
      const woke = await settled(() => this.wakeHeld(a, cx));
      if (!woke.ok) {
        await this.store.release(a.id, a.token).catch(() => {});
        await this.refresh();
        this.busy = null; this.error = `${a.name} could not be woken: ${String(woke.error?.message ?? woke.error)}`; this.view = "list"; cx.notify(); return;
      }
      if (!woke.value) return;
      if (rest.length) { this.wake(rest[0], cx, rest.slice(1)); return; }
      closeOverlay(props()?.overlay);
    });
  }

  // If another window took the row meanwhile, what this wake opened ends: nothing runs twice.
  async wakeHeld(a, cx) {
    const startedAt = Date.now();
    // replacing: this wake makes the space in place of a gone one.
    const where = async () => {
      const first = spaceFor({ spaceId: a.spaceId, spaceName: a.space, project: a.from }, spaces(), home());
      if (first || !a.spaceId) return { space: first, replacing: false };
      // One window at a time makes the replacement; a wake that waits takes the one made.
      const made = async () => { const to = await this.store.kdb.replacement(a.spaceId); return to ? spaces().find((w) => w.id === to) ?? null : null; };
      const found = await made();
      if (found) return { space: found, replacing: false };
      if (!(await this.store.kdb.replacing(a.spaceId, a.token))) {
        const waited = await retry(30, async () => { await cx.sleep(500); return made(); });
        if (!waited) throw new Error("another window is making its space; wake it again in a moment");
        return { space: waited, replacing: false };
      }
      // Made by another between the look and the hold: that one, not a second.
      const late = await made();
      if (late) { await this.store.kdb.unreplacing(a.spaceId, a.token).catch(() => {}); return { space: late, replacing: false }; }
      return { space: null, replacing: true };
    };
    const { space, replacing } = await where();
    const folder = folderOfKey(a.from), machine = String(a.from).slice(0, String(a.from).indexOf(":")) || undefined;
    const create = space ? null : { name: a.space || base(folder) || "~", folder, key: a.from, ...(machine ? { machine } : {}) };
    const intoTab = a.into && space ? (space.tabs ?? []).find((x) => x.id === a.into.tabId) ?? (a.into.tab ? (space.tabs ?? []).find((x) => x.name === a.into.tab) : null) : null;
    // Renew the hold last, so it still holds when the pane opens; the first throw stops the whole opening.
    const ahead = (lost) => async (p) => {
      const pid = p?.resume ? await runningOn(p.resume) : null;
      if (pid) throw new Error(`${p.name ?? "an agent"} already runs on its conversation (pid ${pid})`);
      const term = p?.resume ? await runningIn(p.resume) : null;
      if (term) throw new Error(`${p.name ?? "an agent"} is starting on its conversation in ${term}`);
      if (!(await this.store.renew(a.id, a.token))) { lost(); throw new Error("another window woke it meanwhile"); }
    };
    const opening = await telling(async (lost) => {
      if (intoTab) {
        this.busy = `${a.name}: back into ${intoTab.name || "its tab"}`; cx.notify();
        const p = wakeable(a).cols[0].panes[0];
        await ahead(lost)(p);
        return [[await openInto(p, cx, intoTab.id)]];
      }
      return openTab({ ...wakeable(a), name: a.into?.tab || a.name }, cx, { space, create, before: ahead(lost), progress: (t) => { this.busy = `${a.name}: ${t}`; cx.notify(); } });
    });
    const failure = opening.ok ? null : opening.error;
    const ids = opening.ok ? opening.value : opening.error?.opened ?? [];
    // The hold, lost to another window while it opened.
    const lostOpening = Boolean(opening.told);
    // Asked of Herdr and not shown (yet): it may still open, so the row is held until a wake can see whether it did.
    const late = Number(failure?.pending) || 0;
    const flat = a.cols.flatMap((c, ci) => c.panes.map((p, ri) => ({ p, pane: ids[ci]?.[ri] ?? null })));
    const termOf = (pane) => (pane ? panes().find((q) => q.pane === pane)?.terminal ?? null : null);
    const tabOf = flat.map((x) => x.pane && panes().find((q) => q.pane === x.pane)?.tab).find(Boolean);
    const nowIn = space?.id ?? (tabOf ? spaces().find((w) => (w.tabs ?? []).some((tb) => tb.id === tabOf))?.id ?? null : null);
    // Its space was gone and one was made for it: what else slept there wakes there too.
    if (replacing) await (nowIn && !lostOpening ? this.store.kdb.moveSpace(a.spaceId, nowIn, a.token) : this.store.kdb.unreplacing(a.spaceId, a.token)).catch(() => {});
    // owner: what this wake started per terminal; only that, or a terminal back at its prompt, is ever ended by it.
    const endIfOurs = async (owner, term, p) => {
      const g = await hc(["get", term, "--json"]).catch(() => null);
      const got = tryOr(() => [JSON.parse(g.stdout)]);
      if (!got) return false;
      const [x] = got;
      const fg = x.foreground;
      const mine = atPrompt(x) || (owner.has(term) && fg.pid === owner.get(term))
        || (!p?.resume && !owner.has(term) && JSON.stringify(fg?.argv ?? null) === JSON.stringify(wakeArgv(p)) && ((await procOf(fg.pid))?.start ?? 0) >= startedAt - 2000);
      if (mine) run("terminal.kill", { terminal: term });
      return mine;
    };
    // lost: the hold, renewed before each check, was lost; kept: terminals left open, not this wake's to end.
    const checked = await reduceSeries(flat, async (st, { p, pane }) => {
      const term = termOf(pane);
      if (!term) return { ...st, missed: [...st.missed, p] };
      if (!p.resume) return st;
      this.busy = `Checking ${p.name ?? "an agent"} is on its conversation`; cx.notify();
      const lost = st.lost || !(await this.store.renew(a.id, a.token).catch(() => true));
      // The first claude seen there on this conversation since the wake began is this wake's, unless one was already there.
      const saw = async (fg, mine) => {
        if (st.owner.has(term) || mine || !fg?.pid || !(fg.argv ?? []).map(String).includes(p.resume)) return mine;
        const proc = await procOf(fg.pid);
        return proc?.comm === "claude" && proc.start >= startedAt - 2000 ? fg.pid : mine;
      };
      const seen = await this.resumed(term, p.resume, cx, saw);
      const back = seen.pid, ours = back || seen.mine || st.owner.get(term);
      const owner = ours ? new Map([...st.owner, [term, ours]]) : st.owner;
      if (back) {
        // The name you gave it goes back on its new terminal, where names live.
        const given = (a.agents ?? []).find((g) => g.id === p.resume)?.name;
        const named = !given || (await retry(3, async () => (await hc(["label", term, `kanso.name=${given}`]).catch(() => null))?.code === 0));
        // Not put back yet: kept with its conversation; the sidebar puts it back when it can.
        return named ? { ...st, owner, lost } : { ...st, owner, lost, unnamed: [...st.unnamed, given], restores: [...st.restores, [p.resume, given]] };
      }
      // Not ended (unreadable, or not this wake's to end): it stays asleep with that terminal looked at first.
      const ended = await endIfOurs(owner, term, p);
      return { ...st, owner, lost, kept: ended ? st.kept : [...st.kept, term], missed: [...st.missed, ended ? p : { ...p, checkNow: term }] };
    }, { owner: new Map(), lost: lostOpening, missed: [], unnamed: [], restores: [], kept: [] });
    const { owner, lost, missed, unnamed, restores } = checked;
    const opened = flat.some((x) => x.pane);
    const endOpened = async () => (await mapSeries(flat, async ({ p, pane }) => {
      const term = termOf(pane);
      return term && !(await endIfOurs(owner, term, p)) ? [term] : [];
    })).flat();
    // Never awake and still claimable at once: what this wake started ends if the write can't land.
    const missedNow = missed.map(({ check, checkNow, ...p }) => (checkNow ? { ...p, check: checkNow } : p));
    const write = () => (!opened && !late ? this.store.release(a.id, a.token)
      : missed.length ? this.store.narrow(a.id, colsOf(missedNow), a.token, { space: nowIn, restores, wait: late > 0 })
      : this.store.woke(a.id, a.token, restores));
    const saved = lost ? { held: false, error: null } : await retry(4, async () => {
      const w = await settled(write);
      if (w.ok) return { done: true, held: w.value, error: null };
      const error = String(w.error?.message ?? w.error);
      await cx.sleep(1000);
      return { done: false, held: true, error };
    }, { done: (v) => v.done });
    const held = saved.held;
    const endedNow = (!held && opened) || (saved.error && opened) ? await endOpened() : [];
    const saveError = !held && opened ? "another window woke it meanwhile; what this one opened was ended"
      : saved.error && opened ? `${saved.error}; what it opened was ended, so it wakes from here again in 10 minutes`
      : saved.error;
    const kept = [...checked.kept, ...endedNow];
    await this.refresh();
    this.busy = null;
    if (failure || missed.length || saveError || (unnamed.length && held)) {
      const why = (failure ? `Stopped: ${String(failure?.message ?? failure)}. ` : "") + (saveError ? `${a.name} could not be updated (${saveError}). ` : "")
        + (unnamed.length && held ? `${unnamed.join(", ")} woke, but ${unnamed.length === 1 ? "its name" : "their names"} could not be put back on ${unnamed.length === 1 ? "its terminal" : "their terminals"}; the sidebar keeps trying. ` : "");
      this.error = why + (missed.length && held ? `${missed.map((p) => p.name || programOf(p.argv)).join(", ")} did not come back; ${missed.length === 1 ? "it stays" : "they stay"} asleep.` : "")
        + (kept.length ? ` ${[...new Set(kept)].join(", ")} ${kept.length === 1 ? "runs" : "run"} something this wake did not start and ${kept.length === 1 ? "is" : "are"} left open.` : "")
        + (late && held ? ` Herdr had not opened ${late === 1 ? "one of them" : `${late} of them`} yet and may still: ${a.name} can be woken again in 10 minutes, and a wake then never starts a conversation that runs.` : "");
      this.view = "list"; cx.notify(); return false;
    }
    return true;
  }

  arm(key, cx, act) {
    if (this.armed === key && Date.now() - this.armedAt <= ARM_MS) { this.armed = null; act(cx); return; }
    this.armed = key; this.armedAt = Date.now(); cx.notify();
    cx.timer.after(ARM_MS + 50, (cx) => { if (this.armed === key) { this.armed = null; cx.notify(); } });
  }

  listed(e) {
    const { move, gAt } = listKey(e, this.listG);
    this.listG = gAt;
    return move;
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
      .child(div().text_size(11.5).line_height(1.45).text_color(t.dim).child(sub));
    const note = (text, tone) => div().pt(10).text_size(11.5).line_height(1.45).text_color(tone ?? t.dim).child(text);
    const shell = v_flex().id("kanso-sleep").track_focus(this.handle).w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const move = this.view === "list" ? this.listed(e) : (e.key === "escape" ? "escape" : null);
        if (!move) return;
        if (move !== "escape") {
          const order = this.order ?? [];
          if (move === "enter") { if (!this.busy && order[this.at ?? 0]) this.wake(order[this.at ?? 0], cx); }
          else if (move !== "pending") this.at = moveTo(move, this.at ?? 0, order.length);
          cx.stop_propagation(); cx.notify(); return;
        }
        if (this.busy) { cx.stop_propagation(); return; }
        if (this.view === "sleep" && (props()?.sleep == null)) { this.view = "list"; this.error = null; cx.notify(); }
        else closeOverlay(p.overlay);
        cx.stop_propagation();
      });

    if (this.view === "sleep") {
      const list = this.sleepers ?? [];
      const whole = this.whole, alone = Boolean(this.onlyPane);
      const panesOf = (r) => r.capture.cols.flatMap((c) => c.panes);
      const others = [...new Set(list.flatMap(panesOf).filter((q) => !q.pid && q.argv).map((q) => programOf(q.argv)))];
      const stop = list.find((r) => r.blocker || r.error);
      const line = (q, i) => h_flex().id(`sl-${i}`).w_full().gap(10).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(q.pid ? t.foreground : t.muted).child(q.pid ? q.name : describe(q.argv)))
        .child(div().flex_none().max_w(180).truncate().text_size(11.5).text_color(t.dim).child(q.pid ? "keeps its conversation" : tilde(q.cwd)));
      // Each pane's id counts the panes before it, across the tabs.
      const starts = list.map((_, k) => list.slice(0, k).reduce((s, r) => s + panesOf(r).length, 0));
      const ready = list.length > 0 && !stop && !this.busy;
      return shell
        .child(head(whole ? `Sleep ${project}` : alone ? "Sleep this agent" : "Sleep this tab",
          whole ? "Every tab's agents exit and the tabs close. Wake opens them again, each agent on its conversation."
          : alone ? "It exits and its pane closes; the rest of the tab stays. Wake opens it again in that tab, on its conversation."
          : "Its agents exit and the tab closes. Wake opens it again, each agent on its conversation."))
        .when(this.sleepers === null, (el) => el.child(note("Reading")))
        .children(list.map((r, k) => v_flex().pt(14).gap(4)
          .when(whole, (el) => el.child(div().pb(3).text_size(11.5).text_color(t.dim).child(r.name)))
          .children(panesOf(r).map((q, j) => line(q, starts[k] + j)))))
        .when(this.sleepers !== null && !list.length, (el) => el.child(note("Nothing runs here to put to sleep.")))
        .when(others.length > 0, (el) => el.child(note(`${others.join(", ")} will stop now and start fresh on wake.`)))
        .when(Boolean(stop) && !this.error, (el) => el.child(note(`It can't sleep now: ${stop?.blocker || stop?.error}.`, t.blocked)))
        .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
        .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
        .child(h_flex().pt(18).gap(8).justify_end()
          .child(button("sl-back", "Cancel", false, !this.busy, () => closeOverlay(p.overlay)))
          .when(whole || Boolean(stop) || Boolean(this.error), (el) => el.child(button("sl-go", whole ? `Sleep ${list.length} ${list.length === 1 ? "tab" : "tabs"}` : "Sleep", true, ready, (cx) => this.sleep(cx)))));
    }

    const asleep = this.asleep ?? [];
    const groups = [...new Set(asleep.map((a) => a.from))].map((from) => [from, asleep.filter((a) => a.from === from)]);
    this.order = groups.flatMap(([, tabs]) => tabs);
    const atId = this.order[Math.min(this.at ?? 0, Math.max(0, this.order.length - 1))]?.id;
    const spaceName = (from, list) => spaces().find((sp) => projectOf(sp) === from)?.name ?? list[0]?.space ?? (base(folderOfKey(from)) || "~");
    const label = (text) => div().pt(12).pb(4).px(10).text_size(11.5).text_color(t.dim).child(text);
    const row = (a) => {
      const id = `${a.from}:${a.name}`, key = `forget:${id}`, armed = this.armed === key;
      return h_flex().id(`zz-${id}`).w_full().px(10).py(8).gap(10).items_center().rounded(7)
        .when(a.id === atId, (el) => el.bg(t.selected))
        .when(!this.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.wake(a, cx)))
        .child(svg("mods/kanso-chrome/icons/moon.svg").size(15).flex_none().text_color(t.muted))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().min_w(0).gap(8).items_baseline()
            .child(div().flex_shrink_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(a.name))
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`since ${since(a.saved)}`)))
          .child(div().truncate().text_size(11.5).text_color(t.dim).child(sleepers(a))))
        .when(!this.busy, (el) => el.child(div().id(`zz-wake-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(t.foreground)
          .hover((s) => s.opacity(0.8)).on_click((_e, cx) => { cx.stop_propagation(); this.wake(a, cx); }).child("Wake")))
        .when(!this.busy, (el) => el.child(div().id(`zz-rm-${id}`).flex_none().px(6).py(2).rounded(6).text_size(11.5).text_color(armed ? t.blocked : t.dim)
          .hover((s) => s.text_color(armed ? t.blocked : t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.arm(key, cx, (cx) => cx.spawn(async (cx) => { try { await this.store.forget(a.id); } catch (e) { this.error = String(e?.message ?? e); } await this.refresh(); cx.notify(); })); })
          .child(armed ? "Press again to forget it" : "Forget")));
    };
    return shell
      .child(head("Asleep", "Tabs put to sleep, each agent's conversation kept. Wake opens one again in its project."))
      // A column that never shrinks: past max_h 420 the list scrolls.
      .child(v_flex().id("zz-list").pt(10).max_h(420).overflow_y_scrollbar().child(v_flex().flex_none().w_full().gap(2)
        .when(this.asleep === null, (el) => el.child(div().py(8).text_size(12).text_color(t.dim).child("Reading")))
        .when(this.asleep !== null && !asleep.length, (el) => el.child(v_flex().py(6).gap(4)
          .child(div().text_size(13).text_color(t.muted).child("Nothing is asleep."))
          .child(div().text_size(11.5).line_height(1.45).text_color(t.dim).child("Put a tab you are waiting on to sleep: its agents stop holding memory, and wake on their conversations when you need them."))))
        .children(groups.map(([from, tabs]) => v_flex().gap(2)
          .child(h_flex().items_center().child(div().flex_1().child(label(spaceName(from, tabs))))
            .when(tabs.length > 1 && !this.busy, (el) => el.child(div().id(`zz-all-${from}`).px(10).pt(8).text_size(11.5).text_color(t.foreground).cursor_pointer()
              .hover((s) => s.opacity(0.8)).on_click((_e, cx) => this.wake(tabs[0], cx, tabs.slice(1))).child(`Wake all ${tabs.length}`))))
          .children(tabs.map(row))))))
      .when(Boolean(this.busy), (el) => el.child(note(this.busy, t.muted)))
      .when(Boolean(this.error), (el) => el.child(note(this.error, t.blocked)))
      .child(h_flex().pt(18).gap(8).justify_end()
        .child(button("zz-close", "Close", false, !this.busy, () => closeOverlay(p.overlay)))
        .child(button("zz-sleep", "Sleep this tab", true, !this.busy && Boolean(this.space), (cx) => this.startSleep(cx))));
  }
}

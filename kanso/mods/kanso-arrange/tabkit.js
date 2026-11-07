// Arrangements and Sleep, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// A tab as data, and a tab again from that data: what each pane runs and
// where, in the strip's columns and widths; and opening it as a new tab,
// pane by pane where the strip puts a split. kanso-arrange (arrangements)
// and kanso-sleep (tabs put to sleep) both use it, and the sidebar names
// a sleeping tab's programs with it; kanso-arrange/tabkit.js
// is the one you edit (`npm run sync:share` copies it, and a test fails
// when a copy differs).
import { spaces, panes, shared, setShared, run, home, hc } from "herdr";
import { retry, tryOr, findAsync, mapSeries, reduceSeries } from "./pure.js";

export const base = (s) => String(s ?? "").split("/").at(-1).replace(/^-/, "");
export const tilde = (cwd) => {
  if (!cwd) return "~";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
};
export const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : "'" + String(s).replaceAll("'", "'\\''") + "'");

// A program's arguments without the session it resumed, so opening an
// arrangement starts each agent fresh: Claude Code's --resume/-r <id>,
// --session-id <id>, --continue/-c; Codex's `resume <id>`.
export function cleanArgv(argv) {
  if (!Array.isArray(argv) || !argv.length) return null;
  const [cmd, ...rest] = argv.map(String);
  const name = base(cmd);
  const value = (i) => rest[i + 1] !== undefined && !rest[i + 1].startsWith("-");
  // `skip`: the argument is the id of the flag before it, left out with it.
  return rest.reduce(({ out, skip }, a, i) => {
    if (skip) return { out, skip: false };
    if (name === "claude") {
      if (a === "--resume" || a === "-r" || a === "--session-id") return { out, skip: value(i) };
      if (a.startsWith("--resume=") || a.startsWith("--session-id=") || a === "--continue" || a === "-c") return { out, skip: false };
    }
    if (name === "codex" && i === 0 && a === "resume") return { out, skip: value(i) };
    return { out: [...out, a], skip: false };
  }, { out: [cmd], skip: false }).out;
}

// What a terminal runs, from `hc get --json`: the program in the foreground
// with its arguments (one you started in its shell, or one the terminal was
// opened with), or null for a shell at its prompt.
export const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu", "pwsh", "elvish", "xonsh"]);
export function commandOf(rec) {
  const fg = rec?.foreground;
  if (!fg?.argv?.length || SHELLS.has(base(fg.argv[0]))) return null;
  return cleanArgv(fg.argv);
}

// The tab's panes as columns, in the strip's order, each pane with what it
// runs and where (`recs`: terminal address -> its `hc get` record; `extra`:
// terminal address -> more to keep with that pane).
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

// A project: the space's folder on its machine.
export const projectOf = (space) => `${space?.machine ?? ""}:${space?.folder || home()}`;
export const folderOfKey = (key) => String(key ?? "").slice(String(key ?? "").indexOf(":") + 1);

// A record's JSON as [value], or null when it is not JSON (a value of null
// is still told apart from a failed read).
const parsed = (g) => tryOr(() => [JSON.parse(g.stdout)]);
// Up to `times` looks at `ok()`, `ms` slept after each one that fails.
const waitFor = (cx, times, ms, ok) => retry(times, async () => {
  if (ok()) return true;
  await cx.sleep(ms);
  return false;
});

// A new pane, once Herdr has it (one not in `seen`) and the strip has put
// it in its place: the next split's "beside this one" needs that place.
// `resume`: the pane is the one running that conversation (its program's
// arguments name it): in a tab others open panes in too (another window's
// wake, one you opened), the next new pane is not taken for it.
export async function newPane(seen, cx, tab, resume = null) {
  const runs = async (q) => {
    const g = await hc(["get", q.terminal, "--json"]).catch(() => null);
    try { return (JSON.parse(g.stdout).foreground?.argv ?? []).map(String).includes(resume); } catch { return false; }
  };
  const p = await retry(resume ? 150 : 60, () => {
    const fresh = panes().filter((q) => !seen.has(q.pane) && q.terminal && (!tab || q.tab === tab));
    return findAsync(fresh, async (q) => !resume || (await runs(q)));
  }, { between: () => cx.sleep(100) });
  if (p) {
    await waitFor(cx, 20, 75, () => shared("strip.state")?.[p.tab]?.cols?.some((c) => c.panes?.includes(p.pane)));
    return p;
  }
  await cx.sleep(100);
  throw new Error("Herdr did not open the pane");
}

// One pane (`p`: { argv, cwd }) opened in tab `tabId`, to the right of the
// tab's last column, as a split there would place it. Returns its id; when
// Herdr is too slow to show it, the error's `pending` (1) says it was asked
// for and may still open.
export async function openInto(p, cx, tabId) {
  const cols = shared("strip.state")?.[tabId]?.cols ?? [];
  const inTab = panes().filter((q) => q.tab === tabId);
  const from = cols.at(-1)?.panes?.[0] ?? inTab.at(-1)?.pane;
  if (!from) throw new Error("its tab has no pane to open beside");
  const seen = new Set(panes().map((q) => q.pane));
  setShared("strip.intent", { dir: "right", from, at: Date.now() });
  run("pane.focus", { pane: from });
  run("terminal.open", { folder: p.cwd || undefined, ...(p.argv ? { argv: p.argv } : {}), place: "right" });
  try { return (await newPane(seen, cx, tabId, p.resume ?? null)).pane; }
  catch (e) { throw new OpenError(e, { pending: 1 }); }
}

// An opening that stopped: the error that stopped it (its message), what it
// did open (`opened`, the ids by column) and how many panes it asked Herdr
// for that never showed (`pending`).
export class OpenError extends Error {
  constructor(cause, { opened = [], pending = 0 } = {}) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "OpenError";
    this.opened = opened;
    this.pending = pending;
  }
}

// A tab `a` opened in `space`: a new tab with the first pane, then each
// other pane beside or under the one before it, as the strip places a
// split; then the columns' widths. `create` ({ name, folder, machine, key }):
// no space for it yet, so one is made, which starts with a shell tab in its
// folder that goes once the tab is open. `progress(text)` says how far it
// is. `before(p)` runs before each pane opens and may stop it (throwing):
// nothing opens that its caller no longer wants. Returns the panes' ids,
// column by column; throws when Herdr fails it, the error's `opened`
// holding the ids of the panes it did open (the same shape), so what
// already runs is not opened twice, and `pending` how many it asked Herdr
// for that never showed (they may still open: nothing is ended on a guess
// of which is which). The space and the tab it makes are
// found by a name no other opening has (then given theirs): what it closes
// on failure is only ever its own.
export const opening = (name) => `${name} (opening ${Math.random().toString(36).slice(2, 8)})`;
export async function openTab(a, cx, { space: given = null, create = null, progress = () => {}, before = async () => {} } = {}) {
  const flat = a.cols.flatMap((c, ci) => c.panes.map((p, ri) => ({ ...p, ci, ri })));
  if (!flat.length) throw new Error("nothing to open");
  const opts = (p) => ({ folder: p.cwd || undefined, ...(p.argv ? { argv: p.argv } : {}) });
  const fresh = !given && create ? await (async () => {
    const { key: _key, ...args } = create;
    const had = new Set(spaces().map((sp) => sp.id)), mine = opening(args.name);
    run("space.new", { ...args, name: mine });
    // The one just made, by the name only it has (a space another window
    // makes meanwhile, of any name, is never taken); its starter tab too:
    // it goes once the tab is open.
    const found = await retry(50, async () => {
      await cx.sleep(100);
      const sp = spaces().find((w) => !had.has(w.id) && w.name === mine) ?? null;
      return { space: sp, starter: sp?.tabs?.[0]?.id ?? null };
    }, { done: (v) => Boolean(v.starter) });
    if (!found.space) throw new Error("Herdr did not make the space");
    run("space.rename", { id: found.space.id, name: args.name });
    return found;
  })() : null;
  const space = given ?? fresh?.space ?? null;
  const starter = fresh?.starter ?? null, made = fresh?.space.id ?? null;
  if (!space) throw new Error("no space to open it in");
  progress(`Opening 1 of ${flat.length}`);
  // The new tab: by the name only it has; its first pane only from that
  // tab, never one opening elsewhere.
  const had = new Set((spaces().find((sp) => sp.id === space.id)?.tabs ?? []).map((t) => t.id)), mine = opening(a.name);
  const ours = () => (spaces().find((sp) => sp.id === space.id)?.tabs ?? []).filter((t) => !had.has(t.id) && t.name === mine);
  // The starter tab of a space it made goes only as it was made: one pane,
  // at its shell's prompt (one you started using meanwhile is yours); the
  // space itself only when nothing else is in it.
  const untouched = async (tabId) => {
    const ps = panes().filter((q) => q.tab === tabId);
    if (ps.length > 1) return false;
    const busy = await findAsync(ps, async (q) => {
      const got = parsed(await hc(["get", q.terminal, "--json"]).catch(() => null));
      if (!got) return true;
      const [x] = got;
      return Boolean(x.foreground?.pid && x.foreground.pid !== x.pid);
    });
    return !busy;
  };
  // A tab it made that came too late is its own only while it holds just
  // one pane, running what it was made to run (an agent: on its
  // conversation). Another pane in it, or one you opened in place of that
  // one, is yours: the tab stays.
  const alone = async (t) => {
    const ps = panes().filter((q) => q.tab === t.id);
    if (ps.length !== 1) return false;
    const g = await hc(["get", ps[0].terminal, "--json"]).catch(() => null);
    const got = tryOr(() => [JSON.parse(g.stdout).foreground]);
    if (!got) return false;
    const [fg] = got;
    const argv = (fg?.argv ?? []).map(String);
    return flat[0].resume ? argv.includes(flat[0].resume) : Boolean(flat[0].argv) && JSON.stringify(argv) === JSON.stringify(flat[0].argv.map(String));
  };
  const everyAlone = async (ts) => !(await findAsync(ts, async (t) => !(await alone(t))));
  const onlyStarter = async () => {
    const mine = ours();
    const rest = (spaces().find((w) => w.id === made)?.tabs ?? []).filter((t) => t.id !== starter && !mine.some((m) => m.id === t.id));
    return !rest.length && (await everyAlone(mine)) && (!starter || (await untouched(starter)));
  };
  // The opening as a run of steps, each from the state before it to the
  // state after it: the tab once found, the panes asked of Herdr so far
  // (`issued`) and the ids of those that showed, column by column. A step
  // that throws leaves the state as it found it, with the error; the steps
  // after it are skipped.
  const step = async (st, fn) => {
    if (st.failed) return st;
    try { return await fn(st); } catch (error) { return { ...st, failed: true, error }; }
  };
  const asked = await step({ tab: null, issued: 0, ids: [] }, async (st) => {
    await before(flat[0]);
    run("tab.new", { space: space.id, name: mine, ...opts(flat[0]) });
    return { ...st, issued: st.issued + 1 };
  });
  const found = await step(asked, async (st) => {
    const tab = await retry(60, async () => { await cx.sleep(100); return ours()[0] ?? null; });
    if (!tab) throw new Error("Herdr did not open the tab");
    return { ...st, tab };
  });
  const started = await step(found, async (st) => {
    run("tab.rename", { id: st.tab.id, name: a.name });
    const first = await newPane(new Set(), cx, st.tab.id, flat[0].resume ?? null);
    return { ...st, ids: [[first.pane]] };
  });
  const end = await reduceSeries(flat.slice(1), async (prev, p, i) => {
    const sent = await step(prev, async (st) => {
      progress(`Opening ${i + 2} of ${flat.length}`);
      await before(p);
      const dir = p.ri > 0 ? "down" : "right";
      const from = p.ri > 0 ? st.ids[p.ci][p.ri - 1] : st.ids[p.ci - 1][0];
      const seen = new Set(panes().map((q) => q.pane));
      setShared("strip.intent", { dir, from, at: Date.now() });
      run("pane.focus", { pane: from });
      run("terminal.open", { ...opts(p), place: dir });
      return { ...st, issued: st.issued + 1, seen };
    });
    return step(sent, async ({ seen, ...st }) => {
      const made = await newPane(seen, cx, st.tab.id, p.resume ?? null);
      // A pane joins its column (the one before it in a stack) or starts the next.
      const ids = p.ci < st.ids.length ? st.ids.with(p.ci, [...st.ids[p.ci], made.pane]) : [...st.ids, [made.pane]];
      return { ...st, ids };
    });
  }, started);
  if (end.failed) {
    // What this opening asked for and never got back may still open. Only
    // what is provably its own is closed: the space it made (nothing of it
    // opened), else the tab it made when that came too late to be found
    // (by the name only it has). A pane that shows late in its tab is not
    // told apart from one you opened there: it is left, and counted as
    // pending, for the caller to keep the agent from waking twice.
    await cx.sleep(3000);
    const left = end.issued - end.ids.flat().length;
    const closeLate = async () => {
      const late = ours();
      const keep = await mapSeries(late, alone);
      const gone = late.filter((_, k) => keep[k]);
      gone.forEach((t) => run("tab.close", { id: t.id, confirmed: true }));
      return late.length > 0 && gone.length === late.length;
    };
    const settle = async () => {
      if (made && !end.ids.length && (await onlyStarter())) { run("space.close", { id: made, confirmed: true }); return 0; }
      const cleared = end.tab ? false : await closeLate();
      if (starter && (await untouched(starter))) run("tab.close", { id: starter, confirmed: true });
      return cleared ? 0 : left;
    };
    const pending = await settle();
    throw new OpenError(end.error, { opened: end.ids, pending });
  }
  const ids = end.ids;
  await cx.sleep(150);
  setShared("strip.req", { op: "widths", per: a.per, cols: ids.map((col, ci) => ({ pane: col[0], w: a.cols[ci].w })), n: Date.now() + Math.random() });
  run("pane.focus", { pane: ids[0][0] });
  if (starter && (await untouched(starter))) run("tab.close", { id: starter, confirmed: true });
  return ids;
}

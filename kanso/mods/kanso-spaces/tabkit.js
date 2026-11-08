// Arrangements and Sleep, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Shared source: npm run sync:share copies it, and a test fails when a copy differs.
import { spaces, panes, shared, setShared, run, home, hc } from "herdr";
import { retry, tryOr, findAsync, mapSeries, reduceSeries } from "./pure.js";
import { sessionWords, base } from "./resume.js";

export { base };
export const tilde = (cwd) => {
  if (!cwd) return "~";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
};
export const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : "'" + String(s).replaceAll("'", "'\\''") + "'");

// Resume/session flags are dropped so an arrangement starts each agent fresh:
// Claude's are the ones Sleep and Memory replace when they resume it.
export function cleanArgv(argv) {
  if (!Array.isArray(argv) || !argv.length) return null;
  const [cmd, ...rest] = argv.map(String);
  const name = base(cmd);
  const value = (i) => rest[i + 1] !== undefined && !rest[i + 1].startsWith("-");
  // `skip`: the argument is the id of the flag before it, left out with it.
  return rest.reduce(({ out, skip }, a, i) => {
    if (skip) return { out, skip: false };
    const session = name === "claude" ? sessionWords(a, rest[i + 1]) : 0;
    if (session) return { out, skip: session === 2 };
    if (name === "codex" && i === 0 && a === "resume") return { out, skip: value(i) };
    return { out: [...out, a], skip: false };
  }, { out: [cmd], skip: false }).out;
}

export const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu", "pwsh", "elvish", "xonsh"]);
export function commandOf(rec) {
  const fg = rec?.foreground;
  if (!fg?.argv?.length || SHELLS.has(base(fg.argv[0]))) return null;
  return cleanArgv(fg.argv);
}

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

export const projectOf = (space) => `${space?.machine ?? ""}:${space?.folder || home()}`;
export const folderOfKey = (key) => String(key ?? "").slice(String(key ?? "").indexOf(":") + 1);

// [value] tells a JSON null apart from a failed read.
const parsed = (g) => tryOr(() => [JSON.parse(g.stdout)]);
const waitFor = (cx, times, ms, ok) => retry(times, async () => {
  if (ok()) return true;
  await cx.sleep(ms);
  return false;
});

// Waits for the strip to place the pane: the next split is positioned "beside this one".
// `resume` matches the pane by its conversation id, so a pane opened elsewhere is not taken.
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

// On a timeout, the error's `pending` says the pane was asked for and may still open.
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

export class OpenError extends Error {
  constructor(cause, { opened = [], pending = 0 } = {}) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "OpenError";
    this.opened = opened;
    this.pending = pending;
  }
}

export const opening = (name) => `${name} (opening ${Math.random().toString(36).slice(2, 8)})`;
export async function openTab(a, cx, { space: given = null, create = null, progress = () => {}, before = async () => {} } = {}) {
  const flat = a.cols.flatMap((c, ci) => c.panes.map((p, ri) => ({ ...p, ci, ri })));
  if (!flat.length) throw new Error("nothing to open");
  const opts = (p) => ({ folder: p.cwd || undefined, ...(p.argv ? { argv: p.argv } : {}) });
  const fresh = !given && create ? await (async () => {
    const { key: _key, ...args } = create;
    const had = new Set(spaces().map((sp) => sp.id)), mine = opening(args.name);
    run("space.new", { ...args, name: mine });
    // Matched by the temp name only it has, so another window's new space is never taken.
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
  // The new tab is matched by its unique temp name, never one opening elsewhere.
  const had = new Set((spaces().find((sp) => sp.id === space.id)?.tabs ?? []).map((t) => t.id)), mine = opening(a.name);
  const ours = () => (spaces().find((sp) => sp.id === space.id)?.tabs ?? []).filter((t) => !had.has(t.id) && t.name === mine);
  // The starter tab and its space are closed only while provably untouched, so your work is never closed.
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
  // A late tab is ours only while it holds just the pane it was made with; anything you add makes it yours.
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
      const ids = p.ci < st.ids.length ? st.ids.with(p.ci, [...st.ids[p.ci], made.pane]) : [...st.ids, [made.pane]];
      return { ...st, ids };
    });
  }, started);
  if (end.failed) {
    // Only what is provably ours is closed; a late pane can't be told from one you opened, so it stays, counted as pending.
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

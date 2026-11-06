// Arrangements and Sleep, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// A tab as data, and a tab again from that data: what each pane runs and
// where, in the strip's columns and widths; and opening it as a new tab,
// pane by pane where the strip puts a split. kanso-arrange (arrangements)
// and kanso-sleep (tabs put to sleep) both use it, and the sidebar names
// a sleeping tab's programs with it; kanso-arrange/tabkit.js
// is the one you edit (`npm run sync:share` copies it, and a test fails
// when a copy differs).
import { spaces, panes, terminals, shared, setShared, run, home } from "herdr";

export const base = (s) => String(s ?? "").split("/").pop().replace(/^-/, "");
export const tilde = (cwd) => {
  if (!cwd) return "~";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
};
export const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

// A program's arguments without the session it resumed, so opening an
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

// A new pane, once Herdr has it (one not in `seen`) and the strip has put
// it in its place: the next split's "beside this one" needs that place.
export async function newPane(seen, cx, tab) {
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

// One pane (`p`: { argv, cwd }) opened in tab `tabId`, to the right of the
// tab's last column, as a split there would place it. Returns its id.
export async function openInto(p, cx, tabId) {
  const cols = shared("strip.state")?.[tabId]?.cols ?? [];
  const inTab = panes().filter((q) => q.tab === tabId);
  const from = cols.at(-1)?.panes?.[0] ?? inTab.at(-1)?.pane;
  if (!from) throw new Error("its tab has no pane to open beside");
  const seen = new Set(panes().map((q) => q.pane));
  setShared("strip.intent", { dir: "right", from, at: Date.now() });
  run("pane.focus", { pane: from });
  run("terminal.open", { folder: p.cwd || undefined, ...(p.argv ? { argv: p.argv } : {}), place: "right" });
  return (await newPane(seen, cx, tabId)).pane;
}

// A tab `a` opened in `space`: a new tab with the first pane, then each
// other pane beside or under the one before it, as the strip places a
// split; then the columns' widths. `create` ({ name, folder, machine, key }):
// no space for it yet, so one is made, which starts with a shell tab in its
// folder that goes once the tab is open. `progress(text)` says how far it
// is. Returns the panes' ids, column by column; throws when Herdr fails it,
// the error's `opened` holding the ids of the panes it did open (the same
// shape), so what already runs is not opened twice.
export async function openTab(a, cx, { space = null, create = null, progress = () => {} } = {}) {
  const flat = a.cols.flatMap((c, ci) => c.panes.map((p, ri) => ({ ...p, ci, ri })));
  if (!flat.length) throw new Error("nothing to open");
  const opts = (p) => ({ folder: p.cwd || undefined, ...(p.argv ? { argv: p.argv } : {}) });
  let starter = null, made = null;
  if (!space && create) {
    const { key, ...args } = create;
    const had = new Set(spaces().map((sp) => sp.id));
    run("space.new", args);
    // Its starter tab too: it goes once the tab is open.
    for (let i = 0; i < 50 && !starter; i++) {
      await cx.sleep(100);
      space = spaces().find((sp) => !had.has(sp.id) && projectOf(sp) === key) ?? null;
      starter = space?.tabs?.[0]?.id ?? null;
    }
    if (!space) {
      // One made under another folder spelling (a link, say) is not left behind.
      for (const sp of spaces().filter((sp) => !had.has(sp.id) && sp.name === args.name)) run("space.close", { id: sp.id, confirmed: true });
      throw new Error("Herdr did not make the space");
    }
    made = space.id;
  }
  if (!space) throw new Error("no space to open it in");
  progress(`Opening 1 of ${flat.length}`);
  const ids = [];
  // The new tab: one this space did not have, with this name; its first
  // pane only from that tab, never one opening elsewhere.
  const before = new Set((spaces().find((sp) => sp.id === space.id)?.tabs ?? []).map((t) => t.id));
  const ours = () => (spaces().find((sp) => sp.id === space.id)?.tabs ?? []).filter((t) => !before.has(t.id) && t.name === a.name);
  let tab = null;
  try {
    run("tab.new", { space: space.id, name: a.name, ...opts(flat[0]) });
    for (let i = 0; i < 60 && !tab; i++) { await cx.sleep(100); tab = ours()[0] ?? null; }
    if (!tab) throw new Error("Herdr did not open the tab");
    const first = await newPane(new Set(), cx, tab.id);
    ids.push([first.pane]);
    for (let k = 1; k < flat.length; k++) {
      const p = flat[k];
      progress(`Opening ${k + 1} of ${flat.length}`);
      const dir = p.ri > 0 ? "down" : "right";
      const from = p.ri > 0 ? ids[p.ci][p.ri - 1] : ids[p.ci - 1][0];
      const seen = new Set(panes().map((q) => q.pane));
      setShared("strip.intent", { dir, from, at: Date.now() });
      run("pane.focus", { pane: from });
      run("terminal.open", { ...opts(p), place: dir });
      const made = await newPane(seen, cx, tab.id);
      (ids[p.ci] ??= []).push(made.pane);
    }
  } catch (e) {
    // What Herdr opens late, after it was given up on, is closed: a pane
    // in the tab that was never counted, or the tab itself when it came
    // too late to be found. So nothing runs that the caller doesn't know of.
    await cx.sleep(3000);
    // Only a pane running what was asked for and not yet opened: one you
    // opened in the tab meanwhile is not this opening's to end.
    const counted = new Set(ids.flat());
    const asked = new Set(flat.slice(ids.flat().length).filter((p) => p.argv).map((p) => JSON.stringify(p.argv)));
    const argvOf = new Map(terminals().map((t) => [t.address, JSON.stringify(t.argv ?? null)]));
    if (tab) {
      for (const q of panes().filter((q) => q.tab === tab.id && !counted.has(q.pane) && q.terminal && asked.has(argvOf.get(q.terminal)))) run("terminal.kill", { terminal: q.terminal });
    } else for (const t of ours()) run("tab.close", { id: t.id, confirmed: true });
    // A space made for it goes again when nothing of it opened; else only
    // its starter tab, as on success.
    if (made && !ids.length) run("space.close", { id: made, confirmed: true });
    else if (starter) run("tab.close", { id: starter, confirmed: true });
    const err = e instanceof Error ? e : new Error(String(e));
    err.opened = ids;
    throw err;
  }
  await cx.sleep(150);
  setShared("strip.req", { op: "widths", per: a.per, cols: ids.map((col, ci) => ({ pane: col[0], w: a.cols[ci].w })), n: Date.now() + Math.random() });
  run("pane.focus", { pane: ids[0][0] });
  if (starter) run("tab.close", { id: starter, confirmed: true });
  return ids;
}

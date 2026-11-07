// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// What sleeps, as the left nav keeps it (kdb.js, its one database): a tab
// put to sleep is a row of `sleeps` (every pane it opens again, the space it
// slept in by id) and each agent in it a row of `agents` whose status is
// asleep, still in its space and place. Sleep writes through this and the
// sidebar reads through it; shared "kanso.asleep" is only a copy of what it
// read, for the other windows to draw at once.
//
// A sleep holds its row (its token) until its agents have left; a wake
// claims it, one window at a time, and renews its hold while it works.
// Every change that needs the hold says whether it still had it.
import { exec, appHome } from "herdr";
import { programOf } from "./tabkit.js";
import { Kdb, STALE_MS, newId } from "./kdb.js";

export { STALE_MS };
const json = (text, fallback) => { try { return text == null ? fallback : JSON.parse(text); } catch { return fallback; } };
const agentsOf = (cols) => cols.flatMap((c) => c.panes).filter((p) => p.resume)
  .map((p) => ({ conversation: p.resume, given: p.given ?? null, cwd: p.cwd ?? null, tab: p.tab ?? null, pos: p.pos ?? null }));
const keptOf = (cols) => cols.flatMap((c) => c.panes).map((p) => p.resume).filter(Boolean);
const busyAt = (at, now) => Number(at) > now - STALE_MS;

// Rows as tabs: { id, from (its project), name, per, cols, saved, space (its
// name then), spaceId, into, agents (as the left nav keeps them), pending,
// waking (when each was last held) }, newest first.
export function rowsOf(rows) {
  return (rows ?? []).flatMap((r) => {
    const l = json(r.layout, null);
    if (!Array.isArray(l?.cols)) return [];
    return [{ id: r.id, from: r.project, name: r.name, per: l.per ?? null, cols: l.cols, saved: Number(r.saved) || 0, space: r.space_name ?? null, spaceId: r.space_id ?? null,
      into: json(r.into_tab, null), agents: r.agents ?? [], ...(r.pending || r.pending_at ? { pending: Number(r.pending_at) || 0 } : {}), ...(r.waking ? { waking: Number(r.waking_at) || 0 } : {}) }];
  }).toSorted((a, b) => b.saved - a.saved);
}
// Not going to sleep or waking right now, or that stopped half way so long
// ago (then it shows again, to be woken).
export const idle = (a, now = Date.now()) => !busyAt(a.pending, now) && !busyAt(a.waking, now);

// What the sidebar shows of a row: each pane that sleeps by the name it
// went by and the terminal it ran in, and each agent as the left nav keeps
// it (its conversation, name, title, space and place). `busy`: going to
// sleep or waking right now; `pending`: going to sleep.
export function shownOf(a, now = Date.now()) {
  const kept = new Map((a.agents ?? []).map((g) => [g.id, g]));
  return { id: a.id, from: a.from, name: a.name, saved: a.saved, space: a.space ?? null, spaceId: a.spaceId ?? null, into: a.into ?? null, busy: !idle(a, now), pending: busyAt(a.pending, now),
    agents: a.cols.flatMap((c) => c.panes).map((p) => {
      const g = p.resume ? kept.get(p.resume) : null;
      return { name: g?.name || p.name || programOf(p.argv), terminal: p.terminal ?? null, resume: p.resume ?? null,
        title: g?.title ?? null, said: g?.said ?? null, spaceId: g?.space_id ?? null, at: g?.pos ?? null, program: g?.program ?? null };
    }) };
}

// What an old file holds: `sql`'s rows; null when the file or its table is
// not there. Any other failure (a lock held too long, no permission) throws,
// so the migration waits for a read it can trust instead of passing it by.
// Absent only when the system says so ("No such file"); a folder that
// can't be looked into is an error, never taken for nothing there.
// (matched at the end of ls's message, after the path, which it can't fake)
const THERE = 'if [ -f "$1" ]; then echo file; elif out=$(LC_ALL=C ls -d "$1" 2>&1); then echo other; else case "$out" in *": No such file or directory") echo none;; *) echo "error: $out";; esac; fi';
async function legacyRows(file, table, sql) {
  const there = (await exec("sh", ["-c", THERE, "sh", file])).stdout?.trim() ?? "";
  if (there === "none") return null;
  if (there !== "file") throw new Error(`${file} could not be looked at: ${there || "no answer"}`);
  const read = async (text) => {
    const r = await exec("sqlite3", ["-readonly", "-cmd", ".timeout 5000", "-json", file, text]);
    if (r.code !== 0) throw new Error(`${file} could not be read: ${(r.stderr || "sqlite3 failed").trim().split("\n")[0]}`);
    return r.stdout.trim() ? JSON.parse(r.stdout) : [];
  };
  if (!(await read(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}';`)).length) return null;
  return read(sql);
}

// The old sleep.db's rows as this database takes them in: each tab with the
// space it slept in by name (its id is found once it fits one space), every
// pane, and each agent by its conversation. A row it can't read is left
// behind. An agent the old file had asleep twice stays only in the newest
// sleep (its pane leaves the older one, which goes when nothing is left), so
// waking either never runs it twice.
export function planMigration(rows) {
  const read = (rows ?? []).flatMap((r) => {
    const l = json(r.layout, null);
    return Array.isArray(l?.cols) ? [{ r, l }] : [];
  }).toSorted((x, y) => Number(y.r.saved) - Number(x.r.saved));
  // Each conversation taken as it is accepted (`taken`, carried from pane to
  // pane and tab to tab): twice in one tab is once too.
  const once = ({ panes, taken }, p) => {
    if (!p?.resume) return { panes: p ? [...panes, p] : panes, taken };
    if (taken.has(p.resume)) return { panes, taken };
    return { panes: [...panes, p], taken: new Set([...taken, p.resume]) };
  };
  return read.reduce(({ taken, out }, { r, l }) => {
    const seen = l.cols.reduce(({ cols, taken }, c) => {
      const kept = (c.panes ?? []).reduce(once, { panes: [], taken });
      return { cols: [...cols, { ...c, panes: kept.panes }], taken: kept.taken };
    }, { cols: [], taken });
    const cols = seen.cols.filter((c) => c.panes.length);
    if (!cols.length) return { taken: seen.taken, out };
    const agents = cols.flatMap((c) => c.panes).filter((p) => p.resume).map((p) => ({ conversation: p.resume, name: p.name ?? null, cwd: p.cwd ?? null }));
    return { taken: seen.taken, out: [...out, { id: l.id ?? newId(), name: r.name, project: r.project, space: l.space ?? null, into: l.into ?? null, saved: Number(r.saved) || 0,
      layout: { per: l.per ?? null, cols }, agents, pendingAt: l.pending ?? null, wakingAt: l.waking ? Number(String(l.waking).split(":")[0]) || null : null }] };
  }, { taken: new Set(), out: [] }).out;
}

export class Store {
  // `legacy`: the folder the old sleep.db and panel.db live under (data/).
  constructor(kdb = new Kdb(), legacy = `${appHome()}/data`) {
    this.kdb = kdb;
    this.legacy = legacy;
    this.ready = null;
    this.holds = new Map(); // sleep id -> this window's sleep token
  }

  open() {
    return (this.ready ??= (async () => {
      await this.kdb.open();
      if (await this.kdb.migrated()) return;
      // The old files, read as they are (left in place): what slept, and the sidebar's prefs.
      const sleeps = await legacyRows(`${this.legacy}/kanso-sleep/sleep.db`, "asleep", "SELECT project, name, layout, saved FROM asleep;");
      const prefs = await legacyRows(`${this.legacy}/kanso-spaces/panel.db`, "prefs", "SELECT key, value FROM prefs;");
      await this.kdb.migrate({ sleeps: planMigration(sleeps), prefs: prefs ?? [] });
    })().catch((e) => { this.ready = null; throw e; }));
  }

  // The tabs asleep (`all`: also those going to sleep or waking now).
  async asleep(all = false) {
    await this.open();
    const now = Date.now();
    return rowsOf(await this.kdb.sleeps()).filter((a) => all || idle(a, now));
  }
  // Written going to sleep: its id. `a.space`: the space ({ id, name }); each
  // pane its `tab` and `pos` when known. Throws when the name is taken.
  async sleep(project, a) {
    await this.open();
    const convs = (a.cols ?? []).flatMap((c) => c.panes).map((p) => p.resume).filter(Boolean);
    if (new Set(convs).size !== convs.length) throw new Error("two panes of it are on the same conversation; close one first");
    const { id, token } = await this.kdb.sleepTab({ name: a.name, space: a.space, project, layout: { per: a.per ?? null, cols: a.cols ?? [] }, into: a.into ?? null, agents: agentsOf(a.cols ?? []), saved: a.saved ?? Date.now() });
    this.holds.set(id, token);
    return id;
  }
  // This window's sleep still holds its row (and keeps it a while longer), or not.
  async holdSleep(id) { await this.open(); return this.holds.has(id) && this.kdb.holdSleep(id, this.holds.get(id)); }
  // This window's sleep is done (true), or another took the row meanwhile (false).
  async settle(id) { await this.open(); const ok = await this.kdb.settle(id, this.holds.get(id)); this.holds.delete(id); return ok; }
  async drop(id) { await this.open(); const ok = await this.kdb.drop(id, this.holds.get(id)); this.holds.delete(id); return ok; }
  // The panes kept (`cols`), under the wake's hold (`token`) or else this
  // window's sleep's, which it lets go; `space`: where it is now; `wait`:
  // not offered to wake for a while. False when the hold was lost.
  async narrow(id, cols, token = null, { space = null, wait = false, restores = [] } = {}) {
    await this.open();
    const [row] = await this.kdb.read(`SELECT layout FROM sleeps WHERE id='${String(id).replace(/'/g, "''")}';`);
    const layout = { ...json(row?.layout, {}), cols };
    const ok = await this.kdb.narrow(id, layout, keptOf(cols), token ? { wake: token } : { sleep: this.holds.get(id) }, { space, wait, restores });
    if (!token) this.holds.delete(id);
    return ok;
  }
  // The row as it is now with this wake's token, or null when another wake holds it or it is gone.
  async claim(id) {
    await this.open();
    const row = await this.kdb.claim(id);
    if (!row) return null;
    const [a] = rowsOf([{ ...row, agents: (await this.kdb.sleeps()).find((r) => r.id === id)?.agents ?? [] }]);
    return a ? { ...a, token: row.token } : null;
  }
  async renew(id, token) { await this.open(); return this.kdb.renew(id, token); }
  async release(id, token) { await this.open(); return this.kdb.release(id, token); }
  // `restores`: [conversation, name] a wake could not put back on a terminal, kept in the same write.
  async woke(id, token, restores = []) { await this.open(); return this.kdb.woke(id, token, restores); }
  async forget(id) { await this.open(); return this.kdb.forget(id); }
}

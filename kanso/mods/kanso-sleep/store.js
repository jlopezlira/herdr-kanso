// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Shared "kanso.asleep" is only a copy of the database, for the other windows to draw at once.
import { exec, appHome } from "herdr";
import { programOf } from "./tabkit.js";
import { Kdb, STALE_MS, newId } from "./kdb.js";

export { STALE_MS };
const json = (text, fallback) => { try { return text == null ? fallback : JSON.parse(text); } catch { return fallback; } };
const agentsOf = (cols) => cols.flatMap((c) => c.panes).filter((p) => p.resume)
  .map((p) => ({ conversation: p.resume, given: p.given ?? null, cwd: p.cwd ?? null, tab: p.tab ?? null, pos: p.pos ?? null }));
const keptOf = (cols) => cols.flatMap((c) => c.panes).map((p) => p.resume).filter(Boolean);
const busyAt = (at, now) => Number(at) > now - STALE_MS;

export function rowsOf(rows) {
  return (rows ?? []).flatMap((r) => {
    const l = json(r.layout, null);
    if (!Array.isArray(l?.cols)) return [];
    return [{ id: r.id, from: r.project, name: r.name, per: l.per ?? null, cols: l.cols, saved: Number(r.saved) || 0, space: r.space_name ?? null, spaceId: r.space_id ?? null,
      into: json(r.into_tab, null), agents: r.agents ?? [], ...(r.pending || r.pending_at ? { pending: Number(r.pending_at) || 0 } : {}), ...(r.waking ? { waking: Number(r.waking_at) || 0 } : {}) }];
  }).toSorted((a, b) => b.saved - a.saved);
}
// One that stopped half way shows again once its hold goes stale, to be woken.
export const idle = (a, now = Date.now()) => !busyAt(a.pending, now) && !busyAt(a.waking, now);

export function shownOf(a, now = Date.now()) {
  const kept = new Map((a.agents ?? []).map((g) => [g.id, g]));
  return { id: a.id, from: a.from, name: a.name, saved: a.saved, space: a.space ?? null, spaceId: a.spaceId ?? null, into: a.into ?? null, busy: !idle(a, now), pending: busyAt(a.pending, now),
    agents: a.cols.flatMap((c) => c.panes).map((p) => {
      const g = p.resume ? kept.get(p.resume) : null;
      return { name: g?.name || p.name || programOf(p.argv), terminal: p.terminal ?? null, resume: p.resume ?? null,
        title: g?.title ?? null, said: g?.said ?? null, spaceId: g?.space_id ?? null, at: g?.pos ?? null, program: g?.program ?? null };
    }) };
}

// Any other failure throws, so the migration waits for a read it can trust; "none" only when ls's message ends in ": No such file or directory", which a path can't fake.
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

// An agent the old file had asleep twice stays only in the newest sleep, so waking either never runs it twice.
export function planMigration(rows) {
  const read = (rows ?? []).flatMap((r) => {
    const l = json(r.layout, null);
    return Array.isArray(l?.cols) ? [{ r, l }] : [];
  }).toSorted((x, y) => Number(y.r.saved) - Number(x.r.saved));
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
      const sleeps = await legacyRows(`${this.legacy}/kanso-sleep/sleep.db`, "asleep", "SELECT project, name, layout, saved FROM asleep;");
      const prefs = await legacyRows(`${this.legacy}/kanso-spaces/panel.db`, "prefs", "SELECT key, value FROM prefs;");
      await this.kdb.migrate({ sleeps: planMigration(sleeps), prefs: prefs ?? [] });
    })().catch((e) => { this.ready = null; throw e; }));
  }

  async asleep(all = false) {
    await this.open();
    const now = Date.now();
    return rowsOf(await this.kdb.sleeps()).filter((a) => all || idle(a, now));
  }
  async sleep(project, a) {
    await this.open();
    const convs = (a.cols ?? []).flatMap((c) => c.panes).map((p) => p.resume).filter(Boolean);
    if (new Set(convs).size !== convs.length) throw new Error("two panes of it are on the same conversation; close one first");
    const { id, token } = await this.kdb.sleepTab({ name: a.name, space: a.space, project, layout: { per: a.per ?? null, cols: a.cols ?? [] }, into: a.into ?? null, agents: agentsOf(a.cols ?? []), saved: a.saved ?? Date.now() });
    this.holds.set(id, token);
    return id;
  }
  // False once another window took the row: then this one changes nothing more.
  async holdSleep(id) { await this.open(); return this.holds.has(id) && this.kdb.holdSleep(id, this.holds.get(id)); }
  async settle(id) { await this.open(); const ok = await this.kdb.settle(id, this.holds.get(id)); this.holds.delete(id); return ok; }
  async drop(id) { await this.open(); const ok = await this.kdb.drop(id, this.holds.get(id)); this.holds.delete(id); return ok; }
  // A sleep's own narrow lets its hold go; a wake's keeps it.
  async narrow(id, cols, token = null, { space = null, wait = false, restores = [] } = {}) {
    await this.open();
    const [row] = await this.kdb.read(`SELECT layout FROM sleeps WHERE id='${String(id).replace(/'/g, "''")}';`);
    const layout = { ...json(row?.layout, {}), cols };
    const ok = await this.kdb.narrow(id, layout, keptOf(cols), token ? { wake: token } : { sleep: this.holds.get(id) }, { space, wait, restores });
    if (!token) this.holds.delete(id);
    return ok;
  }
  // Null when another wake holds it or it is gone.
  async claim(id) {
    await this.open();
    const row = await this.kdb.claim(id);
    if (!row) return null;
    const [a] = rowsOf([{ ...row, agents: (await this.kdb.sleeps()).find((r) => r.id === id)?.agents ?? [] }]);
    return a ? { ...a, token: row.token } : null;
  }
  async renew(id, token) { await this.open(); return this.kdb.renew(id, token); }
  async release(id, token) { await this.open(); return this.kdb.release(id, token); }
  async woke(id, token, restores = []) { await this.open(); return this.kdb.woke(id, token, restores); }
  async forget(id) { await this.open(); return this.kdb.forget(id); }
}

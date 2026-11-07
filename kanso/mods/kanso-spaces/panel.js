// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// The sidebar's state, in the left nav's one database (kdb.js, through
// store.js, which also takes in what panel.db and sleep.db held before):
//   prefs   what you chose here: the view, each view's order, what is folded
//   agents  each agent by its conversation: the name you gave it, its
//           conversation's title and last message, its space and place
//           there, its status (asleep among them)
// Read once at start, then written as it changes. localStorage keeps a copy
// of the prefs only so the first frame after a start is already right (the
// database answers a moment later and is what counts).
import { Store } from "./store.js";
import { tryOr } from "./pure.js";

export const REFRESH_MS = 20_000; // an unchanged agent is seen again this often (gone after kdb's GONE_MS)
const FIELDS = ["given", "title", "said", "space", "tab", "pos", "program", "status", "terminal", "cwd"];
const same = (x, y) => Boolean(x && y) && FIELDS.every((f) => (x[f] ?? null) === (y[f] ?? null));

export class Panel {
  // `seed`: the prefs' keys, read from localStorage for the first frame.
  // `store`: the left nav's store (one per window, shared with what sleeps).
  constructor(seed = [], store = null) {
    this.store = store;
    // A key not there (or no localStorage at all) is left out.
    this.cache = new Map(seed.flatMap((k) => {
      const v = tryOr(() => localStorage.getItem(k));
      return v != null ? [[k, v]] : [];
    }));
    this.agents = new Map(); // conversation -> { name (given), title, said, space, pos, program }
    this.sent = new Map(); // conversation -> what was last written, and when
    this.chain = Promise.resolve();
  }

  get kdb() { return (this.store ??= new Store()).kdb; }

  // The database's state into memory (taking in the old files first, once).
  // True when a pref differs from the first frame's.
  async load() {
    await (this.store ??= new Store()).open();
    const [prefs, agents] = [await this.kdb.prefs(), await this.kdb.agents()];
    for (const r of agents) this.agents.set(r.id, { name: r.name, title: r.title, said: r.said, space: r.space_id, pos: r.pos, program: r.program, status: r.status, restore: r.restore, project: r.project ?? null });
    if (!prefs.length) {
      for (const [k, v] of this.cache) this.write(() => this.kdb.setPref(k, v));
      return false;
    }
    const changed = prefs.filter((r) => this.cache.get(r.key) !== r.value);
    for (const r of changed) { this.cache.set(r.key, r.value); this.mirror(r.key, r.value); }
    return changed.length > 0;
  }

  // Each write after the one before; a failed one is let be (the next try writes it).
  write(fn) { this.chain = this.chain.then(fn).catch(() => {}); return this.chain; }
  mirror(key, value) { try { localStorage.setItem(key, value); } catch { /* the database has it */ } }

  get(key) { return this.cache.get(key) ?? null; }
  // A JSON pref, when it is the same shape as `fallback`.
  json(key, fallback) {
    try {
      const v = JSON.parse(this.cache.get(key) ?? "null");
      return v !== null && typeof v === "object" && Array.isArray(v) === Array.isArray(fallback) ? v : fallback;
    } catch { return fallback; }
  }
  set(key, value) {
    const v = typeof value === "string" ? value : JSON.stringify(value);
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    this.mirror(key, v);
    this.write(() => this.kdb.setPref(key, v));
  }

  // What the sidebar saw of each agent (`seen`: records with their
  // `conversation`) at `at`, when it looked: those that changed, and every
  // one again each REFRESH_MS. That write also ends the ones no longer seen
  // (gone), so it runs each REFRESH_MS even when nobody is left to write.
  // The name you gave is what its terminal says (none: the automatic one).
  // Names a wake could not put back on their terminals, to put back now:
  // { terminal, conversation, name } for each agent seen without one.
  toRestore(seen) {
    return [...seen.values()].filter((a) => a.conversation && !a.given && this.agents.get(a.conversation)?.restore)
      .map((a) => ({ terminal: a.terminal, conversation: a.conversation, name: this.agents.get(a.conversation).restore }));
  }
  // Read again (what a wake in another window left to put back).
  async reloadAgents() {
    const rows = await this.kdb.agents(), ids = new Set(rows.map((r) => r.id));
    for (const r of rows) { const was = this.agents.get(r.id); this.agents.set(r.id, { ...was, restore: r.restore, name: was?.name ?? r.name, project: r.project ?? null }); }
    // One the database no longer lists has no project here either (cleared in another window).
    for (const [id, was] of [...this.agents]) if (!ids.has(id) && was?.project) this.agents.set(id, { ...was, project: null });
  }
  // An agent's project (kdb setProject), here at once and then written.
  setProject(id, project) {
    this.agents.set(id, { ...this.agents.get(id), project: project ?? null });
    return this.write(() => this.kdb.setProject(id, project ?? null));
  }
  remember(seen, at = Date.now()) {
    const list = [...seen.values()].filter((a) => a.conversation);
    const due = list.filter((a) => { const was = this.sent.get(a.conversation); return !was || !same(was.a, a) || at - was.at >= REFRESH_MS; });
    if (!due.length && at - (this.observedAt ?? 0) < REFRESH_MS) return this.chain;
    this.observedAt = at;
    for (const a of due) {
      this.sent.set(a.conversation, { a, at });
      const was = this.agents.get(a.conversation);
      const keep = !a.given && was?.restore;
      this.agents.set(a.conversation, { ...was, name: keep ? was.name : a.given ?? null, restore: a.given ? null : was?.restore ?? null, title: a.title ?? was?.title ?? null, said: a.said ?? was?.said ?? null, space: a.space, pos: a.pos, program: a.program, status: a.status });
    }
    return this.write(() => this.kdb.observe(due, at));
  }
}

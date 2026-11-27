import { spawnAndNotify, commandOk, tilde, pool, said } from "./lib.js";
import { sizedPage, heroStack, heroHeading } from "./ui-page.js";
import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
import { repositoryApi } from "./platform-repositories.js";
import { systemApi } from "./platform-system.js";
// Kanso's Worktrees panel, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Removing a worktree keeps its branch; only uncommitted changes and commits no branch, tag or remote holds can be lost.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, panes, home, run, theme, shared, notify } from "herdr";
import { explainWith, findExplainer } from "./explain.js";
import { Share, postText, shareRows } from "./share.js";
import { WorktreeStore } from "./worktrees-store.js";
import { inside, openIn } from "./worktrees-model.js";
import { R, T, G, OPACITY, tokens } from "./ui.js";
import { Armed, button, quietLink, iconButton } from "./ui-button.js";
import { row } from "./ui-row.js";
import { factList } from "./ui-facts.js";
import { section } from "./ui-section.js";
import { emptyState, explainButton, failureBlock, metric, skeletonOf, tooltip } from "./kit.js";
import { dot } from "./ui-dot.js";
import { aliasText, machineTitle, range, reduceSeries, MONTHS } from "./pure.js";
import { worktreesMemory } from "./panel-state.js";

const TEMP = ["/private/tmp", "/tmp"];

const absolute = (s) => typeof s === "string" && paths.isAbsolute(s);
const known = (temp) => Array.isArray(temp) && temp.length > 0 && temp.every(absolute);

export function rootsFor(folders, homeDir, chosen, temp) {
  if (Array.isArray(chosen) && chosen.some(absolute)) return [...new Set(chosen.filter(absolute))];
  if (!known(temp) || !absolute(homeDir)) return [];
  const roots = folders.flatMap((f) => {
    if (!absolute(f) || [...TEMP, ...temp].some((t) => inside(t, f))) return [];
    if (paths.within(f, homeDir)) {
      const top = paths.relative(homeDir, f).split(/[\\/]/)[0];
      return top && !top.startsWith(".") ? [paths.join(homeDir, top)] : [];
    }
    return f !== homeDir ? [f] : [];
  });
  return [...new Set(roots)];
}

// Prints `R <repo>` for each repository with linked worktrees, `O <folder>` for an orphaned `.git`.


export function parseDiscovery(out) {
  const lines = String(out).split("\n").map((line) => line.split("\t")).filter(([, path]) => path);
  return { repos: lines.filter(([kind]) => kind === "R").map(([, path]) => path), orphans: lines.filter(([kind]) => kind === "O").map(([, path]) => path) };
}

// The branches work lands in: the default one, plus develop or dev where used; origin's and the local one of each.


// The default branch's refs first (its name is the one shown), then develop's.
export function basesFrom(out) {
  const lines = [...new Set(String(out).split("\n").map((s) => s.trim()).filter(Boolean))];
  const main = lines.filter((l) => !l.startsWith("+")), extra = lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1));
  const pick = (refs) => { if (!refs.length) return []; const n = refs[0].replace(/^origin\//, ""); return refs.filter((r) => r === n || r === `origin/${n}`); };
  return [...new Set([...pick(main), ...pick(extra)])];
}

// From `git worktree list --porcelain -z`; the first worktree is the main one.
export function parseWorktrees(out) {
  const fields = String(out).split("\0").map((line) => {
    const sp = line.indexOf(" ");
    return { line, k: sp < 0 ? line : line.slice(0, sp), v: sp < 0 ? "" : line.slice(sp + 1) };
  });
  const starts = fields.flatMap((f, i) => (f.line && f.k === "worktree" ? [i] : []));
  return starts.map((at, n) => {
    const rest = fields.slice(at + 1, n + 1 < starts.length ? starts[n + 1] : fields.length);
    const blank = rest.findIndex((f) => !f.line);
    return (blank < 0 ? rest : rest.slice(0, blank)).reduce((w, { k, v }) => (
      k === "HEAD" ? { ...w, head: v }
        : k === "branch" ? { ...w, branch: v.replace(/^refs\/heads\//, "") }
          : k === "detached" || k === "bare" || k === "locked" || k === "prunable" ? { ...w, [k]: true }
            : w
    ), { path: fields[at].v, branch: null, head: null, detached: false, bare: false, locked: false, prunable: false, main: n === 0 });
  });
}

export function parseProbe(out) {
  const start = { gone: false, replaced: false, broken: false, dirty: 0, last: null, ahead: null, merged: false, recent: false, only: 0 };
  return String(out).split("\n").reduce((p, line) => {
    const [k, v] = line.split("\t");
    if (k === "gone" || k === "replaced" || k === "broken" || k === "merged" || k === "recent") return { ...p, [k]: true };
    if (k === "only" || k === "dirty") return { ...p, [k]: Number(v) || 0 };
    if (k === "last" && v) return { ...p, last: Number(v) * 1000 || null };
    if (k === "ahead" && v !== undefined && v !== "") return { ...p, ahead: Number(v) };
    return p;
  }, start);
}

export function parseProbeSet(out) {
  const lines = String(out).split(/\r?\n/);
  const refs = lines.find((line) => line.startsWith("refs\t"))?.slice(5) ?? "";
  const groups = lines.reduce((acc, line) => {
    if (/^#\d+$/.test(line)) return { records: [...acc.records, { index: Number(line.slice(1)), lines: [] }] };
    if (!acc.records.length || !line) return acc;
    const last = acc.records.at(-1);
    return { records: [...acc.records.slice(0, -1), { ...last, lines: [...last.lines, line] }] };
  }, { records: [] });
  return {
    refs,
    records: groups.records.map((record) => {
      if (record.lines.length === 1 && record.lines[0] === "same") return { index: record.index, same: true };
      const field = (name) => record.lines.find((line) => line.startsWith(name + "\t"))?.slice(name.length + 1) ?? "";
      const stamp = Number(field("stamp"));
      const index = Number(field("index"));
      const probe = parseProbe(record.lines.filter((line) => !line.startsWith("head\t") && !line.startsWith("stamp\t") && !line.startsWith("index\t")).join("\n"));
      return { index: record.index, same: false, probe, head: field("head"), stamp: Number.isFinite(stamp) ? stamp : null, indexTime: Number.isFinite(index) ? index : null };
    }),
  };
}

export function probeAsks(items, remembered, idle = "") {
  const kept = items.map((item) => remembered.get(item.path)).filter((row) => row?.refs);
  const wantRefs = kept.length && kept.every((row) => row.refs === kept[0].refs) ? kept[0].refs : "";
  return {
    wantRefs,
    items: items.map((item) => {
      const row = remembered.get(item.path);
      const reusable = Boolean(wantRefs && row?.refs === wantRefs && row.head === item.head && Number.isFinite(row.stamp) && Number.isFinite(row.index) && row.probe && String(row.idle) === String(idle));
      return { path: item.path, head: reusable ? item.head : "", stamp: reusable ? String(row.stamp) : "", index: reusable ? String(row.index) : "" };
    }),
  };
}

const foldersInUse = () => {
  const local = spaces().filter((s) => s.machine === null), tabs = new Set(local.flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
  return [...local.map((s) => s.folder), ...panes().filter((p) => tabs.has(p.tab)).map((p) => p.cwd)];
};

// The order of the checks decides the state.
export function stateOf(w) {
  if (w.orphan) return "orphan";
  if (w.missing) return "missing";
  if (w.open) return "open";
  if (w.locked) return "locked";
  if (!w.probed) return "checking";
  if (w.broken) return "broken";
  if (w.dirty > 0) return "changes";
  if (!w.branch && w.only > 0) return "lost";
  if (w.recent) return "recent";
  if (w.merged) return "merged";
  if (!w.branch) return "detached";
  return "unmerged";
}

// Clean up takes it: removing it loses nothing, and nothing is at work there.
export const safe = (w) => ["merged", "detached", "unmerged", "missing"].includes(stateOf(w));

// Remove all takes it, losses and all, on a second press; never one open in Herdr, locked, touched today or unchecked.
export const removable = (w) => !["open", "locked", "recent", "checking", "broken"].includes(stateOf(w));

// Would lose work, or can't be read until repaired.
export const needsLook = (w) => ["changes", "lost", "broken"].includes(stateOf(w));

const commits = (n) => `${n} ${n === 1 ? "commit" : "commits"}`;

export const branchLoss = (w) => `Loses branch ${w.branch}${w.ahead > 0 ? ` and its ${commits(w.ahead)} not merged` : ""}.`;

// Sizes in KB.
export function spaceBy(items, orphans = []) {
  const live = items.filter((w) => !w.missing), of = (test) => live.filter(test);
  const parts = [
    { key: "go", label: "Can go, losing nothing", list: of(safe) },
    { key: "look", label: "Need a look", list: of((w) => needsLook(w)) },
    { key: "use", label: "In use or open", list: of((w) => ["recent", "open", "locked"].includes(stateOf(w))) },
    { key: "left", label: "Left behind", list: orphans },
    { key: "checking", label: "Still checking", list: of((w) => stateOf(w) === "checking") },
  ];
  return parts.map(({ key, label, list }) => ({ key, label, count: list.length, kb: list.reduce((n, w) => n + (w.size ?? 0), 0) }))
    .filter((p) => p.count > 0);
}

export function losses(items) {
  const dirty = items.filter((w) => w.dirty > 0), lost = items.filter((w) => stateOf(w) === "lost"), orphans = items.filter((w) => w.orphan);
  const sum = (list, k) => list.reduce((n, w) => n + (w[k] ?? 0), 0);
  const parts = [
    ...(dirty.length ? [`${sum(dirty, "dirty")} uncommitted ${sum(dirty, "dirty") === 1 ? "change" : "changes"} in ${dirty.length}`] : []),
    ...(lost.length ? [`${sum(lost, "only")} ${sum(lost, "only") === 1 ? "commit" : "commits"} no branch has, in ${lost.length}`] : []),
    ...(orphans.length ? [`whatever is in ${orphans.length === 1 ? "a folder" : `${orphans.length} folders`} git no longer knows`] : []),
  ];
  return parts.length ? `Loses ${parts.join("; ")}.` : "Nothing is lost.";
}

export function consequence(w, base) {
  const s = stateOf(w);
  if (s === "orphan") return "The folder is deleted. Its repository moved or was deleted, so git cannot say what is in it.";
  if (s === "missing") return w.replaced
    ? "Its folder is now a repository of its own and stays as it is; only the old worktree record is removed."
    : "Its folder is already gone; only git's record of it is removed.";
  const lost = [
    ...(w.dirty > 0 ? [`${w.dirty} uncommitted ${w.dirty === 1 ? "change" : "changes"}`] : []),
    ...(!w.branch && w.only > 0 ? [`${w.only} ${w.only === 1 ? "commit" : "commits"} no branch has`] : []),
  ];
  const branch = !w.branch ? "" : w.merged ? ` Branch ${w.branch} goes too: its work is in ${base || "the default branch"}.`
    : ` Branch ${w.branch} stays${w.ahead > 0 ? ` with its ${commits(w.ahead)}` : ""}.`;
  return (lost.length ? `Loses ${lost.join(" and ")}.` : "Nothing is lost.") + branch;
}

const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function lastDays(byDay, now = Date.now(), n = 30) {
  const t = new Date(now);
  return range(n).map((k) => {
    const at = new Date(t.getFullYear(), t.getMonth(), t.getDate() - (n - 1 - k), 12, 0, 0, 0).getTime();
    const day = dayKey(at);
    return { day, at, kb: byDay?.[day] ?? 0 };
  });
}

const best = (byDay) => Object.entries(byDay ?? {}).reduce((b, [day, kb]) => (kb > (b?.kb ?? 0) ? { day, kb } : b), null);

export const shortDate = (ms) => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const splitSize = (kb) => { const [n, u] = fmtSize(kb).split(" "); return { big: n || "0", small: u || "KB" }; };

// The share card: totals only, never a repository, branch or path.
export function freedSpec(h, current, at = Date.now()) {
  const where = (current?.space ?? []).filter((p) => p.kb > 0);
  const freed = (h?.kb ?? 0) > 0, days = lastDays(freed ? h.freedByDay : h?.diskByDay, at);
  const size = splitSize(freed ? h.kb : current?.size ?? 0), top = best(freed ? h.freedByDay : h?.diskByDay);
  const stats = freed ? [
    ...cleanedStats(h),
  ] : [
    { value: String(current?.worktrees ?? 0), unit: "worktrees" },
    { value: fmtSize(current?.canGoSize) || "0 KB", unit: "can go, losing nothing" },
    { value: String(current?.look ?? 0), unit: "need a look" },
  ];
  return {
    title: "Worktrees",
    right: h?.since ? `since ${shortDate(h.since)}` : "",
    hero: { big: size.big, small: size.small, label: freed ? "of disk freed from worktrees agents left behind" : "of disk in git worktrees agents left behind" },
    stats,
    note: freed ? "Each one checked first: nothing uncommitted lost, every commit kept on a branch." : "Found and sized by kansō, before cleaning up.",
    blocks: [
      ...(days.some((d) => d.kb) ? [{
        kind: "bars", title: freed ? "Freed each day" : "On disk each day",
        right: top ? `${freed ? "best" : "most"}: ${fmtSize(top.kb)} on ${shortDate(new Date(`${top.day}T12:00:00`).getTime())}` : "",
        values: days.map((d) => d.kb), ticks: [shortDate(days[0].at), "Last 30 days", shortDate(days[days.length - 1].at)],
      }] : []),
      ...(where.length ? [{ kind: "list", title: "Where the space is now", rows: where.map((p) => {
        const [value, unit] = fmtSize(p.kb).split(" ");
        return { name: p.label, detail: `${p.count} ${p.count === 1 ? "folder" : "folders"}`, value, unit };
      }) }] : []),
    ],
  };
}

export function freedText(h, current) {
  const parts = (h?.kb ?? 0) > 0 ? [
    `Freed ${fmtSize(h.kb)} of disk from ${h.worktrees} git ${h.worktrees === 1 ? "worktree" : "worktrees"} my AI agents left behind`,
    ...(h.branches ? [`${h.branches} ${h.branches === 1 ? "branch" : "branches"} deleted`] : []),
  ] : current?.size ? [`My AI agents left ${fmtSize(current.size)} of disk in ${current.worktrees} git worktrees`] : [];
  return postText(parts, "Cleaning up after my AI agents.");
}

export function explainPrompt(w, base) {
  if (w.orphan) return `This folder was a git worktree whose repository moved or was deleted, so git no longer knows it. Explain what it holds: read its files, and if you can find the repository it came from (its .git file names the old location), compare them. End with a verdict: safe to delete, or what would be lost and how to keep it. Do not change, move or delete anything.`;
  const head = w.branch ? `on branch ${w.branch}` : "with a detached HEAD";
  const b = base || "the default branch";
  const byBranch = w.branch ? ", gh pr list --state all --head " + w.branch : "";
  return `This folder is a git worktree of ${w.repo}, ${head}. Explain what work it holds and whether it can be removed. Look at its uncommitted changes (git status, git diff), the commits not in ${b} (git log ${b}..HEAD), and whether that work exists anywhere else: another branch, a remote, or a pull request (gh pr list --state all --search <commit>${byBranch}). End with a verdict: safe to remove, or exactly what would be lost and how to keep it (commit, push, open a pull request). Do not change, commit, push or delete anything.`;
}

export function reviewPrompt(items, baseOf) {
  const lines = items.slice(0, 40).map((w) => `- ${w.path} (${w.repo ? `worktree of ${w.repo}, ${w.branch ? `branch ${w.branch}` : "detached HEAD"}, ` : ""}${w.dirty > 0 ? `${w.dirty} uncommitted changes` : `${w.only} commits no branch has`}${baseOf(w) ? `, compared with ${baseOf(w)}` : ""})`);
  return `These git worktrees would lose work if removed:\n${lines.join("\n")}${items.length > 40 ? `\n(and ${items.length - 40} more)` : ""}\n\nFor each one, find out what that work is and whether it already exists elsewhere: merged or squash-merged into the base branch, on another branch or remote, or in a pull request (use git and gh). Then give me a table: worktree, what it holds, where else it exists, and your recommendation (remove, or keep and why). For the ones safe to remove, end with the exact git worktree remove commands. Do not change, commit, push or delete anything yourself.`;
}

export function fmtSize(kb) {
  if (!kb) return "";
  if (kb >= 1048576) return `${(kb / 1048576).toFixed(1)} GB`;
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`;
  return `${kb} KB`;
}

export function fmtAge(ms, now = Date.now()) {
  if (!ms) return "";
  const d = Math.max(0, now - ms) / 86400000;
  if (d < 1) return "today";
  if (d < 14) return `${Math.floor(d)}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

const ORDER = { merged: 0, detached: 1, unmerged: 2, recent: 3, broken: 4, lost: 5, changes: 6, locked: 7, open: 8, checking: 9 };

// Drawn only until you ask for more, so a frame stays quick.
const REPOS = 8, ROWS = 4;

const name = (p) => paths.basename(p) || p;

// Rows are values, keyed by path: an action that runs later re-reads the row as it is then.
const keyOf = (w) => (typeof w === "string" ? w : w?.path);

// Returns `list` itself when nothing changed, so a redraw that changes nothing builds nothing new.
const mapSame = (list, change) => {
  const out = list.map(change);
  return out.every((x, i) => x === list[i]) ? list : out;
};

const mapGroups = (groups, change) => mapSame(groups, (g) => {
  const items = mapSame(g.items, change);
  return items === g.items ? g : { ...g, items };
});

// `replaced`: a repository of its own now lives in that folder, so only the record goes.
const withProbe = (w, p) => ({
  ...w, dirty: p.dirty, last: p.last, ahead: p.ahead, merged: p.merged, recent: p.recent, only: p.only, broken: p.broken, probed: true, fresh: true,
  ...(p.gone || p.replaced ? { missing: true } : {}), ...(p.replaced ? { replaced: true } : {}),
});

const idleMinutes = () => {
  const hours = shared("kanso.worktrees.idleHours");
  return String(Math.round((typeof hours === "number" && hours >= 0 ? hours : 24) * 60));
};

// Exists only while shown (mounted on demand).
export class Worktrees {
  constructor() { this.armed = new Armed(); } // removals ask for a second press

  saveState() { return worktreesMemory({ picked: this.picked, more: [...this.more], allRepos: this.allRepos }); }

  restoreState(state) {
    const next = worktreesMemory(state);
    if (!next) return false;
    this.keptTrees = next;
    return true;
  }

  init(cx) {
    this.groups = []; this.orphans = []; this.scan = 0; this.more = new Set(this.keptTrees?.more ?? []); this.allRepos = this.keptTrees?.allRepos ?? false;
    this.picked = null; this.heldPick = this.keptTrees ? this.keptTrees.picked : undefined;
    this.working = null; this.batch = null; this.phase = null; this.note = null; this.notice = null;
    this.width = 368; this.done = false;
    this.share = new Share("kanso-panel");
    this.store = new WorktreeStore(); this.stored = false; this.known = new Map(); this.stamps = new Map(); this.reused = new Set(); this.hist = null;
    // The one agent Explain names and starts: the first installed, looked up once.
    this.explainer = null;
    cx.spawn(async (cx) => {
      this.explainer = await findExplainer();
      cx.notify();
    });
    // What the last scan kept shows at once; the scan then checks it all again.
    cx.spawn(async (cx) => {
      try {
        await this.store.open();
        const items = await this.store.live();
        this.known = new Map(items.map((w) => [w.path, w.size]));
        this.stamps = await this.store.stamps();
        if (!this.groups.length && !this.orphans.length) this.show(items);
        this.hist = await this.store.history();
        this.stored = true;
      } catch (e) { this.storeNote = said("Can't read the history", e?.message ?? e); }
      finally { this.refresh(cx); }
    });
  }

  show(items) {
    this.groups = [...Map.groupBy(items.filter((w) => !w.orphan), (w) => w.repo)].map(([repo, list]) => ({ repo, base: "", bases: [], items: list }));
    this.orphans = items.filter((w) => w.orphan);
  }

  item(path) {
    return this.groups.flatMap((g) => g.items).find((w) => w.path === path) ?? this.orphans.find((w) => w.path === path) ?? null;
  }

  // Reads the lists and assigns them once with no wait in between, so probes landing in any order never undo each other.
  update(path, change) {
    const one = (w) => (w.path === path ? change(w) : w);
    this.groups = mapGroups(this.groups, one);
    this.orphans = mapSame(this.orphans, one);
  }

  async keep(repos, search) {
    if (!this.stored) return;
    const all = [...this.groups.flatMap((g) => g.items), ...this.orphans];
    await this.store.save(all);
    await this.store.saveStamps(this.stamps);
    const covered = (p) => search.some((root) => inside(root, p));
    await this.store.sweep(new Set(all.map((w) => w.path)), { has: (repo) => repos.has(repo) || covered(repo) });
    const live = all.filter((w) => !w.missing && !w.orphan), plan = this.plan();
    await this.store.recordScan({
      worktrees: live.length, size: [...live, ...this.orphans].reduce((n, w) => n + (w.size ?? 0), 0),
      canGo: plan.length, canGoSize: plan.reduce((n, w) => n + (w.size ?? 0), 0),
      look: live.filter((w) => needsLook(w)).length,
      missing: all.filter((w) => w.missing).length, orphans: this.orphans.length, repos: this.groups.length,
    });
    this.hist = await this.store.history();
  }

  async credit(pairs) {
    if (!this.stored) return;
    try {
      for (const [w, got] of pairs) await this.store.removed(w, got);
      this.hist = await this.store.history();
    } catch (e) { this.note = said("The history could not be saved", e?.message ?? e); }
  }

  // A scan or a batch changes many rows a second: draw at most four times a second.
  soon(cx) {
    if (!cx.timer) { cx.notify(); return; }
    if (this.pending) return;
    this.pending = cx.timer.after(250, (cx) => { this.pending = null; cx.notify(); });
  }

  roots() {
    const chosen = shared("kanso.worktrees.roots"), temp = this.tempDirs, roots = rootsFor(foldersInUse(), home(), chosen, temp);
    return { roots, search: roots.length && Array.isArray(chosen) && chosen.length ? roots : [...roots, ...(known(temp) ? temp : [])] };
  }

  // Runs on every draw, so only a row whose answer changed is replaced.
  markOpen() {
    const used = foldersInUse().filter(Boolean), seen = used.join("\0");
    if (seen === this.marked?.seen && this.groups === this.marked.groups && this.orphans === this.marked.orphans) return;
    const opened = openIn(used);
    const mark = (w) => { const open = opened(w.path); return w.open === open ? w : { ...w, open }; };
    this.groups = mapGroups(this.groups, mark);
    this.orphans = mapSame(this.orphans, mark);
    this.marked = { seen, groups: this.groups, orphans: this.orphans };
  }

  refresh(cx) {
    const id = this.scan + 1;
    this.scan = id;
    this.phase = "Finding repositories"; this.note = null; this.picked = this.heldPick === undefined ? null : this.heldPick; this.heldPick = undefined; this.armed.clear(); this.done = false;
    spawnAndNotify(cx, async (cx) => {
      this.tempDirs = await localService(systemApi).temporary().catch(() => null);
      const { roots, search } = this.roots();
      try {
        const found = await localService(repositoryApi).discover(search);
        if (id !== this.scan) return;
        const { repos, orphans } = parseDiscovery(found.stdout);
        this.phase = `Reading ${repos.length} repositories`;
        const read = await pool(repos, 6, async (repo) => {
          const [list, bases] = await Promise.all([
            exec("git", ["worktree", "list", "--porcelain", "-z"], { cwd: repo }),
            localService(repositoryApi).bases(repo),
          ]);
          if (id !== this.scan || list.code !== 0) return null;
          const all = parseWorktrees(list.stdout), b = basesFrom(bases.stdout);
          const items = all.filter((w) => !w.main && !w.bare).map((w) => ({ ...w, repo, missing: w.prunable, probed: false, fresh: w.prunable, size: w.prunable ? null : this.known.get(w.path) ?? null }));
          return items.length ? { repo, base: b.length ? b[0].replace(/^origin\//, "") : "", bases: b, items } : null;
        });
        if (id !== this.scan) return;
        const groups = read.filter(Boolean).toSorted((a, b) => b.items.length - a.items.length || a.repo.localeCompare(b.repo));
        this.groups = groups;
        this.orphans = orphans.filter((o) => !roots.includes(o) && o !== home()).map((path) => ({ path, orphan: true, fresh: true, size: this.known.get(path) ?? null }));
        this.markOpen();
        cx.notify();
        // What each one holds, then what each one weighs: the list is usable before the sizes are in.
        const idle = idleMinutes();
        const live = groups.flatMap((g) => g.items.filter((w) => !w.missing));
        this.counted = 0;
        this.reused = new Set();
        await pool(groups, 4, async (group) => {
          const rows = group.items.filter((w) => !w.missing);
          if (!rows.length || id !== this.scan) return;
          const ask = probeAsks(rows, this.stamps, idle);
          const r = await localService(repositoryApi).probeAll(group.repo, ask.items, idle, group.bases, ask.wantRefs);
          if (id !== this.scan) return;
          const parsed = parseProbeSet(r.stdout);
          rows.forEach((item, index) => {
            const record = parsed.records.find((row) => row.index === index);
            const kept = this.stamps.get(item.path);
            if (record?.same && kept?.probe) {
              this.apply(item.path, kept.probe);
              this.reused.add(item.path);
              if (parsed.refs) this.stamps.set(item.path, { ...kept, refs: parsed.refs, idle: String(idle) });
            } else if (record && !record.same) {
              this.apply(item.path, record.probe);
              if (record.head && record.stamp && record.indexTime && parsed.refs) this.stamps.set(item.path, { head: record.head, stamp: record.stamp, index: record.indexTime, refs: parsed.refs, idle: String(idle), probe: record.probe });
            }
          });
          this.counted = this.counted + rows.length;
          this.phase = `Checking ${this.counted} of ${live.length}`;
          this.soon(cx);
        });
        if (id !== this.scan) return;
        const sized = [...groups.flatMap((group) => group.items).map((item) => this.item(item.path)).filter((item) => item && !item.missing && !(this.reused.has(item.path) && this.known.get(item.path) != null)), ...this.orphans].map((item) => item.path);
        this.counted = 0;
        await pool(sized, 4, async (path) => {
          const measured = await localService(fileApi).size(path);
          if (id !== this.scan) return;
          const size = Number.isFinite(measured) ? measured : 0;
          this.update(path, (w) => ({ ...w, size }));
          this.counted = this.counted + 1;
          this.phase = `Measuring ${this.counted} of ${sized.length}`;
          this.soon(cx);
        });
        if (id !== this.scan) return;
        this.phase = "Saving";
        try { await this.keep(new Set(repos), search); } catch (e) { this.note = said("The history could not be saved", e?.message ?? e); }
        if (id !== this.scan) return;
        this.phase = null; this.done = true; this.scannedAt = Date.now();
      } catch (e) {
        if (id === this.scan) { this.phase = null; this.note = said("Can't scan for worktrees", e?.message ?? e); }
      } finally { if (id === this.scan) cx.notify(); }
    });
  }

  apply(path, p) {
    this.update(path, (w) => withProbe(w, p));
  }

  // git worktree repair rewrites the .git file of a worktree whose repository moved.
  repair(target, cx) {
    const w = this.item(keyOf(target));
    if (this.working || !w) return;
    this.working = w.path; this.note = null;
    spawnAndNotify(cx, async (cx) => {
      try {
        const r = await exec("git", ["worktree", "repair", w.path], { cwd: w.repo });
        commandOk(r);
        const p = await this.probeWorktree(w);
        this.apply(w.path, p);
        if (p.broken) throw new Error("git still can't read it");
        notify({ title: `Repaired ${name(w.path)}`, body: "It is linked to its repository again.", level: "success" });
      } catch (e) { this.note = said(`Can't repair ${name(w.path)}`, e?.message ?? e); }
      finally { this.finishWork(cx); }
    });
  }

  async removeOne(w, withBranch = false) {
    if (w.orphan) {
      // Checked again right before deleting: if it is a worktree again, the script exits instead.
      const r = await localService(repositoryApi).removeOrphan(w.path).catch((error) => ({ code: 1, stderr: String(error) }));
      if (r.code !== 0) throw new Error(r.code === 4 || r.code === 5 ? "It is a worktree again; refresh" : (r.stderr || "Cannot delete it").trim());
      return { kb: w.size ?? 0, orphans: 1 };
    }
    if (w.replaced) {
      // git worktree remove refuses it and prune keeps it, so only the record is removed; the folder is not touched.
      const r = await localService(repositoryApi).forget(w.repo, w.path);
      if (r.code !== 0 || !r.stdout.includes("forgot")) throw new Error(r.code === 4 ? "It is a worktree again; refresh" : (r.stderr || "No record of it was found").trim());
      return { records: 1 };
    }
    const git = (args) => exec("git", args, { cwd: w.repo });
    if (withBranch) {
      const head = await exec("git", ["rev-parse", "HEAD", "--symbolic-full-name", "HEAD"], { cwd: w.path });
      if (head.code !== 0 || head.stdout.trim() !== `${w.head}\nrefs/heads/${w.branch}`) throw new Error(`Branch ${w.branch} changed since the scan; scan again`);
    }
    if (!w.missing) {
      const r = await git(["worktree", "remove", ...(w.dirty > 0 ? ["--force"] : []), w.path]);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
    }
    const gone = (w.merged || withBranch) && w.branch ? await git(["branch", "-D", w.branch]) : null, branch = gone?.code === 0;
    await git(["worktree", "prune"]);
    const kept = withBranch && !branch ? { branchStays: (gone?.stderr || gone?.stdout || "").trim() } : {};
    return w.missing ? { records: 1 } : { kb: w.size ?? 0, worktrees: 1, branches: branch ? 1 : 0, ...kept };
  }

  drop(w) {
    if (w.orphan) this.orphans = this.orphans.filter((o) => o.path !== w.path);
    this.groups = this.groups.map((g) => ({ ...g, items: g.items.filter((x) => x.path !== w.path) })).filter((g) => g.items.length);
  }

  // Checks the row again right before it goes; null when `ok` no longer holds or the row is gone.
  async still(path, ok) {
    const w = this.item(path);
    if (!w) return null;
    if (w.orphan) return w; // removeOne checks a left-behind folder itself
    if (w.missing) {
      const exists = await localService(fileApi).test(w.replaced ? paths.join(w.path, ".git") : w.path, w.replaced ? "directory" : "any");
      const r = { code: (w.replaced ? exists : !exists) ? 0 : 1 };
      return r.code === 0 ? this.item(path) : null;
    }
    const p = await this.probeWorktree(w);
    this.apply(path, p);
    this.markOpen();
    const now = this.item(path);
    return now && ok(now) ? now : null;
  }

  remove(target, cx, withBranch = false) {
    this.markOpen();
    const w = this.item(keyOf(target));
    if (!w || w.open || w.locked || this.working || !w.fresh) return;
    this.working = w.path; this.armed.clear(); this.note = null; this.notice = null;
    const before = { dirty: w.dirty ?? 0, only: w.only ?? 0, ahead: w.ahead ?? 0, branch: w.branch };
    spawnAndNotify(cx, async (cx) => {
      try {
        const now = await this.still(w.path, (x) => removable(x) && (x.dirty ?? 0) <= before.dirty && (x.only ?? 0) <= before.only
          && (!withBranch || (x.branch === before.branch && (x.ahead ?? 0) <= before.ahead)));
        if (!now) {
          this.notice = `${name(w.path)} changed since you looked, so it stays. Its row shows it as it is now.`;
          return;
        }
        const got = await this.removeOne(now, withBranch);
        this.drop(now); await this.credit([[now, got]]);
        if (got.branchStays !== undefined) this.note ??= said(`Branch ${now.branch} stays`, got.branchStays || "Git did not delete it");
        if (got.kb) notify({ title: `Freed ${fmtSize(got.kb)}`, body: this.hist?.kb ? `${fmtSize(this.hist.kb)} freed so far` : undefined, level: "success" });
      } catch (e) { this.note = said(`Can't remove ${name(w.path)}`, e.message ?? e); }
      finally { this.finishWork(cx); }
    });
  }

  prune(targets, cx) {
    const missing = targets.map((t) => this.item(keyOf(t))).filter(Boolean);
    if (!missing.length || this.working) return;
    this.working = missing[0].repo; this.note = null;
    spawnAndNotify(cx, async (cx) => {
      try {
        for (const w of missing.filter((w) => w.replaced)) await this.removeOne(w);
        const plain = missing.find((w) => !w.replaced);
        if (plain) await this.removeOne(plain);
        for (const w of missing) this.drop(w);
        await this.credit(missing.map((w) => [w, { records: 1 }]));
      }
      catch (e) { this.note = said(`Can't prune ${name(missing[0].repo)}`, e.message ?? e); }
      finally { this.finishWork(cx); }
    });
  }

  finishWork(cx) { this.working = null; cx.notify(); }

  plan() {
    return this.groups.flatMap((g) => g.items.filter(safe));
  }

  cleanUp(cx) {
    this.markOpen();
    this.removeAll(this.plan(), cx, safe);
  }

  // One at a time, each checked again right before it goes; `batch` holds the paths still to go.
  removeAll(targets, cx, ok = removable) {
    const paths = targets.map(keyOf);
    if (!paths.length || this.working) return;
    this.working = "all"; this.batch = new Set(paths); this.armed.clear(); this.note = null; this.notice = null;
    spawnAndNotify(cx, async (cx) => {
      // `pruned`: repositories already pruned; their other missing rows go with it.
      const { done, kept, failed, got } = await reduceSeries(paths, async (t, path) => {
        this.phase = `Removing ${t.done + t.kept + t.failed.length + 1} of ${paths.length}`;
        this.soon(cx);
        try {
          const w = await this.still(path, ok);
          if (!w) {
            this.batch = new Set([...this.batch].filter((x) => x !== path));
            return { ...t, kept: t.kept + 1 };
          }
          if (w.missing && !w.replaced && t.pruned.has(w.repo)) { this.drop(w); return { ...t, done: t.done + 1, got: [...t.got, [w, { records: 1 }]] }; }
          const removed = await this.removeOne(w);
          const pruned = w.missing && !w.replaced ? new Set([...t.pruned, w.repo]) : t.pruned;
          this.drop(w);
          return { ...t, done: t.done + 1, got: [...t.got, [w, removed]], pruned };
        } catch (e) { return { ...t, failed: [...t.failed, `${name(path)}: ${String(e.message ?? e)}`] }; }
      }, { done: 0, kept: 0, failed: [], got: [], pruned: new Set() });
      await this.credit(got);
      this.phase = null; this.working = null; this.batch = null;
      if (failed.length) this.note = said(`${failed.length} not removed`, failed[0]);
      if (kept) this.notice = `${kept} ${kept === 1 ? "stays: it" : "stay: they"} changed since the scan (new work, in use, or git can no longer read ${kept === 1 ? "it" : "them"}). ${kept === 1 ? "Its row shows" : "Their rows show"} what changed.`;
      const kb = got.reduce((n, [, e]) => n + (e.kb ?? 0), 0), total = this.hist?.kb ?? 0;
      notify({ title: kb ? `Freed ${fmtSize(kb)}` : `Removed ${done} ${done === 1 ? "worktree" : "worktrees"}`,
        body: `${done} removed${total ? `, ${fmtSize(total)} freed so far` : ""}`, level: failed.length ? "warning" : "success" });
      cx.notify();
    });
  }

  verdict(w) {
    const s = stateOf(w), n = (k, one, many) => `${w[k]} ${w[k] === 1 ? one : many}`;
    return {
      checking: { text: "Checking", tone: "dim" },
      missing: { text: "Folder gone", tone: "dim" },
      orphan: { text: "Its repository moved or was deleted", tone: "dim" },
      open: { text: "Open in Herdr", tone: "working" },
      locked: { text: "Locked", tone: "dim" },
      changes: { text: n("dirty", "uncommitted change", "uncommitted changes"), tone: "blocked" },
      lost: { text: `${n("only", "commit", "commits")} only here`, tone: "blocked" },
      broken: { text: "Its repository moved: repair the link", tone: "working" },
      recent: { text: "In use today", tone: "working" },
      merged: { text: "Merged", tone: "done" },
      detached: { text: "Detached, its commits are on branches", tone: "done" },
      unmerged: { text: w.ahead > 0 ? `Not merged, ${n("ahead", "commit", "commits")} stay on its branch` : "Not merged, stays on its branch", tone: "done" },
    }[s];
  }

  header(c, narrow) {
    const scanning = Boolean(this.phase) && this.working !== "all";
    return h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().truncate().text_size(narrow ? 17 : 20).text_color(c.text).child("Worktrees"))
      .child(h_flex().gap(G.xs).items_center().flex_none()
        .when(Boolean(this.phase), (el) => el.child(div().pr(G.xs).text_size(T.micro).text_color(c.dim).child(this.phase)))
        .child(iconButton("wt-share", "share", "Share", (cx) => this.share.toggle(cx), c))
        .child(iconButton("wt-refresh", "refresh-cw", "Scan again", (cx) => { if (!this.working) this.refresh(cx); }, c, { spin: scanning })));
  }

  freedBones(c) { return skeletonOf({ shape: "line", count: 4 })("kanso-skeleton", c); }

  async probeWorktree(w) {
    const group = this.groups.find((item) => item.repo === w.repo);
    return parseProbe((await localService(repositoryApi).probe(w.path, idleMinutes(), group?.bases ?? [])).stdout);
  }

  skeleton(c) {
    return v_flex().w_full().gap(G.xl).child(skeletonOf({ shape: "metric" })("kanso-skeleton", c)).child(skeletonOf({ shape: "line", count: 2 })("kanso-skeleton-lines", c));
  }

  hero(c, narrow) {
    const all = this.groups.flatMap((g) => g.items), live = all.filter((w) => !w.missing);
    const measured = [...live, ...this.orphans].some((w) => w.size);
    const total = [...live, ...this.orphans].reduce((n, w) => n + (w.size ?? 0), 0);
    const plan = this.plan(), freed = plan.reduce((n, w) => n + (w.size ?? 0), 0);
    const here = aliasText(shared("kanso.alias"), "");
    const look = live.filter((w) => needsLook(w)).length;
    const gone = all.filter((w) => w.missing).length;
    const stats = [
      { value: String(live.length), unit: live.length === 1 ? "worktree" : "worktrees" },
      { value: String(this.groups.length), unit: this.groups.length === 1 ? "repository" : "repositories" },
      { value: String(look), unit: "need a look" },
      { value: String(gone), unit: gone === 1 ? "folder gone" : "folders gone" },
    ];
    const armed = this.armed.is("all"), busy = this.working === "all", can = plan.length > 0 && !this.working && this.done;
    const primary = this.armed.button("wt-clean", busy ? "Removing…" : `Clean up ${plan.length}`, `remove ${plan.length}`, "all", (cx) => this.cleanUp(cx), c, { disabled: !can });
    const gist = !this.done ? "Clean up waits for the scan to finish."
      : plan.length ? `${freed ? `${fmtSize(freed)} of it` : `${plan.length} of them`} can go without losing anything.` : "Nothing can go without losing work.";
    return heroStack(heroHeading()
        .child(div().text_size(T.title).text_color(c.muted).child(here ? `On ${machineTitle("", "", here)}` : "On this computer"))
        .child(metric({ value: measured ? fmtSize(total) : String(live.length), unit: measured ? "in worktrees" : "worktrees", facts: factList(stats) })("wt-metric", c))
        .child(div().text_size(T.title).text_color(c.dim).child(gist)))
      .child(v_flex().w_full().gap(G.sm)
        .child(h_flex().w_full().flex_wrap().gap_x(G.lg).gap_y(G.sm).items_center()
          .child(primary)
          .child(div().text_size(T.body).text_color(armed ? c.red : c.dim)
            .child(armed ? "Merged branches go too; the others stay." : "Nothing uncommitted, every commit on a branch, idle a day.")))
        .when(Boolean(this.notice), (el) => el.child(div().text_size(T.body).text_color(c.muted).child(this.notice)))
        .when(Boolean(this.note), (el) => el.child(failureBlock(this.note)("wt-note", c))));
  }

  row(w, c) {
    const v = this.verdict(w), picked = this.picked === w.path, busy = this.working === w.path || Boolean(this.batch?.has(w.path));
    const age = fmtAge(w.last), when = age ? (age === "today" ? "last commit today" : `last commit ${age} ago`) : "";
    const meta = [w.orphan ? tilde(w.path) : w.branch && w.branch !== name(w.path) ? w.branch : !w.branch ? "detached HEAD" : "", when].filter(Boolean).join(" · ");
    const button = row(`wt-${w.path}`, c, {
      name: name(w.path), detail: { text: busy ? "Removing…" : v.text, tone: v.tone }, meta: fmtSize(w.size), second: meta || null,
      current: picked, pending: busy,
      onClick: (cx) => { this.picked = picked ? null : w.path; this.armed.clear(); cx.notify(); },
    }).aria_selected(picked).accessibility_label(`${name(w.path)}, ${v.text}`);
    if (!picked) return button;
    const s = stateOf(w);
    const blocked = s === "open" ? "Close its tabs in Herdr to remove it." : s === "locked" ? "Locked: run git worktree unlock to remove it."
      : s === "broken" ? "Its .git points to where the repository used to be, so git can't read what it holds. Repair the link to check it like any other."
      : s === "checking" || !w.fresh ? "As the last scan saw it. Checking it again before it can be removed." : "";
    const dropsBranch = this.armed.is(`branch:${w.path}`);
    const text = dropsBranch ? branchLoss(w) : consequence(w, this.groups.find((g) => g.repo === w.repo)?.base);
    const loses = text.startsWith("Loses") || w.orphan;
    const removeLink = (id, key, label, withBranch) => this.armed.link(`wt-${id}-${w.path}`, busy ? "Removing…" : label, label.toLowerCase(),
      `${key}:${w.path}`, (cx) => this.remove(w.path, cx, withBranch), c, { color: c.text, disabled: Boolean(this.working) });
    return v_flex().w_full()
      .child(button)
      .child(v_flex().w_full().px(G.md).pt(G.xs).pb(G.md).gap(G.sm)
        .child(div().w_full().text_size(T.body).line_height(1.45).text_color(loses ? c.red : c.muted).child(blocked || text))
        .child(div().w_full().truncate().text_size(T.micro).text_color(c.dim).child(tilde(w.path)))
        .child(h_flex().flex_wrap().gap_x(G.lg)
          .when(s === "broken", (el) => el.child(quietLink(`wt-repair-${w.path}`, this.working === w.path ? "Repairing…" : "Repair the link",
            (cx) => this.repair(w.path, cx), c, { color: c.text, disabled: Boolean(this.working) })))
          .when(!w.missing && s !== "broken", (el) => el.child(explainButton({ agent: this.explainer?.name ?? "an agent", size: "sm" })(`wt-explain-${w.path}`, c, {
            onClick: () => this.ask(`Explain ${name(w.path)}`, w.path, explainPrompt(this.item(w.path) ?? w, this.groups.find((g) => g.repo === w.repo)?.base)),
          })))
          .when(!w.missing, (el) => el.child(quietLink(`wt-open-${w.path}`, "Open in a new tab", () => run("tab.new", { folder: w.path }), c)))
          .when(!blocked, (el) => el.child(removeLink("rm", "one", "Remove", false)))
          .when(!blocked && s === "unmerged", (el) => el.child(removeLink("rmb", "branch", "Remove with its branch", true)))));
  }

  group(id, title, where, items, c) {
    const missing = items.filter((w) => w.missing), shown = items.filter((w) => !w.missing)
      .toSorted((a, b) => (ORDER[stateOf(a)] ?? 9) - (ORDER[stateOf(b)] ?? 9) || (b.size ?? 0) - (a.size ?? 0));
    const open = this.more.has(id), rows = open ? shown : shown.slice(0, ROWS);
    const size = items.reduce((n, w) => n + (w.size ?? 0), 0), many = items.filter(removable);
    const key = `group:${id}`, armed = this.armed.is(key), lost = losses(many);
    const note = [`${shown.length || missing.length}`, fmtSize(size)].filter(Boolean).join(" · ");
    return v_flex().w_full().gap(G.hair)
      .child(h_flex().w_full().items_end().justify_between().gap(G.md).pb(G.sm)
        .child(v_flex().flex_1().min_w(0).gap(G.hair)
          .child(div().w_full().truncate().text_size(T.title).text_color(c.text).child(title))
          .child(div().w_full().truncate().text_size(T.body).text_color(c.dim).child(where)))
        .child(div().flex_none().text_size(T.body).text_color(c.dim).child(note)))
      .children(rows.map((w) => this.row(w, c)))
      .child(h_flex().w_full().flex_wrap().gap_x(G.lg).px(G.md).pt(G.xs)
        .when(shown.length > ROWS, (el) => el.child(quietLink(`wt-more-${id}`, open ? "Show fewer" : `Show ${shown.length - ROWS} more`,
          (cx) => { this.more = open ? new Set([...this.more].filter((x) => x !== id)) : new Set([...this.more, id]); cx.notify(); }, c)))
        .when(missing.length > 0, (el) => el.child(quietLink(`wt-prune-${id}`, `Prune ${missing.length} ${missing.length === 1 ? "record" : "records"} of ${missing.some((w) => w.replaced) ? "folders gone or reused" : missing.length === 1 ? "a folder already gone" : "folders already gone"}`,
          (cx) => this.prune(missing.map((w) => w.path), cx), c, { disabled: Boolean(this.working) })))
        .when(many.length > 1 && this.done, (el) => el.child(this.armed.link(`wt-all-${id}`, `Remove all ${many.length}`, `remove ${many.length}`,
          key, (cx) => { this.markOpen(); this.removeAll(items.map((w) => this.item(w.path)).filter((w) => w && removable(w)), cx); }, c, { disabled: Boolean(this.working) }))))
      // Below the actions, so arming moves none of them.
      .when(armed, (el) => el.child(div().w_full().px(G.md).pt(G.xs).text_size(T.body).line_height(1.45).text_color(lost === "Nothing is lost." ? c.muted : c.red)
        .child(`${lost} Branches stay unless merged. Anything open in Herdr, locked or in use today stays.`)));
  }

  ask(title, folder, prompt) {
    explainWith(this.explainer, { name: title, space: spaces().find((s) => s.active)?.id, folder, task: prompt });
  }

  bars(c, byDay, title, height, empty) {
    const days = lastDays(byDay), top = Math.max(0, ...days.map((d) => d.kb));
    return v_flex().w_full().gap(G.sm)
      .child(h_flex().w_full().items_end().justify_between()
        .child(div().text_size(T.body).text_color(c.muted).child(title))
        .child(div().text_size(T.micro).text_color(c.dim).child(top ? `top ${fmtSize(top)}` : empty)))
      .child(h_flex().w_full().items_end()
        .children(days.map((d) => {
          const peak = top > 0 && d.kb === top;
          return v_flex().flex_1().min_w(0).h(height + 18).items_center().justify_end().gap(G.xs)
            .tooltip(tooltip({ label: shortDate(d.at), detail: d.kb ? fmtSize(d.kb) : "nothing" }))
            .when(peak, (e) => e.child(div().text_size(T.micro).text_color(c.text).whitespace_nowrap().child(fmtSize(d.kb))))
            .child(div().w(peak ? 3 : 2).flex_none().rounded_t(1)
              .h(d.kb ? Math.max(3, Math.round((d.kb / top) * height)) : 1)
              .bg(peak ? c.accent : d.kb ? c.muted : c.border)
              .opacity(peak || !d.kb ? 1 : OPACITY.quiet));
        })))
      .child(h_flex().w_full().justify_between()
        .child(div().text_size(T.micro).text_color(c.dim).child(shortDate(days[0].at)))
        .child(div().text_size(T.micro).text_color(c.dim).child("Today")));
  }

  space(c) {
    const items = this.groups.flatMap((g) => g.items), parts = spaceBy(items, this.orphans);
    const total = parts.reduce((n, p) => n + p.kb, 0);
    if (!total) return null;
    const color = { go: c.green, look: c.red, use: c.yellow, left: c.muted, checking: c.border };
    const pct = (kb) => `${Math.max(0.5, (kb / total) * 100).toFixed(2)}%`;
    const repos = this.groups.map((g) => ({ name: name(g.repo), kb: g.items.reduce((n, w) => n + (w.size ?? 0), 0), count: g.items.filter((w) => !w.missing).length }))
      .concat(this.orphans.length ? [{ name: "Left behind", kb: this.orphans.reduce((n, w) => n + (w.size ?? 0), 0), count: this.orphans.length }] : [])
      .filter((r) => r.kb > 0).toSorted((a, b) => b.kb - a.kb).slice(0, 6);
    const most = repos[0]?.kb ?? 1;
    return v_flex().w_full().gap(G.lg)
      .child(section(c, "Where the space is", fmtSize(total)))
      .child(h_flex().w_full().h(10).rounded(R.sm).overflow_hidden().gap(G.hair)
        .children(parts.filter((p) => p.kb > 0).map((p) => div().h_full().w(pct(p.kb)).flex_shrink_0().bg(color[p.key]).opacity(p.key === "checking" ? 1 : OPACITY.part)
          .tooltip(tooltip({ label: p.label, detail: fmtSize(p.kb) })))))
      .child(v_flex().w_full().gap(6)
        .children(parts.map((p) => h_flex().w_full().items_center().gap(G.sm)
          .child(dot(c, color[p.key]))
          .child(div().flex_1().min_w(0).truncate().text_size(T.value).text_color(c.text).child(p.label))
          .child(div().text_size(T.micro).text_color(c.dim).child(`${p.count}`))
          .child(div().w(64).flex_none().text_right().text_size(T.card).font_light().text_color(c.text).child(fmtSize(p.kb) || "0 KB"))
          .child(div().w(36).flex_none().text_right().text_size(T.micro).text_color(c.dim).child(`${Math.round((p.kb / total) * 100)}%`)))))
      .when(repos.length > 1, (el) => el.child(v_flex().w_full().gap(G.sm).pt(G.sm)
        .child(div().text_size(T.body).text_color(c.muted).child("The repositories that take the most"))
        .children(repos.map((r) => v_flex().w_full().gap(G.xs)
          .child(h_flex().w_full().items_end().gap(G.sm)
            .child(div().flex_1().min_w(0).truncate().text_size(T.value).text_color(c.text).child(r.name))
            .child(div().text_size(T.micro).text_color(c.dim).child(`${r.count}`))
            .child(div().w(64).flex_none().text_right().text_size(T.card).font_light().text_color(c.text).child(fmtSize(r.kb))))
          .child(div().w_full().h(4).rounded(2).bg(c.border)
            .child(div().h_full().w(`${Math.max(1, (r.kb / most) * 100).toFixed(2)}%`).rounded(2).bg(c.muted)))))));
  }

  freed(c, narrow) {
    const h = this.hist;
    if (!h) return v_flex().w_full().child(section(c, "Freed"))
      .child(this.storeNote ? failureBlock(this.storeNote)("wt-store", c) : this.freedBones(c));
    const freedBars = this.bars(c, h.freedByDay, "Freed each day", 96, "fills as you remove")
      , diskBars = this.bars(c, h.diskByDay, "In worktrees each day", 56, "a bar per day with a scan");
    const outside = h.kb - h.kanso;
    return v_flex().w_full().gap(G.lg)
      .child(section(c, "Freed", h.since ? `since ${shortDate(h.since)}` : ""))
      .child(v_flex().gap(G.xs)
        .child(metric({ value: fmtSize(h.kb) || "0 KB", unit: "of disk freed", facts: h.kb > 0 || h.records + h.orphans > 0 ? factList(cleanedStats(h)) : "" })("wt-freed", c))
        .child(div().text_size(T.body).text_color(c.dim).child(!h.kb
          ? "Nothing freed yet. Every scan is kept: what Clean up, Remove or anything else frees adds up here."
          : outside > 0 ? `${fmtSize(h.kanso) || "0 KB"} here, ${fmtSize(outside)} removed outside the panel since a scan saw them.` : "All of it from this panel.")))
      .child(freedBars)
      .child(diskBars);
  }

  agent(c) {
    const look = this.groups.flatMap((g) => g.items).filter((w) => needsLook(w));
    if (!look.length) return null;
    const baseOf = (w) => this.groups.find((g) => g.repo === w.repo)?.base;
    return v_flex().w_full()
      .child(section(c, "Ask your agent", "in a new tab"))
      .child(div().text_size(T.body).text_color(c.dim).pb(G.xs)
        .child(`${look.length} would lose work if removed. Your agent can find out what that work is and whether it already lives somewhere else.`))
      .child(h_flex().w_full().flex_wrap().gap_x(G.lg).gap_y(G.xs)
        .child(quietLink("wt-review", `Review the ${look.length} that need a look`, () => this.ask("Worktrees review", home(), reviewPrompt(look, baseOf)), c, { color: c.text })));
  }

  current() {
    const live = this.groups.flatMap((g) => g.items).filter((w) => !w.missing), plan = this.plan();
    return {
      size: [...live, ...this.orphans].reduce((n, w) => n + (w.size ?? 0), 0), worktrees: live.length,
      canGoSize: plan.reduce((n, w) => n + (w.size ?? 0), 0), look: live.filter((w) => needsLook(w)).length,
      space: spaceBy(this.groups.flatMap((g) => g.items), this.orphans),
    };
  }

  shareCard() {
    const now = this.current();
    return { spec: freedSpec(this.hist, now), text: freedText(this.hist, now), name: "worktrees", title: "Worktrees" };
  }

  page(c, narrow, groups, shown) {
    const ask = this.agent(c), spaceView = this.space(c);
    return v_flex().w_full().gap(narrow ? 36 : 48)
      .child(this.hero(c, narrow))
      .when(Boolean(spaceView), (el) => el.child(spaceView))
      .child(this.freed(c, narrow))
      .when(Boolean(ask), (el) => el.child(ask))
      .children(shown.map((g) => this.group(g.repo, name(g.repo), tilde(g.repo), g.items, c)))
      .when(groups.length > REPOS, (el) => el.child(h_flex().child(quietLink("wt-repos", this.allRepos ? "Show fewer repositories" : `Show ${groups.length - REPOS} more repositories`,
        (cx) => { this.allRepos = !this.allRepos; cx.notify(); }, c))))
      .when(this.orphans.length > 0, (el) => el.child(this.group("orphans", "Left behind", "Folders of worktrees whose repository moved or was deleted", this.orphans, c)))
      .when(Boolean(this.scannedAt), (el) => el.child(div().text_size(T.micro).text_color(c.dim)
        .child(`Scanned ${new Date(this.scannedAt).toTimeString().slice(0, 5)}.`)));
  }

  render(cx) {
    const c = tokens(theme()), narrow = (this.width || 368) < 560;
    this.markOpen();
    const scanned = this.groups.length > 0 || this.orphans.length > 0;
    const groups = this.groups.toSorted((a, b) => this.done
      ? b.items.reduce((n, w) => n + (w.size ?? 0), 0) - a.items.reduce((n, w) => n + (w.size ?? 0), 0)
      : b.items.length - a.items.length);
    const shown = this.allRepos ? groups : groups.slice(0, REPOS);
    const body = !scanned && this.phase ? this.skeleton(c)
      : !scanned ? (this.note
        ? failureBlock({ ...this.note, fix: "Refresh" })("wt-failed", c, { onClick: (cx) => { if (!this.working) this.refresh(cx); } })
        : emptyState({ icon: "git-fork", text: "No worktrees besides your checkouts" })("wt-empty", c))
        : this.page(c, narrow, groups, shown);
    return sizedPage.call(this, v_flex().id("kanso-worktrees").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar(), narrow, (column) => column
          .child(this.header(c, narrow))
          .children(shareRows(this, c, (this.hist?.kb ?? 0) > 0 ? "Only the totals: how much was freed, how many were removed, and the days. Never a repository, branch or folder name."
              : "Nothing freed yet, so it shares what the worktrees take now: totals only, never a repository, branch or folder name."))
          .child(body));
  }
}

const cleanedStats = (h) => [
  { value: String(h.worktrees), unit: h.worktrees === 1 ? "worktree removed" : "worktrees removed" },
  { value: String(h.branches), unit: h.branches === 1 ? "branch deleted" : "branches deleted" },
  { value: String(h.records + h.orphans), unit: "leftovers cleared" },
];

// Kanso's Worktrees panel, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Every git worktree on this computer, grouped by repository, so the ones
// agents leave behind can be seen and removed. Repositories are found under
// the top folders of your spaces (~/Apps for ~/Apps/acme/web, or the folders
// in shared `kanso.worktrees.roots`); each one's `git worktree list` then
// finds its worktrees wherever they are, temp folders included. A folder
// whose `.git` points at a worktree record that no longer exists (left in
// those roots or in /tmp) is listed apart. Chosen roots replace all of
// these, temp folders included.
//
// Each row says what removing it would lose. Only uncommitted changes, and
// commits that exist only in that worktree (a detached HEAD no branch, tag
// or remote holds), can be lost: removing a worktree keeps its branch, and
// the branch goes too only when its work is already in the default branch
// or develop (an ancestor, or a squash merge: merging it would change
// nothing). Clean up removes, in one go, every one that loses nothing and
// is idle: no file or git state touched in the last day (shared
// `kanso.worktrees.idleHours`, default 24), so an agent still at work keeps
// its folder. A worktree open in Herdr is never removed.
import { div } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { exec, spaces, panes, home, run, theme, shared, notify, knownAgents } from "herdr";
import { Share, postText } from "./share.js";
import { WorktreeStore } from "./worktrees-store.js";
import { tilde, pool } from "./lib.js";
import { G, PULSE, breathe, Armed, tokens, quietLink, iconButton, section, ghost } from "./ui.js";
import { range, reduceSeries } from "./pure.js";

const TEMP = ["/private/tmp", "/tmp"];

// The folders to search: the top folder under your home of each space and
// pane, any folder outside it as is, or `kanso.worktrees.roots` when set.
export function rootsFor(folders, homeDir, chosen) {
  if (Array.isArray(chosen) && chosen.some((s) => typeof s === "string" && s.startsWith("/"))) {
    return [...new Set(chosen.filter((s) => typeof s === "string" && s.startsWith("/")))];
  }
  const roots = folders.flatMap((f) => {
    if (typeof f !== "string" || !f.startsWith("/")) return [];
    if (f.startsWith(`${homeDir}/`)) {
      const top = f.slice(homeDir.length + 1).split("/")[0];
      return top && !top.startsWith(".") ? [`${homeDir}/${top}`] : [];
    }
    return f !== homeDir && !TEMP.some((t) => f === t || f.startsWith(`${t}/`)) ? [f] : [];
  });
  return [...new Set(roots)];
}

// Prints `R <repo>` for each repository with linked worktrees, and
// `O <folder>` for a folder whose `.git` names a worktree record that is gone.
const DISCOVER = `
list=$(for root in "$@"; do
  [ -d "$root" ] || continue
  find "$root" -maxdepth 9 \\( -name node_modules -o -name .venv -o -name venv -o -name target -o -name dist -o -name build -o -name .next \\
    -o -name .turbo -o -name .cache -o -name vendor -o -name Pods -o -name DerivedData -o -name coverage -o -name __pycache__ -o -name .Trash -o -name Library \\
    -o -path '*/.git/*' -a ! -path '*/.git/worktrees' -a ! -path '*/.git/worktrees/*' \\) -prune \\
    -o -path '*/.git/worktrees/*/gitdir' -type f -print -o -name .git -type f -print 2>/dev/null
done | sort -u)
printf '%s\\n' "$list" | grep '/\\.git/worktrees/.*/gitdir$' | sed 's#/\\.git/worktrees/.*##' | sort -u | awk '{ print "R\\t" $0 }'
printf '%s\\n' "$list" | grep '/\\.git$' | tr '\\n' '\\0' | xargs -0 grep -H -m 1 '^gitdir: ' 2>/dev/null | while IFS= read -r line; do
  f=\${line%%:gitdir: *}; g=\${line#*:gitdir: }
  case "$g" in */worktrees/*) ;; *) continue ;; esac
  case "$g" in /*) ;; *) g="\${f%/.git}/$g" ;; esac
  [ -e "$g" ] || printf 'O\\t%s\\n' "\${f%/.git}"
done
exit 0`;

export function parseDiscovery(out) {
  const lines = String(out).split("\n").map((line) => line.split("\t")).filter(([, path]) => path);
  return { repos: lines.filter(([kind]) => kind === "R").map(([, path]) => path), orphans: lines.filter(([kind]) => kind === "O").map(([, path]) => path) };
}

// The branches work lands in: the default one, and develop or dev where a
// repository integrates there; origin's and the local one of each.
const BASES = `
cd "$1" || exit 3
o=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)
for r in "$o" "\${o#origin/}" origin/main main origin/master master; do
  [ -n "$r" ] && git rev-parse -q --verify "$r^{commit}" >/dev/null 2>&1 && echo "$r"
done
for r in origin/develop develop origin/dev dev; do
  git rev-parse -q --verify "$r^{commit}" >/dev/null 2>&1 && echo "+$r"
done
exit 0`;

// The default branch's refs first (its name is the one shown), then develop's.
export function basesFrom(out) {
  const lines = [...new Set(String(out).split("\n").map((s) => s.trim()).filter(Boolean))];
  const main = lines.filter((l) => !l.startsWith("+")), extra = lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1));
  const pick = (refs) => { if (!refs.length) return []; const n = refs[0].replace(/^origin\//, ""); return refs.filter((r) => r === n || r === `origin/${n}`); };
  return [...new Set([...pick(main), ...pick(extra)])];
}

// `git worktree list --porcelain -z`: the first is the main worktree.
// Each worktree is its "worktree" line and the lines after it, up to an
// empty one or the next worktree; lines outside any are no one's.
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

// What one worktree holds: whether a file in it changed, or it committed or
// checked out, in the last $2 minutes (not its index, which any git status
// touches; this one asks for no optional locks so it never does), uncommitted
// entries, its last commit, the commits not in the bases, the commits no
// branch, tag or remote has, and whether its work is already in a base.
const PROBE = `
cd "$1" 2>/dev/null || { echo gone; exit 0; }
[ -d .git ] && { echo replaced; exit 0; }
# git can't read it (its .git names where the repository used to be): nothing
# below would be true, so it says so and stops.
git rev-parse --git-dir >/dev/null 2>&1 || { echo broken; exit 0; }
status=$(git --no-optional-locks status --porcelain=v1 --untracked-files=normal 2>/dev/null) || { echo broken; exit 0; }
idle=$2
shift 2
if [ "$idle" -gt 0 ] 2>/dev/null; then
  gd=$(git rev-parse --absolute-git-dir 2>/dev/null)
  if [ -n "$(find . -maxdepth 3 \\( -name node_modules -o -name .git \\) -prune -o -mmin -"$idle" -print 2>/dev/null | head -n 1)" ] ||
     { [ -n "$gd" ] && [ -n "$(find "$gd/HEAD" "$gd/logs/HEAD" -mmin -"$idle" 2>/dev/null | head -n 1)" ]; }; then echo recent; fi
fi
printf 'only\\t%s\\n' "$(git rev-list --count HEAD --not --branches --tags --remotes 2>/dev/null)"
printf 'dirty\\t%s\\n' "$(printf '%s' "$status" | grep -c .)"
printf 'last\\t%s\\n' "$(git log -1 --format=%ct 2>/dev/null)"
ahead=
for b in "$@"; do
  a=$(git rev-list --count "$b..HEAD" 2>/dev/null) || continue
  if [ -z "$ahead" ] || [ "$a" -lt "$ahead" ]; then ahead=$a; fi
  if git merge-base --is-ancestor HEAD "$b" 2>/dev/null; then echo merged; continue; fi
  t=$(git merge-tree --write-tree "$b" HEAD 2>/dev/null) && [ "$t" = "$(git rev-parse "$b^{tree}" 2>/dev/null)" ] && echo merged
done
printf 'ahead\\t%s\\n' "$ahead"
exit 0`;

// Removes the record of a worktree whose folder is now a repository of its
// own ($2/.git a folder): the entry under the repository's worktrees/ whose
// gitdir names it. Prints "forgot" for each one removed.
const FORGET = `
c=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 3
[ -d "$2/.git" ] || exit 4
for d in "$c"/worktrees/*/; do
  [ -f "$d/gitdir" ] || continue
  if [ "$(head -n 1 "$d/gitdir")" = "$2/.git" ]; then rm -rf -- "$d" && echo forgot; fi
done
exit 0`;

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

// /tmp and /var are /private/tmp and /private/var on macOS; git and panes
// may report either.
const real = (p) => String(p ?? "").replace(/^\/(tmp|var)(\/|$)/, "/private/$1$2").replace(/\/+$/, "");
export const inside = (dir, path) => { const d = real(dir), p = real(path); return Boolean(d) && (p === d || p.startsWith(`${d}/`)); };

// One word for a worktree, in the order that decides it.
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

// A repository's Remove all takes it, losses and all, on a second press: never
// one open in Herdr, locked, touched today or not checked yet.
export const removable = (w) => !["open", "locked", "recent", "checking", "broken"].includes(stateOf(w));

// Would lose work, or can't be read until repaired: yours to look at.
export const needsLook = (w) => ["changes", "lost", "broken"].includes(stateOf(w));

// Where the disk goes: what can go, what needs a look, what is in use, the
// folders left behind, and what is still being checked. Sizes in KB.
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

// What a Remove all would lose, in words.
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

// What removing it does, in words.
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
    : ` Branch ${w.branch} stays${w.ahead > 0 ? ` with its ${w.ahead} ${w.ahead === 1 ? "commit" : "commits"}` : ""}.`;
  return (lost.length ? `Loses ${lost.join(" and ")}.` : "Nothing is lost.") + branch;
}

// ---- What you freed -------------------------------------------------------
// The history is in worktrees-store.js (SQLite): every worktree seen, and
// for the gone ones when and how much they freed. `h` below is its history():
// { kb, kanso, worktrees, records, orphans, branches, since, freedByDay, diskByDay }.
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// The last `n` days, the oldest first, each with its value in `byDay` (or 0).
export function lastDays(byDay, now = Date.now(), n = 30) {
  const t = new Date(now);
  return range(n).map((k) => {
    // Noon, i days back (the oldest first).
    const at = new Date(t.getFullYear(), t.getMonth(), t.getDate() - (n - 1 - k), 12, 0, 0, 0).getTime();
    const day = dayKey(at);
    return { day, at, kb: byDay?.[day] ?? 0 };
  });
}

const best = (byDay) => Object.entries(byDay ?? {}).reduce((b, [day, kb]) => (kb > (b?.kb ?? 0) ? { day, kb } : b), null);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (ms) => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
// "12.4 GB" as the card's big number and its unit.
const splitSize = (kb) => { const [n, u] = fmtSize(kb).split(" "); return { big: n || "0", small: u || "KB" }; };

// The share card: global numbers only, never a repository, branch or path.
// What was freed when there is some; else what the worktrees take now.
//   now: { size, worktrees, canGoSize, look } from the last scan.
export function freedSpec(h, current, at = Date.now()) {
  const where = (current?.space ?? []).filter((p) => p.kb > 0);
  const freed = (h?.kb ?? 0) > 0, days = lastDays(freed ? h.freedByDay : h?.diskByDay, at);
  const size = splitSize(freed ? h.kb : current?.size ?? 0), top = best(freed ? h.freedByDay : h?.diskByDay);
  const stats = freed ? [
    { value: String(h.worktrees), unit: h.worktrees === 1 ? "worktree removed" : "worktrees removed" },
    { value: String(h.branches), unit: h.branches === 1 ? "merged branch deleted" : "merged branches deleted" },
    { value: String(h.records + h.orphans), unit: "leftovers cleared" },
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
    ...(h.branches ? [`${h.branches} merged ${h.branches === 1 ? "branch" : "branches"} deleted`] : []),
  ] : current?.size ? [`My AI agents left ${fmtSize(current.size)} of disk in ${current.worktrees} git worktrees`] : [];
  return postText(parts, "Cleaning up after my AI agents.");
}

// ---- Asking your agent ---------------------------------------------------------
// What a worktree holds and whether it can go, read by your agent in a new
// tab there. Explaining changes nothing.
export function explainPrompt(w, base) {
  if (w.orphan) return `This folder was a git worktree whose repository moved or was deleted, so git no longer knows it. Explain what it holds: read its files, and if you can find the repository it came from (its .git file names the old location), compare them. End with a verdict: safe to delete, or what would be lost and how to keep it. Do not change, move or delete anything.`;
  const head = w.branch ? `on branch ${w.branch}` : "with a detached HEAD";
  const b = base || "the default branch";
  const byBranch = w.branch ? ", gh pr list --state all --head " + w.branch : "";
  return `This folder is a git worktree of ${w.repo}, ${head}. Explain what work it holds and whether it can be removed. Look at its uncommitted changes (git status, git diff), the commits not in ${b} (git log ${b}..HEAD), and whether that work exists anywhere else: another branch, a remote, or a pull request (gh pr list --state all --search <commit>${byBranch}). End with a verdict: safe to remove, or exactly what would be lost and how to keep it (commit, push, open a pull request). Do not change, commit, push or delete anything.`;
}

// The ones that need a look, reviewed together.
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

// Drawn until you ask for more, so a frame stays quick: repositories, and rows in each.
const REPOS = 8, ROWS = 4;

const name = (p) => String(p).split("/").filter(Boolean).at(-1) ?? p;

// Rows are values: a worktree is never changed, only replaced by a new one
// with the same path. The path is its key, so anything that acts on a row
// later (a click, a batch, a probe coming back) keeps the path and reads the
// row as it is then. The actions take a worktree or its path.
const keyOf = (w) => (typeof w === "string" ? w : w?.path);

// `list` with `change` made to every item, or `list` itself when none
// changed, so a redraw that changes nothing builds nothing new.
const mapSame = (list, change) => {
  const out = list.map(change);
  return out.every((x, i) => x === list[i]) ? list : out;
};

// The groups with `change` made to their items, a group untouched kept as is.
const mapGroups = (groups, change) => mapSame(groups, (g) => {
  const items = mapSame(g.items, change);
  return items === g.items ? g : { ...g, items };
});

// What a probe found, as a new worktree. A repository of its own now lives
// in that folder: only the record goes.
const withProbe = (w, p) => ({
  ...w, dirty: p.dirty, last: p.last, ahead: p.ahead, merged: p.merged, recent: p.recent, only: p.only, broken: p.broken, probed: true, fresh: true,
  ...(p.gone || p.replaced ? { missing: true } : {}), ...(p.replaced ? { replaced: true } : {}),
});

// The minutes a worktree has to be idle for, from shared `kanso.worktrees.idleHours`.
const idleMinutes = () => {
  const hours = shared("kanso.worktrees.idleHours");
  return String(Math.round((typeof hours === "number" && hours >= 0 ? hours : 24) * 60));
};

// Exists only while shown (mounted on demand). Scans when opened and on Refresh.
export class Worktrees {
  constructor() { this.armed = new Armed(); } // removals ask for a second press

  init(cx) {
    this.groups = []; this.orphans = []; this.scan = 0; this.more = new Set(); this.allRepos = false;
    this.picked = null; this.working = null; this.batch = null; this.phase = null; this.note = null; this.notice = null;
    this.width = 368; this.done = false;
    this.share = new Share("kanso-panel");
    this.store = new WorktreeStore(); this.stored = false; this.known = new Map(); this.hist = null;
    // What the last scan kept shows at once; the scan then checks it all again.
    cx.spawn(async (cx) => {
      try {
        await this.store.open();
        const items = await this.store.live();
        this.known = new Map(items.map((w) => [w.path, w.size]));
        if (!this.groups.length && !this.orphans.length) this.show(items);
        this.hist = await this.store.history();
        this.stored = true;
      } catch (e) { this.storeNote = String(e?.message ?? e); }
      finally { this.refresh(cx); }
    });
  }

  // Items as the panel's repositories and left-behind folders.
  show(items) {
    this.groups = [...Map.groupBy(items.filter((w) => !w.orphan), (w) => w.repo)].map(([repo, list]) => ({ repo, base: "", bases: [], items: list }));
    this.orphans = items.filter((w) => w.orphan);
  }

  // The row listed under `path` now, or null once it is gone.
  item(path) {
    return this.groups.flatMap((g) => g.items).find((w) => w.path === path) ?? this.orphans.find((w) => w.path === path) ?? null;
  }

  // Replaces the row under `path` with `change(row)`. It reads the lists as
  // they are when called and assigns them once, with no wait in between, so
  // the probes and sizes that come back in any order each land on what the
  // others already left, and none undoes another.
  update(path, change) {
    const one = (w) => (w.path === path ? change(w) : w);
    this.groups = mapGroups(this.groups, one);
    this.orphans = mapSame(this.orphans, one);
  }

  // Keeps this scan in the history, and what it shows as gone.
  async keep(repos, search) {
    if (!this.stored) return;
    const all = [...this.groups.flatMap((g) => g.items), ...this.orphans];
    await this.store.save(all);
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

  // Removals into the history: what each freed, and by Kanso.
  async credit(pairs) {
    if (!this.stored) return;
    try {
      for (const [w, got] of pairs) await this.store.removed(w, got);
      this.hist = await this.store.history();
    } catch (e) { this.note = `The history could not be saved: ${String(e?.message ?? e)}`; }
  }

  // A scan or a batch changes many rows a second: draw at most four times a second.
  soon(cx) {
    if (!cx.timer) { cx.notify(); return; }
    if (this.pending) return;
    this.pending = cx.timer.after(250, (cx) => { this.pending = null; cx.notify(); });
  }

  // The folders to search, and the temp folders (only when the roots are not chosen).
  roots() {
    const folders = [...spaces().filter((s) => !s.machine).map((s) => s.folder), ...panes().map((p) => p.cwd)];
    const chosen = shared("kanso.worktrees.roots"), roots = rootsFor(folders, home(), chosen);
    return { roots, search: roots.length && Array.isArray(chosen) && chosen.length ? roots : [...roots, ...TEMP] };
  }

  // Panes and spaces in a worktree: Herdr is using it. Runs on every draw, so
  // only a row whose answer changed is replaced.
  markOpen() {
    const used = [...spaces().filter((s) => !s.machine).map((s) => s.folder), ...panes().map((p) => p.cwd)].filter(Boolean);
    const mark = (w) => { const open = used.some((u) => inside(w.path, u)); return w.open === open ? w : { ...w, open }; };
    this.groups = mapGroups(this.groups, mark);
    this.orphans = mapSame(this.orphans, mark);
  }

  refresh(cx) {
    const id = this.scan + 1, { roots, search } = this.roots();
    this.scan = id;
    this.phase = "Finding repositories"; this.note = null; this.picked = null; this.armed.clear(); this.done = false;
    cx.spawn(async (cx) => {
      try {
        const found = await exec("bash", ["-c", DISCOVER, "worktrees", ...search]);
        if (id !== this.scan) return;
        const { repos, orphans } = parseDiscovery(found.stdout);
        this.phase = `Reading ${repos.length} repositories`;
        const read = await pool(repos, 6, async (repo) => {
          const [list, bases] = await Promise.all([
            exec("git", ["worktree", "list", "--porcelain", "-z"], { cwd: repo }),
            exec("bash", ["-c", BASES, "bases", repo]),
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
        // What each one holds, then what each one weighs: the list is usable
        // before the sizes are in.
        const idle = idleMinutes();
        // By path and its repository's bases: each answer lands on the row as it is when it comes back.
        const live = groups.flatMap((g) => g.items.filter((w) => !w.missing).map((w) => [w.path, g.bases]));
        // `counted`: how many of this step are done, for the line that says so.
        this.counted = 0;
        await pool(live, 8, async ([path, bases]) => {
          const r = await exec("bash", ["-c", PROBE, "probe", path, idle, ...bases]);
          if (id !== this.scan) return;
          this.apply(path, parseProbe(r.stdout));
          this.counted = this.counted + 1;
          this.phase = `Checking ${this.counted} of ${live.length}`;
          this.soon(cx);
        });
        if (id !== this.scan) return;
        // The probed ones still there and not gone after all, then the left-behind folders.
        const sized = [...live.map(([path]) => this.item(path)).filter((w) => w && !w.missing), ...this.orphans].map((w) => w.path);
        this.counted = 0;
        await pool(sized, 4, async (path) => {
          const r = await exec("du", ["-sk", path]);
          if (id !== this.scan) return;
          const size = Number(String(r.stdout).split("\t")[0]) || 0;
          this.update(path, (w) => ({ ...w, size }));
          this.counted = this.counted + 1;
          this.phase = `Measuring ${this.counted} of ${sized.length}`;
          this.soon(cx);
        });
        if (id !== this.scan) return;
        this.phase = "Saving";
        try { await this.keep(new Set(repos), search); } catch (e) { this.note = `The history could not be saved: ${String(e?.message ?? e)}`; }
        if (id !== this.scan) return;
        this.phase = null; this.done = true; this.scannedAt = Date.now();
      } catch (e) {
        if (id === this.scan) { this.phase = null; this.note = `Scan failed: ${e}`; }
      } finally { if (id === this.scan) cx.notify(); }
    });
    cx.notify();
  }

  // What a probe found, onto the row under `path` as it is now.
  apply(path, p) {
    this.update(path, (w) => withProbe(w, p));
  }

  // Points a worktree whose repository moved back at it (git worktree
  // repair, which rewrites its .git file), then checks it like any other.
  repair(target, cx) {
    const w = this.item(keyOf(target));
    if (this.working || !w) return;
    this.working = w.path; this.note = null;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("git", ["worktree", "repair", w.path], { cwd: w.repo });
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0]);
        const g = this.groups.find((g) => g.repo === w.repo);
        const p = parseProbe((await exec("bash", ["-c", PROBE, "probe", w.path, idleMinutes(), ...(g?.bases ?? [])])).stdout);
        this.apply(w.path, p);
        if (p.broken) throw new Error("git still can't read it");
        notify({ title: `Repaired ${name(w.path)}`, body: "It is linked to its repository again.", level: "success" });
      } catch (e) { this.note = `${name(w.path)}: ${String(e?.message ?? e)}`; }
      finally { this.working = null; cx.notify(); }
    });
    cx.notify();
  }

  // Removes one worktree (or orphan folder); throws with git's words.
  async removeOne(w) {
    if (w.orphan) {
      // Checked again now: still a folder whose .git names a record that is gone.
      const r = await exec("bash", ["-c", 'g=$(sed -n "1s/^gitdir: //p" "$1/.git" 2>/dev/null); case "$g" in */worktrees/*) ;; *) exit 4 ;; esac; case "$g" in /*) ;; *) g="$1/$g" ;; esac; [ -e "$g" ] && exit 5; rm -rf -- "$1"', "orphan", w.path]);
      if (r.code !== 0) throw new Error(r.code === 4 || r.code === 5 ? "It is a worktree again; refresh" : (r.stderr || "Cannot delete it").trim());
      return { kb: w.size ?? 0, orphans: 1 };
    }
    if (w.replaced) {
      // git worktree remove refuses a folder that is a repository of its own,
      // and prune keeps a record whose folder exists: the record alone goes,
      // checked again now, and the folder is not touched.
      const r = await exec("bash", ["-c", FORGET, "forget", w.repo, w.path]);
      if (r.code !== 0 || !r.stdout.includes("forgot")) throw new Error(r.code === 4 ? "It is a worktree again; refresh" : (r.stderr || "No record of it was found").trim());
      return { records: 1 };
    }
    const git = (args) => exec("git", args, { cwd: w.repo });
    if (!w.missing) {
      const r = await git(["worktree", "remove", ...(w.dirty > 0 ? ["--force"] : []), w.path]);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
    }
    const branch = w.merged && w.branch ? (await git(["branch", "-D", w.branch])).code === 0 : false;
    await git(["worktree", "prune"]);
    return w.missing ? { records: 1 } : { kb: w.size ?? 0, worktrees: 1, branches: branch ? 1 : 0 };
  }

  // Takes the row under `w`'s path off the lists, and a repository left with none.
  drop(w) {
    if (w.orphan) this.orphans = this.orphans.filter((o) => o.path !== w.path);
    this.groups = this.groups.map((g) => ({ ...g, items: g.items.filter((x) => x.path !== w.path) })).filter((g) => g.items.length);
  }

  // Checks one again right before it goes, and says whether `ok` still holds
  // for it then: the row as it is now, or null when it no longer holds or is
  // no longer listed. What changed since the scan (new work, an agent at work
  // there, a link that broke, a folder made again) shows on its row instead
  // of failing.
  async still(path, ok) {
    const w = this.item(path);
    if (!w) return null;
    if (w.orphan) return w; // removeOne checks a left-behind folder itself
    if (w.missing) {
      const r = await exec("bash", ["-c", w.replaced ? '[ -d "$1/.git" ]' : '[ ! -e "$1" ]', "check", w.path]);
      return r.code === 0 ? this.item(path) : null;
    }
    const g = this.groups.find((g) => g.repo === w.repo);
    const p = parseProbe((await exec("bash", ["-c", PROBE, "probe", w.path, idleMinutes(), ...(g?.bases ?? [])])).stdout);
    this.apply(path, p);
    this.markOpen();
    const now = this.item(path);
    return now && ok(now) ? now : null;
  }

  remove(target, cx) {
    this.markOpen();
    const w = this.item(keyOf(target));
    if (!w || w.open || w.locked || this.working || !w.fresh) return;
    this.working = w.path; this.armed.clear(); this.note = null; this.notice = null;
    const before = { dirty: w.dirty ?? 0, only: w.only ?? 0 };
    cx.spawn(async (cx) => {
      try {
        // As confirmed: still removable, and holding no more than it said.
        const now = await this.still(w.path, (x) => removable(x) && (x.dirty ?? 0) <= before.dirty && (x.only ?? 0) <= before.only);
        if (!now) {
          this.notice = `${name(w.path)} changed since you looked, so it stays. Its row shows it as it is now.`;
          return;
        }
        const got = await this.removeOne(now);
        this.drop(now); await this.credit([[now, got]]);
        if (got.kb) notify({ title: `Freed ${fmtSize(got.kb)}`, body: this.hist?.kb ? `${fmtSize(this.hist.kb)} freed so far` : undefined, level: "success" });
      } catch (e) { this.note = `${name(w.path)}: ${String(e.message ?? e)}`; }
      finally { this.working = null; cx.notify(); }
    });
    cx.notify();
  }

  // A repository's records of folders already gone, all with one prune.
  prune(targets, cx) {
    const missing = targets.map((t) => this.item(keyOf(t))).filter(Boolean);
    if (!missing.length || this.working) return;
    this.working = missing[0].repo; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const w of missing.filter((w) => w.replaced)) await this.removeOne(w);
        const plain = missing.find((w) => !w.replaced);
        if (plain) await this.removeOne(plain);
        for (const w of missing) this.drop(w);
        await this.credit(missing.map((w) => [w, { records: 1 }]));
      }
      catch (e) { this.note = `${name(missing[0].repo)}: ${String(e.message ?? e)}`; }
      finally { this.working = null; cx.notify(); }
    });
    cx.notify();
  }

  // Everything that loses nothing, in one go. A repository's missing ones go with one prune.
  plan() {
    return this.groups.flatMap((g) => g.items.filter(safe));
  }

  cleanUp(cx) {
    this.markOpen();
    this.removeAll(this.plan(), cx, safe);
  }

  // Removes several, one after another, each checked again right before it
  // goes: one that no longer meets `ok` stays, and the panel says how many.
  // `this.batch` holds the paths still to go, for the rows that say so.
  removeAll(targets, cx, ok = removable) {
    const paths = targets.map(keyOf);
    if (!paths.length || this.working) return;
    this.working = "all"; this.batch = new Set(paths); this.armed.clear(); this.note = null; this.notice = null;
    cx.spawn(async (cx) => {
      // One at a time: how many went, stayed and failed, what each freed, and
      // the repositories already pruned (their other missing ones go with it).
      const { done, kept, failed, got } = await reduceSeries(paths, async (t, path) => {
        this.phase = `Removing ${t.done + t.kept + t.failed.length + 1} of ${paths.length}`;
        this.soon(cx);
        try {
          // The row as it is once checked again: what it holds now decides.
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
      if (failed.length) this.note = `${failed.length} not removed. ${failed[0]}`;
      if (kept) this.notice = `${kept} ${kept === 1 ? "stays: it" : "stay: they"} changed since the scan (new work, in use, or git can no longer read ${kept === 1 ? "it" : "them"}). ${kept === 1 ? "Its row shows" : "Their rows show"} what changed.`;
      const kb = got.reduce((n, [, e]) => n + (e.kb ?? 0), 0), total = this.hist?.kb ?? 0;
      notify({ title: kb ? `Freed ${fmtSize(kb)}` : `Removed ${done} ${done === 1 ? "worktree" : "worktrees"}`,
        body: `${done} removed${total ? `, ${fmtSize(total)} freed so far` : ""}`, level: failed.length ? "warning" : "success" });
      cx.notify();
    });
    cx.notify();
  }

  // ---- Drawing ----------------------------------------------------------------
  // Drawn the way PR and Spend are: one centered column, no cards, hierarchy
  // from type size and tone, a hero with the numbers, hairline sections, quiet
  // text actions, and a second press to confirm anything that removes.

  // A worktree's state in words and a color; green when Clean up takes it.
  verdict(w, c) {
    const s = stateOf(w), n = (k, one, many) => `${w[k]} ${w[k] === 1 ? one : many}`;
    return {
      checking: { text: "Checking", color: c.dim },
      missing: { text: "Folder gone", color: c.dim },
      orphan: { text: "Its repository moved or was deleted", color: c.dim },
      open: { text: "Open in Herdr", color: c.yellow },
      locked: { text: "Locked", color: c.dim },
      changes: { text: n("dirty", "uncommitted change", "uncommitted changes"), color: c.red },
      lost: { text: `${n("only", "commit", "commits")} only here`, color: c.red },
      broken: { text: "Its repository moved: repair the link", color: c.yellow },
      recent: { text: "In use today", color: c.yellow, pulse: true },
      merged: { text: "Merged", color: c.green },
      detached: { text: "Detached, its commits are on branches", color: c.green, quiet: true },
      unmerged: { text: w.ahead > 0 ? `Not merged, ${n("ahead", "commit", "commits")} stay on its branch` : "Not merged, stays on its branch", color: c.green, quiet: true },
    }[s];
  }

  header(c, narrow) {
    const scanning = Boolean(this.phase) && this.working !== "all";
    return h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().truncate().text_size(narrow ? 17 : 20).text_color(c.text).child("Worktrees"))
      .child(h_flex().gap(G.xs).items_center().flex_none()
        .when(Boolean(this.phase), (el) => el.child(div().pr(G.xs).text_size(11).text_color(c.dim).child(this.phase)))
        .child(iconButton("wt-share", "share", "Share", (cx) => this.share.toggle(cx), c))
        .child(iconButton("wt-refresh", "refresh", "Scan again", (cx) => { if (!this.working) this.refresh(cx); }, c, { spin: scanning })));
  }

  skeleton(c, narrow) {
    const { block, row } = ghost(c);
    return breathe(v_flex().w_full().gap(narrow ? 36 : 48))
      .child(v_flex().gap(G.md).child(block(110, 12)).child(block(narrow ? 150 : 220, narrow ? 40 : 58, 6)).child(block(200, 11))
        .child(h_flex().gap(narrow ? G.xl : 48).pt(G.md).children([30, 46, 40, 30].map((w) => block(w, narrow ? 18 : 22, 4)))))
      .child(v_flex().w_full().child(h_flex().pb(G.sm).child(block(90, 12))).children([0, 1, 2, 3].map(row)))
      .child(v_flex().w_full().child(h_flex().pb(G.sm).child(block(70, 12))).children([0, 1, 2].map(row)));
  }

  hero(c, narrow) {
    const all = this.groups.flatMap((g) => g.items), live = all.filter((w) => !w.missing);
    const measured = [...live, ...this.orphans].some((w) => w.size);
    const total = [...live, ...this.orphans].reduce((n, w) => n + (w.size ?? 0), 0);
    const plan = this.plan(), freed = plan.reduce((n, w) => n + (w.size ?? 0), 0);
    const look = live.filter((w) => needsLook(w)).length;
    const gone = all.filter((w) => w.missing).length;
    const stats = [
      { value: String(live.length), unit: live.length === 1 ? "worktree" : "worktrees" },
      { value: String(this.groups.length), unit: this.groups.length === 1 ? "repository" : "repositories" },
      { value: String(look), unit: "need a look" },
      { value: String(gone), unit: gone === 1 ? "folder gone" : "folders gone" },
    ];
    const armed = this.armed.is("all"), busy = this.working === "all", can = plan.length > 0 && !this.working && this.done;
    const primary = Button.new("wt-clean").h(30).px(14).flex_none().items_center().rounded(6)
      .disabled(!can)
      .bg(can ? (armed ? c.red : c.primary) : c.subtle)
      .when(can, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)))
      .on_click((_e, cx) => { if (can) this.armed.press("all", cx, (cx) => this.cleanUp(cx)); })
      .child(div().text_size(12).font_medium().text_color(can ? (armed ? "#ffffff" : c.primaryText) : c.dim)
        .child(busy ? "Removing…" : armed ? `Press again to remove ${plan.length}` : `Clean up ${plan.length}`));
    const gist = !this.done ? "Clean up waits for the scan to finish."
      : plan.length ? `${freed ? `${fmtSize(freed)} of it` : `${plan.length} of them`} can go without losing anything.` : "Nothing can go without losing work.";
    return v_flex().w_full().gap(G.xl)
      .child(v_flex().gap(G.xs)
        .child(div().text_size(15).text_color(c.muted).child("On this computer"))
        .child(h_flex().flex_wrap().items_end().gap_x(G.md)
          .child(div().text_size(narrow ? 48 : 72).line_height(1).font_light().text_color(c.text).child(measured ? fmtSize(total) : String(live.length)))
          .child(div().pb(narrow ? 6 : 10).text_size(13).text_color(c.dim).child(measured ? "in worktrees" : "worktrees")))
        .child(div().text_size(15).text_color(c.dim).child(gist)))
      .child(h_flex().w_full().flex_wrap().gap_x(narrow ? G.xl : 48).gap_y(G.lg)
        .children(stats.map((s) => h_flex().items_end().gap(6)
          .child(div().text_size(narrow ? 22 : 28).line_height(1).font_light().text_color(c.text).child(s.value))
          .child(div().pb(3).text_size(12).text_color(c.dim).child(s.unit)))))
      .child(v_flex().w_full().gap(G.sm)
        .child(h_flex().w_full().flex_wrap().gap_x(G.lg).gap_y(G.sm).items_center()
          .child(primary)
          .child(div().text_size(12).text_color(armed ? c.red : c.dim)
            .child(armed ? "Merged branches go too; the others stay." : "Nothing uncommitted, every commit on a branch, idle a day.")))
        .when(Boolean(this.notice), (el) => el.child(div().text_size(12).text_color(c.muted).child(this.notice)))
        .when(Boolean(this.note), (el) => el.child(div().text_size(12).text_color(c.red).child(this.note))));
  }

  // One worktree, as PR draws a pull request in its list: the name, where and
  // when, its state in its color, and its size. A click opens what it holds
  // and what can be done with it.
  row(w, c) {
    const v = this.verdict(w, c), picked = this.picked === w.path, busy = this.working === w.path || Boolean(this.batch?.has(w.path));
    const age = fmtAge(w.last), when = age ? (age === "today" ? "last commit today" : `last commit ${age} ago`) : "";
    const meta = [w.orphan ? tilde(w.path) : w.branch && w.branch !== name(w.path) ? w.branch : !w.branch ? "detached HEAD" : "", when].filter(Boolean).join(" · ");
    const button = Button.new(`wt-${w.path}`).w_full().px(G.md).py(10).rounded(6).cursor_pointer()
      .selected(picked)
      .when(picked, (el) => el.bg(c.selected))
      .when(!picked, (el) => el.hover((s) => s.bg(c.subtle)))
      .when(busy, (el) => el.opacity(0.45))
      .accessibility_label(`${name(w.path)}, ${v.text}`)
      .on_click((_e, cx) => { this.picked = picked ? null : w.path; this.armed.clear(); cx.notify(); })
      .child(h_flex().w_full().items_start().gap(G.md)
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(div().w_full().truncate().text_size(14).text_color(c.text).when(picked, (e) => e.font_medium()).child(name(w.path)))
          .when(Boolean(meta), (el) => el.child(div().w_full().truncate().text_size(11.5).text_color(c.dim).child(meta)))
          .child(h_flex().w_full().min_w(0).gap(G.sm).items_center()
            .child(div().size(6).flex_none().rounded_full().bg(v.color).when(Boolean(v.pulse), (el) => breathe(el, PULSE)))
            .child(div().min_w(0).truncate().text_size(12).text_color(v.quiet || v.color === c.dim ? c.muted : v.color).child(busy ? "Removing…" : v.text))))
        .child(div().flex_none().text_size(15).font_light().text_color(c.text).child(fmtSize(w.size))));
    if (!picked) return button;
    const s = stateOf(w), key = `one:${w.path}`, armed = this.armed.is(key);
    const blocked = s === "open" ? "Close its tabs in Herdr to remove it." : s === "locked" ? "Locked: run git worktree unlock to remove it."
      : s === "broken" ? "Its .git points to where the repository used to be, so git can't read what it holds. Repair the link to check it like any other."
      : s === "checking" || !w.fresh ? "As the last scan saw it. Checking it again before it can be removed." : "";
    const text = consequence(w, this.groups.find((g) => g.repo === w.repo)?.base);
    const loses = text.startsWith("Loses") || w.orphan;
    return v_flex().w_full()
      .child(button)
      .child(v_flex().w_full().px(G.md).pt(G.xs).pb(G.md).gap(G.sm)
        .child(div().w_full().text_size(12).line_height(1.45).text_color(loses ? c.red : c.muted).child(blocked || text))
        .child(div().w_full().truncate().text_size(11).text_color(c.dim).child(tilde(w.path)))
        .child(h_flex().flex_wrap().gap_x(G.lg)
          .when(s === "broken", (el) => el.child(quietLink(`wt-repair-${w.path}`, this.working === w.path ? "Repairing…" : "Repair the link",
            (cx) => this.repair(w.path, cx), c, { color: c.text, disabled: Boolean(this.working) })))
          .when(!w.missing && s !== "broken", (el) => el.child(quietLink(`wt-explain-${w.path}`, "Explain it", () => this.ask(`Explain ${name(w.path)}`, w.path,
            explainPrompt(this.item(w.path) ?? w, this.groups.find((g) => g.repo === w.repo)?.base)), c, { color: c.text })))
          .when(!w.missing, (el) => el.child(quietLink(`wt-open-${w.path}`, "Open in a new tab", () => run("tab.new", { folder: w.path }), c)))
          .when(!blocked, (el) => el.child(quietLink(`wt-rm-${w.path}`, busy ? "Removing…" : armed ? "Press again to remove" : "Remove",
            (cx) => this.armed.press(key, cx, (cx) => this.remove(w.path, cx)), c, { color: armed ? c.red : c.text, disabled: Boolean(this.working) })))));
  }

  // A repository: its name and where it is, the rows that matter first, then
  // what can be done with all of them at once.
  group(id, title, where, items, c) {
    const missing = items.filter((w) => w.missing), shown = items.filter((w) => !w.missing)
      .toSorted((a, b) => (ORDER[stateOf(a)] ?? 9) - (ORDER[stateOf(b)] ?? 9) || (b.size ?? 0) - (a.size ?? 0));
    const open = this.more.has(id), rows = open ? shown : shown.slice(0, ROWS);
    const size = items.reduce((n, w) => n + (w.size ?? 0), 0), many = items.filter(removable);
    const key = `group:${id}`, armed = this.armed.is(key), lost = losses(many);
    const note = [`${shown.length || missing.length}`, fmtSize(size)].filter(Boolean).join(" · ");
    return v_flex().w_full().gap(2)
      .child(h_flex().w_full().items_end().justify_between().gap(G.md).pb(G.sm)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().w_full().truncate().text_size(15).text_color(c.text).child(title))
          .child(div().w_full().truncate().text_size(11.5).text_color(c.dim).child(where)))
        .child(div().flex_none().text_size(12).text_color(c.dim).child(note)))
      .children(rows.map((w) => this.row(w, c)))
      .when(armed, (el) => el.child(div().w_full().px(G.md).pt(G.xs).text_size(12).line_height(1.45).text_color(lost === "Nothing is lost." ? c.muted : c.red)
        .child(`${lost} Branches stay unless merged. Anything open in Herdr, locked or in use today stays.`)))
      .child(h_flex().w_full().flex_wrap().gap_x(G.lg).px(G.md).pt(G.xs)
        .when(shown.length > ROWS, (el) => el.child(quietLink(`wt-more-${id}`, open ? "Show fewer" : `Show ${shown.length - ROWS} more`,
          (cx) => { this.more = open ? new Set([...this.more].filter((x) => x !== id)) : new Set([...this.more, id]); cx.notify(); }, c)))
        .when(missing.length > 0, (el) => el.child(quietLink(`wt-prune-${id}`, `Prune ${missing.length} ${missing.length === 1 ? "record" : "records"} of ${missing.some((w) => w.replaced) ? "folders gone or reused" : missing.length === 1 ? "a folder already gone" : "folders already gone"}`,
          (cx) => this.prune(missing.map((w) => w.path), cx), c, { disabled: Boolean(this.working) })))
        .when(many.length > 1 && this.done, (el) => el.child(quietLink(`wt-all-${id}`, armed ? `Press again to remove ${many.length}` : `Remove all ${many.length}`,
          (cx) => this.armed.press(key, cx, (cx) => { this.markOpen(); this.removeAll(items.map((w) => this.item(w.path)).filter((w) => w && removable(w)), cx); }), c, { color: armed ? c.red : c.muted, disabled: Boolean(this.working) }))));
  }

  // A task for your agent, in a new tab in `folder`, as PR's "Ask your agent".
  ask(title, folder, prompt) {
    knownAgents({ on: null }).then((list) => {
      const agent = list.find((a) => a.installed);
      if (!agent) throw new Error("no agent is installed");
      run("tab.new", { name: title, space: spaces().find((s) => s.active)?.id, folder, argv: agent.run, task: prompt });
    }).catch((e) => notify({ title: "Could not start the agent", body: String(e?.message ?? e), level: "error" }));
  }

  // Bars a day for the last 30, drawn like Spend's chart: the top day in
  // the accent with its value. Drawn empty too, with a line on what fills it.
  bars(c, byDay, title, height, empty) {
    const days = lastDays(byDay), top = Math.max(0, ...days.map((d) => d.kb));
    return v_flex().w_full().gap(G.sm)
      .child(h_flex().w_full().items_end().justify_between()
        .child(div().text_size(12).text_color(c.muted).child(title))
        .child(div().text_size(11).text_color(c.dim).child(top ? `top ${fmtSize(top)}` : empty)))
      .child(h_flex().w_full().items_end()
        .children(days.map((d) => {
          const peak = top > 0 && d.kb === top;
          return v_flex().flex_1().min_w(0).h(height + 18).items_center().justify_end().gap(4)
            .tooltip(`${shortDate(d.at)} · ${d.kb ? fmtSize(d.kb) : "nothing"}`)
            .when(peak, (e) => e.child(div().text_size(10).text_color(c.text).whitespace_nowrap().child(fmtSize(d.kb))))
            .child(div().w(peak ? 3 : 2).flex_none().rounded_t(1)
              .h(d.kb ? Math.max(3, Math.round((d.kb / top) * height)) : 1)
              .bg(peak ? c.accent : d.kb ? c.muted : c.border)
              .opacity(peak || !d.kb ? 1 : 0.55));
        })))
      .child(h_flex().w_full().justify_between()
        .child(div().text_size(10).text_color(c.dim).child(shortDate(days[0].at)))
        .child(div().text_size(10).text_color(c.dim).child("Today")));
  }

  // Where the disk goes now: one bar split by state, its legend, and the
  // repositories that take the most.
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
      .child(h_flex().w_full().h(10).rounded(5).overflow_hidden().gap(2)
        .children(parts.filter((p) => p.kb > 0).map((p) => div().h_full().w(pct(p.kb)).flex_shrink_0().bg(color[p.key]).opacity(p.key === "checking" ? 1 : 0.85)
          .tooltip(`${p.label}: ${fmtSize(p.kb)}`))))
      .child(v_flex().w_full().gap(6)
        .children(parts.map((p) => h_flex().w_full().items_center().gap(G.sm)
          .child(div().size(8).flex_none().rounded_full().bg(color[p.key]))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(c.text).child(p.label))
          .child(div().text_size(11).text_color(c.dim).child(`${p.count}`))
          .child(div().w(64).flex_none().text_right().text_size(13).font_light().text_color(c.text).child(fmtSize(p.kb) || "0 KB"))
          .child(div().w(36).flex_none().text_right().text_size(11).text_color(c.dim).child(`${Math.round((p.kb / total) * 100)}%`)))))
      .when(repos.length > 1, (el) => el.child(v_flex().w_full().gap(G.sm).pt(G.sm)
        .child(div().text_size(12).text_color(c.muted).child("The repositories that take the most"))
        .children(repos.map((r) => v_flex().w_full().gap(4)
          .child(h_flex().w_full().items_end().gap(G.sm)
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(c.text).child(r.name))
            .child(div().text_size(11).text_color(c.dim).child(`${r.count}`))
            .child(div().w(64).flex_none().text_right().text_size(13).font_light().text_color(c.text).child(fmtSize(r.kb))))
          .child(div().w_full().h(4).rounded(2).bg(c.border)
            .child(div().h_full().w(`${Math.max(1, (r.kb / most) * 100).toFixed(2)}%`).rounded(2).bg(c.muted)))))));
  }

  // The history: what was freed (by Clean up and Remove, or by anything
  // else), the counts, a bar a day of what was freed, and of what the
  // worktrees took on disk.
  freed(c, narrow) {
    const h = this.hist;
    if (!h) return v_flex().w_full().child(section(c, "Freed"))
      .child(div().text_size(12).text_color(this.storeNote ? c.red : c.dim).child(this.storeNote ?? "Reading the history…"));
    const freedBars = this.bars(c, h.freedByDay, "Freed each day", 96, "fills as you remove")
      , diskBars = this.bars(c, h.diskByDay, "In worktrees each day", 56, "a bar per day with a scan");
    const stats = [
      { value: String(h.worktrees), unit: h.worktrees === 1 ? "worktree removed" : "worktrees removed" },
      { value: String(h.branches), unit: h.branches === 1 ? "merged branch deleted" : "merged branches deleted" },
      { value: String(h.records + h.orphans), unit: "leftovers cleared" },
    ];
    const outside = h.kb - h.kanso;
    return v_flex().w_full().gap(G.lg)
      .child(section(c, "Freed", h.since ? `since ${shortDate(h.since)}` : ""))
      .child(v_flex().gap(G.xs)
        .child(h_flex().flex_wrap().items_end().gap_x(G.md)
          .child(div().text_size(narrow ? 36 : 48).line_height(1).font_light().text_color(c.text).child(fmtSize(h.kb) || "0 KB"))
          .child(div().pb(narrow ? 4 : 7).text_size(13).text_color(c.dim).child("of disk freed")))
        .child(div().text_size(12).text_color(c.dim).child(!h.kb
          ? "Nothing freed yet. Every scan is kept: what Clean up, Remove or anything else frees adds up here."
          : outside > 0 ? `${fmtSize(h.kanso) || "0 KB"} here, ${fmtSize(outside)} removed outside the panel since a scan saw them.` : "All of it from this panel.")))
      .when(h.kb > 0 || h.records + h.orphans > 0, (el) => el.child(h_flex().w_full().flex_wrap().gap_x(narrow ? G.xl : 48).gap_y(G.md)
        .children(stats.map((s) => h_flex().items_end().gap(6)
          .child(div().text_size(narrow ? 20 : 24).line_height(1).font_light().text_color(c.text).child(s.value))
          .child(div().pb(2).text_size(12).text_color(c.dim).child(s.unit))))))
      .child(freedBars)
      .child(diskBars);
  }

  // The ones that need a look, handed to your agent to sort out.
  agent(c) {
    const look = this.groups.flatMap((g) => g.items).filter((w) => needsLook(w));
    if (!look.length) return null;
    const baseOf = (w) => this.groups.find((g) => g.repo === w.repo)?.base;
    return v_flex().w_full()
      .child(section(c, "Ask your agent", "in a new tab"))
      .child(div().text_size(12).text_color(c.dim).pb(G.xs)
        .child(`${look.length} would lose work if removed. Your agent can find out what that work is and whether it already lives somewhere else.`))
      .child(h_flex().w_full().flex_wrap().gap_x(G.lg).gap_y(G.xs)
        .child(quietLink("wt-review", `Review the ${look.length} that need a look`, () => this.ask("Worktrees review", home(), reviewPrompt(look, baseOf)), c, { size: 13, color: c.text })));
  }

  // The last scan's totals, for a card before anything was freed.
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

  // The scanned page: the numbers, the space, what was freed, then each repository.
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
      .child(div().text_size(10.5).text_color(c.dim)
        .child(`Searches ${this.roots().roots.map(tilde).join(", ") || "your spaces"} and the temp folders, then asks each repository where its worktrees are.${this.scannedAt ? ` Scanned ${new Date(this.scannedAt).toTimeString().slice(0, 5)}.` : ""}`));
  }

  render(cx) {
    const c = tokens(theme()), narrow = (this.width || 368) < 560;
    this.markOpen();
    const scanned = this.groups.length > 0 || this.orphans.length > 0;
    const groups = this.groups.toSorted((a, b) => this.done
      ? b.items.reduce((n, w) => n + (w.size ?? 0), 0) - a.items.reduce((n, w) => n + (w.size ?? 0), 0)
      : b.items.length - a.items.length);
    const shown = this.allRepos ? groups : groups.slice(0, REPOS);
    const body = !scanned && this.phase ? this.skeleton(c, narrow)
      : !scanned ? v_flex().w_full().gap(G.sm)
        .child(div().text_size(15).text_color(this.note ? c.red : c.muted).child(this.note ? "The scan failed." : "No worktrees besides your checkouts."))
        .child(div().text_size(12).text_color(c.dim).child(this.note ?? "Nothing left behind either."))
        : this.page(c, narrow, groups, shown);
    return v_flex().id("kanso-worktrees").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar()
      .on_size_change((size, sizeCx) => { if (Math.abs((this.width || 0) - size.width) >= 1) { this.width = size.width; sizeCx.notify(); } })
      .child(h_flex().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28)
        .child(v_flex().w_full().max_w(1080).gap(narrow ? 32 : 44)
          .child(this.header(c, narrow))
          .when(this.share.open, (el) => el.child(this.share.row(c, () => this.shareCard(),
            (this.hist?.kb ?? 0) > 0 ? "Only the totals: how much was freed, how many were removed, and the days. Never a repository, branch or folder name."
              : "Nothing freed yet, so it shares what the worktrees take now: totals only, never a repository, branch or folder name.", G.sm)))
          .child(body)));
  }
}

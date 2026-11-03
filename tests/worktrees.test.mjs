import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { load, context, temporary, clone, exec } from "./helpers.mjs";

const names = ["Worktrees", "removable", "losses", "rootsFor", "parseDiscovery", "basesFrom", "parseWorktrees", "parseProbe", "stateOf", "safe", "consequence", "fmtSize", "fmtAge", "inside"];
const worktrees = (host = {}) => load("kanso-panel/worktrees.js", names, {
  exec, spaces: () => [], panes: () => [], home: () => "/Users/me", run() {}, theme: () => ({}), shared: () => null, notify() {}, ...host,
});
const git = async (cwd, ...args) => {
  const r = await exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd });
  assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const exists = (p) => stat(p).then(() => true, () => false);

test("Worktrees searches the top folders of your spaces, or the ones you chose", async () => {
  const { rootsFor, inside } = await worktrees();
  assert.deepEqual(clone(rootsFor(["/Users/me/Apps/acme/web", "/Users/me/Apps/x", "/Users/me", "/Users/me/.config/a", "/Volumes/w/repo", "/private/tmp/x", null], "/Users/me")),
    ["/Users/me/Apps", "/Volumes/w/repo"], "home itself, hidden folders and temp are not roots");
  assert.deepEqual(clone(rootsFor(["/Users/me/Apps/a"], "/Users/me", ["/src", "rel", "/src"])), ["/src"]);
  assert.ok(inside("/private/tmp/wt", "/tmp/wt/src"), "/tmp is /private/tmp");
  assert.ok(!inside("/a/wt", "/a/wt2"));
});

test("Worktrees parses git's worktree list and the probes", async () => {
  const { parseWorktrees, parseProbe, basesFrom, parseDiscovery } = await worktrees();
  const list = clone(parseWorktrees("worktree /r\0HEAD a\0branch refs/heads/main\0\0worktree /w1\0HEAD b\0detached\0locked\0\0worktree /w2\0HEAD c\0branch refs/heads/feat/x\0prunable gitdir file points to non-existent location\0\0"));
  assert.deepEqual(list.map((w) => [w.path, w.main, w.branch, w.detached, w.locked, w.prunable]),
    [["/r", true, "main", false, false, false], ["/w1", false, null, true, true, false], ["/w2", false, "feat/x", false, false, true]]);
  assert.deepEqual(clone(parseProbe("recent\nonly\t1\ndirty\t3\nlast\t100\nmerged\nahead\t2\n")), { gone: false, dirty: 3, last: 100000, ahead: 2, merged: true, recent: true, only: 1 });
  assert.equal(parseProbe("gone\n").gone, true);
  assert.deepEqual(clone(basesFrom("origin/main\nmain\norigin/master\n")), ["origin/main", "main"]);
  assert.deepEqual(clone(basesFrom("master\n")), ["master"]);
  assert.deepEqual(clone(parseDiscovery("R\t/a\nO\t/tmp/x\n\nnoise")), { repos: ["/a"], orphans: ["/tmp/x"] });
});

test("Worktrees says what removing loses, and only cleans up what loses nothing", async () => {
  const { stateOf, safe, consequence, removable, losses } = await worktrees();
  const w = (o) => ({ probed: true, branch: "b", dirty: 0, ahead: 0, only: 0, merged: false, recent: false, ...o });
  assert.equal(stateOf(w({ merged: true })), "merged");
  assert.equal(stateOf(w({ merged: true, dirty: 2 })), "changes", "uncommitted work beats merged");
  assert.equal(stateOf(w({ merged: true, open: true })), "open");
  assert.equal(stateOf(w({ merged: true, recent: true })), "recent", "touched today: an agent may be at work");
  assert.equal(stateOf(w({ branch: null, ahead: 2, only: 2 })), "lost");
  assert.equal(stateOf(w({ branch: null, ahead: 2 })), "detached", "its commits are on a branch");
  assert.equal(stateOf(w({ ahead: 2 })), "unmerged");
  assert.deepEqual([w({ merged: true }), w({ missing: true }), w({ ahead: 1 }), w({ branch: null, ahead: 1 }),
    w({ merged: true, open: true }), w({ merged: true, locked: true }), w({ merged: true, dirty: 1 }), w({ branch: null, only: 1 }), w({ recent: true }), w({ probed: false })].map(safe),
  [true, true, true, true, false, false, false, false, false, false]);
  assert.match(consequence(w({ dirty: 2, ahead: 3 }), "main"), /^Loses 2 uncommitted changes\. Branch b stays with its 3 commits\.$/);
  assert.match(consequence(w({ merged: true }), "main"), /Nothing is lost\. Branch b goes too: its work is in main\./);
  assert.match(consequence(w({ branch: null, ahead: 1, only: 1 }), "main"), /Loses 1 commit no branch has/);
  assert.deepEqual([w({ dirty: 1 }), w({ branch: null, only: 2 }), w({ recent: true }), w({ open: true }), w({ locked: true }), w({ probed: false }), { orphan: true }].map(removable),
    [true, true, false, false, false, false, true], "Remove all asks first, and still leaves what may be in use");
  assert.equal(losses([w({ dirty: 2 }), w({ dirty: 1 }), w({ branch: null, only: 3 }), { orphan: true }]),
    "Loses 3 uncommitted changes in 2; 3 commits no branch has, in 1; whatever is in a folder git no longer knows.");
  assert.equal(losses([w({ merged: true })]), "Nothing is lost.");
});

test("Worktrees finds every kind in a real repository and cleans up the safe ones", async (t) => {
  const dir = await temporary(t), root = join(dir, "Apps"), repo = join(root, "acme"), far = join(dir, "far");
  await mkdir(repo, { recursive: true }); await mkdir(far);
  await git(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "a.txt"), "a\n"); await git(repo, "add", "."); await git(repo, "commit", "-qm", "a");
  const add = async (n, ...extra) => { await git(repo, "worktree", "add", "-q", ...extra, join(far, n)); return join(far, n); };
  // Merged: its commit is in main. Squashed: main got the same change as one commit.
  const merged = await add("merged", "-b", "merged");
  await writeFile(join(merged, "m.txt"), "m\n"); await git(merged, "add", "."); await git(merged, "commit", "-qm", "m");
  await git(repo, "merge", "-q", "--ff-only", "merged");
  const squashed = await add("squashed", "-b", "squashed");
  await writeFile(join(squashed, "s.txt"), "s\n"); await git(squashed, "add", "."); await git(squashed, "commit", "-qm", "s1");
  await writeFile(join(squashed, "s2.txt"), "s\n"); await git(squashed, "add", "."); await git(squashed, "commit", "-qm", "s2");
  await git(repo, "merge", "-q", "--squash", "squashed"); await git(repo, "commit", "-qm", "squash");
  const unmerged = await add("unmerged", "-b", "unmerged");
  await writeFile(join(unmerged, "u.txt"), "u\n"); await git(unmerged, "add", "."); await git(unmerged, "commit", "-qm", "u");
  const dirty = await add("dirty", "-b", "dirty");
  await writeFile(join(dirty, "new.txt"), "wip\n");
  // Detached on a commit only it has (lost if removed), and on one a branch has.
  const lost = await add("lost", "--detach");
  await writeFile(join(lost, "d.txt"), "d\n"); await git(lost, "add", "."); await git(lost, "commit", "-qm", "d");
  const detached = join(far, "detached");
  await git(repo, "worktree", "add", "-q", "--detach", detached, "unmerged");
  const open = await add("open", "-b", "open");
  const gone = await add("gone", "-b", "gone"); await rm(gone, { recursive: true });
  // A folder whose worktree record was deleted under it.
  const orphan = join(root, "leftover");
  await mkdir(orphan); await writeFile(join(orphan, ".git"), `gitdir: ${join(dir, "deleted/.git/worktrees/leftover")}\n`);

  const notes = [], settings = { "kanso.worktrees.roots": [root] };
  const host = (extra) => worktrees({
    home: () => dir, shared: (k) => settings[k] ?? null,
    spaces: () => [{ folder: repo }], panes: () => [{ cwd: join(open, "src") }], notify: (n) => notes.push(n), ...extra,
  });
  const { cx, drain } = context();
  const { Worktrees, stateOf, removable } = await host();

  // Everything here was touched a moment ago: Clean up leaves it all but the record of a gone folder.
  const busy = new Worktrees();
  busy.init(cx); await drain();
  assert.deepEqual(clone(busy.plan().map((w) => w.path.split("/").pop())), ["gone"]);
  assert.equal(stateOf(busy.groups[0].items.find((w) => w.path.endsWith("/merged"))), "recent");

  settings["kanso.worktrees.idleHours"] = 0;
  const panel = new Worktrees();
  panel.init(cx); await drain();
  assert.equal(panel.note, null);
  assert.equal(panel.groups.length, 1);
  const g = panel.groups[0], by = Object.fromEntries(g.items.map((w) => [w.path.split("/").pop(), w]));
  assert.deepEqual(Object.fromEntries(Object.entries(by).map(([k, w]) => [k, stateOf(w)])), {
    merged: "merged", squashed: "merged", unmerged: "unmerged", dirty: "changes", lost: "lost", detached: "detached", open: "open", gone: "missing",
  });
  assert.equal(g.base, "main");
  assert.ok(by.merged.size > 0, "measured");
  assert.deepEqual(clone(panel.orphans.map((o) => o.path)), [orphan]);

  assert.deepEqual(clone(panel.plan().map((w) => w.path.split("/").pop()).sort()), ["detached", "gone", "merged", "squashed", "unmerged"]);
  panel.cleanUp(cx); await drain();
  assert.equal(panel.note, null);
  assert.equal(notes[0].title, "Removed 5 worktrees");
  assert.ok(![merged, squashed, unmerged, detached].some((p) => existsSync(p)), "folders removed");
  assert.ok(await exists(dirty) && await exists(lost) && await exists(open), "the rest stay");
  const branches = (await git(repo, "branch", "--format=%(refname:short)")).split("\n").sort();
  assert.deepEqual(branches, ["dirty", "gone", "main", "open", "unmerged"], "merged branches go; an unmerged one keeps its commits");

  assert.ok(!(await git(repo, "worktree", "list")).includes("/gone"), "pruned");

  // One at a time, after a confirmation: an open one is refused.
  panel.remove(by.open, cx); await drain();
  assert.ok(await exists(open), "open in Herdr: never removed");
  panel.remove(by.dirty, cx); await drain();
  assert.ok(!(await exists(dirty)), "uncommitted work goes only when confirmed");
  panel.remove(panel.orphans[0], cx); await drain();
  assert.ok(!(await exists(orphan)), "orphan folder deleted");
  assert.deepEqual(clone(panel.groups[0].items.map((w) => w.path.split("/").pop()).sort()), ["lost", "open"]);

  // Remove all: the commit only "lost" had goes with it; the open one stays.
  panel.removeAll(panel.groups[0].items.filter(removable), cx); await drain();
  assert.ok(!existsSync(lost) && existsSync(open));
  assert.deepEqual(clone(panel.groups[0].items.map((w) => w.path.split("/").pop())), ["open"]);
});

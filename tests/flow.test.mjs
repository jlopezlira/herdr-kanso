// Cmd+J, the header's digest, Send to an agent, Arrangements and Ports.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { load, clone, temporary, exec } from "./helpers.mjs";

const HOME = "/Users/me";

test("Cmd+J goes to a blocked agent first, then one that finished, and moves on from the focused one", async () => {
  const { nextNeedsYou } = await load("kanso-strip/main.js", ["nextNeedsYou"]);
  const a = (address, status) => ({ address, status });
  const list = [a("t1", "working"), a("t2", "done"), a("t3", "blocked"), a("t4", "idle"), a("t5", "blocked"), a("t6", "done")];
  assert.equal(nextNeedsYou(list, "t1").address, "t3", "blocked before done");
  assert.equal(nextNeedsYou(list, "t3").address, "t5", "the next blocked one after the focused one");
  assert.equal(nextNeedsYou(list, "t5").address, "t3", "wraps round");
  const one = [a("t1", "blocked"), a("t2", "done"), a("t3", "done")];
  assert.equal(nextNeedsYou(one, "t1").address, "t2", "the focused blocked one is never its own next: the done ones come");
  assert.equal(nextNeedsYou(one, "t2").address, "t1");
  assert.equal(nextNeedsYou([a("t1", "working"), a("t2", "idle")], "t1"), null, "nobody needs you");
});

test("The digest reads changed files, lines, commits and checks", async () => {
  const { parseShortstat, checksOf, digestTip } = await load("kanso-strip/main.js", ["parseShortstat", "checksOf", "digestTip"]);
  assert.deepEqual(clone(parseShortstat(" 3 files changed, 120 insertions(+), 30 deletions(-)\n")), { add: 120, del: 30 });
  assert.deepEqual(clone(parseShortstat(" 1 file changed, 1 insertion(+)\n")), { add: 1, del: 0 });
  assert.deepEqual(clone(parseShortstat("")), { add: 0, del: 0 });
  assert.equal(checksOf([]), null);
  assert.equal(checksOf([{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "SUCCESS" }]), "passing");
  assert.equal(checksOf([{ status: "IN_PROGRESS", conclusion: "" }, { conclusion: "SUCCESS" }]), "running");
  assert.equal(checksOf([{ conclusion: "FAILURE" }, { status: "IN_PROGRESS" }]), "failing", "a failure wins over one still running");
  assert.equal(checksOf([{ conclusion: "SKIPPED" }, { conclusion: "NEUTRAL" }]), "passing");
  assert.equal(digestTip({ files: 0, ahead: 0, pr: null }), "");
  assert.equal(digestTip({ files: 2, add: 5, del: 1, ahead: 1, pushed: true, pr: { number: 41, state: "OPEN", checks: "failing" } }),
    "In its folder now: 2 changed files (+5 −1); 1 commit not pushed; pull request #41, checks failing.");
});

test("The digest of a real repository: uncommitted files, lines and commits on the branch", async (t) => {
  const { readDigest } = await load("kanso-strip/main.js", ["readDigest"]);
  const dir = await temporary(t);
  const git = (...args) => exec("git", ["-C", dir, ...args]);
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await writeFile(join(dir, "a.txt"), "one\ntwo\n");
  await git("add", "a.txt");
  await git("commit", "-q", "-m", "first");
  await writeFile(join(dir, "a.txt"), "one\nthree\nfour\n");
  await writeFile(join(dir, "new.txt"), "new\n");
  const run = async (cmd, args, cwd) => { const r = await exec(cmd, args, { cwd }); return r.code === 0 ? r.stdout : null; };
  const d = clone(await readDigest(dir, run));
  assert.equal(d.files, 2, "a changed file and an untracked one");
  assert.equal(d.add, 2);
  assert.equal(d.del, 1);
  assert.equal(d.ahead, 0, "no upstream and no origin: nothing to count against");
  assert.equal(d.pr, null);
  assert.equal(await readDigest(join(dir, ".git"), run), null, "outside a work tree: nothing");
});

test("Send to an agent lists every other agent, the last one you sent to first, and drafts where the work is", async () => {
  const { targetsOf, draftFor } = await load("kanso-send/main.js", ["targetsOf", "draftFor"], { home: () => HOME });
  const p = (pane, terminal, agent, status = null) => ({ pane, terminal, status, program: { agent } });
  const all = [p("p1", "t1", true, "done"), p("p2", "t2", false), p("p3", "t3", true, "working"), p("p4", "t4", true, "idle"), { pane: "p5", terminal: null, mod: "x" }];
  assert.deepEqual(clone(targetsOf(all, "p1", null).map((q) => q.pane)), ["p3", "p4"], "not itself, not a shell, not a mod pane");
  assert.deepEqual(clone(targetsOf(all, "p1", "t4").map((q) => q.pane)), ["p4", "p3"], "the last one you sent to first");
  assert.equal(draftFor({ cwd: `${HOME}/Apps/web`, branch: "feat/login" }, { pr: { number: 7 } }),
    "Review the changes on branch feat/login in ~/Apps/web. Its pull request is #7.");
  assert.equal(draftFor({ cwd: `${HOME}/Apps/web`, branch: null }, null), "Review the changes in ~/Apps/web.");
});

test("An arrangement keeps what each pane runs with its flags, without the session it resumed", async () => {
  const { cleanArgv, commandOf, captureTab, summary } = await load("kanso-arrange/main.js", ["cleanArgv", "commandOf", "captureTab", "summary"], { home: () => HOME });
  assert.deepEqual(clone(cleanArgv(["claude", "--model", "opus", "--resume", "51fb0c9a", "--effort", "high"])), ["claude", "--model", "opus", "--effort", "high"]);
  assert.deepEqual(clone(cleanArgv(["claude", "-c", "--model=sonnet"])), ["claude", "--model=sonnet"]);
  assert.deepEqual(clone(cleanArgv(["claude", "--resume"])), ["claude"], "an interactive resume with no id");
  assert.deepEqual(clone(cleanArgv(["codex", "resume", "0199a", "-m", "gpt-5.5"])), ["codex", "-m", "gpt-5.5"]);
  assert.deepEqual(clone(cleanArgv(["codex", "-c", "model_reasoning_effort=high"])), ["codex", "-c", "model_reasoning_effort=high"], "Codex's -c is its config, kept");
  assert.equal(commandOf({ argv: ["/bin/zsh", "-l"], foreground: { argv: ["-zsh"], cwd: HOME } }), null, "a shell at its prompt");
  assert.equal(commandOf({ argv: ["/bin/zsh", "-l"], foreground: null }), null);
  assert.equal(commandOf({ argv: ["/bin/zsh", "-l"], foreground: { argv: ["/bin/zsh", "-l"] } }), null, "the shell itself in the foreground");
  assert.deepEqual(clone(commandOf({ argv: ["claude", "--model", "opus"], foreground: { argv: ["claude", "--model", "opus"] } })), ["claude", "--model", "opus"],
    "a terminal opened with the program itself (as an arrangement opens them)");
  assert.deepEqual(clone(commandOf({ argv: ["/bin/zsh", "-l"], foreground: { argv: ["npm", "run", "dev"] } })), ["npm", "run", "dev"]);
  const panes = [{ pane: "a", terminal: "t1", cwd: `${HOME}/web` }, { pane: "b", terminal: "t2", cwd: `${HOME}/web` }, { pane: "c", terminal: "t3", cwd: `${HOME}/web/api` }];
  const recs = new Map([
    ["t1", { argv: ["/bin/zsh"], foreground: { argv: ["claude", "--model", "opus", "--resume", "x1"], cwd: `${HOME}/web` } }],
    ["t2", { argv: ["/bin/zsh"], foreground: { argv: ["codex", "-m", "gpt-5.5"], cwd: `${HOME}/web` } }],
    ["t3", { argv: ["/bin/zsh"], foreground: { argv: ["zsh"], cwd: `${HOME}/web/api` } }],
  ]);
  const a = clone(captureTab({ n: 3, cols: [{ panes: ["a"], w: 0.5 }, { panes: ["b", "c"], w: 0.25 }] }, panes, recs));
  assert.deepEqual(a, { per: 3, cols: [
    { w: 0.5, panes: [{ argv: ["claude", "--model", "opus"], cwd: `${HOME}/web` }] },
    { w: 0.25, panes: [{ argv: ["codex", "-m", "gpt-5.5"], cwd: `${HOME}/web` }, { argv: null, cwd: `${HOME}/web/api` }] },
  ] });
  assert.equal(summary(a), "claude, codex, shell");
  assert.equal(clone(captureTab(undefined, panes.slice(0, 2), recs)).cols.length, 2, "a tab the strip never saw: one column per pane");
});

test("Ports finds dev servers, the pane that runs each, and the ones no pane owns", async () => {
  const { parseListen, parseCwds, parsePs, etimeSecs, servers, shortArgs } = await load("kanso-panel/ports.js",
    ["parseListen", "parseCwds", "parsePs", "etimeSecs", "servers", "shortArgs"], { home: () => HOME });
  const listen = parseListen("p100\ncnode\nf20\nn*:3000\nf21\nn[::1]:3000\np200\ncpython3\nf5\nn127.0.0.1:8000\np300\ncControlCenter\nf10\nn*:7000\np400\ncnode\nf9\nn*:5173\n");
  assert.deepEqual(clone(listen.get(100)), { pid: 100, command: "node", ports: [3000] }, "IPv4 and IPv6 sockets: one port");
  const cwds = parseCwds(`p100\nfcwd\nn${HOME}/web\np200\nfcwd\nn${HOME}/api\np300\nfcwd\nn/\np400\nfcwd\nn${HOME}/Library/Application Support/x\n`);
  const ps = parsePs([
    "  100    90    01:02:03 /usr/local/bin/node /Users/me/web/node_modules/.bin/next dev",
    "   90    80       05:00 npm run dev",
    "   80     1 2-00:00:00 /bin/zsh -l",
    "  200     1       10:00 python3 manage.py runserver",
    "  300     1    1:00:00 /System/Library/ControlCenter",
    "  400     1       01:00 node helper",
  ].join("\n"));
  assert.equal(etimeSecs("2-00:00:00"), 172800);
  assert.equal(etimeSecs("01:02:03"), 3723);
  assert.equal(etimeSecs("05:00"), 300);
  const list = clone(servers(listen, cwds, ps, new Map([[80, "t7"]]), HOME));
  assert.deepEqual(list.map((s) => [s.pid, s.owner]), [[200, null], [100, "t7"]], "no pane first; apps and ~/Library left out");
  assert.equal(list[1].secs, 3723);
  assert.equal(shortArgs("/usr/local/bin/node /Users/me/web/node_modules/.bin/next dev"), "node /Users/me/web/node_modules/.bin/next dev");
});

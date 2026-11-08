// Cmd+J, the header's digest, Send to an agent, Arrangements and Ports.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { load, clone, temporary, exec, singleUse } from "./helpers.mjs";

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
  const { cleanArgv, commandOf, captureTab, summary } = await load("kanso-arrange/tabkit.js", ["cleanArgv", "commandOf", "captureTab", "summary"], { home: () => HOME });
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
  assert.equal(summary({ cols: [{ panes: [{ argv: ["/opt/node/bin/node", "/opt/nvm/bin/codex", "-m", "x"] }, { argv: ["node", "--inspect"] }] }] }), "codex, node", "a runtime is named by the script it runs");
  assert.equal(clone(captureTab(undefined, panes.slice(0, 2), recs)).cols.length, 2, "a tab the strip never saw: one column per pane");
});

test("Arrangements from every project are listed, and one from another project opens in the folder you are in", async () => {
  const { listFor, rebase, originOf } = await load("kanso-arrange/main.js", ["listFor", "rebase", "originOf"], { home: () => HOME });
  const mk = (name, saved, cwd) => ({ name, saved, per: 2, cols: [{ w: 0.5, panes: [{ argv: ["claude", "--model", "opus"], cwd }] }, { w: 0.5, panes: [{ argv: null, cwd: `${cwd}/api` }, { argv: ["grok"], cwd }] }] });
  const projects = {
    [`:${HOME}/web`]: [mk("web", 1, `${HOME}/web`)],
    [`:${HOME}/shop`]: [mk("old", 2, `${HOME}/shop`), mk("factory", 9, `${HOME}/agile`)],
  };
  const { mine, others } = clone(listFor(projects, `:${HOME}/web`));
  assert.deepEqual(mine.map((a) => [a.name, a.from]), [["web", `:${HOME}/web`]]);
  assert.deepEqual(others.map((a) => a.name), ["factory", "old"], "other projects', newest first");
  assert.equal(others[0].from, `:${HOME}/shop`, "each keeps the project it was saved in, to delete it there");
  assert.deepEqual(clone(listFor(projects, `:${HOME}/new`)).mine, [], "a new project still sees every arrangement as another project's");
  assert.equal(clone(listFor(projects, `:${HOME}/new`)).others.length, 3);
  assert.equal(originOf(others[0]), "agile", "named by the folder its panes ran in");
  assert.equal(originOf({ from: `:${HOME}/shop`, cols: [{ panes: [{ argv: null, cwd: null }] }] }), "shop");
  const r = clone(rebase(others[0], `${HOME}/new`));
  assert.deepEqual(r.cols.flatMap((c) => c.panes.map((p) => p.cwd)), [`${HOME}/new`, `${HOME}/new`, `${HOME}/new`]);
  assert.deepEqual(r.cols.map((c) => [c.w, c.panes.map((p) => p.argv)]), [[0.5, [["claude", "--model", "opus"]]], [0.5, [null, ["grok"]]]], "the same programs, flags and widths");
  assert.equal(others[0].cols[0].panes[0].cwd, `${HOME}/agile`, "the saved arrangement is left as it was");
});

test("Arrangements are kept in SQLite: saving under a name overwrites it, and the old JSON file is read in once", async (t) => {
  const dir = await temporary(t);
  await import("node:fs/promises").then((fs) => fs.mkdir(join(dir, "data"), { recursive: true }));
  const cols = (prog) => [{ w: 1, panes: [{ argv: [prog], cwd: `${HOME}/web` }] }];
  await writeFile(join(dir, "data", "kanso-arrange.json"), JSON.stringify({ version: 1, projects: {
    [`:${HOME}/web`]: [{ name: "it's mine", per: 2, cols: cols("claude"), saved: 5 }, { name: "broken" }],
  } }));
  const { readFile } = await import("node:fs/promises");
  const host = { exec, appHome: () => dir, readTextFile: (p) => readFile(p, "utf8").catch(() => null) };
  const { Store } = await load("kanso-arrange/store.js", ["Store"], host);
  const store = new Store();
  let all = clone(await store.all());
  assert.deepEqual(all, { [`:${HOME}/web`]: [{ name: "it's mine", per: 2, cols: cols("claude"), saved: 5 }] }, "the JSON file read in, a quote in a name kept, a broken entry skipped");
  all = clone(await store.save(`:${HOME}/web`, { name: "it's mine", per: 3, cols: cols("codex"), saved: 9 }));
  assert.deepEqual(all[`:${HOME}/web`], [{ name: "it's mine", per: 3, cols: cols("codex"), saved: 9 }], "the same name in the same project overwrites");
  all = clone(await store.save(`:${HOME}/shop`, { name: "it's mine", per: 1, cols: cols("grok"), saved: 10 }));
  assert.equal(Object.keys(all).length, 2, "the same name in another project is its own arrangement");
  const again = new Store();
  assert.equal(clone(await again.all())[`:${HOME}/web`][0].per, 3, "the JSON file is not read in a second time over a newer row");
  all = clone(await again.remove(`:${HOME}/shop`, "it's mine"));
  assert.deepEqual(Object.keys(all), [`:${HOME}/web`]);
});

test("Sleep keeps each Claude agent's conversation, and Wake starts it on that conversation", async (t) => {
  const { wakeArgv, wakeable, sleepers, sleepBlocker, isResumed } = await load("kanso-sleep/main.js", ["wakeArgv", "wakeable", "sleepers", "sleepBlocker", "isResumed"], { home: () => HOME });
  const { captureTab } = await load("kanso-arrange/tabkit.js", ["captureTab"], { home: () => HOME });
  assert.deepEqual(clone(wakeArgv({ argv: ["claude", "--model", "opus", "--resume", "old"], resume: "s1" })), ["claude", "--model", "opus", "--resume", "s1"], "the conversation it had when it slept, not the one it was started with");
  assert.deepEqual(clone(wakeArgv({ argv: ["npm", "run", "dev"], resume: null })), ["npm", "run", "dev"]);
  assert.equal(wakeArgv({ argv: null }), null, "a shell stays a shell");
  const a = { name: "shield", per: 3, cols: [{ w: 0.5, panes: [{ argv: ["claude"], cwd: "/w", resume: "s1", name: "fury" }] }, { w: 0.5, panes: [{ argv: ["npm", "run", "dev"], cwd: "/w", resume: null, name: null }] }] };
  assert.equal(sleepers(a), "fury, npm");
  assert.deepEqual(clone(wakeable(a).cols.map((c) => c.panes[0].argv)), [["claude", "--resume", "s1"], ["npm", "run", "dev"]]);
  assert.equal(sleepBlocker(new Map([["t1", { status: { state: "done" } }], ["t2", { labels: { "kanso.name": "Cap" }, status: { state: "working" } }]])), "Cap is working");
  assert.equal(sleepBlocker(new Map([["t1", { title: "tony", status: { state: "blocked" } }]])), "tony is waiting on you");
  assert.equal(sleepBlocker(new Map([["t1", { status: { state: "idle" } }]])), null);
  const cap = clone(captureTab(null, [{ pane: "a", terminal: "t1", cwd: "/w" }], new Map([["t1", { foreground: { argv: ["claude"], cwd: "/w", pid: 9 } }]]), new Map([["t1", { resume: "s1", name: "fury" }]])));
  assert.deepEqual(cap.cols[0].panes[0], { argv: ["claude"], cwd: "/w", resume: "s1", name: "fury" });

  const dir = await temporary(t);
  const { readFile } = await import("node:fs/promises");
  const { Store } = await load("kanso-sleep/store.js", ["Store"], { exec, appHome: () => dir });
  const store = new Store();
  const id = await store.sleep(":/w", { ...a, saved: 7 });
  const now = async () => clone(await store.asleep());
  assert.deepEqual(await now(), [], "going to sleep: hidden until its agents have left");
  await assert.rejects(store.sleep(":/w", { ...a, saved: 8 }), /already asleep/, "never over another sleeping tab of that name");
  assert.equal(await store.settle(id), true);
  assert.deepEqual((await now()).map((x) => [x.id, x.from, x.name, x.cols[0].panes[0].resume]), [[id, ":/w", "shield", "s1"]]);
  assert.equal(await store.drop(id), false, "a settled tab is not dropped by a sleep's undo");
  assert.equal((await now()).length, 1);
  const got = await store.claim(id);
  assert.equal(got.name, "shield", "the claim hands back the row as it is now");
  assert.equal(await store.claim(id), null, "one wake at a time");
  assert.deepEqual(await now(), [], "a tab waking is not offered again");
  assert.equal(await store.forget(id), false, "a tab a wake holds is not forgotten under it");
  assert.equal(await store.woke(id, "not-this-wake"), false, "only the wake that holds it finishes it");
  assert.equal(await store.renew(id, got.token), true, "the wake renews its hold");
  assert.equal(await store.narrow(id, [{ w: 1, panes: [a.cols[0].panes[0]] }], got.token), true);
  let asleep = await now();
  assert.equal(asleep[0].cols.length, 1, "what did not wake stays asleep, alone");
  assert.equal(asleep[0].id, id);
  const again = await store.claim(id);
  assert.ok(again, "and can be woken again");
  assert.equal(await store.release(id, again.token), true);
  const third = await store.claim(id);
  assert.equal(await store.woke(id, third.token), true);
  assert.deepEqual(await now(), []);
  // A row taken over by a newer tab of the same name is not the old one.
  const old = await store.sleep(":/w", { ...a, saved: 9 });
  await store.settle(old);
  const t1 = await store.claim(old);
  await store.woke(old, t1.token);
  const fresh = await store.sleep(":/w", { ...a, saved: 10 });
  await store.settle(fresh);
  assert.equal(await store.claim(old), null, "an old list can't claim the new tab of that name");
  const failed = await store.sleep(":/w", { ...a, name: "other", cols: [a.cols[1]], saved: 11 });
  assert.equal(await store.drop(failed), true);
  assert.equal((await now()).length, 1, "a sleep that stopped drops only its own row");
  const src = async (f) => readFile(new URL(`../kanso/mods/${f}`, import.meta.url), "utf8");
  assert.match(await src("kanso-spaces/main.js"), /from "\.\/store\.js"/, "the sidebar reads what sleeps through the left nav's store, the one Sleep writes through");
  // An agent that may still be starting is held back from waking.
  const t2 = await store.claim(fresh);
  await store.woke(fresh, t2.token);
  const held = await store.sleep(":/w", { ...a, name: "held", saved: 12 });
  assert.equal(await store.narrow(held, [{ w: 1, panes: [a.cols[0].panes[0]] }], null, { wait: true }), true);
  assert.deepEqual(await now(), [], "held: not offered yet");
  assert.equal(await store.claim(held), null, "nor claimed");
  const { resumeArgv, freeName, sameTabs, coversTab } = await load("kanso-sleep/main.js", ["resumeArgv", "freeName", "sameTabs", "coversTab"], { home: () => HOME });
  const covered = { cols: [{ panes: [{ terminal: "t1" }] }] };
  assert.equal(coversTab(covered, ["t1"]), true);
  assert.equal(coversTab(covered, ["t1", "t2"]), false, "a pane the strip has not placed yet: no sleep");
  assert.equal(isResumed({ pid: 5, argv: ["claude", "--resume", "s9"] }, { pid: 5, sessionId: "s9" }, "s9"), true);
  assert.equal(isResumed({ pid: 5, argv: ["claude", "--resume", "s9"] }, { pid: 5, sessionId: "other" }, "s9"), false, "its record says another conversation");
  assert.equal(isResumed({ pid: 5, argv: ["claude", "--resume", "s9"] }, null, "s9"), false, "no record: its arguments prove nothing");
  assert.equal(isResumed({ pid: 5, argv: ["claude"] }, { pid: 6, sessionId: "s9" }, "s9"), false, "another process's record");
  assert.deepEqual(clone(resumeArgv(["claude", "--model", "opus", "--fork-session", "fix the login bug"], "s9")), ["claude", "--model", "opus", "--resume", "s9"], "no first prompt again, no fork");
  assert.deepEqual(clone(resumeArgv(["claude", "-c"], "s9")), ["claude", "--resume", "s9"]);
  assert.equal(resumeArgv(["claude", "--something-new"], "s9"), null, "an option not known to carry over");
  assert.equal(resumeArgv(["npx", "claude"], "s9"), null);
  assert.deepEqual(clone(resumeArgv(["claude", "--add-dir", "../api", "../web", "--allowedTools", "Edit", "Bash", "--model", "x"], "s9")),
    ["claude", "--add-dir", "../api", "../web", "--allowedTools", "Edit", "Bash", "--model", "x", "--resume", "s9"], "every value of an option that takes several");
  assert.equal(resumeArgv(["claude", "--add-dir"], "s9"), null);
  const { promptEmpty } = await load("kanso-sleep/main.js", ["promptEmpty"], { home: () => HOME });
  const guard = await import("../kanso/mods/kanso-guard/guard.mjs");
  const rule = "─".repeat(40);
  const box = (...lines) => ["output", "", rule, ...lines, rule, "  sleepy │ Haiku"].join("\n");
  for (const pe of [promptEmpty, guard.promptEmpty]) {
    assert.equal(pe(box("❯ ")), true, "an empty prompt");
    assert.equal(pe(box("❯ ", "  Press Ctrl-C again to exit")), false, "inside the box, a line of a draft");
    assert.equal(pe(box("❯ ") + "\n  Press Ctrl-C again to exit"), true, "under the box is not the draft");
    assert.equal(pe(box("❯ ", "  two", "  three")), false, "a draft's later lines, the first one cleared");
    assert.equal(pe(box("❯ fix it")), false);
    assert.equal(pe("no prompt here"), false, "a screen it can't read stops /exit");
  }
  assert.equal(freeName("shield", new Set(["shield", "shield 2"])), "shield 3");
  const tab = (pid) => ({ tab: { id: "t" }, capture: { cols: [{ panes: [{ terminal: "t1", pid, resume: "s1", argv: ["claude"] }] }] } });
  assert.equal(sameTabs([tab(1)], [tab(1)]), true);
  assert.equal(sameTabs([tab(1)], [tab(2)]), false, "an agent started again since the view opened");
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

test("Every list answers vim's keys: j/k, gg/G, Enter, Esc; with cmd, ctrl or alt a key is not the list's", async () => {
  const { listKey, moveTo } = await load("kanso-menu/listkeys.js", ["listKey", "moveTo"]);
  const key = (k, mods = {}) => ({ key: k, modifiers: mods });
  // Each key with the pending g the one before left.
  const run = (keys) => keys.reduce((st, [k, at]) => { const r = listKey(k, st.gAt, at); return { gAt: r.gAt, moves: [...st.moves, r.move] }; }, { gAt: 0, moves: [] }).moves;
  assert.deepEqual(run([[key("j")], [key("down")], [key("k")], [key("g", { shift: true })]]), ["down", "down", "up", "last"], "G");
  assert.deepEqual(run([[key("g"), 1000], [key("g"), 1500], [key("g"), 3000], [key("g"), 4500]]), ["pending", "first", "pending", "pending"], "gg; too slow for gg: a new first g");
  assert.deepEqual(run([[key("enter")], [key("escape")]]), ["enter", "escape"]);
  assert.equal(listKey(key("j", { platform: true })).move, null, "cmd-j is not the list's");
  assert.equal(listKey(key("k", { control: true })).move, null);
  assert.equal(listKey(key("x")).move, null);
  assert.deepEqual([moveTo("down", 4, 5), moveTo("up", 0, 5), moveTo("first", 3, 5), moveTo("last", 0, 5), moveTo("down", 0, 0)], [4, 0, 0, 4, 0], "j and k stop at the ends");
  assert.deepEqual([moveTo("down", -1, 5), moveTo("up", -1, 5)], [0, 4], "nothing chosen yet: j takes the first, k the last");
});

test("Help draws the keyboard from your keys: a chord as key and modifiers, the layout's key over the global one", async () => {
  const { parseChord, layer, describe } = await load("kanso-help/keymap.js", ["parseChord", "layer", "describe"]);
  assert.deepEqual(clone(parseChord("cmd-shift--")), { mods: ["shift", "cmd"], key: "-" });
  assert.deepEqual(clone(parseChord("cmd-}")), { mods: ["shift", "cmd"], key: "]" }, "macOS's shifted spelling");
  assert.deepEqual(clone(parseChord("cmd-alt-h")), { mods: ["alt", "cmd"], key: "h" });
  const bindings = [
    { section: "global", keys: "cmd-alt-h", action: "app.hide_others" },
    { section: "layout:kanso", keys: "cmd-alt-h", action: "kanso-strip.vim-left" },
    { section: "layout:kanso", keys: "cmd-alt-shift-up", action: "terminal" },
    { section: "terminal", keys: "cmd-alt-j", action: "send:x" },
    { section: "mod:kanso-spend", keys: "cmd-alt-k", action: "kanso-spend.back" },
  ];
  const l = layer(bindings, ["alt", "cmd"]);
  assert.deepEqual([...l.keys()], ["h"], "only the layout's and global keys, never the terminal's or a panel's");
  assert.equal(l.get("h").action, "kanso-strip.vim-left", "the layout's key wins");
  assert.equal(describe("kanso-strip.vim-left"), "Pane to the left, or the sidebar's list");
  assert.equal(describe("kanso-strip.col-3"), "Column 3");
  assert.equal(describe("tab.something_new"), "Tab something new");
});

test("hjkl dōjō: vim's motions on a board and on code, the fewest moves and the hint", async () => {
  const { LEVELS, gridWorld, textWorld, move, shortest, newTarget, points } = await load("kanso-dojo/dojo.js", ["LEVELS", "gridWorld", "textWorld", "move", "shortest", "newTarget", "points"]);
  const g = gridWorld(), L = (n) => LEVELS[n - 1];
  assert.deepEqual(clone(move(g, { x: 0, y: 0 }, "h")), { x: 0, y: 0 }, "the board's edge holds");
  assert.deepEqual(clone(move(g, { x: 1, y: 0 }, "5l")), { x: 6, y: 0 });
  assert.deepEqual(clone(move(g, { x: 2, y: 3 }, "$")), { x: 17, y: 3 });
  assert.equal(shortest(g, { x: 1, y: 0 }, { x: 17, y: 0 }, L(4)).dist, 1, "$ beats sixteen l's");
  assert.equal(shortest(g, { x: 1, y: 0 }, { x: 17, y: 0 }, L(4)).first, "$");
  assert.equal(shortest(g, { x: 1, y: 0 }, { x: 9, y: 0 }, L(1)).dist, 8, "with h and l only, eight it is");
  assert.equal(shortest(g, { x: 1, y: 0 }, { x: 7, y: 2 }, L(5)).dist, 2, "6l then 2j");
  const w = { kind: "text", lines: ["const herd = agents.filter((a) => a.idle);", "  return tab;"] };
  assert.deepEqual(clone(move(w, { x: 0, y: 0 }, "w")), { x: 6, y: 0 }, "w: the next word");
  assert.deepEqual(clone(move(w, { x: 6, y: 0 }, "w")), { x: 11, y: 0 }, "= is a word of its own");
  assert.deepEqual(clone(move(w, { x: 6, y: 0 }, "e")), { x: 9, y: 0 }, "e: the word's end");
  assert.deepEqual(clone(move(w, { x: 11, y: 0 }, "b")), { x: 6, y: 0 }, "b: back to a word's start");
  assert.deepEqual(clone(move(w, { x: 41, y: 0 }, "w")), { x: 2, y: 1 }, "w crosses to the next line");
  assert.deepEqual(clone(move(w, { x: 0, y: 0 }, "fa")), { x: 13, y: 0 }, "f: onto the letter");
  assert.deepEqual(clone(move(w, { x: 0, y: 0 }, "ta")), { x: 12, y: 0 }, "t: just before it");
  assert.deepEqual(clone(move(w, { x: 20, y: 0 }, "Fa")), { x: 13, y: 0 });
  assert.deepEqual(clone(move(w, { x: 9, y: 1 }, "^")), { x: 2, y: 1 });
  assert.deepEqual(clone(move(w, { x: 9, y: 1 }, "0")), { x: 0, y: 1 });
  assert.deepEqual(clone(move(w, { x: 2, y: 1 }, "$")), { x: 12, y: 1 });
  assert.deepEqual(clone(move(w, { x: 30, y: 0 }, "j")), { x: 12, y: 1 }, "j keeps the column, inside the line");
  assert.equal(shortest(w, { x: 0, y: 0 }, { x: 13, y: 0 }, L(7)).dist, 1, "one f");
  let r = 0; const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let n = 1; n <= LEVELS.length; n++) {
    const world = LEVELS[n - 1].world === "grid" ? gridWorld() : textWorld(n);
    const at = { x: 0, y: 0 };
    for (let i = 0; i < 10; i++) {
      const { target, need } = newTarget(world, at, LEVELS[n - 1], rand);
      assert.ok(need >= 1 && need < Infinity, `level ${n}: a target it can reach`);
      assert.equal(shortest(world, at, target, LEVELS[n - 1]).dist, need);
      if (n === 1) assert.equal(target.y, at.y, "level 1: on the row");
      if (n === 2) assert.equal(target.x, at.x, "level 2: on the column");
    }
  }
  assert.deepEqual([points(3, 3, 0), points(3, 3, 4), points(5, 3, 4)], [15, 23, 10], "the fewest moves and the streak count");
});

test("Hachi, the dōjō's shiba, wears the game on its face", async () => {
  const { hachiPixels } = await load("kanso-dojo/mascot.js", ["hachiPixels"], { div: () => null, h_flex: () => null, v_flex: () => null });
  const eyes = (g) => g.slice(6, 8).map((r) => r.join("")).join("|");
  const moods = ["calm", "glad", "sweat", "sleep"].map((m) => eyes(hachiPixels(m)));
  assert.equal(new Set([moods[0], moods[1], moods[3]]).size, 3, "open, glad and asleep look apart");
  assert.ok(hachiPixels("sweat").some((r) => r.includes("B")), "a drop of sweat");
  assert.ok(hachiPixels("glad").some((r) => r.includes("T")), "tongue out when glad");
  assert.ok(hachiPixels().every((row) => row.length === 16) && hachiPixels().length === 15);
});


test("The dōjō's card: the best round, the days in a row, only the levels played", async () => {
  const host = { theme: () => ({}), exec, appHome: () => "/x", notify: () => {}, window: () => ({ platform: "macos" }) };
  const { dayStreak, calendar, dojoShare } = await load("kanso-dojo/card.js", ["dayStreak", "calendar", "dojoShare"], host);
  const now = new Date(2026, 10, 6, 12).getTime();
  assert.equal(dayStreak(["2026-11-04", "2026-11-05", "2026-11-06"], now), 3);
  assert.equal(dayStreak(["2026-11-04", "2026-11-05"], now), 2, "today may still come");
  assert.equal(dayStreak(["2026-11-01"], now), 0);
  const cal = calendar(["2026-11-06"], now, 4);
  assert.equal(cal.length, 4);
  assert.equal(cal.at(-1).contributionDays.at(-1).contributionLevel, "FOURTH_QUARTILE", "today, lit, last");
  const card = dojoShare({ bests: { 1: 40, 3: 95 }, rounds: 4, rings: 20, fewest: 15, longest: 6, days: ["2026-11-05", "2026-11-06"], first: now - 86400000 }, now);
  assert.equal(card.spec.title, "hjkl dōjō");
  assert.equal(card.spec.hero.big, "95");
  assert.match(card.spec.hero.label, /level 3: h j k l/);
  assert.equal(card.spec.blocks[1].rows.length, 2, "only the levels played");
  assert.match(card.text, /^95 points in my best round of vim, in the hjkl dōjō/);
  assert.match(card.text, /75% in the fewest moves/);
});

test("The dōjō keeps its rounds in its own SQLite: bests per level, totals, the days played", async (t) => {
  const dir = await temporary(t);
  const { Store } = await load("kanso-dojo/store.js", ["Store"], { exec, appHome: () => dir });
  const store = new Store();
  assert.equal(await store.level(), 1, "level 1 to start");
  await store.setLevel(3);
  assert.equal(await store.level(), 3);
  const day = new Date(2026, 10, 6, 12).getTime();
  await store.add({ at: day, level: 1, score: 40, rings: 4, fewest: 2, streak: 2 });
  await store.add({ at: day + 1000, level: 1, score: 55, rings: 5, fewest: 4, streak: 3 });
  await store.add({ at: day - 86400000, level: 3, score: 30, rings: 3, fewest: 3, streak: 3 });
  const tot = clone(await store.totals());
  assert.deepEqual(tot.bests, { 1: 55, 3: 30 });
  assert.deepEqual([tot.rounds, tot.rings, tot.fewest, tot.longest, tot.first], [3, 12, 9, 3, day - 86400000]);
  assert.deepEqual(tot.days, ["2026-11-05", "2026-11-06"]);
  assert.match(store.db, /data\/kanso-dojo\/dojo\.db$/);
});


test("A dōjō round ends after ten targets, with its result kept; End round stops one without counting it", async () => {
  const added = [];
  const host = {
    theme: () => ({}), props: () => ({ overlay: "o" }), closeOverlay: () => {}, appHome: () => "/x", settings: () => ({}),
    exec: async () => ({ code: 0, stdout: "", stderr: "" }), notify: () => {}, window: () => ({ platform: "macos" }),
    ...singleUse(),
  };
  const { Dojo, shortest } = await load("kanso-dojo/main.js", ["Dojo", "shortest"], host);
  const cx = { focus_handle: () => ({ focus() {} }), spawn: (f) => f(cx), notify() {}, stop_propagation() {}, timer: { every() {}, after() {} } };
  const game = new Dojo();
  game.init({}, cx);
  game.store = { add: async (r) => { added.push(r); }, totals: async () => ({ bests: { 1: 1 } }), level: async () => 1, setLevel: async () => {} };
  const press = (ch) => game.key({ key: ch, key_char: ch, modifiers: {} }, cx);
  await new Promise((r) => setTimeout(r, 0));
  for (let n = 0; n < 200 && !game.over; n++) for (const ch of shortest(game.world, game.at, game.target, game.level).first) press(ch);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(game.over?.kept, "the round is over after ten targets");
  assert.equal(game.over.hits, 10);
  assert.equal(game.over.perfect, 10, "each in the fewest moves");
  assert.doesNotThrow(() => game.render(cx), "the result draws, its Leave a button of its own beside the header's");
  assert.equal(added.length, 1, "and kept");
  press("enter");
  assert.equal(game.over, null, "Enter plays again");
  press(shortest(game.world, game.at, game.target, game.level).first[0]);
  assert.ok(game.round, "a move starts the next round");
  game.endRound(null, false);
  assert.equal(game.over.kept, false, "End round: stopped");
  assert.equal(added.length, 1, "and not counted");
});

test("An agent asleep keeps its name and place: the sidebar sees each pane that sleeps, and each agent as the left nav keeps it", async () => {
  const { shownOf } = await load("kanso-sleep/store.js", ["shownOf"], { exec: async () => ({ code: 0, stdout: "" }), appHome: () => "/x" });
  const row = { id: "r1", from: ":/w", name: "fury", saved: 5, into: { tab: null, tabId: "tb1" }, spaceId: "w1",
    agents: [{ id: "s1", name: "Fury", title: "Fix sleep", said: 3, space_id: "w1", pos: 2, program: null }],
    cols: [{ w: 1, panes: [{ argv: ["claude"], resume: "s1", name: "fury", terminal: "t1" }, { argv: ["npm", "run", "dev"], terminal: "t2" }] }] };
  const now = Date.now();
  const s = clone(shownOf(row, now));
  assert.deepEqual(s.agents, [{ name: "Fury", terminal: "t1", resume: "s1", title: "Fix sleep", said: 3, spaceId: "w1", at: 2, program: null },
    { name: "npm", terminal: "t2", resume: null, title: null, said: null, spaceId: null, at: null, program: null }], "the agent by what the left nav keeps of it; a shell by its program");
  assert.equal(s.busy, false);
  assert.equal(shownOf({ ...row, pending: now - 1 }, now).busy, true, "on its way to sleep: busy");
  assert.equal(shownOf({ ...row, pending: now - 1 }, now).pending, true);
  assert.deepEqual(clone(s.into), { tab: null, tabId: "tb1" });
});

test("The sidebar keeps its state in the left nav's database: prefs moved from localStorage once, each agent by its conversation", async (t) => {
  const dir = await temporary(t);
  const local = new Map([["spaces.view", "threads"], ["spaces.sections", "[\"done\"]"]]);
  const localStorage = { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, v) };
  const { Panel } = await load("kanso-spaces/panel.js", ["Panel"], { exec, appHome: () => dir, localStorage });
  const p = new Panel(["spaces.view", "spaces.sections", "spaces.order"]);
  assert.equal(p.get("spaces.view"), "threads", "the first frame: the copy in localStorage");
  assert.equal(await p.load(), false, "first start: localStorage moves in, nothing differs");
  p.set("spaces.view", "agents");
  const seen = (status) => new Map([["t1", { conversation: "c1", given: "fury", name: "fury", title: "Fix sleep", said: 3, space: "w1", tab: "tb1", pos: 1, program: null, status, terminal: "t1" }]]);
  await p.remember(seen("idle"), 100);
  local.set("spaces.view", "spaces"); // an old copy: the database wins
  const fresh = new Panel(["spaces.view"]);
  assert.equal(await fresh.load(), true);
  assert.equal(fresh.get("spaces.view"), "agents");
  assert.deepEqual(clone(fresh.json("spaces.sections", [])), ["done"]);
  assert.equal(fresh.agents.get("c1").name, "fury", "by its conversation, not its terminal");
  assert.equal(fresh.agents.get("c1").pos, 1);
  const before = fresh.chain;
  fresh.sent.set("c1", { a: seen("idle").get("t1"), at: 100 });
  assert.equal(fresh.remember(seen("idle"), 200), before, "nothing changed: nothing written");
  await fresh.remember(seen("working"), 300);
  const last = new Panel([]);
  await last.load();
  assert.equal(last.agents.get("c1").status, "working");
  // The name cleared on its terminal: the automatic one again, here and in the database.
  await last.remember(new Map([["t1", { ...seen("idle").get("t1"), given: null }]]), 400);
  assert.equal(last.agents.get("c1").name, null);
  // Nobody left to write: the write that ends the ones no longer seen still runs.
  const writes = [];
  const observe = last.kdb.observe.bind(last.kdb);
  last.kdb.observe = (list, at) => { writes.push(list.length); return observe(list, at); };
  await last.remember(new Map(), 400 + 61_000);
  assert.deepEqual(writes, [0]);
  assert.equal((await last.kdb.read("SELECT status FROM agents WHERE id='c1'"))[0].status, "gone", "not seen for a while: gone");
});

test("Send reaches any agent of any model by the name and project Kanso gives it, grouped by project, yours first", async () => {
  const { everyone } = await load("kanso-send/main.js", ["everyone"], {});
  const terms = [
    { address: "t5g", state: "live", status: "working", labels: { "kanso.shown": "morpheus", "kanso.project": "herdr-kanso" } },
    { address: "t5t", state: "live", status: "done", agent: "qwen-code", labels: { "kanso.shown": "qb2", "kanso.project": "herdr-kanso" } },
    { address: "t2c", state: "live", status: "blocked", labels: { "kanso.shown": "Lead", "kanso.project": "fluenty" } },
    { address: "t5r", state: "live", labels: { "kanso.shown": "zsh" } },
    { address: "box/t1", state: "live", status: "idle", labels: {} },
  ];
  const groups = clone(everyone(terms, [], { from: "t5g" }));
  assert.deepEqual(groups.map((g) => [g.project, g.agents.map((x) => x.name)]), [["herdr-kanso", ["qb2"]], ["fluenty", ["Lead"]]], "a shell and another machine's are not agents to send to");
  assert.deepEqual(clone(everyone(terms, [], { from: "t5g", query: "flu" })).map((g) => g.project), ["fluenty"], "found by project");
  assert.deepEqual(clone(everyone(terms, [], { from: "t5g", query: "qb" })).map((g) => g.agents.map((x) => x.terminal)), [["t5t"]], "found by name");
});

test("the minimap's pills fit their slot whatever the columns, so the stepper always shows", async () => {
  const { pillWidths } = await load("kanso-strip/main.js", ["pillWidths"]);
  const span = (ws) => ws.reduce((a, b) => a + b + 2, 0) + (ws.length - 1) * 3;
  assert.deepEqual(clone(pillWidths([{ w: 0.5 }, { w: 0.5 }])), [15, 15], "few columns keep their size");
  const six = pillWidths(Array.from({ length: 6 }, () => ({ w: 1 })));
  assert.ok(span(six) <= 110, `six full-width columns fit (${span(six)}px)`);
  assert.ok(six.every((w) => w === six[0]), "and stay alike");
  const many = pillWidths(Array.from({ length: 30 }, () => ({ w: 1 })));
  assert.ok(many.every((w) => w >= 3), "never thinner than a mark");
});

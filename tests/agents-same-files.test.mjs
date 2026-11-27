import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, realpath, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { load, same, success, failure, exec, gitOk, temporary, committedRepo, themed, KIT_NIGHT, drawingHost, texts, tipsOf, one } from "./helpers.mjs";
import { loadSpaces } from "./mod-fixtures.mjs";

const root = "/projects/app";
const nested = `${root}/.worktrees/topic`;
const place = { space: "project", folder: root, machine: "", name: "App" };
const codex = { key: "codex", name: "Codex", run: ["codex"] };
const session = (address, title, cwd, key = "claude") => ({ address, title, cwd, program: { key, agent: true } });
const first = session("t1", "Ada", root);
const second = session("t2", "Lin", `${root}/src`, "codex");
const third = session("t3", "Sam", root);
const worktrees = [{ path: root }, { path: nested }];
const at = new Date(2026, 10, 27, 9, 5).getTime();
const branch = "20261127-090500-codex";
const treePath = `/worktrees/app/${branch}`;
const file = `${root}/src/main.js`;
const nameOf = (agent) => agent.title;
const cwdOf = (agent) => agent.cwd;
const sharedEdits = (names, host) => load("kanso-spaces/shared-edits.js", names, host);
const scanner = async (host, timer) => {
  const { SharedEdits } = await sharedEdits(["SharedEdits"], {
    locateOn: async (_machine, address) => ({ file: address }),
    ...host,
  });
  return new SharedEdits(timer);
};
const scanPair = (scan, group = [first, second]) => scan.scan(group, cwdOf, nameOf);
const iso = (time = at) => new Date(time).toISOString();
const editsOf = (...files) => files.map((file) => ({ at, file }));
const editRows = (...files) => ["256", ...files.map((file) => `${iso()}\t${file}`), ""].join("\n");
const pairWarnings = (path = file) => Object.fromEntries([first, second].map((agent, i, pair) => {
  const other = pair[1 - i].title;
  return [agent.address, { text: `Also changed by ${other}: ${posix.basename(path)}`, tip: `${path}: ${other}` }];
}));

test("An agent in the project or a subfolder counts, but an agent in its own worktree, a remote agent and a shell do not.", async () => {
  const { workingIn } = await load("kanso-spaces/own-tree.js", ["workingIn"]);
  const inPane = { ...second, cwd: undefined };
  const list = [first, inPane, session("t4", "Dev", nested), session("dev/t5", "Chris", root), { address: "t6", cwd: root }];
  const shown = [{ terminal: second.address, cwd: second.cwd }];
  same(workingIn(root, "", { list, shown, trees: worktrees }).map((agent) => agent.address), [first.address, second.address]);
});

test("Starting in an occupied Git project reserves a branch for the new agent and returns its worktree or Git's error.", async () => {
  const error = "The worktree folder is already there.";
  const worktreeArgs = { folder: root, machine: null, branch, base: "/app/data/kanso/worktrees" };
  for (const [trees, list, made, expected] of [
    [[], [first], null, null],
    [worktrees, [], null, null],
    [worktrees, [first], { path: treePath, made: true }, { path: treePath, branch, busy: [first] }],
    [worktrees, [first], { error }, { error, busy: [first] }],
  ]) {
    const creates = [];
    const { ownTree } = await load("kanso-spaces/own-tree.js", ["ownTree"], {
      agents: () => list,
      worktreesOf: async () => trees,
      appHome: () => "/app",
      addWorktree: async (args) => { creates.push(args); return made; },
    });
    same(await ownTree(place, codex, at), expected);
    same(creates, made ? [worktreeArgs] : []);
  }
});

test("Same-type agents launched seconds apart get separate worktrees, and an existing worktree is never reused.", async (t) => {
  const { dir, repo } = await committedRepo(t);
  const { ownTree } = await load("kanso-spaces/own-tree.js", ["ownTree"], {
    exec,
    agents: () => [{ ...first, cwd: repo }],
    appHome: () => dir,
  });
  const target = { ...place, folder: repo };
  const start = await ownTree(target, codex, at);
  const later = await ownTree(target, codex, at + 1000);
  assert.ok(start?.path, start?.error);
  assert.ok(later?.path, later?.error);
  assert.notEqual(start.branch, later.branch);
  assert.notEqual(await realpath(start.path), await realpath(later.path));
  const collision = await ownTree(target, codex, at + 1000);
  assert.match(collision?.error ?? "", /already has a worktree/);
  assert.equal(collision.path, undefined);
});

test("The agent picker starts in the new worktree and says why, stays in a free folder, and warns if isolation fails.", async () => {
  const error = "Git could not make the worktree.";
  const busy = [{ ...first, name: "Ada Sidebar" }];
  const isolated = { path: treePath, branch, busy };
  const attempts = [
    [isolated, { folder: treePath, name: branch }, { level: "info", title: "Codex has its own worktree", body: `Ada Sidebar is working in App, so Codex started on branch ${branch}.` }],
    [null, { folder: root }, null],
    [{ error, busy }, { folder: root }, { level: "warning", title: "Codex shares the folder with Ada Sidebar", body: error }],
  ];
  const results = [];
  for (const [outcome] of attempts) {
    const target = [], notices = [];
    const { Spaces } = await loadSpaces({
      viewerFor: async () => (argv) => argv,
      ownTree: async () => outcome,
      run: (command, args) => target.push([command, args]),
      notify: ({ title, body, level }) => notices.push({ title, body, level }),
    });
    const view = new Spaces();
    view.thenClose = () => {};
    view.pickAgent(place, codex);
    await new Promise(setImmediate);
    results.push([target, notices]);
  }
  same(results.map(([target]) => target), attempts.map(([, location]) => [
    ["space.select", { id: place.space }],
    ["tab.new", { space: place.space, ...location, argv: codex.run }],
  ]));
  for (const [i, [, notices]] of results.entries()) {
    const [, , expected] = attempts[i];
    assert.equal(notices.length, Number(Boolean(expected)));
    if (!expected) continue;
    const [notice] = notices;
    assert.equal(notice.level, expected.level);
    assert.equal(notice.title, expected.title);
    assert.ok(notice.body.includes(expected.body), notice.body);
  }
});

test("Only a dirty file with at least two editors warns those editors, not a third agent who edited something else.", async () => {
  const { overlaps } = await sharedEdits(["overlaps"]);
  const solo = `${root}/solo.js`, clean = `${root}/clean.js`;
  const edited = { [first.address]: editsOf(file, clean), [second.address]: editsOf(file, clean), [third.address]: editsOf(solo) };
  same(overlaps([first, second, third], [file, solo], edited), {
    [first.address]: [{ file, others: [second] }],
    [second.address]: [{ file, others: [first] }],
  });
});

test("Three editors see the other two, and the tooltip names everyone on each overlapping file.", async () => {
  const { overlaps, warningOf } = await sharedEdits(["overlaps", "warningOf"]);
  const extra = `${root}/new.js`;
  const group = [first, second, third];
  const edited = { [first.address]: editsOf(file, extra), [second.address]: editsOf(file), [third.address]: editsOf(file, extra) };
  const found = overlaps(group, [file, extra], edited);
  same(Object.fromEntries(group.map((agent) => [agent.address, warningOf(found[agent.address], nameOf)])), {
    [first.address]: { text: "Also changed by Lin, Sam: main.js and 1 more", tip: `${file}: Lin, Sam\n${extra}: Sam` },
    [second.address]: { text: "Also changed by Ada, Sam: main.js", tip: `${file}: Ada, Sam` },
    [third.address]: { text: "Also changed by Ada, Lin: main.js and 1 more", tip: `${file}: Ada, Lin\n${extra}: Ada` },
  });
});

test("The scan groups agents by Git checkout and compares absolute and relative edits against renamed and untracked files.", async () => {
  const changed = `${root}/new notes.md`;
  const local = { ...third, cwd: nested };
  const machine = "dev";
  const onDev = (agent) => ({ ...agent, address: `${machine}/${agent.address}` });
  const agents = [onDev(first), onDev(second), onDev(local), first];
  const roots = [], statuses = [], located = [], logs = [];
  const output = {
    [agents[0].address]: editRows("src/main.js", "new notes.md", "src/old.js", "solo.js"),
    [agents[1].address]: editRows("main.js", changed, "old.js"),
  };
  const scan = await scanner({
    locateOn: async (where, address, hint) => {
      located.push([where, address, hint]);
      return { file: address };
    },
    exec: async (command, args, options) => {
      if (command === "sh") return success(output[args[3]]);
      const [, cwd, action, ...flags] = args;
      if (action === "rev-parse") {
        roots.push([command, cwd, flags, options.on]);
        return success(cwd === nested ? nested : root);
      }
      if (action === "log") {
        logs.push([cwd, flags, options.on]);
        return success("");
      }
      statuses.push([command, cwd, flags, options.on]);
      return success("R  src/main.js\0src/old.js\0?? new notes.md\0 M solo.js\0");
    },
  });
  const warnings = await scanPair(scan, agents);
  same(roots, agents.map((agent) => ["git", agent.cwd, ["--show-toplevel"], agent.address.includes("/") ? machine : null]));
  same(statuses, [["git", root, ["--porcelain=v1", "-z", "--untracked-files=all"], machine]]);
  same(located, agents.slice(0, 2).map((agent) => [machine, agent.address, agent.program.key]));
  same(logs, [file, changed].map((path) => [root, ["-1", "--format=%cI", "--", path], machine]));
  same(warnings, Object.fromEntries(agents.slice(0, 2).map((agent, i) => {
    const other = agents[1 - i].title;
    return [agent.address, { text: `Also changed by ${other}: main.js and 1 more`, tip: `${file}: ${other}\n${changed}: ${other}` }];
  })));
});

test("Rename and copy source records never make unrelated clean paths look dirty.", async () => {
  const porcelain = "R  src/main.js\0src/untouched.js\0 C copy.js\0src/clean.js\0";
  const edits = editRows(file, `${root}/untouched.js`, `${root}/clean.js`);
  const scan = await scanner({
    exec: async (command, args) => {
      if (command === "sh") return success(edits);
      return success(args.includes("status") ? porcelain : root);
    },
  });
  same(await scanPair(scan), pairWarnings());
});

const posixScan = { skip: process.platform === "win32" && "The transcript scan uses POSIX sh" };
const jsonl = (...entries) => entries.map((entry) => JSON.stringify(entry) + "\n").join("");
const transcripts = async (t, run = exec) => {
  const dir = await temporary(t);
  const fileOf = (address) => join(dir, `${address}.jsonl`);
  const scan = await scanner({ exec: run, locateOn: async (_machine, address) => ({ file: fileOf(address) }) });
  return {
    write: (agent, ...entries) => writeFile(fileOf(agent.address), jsonl(...entries)),
    append: (agent, ...entries) => appendFile(fileOf(agent.address), jsonl(...entries)),
    edits: (agent) => scan.editedBy(agent, "", agent.cwd),
    scan,
  };
};
const toolCall = (name, input, time = at) => ({
  type: "assistant", timestamp: iso(time), message: { content: [{ type: "tool_use", name, input }] },
});
const claudeEdit = (file_path, time) => toolCall("Edit", { file_path }, time);
const patchCall = (input, type = "custom_tool_call") => ({
  timestamp: iso(), type: "response_item", payload: { type, name: "apply_patch", input },
});
const mockGit = (checkout = root) => async (command, args, options) => {
  if (command === "sh") return exec(command, args, options);
  if (args[2] === "rev-parse") return success(checkout);
  return success(args[2] === "status" ? " M src/main.js\0" : "");
};

test("The scan's shell command reads Claude Code edits and Codex patch targets but ignores a Claude Code read.", posixScan, async (t) => {
  const history = await transcripts(t);
  await history.write(first, claudeEdit(file), toolCall("Read", { file_path: `${root}/notes.md` }));
  await history.write(second, patchCall("*** Begin Patch\n*** Update File: main.js\n@@\n-old\n+new\n*** Add File: utils.js\n+added\n*** End Patch"));
  same(await history.edits(first), editsOf(file));
  same(await history.edits(second), editsOf(file, `${second.cwd}/utils.js`));
});

test("Patch text in conversation or in a Claude Code edit does not count as a Codex patch.", posixScan, async (t) => {
  const quoted = "*** Update File: notes.md\n";
  const discussion = { type: "user_message", message: `Discuss this:\n${quoted}No edits yet.` };
  const history = await transcripts(t);
  await history.write(second, { type: "event_msg", timestamp: iso(), payload: discussion }, patchCall("*** Update File: main.js\n", "function_call"));
  same(await history.edits(second), editsOf(file));
  await history.write(first, toolCall("Edit", { file_path: file, new_string: quoted }));
  same(await history.edits(first), editsOf(file));
});

test("The macOS temporary folder aliases count as the same busy checkout and the same edited file.", posixScan, async (t) => {
  const folder = "/tmp/app", canonical = `/private${folder}`, changed = `${folder}/src/main.js`;
  const group = [{ ...first, cwd: canonical }, { ...second, cwd: `${folder}/src` }];
  const { workingIn } = await load("kanso-spaces/own-tree.js", ["workingIn"]);
  const busy = workingIn(folder, "", { list: group, trees: [{ path: canonical }] }).map((agent) => agent.address);
  const git = mockGit(folder);
  const history = await transcripts(t, async (command, args, options) =>
    args[2] === "rev-parse" && args[1] === canonical ? success(canonical) : git(command, args, options));
  await history.write(first, claudeEdit(`/private${changed}`));
  await history.write(second, patchCall("*** Update File: main.js\n"));
  same({ busy, warnings: await scanPair(history.scan, group) }, {
    busy: group.map((agent) => agent.address), warnings: pairWarnings(`/private${changed}`),
  });
});

test("A Claude Code edit counts even when replace_all comes before the file path.", posixScan, async (t) => {
  const history = await transcripts(t, mockGit());
  await history.write(first, toolCall("Edit", { replace_all: true, file_path: file, old_string: "a", new_string: "b" }));
  await history.write(second, patchCall("*** Update File: main.js\n"));
  same(await scanPair(history.scan), pairWarnings());
});

test("An agent's edit before the file's last commit does not warn about another agent's later edit.", posixScan, async (t) => {
  const { repo } = await committedRepo(t);
  const checkout = await realpath(repo);
  const changed = join(checkout, "readme");
  const committedAt = Date.parse(await gitOk()(checkout, "log", "-1", "--format=%cI", "--", changed));
  assert.ok(Number.isFinite(committedAt));
  const history = await transcripts(t);
  await history.write(first, claudeEdit(changed, committedAt - 1000));
  await history.write(second, claudeEdit(changed, committedAt + 1000));
  await writeFile(changed, "dirty\n");
  const group = [first, second].map((agent) => ({ ...agent, cwd: checkout }));
  same(await scanPair(history.scan, group), {});
});

test("The next transcript scan reads only appended bytes and starts over when the transcript shrinks.", posixScan, async (t) => {
  const offsets = [];
  const history = await transcripts(t, (command, args) => {
    offsets.push(args[4] ?? null);
    return exec(command, args);
  });
  const previous = toolCall("Edit", { file_path: file, old_string: "é".repeat(100) });
  const added = `${root}/added.js`, replacement = `${root}/reset.js`;
  await history.write(first, previous);
  const initial = await history.edits(first);
  await history.append(first, claudeEdit(added));
  const appended = await history.edits(first);
  assert.deepEqual(offsets, ["0", String(Buffer.byteLength(jsonl(previous)))]);
  same(initial, editsOf(file));
  same(appended, editsOf(file, added));
  await history.write(first, claudeEdit(replacement));
  const restarted = await history.edits(first);
  const next = await history.edits(first);
  same({ restarted, next }, { restarted: editsOf(replacement), next: editsOf(replacement) });
});

test("A failed checkout lookup is retried and the next scan checks for shared edits.", async () => {
  const checked = [], lookedUp = [];
  const scan = await scanner({
    exec: async (_command, [, cwd, action]) => {
      if (action === "status") {
        checked.push(cwd);
        return success("");
      }
      lookedUp.push(cwd);
      return lookedUp.length === 1 ? failure("Git could not find the checkout") : success(root);
    },
  });
  await scanPair(scan);
  assert.deepEqual(checked, []);
  await scanPair(scan);
  assert.deepEqual(lookedUp, [first.cwd, second.cwd, first.cwd]);
  assert.deepEqual(checked, [root]);
});

test("An unanswered Git status times out and does not prevent the next scan.", async () => {
  const timers = [], requests = [];
  const scan = await scanner({
    exec: async (_command, [, cwd, action]) => {
      if (action === "rev-parse") return success(root);
      requests.push([action, cwd]);
      return requests.length === 1 ? new Promise(() => {}) : success("");
    },
  }, { after: (ms, fn) => timers.push([ms, fn]) });
  const pending = scanPair(scan);
  await new Promise(setImmediate);
  assert.deepEqual(requests, [["status", root]]);
  const [ms, expire] = timers.at(-1) ?? [];
  assert.equal(ms, 15_000);
  expire();
  same(await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve("still waiting")))]), {});
  await scanPair(scan);
  assert.deepEqual(requests.map(([action]) => action), ["status", "status"]);
});

test("A new or cleared shared-edit warning invalidates the sidebar rows without waiting for other changes.", async () => {
  const { Spaces } = await loadSpaces({
    Date: class extends Date { static now() { return at; } },
    spaces: () => [],
  });
  const view = new Spaces();
  view.names = { book: {} };
  const warning = { text: "Also changed by Lin: main.js", tip: `${file}: Lin` };
  const scan = async (found) => {
    view.shared = { scan: async () => found };
    let pending, notifies = 0;
    view.checkShared({ spawn: (task) => { pending = task({ notify: () => { notifies += 1; } }); } });
    await pending;
    assert.equal(notifies, 1);
  };
  const expectRedraw = () => {
    assert.equal(view.rowsChanged(), true);
    assert.equal(view.rowsChanged(), false);
  };
  expectRedraw();
  await scan({ [first.address]: warning });
  expectRedraw();
  await scan({});
  expectRedraw();
});

test("The sidebar puts the shared-edit warning on its second line even without activity, and keeps narrow rows to one line.", async () => {
  const host = drawingHost();
  const { agentSession, sessionHeight } = await load("kanso-spaces/agents.js", ["agentSession", "sessionHeight"], host);
  const { c, H } = themed(await load("kanso-spaces/ui.js", ["tokens", "H"], host), KIT_NIGHT);
  const agent = { ...first, status: "idle" };
  const warning = { text: "Also changed by Lin: main.js", tip: `${file}: Lin` };
  const draw = (more) => agentSession(agent, 1, c, null, { label: first.title, shared: warning, ...more });
  const wide = draw(), busy = draw({ activity: "Editing" }), narrow = draw({ oneLine: true });
  assert.deepEqual(texts(wide), [first.title, warning.text]);
  assert.deepEqual(texts(busy), texts(wide));
  assert.ok(tipsOf(wide).includes(warning.tip));
  assert.deepEqual([one(wide, "h"), sessionHeight({ shared: warning })], [H.two, H.two]);
  assert.deepEqual([one(narrow, "h"), sessionHeight({ shared: warning, oneLine: true })], [H.line, H.line]);
  assert.deepEqual(texts(narrow), [first.title]);
  assert.ok(!tipsOf(narrow).includes(warning.tip));
});

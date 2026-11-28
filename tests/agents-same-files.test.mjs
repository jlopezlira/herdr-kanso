import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { load, same, success, failure, exec, gitOk, temporary, committedRepo, themed, KIT_NIGHT, drawingHost, texts, tipsOf, one, storeShared } from "./helpers.mjs";
import { loadSpaces } from "./mod-fixtures.mjs";

const root = "/projects/app";
const nested = `${root}/.worktrees/topic`;
const place = { space: "project", folder: root, machine: "", name: "App" };
const codex = { key: "codex", name: "Codex", run: ["codex"] };
const session = (address, title, cwd, key = "claude") => ({ address, title, cwd, program: { key, agent: true } });
const first = session("t1", "Ada", root);
const second = session("t2", "Lin", `${root}/src`, "codex");
const third = session("t3", "Sam", root);
const ownTreeModule = (names, host) => load("kanso-spaces/own-tree.js", names, host);
const at = new Date(2026, 10, 27, 9, 5).getTime();
const branch = "20261127-090500-codex";
const treePath = `/worktrees/app/${branch}`;
const file = `${root}/src/main.js`;
const nameOf = (agent) => agent.title;
const cwdOf = (agent) => agent.cwd;
const sharedEdits = (names, host) => load("kanso-spaces/shared-edits.js", names, host);
const scanner = async (run, { timer, fileOf = (agent) => agent.address } = {}) => {
  const { SharedEdits, groupsOf } = await sharedEdits(["SharedEdits", "groupsOf"], { exec: run });
  const shared = new SharedEdits(timer);
  return {
    scan: (agents = [first, second]) => shared.scan(groupsOf(agents, cwdOf), fileOf, nameOf),
    edits: (agent) => shared.editedBy(fileOf(agent), "", agent.cwd),
  };
};
const iso = (time = at) => new Date(time).toISOString();
const editsOf = (...files) => files.map((file) => ({ at, file }));
const editRows = (...files) => ["256", ...files.map((file) => `${iso()}\t${file}`), ""].join("\n");
const pairWarnings = (path = file, pair = [first, second]) => Object.fromEntries(pair.map((agent, i) => {
  const other = pair[1 - i].title;
  const base = posix.basename(path.replaceAll("\\", "/"));
  return [agent.address, { text: `Also changed by ${other}: ${base}`, tip: `${path}: ${other}` }];
}));

test("An agent in the project or a subfolder counts, but an agent in its own worktree, a remote agent and a shell do not.", async () => {
  const { workingIn } = await ownTreeModule(["workingIn"]);
  const inPane = { ...second, cwd: undefined };
  const list = [first, inPane, session("t4", "Dev", nested), session("dev/t5", "Chris", root), { address: "t6", cwd: root }];
  const shown = [{ terminal: second.address, cwd: second.cwd }];
  const lookups = [];
  const rootFor = async (folder, machine) => {
    lookups.push([folder, machine]);
    return folder === nested ? nested : root;
  };
  const busy = await workingIn(root, "", { list, shown, rootFor });
  same(busy.map((agent) => agent.address), [first.address, second.address]);
  assert.deepEqual(lookups, [root, second.cwd, nested].map((cwd) => [cwd, null]));
});

test("Starting in an occupied Git project reserves a branch for the new agent and returns its worktree or Git's error.", async () => {
  const error = "The worktree folder is already there.";
  const worktreeArgs = { folder: root, machine: null, branch, base: "/app/data/kanso/worktrees" };
  for (const [checkout, list, made, expected] of [
    ["", [first], null, null],
    [root, [], null, null],
    [root, [first], { path: treePath, made: true }, { path: treePath, branch, busy: [first] }],
    [root, [first], { error }, { error, busy: [first] }],
  ]) {
    const creates = [];
    const { ownTree } = await ownTreeModule(["ownTree"], {
      appHome: () => "/app",
      addWorktree: async (args) => { creates.push(args); return made; },
    });
    same(await ownTree(place, codex, at, { list, rootFor: async () => checkout }), expected);
    same(creates, made ? [worktreeArgs] : []);
  }
});

const treeStarter = async (t, folderIn = (repo) => repo, host = {}) => {
  const { dir, repo } = await committedRepo(t);
  const folder = await folderIn(repo, dir);
  const { ownTree } = await ownTreeModule(["ownTree"], {
    exec,
    agents: () => [{ ...first, cwd: folder }],
    appHome: () => dir,
    ...host,
  });
  return { dir, repo, start: (time = at) => ownTree({ ...place, folder }, codex, time) };
};

const checkoutPath = (outcome) => {
  assert.ok(outcome?.path, outcome?.error);
  return realpath(outcome.path);
};

test("Agents launched seconds apart get separate worktrees and never reuse one, even when every numbered branch name is taken.", async (t) => {
  const { dir, repo, start } = await treeStarter(t);
  const time = at + 1000;
  const initial = await start(), later = await start(time);
  assert.notEqual(await checkoutPath(initial), await checkoutPath(later));
  assert.notEqual(initial.branch, later.branch);
  for (const suffix of [2, 3, 4, 5]) {
    const taken = `${later.branch}-${suffix}`;
    await gitOk()(repo, "worktree", "add", "-b", taken, join(dir, taken));
  }
  const collision = await start(time);
  assert.match(collision.branch, new RegExp(`^${later.branch}-[a-z0-9]{1,4}$`));
  assert.ok(![initial, later].map(checkoutPath).includes(await checkoutPath(collision)));
  assert.notEqual(await checkoutPath(collision), await checkoutPath(later));
});

test("A project folder that is not tracked in Git starts at the new worktree's root instead of a folder that does not exist.", async (t) => {
  const { start } = await treeStarter(t, async (repo) => { const fresh = join(repo, "new-project"); await mkdir(fresh); return fresh; });
  const outcome = await start();
  const folder = await checkoutPath(outcome);
  assert.equal(folder, await realpath(await gitOk()(folder, "rev-parse", "--show-toplevel")));
});

test("An agent using a symlink to the project still occupies its Git checkout.", async (t) => {
  const { dir, repo } = await committedRepo(t);
  const alias = join(dir, "alias");
  await symlink(repo, alias, "junction");
  const agent = { ...first, cwd: alias };
  const { workingIn, rootOf } = await ownTreeModule(["workingIn", "rootOf"], { exec });
  same(await workingIn(await rootOf(repo, ""), "", { list: [agent] }), [agent]);
});

const sourceFolder = async (repo) => {
  const folder = join(repo, "src");
  await mkdir(folder);
  await writeFile(join(folder, "main.js"), "export {};\n");
  const git = gitOk();
  await git(repo, "add", "src");
  await git(repo, "commit", "-m", "add source");
  return folder;
};

const assertSourceCheckout = async (outcome) => {
  const folder = await checkoutPath(outcome);
  const git = gitOk();
  const checkout = await realpath(await git(folder, "rev-parse", "--show-toplevel"));
  assert.equal(folder, join(checkout, "src"));
  assert.equal(await git(folder, "branch", "--show-current"), outcome.branch);
};

test("An isolated agent starts in the same project subfolder inside its new worktree.", async (t) => {
  const { start } = await treeStarter(t, sourceFolder);
  await assertSourceCheckout(await start());
});

test("A symlink to a project subfolder still starts an isolated agent in that subfolder.", async (t) => {
  const { start } = await treeStarter(t, async (repo, dir) => {
    const alias = join(dir, "source-link");
    await symlink(await sourceFolder(repo), alias, "junction");
    return alias;
  });
  await assertSourceCheckout(await start());
});

test("Two starts of the same agent in one second use separate worktrees and the second branch gets a suffix.", async (t) => {
  const { start } = await treeStarter(t);
  const initial = await start(), next = await start();
  assert.deepEqual([initial.branch, next?.branch], [branch, `${branch}-2`]);
  assert.notEqual(await checkoutPath(initial), await checkoutPath(next));
});

test("Git branch collision errors make an isolated start try each suffix until it finds a free branch.", async (t) => {
  const errors = [
    `fatal: a branch named '${branch}' already exists`,
    `fatal: '${branch}-2' is already checked out`,
    `fatal: '${branch}-3' is already used by worktree at '/other'`,
    `fatal: a branch named '${branch}-4' already exists`,
  ];
  const branches = [];
  const { start } = await treeStarter(t, undefined, {
    addWorktree: async ({ branch }) => {
      const error = errors[branches.length];
      branches.push(branch);
      return error ? { error } : { path: treePath, made: true };
    },
  });
  const expected = [branch, ...[2, 3, 4, 5].map((n) => `${branch}-${n}`)];
  const outcome = await start();
  assert.deepEqual(branches, expected);
  assert.equal(outcome.branch, expected.at(-1));
  assert.equal(outcome.path, treePath);
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

const machine = "dev";
const onDev = (agent) => ({ ...agent, address: `${machine}/${agent.address}` });

const groupsFor = async (agents) => {
  const { groupsOf } = await sharedEdits(["groupsOf"]);
  return groupsOf(agents, cwdOf);
};

test("Agents on different computers do not share a group even when their paths match.", async () => {
  const local = [first, second], remote = local.map(onDev);
  same(await groupsFor([...local, ...remote]), [local, remote].map((agents, i) => {
    const key = i ? machine : "";
    return { key, machine: key, agents: agents.map((a) => ({ a, machine: key, cwd: a.cwd })) };
  }));
});

test("One agent on a computer does not form a group.", async () => {
  same(await groupsFor([first, onDev(second)]), []);
});

const tmpCheckout = "/tmp/app";
const aliases = [tmpCheckout, `/private${tmpCheckout}`];
const inFolders = (...folders) => folders.map((cwd, i) => ({ ...[first, second, third][i], cwd }));
const scanEdits = (gitRun, edits) => scanner((command, args, options) => command === "sh"
  ? Promise.resolve(success(editRows(...(edits[args[3]] ?? []))))
  : gitRun(command, args, options));
const sharedFileEdits = (agents, changed) => Object.fromEntries(agents.map(({ address }) => [address, [changed]]));

for (const [name, folders, roots] of [
  ["Agents in the same folder are compared in one checkout.", [root, root], [root, root]],
  ["An agent in a subfolder is compared with an agent at the checkout root.", [second.cwd, root], [root, root]],
  ["Git roots using the two macOS temporary folder aliases are compared in one checkout.", aliases, aliases],
]) {
  test(name, async () => {
    const agents = inFolders(...folders);
    const changed = `${roots[0]}/src/main.js`;
    const statuses = [];
    const { scan } = await scanEdits(async (_command, [, cwd, action]) => {
      if (action === "rev-parse") return success(roots[folders.indexOf(cwd)]);
      if (action !== "status") return success("");
      statuses.push(cwd);
      return success(" M src/main.js\0");
    }, sharedFileEdits(agents, `${roots[1]}/src/main.js`));
    same(await scan(agents), pairWarnings(changed, agents));
    assert.deepEqual(statuses, [roots[0]]);
  });
}

const realCheckout = async (t) => realpath((await committedRepo(t)).repo);

const dirtyCheckout = async (t) => {
  const checkout = await realCheckout(t);
  const changed = join(checkout, "draft.txt");
  await writeFile(changed, "not committed\n");
  return { checkout, changed };
};

test("Agents in sibling folders of one checkout are warned about their shared edit.", async (t) => {
  const { checkout, changed } = await dirtyCheckout(t);
  const folders = ["frontend", "backend"].map((folder) => join(checkout, folder));
  await Promise.all(folders.map((folder) => mkdir(folder)));
  const agents = inFolders(...folders);
  const { scan } = await scanEdits(exec, sharedFileEdits(agents, changed));
  same(await scan(agents), pairWarnings(changed, agents));
});

test("An agent in a nested Git worktree is not counted as an editor in the enclosing checkout.", async (t) => {
  const { checkout, changed } = await dirtyCheckout(t);
  const worktree = join(checkout, ".worktrees", "topic");
  await gitOk()(checkout, "worktree", "add", "--detach", worktree);
  const agents = inFolders(checkout, checkout, worktree);
  const { scan } = await scanEdits(exec, sharedFileEdits(agents, changed));
  same(await scan(agents), pairWarnings(changed, agents.slice(0, 2)));
});

test("Git on a remote computer receives the raw temporary folder paths.", async () => {
  const agents = inFolders(tmpCheckout, `${tmpCheckout}/src`).map(onDev);
  const changed = `${agents[1].cwd}/main.js`;
  const lookups = [];
  const { scan } = await scanEdits(async (_command, [, cwd, action], { on }) => {
    assert.equal(on, machine);
    if (action === "rev-parse") {
      lookups.push(cwd);
      return agents.some((agent) => agent.cwd === cwd) ? success(tmpCheckout) : failure("Not a directory");
    }
    assert.equal(cwd, tmpCheckout);
    return success(action === "status" ? " M src/main.js\0" : "");
  }, sharedFileEdits(agents, changed));
  same(await scan(agents), pairWarnings(changed, agents));
  assert.deepEqual(lookups, agents.map(cwdOf));
});

test("The scan checks Git status once per checkout and compares known transcripts with renamed and untracked files.", async () => {
  const dir = second.cwd;
  const changed = `${dir}/new notes.md`;
  const agents = [onDev({ ...first, cwd: dir }), onDev({ ...second, cwd: `${dir}/tools` })];
  const fileOf = (agent) => `/logs/${agent.address}.jsonl`;
  const requests = [], reads = [];
  const output = {
    [fileOf(agents[0])]: editRows("main.js", "new notes.md", "old.js", "solo.js"),
    [fileOf(agents[1])]: editRows("../main.js", changed, "../old.js"),
  };
  const porcelain = "R  src/main.js\0src/old.js\0?? src/new notes.md\0 M src/solo.js\0";
  const { scan } = await scanner(async (command, args, { on }) => {
    if (command === "sh") {
      reads.push([args[3], on]);
      return success(output[args[3]]);
    }
    requests.push([command, args, on]);
    return success({ "rev-parse": root, status: porcelain, log: "" }[args[2]]);
  }, { fileOf });
  const warnings = await scan([...agents, first]);
  same(requests, [
    ...agents.map(({ cwd }) => ["git", ["-C", cwd, "rev-parse", "--show-toplevel"], machine]),
    ["git", ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"], machine],
    ...[file, changed].map((path) => ["git", ["-C", root, "log", "-1", "--format=%cI", "--", path], machine]),
  ]);
  same(reads, agents.map((agent) => [fileOf(agent), machine]));
  same(warnings, Object.fromEntries(agents.map((agent, i) => {
    const other = agents[1 - i].title;
    return [agent.address, { text: `Also changed by ${other}: main.js and 1 more`, tip: `${file}: ${other}\n${changed}: ${other}` }];
  })));
});

test("Rename and copy source records never make unrelated clean paths look dirty.", async () => {
  const porcelain = "R  src/main.js\0src/untouched.js\0 C copy.js\0src/clean.js\0";
  const edits = editRows(file, `${root}/untouched.js`, `${root}/clean.js`);
  const { scan } = await scanner(async (command, args) => {
    if (command === "sh") return success(edits);
    return success(args.includes("status") ? porcelain : root);
  });
  same(await scan(), pairWarnings());
});

const posixScan = { skip: process.platform === "win32" && "The transcript scan uses POSIX sh" };
const jsonl = (...entries) => entries.map((entry) => JSON.stringify(entry) + "\n").join("");
const transcripts = async (t, run = exec) => {
  const dir = await temporary(t);
  const fileOf = (agent) => join(dir, `${agent.address}.jsonl`);
  return {
    ...await scanner(run, { fileOf }),
    write: (agent, ...entries) => writeFile(fileOf(agent), jsonl(...entries)),
    append: (agent, ...entries) => appendFile(fileOf(agent), jsonl(...entries)),
  };
};
const toolCall = (name, input, time = at, id) => ({
  type: "assistant", timestamp: iso(time), message: { content: [{ type: "tool_use", id, name, input }] },
});
const claudeEdit = (file_path, time, id) => toolCall("Edit", { file_path }, time, id);
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
  const run = mockGit(canonical);
  const { workingIn } = await ownTreeModule(["workingIn"], { exec: run });
  const busy = (await workingIn(folder, "", { list: group })).map((agent) => agent.address);
  const history = await transcripts(t, run);
  await history.write(first, claudeEdit(`/private${changed}`));
  await history.write(second, patchCall("*** Update File: main.js\n"));
  same({ busy, warnings: await history.scan(group) }, {
    busy: group.map((agent) => agent.address), warnings: pairWarnings(`/private${changed}`),
  });
});

test("A Codex patch whose result failed does not count as an edit.", posixScan, async (t) => {
  const history = await transcripts(t);
  await history.write(second, { ...patchCall("*** Update File: main.js\n"), payload: { ...patchCall("").payload, input: "*** Update File: main.js\n", call_id: "c1" } },
    { timestamp: iso(), type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c1", output: "apply_patch verification failed: no match" } });
  same(await history.edits(second), []);
});

test("A Claude Code edit counts even when replace_all comes before the file path.", posixScan, async (t) => {
  const history = await transcripts(t, mockGit());
  await history.write(first, toolCall("Edit", { replace_all: true, file_path: file, old_string: "a", new_string: "b" }));
  await history.write(second, patchCall("*** Update File: main.js\n"));
  same(await history.scan(), pairWarnings());
});

const resultOf = (tool_use_id, content, is_error = false) => ({ type: "tool_result", tool_use_id, content, is_error });
const toolResults = (...content) => ({ type: "user", timestamp: iso(at + 1000), message: { content } });

test("A failed Claude Code edit does not warn, even when its error arrives after a transcript scan.", posixScan, async (t) => {
  const history = await transcripts(t, mockGit());
  const id = "toolu_failed";
  const attempted = claudeEdit(file, at, id);
  const failed = toolResults(resultOf(id, "The file has not been read.", true));
  await history.write(first, attempted, failed);
  await history.write(second, patchCall("*** Update File: main.js\n"));
  const fresh = await history.scan();
  await history.write(first, attempted);
  await history.edits(first);
  await history.append(first, failed);
  const incremental = await history.scan();
  same({ fresh, incremental }, { fresh: {}, incremental: {} });
});

test("A batch of Claude Code results drops only the edit whose result failed.", posixScan, async (t) => {
  const history = await transcripts(t);
  const kept = `${root}/kept.js`;
  const passed = "toolu_passed", failed = "toolu_failed";
  await history.write(first, claudeEdit(kept, at, passed), claudeEdit(file, at, failed), toolResults(
    resultOf(passed, "File updated."),
    resultOf(failed, "The file has not been read.", true),
  ));
  same((await history.edits(first)).map(({ file }) => file), [kept]);
});

test("An agent's edit before the file's last commit does not warn about another agent's later edit.", posixScan, async (t) => {
  const checkout = await realCheckout(t);
  const changed = join(checkout, "readme");
  const committedAt = Date.parse(await gitOk()(checkout, "log", "-1", "--format=%cI", "--", changed));
  assert.ok(Number.isFinite(committedAt));
  const history = await transcripts(t);
  await history.write(first, claudeEdit(changed, committedAt - 1000));
  await history.write(second, claudeEdit(changed, committedAt + 1000));
  await writeFile(changed, "dirty\n");
  const group = [first, second].map((agent) => ({ ...agent, cwd: checkout }));
  same(await history.scan(group), {});
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

const trackScan = async (reply, options) => {
  const requests = [];
  const { scan } = await scanner(async (_command, [, cwd, action]) => {
    requests.push([action, cwd]);
    return reply(action, requests.length);
  }, options);
  return { scan, requests };
};

test("A failed checkout lookup is retried and the next scan checks for shared edits.", async () => {
  const { scan, requests } = await trackScan((action, count) => {
    if (count === 1) return failure("Git could not find the checkout");
    return success(action === "rev-parse" ? root : "");
  });
  await scan();
  const firstPass = [["rev-parse", root], ["rev-parse", second.cwd]];
  assert.deepEqual(requests, firstPass);
  await scan();
  assert.deepEqual(requests.slice(firstPass.length), [["rev-parse", root], ["status", root]]);
});

test("An unanswered Git status times out and does not prevent the next scan.", async () => {
  const timers = [];
  const { scan, requests } = await trackScan((action, count) => {
    if (action === "rev-parse") return success(root);
    return count === 3 ? new Promise(() => {}) : success("");
  }, { timer: { after: (ms, fn) => timers.push([ms, fn]) } });
  const pending = scan();
  await new Promise(setImmediate);
  const firstPass = [["rev-parse", root], ["rev-parse", second.cwd], ["status", root]];
  assert.deepEqual(requests, firstPass);
  const [ms, expire] = timers.at(-1) ?? [];
  assert.equal(ms, 15_000);
  expire();
  same(await Promise.race([pending, new Promise((resolve) => setImmediate(() => resolve("still waiting")))]), {});
  await scan();
  assert.deepEqual(requests.slice(firstPass.length), [["status", root]]);
});

const idlePair = [first, second].map((agent) => ({ ...agent, status: "idle" }));
const workingPair = [{ ...idlePair[0], status: "working" }, idlePair[1]];
const otherCheckout = "/projects/other";
const sharingSidebar = async ({ beforeStatus } = {}) => {
  let now = at, list = idlePair, dirty = false;
  const commands = [], store = {};
  const fileOf = (agent) => `/logs/${agent.address}.jsonl`;
  const threads = Object.fromEntries(idlePair.map((agent) => [agent.address, { file: fileOf(agent) }]));
  const { Spaces } = await loadSpaces({
    ...storeShared(store),
    Date: class extends Date { static now() { return now; } },
    agents: () => list,
    spaces: () => [],
    exec: async (command, args) => {
      const action = command === "git" ? args[2] : command;
      commands.push(action);
      if (action === "status") await beforeStatus?.();
      const checkout = args[1] === otherCheckout ? otherCheckout : root;
      const result = { "rev-parse": checkout, status: dirty ? " M src/main.js\0" : "", log: "" };
      if (action === "sh") return success(Object.values(threads).some(({ file }) => file === args[3]) ? editRows(file) : "");
      return success(result[action]);
    },
  });
  const mount = () => Object.assign(new Spaces(), { names: { book: {} }, threads: { ...threads } });
  let view = mount();
  return {
    get view() { return view; },
    remount: () => { view = mount(); },
    hideWarnings: () => { store["kanso.pieces"] = { "sidebar.shared": "hide" }; },
    locate: (agent, known) => { view.threads[agent.address] = known ? threads[agent.address] : null; },
    setDirty: (value) => { dirty = value; },
    tick: async (elapsed, next = list) => {
      now = at + elapsed;
      list = next;
      const start = commands.length;
      let pending, notifies = 0;
      const notify = () => { notifies += 1; };
      view.checkShared({ notify, spawn: (task) => { pending = task({ notify }); } });
      await pending;
      return { commands: commands.slice(start), notifies };
    },
  };
};

const sharedTick = 20_000;
const fiveMinutes = 5 * 60_000;

const checkoutScan = ["rev-parse", "rev-parse", "status"];

test("An idle group is scanned once, then starts no shared-edit processes while it stays idle.", async () => {
  const { tick } = await sharingSidebar();
  const idle = await tick(0);
  const stillIdle = await tick(sharedTick);
  const muchLater = await tick(fiveMinutes);
  assert.deepEqual([idle.commands, stillIdle.commands, muchLater.commands], [checkoutScan, [], []]);
});

test("Hiding shared edits clears the warnings and starts no shared-edit processes.", async () => {
  const { view, setDirty, hideWarnings, tick } = await sharingSidebar();
  setDirty(true);
  await tick(0, workingPair);
  same(view.sharedFound, pairWarnings());
  hideWarnings();
  assert.deepEqual(await tick(sharedTick, idlePair), { commands: [], notifies: 1 });
  same(view.sharedFound, {});
  assert.deepEqual(await tick(fiveMinutes, workingPair), { commands: [], notifies: 0 });
});

test("A running shared-edit scan cannot bring warnings back after they are hidden.", async () => {
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const { view, setDirty, hideWarnings, tick } = await sharingSidebar({
    beforeStatus: () => { started.resolve(true); return release.promise; },
  });
  setDirty(true);
  const pending = tick(0, workingPair);
  assert.equal(await Promise.race([started.promise, pending]), true);
  hideWarnings();
  const hidden = await tick(sharedTick);
  release.resolve();
  const finished = await pending;
  assert.deepEqual([hidden.notifies, finished.notifies], [0, 0]);
  same(view.sharedFound ?? {}, {});
});

test("Finding a missing transcript scans once and shows shared edits without waiting for another turn.", async () => {
  const { view, setDirty, locate, tick } = await sharingSidebar();
  locate(second, false);
  setDirty(true);
  const missing = await tick(0, workingPair);
  assert.deepEqual(missing.commands, []);
  same(view.sharedFound ?? {}, {});
  locate(second, true);
  const found = await tick(sharedTick);
  const unchanged = await tick(2 * sharedTick);
  assert.deepEqual([found.commands.slice(0, checkoutScan.length), unchanged.commands], [checkoutScan, []]);
  same(view.sharedFound, pairWarnings());
});

test("The remounted sidebar finds shared edits on its first tick even when both editors are idle.", async () => {
  const sidebar = await sharingSidebar();
  sidebar.setDirty(true);
  await sidebar.tick(0, workingPair);
  same(sidebar.view.sharedFound, pairWarnings());
  sidebar.remount();
  const result = await sidebar.tick(sharedTick, idlePair);
  assert.deepEqual(result.commands.slice(0, checkoutScan.length), checkoutScan);
  assert.equal(result.notifies, 1);
  same(sidebar.view.sharedFound, pairWarnings());
});

test("A turn that starts and finishes between ticks triggers a scan while the agent looks idle.", async () => {
  const { view, setDirty, tick } = await sharingSidebar();
  const turn = (seq) => [{ ...idlePair[0], seq }, idlePair[1]];
  await tick(0, turn(1));
  setDirty(true);
  const finished = await tick(sharedTick, turn(2));
  assert.equal(finished.commands[0], "status");
  same(view.sharedFound, pairWarnings());
  assert.deepEqual((await tick(2 * sharedTick)).commands, []);
});

test("An agent's finished turn triggers a scan before the five-minute rescan.", async () => {
  const { tick } = await sharingSidebar();
  await tick(0, workingPair);
  const continuing = await tick(sharedTick);
  const ended = await tick(2 * sharedTick, idlePair);
  const resting = await tick(3 * sharedTick);
  assert.deepEqual([continuing.commands, ended.commands, resting.commands], [[], ["status"], []]);
});

test("A continuously working group is rescanned only after five minutes.", async () => {
  const { tick } = await sharingSidebar();
  const start = await tick(0, workingPair);
  const early = await tick(sharedTick);
  const justBefore = await tick(fiveMinutes - 1);
  const due = await tick(fiveMinutes);
  const after = await tick(fiveMinutes + sharedTick);
  assert.deepEqual(start.commands, checkoutScan);
  assert.deepEqual([early.commands, justBefore.commands, due.commands, after.commands], [[], [], ["status"], []]);
});

for (const [name, remaining, expected] of [
  ["Both warnings clear without Git when only one agent remains on the computer.", idlePair.slice(0, 1), []],
  ["Both warnings clear when one agent moves to a different checkout.", [idlePair[0], { ...idlePair[1], cwd: otherCheckout }], ["rev-parse"]],
]) {
  test(name, async () => {
    const { view, setDirty, tick } = await sharingSidebar();
    setDirty(true);
    await tick(0, workingPair);
    await tick(sharedTick, idlePair);
    same(view.sharedFound, pairWarnings());
    const { commands, notifies } = await tick(2 * sharedTick, remaining);
    same(view.sharedFound, {});
    assert.deepEqual(commands, expected);
    assert.equal(notifies, 1);
  });
}

test("A departed editor's warning clears even when two other agents remain in the checkout.", async () => {
  const { view, setDirty, tick } = await sharingSidebar();
  const observer = { ...third, status: "idle" };
  setDirty(true);
  await tick(0, [...workingPair, observer]);
  same(view.sharedFound, pairWarnings());
  await tick(sharedTick, [...idlePair, observer]);
  same(view.sharedFound, pairWarnings());
  const unchanged = await tick(2 * sharedTick);
  const afterDeparture = await tick(3 * sharedTick, [idlePair[0], observer]);
  same(view.sharedFound, {});
  assert.deepEqual(unchanged.commands, []);
  assert.equal(afterDeparture.notifies, 1);
});

test("A new or cleared shared-edit warning invalidates the sidebar rows without waiting for other changes.", async () => {
  const { view, setDirty, tick } = await sharingSidebar();
  const expectRedraw = () => {
    assert.equal(view.rowsChanged(), true);
    assert.equal(view.rowsChanged(), false);
  };
  expectRedraw();
  setDirty(true);
  const added = await tick(0, workingPair);
  same(view.sharedFound, pairWarnings());
  assert.equal(added.notifies, 1);
  expectRedraw();
  setDirty(false);
  const cleared = await tick(sharedTick, idlePair);
  same(view.sharedFound, {});
  assert.equal(cleared.notifies, 1);
  expectRedraw();
});

const warningRow = async () => {
  const host = drawingHost();
  const { agentSession, sessionHeight } = await load("kanso-spaces/agents.js", ["agentSession", "sessionHeight"], host);
  const { c, H } = themed(await load("kanso-spaces/ui.js", ["tokens", "H"], host), KIT_NIGHT);
  const warning = pairWarnings()[first.address];
  const draw = (more) => agentSession(idlePair[0], 1, c, null, { label: first.title, shared: warning, ...more });
  const check = (row, height, more) => {
    assert.deepEqual(texts(row), [first.title, warning.text]);
    assert.ok(tipsOf(row).includes(warning.tip));
    assert.deepEqual([one(row, "h"), sessionHeight({ shared: warning, ...more })], [height, height]);
  };
  return { draw, check, H };
};

test("The sidebar puts the shared-edit warning on its second line even without activity.", async () => {
  const { draw, check, H } = await warningRow();
  const editing = { activity: "Editing" };
  check(draw(), H.two);
  check(draw(editing), H.two, editing);
});

test("A narrow sidebar row replaces the place fact and tooltip with the warning without adding a second line.", async () => {
  const { draw, check, H } = await warningRow();
  const more = { oneLine: true, directory: "App", wordTip: root };
  const narrow = draw(more);
  check(narrow, H.line, more);
  assert.ok(!tipsOf(narrow).includes(more.wordTip));
});

test("Helpers started by an agent count as agents in the shared-edit check, under the name their sidebar row shows.", async () => {
  const term = (address, extra = {}) => ({ address, parent: "t1", state: "live", status: "done", turn: 2, cwd: "/repo", title: "Edit notes", name: `helper-${address}`, labels: {}, report: { app: "claude-code", state: "done" }, ...extra });
  const host = {
    agents: () => [{ address: "t1", app: "claude-code", program: { agent: true }, status: "working", cwd: "/repo" }],
    terminals: () => [term("t2"), term("t3"), term("t4", { report: null }), term("t5", { state: "finished" }), term("t1", { parent: null })],
  };
  const { Spaces } = await loadSpaces(host);
  const view = new Spaces();
  same(view.helpers().map((a) => [a.address, a.name, a.status, a.seq, a.program.agent]), [["t2", "helper-t2", "done", 2, true], ["t3", "helper-t3", "done", 2, true]]);
});

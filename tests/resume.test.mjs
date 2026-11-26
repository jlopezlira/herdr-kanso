import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  arg, clone, drawingHost, exec, failure, find, inlineCx, KIT_NIGHT, load, nodes, one,
  same, storeShared, success, temporary, texts, timedContext,
} from "./helpers.mjs";
import { loadSpaces, loadTabs } from "./mod-fixtures.mjs";
import { RESUME_LABEL, resumeOf } from "../kanso/mods/kanso-sleep/resume.js";

const ID = "11111111-1111-4111-8111-111111111111";

test("A listed conversation keeps Claude, Codex and Pi, decodes a Windows folder, and drops a line with no folder or id", async () => {
  const { listedOf } = await load("kanso-spaces/resume-list.js", ["listedOf"]);
  const lines = [
    "/home/me/.claude/projects/-work-repo/abc.jsonl\t/work/repo\t",
    "/home/me/.codex/sessions/2026/11/10/rollout-x.jsonl\t/work/repo\t" + ID,
    "/home/me/.pi/agent/sessions/main/pi.jsonl\t/work/repo\tpi-1",
    "C:\\Users\\me\\.claude\\projects\\x\\abc.jsonl\tC:\\\\work\\\\repo\tabc",
    "/home/me/.codex/sessions/2026/11/10/rollout-x.jsonl\t\tok",
    "/home/me/.codex/sessions/2026/11/10/rollout-x.jsonl\t/work/repo\t",
    "/tmp/notes.jsonl\t/work/repo\tok",
  ].join("\n");
  const listed = listedOf(lines);
  assert.deepEqual(clone(listed.map((row) => row.program)), ["claude", "codex", "pi", "claude"]);
  assert.equal(listed[0].id, "abc");
  assert.equal(listed[1].id, ID);
  assert.equal(listed[3].cwd, "C:\\work\\repo");
});

test("Resume lists the newest copy of a conversation once per computer.", async () => {
  const { onceEach, newestFirst } = await load("kanso-spaces/resume-list.js", ["onceEach", "newestFirst"]);
  const older = { id: "abc", file: "/old.jsonl", at: 1000 };
  const newer = { id: "ABC", file: "/new.jsonl", at: 3000 };
  const remote = { ...older, machine: "lab", at: 2000 };
  same(onceEach(newestFirst([older, newer, remote])), [newer, remote]);
});

const loadHeldBy = () => load("kanso-spaces/resume-list.js", ["heldBy", "keyOf", "newestFirst"]);

test("A conversation id identifies its open or sleeping terminal on the same computer.", async () => {
  const { heldBy, keyOf } = await loadHeldBy();
  const local = { id: "abc" };
  const remote = { ...local, machine: "lab" };
  const open = { ...local, address: "t1" };
  const asleep = { ...remote, address: "lab/t2", asleep: true };
  const held = heldBy([local, remote], [open, asleep]);
  assert.equal(held.get(keyOf(local)), open);
  assert.equal(held.get(keyOf(remote)), asleep);
  assert.equal(held.has(keyOf({ ...local, machine: "other" })), false);
});

for (const [program, name, unrelated] of [["pi", "Pi", "codex"], ["codex", "Codex", "pi"]]) {
  test(`A ${name} terminal holds the newest ${name} conversation written in its folder since it started, not another program's.`, async () => {
    const { heldBy, keyOf, newestFirst } = await loadHeldBy();
    const row = { program, cwd: "/work/project", machine: "lab" };
    const terminal = { ...row, cwd: row.cwd + "/", since: 2000, address: "lab/t1" };
    const older = { ...row, id: "older", at: 3000 };
    const newer = { ...row, id: "newer", at: 4000 };
    const other = { ...row, id: "elsewhere", cwd: "/work/elsewhere", at: 5000 };
    const elsewhere = { ...row, id: "another-computer", machine: "other", at: 6000 };
    const crossProgram = { ...row, id: "another-program", program: unrelated, at: 7000 };
    const held = heldBy(newestFirst([older, newer, other, elsewhere, crossProgram]), [terminal]);
    assert.equal(held.get(keyOf(newer)), terminal);
    assert.equal(held.size, 1);
  });
}

test("A Pi terminal does not hold a conversation last written before it started.", async () => {
  const { heldBy } = await loadHeldBy();
  const conversation = { id: "old", program: "pi", cwd: "/work/pi", at: 1000 };
  const terminal = { program: "pi", cwd: conversation.cwd, since: 2000, address: "t1" };
  assert.equal(heldBy([conversation], [terminal]).size, 0);
});

test("A session id is read from a rollout filename, Pi session path or bare id, not arbitrary text.", async () => {
  const { idIn } = await load("kanso-panel/conversation-at.js", ["idIn"]);
  const id = "ABCDEF01-1111-4111-8111-111111111111";
  for (const word of [id, `/home/me/.codex/sessions/rollout-2026-11-10-${id}.jsonl`, `C:\\repo\\2026-11-10_${id}.jsonl`]) {
    assert.equal(idIn(word), id.toLowerCase());
  }
  assert.equal(idIn(`rollout-${id}.jsonl.bak`), null);
});

const pid = 42;
const since = 3000;
const cwd = "/work/project";
const home = "/home/me";
const piFile = `${home}/.pi/agent/sessions/main/2026-11-10_${ID}.jsonl`;
const rollout = `${home}/.codex/sessions/rollout-2026-11-10-${ID}.jsonl`;
const terminalRecord = (argv, foreground = argv) => success(JSON.stringify({ argv, cwd, foreground: { argv: foreground, pid, cwd } }));

for (const [label, argv, foreground, expected, openFilesUnavailable] of [
  ["Claude Code from its live session record", ["claude"], ["claude"], { id: ID }],
  ["Codex from a child process's open rollout file", ["codex"], ["codex"], { id: ID }],
  ["Codex by its folder and start when its open files cannot be read", ["codex.exe"], ["codex.exe"], { program: "codex", cwd, since }, true],
  ["Pi started with --session from its session path", ["pi", "--session", piFile], ["pi"], { id: ID }],
  ["Pi started without --session by its folder and start time", ["pi"], ["pi"], { program: "pi", cwd, since }],
  ["Pi resumed from a shell by the session its own command names", ["zsh"], ["pi", "--session", piFile], { id: ID }],
  ["no conversation in a plain shell", ["zsh"], ["zsh"], null],
]) {
  test(`Resume identifies ${label}.`, async () => {
    const { heldIn } = await load("kanso-panel/conversation-at.js", ["heldIn"]);
    const host = {
      hc: async (args) => {
        same(args, ["get", "t1", "--json"]);
        return terminalRecord(argv, foreground);
      },
      home: () => home,
      readTextFile: async (path) => {
        assert.equal(path, `${home}/.claude/sessions/${pid}.json`);
        return JSON.stringify({ pid, sessionId: ID, cwd, startedAt: since });
      },
      platform: { processes: {
        startTime: async () => since,
        list: async () => ({ byParent: new Map([[pid, [{ pid: pid + 1 }]]]) }),
        openFiles: async ([which]) => openFilesUnavailable
          ? { state: "unavailable", reason: "no handle" }
          : { state: "ok", values: which === pid + 1 ? [{ path: rollout }] : [] },
      } },
    };
    same(await heldIn(host, "t1"), expected);
  });
}

test("A search matches the title, the folder or the computer, and an open space is the one already on that folder", async () => {
  const { findsIn, openSpaceAt } = await load("kanso-spaces/resume-list.js", ["findsIn", "openSpaceAt"]);
  const rows = [{ title: "The plan", cwd: "/work/Alpha", machine: "devbox" }];
  assert.equal(rows.filter(findsIn("")).length, 1);
  assert.equal(rows.filter(findsIn(" PLAN ")).length, 1);
  assert.equal(rows.filter(findsIn("alpha")).length, 1);
  assert.equal(rows.filter(findsIn("Dev")).length, 1);
  assert.equal(rows.filter(findsIn("missing")).length, 0);
  const spaces = [{ id: "sp", folder: "/work/alpha/", machine: "devbox" }, { id: "other", folder: "/work/alpha", machine: "lab" }];
  assert.equal(openSpaceAt(spaces, "/work/alpha", "devbox")?.id, "sp");
  assert.equal(openSpaceAt(spaces, "/work/alpha", ""), null);
});

test("Sleep resumes Claude, Codex and Pi, and leaves an unknown program", () => {
  assert.deepEqual(resumeOf("claude", ["claude", "--model", "opus"], { id: ID }), ["claude", "--model", "opus", "--resume", ID]);
  assert.deepEqual(resumeOf("codex", ["codex"], { id: ID }), ["codex", "resume", ID]);
  assert.equal(resumeOf("codex", ["codex"], { id: "nope" }), null);
  assert.deepEqual(resumeOf("pi", ["pi"], { file: "/tmp/s.jsonl" }), ["pi", "--session", "/tmp/s.jsonl"]);
  assert.equal(resumeOf("pi", ["pi"], {}), null);
  assert.equal(resumeOf("vim", ["vim"], { id: ID, file: "/tmp/s.jsonl" }), null);
});

test("The focused agent leads the recent list, a dead one drops, fifty is the most, and an unchanged list is not written", async () => {
  const live = ["focus", "old", ...Array.from({ length: 55 }, (_, i) => "a" + i)];
  const state = {};
  const writes = [];
  let focused = "focus";
  const { recentWith, noteFocus, RECENT } = await load("kanso-menu/recent.js", ["recentWith", "noteFocus", "RECENT"], {
    focused: () => ({ agent: focused }),
    agents: () => live.map((address) => ({ address })),
    shared: (key) => state[key] ?? null,
    setShared: (key, value) => { writes.push(key); state[key] = value; },
  });
  const next = recentWith(["dead", "old", "focus", ...live.slice(2), "extra"], "focus", new Set(live));
  assert.equal(next[0], "focus");
  assert.equal(next.includes("dead"), false);
  assert.equal(next.includes("extra"), false);
  assert.equal(next.length, 50);
  state[RECENT] = ["dead", "old", "focus"];
  noteFocus();
  assert.equal(state[RECENT][0], "focus");
  assert.equal(state[RECENT].includes("dead"), false);
  const written = writes.length;
  noteFocus();
  assert.equal(writes.length, written, "an unchanged list is not written");
  focused = "gone";
  noteFocus();
  assert.equal(writes.length, written, "an agent that is not running is not written");
});

test("The switcher lists the recent ones first, then the rest in agent order, and a sleeping one last with the Claude icon", async () => {
  const { switchOrder } = await load("kanso-menu/switcher.js", ["switchOrder"]);
  const live = [
    { address: "c", program: { key: "codex", icon: "icons/codex.svg" } },
    { address: "a", program: { key: "claude", icon: "icons/claude.svg" } },
    { address: "b", program: { key: "pi", icon: "icons/pi.svg" } },
  ];
  const order = switchOrder(["b", "missing", "a"], live, [{ address: "z" }]);
  assert.deepEqual(clone(order.map((row) => row.address)), ["b", "a", "c", "z"]);
  assert.equal(order.at(-1).asleep, true);
  assert.deepEqual(clone(order.at(-1).program), { key: "claude", icon: "icons/claude.svg" });
});

const stamp = async (file, body, ms) => { await writeFile(file, body); await utimes(file, ms / 1000, ms / 1000); };
const claudeRecord = (cwd) => JSON.stringify({ type: "user", message: { content: "plan the release" }, cwd, timestamp: "2026-11-10T10:00:00.000Z" });
const loadTranscripts = () => load("kanso-panel/platform-transcripts.js", ["transcriptApi", "projectDir"]);
const listingAt = (home, transcriptApi) => transcriptApi("macos", (command, args, options) =>
  exec(command, args, { ...options, env: { ...process.env, HOME: home } }));

test("A folder's conversations are the newest of that folder, only as many as asked, and a modern Codex line still has its first prompt", async (t) => {
  const home = await temporary(t);
  const alpha = join(home, ".claude", "projects", "-work-alpha");
  const beta = join(home, ".claude", "projects", "-work-beta");
  const codexDir = join(home, ".codex", "sessions", "2026", "11", "10");
  const piDir = join(home, ".pi", "agent", "sessions", "main");
  await mkdir(alpha, { recursive: true });
  await mkdir(beta, { recursive: true });
  await mkdir(codexDir, { recursive: true });
  await mkdir(piDir, { recursive: true });
  const claude = (cwd, title) => claudeRecord(cwd) + "\n" + JSON.stringify({ type: "ai-title", aiTitle: title }) + "\n";
  const newer = join(alpha, "new.jsonl");
  const older = join(alpha, "old.jsonl");
  const other = join(beta, "beta.jsonl");
  await stamp(newer, claude("/work/alpha", "The new plan"), 4000);
  await stamp(older, claude("/work/alpha", "The old plan"), 2000);
  await stamp(other, claude("/work/beta", "The other plan"), 3000);
  const codex = join(codexDir, "rollout-2026-11-10T12-00-00-" + ID + ".jsonl");
  const first = JSON.stringify({ type: "session_meta", payload: { id: ID, cwd: "/work/codex", note: "x".repeat(4001) } });
  assert.ok(first.length > 4000, first.length);
  const prompt = JSON.stringify({ type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "ship the long one" }] } }, timestamp: "2026-11-10T12:00:00.000Z" });
  assert.equal(prompt.includes("user_message"), false);
  await stamp(codex, first + "\n" + prompt + "\n", 3500);
  const pi = join(piDir, "draw.jsonl");
  await stamp(pi, JSON.stringify({ type: "message", message: { role: "user", content: "draw the menu" }, id: "pi-1", cwd: "/work/pi", timestamp: "2026-11-10T09:00:00.000Z" }) + "\n", 1000);
  await writeFile(join(home, ".codex", "session_index.jsonl"), JSON.stringify({ id: ID, thread_name: "The rollout" }) + "\n");
  const { transcriptApi } = await loadTranscripts();
  const { threadIn } = await load("kanso-spaces/threads.js", ["threadIn"]);
  const { listedOf, recordsOf } = await load("kanso-spaces/resume-list.js", ["listedOf", "recordsOf"]);
  const api = listingAt(home, transcriptApi);
  const scoped = await api.listing(home, { folder: "/work/alpha", shown: 10, most: 20 });
  assert.equal(scoped.code, 0, scoped.stderr);
  assert.deepEqual(clone(listedOf(scoped.stdout).map((row) => row.file)), [newer, older]);
  const one = await api.listing(home, { folder: "/work/alpha", shown: 1, most: 20 });
  assert.deepEqual(clone(listedOf(one.stdout).map((row) => row.file)), [newer]);
  const all = await api.listing(home, { shown: 10, most: 20 });
  assert.deepEqual(clone(listedOf(all.stdout).map((row) => row.file)), [newer, codex, other, older, pi]);
  const read = await api.threads([newer, codex, pi]);
  assert.equal(read.code, 0, read.stderr);
  const threads = recordsOf(read.stdout).filter(Boolean);
  assert.equal(threads.length, 3, read.stdout);
  const [claudeThread, codexThread, piThread] = threads.map((text, i) => threadIn(["claude", "codex", "pi"][i], text));
  assert.equal(claudeThread.title, "The new plan");
  assert.equal(codexThread.title, "The rollout");
  assert.equal(codexThread.prompt, "ship the long one");
  assert.equal(piThread.title, "draw the menu");
});

test("The Windows conversation reader recognizes Codex paths without treating Claude paths as Codex.", async () => {
  const { transcriptApi } = await loadTranscripts();
  const codex = String.raw`C:\Users\me\.codex\sessions\rollout.jsonl`;
  const claude = String.raw`C:\Users\me\.claude\projects\repo\chat.jsonl`;
  let script;
  const api = transcriptApi("windows", async (_command, args) => { script = args.at(-1); return success(""); });
  await api.threads([codex, claude]);
  const match = /\$file -match '([^']+)'/.exec(script);
  assert.ok(match, "The batch reader supplies a path pattern.");
  const pattern = new RegExp(match[1], "i");
  assert.match(codex, pattern);
  assert.doesNotMatch(claude, pattern);
});

test("A project with thousands of Claude conversations still lists its newest 30.", { skip: process.platform === "win32" }, async (t) => {
  const home = await temporary(t);
  const folder = "/work/" + "a".repeat(155);
  const { transcriptApi, projectDir } = await loadTranscripts();
  const { listedOf } = await load("kanso-spaces/resume-list.js", ["listedOf"]);
  const claudeDir = projectDir(folder);
  const project = join(home, ".claude", "projects", claudeDir);
  await mkdir(project, { recursive: true });

  const files = Array.from({ length: 4601 }, (_, i) => join(project, ID.slice(0, -12) + String(i).padStart(12, "0") + ".jsonl"));
  const body = claudeRecord(folder) + "\n";
  for (const [i, file] of files.entries()) await stamp(file, body, Date.UTC(2026, 0, 1) + i * 1000);

  const result = await listingAt(home, transcriptApi).listing(home, { claudeDir, folder, shown: 30 });
  assert.equal(result.code, 0, result.stderr);
  const listed = listedOf(result.stdout).map((row) => row.file);
  assert.equal(listed.length, 30);
  assert.deepEqual(clone(listed), files.slice(-30).reverse());
});

test("Resume offers Refresh when the selected computer fails, but skips it in the combined list.", async () => {
  const place = { machine: "devbox", folder: "/work" };
  const failure = "Computer disconnected";
  const local = { title: "Local conversation", cwd: "/local", program: "claude" };
  const { Spaces } = await loadSpaces({
    ...drawingHost(),
    props: () => ({ resume: place }),
    machines: () => [{ name: place.machine, layout: "ready" }],
  });
  const view = new Spaces();
  view.resumeFind = { value: () => "" };
  const requests = [];
  view.recentOn = async (on) => {
    requests.push(on);
    if (on === place.machine) throw new Error(failure);
    return [local];
  };
  const read = (scope) => new Promise((resolve) => view.loadRecent(scope, inlineCx({ notify: resolve })));

  await read(place);
  const failed = view.recentFailed;
  const shown = texts(view.resumeView(KIT_NIGHT));

  await read({});
  assert.deepEqual(requests, [place.machine, null, place.machine]);
  assert.deepEqual(clone(view.recent), [local]);
  assert.equal(view.recentFailed, null);
  assert.deepEqual({ failed, refresh: shown.includes("Refresh"), empty: shown.includes("No past conversations here") },
    { failed: failure, refresh: true, empty: false });
});

test("The first keyboard selection in a project's Resume menu is its conversation.", async () => {
  const { Spaces } = await loadSpaces();
  const view = new Spaces();
  const place = { folder: "/work" };
  const conversation = { title: "First result", cwd: place.folder, program: "claude" };
  view.menuAt = 0;
  const { items } = view.resumeLines(place, { item: view.lines(), recent: [conversation] });
  const selected = items.flatMap((item) => item.scroll ?? [item]).find((item) => item.selected);
  assert.equal(selected?.label, conversation.title);
});

const resumePopup = async (conversation, host = {}) => {
  const place = { folder: conversation.cwd, machine: conversation.machine, space: "project" };
  const commands = [], overlays = [];
  const { Spaces } = await loadSpaces({ ...drawingHost(),
    ...storeShared({}),
    props: () => ({ resume: place, overlay: "resume" }),
    closeOverlay: () => {},
    openOverlay: (overlay) => { overlays.push(overlay); },
    run: (command, args) => { commands.push([command, args]); },
    knownAgents: async () => [],
    spaces: () => [],
    home: () => home,
    ...host,
  });
  const choose = async () => {
    const timers = [], { cx } = timedContext(timers);
    const view = new Spaces();
    view.recentOn = async () => [conversation];
    view.openResume(place, cx);
    timers.find(([ms]) => ms === 0)[1](cx);
    await nextTurn();
    const row = find(view.resumeView(KIT_NIGHT), (el) => arg(el, "accessibility_label") === conversation.title);
    assert.ok(row, "Resume lists the conversation");
    one(row, "on_click")({}, cx);
    await nextTurn();
    return texts(row);
  };
  return { choose, commands, overlays };
};

test("Resume shows Open on another computer and focuses that terminal instead of starting a tab or space.", async () => {
  const conversation = { id: ID, title: "Remote plan", program: "codex", cwd, machine: "lab" };
  const address = "lab/t1";
  const { choose, commands } = await resumePopup(conversation, {
    agents: () => [{ address, app: "codex" }],
    hc: async (args) => {
      same(args, ["get", address, "--json"]);
      return terminalRecord(["codex"]);
    },
    exec: async (command, args, options) => {
      assert.equal(options.on, conversation.machine);
      if (command === "pwsh") return failure("Not Windows");
      if (command === "uname") return success("Darwin");
      if (command === "sh") return success(home);
      if (command === "lsof") return success(`p${pid}\nn${rollout}\n`);
      if (command === "ps") return success("");
      throw new Error(`Unexpected remote command: ${command} ${args.join(" ")}`);
    },
  });
  const words = await choose();
  same({ open: words.includes("Open"), commands }, {
    open: true,
    commands: [["pane.focus", { terminal: address }]],
  });
});

test("Resume waits for a lookup past the 12-second deadline and focuses the existing terminal.", async () => {
  const address = "t1";
  const conversation = { id: ID, program: "codex", cwd };
  const lookup = Promise.withResolvers();
  const commands = [];
  const { Spaces } = await loadSpaces({
    agents: () => [{ address, app: "codex" }],
    hc: () => lookup.promise,
    home: () => home,
    spaces: () => [],
    exec: async (command) => success(command === "lsof" ? `p${pid}\nn${rollout}\n` : ""),
    run: (command, args) => { commands.push([command, args]); },
  });
  const view = new Spaces();
  const scheduled = [];
  const { cx } = timedContext(scheduled);
  view.loadHeld(cx);
  await nextTurn();
  const [, deadline] = scheduled.find(([ms]) => ms === 12000);
  deadline(cx);
  const choice = view.resumeOne({ folder: cwd, space: "project" }, conversation);
  await nextTurn();
  const beforeLookup = commands.slice();
  lookup.resolve(terminalRecord(["codex"]));
  await choice;
  await nextTurn();
  same({ beforeLookup, commands }, { beforeLookup: [], commands: [["pane.focus", { terminal: address }]] });
});

test("Resume shows Asleep and opens the wake dialog instead of starting a tab or space.", async () => {
  const conversation = { id: ID, title: "Sleeping plan", program: "claude", cwd };
  const address = "t2";
  const space = "project";
  const { choose, commands, overlays } = await resumePopup(conversation, {
    terminals: () => [{ address, program: { shell: true }, labels: { [RESUME_LABEL]: ID } }],
    panes: () => [{ terminal: address, tab: "tab" }],
    spaces: () => [{ id: space, tabs: [{ id: "tab" }] }],
  });
  const asleep = (await choose()).includes("Asleep");
  const dialogs = overlays.map(({ mod, kind, props }) => [mod, kind, props]);
  same({ asleep, commands, dialogs }, {
    asleep: true, commands: [], dialogs: [["kanso-sleep", "dialog", { wake: { space, terminal: address } }]],
  });
});

test("A second Resume choice within 30 seconds starts no other tab, even from a new menu.", async () => {
  const conversation = { id: ID, title: "Launch plan", program: "codex", cwd };
  let now = 100000;
  const { choose, commands } = await resumePopup(conversation, { Date: { now: () => now } });
  const actions = () => commands.map(([command]) => command);
  await choose();
  assert.deepEqual(actions(), ["space.select", "tab.new"]);
  now += 29999;
  const words = await choose();
  assert.deepEqual({ starting: words.includes("Starting"), commands: actions() }, {
    starting: true, commands: ["space.select", "tab.new"],
  });
});

test("Resume opens its popup at the wide menu token.", async () => {
  const overlays = [];
  const { Spaces } = await loadSpaces({ openOverlay: (overlay) => { overlays.push(overlay); } });
  const { W } = await load("kanso-spaces/ui.js", ["W"]);
  new Spaces().resumeMenu({});
  same(overlays.map(({ mod, kind, width }) => [mod, kind, width]), [["kanso-spaces", "popup", W.menuWide]]);
  assert.ok(W.menuWide > W.menu);
});

const loadSwitcher = (host) => load("kanso-menu/main.js", ["KansoMenu", "tokens"], {
  ...drawingHost(),
  ScrollHandle: { new: () => ({}) },
  ...host,
});

test("The switcher opens its window and draws its menu at the wide menu token.", async () => {
  let window;
  const { Tabs } = await loadTabs({ openOverlay: (overlay) => { window = overlay; } });
  const { W } = await load("kanso-menu/ui.js", ["W"]);
  const { KansoMenu, tokens } = await loadSwitcher({ props: () => window?.props });
  new Tabs().command("switch");
  const view = new KansoMenu();
  view.init(window?.props, inlineCx());
  const menu = view.switcherView(tokens(KIT_NIGHT));
  assert.deepEqual([window?.width, arg(menu, "w")], [W.menuWide, W.menuWide]);
  assert.equal(window?.mod, "kanso-menu");
  assert.equal(window?.kind, "window");
});

test("The switcher highlights the most recent conversation from a shell and the next one from that conversation.", async () => {
  const recent = ["t1", "t2"];
  let terminal = "t3";
  const { KansoMenu, tokens } = await loadSwitcher({
    agents: () => recent.map((address) => ({ address })),
    terminals: () => recent.map((address) => ({ address, labels: { "kanso.shown": address } })),
    spaces: () => [],
    shared: (key) => key === "kanso.recent" ? recent : null,
    focused: () => ({ terminal }),
  });
  const view = new KansoMenu();
  const cx = inlineCx();
  const c = tokens(KIT_NIGHT);
  const lit = () => {
    view.openSwitcher(cx);
    return nodes(view.switcherView(c)).filter((el) => arg(el, "selected")).map((el) => arg(el, "accessibility_label"));
  };
  const fromShell = lit();
  terminal = recent[0];
  assert.deepEqual([fromShell, lit()], [[recent[0]], [recent[1]]]);
});

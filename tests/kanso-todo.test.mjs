import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, chmod, copyFile, mkdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clone, exec, fileExists, git, same, stdoutOf, temporary } from "./helpers.mjs";
import { temporaryKdb, temporaryKdbFile } from "./mod-fixtures.mjs";

const todoScript = fileURLToPath(new URL("../kanso/mods/kanso-panel/kanso-todo", import.meta.url));
const unixTodo = { skip: process.platform === "win32" && "The agent's command uses POSIX sh" };
const terminalId = "t42";
const addUsage = 'add "<step>" "<detail>"';
const startUsage = "start <id>";
const doneUsage = "done <id>";

const commandText = async (result) => {
  const { code, stdout, stderr } = await result;
  assert.equal(code, 0, stderr);
  return stdout.trim();
};

const agentTodo = async (t, cwd, { script = todoScript, database = temporaryKdb } = {}) => {
  const HOME = await temporary(t);
  const { db, dir } = await database(t);
  const options = { cwd: cwd ?? HOME, env: { ...process.env, HOME, HERDR_APP_HOME: dir, HC_TERMINAL_ID: terminalId } };
  const at = (cwd, by = terminalId) => (...args) =>
    exec("sh", ["-c", 'umask 022; exec sh "$@"', "sh", script, ...args], { ...options, cwd, env: { ...options.env, HC_TERMINAL_ID: by ?? undefined } });
  const result = at(options.cwd);
  const run = (...args) => commandText(result(...args));
  return { db, HOME, run, at, result, options };
};

const restrictedPath = async (t, programs) => {
  const bin = await temporary(t);
  for (const program of programs) {
    const path = await stdoutOf("sh", ["-c", 'command -v "$1"', "sh", program]);
    await symlink(path.trim(), join(bin, program));
  }
  return bin;
};

const todoAddPath = (t) => restrictedPath(t, [
  "basename", "date", "dirname", "git", "od", "sed", "sh", "sqlite3", "tr",
]);

const readTodoIdentity = async (dir) => JSON.parse(await stdoutOf("sqlite3", [
  "-json", join(dir, "data", "kanso", "kanso.db"), "SELECT id, by, by_name, by_since FROM todos ORDER BY rowid;",
]));

const listLine = (...parts) => parts.join("\t");
const expectCommand = ({ code, stdout, stderr }, expected) => {
  assert.equal(code, 0, stderr);
  assert.equal(stdout.trim(), expected);
};

test("An agent in a subfolder can add detailed steps, start and finish them, and list only its own plan.", unixTodo, async (t) => {
  const folder = await realpath(await temporary(t));
  const init = await git(folder, "init");
  assert.equal(init.code, 0, init.stderr);
  const nested = join(folder, "src");
  await mkdir(nested);
  const { db, run, at, result } = await agentTodo(t, nested);
  const text = "Pack the user's release notes";
  const detail = "Use the PR's changelog";
  const id = await run("add", `  ${text}  `, "  Use the PR's\n\tchangelog  ");
  assert.ok(id, "Add returns a step ID");
  const [project, ...others] = await db.projects();
  assert.equal(others.length, 0);
  same({ name: project.name, folder: project.folder }, { name: basename(folder), folder });

  const saved = async () => (await db.read("SELECT id, project, text, by, detail, started_at, done_at FROM todos;"))[0];
  const step = { id, project: project.id, text, by: terminalId, detail, started_at: null, done_at: null };
  same(await saved(), step);
  expectCommand(await at(folder)("list"), listLine(id, "next", text));

  const unknown = await result("done", "no-such-id");
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /no open step no-such-id/);
  same(await saved(), step);

  await run("start", id);
  const { started_at } = await saved();
  assert.ok(Number.isInteger(started_at) && started_at > 0);
  assert.equal(await run("list"), listLine(id, "doing", text));

  await run("done", id);
  const { done_at } = await saved();
  assert.ok(Number.isInteger(done_at) && done_at >= started_at);
  same(await saved(), { ...step, started_at, done_at });

  const next = "Publish the beta";
  const doing = "Review the summary";
  const nextId = await run("add", next, "Wait for all checks");
  const doingId = await run("add", doing, "Verify the upgrade note");
  await run("start", doingId);
  const other = at(nested, "t8");
  const otherText = "Check the Linux build";
  const added = await other("add", otherText, "Read the package log");
  assert.equal(added.code, 0, added.stderr);
  expectCommand(await other("list"), listLine(added.stdout.trim(), "next", otherText));
  assert.deepEqual((await run("list")).split("\n").sort(), [
    listLine(id, "done", text),
    listLine(doingId, "doing", doing),
    listLine(nextId, "next", next),
  ].sort());
});

test("The agent command shows how to add, start, finish and list steps.", unixTodo, async (t) => {
  const { result } = await agentTodo(t);
  const usage = [addUsage, startUsage, doneUsage, "list", "rule"].join(" | ");
  for (const [args, expected] of [[["help"], usage], [["add"], addUsage], [["start"], startUsage], [["done"], doneUsage]]) {
    const { code, stderr } = await result(...args);
    assert.equal(code, 1);
    assert.equal(stderr.trim(), `kanso-todo: usage: kanso-todo ${expected}`);
  }
});

test("An agent can run the command printed in the rule when the install path has an apostrophe.", unixTodo, async (t) => {
  const folder = join(await temporary(t), "Agent's tools");
  await mkdir(folder);
  const script = join(folder, basename(todoScript));
  await copyFile(todoScript, script);
  const { run, options } = await agentTodo(t, folder, { script });
  const text = "Check the release";
  const id = await run("add", text, "Read the upgrade notes");
  const rule = await run("rule");
  const list = rule.split("\u0060").find((part) => part.startsWith("sh ") && part.endsWith(" list"));
  assert.ok(list, "The rule prints a shell command for listing to-dos");
  const { code, stdout, stderr } = await exec("sh", ["-c", list], options);
  expectCommand({ code, stdout, stderr }, listLine(id, "next", text));
});

const planState = (db) => Promise.all([
  db.read("SELECT * FROM projects ORDER BY id;"),
  db.read("SELECT * FROM todos ORDER BY id;"),
]);

const refuseWithoutChanges = async (db, command, ...args) => {
  const before = clone(await planState(db));
  const { code, stdout, stderr } = await command(...args);
  same(await planState(db), before);
  assert.equal(code, 1, stderr);
  assert.equal(stdout, "");
  return stderr;
};

const ownedPlan = async (t) => {
  const { db, at, HOME } = await agentTodo(t);
  const as = (by) => at(HOME, by);
  const id = await commandText(as("t1")("add", "Prepare the release", "Read the upgrade notes"));
  return { db, as, id };
};

for (const [verb, args] of [["add", ["Publish the release", "Wait for the checks"]], ["list", []], ["start"], ["done"]]) {
  test(`Without a terminal ID, ${verb} exits 1 without changing the plan.`, unixTodo, async (t) => {
    const { db, as, id } = await ownedPlan(t);
    const stderr = await refuseWithoutChanges(db, as(null), verb, ...(args ?? [id]));
    assert.match(stderr, /HC_TERMINAL_ID/);
  });
}

for (const verb of ["start", "done"]) {
  test(`Terminal t2 cannot use ${verb} on a step from terminal t1.`, unixTodo, async (t) => {
    const { db, as, id } = await ownedPlan(t);
    await refuseWithoutChanges(db, as("t2"), verb, id);
  });
}

for (const [shape, args] of [
  ["only a step", ["Fix the blue widget"]],
  ["three arguments", ["fix", "the", "widget"]],
  ["four arguments", ["fix", "the", "blue", "widget"]],
  ["a blank detail", ["Fix the blue widget", " \t\n "]],
]) {
  test(`Add with ${shape} exits 1 without saving a project or step.`, unixTodo, async (t) => {
    const { db, result } = await agentTodo(t);
    const stderr = await refuseWithoutChanges(db, result, "add", ...args);
    assert.ok(stderr.includes(addUsage));
  });
}

test("A saved repository with a trailing slash keeps the step and its apostrophes.", unixTodo, async (t) => {
  const folder = join(await realpath(await temporary(t)), "repo");
  await mkdir(folder);
  const { db, run } = await agentTodo(t, folder);
  const savedFolder = `${folder}/`;
  const { row: project } = await db.addProject({ name: "Repo", folder: savedFolder });
  const text = "Check the user's plan";
  const detail = "Read the agent's notes";
  const id = await run("add", text, detail);

  assert.equal(await run("list"), listLine(id, "next", text));
  same(await db.read("SELECT id, project, text, detail FROM todos;"), [{ id, project: project.id, text, detail }]);
  same(await db.projects(), [clone(project)]);
});

const legacyTodoDb = async (t) => {
  const { dir, SCHEMA } = await temporaryKdbFile(t, ["SCHEMA"]);
  const data = join(dir, "data", "kanso");
  await mkdir(data, { recursive: true });
  const legacy = "CREATE TABLE todos(id TEXT PRIMARY KEY, project TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL, done_at INTEGER, by TEXT);";
  await stdoutOf("sqlite3", [join(data, "kanso.db"), legacy, SCHEMA]);
  return { dir };
};

test("An agent can add, list and start a step before kansō migrates an old plan database.", unixTodo, async (t) => {
  const { run } = await agentTodo(t, undefined, { database: legacyTodoDb });
  const text = "Check the migration";
  const id = await run("add", text, "Keep the existing plan");
  assert.equal(await run("list"), listLine(id, "next", text));
  await run("start", id);
  assert.equal(await run("list"), listLine(id, "doing", text));
});

test("An agent's to-do records its terminal's start time and displayed name before Tasks opens.", unixTodo, async (t) => {
  const { run, options } = await agentTodo(t);
  const bin = await todoAddPath(t);
  await writeFile(join(bin, "hc"), [
    "#!/bin/sh",
    '[ "$#" -eq 2 ] && [ "$1" = get ] && [ "$2" = "$HC_TERMINAL_ID" ] || exit 1',
    'printf "%s\\n" "$TODO_TERMINAL_CARD"',
  ].join("\n"), { mode: 0o755 });
  options.env.PATH = bin;
  const created_ms = 1_800_000_000_321;
  const title = "Release terminal";
  const name = "Builder";
  const shown = "O'Connor";
  const cards = [
    [{ created_ms, title, name, labels: { "kanso.shown": shown } }, shown],
    [{ created_ms, title, name }, name],
    [{ created_ms, title }, title],
    [null, null],
  ];

  const expected = [];
  for (const [card, by_name] of cards) {
    options.env.TODO_TERMINAL_CARD = card ? JSON.stringify(card) : "";
    const id = await run("add", "Check the build", "Read the package log");
    expected.push({ id, by: terminalId, by_name, by_since: card?.created_ms ?? null });
  }
  assert.deepEqual(await readTodoIdentity(options.env.HERDR_APP_HOME), expected);
});

test("Without hc, an agent can add a step to an older list and leave its session identity unknown.", unixTodo, async (t) => {
  const { run, options } = await agentTodo(t, undefined, { database: legacyTodoDb });
  options.env.PATH = await todoAddPath(t);
  const hc = await exec("sh", ["-c", "command -v hc"], options);
  assert.notEqual(hc.code, 0, "The agent cannot find hc in this fixture");
  const id = await run("add", "Read the notes", "Check the signed build");
  assert.deepEqual(await readTodoIdentity(options.env.HERDR_APP_HOME), [
    { id, by: terminalId, by_name: null, by_since: null },
  ]);
});

test("The steps command reports the four plan commands without a terminal ID.", unixTodo, async (t) => {
  const { at, HOME } = await agentTodo(t);
  expectCommand(await at(HOME, null)("steps"), "add start done list");
});

const agentInstructionFiles = async (t, config, userAppend = "Keep my own Pi instructions.\n") => {
  const command = await agentTodo(t);
  const { HOME } = command;
  const claude = join(HOME, ".claude", "rules", "kanso-todo.md");
  const pi = join(HOME, ".pi", "agent", "APPEND_SYSTEM.md");
  const codex = join(HOME, ".codex", "config.toml");
  await Promise.all([dirname(dirname(claude)), dirname(pi), dirname(codex)].map((dir) => mkdir(dir, { recursive: true })));
  await Promise.all([writeFile(pi, userAppend), writeFile(codex, config)]);
  return { ...command, claude, pi, codex, userAppend, readInstructions: () => Promise.all([claude, pi, codex].map((path) => readFile(path, "utf8"))) };
};

const CODEX_TABLE = '[profiles.work]\nmodel = "work-model"\n';

test("Installing the to-do rule twice leaves one copy per agent, and uninstalling keeps the user's instructions.", unixTodo, async (t) => {
  const { run, claude, pi, codex, userAppend, readInstructions } = await agentInstructionFiles(t, CODEX_TABLE);
  const status = () => run("status");
  assert.equal(await status(), "off");
  const rule = await run("rule");
  assert.match(rule, /^## To-do in kansō\n/);
  for (const verb of [addUsage, startUsage, doneUsage, "list"]) assert.ok(rule.includes(`kanso-todo' ${verb}`), verb);

  await run("install");
  assert.equal(await status(), "on");
  const marked = (body) => `# kanso-todo\n${body}\n# /kanso-todo\n`;
  const installed = [`<!-- kanso-todo -->\n${rule}\n`, userAppend + marked(rule), marked(`developer_instructions = '''\n${rule}\n'''`) + CODEX_TABLE];
  assert.deepEqual(await readInstructions(), installed, "Codex's top-level rule comes before the first table");
  await run("install");
  assert.deepEqual(await readInstructions(), installed, "Reinstalling keeps exactly one copy");

  await run("uninstall");
  assert.equal(await status(), "off");
  assert.equal(await fileExists(claude), false);
  assert.equal(await readFile(pi, "utf8"), userAppend);
  assert.equal(await readFile(codex, "utf8"), CODEX_TABLE);
});

test("Pi can remove the to-do rule when the user's last line has no newline.", unixTodo, async (t) => {
  const userAppend = "Keep my own Pi instructions.";
  const { run, pi } = await agentInstructionFiles(t, CODEX_TABLE, userAppend);
  const install = () => run("install");
  await install();
  const installed = await readFile(pi, "utf8");
  assert.ok(installed.startsWith(userAppend + "\n# kanso-todo\n"), "The opening marker starts its own line");
  await install();
  assert.equal(await readFile(pi, "utf8"), installed, "Reinstalling replaces rather than appends the rule");
  await run("uninstall");
  assert.equal(await readFile(pi, "utf8"), userAppend + "\n");
});

const CLAUDE_SKIPPED = /Claude Code already has its own .*kanso-todo\.md/;
const CODEX_SKIPPED = /Codex already has developer_instructions in .*config\.toml/;
const OWN_CODEX = 'developer_instructions = "Keep my own Codex instructions."\n';
const expectSkip = ({ code, stderr }, ...agents) => {
  assert.equal(code, 1, stderr);
  for (const agent of agents) assert.match(stderr, agent);
};

const expectCodexConflict = async ({ result, codex }, config) => {
  expectSkip(await result("install"), CODEX_SKIPPED);
  assert.equal(await readFile(codex, "utf8"), config);
};

const checkCodexConflicts = async (command, configs) => {
  for (const config of configs) {
    await writeFile(command.codex, config);
    await expectCodexConflict(command, config);
  }
};

const agentTodoOnPath = async (t, withoutPython) => {
  const command = await agentTodo(t);
  if (withoutPython) {
    const programs = ["awk", "basename", "cat", "dirname", "grep", "head", "rm", "sed", "sh", "tail"];
    command.options.env.PATH = await restrictedPath(t, programs);
    const python = await exec("sh", ["-c", "command -v python3"], command.options);
    assert.notEqual(python.code, 0, "The installer cannot find python3 in this fixture");
  }
  return command;
};

const agentSettingsFile = async (t, config, withoutPython, parts) => {
  const command = await agentTodoOnPath(t, withoutPython);
  const file = join(command.HOME, ...parts);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, config);
  return { ...command, file };
};

const codexOnly = async (t, config, withoutPython) => {
  const command = await agentSettingsFile(t, config, withoutPython, [".codex", "config.toml"]);
  return { ...command, codex: command.file };
};

const piOnly = (t, config, withoutPython) =>
  agentSettingsFile(t, config, withoutPython, [".pi", "agent", "APPEND_SYSTEM.md"]);

const inInstallEnvironments = async (t, check, setup = codexOnly) => {
  for (const [name, withoutPython] of [["regular PATH", false], ["no python3 on PATH", true]]) {
    await t.test(name, (test) => check((config) => setup(test, config, withoutPython)));
  }
};

const statusBeforeUninstall = async (run) => {
  const status = await run("status");
  await run("uninstall");
  return status;
};

test("Codex can turn off the to-do rule after I add settings above it.", unixTodo, async (t) => {
  await inInstallEnvironments(t, async (makeCodex) => {
    const { run, codex } = await makeCodex("");
    const settings = 'model = "gpt-5"\n';
    await run("install");
    await writeFile(codex, settings + await readFile(codex, "utf8"));
    const before = await statusBeforeUninstall(run);
    assert.equal(await readFile(codex, "utf8"), settings);
    assert.equal(before, "on", "My setting above the rule does not hide it");
    assert.equal(await run("status"), "off");
  });
});

test("A refused Codex reinstall keeps my working to-do rule.", unixTodo, async (t) => {
  await inInstallEnvironments(t, async (makeCodex) => {
    const command = await makeCodex("");
    await command.run("install");
    await appendFile(command.codex, "# developer_instructions\n");
    const original = await readFile(command.codex, "utf8");
    await expectCodexConflict(command, original);
    assert.equal(await command.run("status"), "on");
  });
});

const expectMarkedTextKept = async (makeConfig, original, agent) => {
  const { run, file } = await makeConfig(original);
  const before = await run("status");
  assert.match(await run("install"), new RegExp(`${agent}: on`));
  const installed = await readFile(file, "utf8");
  assert.ok(installed.includes(original), "Install preserves the user's text");
  assert.equal(await run("status"), "on");
  await run("uninstall");
  assert.equal(await readFile(file, "utf8"), original);
  assert.equal(await run("status"), "off");
  assert.equal(before, "off", "Marker-like text alone is not an installed rule");
};

test("A Codex array value does not hide the existing top-level developer instructions.", unixTodo, async (t) => {
  await inInstallEnvironments(t, async (codex) => {
    const config = "values = [\n  [1, 2],\n]\n" + OWN_CODEX;
    await expectCodexConflict(await codex(config), config);
  });
});

test("Codex install and uninstall do not touch marker-like lines in my configuration text.", unixTodo, async (t) => {
  await inInstallEnvironments(t, async (makeCodex) => {
    const config = ['notes = """', "# kanso-todo", "Keep these notes.", "# /kanso-todo", '"""', ""].join("\n");
    await expectMarkedTextKept(makeCodex, config, "Codex");
  });
});

test("Uninstalling keeps my Codex notes when they look like the to-do rule without its heading.", unixTodo, async (t) => {
  await inInstallEnvironments(t, async (makeCodex) => {
    const config = [
      'model = "gpt-5"', 'notes = """', "# kanso-todo", "developer_instructions = '''",
      "Keep my notes.", "'''", "# /kanso-todo", '"""', "",
    ].join("\n");
    const { run, file } = await makeCodex(config);
    const before = await statusBeforeUninstall(run);
    assert.equal(await readFile(file, "utf8"), config);
    assert.equal(before, "off", "My notes are not an installed rule");
  });
});

test("Installing leaves a dotted Codex key alone when its first part is developer_instructions.", unixTodo, async (t) => {
  await inInstallEnvironments(t, async (codexOnly) => {
    const shapes = ["developer_instructions.text", '"developer_instructions" . text', "'developer_instructions'.text"];
    const body = ' = "Keep this table."\n';
    await checkCodexConflicts(await codexOnly(CODEX_TABLE), shapes.map((key) => key + body));
  });
});

test("A Codex table named developer_instructions blocks installation without changing the file.", unixTodo, async (t) => {
  await inInstallEnvironments(t, async (makeCodex) => {
    const config = '[developer_instructions]\ntext = "Keep this table."\n';
    await expectCodexConflict(await makeCodex(config), config);
  });
});

test("Four closing quotes before a comment do not hide existing Codex developer instructions.", unixTodo, async (t) => {
  await inInstallEnvironments(t, async (makeCodex) => {
    const config = 'notes = """Hello"""" # """"\n' + OWN_CODEX;
    await expectCodexConflict(await makeCodex(config), config);
  });
});

test("A marker pair at the top of Codex settings does not make my settings a managed rule.", unixTodo, async (t) => {
  await inInstallEnvironments(t, async (makeCodex) => {
    const config = '# kanso-todo\nmodel = "mine"\n# /kanso-todo\n';
    await expectMarkedTextKept(makeCodex, config, "Codex");
  });
});

const PI_HEADINGLESS = "# kanso-todo\nKeep my Pi notes.\n# /kanso-todo\n";

test("Pi keeps my marker-like text when it does not contain the managed rule heading.", unixTodo, async (t) => {
  await inInstallEnvironments(t, async (makePi) => {
    await expectMarkedTextKept(makePi, PI_HEADINGLESS, "Pi");
  }, piOnly);
});

const PI_UNTERMINATED = "# kanso-todo\n## To-do in kansō\nKeep these user notes.\n";

const uninstallPiKeepingNotes = async ({ run, file }, original = PI_UNTERMINATED) => {
  await run("uninstall");
  assert.ok(await fileExists(file), "Uninstall keeps the Pi append file");
  assert.equal(await readFile(file, "utf8"), original);
};

test("Uninstalling leaves Pi notes alone when the to-do block has no closing marker.", unixTodo, async (t) => {
  const command = await piOnly(t, PI_UNTERMINATED, false);
  const before = await command.run("status");
  await uninstallPiKeepingNotes(command);
  assert.equal(before, "off", "An unterminated block is not an installed rule");
});

test("Pi uninstall removes a complete block and keeps neighboring unterminated notes in either order.", unixTodo, async (t) => {
  for (const [name, notesFirst] of [["complete block first", false], ["unterminated block first", true]]) {
    await t.test(name, async (order) => {
      const command = await piOnly(order, notesFirst ? PI_UNTERMINATED : "", false);
      assert.match(await command.run("install"), /Pi: on/);
      if (!notesFirst) await appendFile(command.file, PI_UNTERMINATED);
      assert.equal(await command.run("status"), "on");
      await uninstallPiKeepingNotes(command);
      assert.equal(await command.run("status"), "off");
    });
  }
});

test("Pi uninstall keeps both unfinished notes and the heading-less marker pair that follows them.", unixTodo, async (t) => {
  const notes = PI_UNTERMINATED + PI_HEADINGLESS;
  await uninstallPiKeepingNotes(await piOnly(t, notes, false), notes);
});

test("Installing explains when this computer has no supported agent settings.", unixTodo, async (t) => {
  const { run, result } = await agentTodo(t);
  const installed = await result("install");
  expectSkip(installed, /found no Claude Code, Codex or Pi settings on this computer/);
  assert.equal(installed.stdout, "");
  assert.equal(await run("status"), "off");
});

test("Installing keeps Codex instructions even when ordinary TOML text looks like a multiline delimiter.", unixTodo, async (t) => {
  const reported = [
    'compact_prompt = \'Use """ for Python docstrings.\'',
    'developer_instructions = "Keep my instructions."',
    "",
  ].join("\n");
  const command = await agentInstructionFiles(t, reported);
  await expectCodexConflict(command, reported);

  const python = (source, ...args) => exec("python3", ["-c", source, ...args], command.options);
  if ((await python("import tomllib")).code !== 0) {
    t.diagnostic("Skipping TOML parser checks: python3 with tomllib is unavailable.");
    return;
  }
  const parsed = async () => {
    const checked = await python(
      "import json, sys, tomllib; print(json.dumps(tomllib.load(open(sys.argv[1], 'rb'))))",
      command.codex,
    );
    assert.equal(checked.code, 0, checked.stderr);
    return JSON.parse(checked.stdout);
  };
  const cases = [
    ["reviewer's literal string", reported, true],
    ["basic string with escaped quotes and a hash", String.raw`notes = "Use \"\"\" after #"` + "\n" + OWN_CODEX, true],
    ["comment before a basic quoted key", '# """\n' + OWN_CODEX.replace("developer_instructions", '"developer_instructions"'), true],
    ["multiline basic with escaped quote and closing comment", [
      'notes = """', String.raw`Use \""" here.`, '""" # """', OWN_CODEX,
    ].join("\n"), true],
    ["multiline literal with a lookalike key, then a literal quoted key", [
      "notes = '''", OWN_CODEX.trimEnd(), "'''", OWN_CODEX.replace("developer_instructions", "'developer_instructions'"),
    ].join("\n"), true],
    ["escaped quoted key", OWN_CODEX.replace("developer_instructions", String.raw`"\u0064eveloper_instructions"`), true],
    ["table-level instructions after a multiline string", [
      "notes = '''", OWN_CODEX.trimEnd(), "'''", CODEX_TABLE, OWN_CODEX,
    ].join("\n"), true],
    ["multiline string and table without a possible conflict", 'notes = """\nKeep these notes.\n"""\n' + CODEX_TABLE, false],
    ["dotted key with an existing instruction namespace", 'developer_instructions.text = "Keep this table."\n', true],
  ];
  for (const [shape, config, conflict] of cases) {
    await writeFile(command.codex, config);
    const before = await parsed();
    const installed = await command.result("install");
    if (conflict) {
      expectSkip(installed, CODEX_SKIPPED);
      assert.equal(await readFile(command.codex, "utf8"), config, shape);
      assert.equal(await fileExists(`${command.codex}.kanso`), false, shape);
      assert.deepEqual(await parsed(), before, shape);
    } else {
      assert.equal(installed.code, 0, `${shape}: ${installed.stderr}`);
      const { developer_instructions: rule, ...rest } = await parsed();
      assert.match(rule, /## To-do in kansō/);
      assert.deepEqual(rest, before, shape);
    }
  }

  const malformed = "notes = [1,,2]\n";
  await writeFile(command.codex, malformed);
  expectSkip(await command.result("install"), /the rule would not fit/);
  assert.equal(await readFile(command.codex, "utf8"), malformed);
});

test("Installing or uninstalling the to-do rule leaves an existing Codex developer instruction alone.", unixTodo, async (t) => {
  const config = OWN_CODEX + CODEX_TABLE;
  const command = await agentInstructionFiles(t, config);
  await expectCodexConflict(command, config);
  await command.run("uninstall");
  assert.equal(await readFile(command.codex, "utf8"), config);
});

test("Codex leaves an indented developer instruction alone both at the top level and in a table.", unixTodo, async (t) => {
  const instruction = `  ${OWN_CODEX}`;
  const command = await agentInstructionFiles(t, CODEX_TABLE);
  await checkCodexConflicts(command, [instruction + CODEX_TABLE, CODEX_TABLE + instruction]);
});

test("Codex safely skips a config that mentions developer_instructions only inside a multiline string.", unixTodo, async (t) => {
  const banner = ['banner = """', OWN_CODEX.trimEnd(), "[not.a.table]", '"""', ""].join("\n");
  const config = banner + CODEX_TABLE;
  await expectCodexConflict(await agentInstructionFiles(t, config), config);
});

test("A comment with triple quotes does not hide a Codex developer instruction from the installer.", unixTodo, async (t) => {
  const config = '# These triple quotes are not a string: """\n' + OWN_CODEX;
  await expectCodexConflict(await agentInstructionFiles(t, config), config);
});

test("Triple quotes in a comment after multiline notes do not hide the Codex developer instruction.", unixTodo, async (t) => {
  const notes = ['notes = """', "Keep these notes.", '""" # """', ""].join("\n");
  const config = notes + OWN_CODEX;
  await expectCodexConflict(await agentInstructionFiles(t, config), config);
});

test("Installing the to-do rule leaves quoted top-level Codex developer instructions alone.", unixTodo, async (t) => {
  const command = await agentInstructionFiles(t, CODEX_TABLE);
  const configs = ['"', "'"].map((quote) =>
    OWN_CODEX.replace("developer_instructions", `${quote}developer_instructions${quote}`) + CODEX_TABLE);
  await checkCodexConflicts(command, configs);
});

test("Installing the to-do rule leaves an escaped Codex developer instruction alone.", unixTodo, async (t) => {
  const key = String.raw`"\u0064eveloper_instructions"`;
  const config = OWN_CODEX.replace("developer_instructions", key) + CODEX_TABLE;
  await expectCodexConflict(await agentInstructionFiles(t, config), config);
});

const OWN_CLAUDE = "Keep my own Claude instructions.\n";
const seedClaudeRule = async (path, words = OWN_CLAUDE) => {
  await mkdir(dirname(path));
  await writeFile(path, words);
};

test("Installing skips my Claude rule without overwriting it and still installs the other rules.", unixTodo, async (t) => {
  const { result, claude, readInstructions, userAppend } = await agentInstructionFiles(t, CODEX_TABLE);
  const mine = "# My Claude rule\n<!-- kanso-todo -->\nKeep this file.\n";
  await seedClaudeRule(claude, mine);

  const installed = await result("install");
  const [claudeText, piText, codexText] = await readInstructions();
  assert.equal(claudeText, mine, "Only a first-line marker denotes a rule kansō owns");
  expectSkip(installed, CLAUDE_SKIPPED);
  assert.ok(piText.startsWith(userAppend) && piText.includes("## To-do in kansō"));
  assert.ok(codexText.includes("## To-do in kansō") && codexText.endsWith(CODEX_TABLE));
});

test("Uninstalling leaves my unmarked Claude rule alone.", unixTodo, async (t) => {
  const { run, claude } = await agentInstructionFiles(t, CODEX_TABLE);
  await seedClaudeRule(claude);
  await run("uninstall");
  assert.equal(await readFile(claude, "utf8"), OWN_CLAUDE);
  assert.equal(await run("status"), "off");
});

test("Install reports both skipped agents and still installs the Pi rule.", unixTodo, async (t) => {
  const ownCodexRule = OWN_CODEX + CODEX_TABLE;
  const { result, claude, readInstructions } = await agentInstructionFiles(t, ownCodexRule);
  await seedClaudeRule(claude);

  expectSkip(await result("install"), CLAUDE_SKIPPED, CODEX_SKIPPED);
  const [claudeText, piText, codexText] = await readInstructions();
  assert.equal(claudeText, OWN_CLAUDE);
  assert.ok(piText.includes("## To-do in kansō"));
  assert.equal(codexText, ownCodexRule);
});

const modeOf = async (path) => (await stat(path)).mode & 0o777;

const restrictedTodo = { skip: unixTodo.skip || (process.getuid?.() === 0 && "Root can write read-only files") };

test("Installing and uninstalling report a read-only Codex config without leaving a copy behind.", restrictedTodo, async (t) => {
  const { HOME, run, result } = await agentTodo(t);
  const config = join(HOME, ".codex", "config.toml");
  await mkdir(dirname(config));
  await writeFile(config, CODEX_TABLE);
  const rejectWrite = async (verb) => {
    const before = await readFile(config, "utf8");
    await chmod(config, 0o400);
    try {
      const { code, stdout, stderr } = await result(verb);
      assert.equal(code, 1, `${verb}: ${stderr}`);
      assert.ok(stderr.includes(config), stderr);
      assert.equal(stdout, "");
      assert.equal(await readFile(config, "utf8"), before);
      assert.equal(await modeOf(config), 0o400);
      assert.equal(await fileExists(`${config}.kanso`), false);
    } finally {
      await chmod(config, 0o600);
    }
  };
  await rejectWrite("install");
  await run("install");
  await rejectWrite("uninstall");
});

for (const agent of ["pi", "codex"]) {
  test(`Installing and removing the to-do rule preserves the mode of my ${agent} file.`, unixTodo, async (t) => {
    const { run, [agent]: path } = await agentInstructionFiles(t, CODEX_TABLE);
    await chmod(path, 0o640);
    for (const verb of ["install", "install", "uninstall"]) {
      await run(verb);
      assert.equal(await modeOf(path), 0o640, verb);
    }
  });
}

test("New agent rules are private even with a permissive umask.", unixTodo, async (t) => {
  const { HOME, run } = await agentTodo(t);
  const claudeDir = join(HOME, ".claude");
  const piDir = join(HOME, ".pi", "agent");
  await mkdir(claudeDir);
  await mkdir(piDir, { recursive: true });
  await run("install");

  const rules = join(claudeDir, "rules");
  assert.equal(await modeOf(rules), 0o700);
  const created = [join(rules, "kanso-todo.md"), join(piDir, "APPEND_SYSTEM.md")];
  assert.deepEqual(await Promise.all(created.map(modeOf)), [0o600, 0o600]);
});

for (const [verb, args, exit] of [["list", [], 0], ["done", ["nonexistent"], 1]]) {
  test(`Running ${verb} in an unsaved folder does not create a project.`, unixTodo, async (t) => {
    const { db, result } = await agentTodo(t);
    const ran = await result(verb, ...args);
    same(await db.projects(), []);
    assert.equal(ran.code, exit, ran.stderr);
    assert.equal(ran.stdout, "");
  });
}

test("Refresh brings an older installed rule up to date, leaves a current one untouched, and installs nothing while off.", unixTodo, async (t) => {
  const fixture = await agentInstructionFiles(t, CODEX_TABLE);
  const { run, claude, pi, codex, readInstructions } = fixture;
  const files = [claude, pi, codex];
  await run("refresh");
  assert.equal(await run("status"), "off", "Refresh installs nothing while off");

  await run("install");
  const current = await readInstructions();
  const older = (text) => text.replace("Show your plan in kansō", "Keep this project's to-do list in kansō");
  const age = () => Promise.all(files.map(async (path) => writeFile(path, older(await readFile(path, "utf8")))));
  await age();
  await run("refresh");
  assert.deepEqual(await readInstructions(), current);

  await writeFile(pi, fixture.userAppend);
  await run("refresh");
  assert.deepEqual(await readInstructions(), current, "A copy that went missing comes back");

  await age();
  await Promise.all(Array.from({ length: 6 }, () => run("refresh")));
  assert.deepEqual(await readInstructions(), current, "Refreshes at the same time leave every file whole");

  const before = await Promise.all(files.map(async (path) => (await stat(path)).mtimeMs));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await run("refresh");
  assert.deepEqual(await Promise.all(files.map(async (path) => (await stat(path)).mtimeMs)), before);
});

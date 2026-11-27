import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, chmod, copyFile, mkdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { committedRepo, exec, fileExists, same, temporary } from "./helpers.mjs";
import { temporaryKdb } from "./mod-fixtures.mjs";

const todoScript = fileURLToPath(new URL("../kanso/mods/kanso-panel/kanso-todo", import.meta.url));
const unixTodo = { skip: process.platform === "win32" && "The agent's command uses POSIX sh" };
const terminalId = "t42";

const agentTodo = async (t, cwd, script = todoScript) => {
  const HOME = await temporary(t);
  const { db, dir } = await temporaryKdb(t);
  const options = { cwd: cwd ?? HOME, env: { ...process.env, HOME, HERDR_APP_HOME: dir, HC_TERMINAL_ID: terminalId } };
  const at = (cwd) => (...args) => exec("sh", ["-c", 'umask 022; exec sh "$@"', "sh", script, ...args], { ...options, cwd });
  const result = at(options.cwd);
  const run = async (...args) => {
    const { code, stdout, stderr } = await result(...args);
    assert.equal(code, 0, stderr);
    return stdout.trim();
  };
  return { db, HOME, run, at, result, options };
};

test("An agent can add, list and finish to-dos in its project from a subfolder.", unixTodo, async (t) => {
  const { repo } = await committedRepo(t);
  const folder = await realpath(repo);
  const nested = join(folder, "src");
  await mkdir(nested);
  const { db, run, at, result } = await agentTodo(t, nested);
  const text = "Pack the user's release notes";
  const id = await run("add", `  ${text}  `);
  assert.ok(id, "Add returns an ID");
  const projects = await db.projects();
  same(projects.map(({ name, folder }) => ({ name, folder })), [{ name: basename(repo), folder }]);
  const [project] = projects;
  const open = { id, project: project.id, text, by: terminalId, done_at: null };
  const saved = () => db.read("SELECT id, project, text, by, done_at FROM todos;");
  same(await saved(), [open]);
  const listed = await at(folder)("list");
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(listed.stdout.trim(), `${id}\t${text}`);

  const unknown = await result("done", "no-such-id");
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /no open to-do no-such-id/);
  same(await saved(), [open]);

  await run("done", id);
  const [{ done_at }] = await saved();
  assert.ok(Number.isInteger(done_at) && done_at > 0);
  assert.equal(await run("list"), "");
});

test("An agent can run the command printed in the rule when the install path has an apostrophe.", unixTodo, async (t) => {
  const folder = join(await temporary(t), "Agent's tools");
  await mkdir(folder);
  const script = join(folder, basename(todoScript));
  await copyFile(todoScript, script);
  const { run, options } = await agentTodo(t, folder, script);
  const text = "Check the release";
  const id = await run("add", text);
  const rule = await run("rule");
  const list = rule.split("\u0060").find((part) => part.startsWith("sh ") && part.endsWith(" list"));
  assert.ok(list, "The rule prints a shell command for listing to-dos");
  const { code, stdout, stderr } = await exec("sh", ["-c", list], options);
  assert.equal(code, 0, stderr);
  assert.equal(stdout.trim(), `${id}\t${text}`);
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
  for (const verb of ['add "<one short line>"', "done <id>", "list"]) assert.ok(rule.includes(`kanso-todo' ${verb}`), verb);

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
    const bin = await temporary(t);
    const programs = ["awk", "basename", "cat", "dirname", "grep", "head", "rm", "sed", "sh", "tail"];
    for (const name of programs) {
      const found = await exec("sh", ["-c", 'command -v "$1"', "sh", name]);
      assert.equal(found.code, 0, found.stderr);
      await symlink(found.stdout.trim(), join(bin, name));
    }
    command.options.env.PATH = bin;
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

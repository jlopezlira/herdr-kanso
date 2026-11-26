import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { committedRepo, exec, fileExists, same, temporary } from "./helpers.mjs";
import { temporaryKdb } from "./mod-fixtures.mjs";

const todoScript = fileURLToPath(new URL("../kanso/mods/kanso-panel/kanso-todo", import.meta.url));
const unixTodo = { skip: process.platform === "win32" && "The agent's command uses POSIX sh" };
const terminalId = "t42";

const agentTodo = async (t, cwd) => {
  const HOME = await temporary(t);
  const { db, dir } = await temporaryKdb(t);
  const options = { cwd: cwd ?? HOME, env: { ...process.env, HOME, HERDR_APP_HOME: dir, HC_TERMINAL_ID: terminalId } };
  const at = (cwd) => (...args) => exec("sh", ["-c", 'umask 022; exec sh "$@"', "sh", todoScript, ...args], { ...options, cwd });
  const result = at(options.cwd);
  const run = async (...args) => {
    const { code, stdout, stderr } = await result(...args);
    assert.equal(code, 0, stderr);
    return stdout.trim();
  };
  return { db, HOME, run, at, result };
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

test("Installing or uninstalling the to-do rule leaves an existing Codex developer instruction alone.", unixTodo, async (t) => {
  const config = OWN_CODEX + CODEX_TABLE;
  const { run, result, codex } = await agentInstructionFiles(t, config);
  expectSkip(await result("install"), CODEX_SKIPPED);
  assert.equal(await readFile(codex, "utf8"), config);
  await run("uninstall");
  assert.equal(await readFile(codex, "utf8"), config);
});

test("Codex skips an indented top-level developer instruction, but not one inside a table.", unixTodo, async (t) => {
  const instruction = `  ${OWN_CODEX}`;
  const topLevel = instruction + CODEX_TABLE;
  const { run, result, codex } = await agentInstructionFiles(t, topLevel);
  const config = () => readFile(codex, "utf8");
  expectSkip(await result("install"), CODEX_SKIPPED);
  assert.equal(await config(), topLevel);

  const inTable = CODEX_TABLE + instruction;
  await writeFile(codex, inTable);
  assert.match(await run("install"), /Codex: on/);
  const installed = await config();
  assert.match(installed, /^# kanso-todo\ndeveloper_instructions = /);
  assert.ok(installed.endsWith(inTable), "The top-level rule leaves the table's instruction untouched");
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

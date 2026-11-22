import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { exec, load, readOrNull, temporary } from "./helpers.mjs";

const onWindows = process.platform === "win32" && "sh does not run these stubs";
const shareOmarchy = await access("/usr/share/omarchy").then(() => true, () => false);
const noShare = shareOmarchy && "this machine has /usr/share/omarchy";
const host = {
  notes: [],
  ran: [],
  result: { code: 0, stdout: "", stderr: "" },
};
const { HYPRLAND_TERMINAL, herdrIsTerminal } = await load("kanso-tabs/linux-arrival.js", ["HYPRLAND_TERMINAL", "herdrIsTerminal"], {
  exec: (command, args) => {
    host.ran.push([command, args]);
    return host.result;
  },
  notify: (note) => { host.notes.push(note); },
});

const LUA_RULE = "hl.window_rule({ match = { class = \"herdr-app\" }, tag = \"+terminal\" })";
const CONF_RULE = "tag +terminal, class:^(herdr-app)$";
const CONF_LINE = `windowrule = ${CONF_RULE}`;
const REQUIRE_LINE = "pcall(require, \"hypr.kanso\")";
const TITLE = "Super+C and Super+V copy and paste in Herdr";
const hyprctlBody = `#!/bin/sh
printf '%s\\n' "$#" >> "$HYPRCTL_LOG"
for arg in "$@"; do printf '%s\\n' "$arg" >> "$HYPRCTL_LOG"; done
printf '%s\\n' --- >> "$HYPRCTL_LOG"
`;

const callsOf = (text) => text.split("---\n").filter((part) => part.trim()).map((part) => {
  const lines = part.replace(/\n$/, "").split("\n");
  return lines.slice(1, 1 + Number(lines[0]));
});
const addedLines = (before, after) => {
  assert.equal(after.slice(0, before.length), before);
  return after.slice(before.length).split("\n").filter((line) => line !== "");
};
const stamp = async (path) => {
  const info = await stat(path);
  return `${info.mtimeMs}:${info.size}`;
};
const textIs = (path, text) => readFile(path, "utf8").then((body) => assert.equal(body, text));
const logged = async (world) => {
  const calls = callsOf(await readFile(world.log, "utf8"));
  assert.equal(calls.length, 1);
  return calls;
};
const reset = (code) => {
  host.notes = [];
  host.ran = [];
  host.result = { code, stdout: "", stderr: "" };
};

const stage = async (t) => {
  const root = await temporary(t);
  const bin = join(root, "bin");
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  const omarchy = join(root, "omarchy");
  const log = join(root, "hyprctl.log");
  const hypr = join(xdg, "hypr");
  await mkdir(bin);
  await mkdir(home);
  await mkdir(omarchy);
  await mkdir(hypr, { recursive: true });
  const fake = join(bin, "hyprctl");
  await writeFile(fake, hyprctlBody);
  await chmod(fake, 0o755);
  const run = async (overrides = {}, drop = []) => {
    const env = {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      HOME: home,
      XDG_CONFIG_HOME: xdg,
      HYPRCTL_LOG: log,
      HYPRLAND_INSTANCE_SIGNATURE: omarchy,
      OMARCHY_PATH: omarchy,
      ...overrides,
    };
    for (const key of drop) delete env[key];
    return exec("/bin/sh", ["-c", HYPRLAND_TERMINAL], { env });
  };
  return {
    run, log, hypr,
    lua: join(hypr, "hyprland.lua"),
    conf: join(hypr, "hyprland.conf"),
    kansoLua: join(hypr, "kanso.lua"),
    kansoConf: join(hypr, "kanso.conf"),
  };
};

const applyOnce = async (t, spec) => {
  const world = await stage(t);
  const before = `${spec.mark}\nbind = SUPER, Q, killactive\n`;
  await writeFile(spec.config(world), before);
  const opened = await world.run();
  assert.equal(opened.code, 0, opened.stderr);
  const rule = `${spec.ruleText}\n`;
  await textIs(spec.ruleFile(world), rule);
  const after = await readFile(spec.config(world), "utf8");
  assert.deepEqual(addedLines(before, after), spec.added(world));
  spec.checkCall((await logged(world))[0]);
  const marks = [await stamp(spec.config(world)), await stamp(spec.ruleFile(world))];
  const again = await world.run();
  assert.equal(again.code, 1, again.stderr);
  await textIs(spec.config(world), after);
  await textIs(spec.ruleFile(world), rule);
  assert.deepEqual([await stamp(spec.config(world)), await stamp(spec.ruleFile(world))], marks);
  assert.equal(await readOrNull(spec.absent(world)), null);
};

test("The first Omarchy run writes Herdr's terminal rule and a second run changes no Hyprland lua file", { skip: onWindows }, async (t) => {
  await applyOnce(t, {
    mark: "-- keep $HOME \"byte\"",
    config: (world) => world.lua,
    ruleFile: (world) => world.kansoLua,
    ruleText: LUA_RULE,
    added: () => [REQUIRE_LINE],
    checkCall: (call) => {
      assert.equal(call[0], "dispatch");
      assert.equal(call.some((arg) => arg.includes(LUA_RULE)), true);
    },
    absent: (world) => world.kansoConf,
  });
});

test("An older hyprland.conf gets the terminal rule once, and a second run changes no file", { skip: onWindows }, async (t) => {
  await applyOnce(t, {
    mark: "# keep $HOME \"byte\"",
    config: (world) => world.conf,
    ruleFile: (world) => world.kansoConf,
    ruleText: CONF_LINE,
    added: (world) => [`source = ${join(world.hypr, "kanso.conf")}`],
    checkCall: (call) => assert.deepEqual(call, ["keyword", "windowrule", CONF_RULE]),
    absent: (world) => world.kansoLua,
  });
});

test("Hyprland is left untouched when the session, Omarchy or its config is missing", { skip: onWindows || noShare }, async (t) => {
  const untouched = async (world, run) => {
    const lua = await readOrNull(world.lua);
    const conf = await readOrNull(world.conf);
    const result = await run();
    assert.equal(result.code, 3, result.stderr);
    assert.equal(await readOrNull(world.lua), lua);
    assert.equal(await readOrNull(world.conf), conf);
    assert.equal(await readOrNull(world.kansoLua), null);
    assert.equal(await readOrNull(world.kansoConf), null);
    assert.equal(await readOrNull(world.log), null);
  };
  const signedOut = await stage(t);
  await writeFile(signedOut.lua, "keep the lua\n");
  await untouched(signedOut, () => signedOut.run({ HYPRLAND_INSTANCE_SIGNATURE: "" }));
  const absent = await stage(t);
  await writeFile(absent.conf, "keep the conf\n");
  await untouched(absent, () => absent.run({}, ["OMARCHY_PATH"]));
  const bare = await stage(t);
  await untouched(bare, () => bare.run());
});

test("Herdr says Super+C and Super+V copy and paste when Hyprland accepts the terminal rule", { skip: onWindows }, async () => {
  reset(0);
  assert.equal(await herdrIsTerminal("linux"), true);
  assert.equal(host.notes.length, 1);
  assert.equal(host.notes[0].title, TITLE);
  assert.equal(host.ran.length, 1);
  assert.equal(host.ran[0][0], "sh");
  assert.equal(host.ran[0][1][0], "-c");
  assert.equal(host.ran[0][1][1], HYPRLAND_TERMINAL);
});

test("Herdr stays quiet when Hyprland refuses the rule, and macOS and Windows never ask", { skip: onWindows }, async () => {
  for (const code of [1, 3]) {
    reset(code);
    assert.equal(await herdrIsTerminal("linux"), false);
    assert.equal(host.notes.length, 0);
    assert.equal(host.ran.length, 1);
  }
  reset(0);
  assert.equal(await herdrIsTerminal("macos"), false);
  assert.equal(await herdrIsTerminal("windows"), false);
  assert.equal(host.ran.length, 0);
  assert.equal(host.notes.length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import {
  arg, drawingHost, exec, failure, fileExists, find, KIT_NIGHT, load, plain, stdoutOf, success, temporary, until,
} from "./helpers.mjs";

const { caffeineCall, answerOf, setupArgv, createCaffeine, EVERY_MS, SETUP_EVERY_MS } =
  await load("kanso-spaces/caffeine.js", ["caffeineCall", "answerOf", "setupArgv", "createCaffeine", "EVERY_MS", "SETUP_EVERY_MS"]);
const verbs = ["on", "off", "read"];
const unixSystems = ["macos", "linux"];
const sh = "/bin/sh";
const hasSh = await fileExists(sh);

test("Caffeine uses the right command for each supported system and none for an unknown system", () => {
  for (const verb of verbs) {
    for (const system of unixSystems) {
      const { command, args } = caffeineCall(system, verb);
      assert.equal(command, "sh");
      assert.equal(args[0], "-c");
      assert.ok(args[1]?.trim());
    }
    const windows = caffeineCall("windows", verb);
    assert.equal(windows.command, "powershell");
    assert.deepEqual(Array.from(windows.args.slice(0, 3)), ["-NoProfile", "-NonInteractive", "-Command"]);
    assert.ok(windows.args[3]?.trim());
    assert.equal(caffeineCall("other", verb), null);
  }
});

test("The macOS and Linux commands for Caffeine and its setup have valid shell syntax", { skip: !hasSh && "No /bin/sh" }, async () => {
  for (const system of unixSystems) {
    for (const verb of [...verbs, "setup"]) {
      const script = verb === "setup" ? setupArgv(system)[2] : caffeineCall(system, verb).args[1];
      const result = await exec(sh, ["-n", "-c", script]);
      assert.equal(result.code, 0, `${system} ${verb}: ${result.stderr}`);
    }
  }
});

test("Caffeine recognizes its replies and whether the battery turned it off, and ignores unsuccessful or unknown replies", () => {
  const answer = (result, word, battery = false) => assert.deepEqual(plain(answerOf(result)), { word, battery });
  for (const word of ["on", "off", "setup", "low", "missing", "refused", "busy"]) {
    answer(success(` ${word}\n`), word);
  }
  answer(success("off battery"), "off", true);
  answer(success("unexpected"), null);
  answer({ ...failure("failed"), stdout: "on" }, null);
  answer({ ...success("on"), threw: true }, null);
});

const sudoStub = String.raw`[ "$1" = -n ] && shift
[ "$1" = /usr/bin/pmset ] || exit 1
shift
exec pmset "$@"`;

const pmsetStub = String.raw`case "$*" in
  "-g")
    [ "$(cat "$CAFFEINE_TEST_DIR/sleep-disabled")" != 1 ] || printf ' SleepDisabled  1\n'
    ;;
  "-g batt")
    if [ -f "$CAFFEINE_TEST_DIR/battery" ]; then
      printf 'Battery Power\n %s%%\n' "$(cat "$CAFFEINE_TEST_DIR/battery")"
    else
      echo 'AC Power'
    fi
    ;;
  "-a disablesleep 0"|"-a disablesleep 1")
    echo "$3" > "$CAFFEINE_TEST_DIR/sleep-disabled"
    ;;
  *) exit 1 ;;
esac`;

const launchctlStub = `const { spawn, execFileSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const { join } = require("node:path");
const [verb, domain, target] = process.argv.slice(2);
const record = (file, line) => appendFileSync(join(process.env.CAFFEINE_TEST_DIR, file), line + "\\n");
if (verb === "bootout") {
  record("bootouts", domain);
} else if (verb === "bootstrap") {
  execFileSync("plutil", ["-lint", "--", target]);
  const script = execFileSync("plutil", ["-extract", "ProgramArguments.1", "raw", "-o", "-", "--", target], { encoding: "utf8" }).trimEnd();
  const guard = spawn("/bin/sh", [script], { detached: true, stdio: "ignore" });
  guard.once("spawn", () => {
    record("guards", guard.pid);
    guard.unref();
  });
} else {
  process.exitCode = 1;
}`;

const stopGuard = (pid) => {
  try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
};

const fakeMac = async (t) => {
  const dir = await temporary(t);
  const home = join(dir, "Home & <test>");
  const env = {
    ...process.env, HOME: home, CAFFEINE_TEST_DIR: dir,
    PATH: [dir, dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
  };
  const write = (file, value) => writeFile(join(dir, file), value);
  const read = async (file) => (await readFile(join(dir, file), "utf8")).trim();
  const stub = (name, interpreter, body) =>
    writeFile(join(dir, name), `#!${interpreter}\n${body}\n`, { mode: 0o755 });
  await Promise.all([
    stub("pmset", sh, pmsetStub),
    stub("sudo", sh, sudoStub),
    stub("launchctl", "/usr/bin/env node", launchctlStub),
    write("guards", ""),
  ]);
  const state = join(home, ".local", "state", "kanso-caffeine");
  const guards = async () => (await read("guards")).split(/\s+/).filter(Boolean).map(Number);
  t.after(async () => { for (const pid of await guards()) stopGuard(pid); });
  const running = async (pid) => {
    const result = await exec("ps", ["-p", String(pid), "-o", "command="], { env });
    return result.stdout.includes(join(state, "guard.sh"));
  };
  const call = async (verb, word) => {
    const { command, args } = caffeineCall("macos", verb);
    const output = await stdoutOf(command, args, { env, limit: 15_000 });
    assert.equal(output, word, verb);
  };
  return { call, guards, read, running, state, write };
};

test("On macOS Caffeine keeps a guard running, restores sleep when turned off or after a restart, and respects low battery and locks", async (t) => {
  if (!hasSh || (await exec(sh, ["-c", "command -v plutil"])).code !== 0) {
    t.skip("Requires /bin/sh and plutil");
    return;
  }
  const { call, guards, read, running, state, write } = await fakeMac(t);
  const prior = join(state, "prior");
  const start = async () => {
    await call("on", "on");
    return (await guards()).at(-1);
  };
  for (const before of ["0", "1"]) {
    await write("sleep-disabled", before);
    const pid = await start();
    assert.ok(await running(pid), "the guard is running");
    assert.equal(await read("sleep-disabled"), "1");
    await call("read", "on");
    await call("off", "off");
    await until(async () => !(await running(pid)), 5_000);
    assert.equal(await read("sleep-disabled"), before);
    assert.equal(await fileExists(prior), false);
  }
  assert.match(await read("bootouts"), /\/dev\.kanso\.caffeine\.guard$/m);

  await write("sleep-disabled", "0");
  await write("battery", "12");
  const started = (await guards()).length;
  await call("on", "low");
  assert.equal(await read("sleep-disabled"), "0");
  assert.equal((await guards()).length, started);
  assert.equal(await fileExists(prior), false);

  await write("battery", "90");
  const pid = await start();
  stopGuard(pid);
  await until(async () => !(await running(pid)), 5_000);
  assert.equal((await readFile(prior, "utf8")).trim(), "0");
  assert.equal(await read("sleep-disabled"), "1");
  await call("read", "off");
  assert.equal(await read("sleep-disabled"), "0");
  assert.equal(await fileExists(prior), false);

  const lock = join(state, "lock");
  const owner = join(lock, "pid");
  await mkdir(lock);
  await writeFile(owner, String(process.pid));
  await call("read", "busy");
  assert.equal(await fileExists(owner), true);
  const exitedPid = await stdoutOf(sh, ["-c", 'echo "$$"']);
  await writeFile(owner, exitedPid);
  await call("read", "off");
  assert.equal(await fileExists(lock), false);
});

test("Caffeine checks newly connected computers, stops checking when off, and checks more often during setup", async () => {
  const computer = "remote";
  const keys = [computer];
  let now = 0;
  let reply = "off";
  const caffeine = createCaffeine({
    now: () => now, run: async ({ command }) => success(command === "uname" ? "Linux" : reply),
  });
  const checkAfter = (ms, due, round = 0) => {
    now += ms;
    assert.deepEqual(caffeine.due(keys), due ? keys : [], `round ${round}`);
  };
  checkAfter(0, true);
  await caffeine.read(computer);
  checkAfter(EVERY_MS, false);
  reply = "on";
  await caffeine.set(computer, true);
  checkAfter(EVERY_MS - 1, false);
  checkAfter(1, true);

  caffeine.setup(computer);
  reply = "off";
  for (const round of [1, 2]) {
    await caffeine.read(computer);
    checkAfter(SETUP_EVERY_MS - 1, false);
    checkAfter(1, true, round);
  }
  await caffeine.read(computer);
  checkAfter(0, false);
  caffeine.keep([]);
  checkAfter(0, true);
});

test("A Caffeine status check waits for a change already running on that computer", async () => {
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const commands = [];
  const caffeine = createCaffeine({
    local: "macos",
    async run(spec) {
      commands.push(spec.args[1]);
      if (commands.length > 1) return success("on");
      started.resolve();
      return finish.promise;
    },
  });
  const turningOn = caffeine.set("", true);
  const checking = caffeine.read("");
  const script = (verb) => caffeineCall("macos", verb).args[1];
  try {
    await started.promise;
    await new Promise(process.nextTick);
    assert.deepEqual(commands, [script("on")]);
  } finally {
    finish.resolve(success("on"));
  }
  assert.equal((await turningOn).word, "on");
  assert.equal((await checking).word, "on");
  assert.deepEqual(commands, [script("on"), script("read")]);
});

test("If turning Caffeine off is refused, the computer still shows it on and gets checked again", async () => {
  let result = success("on");
  const caffeine = createCaffeine({ local: "macos", now: () => 0, run: async () => result });
  await caffeine.set("", true);
  for (const [reply, word] of [[success("setup"), "setup"], [success("busy"), "busy"], [failure("failed"), null]]) {
    result = reply;
    assert.equal((await caffeine.set("", false)).word, word);
    assert.equal(caffeine.isOn(""), true);
    assert.deepEqual(caffeine.due([""], EVERY_MS), [""]);
  }
});

test("Caffeine checks a remote computer's system once and already knows this computer's system", async () => {
  const calls = [];
  const caffeine = createCaffeine({
    local: "macos",
    async run({ command, args, on }) {
      calls.push([command, Array.from(args), on]);
      return success(command === "uname" ? "Linux\n" : "off");
    },
  });
  await caffeine.read("remote");
  await caffeine.set("remote", false);
  await caffeine.read("");
  const expected = (system, verb, on) => {
    const { command, args } = caffeineCall(system, verb);
    return [command, Array.from(args), on];
  };
  assert.deepEqual(calls, [
    ["uname", ["-s"], "remote"],
    expected("linux", "read", "remote"),
    expected("linux", "off", "remote"),
    expected("macos", "read", undefined),
  ]);
});

test("A computer row shows the coffee flag only when the computer and Caffeine are on", async () => {
  const { computerRow } = await load("kanso-spaces/computer-row.js", ["computerRow"], drawingHost());
  const { tokens } = await load("kanso-panel/ui.js", ["tokens"], drawingHost());
  const colors = tokens(KIT_NIGHT);
  const hasFlag = (props) => Boolean(find(computerRow({ name: "Desk", ...props })("computer", colors),
    (el) => arg(el, "svg")?.endsWith("/coffee.svg")));
  assert.equal(hasFlag({ state: "on", caffeine: true }), true);
  assert.equal(hasFlag({ state: "on", caffeine: false }), false);
  for (const state of ["off", "unreachable", "login"]) assert.equal(hasFlag({ state, caffeine: true }), false);
});

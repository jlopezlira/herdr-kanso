import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import {
  all, arg, context, drawingHost, exec, failure, fileExists, find, KIT_NIGHT,
  load, one, plain, stdoutOf, success, temporary, texts, until,
} from "./helpers.mjs";

const { caffeineCall, answerOf, setupArgv, createCaffeine, EVERY_MS, SETUP_EVERY_MS } =
  await load("kanso-panel/caffeine-model.js", ["caffeineCall", "answerOf", "setupArgv", "createCaffeine", "EVERY_MS", "SETUP_EVERY_MS"]);
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
    const scripts = [
      ...verbs.map((verb) => [verb, caffeineCall(system, verb).args[1]]),
      ...["on", "off"].map((verb) => [`setup ${verb}`, setupArgv(system, verb)[2]]),
    ];
    for (const [verb, script] of scripts) {
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
case "$*" in
  "/usr/bin/pmset -a disablesleep 0"|"/usr/bin/pmset -a disablesleep 1") shift; exec pmset "$@" ;;
  "/usr/bin/touch /var/db/kanso-caffeine") exec touch "$CAFFEINE_TEST_DIR/boot-marker" ;;
  "/bin/rm -f /var/db/kanso-caffeine") exec rm -f "$CAFFEINE_TEST_DIR/boot-marker" ;;
  *) exit 1 ;;
esac`;

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
  return { call, guards, read, running, state, write, markerExists: () => fileExists(join(dir, "boot-marker")) };
};

test("On macOS Caffeine keeps a guard running, restores sleep when turned off or after a restart, and respects low battery and locks", async (t) => {
  if (!hasSh || (await exec(sh, ["-c", "command -v plutil"])).code !== 0) {
    t.skip("Requires /bin/sh and plutil");
    return;
  }
  const { call, guards, read, running, state, write, markerExists } = await fakeMac(t);
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
    assert.equal(await markerExists(), before === "0", "mark only a change from sleep enabled");
    await call("read", "on");
    await call("off", "off");
    await until(async () => !(await running(pid)), 5_000);
    assert.equal(await markerExists(), false, "turning Caffeine off clears the marker");
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

test("Caffeine checks newly connected computers, leaves a computer known off alone, checks one that is on every few minutes, and checks more often during setup", async () => {
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
  await caffeine.change(computer, true);
  checkAfter(EVERY_MS - 1, false);
  checkAfter(1, true);

  caffeine.setup(computer, "off");
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

const macScript = (verb) => caffeineCall("macos", verb).args[1];

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
  const turningOn = caffeine.change("", true);
  const checking = caffeine.read("");
  try {
    await started.promise;
    await new Promise(process.nextTick);
    assert.deepEqual(commands, [macScript("on")]);
  } finally {
    finish.resolve(success("on"));
  }
  assert.equal((await turningOn).word, "on");
  assert.equal((await checking).word, "on");
  assert.deepEqual(commands, [macScript("on"), macScript("read")]);
});

test("Toggling Caffeine waits for a pending read before deciding whether to turn it on or off", async () => {
  const finish = Promise.withResolvers();
  const caffeine = createCaffeine({
    local: "macos",
    run: async ({ args }) => args[1] === macScript("read") ? finish.promise : success("off"),
  });
  const checking = caffeine.read("");
  const toggling = caffeine.change("", null);
  finish.resolve(success("on"));
  await checking;
  assert.equal((await toggling).verb, "off");
});

test("If turning Caffeine off is refused, the last known state stays on and the computer is due for another read", async () => {
  let result = success("on");
  const caffeine = createCaffeine({ local: "macos", now: () => 0, run: async () => result });
  await caffeine.change("", true);
  for (const [reply, word] of [[success("refused"), "refused"], [success("setup"), "setup"], [success("busy"), "busy"], [failure("failed"), null]]) {
    result = reply;
    assert.equal((await caffeine.change("", false)).word, word);
    const { on, read } = caffeine.look("");
    assert.deepEqual({ on, read }, { on: true, read: false });
    assert.deepEqual(caffeine.due([""], EVERY_MS - 1), []);
    assert.deepEqual(caffeine.due([""], EVERY_MS), [""]);
  }
});

const answering = (reply) => createCaffeine({ local: "macos", now: () => 0, run: async () => success(reply()) });

test("A turn on refused for low battery shows the computer off from its battery at once, and the battery notice is not sent again", async () => {
  let reply = "low";
  const caffeine = answering(() => reply);
  assert.equal((await caffeine.change("", true)).word, "low");
  const { on, read, busy, battery } = caffeine.look("");
  assert.deepEqual({ on, read, busy, battery }, { on: false, read: true, busy: false, battery: true });
  assert.deepEqual([caffeine.untold(""), caffeine.due([""], EVERY_MS)], [false, []]);
  reply = "off battery";
  await caffeine.read("");
  assert.equal(caffeine.untold(""), false);
  for (reply of ["on", "off battery"]) await caffeine.read("");
  assert.equal(caffeine.untold(""), true, "a new battery turn-off after it was on again is announced");
});

test("A turn on from the panel while its set up is waiting for the password ends the wait when the computer answers", async () => {
  for (const reply of ["low", "on"]) {
    const caffeine = answering(() => reply);
    caffeine.setup("", "on");
    await caffeine.change("", true);
    assert.equal(caffeine.look("").setup, false, reply);
  }
});

test("Caffeine reports a turn-off due to low battery only once", async () => {
  const caffeine = createCaffeine({ local: "macos", run: async () => success("off battery") });
  const key = "";
  await caffeine.read(key);
  const { on, battery } = caffeine.look(key);
  assert.deepEqual({ on, battery }, { on: false, battery: true });
  assert.deepEqual([caffeine.untold(key), caffeine.untold(key)], [true, false]);
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
  await caffeine.change("remote", false);
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

const loadPanel = async (host = {}) => {
  const { Caffeine, tokens } = await load("kanso-panel/caffeine.js", ["Caffeine", "tokens"], { ...drawingHost(), ...host });
  return { panel: new Caffeine(), colors: tokens(KIT_NIGHT) };
};

test("The Caffeine panel shows each computer's status, switch, and available action", async (t) => {
  const commands = [];
  const { panel, colors } = await loadPanel({ run: (name) => commands.push(name) });
  const key = "devbox";
  const title = "Dev box";
  const { cx } = context();
  const cases = [
    [{ on: true }, "Kept awake", true, false],
    [{}, "Sleeps as usual", false, false],
    [{ battery: true }, "Off: battery reached 15%", false, false],
    [{ busy: true, want: true, read: false }, "Turning on…", true, true],
    [{ on: true, busy: true, want: false }, "Turning off…", false, true],
    [{ setup: true, read: false }, "Waiting for the password in its tab", false, false],
    [{ on: true, read: false }, "Not read yet", false, true, true],
  ];
  for (const [state, word, pressed, disabled, retry] of cases) {
    await t.test(`The computer row says “${word}” and offers the matching controls`, () => {
      const look = { on: false, read: true, ...state };
      const row = panel.computer(colors, { key, title, look });
      assert.ok(texts(row).includes(word), word);
      const toggle = find(row, (el) => arg(el, "accessibility_label") === `Caffeine on ${title}`);
      assert.ok(toggle, word);
      assert.deepEqual([one(toggle, "pressed"), one(toggle, "disabled")], [pressed, disabled], word);

      const buttons = all(row, (el) => arg(el, "on_click"));
      assert.deepEqual(buttons.map((el) => one(el, "accessibility_label")), retry ? ["Read again"] : [], word);
      if (retry) one(buttons[0], "on_click")({}, cx);
      if (!disabled) one(toggle, "on_change")(!pressed, cx);
      const expected = retry ? ["kanso-spaces.caffeine-read"]
        : disabled ? [] : [`kanso-spaces.caffeine-${pressed ? "off" : "on"}:${key}`];
      assert.deepEqual(commands.splice(0), expected, word);
    });
  }
});

test("The Caffeine panel distinguishes unknown status from computers kept awake", async (t) => {
  const { panel, colors } = await loadPanel();
  const cases = [
    ["no computer has been read", [{ on: false, read: false }, { on: false, read: false }], "–", "2 not read yet"],
    ["one read failed and the other computer is on", [{ on: true, read: true }, { on: true, read: false }], "1", "1 not read yet"],
  ];
  for (const [state, looks, count, unread] of cases) {
    const hero = panel.hero(colors, looks.map((look) => ({ look })));
    const [value, unit, ...facts] = texts(find(hero, (el) => arg(el, "id") === "cf-metric"));
    await t.test(`The count is ${count} of 2 computers when ${state}`, () => {
      assert.deepEqual([value, unit], [count, "of 2 computers"]);
    });
    await t.test(`The facts start with “${unread}” and explain which systems stay awake with the lid closed when ${state}`, () => {
      assert.deepEqual(facts.slice(0, 2), [unread, "Lid closed too on macOS and Linux"]);
    });
  }
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

test("A turn on queued behind a status check still shows pending until its own answer comes back", async () => {
  const replies = [];
  const caffeine = createCaffeine({ local: "macos", run: () => new Promise((resolve) => replies.push(resolve)) });
  const answer = async (reply) => {
    while (!replies.length) await new Promise((resolve) => setImmediate(resolve));
    replies.shift()(success(reply));
  };
  const read = caffeine.read("");
  const turned = caffeine.change("", true);
  await answer("off");
  await read;
  assert.equal(caffeine.look("").busy, true);
  await answer("on");
  await turned;
  assert.deepEqual([caffeine.look("").busy, caffeine.look("").on], [false, true]);
});

test("A computer left on is checked again, so a battery turn-off is noticed once and the cup goes away", async () => {
  let now = 0, reply = "on";
  const caffeine = createCaffeine({ local: "linux", now: () => now, run: async () => success(reply) });
  await caffeine.change("", true);
  now += EVERY_MS;
  assert.deepEqual(caffeine.due([""]), [""]);
  reply = "off battery";
  await caffeine.read("");
  assert.deepEqual([caffeine.look("").on, caffeine.untold(""), caffeine.untold("")], [false, true, false]);
});

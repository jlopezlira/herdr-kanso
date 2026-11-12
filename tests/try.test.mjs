// scripts/try.sh with herdr-app, hc, ps and sleep replaced by fakes that log how they were called.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporary, until } from "./helpers.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/try.sh", import.meta.url));
const skip = process.platform === "win32";
const FAKE = `#!/bin/sh
printf '%s|%s|%s\\n' "\${HERDR_APP_HOME-}" "\${HC_SESSION-}" "$(basename "$0") $*" >> "$TRY_LOG"
case "$(basename "$0") $1" in "herdr-app status") [ -n "\${RUNNING-}" ] ;; "ps "*) printf '%s\\n' "\${PS_OUT-}" ;; esac
`;

async function run(t, command, env) {
  const home = await temporary(t);
  const bin = join(home, "bin");
  mkdirSync(bin);
  mkdirSync(join(home, ".config", "herdr-app"), { recursive: true });
  for (const name of ["herdr-app", "hc", "ps", "sleep"]) writeFileSync(join(bin, name), FAKE, { mode: 0o755 });
  const log = join(home, "calls.log");
  writeFileSync(log, "");
  const base = { PATH: `${bin}:${process.env.PATH}`, HOME: home, TRY_LOG: log };
  const result = spawnSync("sh", [SCRIPT, command], { env: { ...base, ...env(home) }, encoding: "utf8" });
  const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { home, demo: join(home, ".cache", "kd"), result, calls };
}

test("Try refuses your own Herdr home and touches nothing", { skip }, async (t) => {
  for (const suffix of ["", "/"]) {
    const { home, result, calls } = await run(t, "start", (h) => ({ HERDR_APP_HOME: join(h, ".config", "herdr-app") + suffix }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing/);
    assert.deepEqual(calls(), []);
    assert.ok(!existsSync(join(home, ".config", "herdr-app", "mods")));
  }
});

test("Try start installs into the demo home and opens the demo with both variables in one command", { skip }, async (t) => {
  const { demo, result, calls } = await run(t, "start", () => ({}));
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(demo, "mods", "kanso-chrome", "version.json")));
  assert.match(result.stdout, /^Installed \S+ at [0-9a-f]{7,}.* in .*\.cache\/kd\.\n$/);
  const launch = `${demo}|kanso-demo|herdr-app `;
  await until(() => calls().includes(launch), 2000);
  assert.ok(calls().includes(`${demo}||herdr-app do layout.switch --name kanso`));
  for (const call of calls()) assert.ok(call.startsWith(`${demo}|`), call);
});

test("Try start leaves an open demo window running and switches it to kansō", { skip }, async (t) => {
  const { demo, result, calls } = await run(t, "start", () => ({ RUNNING: "1" }));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(), [`${demo}||herdr-app status`, `${demo}||herdr-app do layout.switch --name kanso`]);
});

test("Try stop quits the demo and stops its core, and nothing else", { skip }, async (t) => {
  const { demo, result, calls } = await run(t, "stop", () => ({ PS_OUT: "1 /bin/zsh\n2 herdr-core --socket /x/.cache/kdl/kl.sock" }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Demo stopped: nothing left.\n");
  assert.deepEqual(calls().filter((c) => !c.includes("|ps ")), [`${demo}||herdr-app do app.quit`, "|kanso-demo|hc server stop"]);
});

test("Try stop names what is still running after it waited", { skip }, async (t) => {
  const { result, calls } = await run(t, "stop", () => ({ PS_OUT: "7 herdr-core server --session kanso-demo" }));
  assert.equal(result.stdout, "Still running:\n7 herdr-core server --session kanso-demo\n");
  assert.equal(calls().filter((c) => c.endsWith("|sleep 1")).length, 5);
});

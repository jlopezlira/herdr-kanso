import test from "node:test";
import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clone, exec, failure, folderWith, load, success } from "./helpers.mjs";
import { loadSpaces } from "./mod-fixtures.mjs";

const sign = () => load("kanso-computers/sign-in.js", ["lanArgs", "lanFirst", "lanParts", "keyedRoute"]);
const route = (...names) => load("kanso-computers/lan-route.js", names);
const quote = () => load("kanso-computers/platform-command.js", ["shellQuote"]);
const shForm = process.platform === "win32" && "LAN-first shell routes run on macOS and Linux";
const saved = { name: "grey", target: "ada@grey:2222", via: "", session: "sess" };
const home = "desk.local";
const known = "known_hosts_kanso_grey";
const key = "~/.ssh/id_kanso_agent_grey";
const hostKey = "ssh-ed25519 AAAA";
const facts = (name = "Desk.LOCAL", pub = hostKey) => `home ${name}\nuser ada\nkey ${pub} comment\n`;
const lanRefusal = failure("The home SSH key did not match");

const oldVia = async (args, away) => {
  const { shellQuote } = await quote();
  const head = "ssh -o BatchMode=yes -o ConnectTimeout=2 -o StrictHostKeyChecking=accept-new";
  const live = "exec ssh -o StrictHostKeyChecking=accept-new";
  const line = `${head} ${args} true >/dev/null 2>&1 && ${live} ${args} "$1"; exec ${away} "$1"`;
  return `sh -c ${shellQuote(line)} route`;
};

const namedVia = ({ lanArgs, lanFirst }, away = "ssh -p 2222 ada@grey") =>
  lanFirst(lanArgs(home, { target: saved.target, hostKey: home, known }), away);

test("A saved home name survives reading the route with or without a kansō key, and older IP routes still work", async () => {
  const signIn = await sign();
  const { keyedRoute, lanFirst, lanParts } = signIn;
  const via = namedVia(signIn);
  const parts = lanParts(via);
  assert.ok(parts.named);
  assert.equal(parts.ip, home);
  assert.equal(lanFirst(parts.args, parts.away), via);

  const keyed = keyedRoute({ via }).keyed(key);
  const parsed = lanParts(keyed);
  assert.deepEqual({ ...parsed }, { ...parts, key });
  assert.equal(keyedRoute({ via: lanFirst(parsed.args, parsed.away) }).keyed(parsed.key), keyed);

  const aged = await oldVia("ada@10.0.0.7", parts.away);
  assert.equal(lanParts(aged)?.ip, "10.0.0.7");
  assert.equal(lanParts(aged)?.away, parts.away);
  assert.equal(lanParts(aged.slice(0, -1)), null);
});

test("A computer supplies its lowercase home name, login and public keys without counting junk", async () => {
  const { homeFacts } = await route("homeFacts");
  const rsa = "ssh-rsa BBBB";
  const lines = facts() + `key garbage BBBB\nkey ${rsa}\nkey ${hostKey}\n`;
  assert.deepEqual(clone(homeFacts(lines)), { home, user: "ada", keys: [hostKey, rsa] });
  assert.equal(homeFacts(facts("lab.example")), null);
  assert.equal(homeFacts(facts("desk", "junk")), null);
});

const homeCheck = (name, probe = success(""), pub = hostKey) => {
  const calls = [];
  return {
    calls,
    remote: async (args) => {
      assert.deepEqual(Array.from(args.slice(0, 2)), ["sh", "-c"]);
      return success(facts(name, pub));
    },
    run: async (program, args) => {
      calls.push([program, [...args]]);
      return program === "sh" ? success("") : probe;
    },
  };
};
const assertPin = ([program, args], hostname, pub = hostKey) => {
  assert.equal(program, "sh");
  assert.deepEqual(args.slice(2), ["pin", known, hostname, pub]);
};

test("A trusted computer is pinned and probed by home name without losing the alias, port or identity", async (t) => {
  const { homeRoute } = await route("homeRoute");
  const { lanParts, keyedRoute } = await sign();
  const via = keyedRoute(saved).keyed(key);
  const check = homeCheck();
  const found = await homeRoute({ ...saved, target: "", via }, check);
  assert.equal(found.home, home);
  assert.equal(found.record.session, saved.session);
  assert.equal(found.record.target, "");
  const [pin, [program, args]] = check.calls;
  assertPin(pin, home);
  if (!shForm) {
    const { dir } = await folderWith(t);
    const pinned = await exec(pin[0], pin[1], { env: { PATH: "/bin:/usr/bin", HOME: dir } });
    assert.equal(pinned.code, 0, pinned.stderr);
    assert.equal(await readFile(join(dir, ".ssh", known), "utf8"), `${home} ${hostKey}\n`);
  }
  assert.equal(program, "ssh");
  assert.deepEqual(args.slice(-5), ["-p", "2222", "--", "ada@grey", "true"]);
  for (const option of [
    "HostName=desk.local", "HostKeyAlias=desk.local", "StrictHostKeyChecking=yes", `UserKnownHostsFile=~/.ssh/${known}`,
    "GlobalKnownHostsFile=/dev/null", "VerifyHostKeyDNS=no", "ProxyCommand=none", "ControlMaster=no", "ControlPath=none",
    `IdentityFile=${key}`,
  ]) assert.ok(args.includes(option), option);
  const parts = lanParts(found.record.via);
  assert.equal(parts.away, "ssh -p 2222 ada@grey");
  assert.equal(parts.key, key);
  assert.ok(parts.args.includes("-p 2222 ada@grey"));
  assert.ok(parts.named);
});

test("A failed home probe leaves the saved route alone, but a renamed computer gets a new route", async () => {
  const { homeRoute } = await route("homeRoute");
  const signIn = await sign();
  const current = { ...saved, target: "", via: namedVia(signIn) };
  assert.equal(await homeRoute(saved, homeCheck("desk", lanRefusal)), null);

  const rotated = "ssh-ed25519 CCCC";
  const held = homeCheck("desk", success(""), rotated);
  assert.equal(await homeRoute(current, held), null);
  assert.equal(held.calls.length, 1);
  assertPin(held.calls[0], home, rotated);

  const moved = homeCheck("desk-2");
  const found = await homeRoute(current, moved);
  assertPin(moved.calls[0], "desk-2.local");
  assert.equal(signIn.lanParts(found.record.via)?.ip, "desk-2.local");
  assert.equal(signIn.lanParts(found.record.via)?.away, signIn.lanParts(current.via).away);
});

test("A disconnected computer can return through a home address using its already trusted SSH key", async () => {
  const { knownHome } = await route("knownHome");
  const { lanParts } = await sign();
  const calls = [];
  const run = async (program, args) => {
    calls.push([program, [...args]]);
    if (args[0] === "-G") return success("hostname 100.64.1.2\nhostkeyalias grey-away\n");
    return success("");
  };
  const found = await knownHome(saved, run);
  assert.deepEqual(calls[0], ["ssh", ["-G", "ada@grey"]]);
  const [program, args] = calls[1];
  assert.equal(program, "ssh");
  assert.ok(args.includes("HostKeyAlias=grey-away"));
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
  const parts = lanParts(found.record.via);
  assert.equal(parts.ip, "grey.local");
  assert.equal(parts.named, false);
  assert.equal(parts.away, "ssh -p 2222 ada@grey");
});

const machineList = (...rows) => success(JSON.stringify({ machines: rows }));
const next = { ...saved, target: "", via: "ssh ada@desk.local" };
const machineChanges = ({ rows = [saved], remove = success(""), add = success(""), after = [] } = {}) => {
  const calls = [];
  let checked = false;
  let added = false;
  const hc = async (args) => {
    if (args[1] === "ls") {
      const list = checked ? after : rows;
      checked = true;
      return list ? machineList(...list) : failure("could not list machines");
    }
    calls.push([...args]);
    if (args[1] === "rm") return remove;
    const result = added ? success("") : add;
    added = true;
    return result;
  };
  return { calls, hc };
};

test("Automatic route replacement does not proceed after the route changes or removal is refused", async () => {
  const { reroute } = await route("reroute");
  const changed = machineChanges({ rows: [next] });
  assert.equal(await reroute(saved, next, changed.hc), false);
  assert.deepEqual(changed.calls, []);
  const refused = machineChanges({ remove: failure("could not remove") });
  assert.equal(await reroute(saved, next, refused.hc), false);
  assert.deepEqual(refused.calls.map((args) => args[1]), ["rm"]);
});

test("A failed route replacement restores the old route only if the computer is still absent", async () => {
  const { reroute } = await route("reroute");
  for (const [after, shouldRestore] of [[[], true], [[next], false], [null, false]]) {
    const failed = machineChanges({ after, add: failure("could not add") });
    assert.equal(await reroute(saved, next, failed.hc), false);
    const adds = failed.calls.filter((args) => args[1] === "add");
    assert.ok(adds[0].includes(next.via));
    assert.deepEqual(adds.slice(1).map((args) => args[2]), shouldRestore ? [saved.target] : []);
  }
});

const stubRoute = async (t, body) => {
  const { dir, ssh } = await folderWith(t, "ssh");
  await writeFile(ssh, `#!/bin/sh\n${body}\n`);
  await chmod(ssh, 0o755);
  return (via, command = "command", env = {}) =>
    exec("sh", ["-c", `printf 'input\\n' | ${via} "$1"`, "test", command], { env: { PATH: `${dir}:/bin:/usr/bin`, ...env }, limit: 5500 });
};

test("A stalled home SSH probe falls back in about three seconds without consuming the away command's input", { skip: shForm }, async (t) => {
  const { lanFirst } = await sign();
  const run = await stubRoute(t, [
    'case " $* " in *" ada@10.0.0.7 "*) exec sleep 7 ;; esac',
    'for word do last=$word; done',
    'printf "%s\\n" "$last"; cat',
  ].join("\n"));
  const start = performance.now();
  const result = await run(lanFirst("ada@10.0.0.7", "ssh ada@grey"), "away command");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "away command\ninput\n");
  assert.ok(performance.now() - start >= 2000, "a stalled home connection must actually be given time to answer");
});

test("Signing in checks the home key strictly and tries away only when home SSH cannot connect", { skip: shForm }, async (t) => {
  const signIn = await sign();
  const { ask } = signIn.keyedRoute({ via: namedVia(signIn) });
  const run = await stubRoute(t, [
    'case " $* " in',
    '  *" HostName=desk.local "*)',
    '    case " $* " in *" StrictHostKeyChecking=yes "*) ;; *) exit 90 ;; esac',
    '    printf "home\\n"; exit "$HOME_CODE" ;;',
    '  *) printf "away\\n" ;;',
    'esac',
  ].join("\n"));
  for (const [code, tried, result] of [[0, "home\n", 0], [1, "home\n", 1], [255, "home\naway\n", 0]]) {
    const answer = await run(ask, "append key", { HOME_CODE: String(code) });
    assert.deepEqual([answer.stdout, answer.code], [tried, result]);
  }
});

test("The sidebar switches to the home network without Tailscale unless network discovery is hidden", async () => {
  const connected = { ...saved, state: "connected" };
  for (const hidden of [false, true]) {
    const reached = [];
    const notices = [];
    const changes = machineChanges({ rows: [connected] });
    const { Spaces } = await loadSpaces({
      window: () => ({ platform: "macos" }),
      shared: (name) => name === "kanso.pieces" && hidden ? { "computers.network": "hide" } : null,
      exec: async (program, args, options) => {
        reached.push([program, options?.on ?? null]);
        if (options?.on === saved.name) return success(facts());
        if (program === "sh" || program === "ssh") return success("");
        return failure("not installed");
      },
      hc: changes.hc,
      notify: (notice) => notices.push(notice),
    });
    const view = new Spaces();
    view.machines = [connected];
    await view.preferHome();
    assert.deepEqual(reached, hidden ? [] : [["sh", saved.name], ["sh", null], ["ssh", null]]);
    assert.deepEqual(changes.calls.map((args) => args[1]), hidden ? [] : ["rm", "add"]);
    assert.equal(notices.length, hidden ? 0 : 1);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { compare, scan, scannedFiles } from "../scripts/check-dupes.mjs";
import { arg, clone, computersDialog, exec, fieldWith, find, folderWith, gpuiHost, load, success, texts } from "./helpers.mjs";

const reach = () => load("kanso-computers/reach.js", [
  "tailnet", "planFor", "choiceOf", "addArgs", "probeArgs", "reachOf", "keySetup", "advice", "isAdded",
  "sshConfigHosts", "includesOf", "ACCESS_CONTROLS", "validTarget", "destinationOf", "aliasOf",
]);
const quote = () => load("kanso-computers/platform-command.js", ["windowsArg", "psQuote"]);

const peer = (over = {}) => ({
  DNSName: "grey.tail.ts.net.", HostName: "grey", OS: "linux", Online: true,
  TailscaleIPs: ["100.64.1.2"], sshHostKeys: ["ssh-ed25519 AAAA"], ...over,
});
const status = (peers, state = "Running") => JSON.stringify({ BackendState: state, Peer: peers });
const names = (net) => net.peers.map((row) => row.name);
const netOf = async (peers) => {
  const { tailnet } = await reach();
  return { tailnet, net: tailnet(status(peers)) };
};
const configText = (more = []) => [
  "Host *.example *",
  "  User nope",
  "Match host exec",
  "  User skip",
  "Host grey",
  "  HostName 100.64.1.2",
  "  User root",
  "Host grey",
  "  HostName 10.0.0.9",
  "Host box",
  "  Hostname=10.0.0.2",
  "  User=ada",
  ...more,
].join("\n");

test("A tailscale status with a warning line still lists the computers, and phones are left out", async () => {
  const { tailnet } = await reach();
  const body = status({
    phone: peer({ DNSName: "phone.tail.ts.net.", OS: "iOS", TailscaleIPs: ["100.64.1.8"] }),
    tablet: peer({ DNSName: "tab.tail.ts.net.", OS: "android", TailscaleIPs: ["100.64.1.9"] }),
    grey: peer({}),
  });
  const net = tailnet(`Warning: client version "1.66.0" != tailscaled server version "1.68.0"\n${body}`);
  assert.equal(net.state, "Running");
  assert.deepEqual(clone(names(net)), ["grey"]);
});

test("A tailnet that is not running, or garbage, lists no computers", async () => {
  const { tailnet } = await reach();
  assert.deepEqual(clone(tailnet(status({ grey: peer({}) }, "Stopped"))), { state: "Stopped", peers: [] });
  assert.equal(tailnet("not json"), null);
  assert.equal(tailnet("Warning: client version {"), null);
  assert.equal(tailnet(null), null);
});

test("A computer's address is its IPv4, its name the first label, and online ones come first", async () => {
  const { tailnet, net } = await netOf({
    zed: peer({ DNSName: "zed.tail.ts.net.", Online: false, TailscaleIPs: ["fd7a:115c:a1e0::9", "100.64.1.9"] }),
    ada: peer({ DNSName: "ada.tail.ts.net.", Online: true, TailscaleIPs: ["fd7a:115c:a1e0::1", "100.64.1.1"] }),
    amy: peer({ DNSName: "amy.tail.ts.net.", Online: false, TailscaleIPs: ["100.64.1.3"] }),
    bob: peer({ DNSName: "bob.tail.ts.net.", Online: true, TailscaleIPs: ["100.64.1.2"] }),
  });
  assert.deepEqual(clone(names(net)), ["ada", "bob", "amy", "zed"]);
  assert.deepEqual(clone(net.peers.map((row) => row.online)), [true, true, false, false]);
  assert.equal(net.peers.find((row) => row.name === "ada").ip, "100.64.1.1", "IPv4 over IPv6");
  const labelled = tailnet(status({ box: peer({ DNSName: "Grey-Box.tail.ts.net.", HostName: "other", TailscaleIPs: ["100.64.9.2"] }) }));
  assert.equal(labelled.peers[0].name, "Grey-Box", "the first DNSName label, not the host name");
});

test("Tailscale SSH is on only when the computer has a host key", async () => {
  const { net } = await netOf({
    on: peer({ DNSName: "on.tail.ts.net.", TailscaleIPs: ["100.64.1.1"], sshHostKeys: ["ssh-ed25519 AAAA"] }),
    empty: peer({ DNSName: "empty.tail.ts.net.", TailscaleIPs: ["100.64.1.4"], sshHostKeys: [] }),
    missing: peer({ DNSName: "missing.tail.ts.net.", TailscaleIPs: ["100.64.1.5"], sshHostKeys: null }),
  });
  assert.deepEqual(clone(net.peers.map((row) => [row.name, row.tailscaleSsh])), [["empty", false], ["missing", false], ["on", true]]);
});

test("A Tailscale SSH computer is reached through tailscale, and without it ssh tries the typed name, then the address", async () => {
  const { planFor } = await reach();
  const choice = { peer: { name: "grey", ip: "100.64.1.2", tailscaleSsh: true }, target: "root@grey", name: "ignored" };
  assert.deepEqual(clone(planFor(choice, { tailscale: "/usr/local/bin/tailscale" })), {
    name: "grey", target: "root@100.64.1.2", via: "/usr/local/bin/tailscale ssh root@100.64.1.2", probe: false,
  });
  assert.deepEqual(clone(planFor(choice, { tailscale: "" })), {
    name: "grey", target: "root@grey", via: "", probe: true, also: ["root@100.64.1.2"],
  });
  assert.deepEqual(clone(planFor({ peer: { name: "box", ip: "10.0.0.5", tailscaleSsh: false }, target: "" }, { tailscale: "/usr/bin/tailscale" })), {
    name: "box", target: "10.0.0.5", via: "", probe: true,
  });
});

test("A typed host is used as written, and Windows quotes the tailscale command", async () => {
  const { planFor } = await reach();
  const { windowsArg } = await quote();
  assert.deepEqual(clone(planFor({ target: "  ada@box.example  ", name: "box" })), {
    name: "box", target: "ada@box.example", via: "", probe: true,
  });
  const path = "C:\\Program Files\\Tailscale\\tailscale.exe";
  const choice = { peer: { name: "grey", ip: "100.64.1.2", tailscaleSsh: true }, target: "root@grey" };
  const planned = planFor(choice, { tailscale: path, platform: "windows" });
  assert.equal(planned.via, `${windowsArg(path)} ssh ${windowsArg("root@100.64.1.2")}`);
  assert.equal(planned.probe, false);
});

test("root@grey is the grey computer and keeps the user, an address is its computer, and an unknown host is none", async () => {
  const { choiceOf } = await reach();
  const peers = [{ name: "grey", ip: "100.64.1.2" }, { name: "box", ip: "10.0.0.8" }];
  const grey = choiceOf("root@grey", peers);
  assert.equal(grey.peer, peers[0]);
  assert.equal(grey.target, "root@grey");
  assert.equal(grey.name, "grey");
  const byIp = choiceOf("10.0.0.8", peers);
  assert.equal(byIp.peer, peers[1]);
  assert.equal(byIp.target, "10.0.0.8");
  assert.deepEqual(clone(choiceOf("  nope  ", peers)), { peer: null, target: "nope" });
});

test("Adding a computer always installs, and a via command is not a positional target", async () => {
  const { addArgs } = await reach();
  const row = { name: "grey", target: "root@100.64.1.2", via: "" };
  assert.equal(addArgs(row).includes("--install"), true);
  assert.equal(addArgs(row, { json: false }).includes("--install"), true);
  assert.equal(addArgs(row).includes("--json"), true);
  assert.equal(addArgs(row, { json: false }).includes("--json"), false);
  const via = addArgs({ name: "grey", target: "root@100.64.1.2", via: "tailscale ssh root@100.64.1.2" });
  assert.deepEqual(clone(via), ["machine", "add", "--name", "grey", "--via", "tailscale ssh root@100.64.1.2", "--install", "--json"]);
  assert.ok(via.indexOf("--name") < via.indexOf("--via"));
  assert.equal(via.includes("root@100.64.1.2"), false);
});

const ACCEPT_NEW = "StrictHostKeyChecking=accept-new";
const UNIX_PROBE_HOSTS = "UserKnownHostsFile=/dev/null";

for (const [platform, name, hosts] of [
  ["macos", "macOS", UNIX_PROBE_HOSTS],
  ["linux", "Linux", UNIX_PROBE_HOSTS],
  ["windows", "Windows", "UserKnownHostsFile=NUL"],
]) {
  test(`On ${name}, checking whether a computer answers SSH does not ask for a password or save its host key`, async () => {
    const { probeArgs } = await reach();
    const args = probeArgs("ada@box", platform);
    assert.ok(args.includes("BatchMode=yes"));
    assert.ok(args.includes(ACCEPT_NEW));
    assert.equal(args[args.indexOf(hosts) - 1], "-o", hosts);
    assert.equal(args.at(-2), "ada@box");
  });
}

test("What ssh said says whether the computer is ready, wants a password, is closed, or cannot be reached", async () => {
  const { reachOf } = await reach();
  const said = (stderr, code = 1) => reachOf({ code, stdout: "", stderr });
  assert.equal(said("root@grey: Permission denied (publickey,password)."), "password");
  assert.equal(said("ssh: connect to host grey port 22: Connection refused"), "closed");
  assert.equal(said("ssh: connect to host grey port 22: Operation timed out"), "unreachable");
  assert.equal(said("ssh: Could not resolve hostname grey: Name or service not known"), "unreachable");
  assert.equal(said("WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!"), "hostkey");
  assert.equal(said("cannot reach grey: no answer within 20 s"), "unreachable");
  assert.equal(said("cannot reach grey: unreachable"), "unreachable");
  assert.equal(reachOf({ code: 0, stdout: "", stderr: "" }), "ready");
  assert.equal(said("ssh: weird failure"), "failed");
});

const shForm = process.platform === "win32" && "the sh form runs on macOS and Linux; Windows uses the PowerShell form";
const PUB = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKansoOneClickTest kanso";
const KEY_PATH = "~/.ssh/id_ed25519_kanso";
const agentPath = (suffix) => "~/.ssh/id_kanso_agent_" + suffix;
const KEY_OPTIONS = "-o IdentitiesOnly=yes -o BatchMode=yes";
const identityWords = (path) => `-o IdentityFile=${path} ${KEY_OPTIONS}`;
const KEY_WORDS = identityWords(KEY_PATH);
const agentWords = (suffix) => identityWords(agentPath(suffix));
const OLD_KEY_WORDS = `-i ${KEY_PATH} ${KEY_OPTIONS}`;
const ASK = "-o PasswordAuthentication=yes -o KbdInteractiveAuthentication=yes";
const signIn = () => load("kanso-computers/sign-in.js", ["signInTab", "routeOf", "keySetup", "lanParts"]);

const writeStub = async (dir, name, body) => {
  const file = join(dir, name);
  const out = JSON.stringify(join(dir, `${name}.args`));
  await writeFile(file, `#!/bin/sh\nexec 9>>${out}\nfor arg in "$@"; do printf '%s:%s\\n' "\${#arg}" "$arg" >&9; done\nprintf '\\n' >&9\nexec 9>&-\n${body}\n`);
  await chmod(file, 0o755);
};
const callsOf = async (dir, name) => {
  try {
    const text = await readFile(join(dir, `${name}.args`), "utf8");
    const calls = [];
    let call = [];
    for (const line of text.split("\n")) {
      if (line === "") {
        if (call.length) calls.push(call);
        call = [];
        continue;
      }
      const mark = line.indexOf(":");
      const size = Number(line.slice(0, mark));
      call.push(line.slice(mark + 1, mark + 1 + size));
    }
    if (call.length) calls.push(call);
    return calls;
  } catch {
    return [];
  }
};
const agentListing = (keys) => keys.length
  ? `printf '%s\\n' ${keys.map((line) => JSON.stringify(line)).join(" ")}`
  : "exit 1";
const keyBin = async (t, { agentKeys = [], probeCode, sshCode = 0, sshSaid = "", sshOut = "", failVia = false, sshBody = "", appCode = 0 } = {}) => {
  const { dir, bin, home } = await folderWith(t, "bin", "home");
  await mkdir(bin);
  await mkdir(home);
  const pub = JSON.stringify(PUB);
  await writeStub(bin, "ssh-keygen", [
    "prev=",
    "key=",
    "for arg in \"$@\"; do",
    "  if [ \"$prev\" = -f ]; then key=$arg; fi",
    "  prev=$arg",
    "done",
    "if [ -n \"$key\" ]; then",
    "  printf '%s\\n' private > \"$key\"",
    `  printf '%s\\n' ${pub} > "$key.pub"`,
    "fi",
    "exit 0",
  ].join("\n"));
  await writeStub(bin, "ssh-add", agentListing(agentKeys));
  await writeStub(bin, "ssh", [
    "for arg do",
    '  case "$arg" in BatchMode=yes) batch=yes ;; esac',
    "  last=$arg",
    "done",
    probeCode === undefined ? "" : `if [ "$batch" = yes ] && [ "$last" = true ]; then exit ${probeCode}; fi`,
    sshBody || [
      sshSaid && `printf '%s\\n' ${JSON.stringify(sshSaid)} >&2`,
      sshOut && `printf '%s\\n' ${JSON.stringify(sshOut)}`,
      `exit ${sshCode}`,
    ].filter(Boolean).join("\n"),
  ].join("\n"));
  await writeStub(bin, "hc", failVia ? "if [ \"$1\" = machine ] && [ \"$2\" = add ] && [ \"$3\" = --via ]; then exit 1; fi\nexit 0" : "exit 0");
  await writeStub(bin, "herdr-app", `exit ${appCode}`);
  return { bin, home, env: { PATH: `${bin}:/bin:/usr/bin`, HOME: home, TMPDIR: dir } };
};
const runKeyScript = ([program, ...args], env) => exec(program, args, { env });
const agentFile = (home, suffix) => join(home, ".ssh", basename(agentPath(suffix)));
const runSh = async (t, argv, options, prepare) => {
  const placed = await keyBin(t, options);
  const key = join(placed.home, ".ssh", "id_ed25519_kanso");
  if (prepare) {
    await mkdir(join(placed.home, ".ssh"));
    await prepare({ key, home: placed.home });
  }
  const ran = await runKeyScript(argv, placed.env);
  return { ...placed, key, ran, calls: (name) => callsOf(placed.bin, name) };
};
const viaOf = (dest, port = "") => `ssh ${KEY_WORDS}${port ? ` -p ${port}` : ""} ${dest}`;
const sshMarks = (text) => text.match(/(^|[\s'"])ssh (?=\S)/g) ?? [];
const LOCAL_FIRST = "sh -c 'ssh -o BatchMode=yes -o ConnectTimeout=2 -o StrictHostKeyChecking=accept-new ada@10.0.0.7 true >/dev/null 2>&1 && exec ssh -o StrictHostKeyChecking=accept-new ada@10.0.0.7 \"$1\"; exec ssh ada@10.0.0.9 \"$1\"' route";

const endsDone = (ran) => {
  assert.equal(ran.code, 0, `${ran.stderr}\n${ran.stdout}`);
  assert.match(ran.stdout, /Done: this tab can close\.\n$/);
};

test("Signing in to a plain computer, with a port and without one, makes a key, asks the password once, and adds the computer with that key", { skip: shForm }, async (t) => {
  const { keySetup } = await signIn();
  const once = async (machine, dest, port) => {
    const argv = keySetup(machine);
    assert.deepEqual(clone(argv.slice(0, 2)), ["sh", "-c"]);
    const { home, ran, calls } = await runSh(t, argv);
    endsDone(ran);
    const key = join(home, ".ssh", "id_ed25519_kanso");
    assert.equal((await readFile(`${key}.pub`, "utf8")).trim(), PUB);
    assert.equal((await calls("ssh-keygen"))[0].at(-1), key);
    const ssh = (await calls("ssh"))[0];
    assert.ok(ssh.join(" ").includes(ASK), ssh.join(" "));
    assert.equal(ssh.includes(ACCEPT_NEW), false, ssh.join(" "));
    assert.equal(ssh.includes("-p"), Boolean(port));
    if (port) assert.equal(ssh[ssh.indexOf("-p") + 1], port);
    assert.ok(ssh.includes(dest));
    assert.ok(ssh.at(-1).includes(PUB), ssh.at(-1));
    const hc = await calls("hc");
    assert.deepEqual(hc, [["machine", "add", "--via", viaOf(dest, port), "--name", machine.name, "--install"]]);
    assert.equal(hc[0].includes("--json"), false);
    assert.deepEqual(await calls("herdr-app"), [["do", `kanso-spaces.retry-machine:${machine.name}`]]);
  };
  await once({ name: "grey", target: "ada@100.64.1.2", via: "" }, "ada@100.64.1.2", "");
  await once({ name: "can", target: "can@10.0.0.7:2222", via: "" }, "can@10.0.0.7", "2222");
});

test("When the computer denies the key, the tab says it didn't let this computer in and shows the key; a timeout or a refused port shows only that error", { skip: shForm }, async (t) => {
  const { keySetup } = await signIn();
  const machine = { name: "grey", target: "ada@box", via: "" };
  const denied = await runSh(t, keySetup(machine), { sshCode: 1, sshSaid: "Permission denied (publickey)." });
  assert.notEqual(denied.ran.code, 0);
  assert.match(denied.ran.stdout, /didn't let this computer in/);
  assert.ok(denied.ran.stdout.includes(PUB));
  assert.deepEqual(await denied.calls("hc"), []);
  const refused = await runSh(t, keySetup(machine), { sshCode: 1, sshSaid: "ssh: connect to host box port 22: Connection refused" });
  assert.notEqual(refused.ran.code, 0);
  assert.match(refused.ran.stderr, /Connection refused/);
  assert.doesNotMatch(refused.ran.stdout, /didn't let this computer in/);
  assert.equal(refused.ran.stdout.includes(PUB), false);
  assert.deepEqual(await refused.calls("hc"), []);
  const timed = await runSh(t, keySetup(machine), { sshCode: 1, sshSaid: "ssh: connect to host box port 22: Operation timed out" });
  assert.notEqual(timed.ran.code, 0);
  assert.match(timed.ran.stderr, /timed out/);
  assert.doesNotMatch(timed.ran.stdout, /didn't let this computer in/);
  assert.equal(timed.ran.stdout.includes(PUB), false);
  assert.deepEqual(await timed.calls("hc"), []);
});

test("Signing in to a computer Herdr already lists removes it and adds it with the key, and puts the old route back if that add fails", { skip: shForm }, async (t) => {
  const { signInTab } = await signIn();
  const row = { name: "grey", target: "ada@box", via: false, session: null };
  const tab = signInTab(row);
  assert.equal(tab.place, "right");
  const { ran, calls } = await runSh(t, tab.argv, { failVia: true });
  assert.notEqual(ran.code, 0);
  assert.deepEqual(await calls("hc"), [
    ["machine", "rm", "grey"],
    ["machine", "add", "--via", viaOf("ada@box"), "--name", "grey", "--install"],
    ["machine", "add", "ada@box", "--name", "grey", "--install"],
  ]);
});

test("Signing in through a local-first route puts the key on every ssh once, and signing in again does not repeat it; the password ask goes through the route without the key", { skip: shForm }, async (t) => {
  const { signInTab, routeOf } = await signIn();
  const route = LOCAL_FIRST;
  const listed = { name: "grey", via: true, target: route };
  const saved = { name: "grey", target: route, via: false };
  assert.equal(routeOf(saved).target, "");
  assert.equal(routeOf(saved).via, route);
  assert.deepEqual(clone(signInTab(saved).argv), clone(signInTab(listed).argv));
  const first = await runSh(t, signInTab(listed).argv);
  assert.equal(first.ran.code, 0, first.ran.stderr);
  const added = (await first.calls("hc")).find((args) => args[1] === "add");
  const via = added[added.indexOf("--via") + 1];
  assert.equal(sshMarks(via).length, sshMarks(route).length);
  assert.equal(via.split(KEY_WORDS).length - 1, sshMarks(via).length);
  const pushed = await first.calls("ssh");
  assert.ok(pushed.some((call) => call.includes("ada@10.0.0.7")));
  for (const call of pushed) assert.equal(call.join(" ").includes("id_ed25519_kanso"), false, call.join(" "));
  const again = await runSh(t, signInTab({ name: "grey", via: true, target: via }).argv);
  assert.equal(again.ran.code, 0, again.ran.stderr);
  const readded = (await again.calls("hc")).find((args) => args[1] === "add");
  assert.equal(readded[readded.indexOf("--via") + 1], via);
  for (const call of await again.calls("ssh")) assert.equal(call.join(" ").includes("id_ed25519_kanso"), false);
});

test("Signing in on a local-first route asks on the local network first, and finishes there when the away route does not answer", { skip: shForm }, async (t) => {
  const { planFor } = await reach();
  const { signInTab } = await signIn();
  const away = "ada@grey";
  const plan = planFor({
    peer: { name: "grey", ip: "100.64.9.9", tailscaleSsh: false },
    target: away,
    lan: "10.99.0.1",
  }, {});
  assert.deepEqual([plan.lan, plan.user, plan.via], ["10.99.0.1", "ada", ""]);
  const { lanRecord } = await load("kanso-computers/lan-route.js", ["lanRecord"]);
  const built = lanRecord({ name: plan.name, target: plan.target, via: "" }, plan.lan, { user: plan.user });
  const tab = signInTab({ name: built.name, target: built.target, via: built.via });
  const script = tab.argv[2];
  const ask = script.split("\n").find((line) => line.includes("PasswordAuthentication"));
  const lanAt = ask.indexOf("HostName=10.99.0.1");
  const split = ask.indexOf("|| exec");
  assert.ok(lanAt > 0 && split > lanAt, ask);
  const first = ask.slice(0, lanAt);
  assert.ok(first.includes(ASK), first);
  assert.equal(ask.includes(ACCEPT_NEW), false, ask);
  assert.ok(first.includes("-o ConnectTimeout=2"), first);
  assert.equal(first.includes("BatchMode"), false, first);
  assert.ok(ask.slice(split).includes(away), ask);
  const sshBody = [
    "lan=",
    "batch=",
    "for arg in \"$@\"; do",
    "  case \"$arg\" in",
    "    *BatchMode*) batch=yes ;;",
    "    *HostName=10.99.0.1*) lan=yes ;;",
    "  esac",
    "done",
    "if [ -n \"$lan\" ] && [ -z \"$batch\" ]; then exit 0; fi",
    "printf '%s\\n' refused >&2",
    "exit 1",
  ].join("\n");
  const { ran, calls } = await runSh(t, tab.argv, { sshBody });
  endsDone(ran);
  const pushed = await calls("ssh");
  assert.equal(pushed.length, 1, pushed.map((call) => call.join(" ")).join("\n"));
  const ssh = pushed[0];
  assert.ok(ssh.join(" ").includes(ASK), ssh.join(" "));
  assert.ok(ssh.includes("ConnectTimeout=2"), ssh.join(" "));
  assert.equal(ssh.join(" ").includes("BatchMode"), false, ssh.join(" "));
  assert.ok(ssh.includes("HostName=10.99.0.1"));
  assert.ok(ssh.at(-1).includes(PUB), ssh.at(-1));
  const added = (await calls("hc")).find((args) => args.includes("--via"));
  const via = added[added.indexOf("--via") + 1];
  assert.ok(via.includes(KEY_WORDS), via);
  assert.ok(via.includes("HostName=10.99.0.1"), via);
  assert.ok(via.includes(away), via);
});

test("A route that is not the local-first shape has no local part", async () => {
  const { lanParts } = await signIn();
  assert.equal(lanParts("ssh ada@box"), null);
  assert.equal(lanParts("fly ssh console -a app --pty=false -C"), null);
  assert.equal(lanParts(""), null);
});

test("A Tailscale route, a route that is not ssh, a fly route, and a Windows route open Herdr's login; a Windows computer quotes the password ask and adds the key only after that add", async () => {
  const { signInTab } = await signIn();
  const { psQuote } = await quote();
  const login = (row, platform) => clone(signInTab(row, platform).argv);
  assert.deepEqual(login({ name: "grey", target: "root@100.64.1.2", via: "/usr/local/bin/tailscale ssh root@100.64.1.2" }), ["hc", "machine", "login", "grey"]);
  assert.deepEqual(login({ name: "grey", target: "ada@box", via: "wsl.exe -d Ubuntu -e sh -c" }), ["hc", "machine", "login", "grey"]);
  assert.deepEqual(login({ name: "grey", target: "box", via: "fly ssh console -a app --pty=false -C" }), ["hc", "machine", "login", "grey"]);
  assert.deepEqual(login({ name: "grey", target: "ada@box", via: "ssh ada@box" }, "windows"), ["hc", "machine", "login", "grey"]);
  const script = signInTab({ name: "grey", target: "O'Brien@box", via: false }, "windows").argv[3];
  const keyed = viaOf("O'Brien@box");
  const add = ["machine", "add", "--via"].map(psQuote).join(" ");
  const named = ["--name", "grey", "--install"].map(psQuote).join(" ");
  assert.ok(script.startsWith("$PSNativeCommandArgumentPassing = 'Legacy'"));
  const password = script.split("; ").find((line) => line.includes("$said = ssh"));
  assert.ok(password.includes(`${ASK} 'O''Brien@box'`), password);
  assert.equal(password.includes(ACCEPT_NEW), false, password);
  assert.ok(script.includes(`$via = ${psQuote(keyed)}`), script);
  assert.ok(script.includes(`& hc ${add} $via ${named}`), script);
  assert.match(script, /if \(\$LASTEXITCODE -ne 0\) \{[^}]*exit 1 \}; Write-Host ''; Write-Host 'Done: this tab can close\.'$/);
  assert.equal(script.split("Done: this tab can close.").length, 2);
  assert.equal(script.includes("--json"), false);
});

const KEY_MACHINE = { name: "grey", target: "ada@box" };
const AGENT_WORDS = agentWords(KEY_MACHINE.name);
const AGENT_ED = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureAgentEd";
const AGENT_EC = "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYFixtureAgentEc";
const AGENT_KEYS = [AGENT_EC, AGENT_ED].map((key) => key + " agent comment");
const AGENT_LINE = AGENT_ED + " kanso";
const REMOTE_SHELL = 'exec sh -c "$last"';
const authorizedFile = (home) => join(home, ".ssh", "authorized_keys");
const checkAgentPush = ([push, probe]) => {
  assert.ok(push.at(-1).includes(AGENT_LINE));
  assert.deepEqual(probe, [...AGENT_WORDS.split(" "), KEY_MACHINE.target, "true"]);
};

test("Signing in prefers an agent's Ed25519 key, saves only its public key, and checks the new route before adding it", { skip: shForm }, async (t) => {
  const { keySetup } = await signIn();
  const { home, key, ran, calls } = await runSh(t, keySetup(KEY_MACHINE), { agentKeys: AGENT_KEYS });
  endsDone(ran);
  const agent = agentFile(home, KEY_MACHINE.name);
  assert.equal(await readFile(agent + ".pub", "utf8"), AGENT_LINE + "\n");
  await assert.rejects(readFile(agent), { code: "ENOENT" });
  await assert.rejects(readFile(key + ".pub"), { code: "ENOENT" });
  assert.deepEqual(await calls("ssh-keygen"), []);
  const ssh = await calls("ssh");
  assert.equal(ssh.length, 2);
  checkAgentPush(ssh);
  assert.deepEqual(await calls("hc"), [["machine", "add", "--via", keyedMachine(AGENT_WORDS).via, "--name", KEY_MACHINE.name, "--install"]]);
});

test("Signing in keeps a public key already held by the agent, even when the agent has a preferred key", { skip: shForm }, async (t) => {
  const { keySetup } = await signIn();
  const existing = AGENT_EC + " existing comment\n";
  const { home, ran, calls } = await runSh(t, keySetup(KEY_MACHINE), { agentKeys: AGENT_KEYS },
    (fixture) => writeFile(agentFile(fixture.home, KEY_MACHINE.name) + ".pub", existing));
  endsDone(ran);
  assert.equal(await readFile(agentFile(home, KEY_MACHINE.name) + ".pub", "utf8"), existing);
  assert.deepEqual(await calls("ssh-keygen"), []);
  assert.ok((await calls("ssh"))[0].at(-1).includes(AGENT_EC + " kanso"));
});

test("Signing in makes its own key when ssh-add cannot list any agent keys", { skip: shForm }, async (t) => {
  const { keySetup } = await signIn();
  const { key, ran, calls } = await runSh(t, keySetup(KEY_MACHINE));
  endsDone(ran);
  assert.deepEqual(await calls("ssh-add"), [["-L"]]);
  assert.deepEqual(await calls("ssh-keygen"), [["-q", "-t", "ed25519", "-N", "", "-C", "kanso", "-f", key]]);
  assert.equal(await readFile(key + ".pub", "utf8"), PUB + "\n");
  assert.equal((await calls("ssh")).length, 1);
});

test("If the agent key cannot sign in on its own, the tab says so and pushes a new key after filtering out the exact agent line", { skip: shForm }, async (t) => {
  const { keySetup } = await signIn();
  const { ran, calls } = await runSh(t, keySetup(KEY_MACHINE), { agentKeys: AGENT_KEYS, probeCode: 255, sshOut: "kanso-added" });
  endsDone(ran);
  assert.match(ran.stdout, /The key in your ssh agent did not open grey on its own, so kansō makes its own key and asks once more\./);
  assert.equal((await calls("ssh-keygen")).length, 1);
  const ssh = await calls("ssh");
  assert.equal(ssh.length, 3);
  checkAgentPush(ssh);
  const fallback = ssh[2].at(-1);
  const filter = fallback.indexOf("grep -vxF '" + AGENT_LINE + "' ~/.ssh/authorized_keys > ");
  const append = fallback.indexOf(">> ~/.ssh/authorized_keys");
  assert.ok(filter >= 0 && append > filter && fallback.includes(PUB), fallback);
});

test("The key push appends new key material but keeps an existing line with the same material and a different comment", { skip: shForm }, async (t) => {
  const { keySetup } = await signIn();
  const other = AGENT_LINE + "\n";
  const alreadyThere = PUB.replace(/ kanso$/, " a different comment") + "\n";
  for (const [existing, expected] of [[other, other + "\n" + PUB + "\n"], [alreadyThere, alreadyThere]]) {
    const { home, ran, calls } = await runSh(t, keySetup(KEY_MACHINE), { sshBody: REMOTE_SHELL },
      ({ home }) => writeFile(authorizedFile(home), existing));
    endsDone(ran);
    const command = (await calls("ssh"))[0].at(-1);
    assert.ok(command.includes("grep -qF '" + PUB.split(" ")[1] + "' ~/.ssh/authorized_keys ||"), command);
    assert.equal(await readFile(authorizedFile(home), "utf8"), expected);
  }
});

const KEY_ACTIONS = "kanso-spaces/sign-in.js";
const routeWith = (words, target) => "ssh " + words + " " + target;
const keyedMachine = (words = KEY_WORDS) => ({ ...KEY_MACHINE, via: routeWith(words, KEY_MACHINE.target) });
const checkRemovalCall = async (calls) => {
  assert.deepEqual(await calls("herdr-app"), [["do", "kanso-spaces.remove-machine:grey"]]);
};
const withAgentPub = ({ key }) => writeFile(key + ".pub", AGENT_KEYS[1] + "\n");

test("Removing a key uses the exact kansō line and removes the computer only after SSH reports removal, on either saved route", { skip: shForm }, async (t) => {
  const { keyRemoval, removeKeyTab } = await load(KEY_ACTIONS, ["keyRemoval", "removeKeyTab"]);
  for (const words of [KEY_WORDS, OLD_KEY_WORDS]) {
    const machine = keyedMachine(words);
    const argv = keyRemoval(machine);
    assert.deepEqual(clone(removeKeyTab(machine)), { argv: clone(argv), place: "right" });
    const { home, env, ran, calls } = await runSh(t, argv, { sshOut: "removed" }, withAgentPub);
    endsDone(ran);
    assert.match(ran.stdout, /Removed this computer's key from grey\./);
    await checkRemovalCall(calls);
    const ssh = await calls("ssh");
    assert.equal(ssh.length, 1);
    assert.deepEqual(ssh[0].slice(0, -1), [...KEY_WORDS.split(" "), machine.target]);
    const kept = AGENT_KEYS[1] + "\n" + PUB + "\n";
    await writeFile(authorizedFile(home), kept + AGENT_LINE + "\n");
    const remote = await exec("sh", ["-c", ssh[0].at(-1)], { env });
    assert.equal(remote.code, 0, remote.stderr);
    assert.equal(remote.stdout, "removed\n");
    assert.equal(await readFile(authorizedFile(home), "utf8"), kept);
  }
});

for (const [reason, options, prepare, code, said] of [
  ["the key is absent there", { sshOut: "absent" }, withAgentPub, 0, /nothing was removed there/],
  ["the computer does not answer", { sshCode: 255 }, withAgentPub, 1, /did not answer with the key/],
  ["there is no local public key", {}, undefined, 1, /has no kansō key/],
]) {
  test("Removing a key keeps the computer listed when " + reason, { skip: shForm }, async (t) => {
    const { keyRemoval } = await load(KEY_ACTIONS, ["keyRemoval"]);
    const { ran, calls } = await runSh(t, keyRemoval(keyedMachine()), options, prepare);
    assert.equal(ran.code, code);
    assert.match(ran.stdout, said);
    assert.equal((await calls("ssh")).length, prepare ? 1 : 0);
    assert.deepEqual(await calls("herdr-app"), []);
  });
}

test("Both saved kansō key routes are recognized but a plain SSH route is not", async () => {
  const { kansoKeyed } = await load(KEY_ACTIONS, ["kansoKeyed"]);
  for (const words of [KEY_WORDS, OLD_KEY_WORDS]) assert.equal(kansoKeyed(keyedMachine(words).via), true);
  assert.equal(kansoKeyed("ssh ada@box"), false);
});

test("Signing in through an old local-first key route rewrites each SSH to the new identity option exactly once", { skip: shForm }, async (t) => {
  const { signInTab } = await signIn();
  const legacy = LOCAL_FIRST.replaceAll("ssh ", "ssh " + OLD_KEY_WORDS + " ");
  const { ran, calls } = await runSh(t, signInTab({ ...KEY_MACHINE, via: legacy }).argv);
  endsDone(ran);
  const added = (await calls("hc")).find((args) => args[1] === "add");
  const via = added[added.indexOf("--via") + 1];
  assert.equal(via, LOCAL_FIRST.replaceAll("ssh ", "ssh " + KEY_WORDS + " "));
  assert.ok(!via.includes("-i " + KEY_PATH));
});

const windowsScript = ([program, profile, command, script]) => {
  assert.deepEqual([program, profile, command], ["powershell", "-NoProfile", "-Command"]);
  return script;
};

test("The Windows key setup checks its agent, probes without prompting, and generates and pushes a key again on failure", async () => {
  const { keySetup } = await signIn();
  const argv = keySetup(KEY_MACHINE, { platform: "windows" });
  const script = windowsScript(argv);
  for (const name of ["Get-Agent", "Get-Pair($f)", "Test-Held", "Select-Agent", "New-Own", "Read-Key($f)", "Send-Key"]) {
    assert.ok(script.includes("function " + name));
  }
  assert.ok(script.includes("ssh-add -L"));
  assert.ok(script.includes(`${AGENT_WORDS} '${KEY_MACHINE.target}' true`));
  assert.match(script, /Read-Key \$g; Send-Key; ssh [^;]+; if \(\$LASTEXITCODE -eq 0\) \{ \$via = /);
  assert.match(script, /else \{ Write-Host 'The key in your ssh agent[^;]+;[^}]+New-Own; Read-Key \$k;[^}]+\}; Send-Key; \$via = /);
  for (const words of [AGENT_WORDS, KEY_WORDS]) assert.ok(script.includes(`$via = '${keyedMachine(words).via}'`));
});

test("The Windows key removal uses the saved public key and removes the computer only after SSH reports removal", async () => {
  const { keyRemoval } = await load(KEY_ACTIONS, ["keyRemoval"]);
  const argv = keyRemoval(keyedMachine(OLD_KEY_WORDS), "windows");
  const script = windowsScript(argv);
  assert.ok(script.includes("function Get-Pair($f)"));
  assert.ok(script.includes("$f = $k"));
  assert.ok(script.includes("$line = (Get-Pair $f) + ' kanso'"));
  assert.ok(script.includes(KEY_WORDS));
  assert.match(script, /-ne 'removed'\) \{[^}]+exit 0 \}; & herdr-app do 'kanso-spaces\.remove-machine:grey'/);
});

const twoAgentComputers = async (t, { betaFallback = false, betaKeys = AGENT_KEYS } = {}) => {
  const { keySetup } = await signIn();
  const sshBody = [
    "for arg do",
    '  case "$arg" in alpha|beta) host=$arg ;; IdentityFile=*) identity=${arg#IdentityFile=} ;; esac',
    "done",
    '[ -n "$host" ] || exit 1',
    'remote="$TMPDIR/$host"',
    'if [ "$batch" = yes ]; then',
    '  if [ "$host/$last" = beta/true ] && [ "$BETA_FALLBACK" = yes ]; then exit 255; fi',
    '  file="$HOME/.ssh/${identity##*/}.pub"',
    '  [ -s "$file" ] || exit 255',
    '  key=$(awk \'{ print $2 }\' "$file")',
    '  grep -qF "$key" "$remote/.ssh/authorized_keys" || exit 255',
    "fi",
    'HOME="$remote" ' + REMOTE_SHELL,
  ].join("\n");
  const { bin, env, home } = await keyBin(t, { agentKeys: AGENT_KEYS, sshBody });
  const [alpha, beta] = ["alpha", "beta"].map((name) => ({ name, target: name }));
  const setup = async (machine, options) => {
    await mkdir(join(env.TMPDIR, machine.name));
    endsDone(await runKeyScript(keySetup(machine), { ...env, ...options }));
  };
  await setup(alpha);
  if (betaKeys !== AGENT_KEYS) await writeStub(bin, "ssh-add", agentListing(betaKeys));
  await setup(beta, { BETA_FALLBACK: betaFallback ? "yes" : "no" });
  const [[, , , alphaVia], [, , , betaVia]] = await callsOf(bin, "hc");
  return { alpha, beta, alphaVia, betaVia, env, home };
};

test("An agent route still opens its computer after another computer falls back to a generated key", { skip: shForm }, async (t) => {
  const { keyRemoval } = await load(KEY_ACTIONS, ["keyRemoval"]);
  const { alpha, beta, alphaVia, betaVia, env } = await twoAgentComputers(t, { betaFallback: true });
  const removed = await runKeyScript(keyRemoval({ ...alpha, via: alphaVia }), env);
  endsDone(removed);
  assert.equal(alphaVia, routeWith(agentWords(alpha.name), alpha.target));
  assert.equal(betaVia, viaOf(beta.target));
  const alphaKeys = await readFile(authorizedFile(join(env.TMPDIR, alpha.name)), "utf8");
  assert.equal(alphaKeys.trim(), "");
});

test("Alpha keeps its original agent public key and saved route after Beta signs in with a different agent key", { skip: shForm }, async (t) => {
  const { alpha, beta, alphaVia, betaVia, env, home } = await twoAgentComputers(t, { betaKeys: [AGENT_KEYS[0]] });
  const probe = await runKeyScript(["sh", "-c", alphaVia + " true"], env);
  assert.equal(probe.code, 0, probe.stderr);
  const [alphaPub, betaPub] = await Promise.all([alpha, beta].map(({ name }) => readFile(agentFile(home, name) + ".pub", "utf8")));
  assert.deepEqual([alphaPub.trim(), betaPub.trim()], [AGENT_LINE, AGENT_EC + " kanso"]);
  for (const [machine, via] of [[alpha, alphaVia], [beta, betaVia]]) {
    assert.equal(via, routeWith(agentWords(machine.name), machine.target));
  }
});

test("Successful removal deletes only the local agent public key named in the saved route", { skip: shForm }, async (t) => {
  const { keyRemoval } = await load(KEY_ACTIONS, ["keyRemoval"]);
  const suffix = "saved_grey";
  const agentMachine = keyedMachine(agentWords(suffix));
  for (const machine of [keyedMachine(), agentMachine]) {
    const agent = machine === agentMachine;
    const { home, key, ran } = await runSh(t, keyRemoval(machine), { sshBody: REMOTE_SHELL }, async (fixture) => {
      await Promise.all([
        writeFile(fixture.key + ".pub", PUB + "\n"),
        writeFile(agentFile(fixture.home, suffix) + ".pub", AGENT_LINE + "\n"),
        writeFile(authorizedFile(fixture.home), [AGENT_LINE, PUB, ""].join("\n")),
      ]);
    });
    endsDone(ran);
    assert.match(ran.stdout, /Removed this computer's key/);
    assert.equal(await readFile(key + ".pub", "utf8"), PUB + "\n");
    const agentPub = readFile(agentFile(home, suffix) + ".pub", "utf8");
    if (agent) await assert.rejects(agentPub, { code: "ENOENT" });
    else assert.equal(await agentPub, AGENT_LINE + "\n");
    assert.equal(await readFile(authorizedFile(home), "utf8"), (agent ? PUB : AGENT_LINE) + "\n");
  }
});

test("Windows emits PowerShell if and else branches without a semicolon between them", async () => {
  const { keySetup } = await signIn();
  const script = windowsScript(keySetup(KEY_MACHINE, { platform: "windows" }));
  assert.doesNotMatch(script, /\};\s*else\b/i);
});

const withoutBlankLines = [
  'sh -c "$last" || exit $?',
  'file="$HOME/.ssh/authorized_keys"',
  'sed \'/^$/d\' "$file" > "$file.compact" && mv "$file.compact" "$file"',
].join("\n");

for (const [description, existing, sshBody, expected] of [
  ["keeps a pre-existing agent line", AGENT_LINE + "\n" + AGENT_KEYS[0] + "\n", REMOTE_SHELL, [AGENT_LINE, AGENT_KEYS[0], PUB]],
  ["removes the agent line it appended even when it is the only line", "", withoutBlankLines, [PUB]],
]) {
  test("A failed agent probe " + description, { skip: shForm }, async (t) => {
    const { keySetup } = await signIn();
    const options = { agentKeys: AGENT_KEYS, probeCode: 255, sshBody };
    const { home, ran } = await runSh(t, keySetup(KEY_MACHINE), options,
      (fixture) => writeFile(authorizedFile(fixture.home), existing));
    endsDone(ran);
    assert.match(ran.stdout, /did not open grey on its own/);
    const content = await readFile(authorizedFile(home), "utf8");
    assert.deepEqual(content.split("\n").filter(Boolean), expected);
  });
}

test("Removing a key fails and explains that Herdr still lists the computer when Herdr refuses the removal", { skip: shForm }, async (t) => {
  const { keyRemoval } = await load(KEY_ACTIONS, ["keyRemoval"]);
  const { home, ran, calls } = await runSh(t, keyRemoval(keyedMachine()), { appCode: 1, sshBody: REMOTE_SHELL }, async (fixture) => {
    await withAgentPub(fixture);
    await writeFile(authorizedFile(fixture.home), AGENT_LINE + "\n");
  });
  assert.equal(ran.code, 1);
  assert.match(ran.stdout, /Herdr still lists grey: remove it from the sidebar\./);
  assert.doesNotMatch(ran.stdout, /Done:/);
  await checkRemovalCall(calls);
  assert.equal(await readFile(authorizedFile(home), "utf8"), "");
});

test("The duplicate guard detects no repeated code in the sign-in scripts", async () => {
  const files = await scannedFiles();
  const baseline = JSON.parse(await readFile(new URL("../kanso/dupes-baseline.json", import.meta.url), "utf8"));
  const { added, gone } = compare(scan(files).windows, baseline);
  assert.deepEqual([...added, ...gone].filter(({ file }) => basename(file) === "sign-in.js"), []);
});

test("A refusal says what to do: the password, Remote Login, Tailscale SSH, or access controls", async () => {
  const { advice, ACCESS_CONTROLS } = await reach();
  const password = advice("password", { name: "grey" });
  assert.match(password.text, /password/);
  assert.equal(password.fix, "Enter the password");
  const mac = advice("closed", { name: "grey", os: "macos" });
  assert.match(mac.text, /Remote Login/);
  assert.equal(mac.fix, "Retry");
  const linux = advice("closed", { name: "grey", os: "linux", tailnet: true });
  assert.equal(linux.command, "sudo tailscale set --ssh");
  assert.equal(linux.fix, "Retry");
  const elsewhere = advice("closed", { name: "grey", os: "linux" });
  assert.match(elsewhere.text, /ssh server/);
  assert.equal(elsewhere.command, undefined);
  const down = advice("unreachable", { name: "grey" });
  assert.match(down.text, /doesn't answer/);
  assert.equal(down.fix, "Retry");
  assert.equal(down.url, undefined);
  const blocked = advice("unreachable", { name: "grey", tailnet: true });
  assert.equal(blocked.fix, "Open access controls");
  assert.equal(blocked.url, ACCESS_CONTROLS);
  assert.match(blocked.text, /access controls/);
  const onTailnet = advice("hostkey", { name: "grey", tailnet: true });
  assert.equal(onTailnet.fix, "Forget the old key");
  assert.equal(onTailnet.command, undefined);
  const off = advice("hostkey", { name: "grey" });
  assert.equal(off.command, "ssh-keygen -R grey");
  assert.equal(off.fix, "Retry");
});

test("A computer already added is known by its name, its target, its address, or an address inside via", async () => {
  const { isAdded } = await reach();
  const added = [
    { name: "grey", target: "ada@100.64.1.2", via: "" },
    { name: "jump", target: "jump.example", via: "ssh -J bastion 10.1.2.3" },
  ];
  assert.equal(isAdded(added, { name: "grey" }), true);
  assert.equal(isAdded(added, { target: "jump.example" }), true);
  assert.equal(isAdded(added, { ip: "100.64.1.2" }), true, "user@ip");
  assert.equal(isAdded(added, { ip: "10.1.2.3" }), true, "an address inside via");
  assert.equal(isAdded(added, { name: "nope", target: "nope", ip: "9.9.9.9" }), false);
  assert.equal(isAdded(null, { name: "grey" }), false);
  const near = [{ name: "near", target: "near", via: "ssh root@100.1.2.30" }];
  assert.equal(isAdded(near, { ip: "100.1.2.3" }), false, "100.1.2.3 is not 100.1.2.30");
  assert.equal(isAdded(near, { ip: "100.1.2.30" }), true, "the address inside via still matches");
});

test("An Include line may quote a path or name several files", async () => {
  const { includesOf } = await reach();
  const text = configText([
    "Include \"quoted path\" other.conf",
    "Include one.conf two.conf",
  ]);
  assert.deepEqual(clone(includesOf(text)), ["quoted path", "other.conf", "one.conf", "two.conf"]);
});

test("ssh config hosts skip a pattern and a Match block, keep a duplicate alias once, and attach HostName and User to that host", async () => {
  const { sshConfigHosts } = await reach();
  const text = configText();
  assert.deepEqual(clone(sshConfigHosts(text)), [
    { alias: "grey", hostname: "100.64.1.2", user: "root" },
    { alias: "box", hostname: "10.0.0.2", user: "ada" },
  ]);
});

test("When a tailnet computer does not answer, Open access controls opens Tailscale's page", async () => {
  const opened = [];
  const { Computers } = await load("kanso-computers/main.js", ["Computers"], gpuiHost());
  const { ACCESS_CONTROLS } = await reach();
  const view = new Computers();
  const job = { phase: "failed", reach: "unreachable", words: "cannot reach grey: no answer within 20 s", choice: {}, plan: {} };
  const ink = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? "#112233" : undefined) });
  const drawn = view.failure("grey", job, ink, { name: "grey", tailnet: true });
  const fix = find(drawn, (el) => el.tag === "computer-fail-grey-fix");
  assert.ok(fix);
  fix.calls.find((call) => call[0] === "on_click")[1]({}, { open_url: (url) => opened.push(url) });
  assert.deepEqual(opened, [ACCESS_CONTROLS]);
  assert.equal(job.phase, "failed", "opening the page does not add the computer");
});

test("A typed ssh option, a blank, or a space is not a computer, and a host with a port is", async () => {
  const { validTarget } = await reach();
  for (const bad of ["-V", "-oProxyCommand=x", "user@-x", "", " ", "grey box"]) {
    assert.equal(validTarget(bad), false, JSON.stringify(bad));
  }
  for (const good of ["grey", "root@100.1.2.3", "can@10.0.0.7:2222"]) {
    assert.equal(validTarget(good), true, good);
  }
});

test("A typed port reaches ssh as -p, and an IPv6 address is not read as a port", async () => {
  const { destinationOf, probeArgs } = await reach();
  const options = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", ACCEPT_NEW, "-o", UNIX_PROBE_HOSTS, "-o", "GlobalKnownHostsFile=/etc/ssh/ssh_known_hosts /etc/ssh/ssh_known_hosts2 ~/.ssh/known_hosts ~/.ssh/known_hosts2"];
  assert.deepEqual(clone(destinationOf("can@10.0.0.7:2222")), { dest: "can@10.0.0.7", port: "2222" });
  assert.deepEqual(clone(probeArgs("can@10.0.0.7:2222")), [...options, "-p", "2222", "--", "can@10.0.0.7", "true"]);
  assert.deepEqual(clone(destinationOf("[fe80::1]:2222")), { dest: "fe80::1", port: "2222" });
  assert.deepEqual(clone(probeArgs("[fe80::1]:2222")), [...options, "-p", "2222", "--", "fe80::1", "true"]);
  assert.deepEqual(clone(destinationOf("fe80::1")), { dest: "fe80::1", port: "" });
  const bare = probeArgs("fe80::1");
  assert.equal(bare.includes("-p"), false);
  assert.deepEqual(clone(bare), [...options, "--", "fe80::1", "true"]);
});

test("An ssh config host is the tailnet computer when HostName is its address, its name, or its name with a suffix, or when the alias is the name", async () => {
  const { aliasOf } = await reach();
  const peer = { name: "grey", ip: "100.64.1.2" };
  assert.equal(aliasOf(peer, [{ alias: "build", hostname: "100.64.1.2", user: "deploy" }]).alias, "build");
  assert.equal(aliasOf(peer, [{ alias: "build", hostname: "grey", user: "deploy" }]).alias, "build");
  assert.equal(aliasOf(peer, [{ alias: "build", hostname: "grey.tail.ts.net", user: "deploy" }]).alias, "build");
  assert.equal(aliasOf(peer, [{ alias: "grey", hostname: "", user: "deploy" }]).alias, "grey");
  assert.equal(aliasOf(peer, [{ alias: "other", hostname: "10.0.0.9", user: "ada" }]), null);
  assert.equal(aliasOf(peer, [{ alias: "other", hostname: "", user: "ada" }]), null);
});

test("A typed user keeps the ssh name, and Tailscale SSH still uses the address", async () => {
  const { planFor } = await reach();
  const peer = { name: "grey", ip: "100.64.1.2", tailscaleSsh: false };
  const folded = { alias: "build", hostname: peer.ip, user: "deploy" };
  const bare = { ...folded, alias: "grey", hostname: "" };
  const expected = { name: "grey", via: "", probe: true, also: [`deploy@${peer.ip}`] };
  assert.deepEqual(clone(planFor({ peer, target: "", alias: folded })), { ...expected, target: "build" });
  assert.deepEqual(clone(planFor({ peer, target: "", alias: bare })), { ...expected, target: "grey" });
  const typed = "root@grey";
  assert.deepEqual(clone(planFor({ peer, target: typed, alias: bare })), { ...expected, target: typed, also: [`root@${peer.ip}`] });
  assert.deepEqual(clone(planFor({ peer: { ...peer, tailscaleSsh: true }, target: "", alias: folded }, { tailscale: "/usr/bin/tailscale" })), {
    name: "grey", target: "100.64.1.2", via: "/usr/bin/tailscale ssh 100.64.1.2", probe: false,
  });
});

test("A computer that accepts only a key offers Sign in, and mentions the passphrase", async () => {
  const { reachOf, advice } = await reach();
  const said = (stderr) => reachOf({ code: 1, stdout: "", stderr });
  assert.equal(said("Permission denied (publickey)."), "keyonly");
  assert.equal(said("Permission denied (publickey,password)."), "password");
  const keyonly = advice("keyonly", { name: "grey" });
  assert.match(keyonly.text, /keys only/);
  assert.match(keyonly.text, /passphrase/);
  assert.equal(keyonly.fix, "Sign in");
  assert.doesNotMatch(keyonly.text, /password/i);
});

test("A computer saved with hc, and not on the tailnet or in ssh config, shows under Added, and Close dismisses the dialog", async () => {
  const closed = [];
  const asked = [];
  const { view } = await computersDialog({
    closeOverlay: (id) => closed.push(id),
    hc: async (args) => {
      asked.push(clone(args));
      return { code: 0, stdout: JSON.stringify({ machines: [{ name: "box", target: "ada@10.0.0.9", via: "" }] }), stderr: "" };
    },
  });
  view.net = { state: "Running", peers: [{ name: "grey", ip: "100.64.1.2", os: "linux", online: true, tailscaleSsh: false }] };
  view.hosts = [{ alias: "other", hostname: "10.0.0.8", user: "ada" }];
  const drawn = view.render();
  const words = texts(drawn);
  const heading = words.indexOf("Added");
  assert.deepEqual(asked, [["machine", "ls", "--json"]]);
  assert.equal(words[heading + 1], "box", words.join(" | "));
  assert.ok(words.indexOf("grey") < heading, "a peer is not filed under Added");
  assert.ok(words.indexOf("other") < heading, "an ssh host is not filed under Added");
  assert.equal(words.includes("Get Tailscale"), false);
  const close = find(drawn, (el) => el.tag === "kanso-computers-secondary");
  assert.ok(close);
  assert.equal(close.calls.find((call) => call[0] === "accessibility_label")[1], "Close");
  assert.deepEqual(closed, []);
  close.calls.find((call) => call[0] === "on_click")[1]({}, { stop_propagation() {} });
  assert.deepEqual(closed, ["computers-overlay"]);
});

test("When Tailscale is off, not installed, or has no other computer, Refresh probes again and shows the peers, keeping the typed address", async () => {
  const running = status({ grey: peer({}) });
  const notes = {
    "not installed": { code: 1, stdout: "", stderr: "missing" },
    off: { code: 0, stdout: status({}, "Stopped"), stderr: "" },
    "no other computer": { code: 0, stdout: status({}), stderr: "" },
  };
  const said = {
    "not installed": "Tailscale isn't on this computer. Where it is, your computers show up here by themselves.",
    off: "Tailscale is off on this computer. Turn it on and your computers show up here.",
    "no other computer": "No other computer is on your tailnet yet.",
  };
  for (const [name, first] of Object.entries(notes)) {
    const answer = { now: first };
    const asked = [];
    const { view, cx, flush } = await computersDialog({
      exec: async (program, args) => { asked.push([program, args]); return answer.now; },
      hc: async () => ({ code: 0, stdout: JSON.stringify({ machines: [] }), stderr: "" }),
    });
    const address = { text: "ada@10.0.0.9" };
    view.typed = { multiline: false, focused: false, state: {}, on() {}, focus() {}, release() {}, value: () => address.text, set_value(next) { address.text = next; } };
    const drawn = view.render();
    assert.ok(texts(drawn).includes(said[name]), name);
    const refresh = find(drawn, (el) => el.tag === "computers-tailnet-refresh");
    assert.ok(refresh, name);
    const before = asked.filter(([, args]) => args?.[0] === "status").length;
    answer.now = { code: 0, stdout: running, stderr: "" };
    refresh.calls.find((call) => call[0] === "on_click")[1]({}, cx);
    await flush();
    const words = texts(view.render());
    assert.ok(asked.filter(([, args]) => args?.[0] === "status").length > before, `${name}: Refresh probes Tailscale again`);
    assert.ok(words.includes("grey") && words.includes("On your tailnet"), words.join(" | "));
    assert.equal(view.typed.value(), "ada@10.0.0.9");
    assert.equal(address.text, "ada@10.0.0.9");
  }
});

const darkIp = "100.69.99.51";
const darkHost = "dark";
const darkName = `jj@${darkHost}`;
const darkAddress = `jj@${darkIp}`;
const darkMissing = `Could not resolve hostname ${darkHost}`;
const darkDenied = "Permission denied (publickey).";
const sshRefusal = (stderr) => ({ code: 255, stderr, stdout: "" });
const addressAnswers = (failure) => (target) => target === darkAddress ? success("") : sshRefusal(failure);

const addTypedDark = async (answer, { typed = darkName, addError = null } = {}) => {
  const probes = [];
  const added = [];
  const tabs = [];
  const tailnet = status({ dark: peer({ DNSName: "dark.tail.ts.net.", HostName: "dark", TailscaleIPs: [darkIp], sshHostKeys: [] }) });
  const { view, cx, flush } = await computersDialog({
    window: () => ({ platform: "linux" }),
    InputState: { new: () => fieldWith({ value: typed }) },
    readTextFile: async () => `Host ${darkHost}\n  HostName ${darkIp}\n  User jj\n  IdentityFile ~/.ssh/dark_key\n  IdentityAgent ~/.ssh/dark_agent\n`,
    run: (command, props) => { if (command === "tab.new") tabs.push(props); },
    exec: async (program, args) => {
      if (program === "tailscale") return success(tailnet);
      if (program !== "ssh") return success("");
      const target = args.at(-2);
      probes.push(target);
      return answer(target);
    },
    hc: async (args) => {
      if (args[1] !== "add") return success(JSON.stringify({ machines: [] }));
      added.push(args[2]);
      return addError ?? success("");
    },
  });
  const button = find(view.render(), (el) => el.tag === "computers-add-typed");
  arg(button, "on_click")({}, cx);
  await flush();
  return { probes, added, tabs, cx, drawn: view.render() };
};

const checkDarkFallback = ({ probes, added }, first = darkName) => {
  assert.deepEqual(probes, [first, darkAddress]);
  assert.deepEqual(added, [darkAddress]);
};

test("Typing an ssh name for a Tailscale computer checks and adds that name from your ssh config", async () => {
  const { probes, added } = await addTypedDark((target) => target === darkName
    ? success("") : sshRefusal(darkDenied));
  assert.deepEqual(probes, [darkName]);
  assert.deepEqual(added, [darkName]);
});

test("When the typed name does not answer, Add a computer tries and adds its Tailscale address", async () => {
  checkDarkFallback(await addTypedDark(addressAnswers(darkMissing)));
});

test("When the typed name refuses your key but the Tailscale address accepts it, the computer is added by its address", async () => {
  checkDarkFallback(await addTypedDark(addressAnswers(darkDenied)));
});

test("When adding by the Tailscale address asks for a password, the sign-in tab uses that address", async () => {
  const addError = sshRefusal(JSON.stringify({ error: { kind: "login_needed", message: "Login required" } }));
  const { added, tabs, cx, drawn } = await addTypedDark(addressAnswers(darkMissing), { addError });
  assert.deepEqual(added, [darkAddress]);
  const enterPassword = find(drawn, (el) => arg(el, "accessibility_label") === "Enter the password");
  assert.ok(enterPassword);
  arg(enterPassword, "on_click")({}, cx);
  assert.equal(tabs.length, 1);
  const ask = tabs[0].argv.at(-1).split("\n").find((line) => line.includes(ASK));
  assert.ok(ask?.includes(`${ASK} ${darkAddress} `), ask);
});

test("When you type only the computer name, its Tailscale address keeps the user from your ssh config", async () => {
  checkDarkFallback(await addTypedDark(addressAnswers(darkMissing), { typed: darkHost }), darkHost);
});

test("A failed typed attempt shows its message once, below the field and not on the Tailscale row", async () => {
  const { drawn } = await addTypedDark(() => sshRefusal(darkDenied));
  const message = (word) => word.includes("takes keys only");
  const words = texts(drawn);
  assert.equal(words.filter(message).length, 1);
  assert.ok(words.findIndex(message) > words.lastIndexOf("Add"));
  const list = find(drawn, (el) => arg(el, "id") === "computers-list");
  assert.equal(texts(list).some(message), false);
});

const lanDialog = async (t) => {
  const near = ["192.168.1.1", "192.168.1.3"];
  const rest = ["192.168.1.4", "192.168.1.5", "192.168.1.6"];
  const commands = {
    ifconfig: "inet 192.168.1.2 netmask 0xfffffff8",
    arp: [...near, "192.168.2.1", "192.168.1.2"].map((ip) => `? (${ip}) at aa:bb:cc:dd:ee:ff`).join("\n"),
  };
  const runLocal = t.mock.fn(async (program, args) => success(
    program === "sh" && args[1].includes("xargs") ? args.slice(3).join("\n") : commands[program] ?? "",
  ));
  const dialog = await computersDialog({ exec: runLocal, hc: async () => success('{"machines":[]}') }, true);
  const knocks = () => runLocal.mock.calls
    .map(({ arguments: args }) => args)
    .filter(([program, argv]) => program === "sh" && argv[1].includes("xargs"))
    .map(([, argv]) => Array.from(argv.slice(3)));
  return { ...dialog, near, rest, knocks, commands };
};

test("Opening Add a computer checks only the addresses already known on this network", async (t) => {
  const { near, knocks } = await lanDialog(t);
  assert.deepEqual(knocks(), [near]);
});

test("Search this network checks the whole network once and then is no longer offered", async (t) => {
  const { cx, flush, view, near, rest, knocks } = await lanDialog(t);
  const sweep = () => find(view.render(), (el) => el.tag === "computers-sweep");
  assert.ok(sweep(), "Search this network is offered after opening Add a computer");
  const before = knocks().length;
  arg(sweep(), "on_click")({}, cx);
  await flush();
  assert.deepEqual(knocks().slice(before), [near, rest]);
  assert.ok(!sweep(), "Search this network is no longer offered");
});

test("Two computer names that clean up to the same text keep separate agent key files", async () => {
  const { agentKey } = await load("kanso-computers/sign-in.js", ["agentKey"]);
  const names = ["my box", "my_box", "my-box", "my.box", "alpha"];
  assert.equal(new Set(names.map(agentKey)).size, names.length);
  assert.equal(agentKey("alpha"), "~/.ssh/id_kanso_agent_alpha");
  for (const name of names) assert.match(agentKey(name), /^~\/\.ssh\/id_kanso_agent_[\w-]+$/);
});

test("A later scan replaces what an earlier one found, so a computer that stopped answering leaves the list", async (t) => {
  const { cx, flush, view, near, commands } = await lanDialog(t);
  assert.deepEqual(clone(view.nearby.map((host) => host.ip)).toSorted(), near.toSorted());
  commands.arp = "";
  view.search(cx, false);
  await flush();
  assert.deepEqual(clone(view.nearby), []);
});

test("Signing in again to a computer takes off the kansō line of the key its saved route used when the key changes", async () => {
  const { signInTab } = await signIn();
  const via = "ssh -o IdentityFile=~/.ssh/id_kanso_agent_grey -o IdentitiesOnly=yes -o BatchMode=yes ada@box";
  const unix = signInTab({ name: "grey", target: via, via: true }).argv[2];
  assert.match(unix, /^prev=\$\(awk '\{ print \$1 " " \$2 " kanso" \}' "\$HOME"\/\.ssh\/id_kanso_agent_grey\.pub 2>\/dev\/null\)$/m);
  assert.match(unix, /replaced\(\) \{ \[ -z "\$prev" \] \|\| \[ "\$prev" = "\$pub" \] \|\| line=.*grep -vxF/);
  assert.match(unix, /lines "\$g" \|\| exit; replaced; push/);
  assert.match(signInTab({ name: "grey", target: "ada@box", via: false }).argv[2], /^prev=$/m);
  const windows = signInTab({ name: "grey", target: "ada@box", via: false }, "windows").argv.at(-1);
  assert.doesNotMatch(windows, /\$preumask/);
  assert.match(windows, /"\$\(\$pre\)umask 077;/);
});

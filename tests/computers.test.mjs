import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clone, computersDialog, exec, find, folderWith, gpuiHost, load, texts } from "./helpers.mjs";

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

test("A Tailscale SSH computer is reached through tailscale, and without it ssh goes to the address", async () => {
  const { planFor } = await reach();
  const choice = { peer: { name: "grey", ip: "100.64.1.2", tailscaleSsh: true }, target: "root@grey", name: "ignored" };
  assert.deepEqual(clone(planFor(choice, { tailscale: "/usr/local/bin/tailscale" })), {
    name: "grey", target: "root@100.64.1.2", via: "/usr/local/bin/tailscale ssh root@100.64.1.2", probe: false,
  });
  assert.deepEqual(clone(planFor(choice, { tailscale: "" })), {
    name: "grey", target: "root@100.64.1.2", via: "", probe: true,
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

test("A probe accepts the new host key and never asks for a password", async () => {
  const { probeArgs } = await reach();
  const args = probeArgs("ada@box");
  assert.ok(args.includes("BatchMode=yes"));
  assert.ok(args.includes("StrictHostKeyChecking=accept-new"));
  assert.equal(args.at(-2), "ada@box");
});

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
const KEY_WORDS = "-i ~/.ssh/id_ed25519_kanso -o IdentitiesOnly=yes -o BatchMode=yes";
const ASK = "-o PasswordAuthentication=yes -o KbdInteractiveAuthentication=yes -o StrictHostKeyChecking=accept-new";
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
const keyBin = async (t, { sshCode = 0, sshSaid = "", failVia = false, sshBody = "" } = {}) => {
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
  await writeStub(bin, "ssh", sshBody || `${sshSaid ? `printf '%s\\n' ${JSON.stringify(sshSaid)} >&2\n` : ""}exit ${sshCode}`);
  await writeStub(bin, "hc", failVia ? "if [ \"$1\" = machine ] && [ \"$2\" = add ] && [ \"$3\" = --via ]; then exit 1; fi\nexit 0" : "exit 0");
  await writeStub(bin, "herdr-app", "exit 0");
  return { bin, home, env: { PATH: `${bin}:/bin:/usr/bin`, HOME: home, TMPDIR: dir } };
};
const runSh = async (t, argv, options) => {
  const placed = await keyBin(t, options);
  const ran = await exec(argv[0], argv.slice(1), { env: placed.env });
  return { ...placed, ran, calls: (name) => callsOf(placed.bin, name) };
};
const viaOf = (dest, port = "") => `ssh ${KEY_WORDS}${port ? ` -p ${port}` : ""} ${dest}`;
const sshMarks = (text) => text.match(/(^|[\s'"])ssh (?=\S)/g) ?? [];

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
  const route = "sh -c 'ssh -o BatchMode=yes -o ConnectTimeout=2 -o StrictHostKeyChecking=accept-new ada@10.0.0.7 true >/dev/null 2>&1 && exec ssh -o StrictHostKeyChecking=accept-new ada@10.0.0.7 \"$1\"; exec ssh ada@10.0.0.9 \"$1\"' route";
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
  const away = "100.64.9.9";
  const plan = planFor({
    peer: { name: "grey", ip: away, tailscaleSsh: false },
    target: "ada@grey",
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
  const add = ["machine", "add", "--via", keyed, "--name", "grey", "--install"].map(psQuote).join(" ");
  assert.ok(script.startsWith("$PSNativeCommandArgumentPassing = 'Legacy'"));
  assert.ok(script.includes("StrictHostKeyChecking=accept-new 'O''Brien@box'"), script);
  assert.ok(script.includes(`& hc ${add}`), script);
  assert.match(script, /if \(\$LASTEXITCODE -ne 0\) \{[^}]*exit 1 \}; Write-Host ''; Write-Host 'Done: this tab can close\.'$/);
  assert.equal(script.split("Done: this tab can close.").length, 2);
  assert.equal(script.includes("--json"), false);
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
  const options = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new"];
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

test("A folded ssh alias is how the computer is reached, unless a user was typed or Tailscale SSH is on", async () => {
  const { planFor } = await reach();
  const peer = { name: "grey", ip: "100.64.1.2", tailscaleSsh: false };
  const folded = { alias: "build", hostname: "100.64.1.2", user: "deploy" };
  const bare = { alias: "grey", hostname: "", user: "deploy" };
  assert.deepEqual(clone(planFor({ peer, target: "", alias: folded })), { name: "grey", target: "build", via: "", probe: true });
  assert.deepEqual(clone(planFor({ peer, target: "", alias: bare })), { name: "grey", target: "deploy@100.64.1.2", via: "", probe: true });
  assert.deepEqual(clone(planFor({ peer, target: "root@grey", alias: folded })), { name: "grey", target: "root@100.64.1.2", via: "", probe: true });
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

// Adding a computer: who is on the tailnet, how ssh reaches them, and what a refusal means.
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clone, exec, find, gpuiHost, load, temporary } from "./helpers.mjs";

const reach = () => load("kanso-computers/reach.js", [
  "tailnet", "planFor", "choiceOf", "addArgs", "probeArgs", "reachOf", "keySetup", "advice", "isAdded",
  "sshConfigHosts", "includesOf", "ACCESS_CONTROLS",
]);
const quote = () => load("kanso-computers/platform-command.js", ["windowsArg", "psQuote"]);

const peer = (over = {}) => ({
  DNSName: "grey.tail.ts.net.", HostName: "grey", OS: "linux", Online: true,
  TailscaleIPs: ["100.64.1.2"], sshHostKeys: ["ssh-ed25519 AAAA"], ...over,
});
const status = (peers, state = "Running") => JSON.stringify({ BackendState: state, Peer: peers });
const names = (net) => net.peers.map((row) => row.name);

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
  const { tailnet } = await reach();
  const net = tailnet(status({
    zed: peer({ DNSName: "zed.tail.ts.net.", Online: false, TailscaleIPs: ["fd7a:115c:a1e0::9", "100.64.1.9"] }),
    ada: peer({ DNSName: "ada.tail.ts.net.", Online: true, TailscaleIPs: ["fd7a:115c:a1e0::1", "100.64.1.1"] }),
    amy: peer({ DNSName: "amy.tail.ts.net.", Online: false, TailscaleIPs: ["100.64.1.3"] }),
    bob: peer({ DNSName: "bob.tail.ts.net.", Online: true, TailscaleIPs: ["100.64.1.2"] }),
  }));
  assert.deepEqual(clone(names(net)), ["ada", "bob", "amy", "zed"]);
  assert.deepEqual(clone(net.peers.map((row) => row.online)), [true, true, false, false]);
  assert.equal(net.peers.find((row) => row.name === "ada").ip, "100.64.1.1", "IPv4 over IPv6");
  const labelled = tailnet(status({ box: peer({ DNSName: "Grey-Box.tail.ts.net.", HostName: "other", TailscaleIPs: ["100.64.9.2"] }) }));
  assert.equal(labelled.peers[0].name, "Grey-Box", "the first DNSName label, not the host name");
});

test("Tailscale SSH is on only when the computer has a host key", async () => {
  const { tailnet } = await reach();
  const net = tailnet(status({
    on: peer({ DNSName: "on.tail.ts.net.", TailscaleIPs: ["100.64.1.1"], sshHostKeys: ["ssh-ed25519 AAAA"] }),
    empty: peer({ DNSName: "empty.tail.ts.net.", TailscaleIPs: ["100.64.1.4"], sshHostKeys: [] }),
    missing: peer({ DNSName: "missing.tail.ts.net.", TailscaleIPs: ["100.64.1.5"], sshHostKeys: null }),
  }));
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

const stub = async (dir, name, code) => {
  const file = join(dir, name);
  await writeFile(file, `#!/bin/sh\nprintf '%s\\0' "$@" > ${JSON.stringify(join(dir, `${name}.args`))}\nexit ${code}\n`);
  await chmod(file, 0o755);
};
const recorded = async (file) => {
  try {
    return (await readFile(file)).toString().split("\0").filter(Boolean);
  } catch {
    return null;
  }
};

test("The password tab passes the computer as $1, then adds it without --json, and stops if the key was not copied", async (t) => {
  const { keySetup, addArgs } = await reach();
  const plan = { name: "grey box", target: "ada@100.64.1.2", via: "tailscale ssh ada@100.64.1.2" };
  const expected = addArgs(plan, { json: false });
  const argv = keySetup(plan);
  assert.deepEqual(clone(argv.slice(0, 2)), ["sh", "-c"]);
  assert.equal(argv[3], "sh");
  assert.equal(argv[4], plan.target, "the target is $1");
  assert.deepEqual(clone(argv.slice(5)), clone(expected));
  assert.equal(expected.includes("--json"), false);
  const dir = await temporary(t);
  const bin = join(dir, "bin");
  const home = join(dir, "home");
  await mkdir(bin);
  await mkdir(home);
  await stub(bin, "ssh-keygen", 0);
  await stub(bin, "ssh-copy-id", 0);
  await stub(bin, "hc", 0);
  const env = { PATH: `${bin}:/bin:/usr/bin`, HOME: home };
  const copied = await exec(argv[0], argv.slice(1), { env });
  assert.equal(copied.code, 0, copied.stderr);
  assert.match(copied.stdout, /Done: this tab can close/);
  assert.deepEqual(await recorded(join(bin, "ssh-copy-id.args")), ["-o", "StrictHostKeyChecking=accept-new", "-i", `${home}/.ssh/id_ed25519.pub`, plan.target]);
  assert.deepEqual(await recorded(join(bin, "hc.args")), clone(expected));
  await stub(bin, "ssh-copy-id", 1);
  await writeFile(join(bin, "hc.args"), "");
  const refused = await exec(argv[0], argv.slice(1), { env });
  assert.notEqual(refused.code, 0);
  assert.equal(await readFile(join(bin, "hc.args"), "utf8"), "", "hc does not run when ssh-copy-id fails");
});

test("Windows quotes the password tab's command", async () => {
  const { keySetup, addArgs } = await reach();
  const { psQuote } = await quote();
  const plan = { name: "grey", target: "O'Brien@box", via: "tail scale" };
  const argv = keySetup(plan, "windows");
  assert.deepEqual(clone(argv.slice(0, 3)), ["powershell", "-NoProfile", "-Command"]);
  const add = addArgs(plan, { json: false });
  assert.ok(argv[3].includes(psQuote(plan.target)));
  assert.ok(argv[3].includes(add.map(psQuote).join(" ")));
  assert.equal(argv[3].includes("--json"), false);
  assert.ok(argv[3].startsWith("$PSNativeCommandArgumentPassing = 'Legacy'"), "native arguments stay whole");
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
  const text = [
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
    "Include \"quoted path\" other.conf",
    "Include one.conf two.conf",
  ].join("\n");
  assert.deepEqual(clone(includesOf(text)), ["quoted path", "other.conf", "one.conf", "two.conf"]);
});

test("ssh config hosts skip a pattern and a Match block, keep a duplicate alias once, and attach HostName and User to that host", async () => {
  const { sshConfigHosts } = await reach();
  const text = [
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
  ].join("\n");
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

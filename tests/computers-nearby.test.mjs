import test from "node:test";
import assert from "node:assert/strict";
import { clone, load } from "./helpers.mjs";

const nearby = () => load("kanso-computers/nearby.js", ["interfacesOf", "neighborsOf", "candidates"]);
const reach = () => load("kanso-computers/reach.js", ["nearbyOnly", "tailnet", "planFor"]);
const setup = () => load("kanso-computers/setup.js", ["setupPrompt"]);

const IFCONFIG = [
  "en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500",
  "\tinet 192.168.1.10 netmask 0xffffff00 broadcast 192.168.1.255",
  "lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384",
  "\tinet 127.0.0.1 netmask 0xff000000",
].join("\n");

const LINUX_ADDR = [
  "1: lo    inet 127.0.0.1/8 scope host lo",
  "2: eth0    inet 192.168.1.10/24 brd 192.168.1.255 scope global eth0",
  "3: tailscale0    inet 100.64.1.2/32 scope global tailscale0",
].join("\n");

const WINDOWS_ADDR = ["192.168.1.10/24", "127.0.0.1/8", "100.64.1.2/32"].join("\n");

const ARP = [
  "? (192.168.1.1) at 1:2:3:4:5:6 on en0 ifscope [ethernet]",
  "mini.local (192.168.1.20) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]",
  "? (192.168.1.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]",
  "? (192.168.1.50) at (incomplete) on en0 ifscope [ethernet]",
  "192.168.1.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE",
  "192.168.1.50 dev eth0 INCOMPLETE",
  "192.168.1.255 dev eth0 lladdr ff:ff:ff:ff:ff:ff STALE",
  "  192.168.1.20          aa-bb-cc-dd-ee-ff     dynamic",
  "  192.168.1.255         ff-ff-ff-ff-ff-ff     static",
  "  192.168.1.40                                incomplete",
].join("\n");

test("The network interfaces are read from macOS ifconfig, from Linux ip address text, and from a Windows address with its prefix", async () => {
  const { interfacesOf } = await nearby();
  const lan = [{ ip: "192.168.1.10", prefix: 24 }];
  assert.deepEqual(clone(interfacesOf(IFCONFIG)), lan);
  assert.deepEqual(clone(interfacesOf(LINUX_ADDR)), lan);
  assert.deepEqual(clone(interfacesOf(WINDOWS_ADDR)), lan);
});

test("Neighbours on this computer's own networks come first, then the rest of its /24, never this computer or a far network", async () => {
  const { candidates } = await nearby();
  const interfaces = [{ ip: "192.168.1.10", prefix: 24 }, { ip: "10.8.1.4", prefix: 22 }];
  const neighbors = [
    { ip: "192.168.1.10", name: "" },
    { ip: "192.168.1.20", name: "mini" },
    { ip: "192.168.2.20", name: "other" },
    { ip: "10.8.2.9", name: "nas" },
    { ip: "10.8.4.1", name: "far" },
  ];
  const tried = clone(candidates(interfaces, neighbors));
  assert.deepEqual(tried.slice(0, 2), ["192.168.1.20", "10.8.2.9"]);
  assert.equal(tried.length, 253 + 253 + 1);
  assert.ok(tried.includes("192.168.1.21") && tried.includes("10.8.1.200"));
  assert.ok(!tried.includes("192.168.1.10") && !tried.includes("10.8.1.4") && !tried.includes("192.168.2.20") && !tried.includes("10.8.4.1"));
  assert.ok(!tried.includes("192.168.1.0") && !tried.includes("192.168.1.255"));
});

test("An incomplete neighbour and a broadcast neighbour are not listed", async () => {
  const { neighborsOf } = await nearby();
  assert.deepEqual(clone(neighborsOf(ARP)), [
    { ip: "192.168.1.1", name: "" },
    { ip: "192.168.1.20", name: "mini" },
    { ip: "192.168.1.1", name: "" },
    { ip: "192.168.1.20", name: "" },
  ]);
});

test("A computer already shown by Tailscale, the ssh config, or an added machine is not listed again on this network", async () => {
  const { nearbyOnly } = await reach();
  const found = [
    { ip: "192.168.1.20", name: "mini" },
    { ip: "192.168.1.30", name: "nas" },
    { ip: "192.168.1.40", name: "box" },
    { ip: "192.168.1.50", name: "spare" },
  ];
  const kept = nearbyOnly(found, {
    peers: [{ name: "mini", lan: ["192.168.1.20"] }],
    hosts: [{ alias: "nas", hostname: "192.168.1.30", user: "ada" }],
    added: [{ name: "box", target: "ada@192.168.1.40", via: "" }],
  });
  assert.deepEqual(clone(kept), [{ ip: "192.168.1.50", name: "spare" }]);
});

test("A Tailscale computer keeps the private addresses it has on this network", async () => {
  const { tailnet } = await reach();
  const text = JSON.stringify({
    BackendState: "Running",
    Peer: {
      grey: {
        DNSName: "grey.tail.ts.net.",
        OS: "linux",
        Online: true,
        TailscaleIPs: ["100.64.1.2"],
        CurAddr: "192.168.1.20:41641",
        Addrs: ["192.168.1.20:41641", "10.1.2.3:41641", "100.64.1.2:41641", "8.8.8.8:53", "fd7a:115c:a1e0::1"],
      },
    },
  });
  assert.deepEqual(clone(tailnet(text).peers[0].lan), ["192.168.1.20", "10.1.2.3"]);
});

const peer = (over = {}) => ({ name: "grey", ip: "100.64.1.2", tailscaleSsh: false, ...over });
const onLan = (over = {}) => ({ peer: peer(over), target: "ada@grey", name: "grey", lan: "192.168.1.20" });

const lanBefore = (via, lan, away) => {
  assert.match(via, /^sh -c /);
  assert.equal(via.endsWith(" route"), true);
  const lanAt = via.indexOf(lan);
  const awayAt = via.indexOf(away);
  assert.ok(lanAt >= 0, via);
  assert.ok(awayAt > lanAt, via);
};

test("A computer on this network is reached there first, and over Tailscale when that does not answer", async () => {
  const { planFor } = await reach();
  const tailscale = "/usr/local/bin/tailscale";
  const ssh = planFor(onLan(), { tailscale });
  lanBefore(ssh.via, "ada@192.168.1.20", "ssh ada@100.64.1.2");
  const agent = planFor(onLan({ tailscaleSsh: true }), { tailscale });
  lanBefore(agent.via, "ada@192.168.1.20", tailscale + " ssh ada@100.64.1.2");
});

test("On Windows a computer on Tailscale keeps its Tailscale route, with no shell route", async () => {
  const { planFor } = await reach();
  const tailscale = "C:\\Program Files\\Tailscale\\tailscale.exe";
  for (const choice of [onLan(), onLan({ tailscaleSsh: true })]) {
    const planned = planFor(choice, { tailscale, platform: "windows" });
    assert.equal(planned.lan, undefined);
    assert.equal(String(planned.via).includes("sh -c"), false);
    assert.match(`${planned.target} ${planned.via}`, /100\.64\.1\.2/);
  }
});

test("Set up with an agent names the local route and the Tailscale route, and never asks for a password", async () => {
  const { setupPrompt } = await setup();
  const text = setupPrompt({ platform: "linux" });
  assert.match(text, /native ssh/);
  assert.match(text, /Tailscale/);
  assert.match(text, /Never ask me for a password/);
});

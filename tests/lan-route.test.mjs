import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";
import { loadSpaces } from "./mod-fixtures.mjs";

const sign = () => load("kanso-computers/sign-in.js", ["lanArgs", "lanFirst", "lanParts"]);
const route = () => load("kanso-computers/lan-route.js", ["homeRoute", "lanRecord", "lanProbeArgs", "targetOfAway"]);
const quote = () => load("kanso-computers/platform-command.js", ["shellQuote"]);

const grey = (lan = ["10.0.0.5", "192.168.1.20"]) => [{ name: "grey", ip: "100.64.1.2", lan }];
const saved = { name: "grey", target: "ada@grey", via: "", session: "sess" };
const resolved = "hostname 100.64.1.2\nuser ada\nhostkeyalias grey\n";

const fakeRun = (probes) => {
  const calls = [];
  const run = async (program, args) => {
    calls.push([program, [...args]]);
    if (args[0] === "-G") return { code: 0, stdout: resolved };
    const named = args.find((word) => String(word).startsWith("HostName="));
    const ip = named ? named.slice("HostName=".length) : String(args.at(-2)).split("@").at(-1);
    return probes[ip] ?? { code: 1, stdout: "", stderr: "no" };
  };
  return { calls, run };
};

const oldVia = (args, away, shellQuote) => {
  const head = "ssh -o BatchMode=yes -o ConnectTimeout=2 -o StrictHostKeyChecking=accept-new";
  const live = "exec ssh -o StrictHostKeyChecking=accept-new";
  const line = `${head} ${args} true >/dev/null 2>&1 && ${live} ${args} "$1"; exec ${away} "$1"`;
  return `sh -c ${shellQuote(line)} route`;
};

test("lanFirst closes the probe's input, and the exec that follows keeps its own", async () => {
  const { lanFirst } = await sign();
  const via = lanFirst("ada@10.0.0.7", "ssh ada@10.0.0.9");
  const cut = via.indexOf("&& exec");
  assert.ok(cut > 0, via);
  assert.ok(via.slice(0, cut).includes("</dev/null"), via);
  assert.equal(via.slice(cut).includes("</dev/null"), false, via);
});

test("lanParts reads the new route and the old one, and only an exact shell-quoted route", async () => {
  const { lanArgs, lanFirst, lanParts } = await sign();
  const { shellQuote } = await quote();
  const args = lanArgs("10.0.0.7", { target: "ada@box", hostKey: "box" });
  const built = lanFirst(args, "ssh ada@9.9.9.9");
  const parsed = lanParts(built);
  assert.equal(lanFirst(parsed.args, parsed.away), built);
  assert.equal(parsed.ip, "10.0.0.7");
  const aged = oldVia("ada@10.0.0.7", "ssh ada@10.0.0.9", shellQuote);
  const old = lanParts(aged);
  assert.equal(old.ip, "10.0.0.7");
  assert.equal(old.args, "ada@10.0.0.7");
  assert.notEqual(lanFirst(old.args, old.away), aged);
  assert.equal(lanParts(aged.slice(0, -1)), null);
  assert.equal(lanParts("ssh ada@box"), null);
});

test("lanProbeArgs names the LAN host, the key alias and the port", async () => {
  const { lanProbeArgs } = await route();
  const args = lanProbeArgs("10.1.2.3", { target: "ada@grey:2222", hostKey: "grey" });
  assert.ok(args.includes("HostName=10.1.2.3"));
  assert.ok(args.includes("HostKeyAlias=grey"));
  assert.equal(args[args.indexOf("-p") + 1], "2222");
});

test("targetOfAway reads a quoted ssh target, with a port and without", () => {
  return route().then(({ targetOfAway }) => {
    assert.equal(targetOfAway("ssh 'ada@box'"), "ada@box");
    assert.equal(targetOfAway("ssh -p 2222 'ada@box'"), "ada@box:2222");
  });
});

test("lanRecord keeps the away route and the session", async () => {
  const { lanParts } = await sign();
  const { lanRecord } = await route();
  const next = lanRecord(saved, "192.168.1.20", { hostKey: "grey" });
  const parts = lanParts(next.via);
  assert.equal(next.session, "sess");
  assert.equal(next.target, "");
  assert.equal(parts.away, "ssh ada@grey");
  assert.ok(parts.args.includes("HostName=192.168.1.20"), parts.args);
});

test("homeRoute uses the first LAN address whose probe answers", async () => {
  const { homeRoute } = await route();
  const { calls, run } = fakeRun({ "10.0.0.5": { code: 1, stdout: "" }, "192.168.1.20": { code: 0, stdout: "" } });
  const found = await homeRoute(saved, grey(), run);
  assert.equal(found.ip, "192.168.1.20");
  assert.ok(found.record.via.includes("HostName=192.168.1.20"), found.record.via);
  assert.equal(found.record.session, "sess");
  const probed = calls.filter((call) => call[1].includes("true")).map((call) => call[1].find((word) => String(word).startsWith("HostName=")));
  assert.deepEqual(probed, ["HostName=10.0.0.5", "HostName=192.168.1.20"]);
});

const routeAndSign = async () => ({ ...(await route()), ...(await sign()) });

test("homeRoute leaves the route when nothing on the LAN answers, or the peer has no LAN address, or the route is already the current LAN form, or Tailscale SSH has no target", async () => {
  const { homeRoute, lanArgs, lanFirst } = await routeAndSign();
  const quiet = fakeRun({ "10.0.0.5": { code: 1, stdout: "" }, "192.168.1.20": { code: 1, stdout: "" } });
  assert.equal(await homeRoute(saved, grey(), quiet.run), null);
  const bare = fakeRun({});
  assert.equal(await homeRoute(saved, grey([]), bare.run), null);
  assert.equal(bare.calls.some((call) => call[1].includes("true")), false);
  const args = lanArgs("192.168.1.20", { target: "ada@grey", hostKey: "grey" });
  const current = { ...saved, target: "", via: lanFirst(args, "ssh ada@grey") };
  const held = fakeRun({ "192.168.1.20": { code: 0, stdout: "" } });
  assert.equal(await homeRoute(current, grey(["192.168.1.20"]), held.run), null);
  assert.equal(held.calls.some((call) => call[1].includes("true")), false);
  const tailscale = { name: "grey", target: "", via: "'/usr/local/bin/tailscale' ssh 'ada@100.64.1.2'" };
  assert.equal(await homeRoute(tailscale, grey(), fakeRun({}).run), null);
});

test("homeRoute rebuilds an old LAN route even when that address is already current", async () => {
  const { homeRoute, lanArgs, lanFirst } = await routeAndSign();
  const { shellQuote } = await quote();
  const args = lanArgs("192.168.1.20", { target: "ada@grey", hostKey: "grey" });
  const away = "ssh ada@grey";
  const aged = { ...saved, target: "", via: oldVia(args, away, shellQuote) };
  const { calls, run } = fakeRun({ "192.168.1.20": { code: 0, stdout: "" } });
  const found = await homeRoute(aged, grey(["192.168.1.20"]), run);
  assert.equal(found.ip, "192.168.1.20");
  assert.equal(found.record.via, lanFirst(args, away));
  assert.ok(calls.some((call) => call[1].includes("true")));
});

test("Spaces puts the old route back when the LAN route cannot be added", async () => {
  const calls = [];
  const { Spaces } = await loadSpaces({
    hc: async (args) => {
      const row = [...args];
      calls.push(row);
      return row[1] === "add" && calls.filter((item) => item[1] === "add").length === 1 ? { code: 1, stderr: "refused" } : { code: 0, stdout: "" };
    },
    notify() { throw new Error("a failed add sends no notice"); },
  });
  const view = new Spaces();
  const was = { name: "grey", target: "ada@grey", via: "", session: "sess" };
  const next = { name: "grey", target: "", via: "sh -c 'true' route", session: "sess" };
  await view.reroute(was, next, "192.168.1.20");
  assert.deepEqual(calls[0], ["machine", "rm", "grey"]);
  assert.ok(calls[1].includes(next.via), calls[1].join(" "));
  assert.ok(calls[2].includes("ada@grey"), calls[2].join(" "));
  assert.equal(calls[2].includes(next.via), false);
});

test("Spaces reroutes a listed machine that is not connected", async () => {
  const calls = [];
  const status = JSON.stringify({
    BackendState: "Running",
    Peer: { grey: { DNSName: "grey.tail.ts.net.", OS: "linux", Online: false, TailscaleIPs: ["100.64.1.2"], CurAddr: "192.168.1.20:41641", Addrs: ["192.168.1.20:41641"] } },
  });
  const { Spaces } = await loadSpaces({
    exec: async (program, args) => {
      if (args[0] === "status") return { code: 0, stdout: status };
      if (args[0] === "-G") return { code: 0, stdout: resolved };
      return { code: 0, stdout: "" };
    },
    hc: async (args) => { calls.push([...args]); return { code: 0, stdout: "" }; },
    notify() {},
  });
  const view = new Spaces();
  view.machines = [{ name: "grey", target: "ada@grey", via: false, state: "offline" }];
  view.homeAt = 0;
  await view.preferHome();
  assert.ok(calls.some((args) => args[1] === "rm" && args[2] === "grey"), calls.map((row) => row.join(" ")).join("\n"));
});

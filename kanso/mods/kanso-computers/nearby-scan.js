import { exec } from "herdr";
import { powershell, psQuote } from "./platform-command.js";
import { bounded, tryOrAsync } from "./pure.js";
import { interfacesOf, neighborsOf, nearOf, candidates, foundHosts, homeAddresses } from "./nearby.js";
import { sshSettings } from "./lan-route.js";

const READ_MS = 5000;
const KNOCKS_MS = 45000;
const AT_ONCE = 128;

const INTERFACES = {
  macos: () => exec("ifconfig", [], { timeout: READ_MS }),
  linux: () => exec("ip", ["-4", "-o", "addr", "show"], { timeout: READ_MS }),
  windows: () => powershell(exec, "Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { \"$($_.IPAddress)/$($_.PrefixLength)\" }"),
};
const NEIGHBORS = {
  macos: () => exec("arp", ["-an"], { timeout: READ_MS }),
  linux: () => exec("ip", ["neigh", "show"], { timeout: READ_MS }),
  windows: () => exec("arp", ["-a"], { timeout: READ_MS }),
};

const SSH_PORT = 22;
const UNIX_KNOCK = {
  macos: (port) => `nc -z -G 2 "$1" ${port} >/dev/null 2>&1 && echo "$1"`,
  linux: (port) => `timeout 2 bash -c ": </dev/tcp/$1/${port}" >/dev/null 2>&1 && echo "$1"`,
};
const unixKnocks = (platform, ips, port) => exec("sh", ["-c", `printf '%s\\n' "$@" | xargs -P ${AT_ONCE} -I{} sh -c '${(UNIX_KNOCK[platform] ?? UNIX_KNOCK.linux)(port)}' _ {}; exit 0`, "sh", ...ips], { timeout: KNOCKS_MS });
const windowsKnocks = (_platform, ips, port) => powershell(exec, `$all = @(${ips.map(psQuote).join(",")}) | ForEach-Object { $c = [Net.Sockets.TcpClient]::new(); [pscustomobject]@{ ip = $_; task = $c.ConnectAsync($_, ${port}) } }; `
  + "try { [void][Threading.Tasks.Task]::WaitAll(@($all.task), 2000) } catch {}; $all | Where-Object { $_.task.Status -eq 'RanToCompletion' } | ForEach-Object { $_.ip }");
const KNOCKS = { windows: windowsKnocks };

const RESOLVE_MS = 3000;
const RESOLVE = {
  macos: (name) => exec("dscacheutil", ["-q", "host", "-a", "name", `${name}.local`], { timeout: RESOLVE_MS }),
  linux: (name) => exec("getent", ["ahosts", `${name}.local`], { timeout: RESOLVE_MS }),
};

const textOf = async (read, timer, ms = READ_MS) => String((await bounded(tryOrAsync(read), timer, ms))?.stdout ?? "");

const knockAll = async (platform, ips, timer, port = SSH_PORT) => {
  if (!ips.length) return [];
  const knock = KNOCKS[platform] ?? unixKnocks;
  return (await textOf(() => knock(platform, ips, port), timer, KNOCKS_MS)).split(/\s+/).filter((ip) => ips.includes(ip));
};

const sshPortOf = async (name, timer) => {
  const port = Number(sshSettings(await textOf(() => exec("ssh", ["-G", name], { timeout: RESOLVE_MS }), timer, RESOLVE_MS)).port);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : SSH_PORT;
};

export async function scanNearby(platform, timer, onNear = () => {}, { whole = false } = {}) {
  const [interfaces, neighbors] = await Promise.all([
    textOf(INTERFACES[platform] ?? INTERFACES.linux, timer).then(interfacesOf),
    textOf(NEIGHBORS[platform] ?? NEIGHBORS.linux, timer).then(neighborsOf),
  ]);
  const near = nearOf(interfaces, neighbors);
  const first = await knockAll(platform, near, timer);
  onNear(foundHosts(first, neighbors));
  if (!whole) return foundHosts(first, neighbors);
  const rest = await knockAll(platform, candidates(interfaces, neighbors).filter((ip) => !near.includes(ip)), timer);
  return foundHosts([...first, ...rest], neighbors);
}

const homeOf = async (platform, name, timer, given) => {
  const [text, port] = await Promise.all([textOf(() => RESOLVE[platform](name), timer, RESOLVE_MS), given ?? sshPortOf(name, timer)]);
  const addresses = homeAddresses(text);
  const answered = await knockAll(platform, addresses, timer, port);
  const ip = addresses.find((address) => answered.includes(address));
  return ip ? [[name, ip]] : [];
};

export async function homesOf(platform, names, timer, port = null) {
  if (!RESOLVE[platform]) return new Map();
  const given = Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  const found = await Promise.all([...new Set(names.filter((name) => /^[a-z0-9][a-z0-9-]*$/i.test(name)))].map((name) => homeOf(platform, name, timer, given)));
  return new Map(found.flat());
}

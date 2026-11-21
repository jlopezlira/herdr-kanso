import { exec } from "herdr";
import { powershell, psQuote } from "./platform-command.js";
import { bounded, tryOrAsync } from "./pure.js";
import { interfacesOf, neighborsOf, candidates, foundHosts } from "./nearby.js";

const READ_MS = 5000;
const KNOCKS_MS = 30000;
const AT_ONCE = 64;

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

const UNIX_KNOCK = {
  macos: 'nc -z -G 1 "$1" 22 >/dev/null 2>&1 && echo "$1"',
  linux: 'timeout 1 bash -c ": </dev/tcp/$1/22" >/dev/null 2>&1 && echo "$1"',
};
const unixKnocks = (platform, ips) => exec("sh", ["-c", `printf '%s\\n' "$@" | xargs -P ${AT_ONCE} -I{} sh -c '${UNIX_KNOCK[platform] ?? UNIX_KNOCK.linux}' _ {}; exit 0`, "sh", ...ips], { timeout: KNOCKS_MS });
const windowsKnocks = (_platform, ips) => powershell(exec, `$all = @(${ips.map(psQuote).join(",")}) | ForEach-Object { $c = [Net.Sockets.TcpClient]::new(); [pscustomobject]@{ ip = $_; task = $c.ConnectAsync($_, 22) } }; `
  + "try { [void][Threading.Tasks.Task]::WaitAll(@($all.task), 1500) } catch {}; $all | Where-Object { $_.task.Status -eq 'RanToCompletion' } | ForEach-Object { $_.ip }");
const KNOCKS = { windows: windowsKnocks };

const textOf = async (read, timer, ms = READ_MS) => String((await bounded(tryOrAsync(read), timer, ms))?.stdout ?? "");

export async function scanNearby(platform, timer) {
  const [interfaces, neighbors] = await Promise.all([
    textOf(INTERFACES[platform] ?? INTERFACES.linux, timer).then(interfacesOf),
    textOf(NEIGHBORS[platform] ?? NEIGHBORS.linux, timer).then(neighborsOf),
  ]);
  const ips = candidates(interfaces, neighbors);
  if (!ips.length) return [];
  const knock = KNOCKS[platform] ?? unixKnocks;
  const answered = (await textOf(() => knock(platform, ips), timer, KNOCKS_MS)).split(/\s+/).filter((ip) => ips.includes(ip));
  return foundHosts(answered, neighbors);
}

import net from "net";
import { exec } from "herdr";
import { powershell } from "./platform-command.js";
import { bounded, tryOrAsync, LATE } from "./pure.js";
import { interfacesOf, neighborsOf, candidates, bannerText, foundHosts } from "./nearby.js";

const SSH_PORT = 22;
const KNOCK_MS = 2000;
const BANNER_MS = 1000;
const READ_MS = 5000;
const AT_ONCE = 8;

const INTERFACES = {
  macos: () => exec("ifconfig", [], { timeout: READ_MS }),
  linux: () => exec("ip", ["-4", "-o", "addr", "show"], { timeout: READ_MS }),
  windows: () => powershell(exec, "Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { \"$($_.IPAddress)/$($_.PrefixLength)\" }"),
};
const NEIGHBORS = {
  macos: () => exec("arp", ["-a"], { timeout: READ_MS }),
  linux: () => exec("ip", ["neigh", "show"], { timeout: READ_MS }),
  windows: () => exec("arp", ["-a"], { timeout: READ_MS }),
};

const textOf = async (read, timer) => String((await bounded(tryOrAsync(read), timer, READ_MS))?.stdout ?? "");

async function knock(ip, timer) {
  const opening = net.connect(ip, SSH_PORT).catch(() => null);
  const socket = await bounded(opening, timer, KNOCK_MS);
  if (socket === LATE) opening.then((late) => late?.close());
  if (!socket || socket === LATE) return null;
  const bytes = await bounded(socket.read(255).catch(() => null), timer, BANNER_MS);
  socket.close();
  return { ip, banner: bannerText(bytes === LATE ? null : bytes) };
}

async function inBatches(list, work, from = 0, done = []) {
  if (from >= list.length) return done;
  const batch = await Promise.all(list.slice(from, from + AT_ONCE).map(work));
  return inBatches(list, work, from + AT_ONCE, [...done, ...batch]);
}

export async function scanNearby(platform, timer) {
  const [interfaces, neighbors] = await Promise.all([
    textOf(INTERFACES[platform] ?? INTERFACES.linux, timer).then(interfacesOf),
    textOf(NEIGHBORS[platform] ?? NEIGHBORS.linux, timer).then(neighborsOf),
  ]);
  const answered = (await inBatches(candidates(interfaces, neighbors), (ip) => knock(ip, timer))).filter(Boolean);
  return foundHosts(answered, neighbors);
}

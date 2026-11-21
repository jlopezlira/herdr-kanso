import { shellQuote, windowsArg } from "./platform-command.js";
import { privateIp } from "./nearby.js";
import { splitTarget, joined, destinationOf, keySetup } from "./sign-in.js";

export { splitTarget, destinationOf, keySetup };

export const TAILSCALE_PATHS = {
  macos: ["tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"],
  linux: ["tailscale", "/usr/bin/tailscale", "/usr/local/bin/tailscale"],
  windows: ["tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe"],
};
export const tailscalePaths = (platform) => TAILSCALE_PATHS[platform] ?? TAILSCALE_PATHS.linux;

const PHONES = new Set(["ios", "android", "tvos"]);
const ipv4 = (ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip);
const hostOfAddress = (address) => String(address ?? "").replace(/:\d+$/, "");
const lanOfPeer = (peer) => [...new Set([peer.CurAddr, ...(peer.Addrs ?? [])].map(hostOfAddress).filter(privateIp))];
const labelOf = (peer) => String(peer.DNSName ?? "").split(".")[0] || String(peer.HostName ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

export function tailnet(text) {
  const raw = String(text ?? "");
  const at = raw.indexOf("{");
  if (at < 0) return null;
  try {
    const status = JSON.parse(raw.slice(at));
    if (status.BackendState && status.BackendState !== "Running") return { state: status.BackendState, peers: [] };
    const peers = Object.values(status.Peer ?? {})
      .filter((peer) => !PHONES.has(String(peer.OS ?? "").toLowerCase()))
      .map((peer) => ({
        name: labelOf(peer),
        ip: (peer.TailscaleIPs ?? []).find(ipv4) ?? peer.TailscaleIPs?.[0] ?? "",
        os: String(peer.OS ?? ""),
        online: peer.Online === true,
        tailscaleSsh: Array.isArray(peer.sshHostKeys) && peer.sshHostKeys.length > 0,
        lan: lanOfPeer(peer),
      }))
      .filter((peer) => peer.name && peer.ip)
      .toSorted((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    return { state: "Running", peers };
  } catch {
    return null;
  }
}

export const validTarget = (text) => {
  const value = String(text ?? "").trim();
  return Boolean(value) && !/\s/.test(value) && !value.startsWith("-") && !splitTarget(value).host.startsWith("-") && Boolean(splitTarget(value).host);
};

export const usesTailscaleSsh = (peer, tailscale) => Boolean(peer?.tailscaleSsh && tailscale);

export function aliasOf(peer, hosts = []) {
  return (hosts ?? []).find((h) => h.hostname === peer.ip || h.hostname === peer.name || h.hostname.startsWith(`${peer.name}.`)
    || (!h.hostname && h.alias === peer.name)) ?? null;
}

const LAN_SSH = "-o BatchMode=yes -o ConnectTimeout=2 -o StrictHostKeyChecking=accept-new";
const lanFirst = (lan, away) => `sh -c ${shellQuote(`ssh ${LAN_SSH} ${shellQuote(lan)} true >/dev/null 2>&1 && exec ssh -o StrictHostKeyChecking=accept-new ${shellQuote(lan)} "$1"; exec ${away} "$1"`)} route`;

function awayPlan(choice, { tailscale, platform }) {
  const { user } = splitTarget(choice.target);
  const peer = choice.peer;
  if (usesTailscaleSsh(peer, tailscale)) {
    const quote = platform === "windows" ? windowsArg : shellQuote;
    const target = joined(user, peer.ip);
    return { name: peer.name, target, via: `${quote(tailscale)} ssh ${quote(target)}`, probe: false };
  }
  const alias = user ? null : choice.alias ?? null;
  const target = alias ? (alias.hostname ? alias.alias : joined(alias.user, peer.ip)) : joined(user, peer.ip);
  return { name: peer.name, target, via: "", probe: true };
}

export function planFor(choice, { tailscale = "", platform = "macos" } = {}) {
  if (choice.record) return { name: choice.record.name, target: choice.record.target, via: choice.record.via, probe: false };
  if (!choice.peer) return { name: choice.name ?? "", target: choice.target.trim(), via: "", probe: true };
  const away = awayPlan(choice, { tailscale, platform });
  if (!choice.lan || platform === "windows") return away;
  const lan = joined(splitTarget(choice.target).user || splitTarget(away.target).user, choice.lan);
  return { ...away, lan, via: lanFirst(lan, away.via || `ssh ${shellQuote(away.target)}`) };
}

export function choiceOf(typed, peers = []) {
  const { user, host } = splitTarget(typed);
  const peer = peers.find((p) => p.name === host.toLowerCase() || p.ip === host) ?? null;
  return peer ? { peer, target: joined(user, host), name: peer.name } : { peer: null, target: String(typed ?? "").trim() };
}

export const addArgs = ({ name = "", target = "", via = "" }, { json = true } = {}) => ["machine", "add", ...(via ? [] : [target]),
  ...(name ? ["--name", name] : []), ...(via ? ["--via", via] : []), "--install", ...(json ? ["--json"] : [])];

export function probeArgs(target) {
  const { dest, port } = destinationOf(target);
  return ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new", ...(port ? ["-p", port] : []), "--", dest, "true"];
}

export const forgetArgs = (host) => ["-R", host];

const REACH = [
  ["hostkey", /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i],
  ["keyonly", /Permission denied \((?:publickey|publickey,gssapi[\w-]*|gssapi[\w-]*,publickey)\)/i],
  ["password", /Permission denied|Too many authentication failures|password|passphrase|login_needed|auth_failed/i],
  ["closed", /Connection refused|port 22: Connection/i],
  ["unreachable", /timed out|no answer|unreachable|No route to host|Network is unreachable|Could not resolve|Name or service not known|nodename nor servname/i],
];

export function reachOf(result) {
  if (result && result.code === 0) return "ready";
  const text = `${result?.stderr ?? ""}\n${result?.stdout ?? ""}`;
  return REACH.find(([, pattern]) => pattern.test(text))?.[0] ?? "failed";
}

const MAC = /^mac/i;
export const ACCESS_CONTROLS = "https://login.tailscale.com/admin/acls";

export function advice(reach, { name, os = "", tailnet: onTailnet = false } = {}) {
  if (reach === "password") return { text: `${name} wants its password once. Type it in the tab that opens, and ${name} is added right after.`, fix: "Enter the password" };
  if (reach === "keyonly") return { text: `${name} takes keys only. Type your key's passphrase once in the tab that opens, and ${name} is added right after.`, fix: "Sign in" };
  if (reach === "closed" && MAC.test(os)) return { text: `${name} doesn't let ssh in. On ${name}: System Settings › General › Sharing › Remote Login, on. Then Retry.`, fix: "Retry" };
  if (reach === "closed" && onTailnet) return { text: `Nothing answers ssh on ${name}. Run this once on ${name}, then Retry:`, command: "sudo tailscale set --ssh", fix: "Retry" };
  if (reach === "closed") return { text: `Nothing answers ssh on ${name}. Start its ssh server, then Retry.`, fix: "Retry" };
  if (reach === "unreachable" && onTailnet) return { text: `${name} is online, but its ssh (port 22) doesn't answer this computer. Most often Tailscale's access controls don't allow it: allow this computer to ${name} on port 22, then Retry.`, fix: "Open access controls", url: ACCESS_CONTROLS };
  if (reach === "unreachable") return { text: `${name} doesn't answer. Is it on and online?`, fix: "Retry" };
  if (reach === "hostkey") return onTailnet
    ? { text: `${name}'s key changed since last time, as after a reinstall.`, fix: "Forget the old key" }
    : { text: `${name}'s key changed since last time. If you reinstalled it, forget the old key, then Retry:`, command: `ssh-keygen -R ${splitTarget(name).host}`, fix: "Retry" };
  return { text: "", fix: "Retry" };
}

const holdsHost = (text, host) => String(text ?? "").split(/[\s'"]+/).some((word) => splitTarget(word).host === host);

export function isAdded(added, { name = "", target = "", ip = "" }) {
  return (added ?? []).some((m) => (name && m.name === name) || (target && m.target === target)
    || (ip && [m.target, m.via].some((text) => holdsHost(text, ip))));
}

export function nearbyOnly(found, { peers = [], hosts = [], added = [] } = {}) {
  return found.filter(({ ip, name }) => !peers.some((peer) => (peer.lan ?? []).includes(ip) || (name && peer.name === name))
    && !hosts.some((host) => host.hostname === ip || (name && host.alias === name))
    && !isAdded(added, { ip, name }));
}

const HOST_FIELDS = { hostname: "hostname", user: "user" };

export function sshConfigHosts(text) {
  const blocks = String(text ?? "").split("\n").map((raw) => raw.trim().match(/^([^\s#=]+)\s*=?\s*(.*)$/)).filter(Boolean)
    .reduce((found, [, key, value]) => {
      const word = key.toLowerCase();
      if (word === "host" || word === "match") {
        const names = word === "host" ? value.trim().split(/\s+/).filter((h) => h && !/[*?!]/.test(h)) : [];
        return [...found, names.length ? { alias: names[0], hostname: "", user: "" } : null];
      }
      const last = found.at(-1);
      return last && HOST_FIELDS[word] ? [...found.slice(0, -1), { ...last, [HOST_FIELDS[word]]: value.trim() }] : found;
    }, []);
  return blocks.filter(Boolean).filter((host, i, all) => all.findIndex((other) => other.alias === host.alias) === i);
}

export const includesOf = (text) => String(text ?? "").split("\n")
  .map((raw) => raw.trim().match(/^include\s*=?\s*(.+)$/i)?.[1]).filter(Boolean)
  .flatMap((value) => value.match(/"[^"]*"|\S+/g) ?? []).map((p) => p.replace(/^"|"$/g, ""));

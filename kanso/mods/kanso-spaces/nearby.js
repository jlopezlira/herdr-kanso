const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;

const SPAN = 22;

export const ipNumber = (ip) => String(ip).split(".").reduce((n, part) => n * 256 + Number(part), 0);
const ipText = (n) => [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join(".");

const validIp = (ip) => IPV4.test(ip) && String(ip).split(".").every((part) => Number(part) <= 255);
const RANGES = [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16]];
const within = (ip, [base, bits]) => Math.floor(ipNumber(ip) / 2 ** (32 - bits)) === Math.floor(ipNumber(base) / 2 ** (32 - bits));
const V6 = /^[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/i;
const TAILNET_V6 = /^fd7a:115c:a1e0:/i;
const localV6 = (ip) => V6.test(ip) && /^f[cd][0-9a-f]{2}:/i.test(ip) && !TAILNET_V6.test(ip);
const linkV6 = (ip) => /^fe80:[0-9a-f:]*%[\w.-]+$/i.test(ip) && V6.test(ip.split("%")[0]);
const familyRank = (ip) => (validIp(ip) ? 0 : localV6(ip) ? 1 : 2);
export const privateIp = (ip) => (validIp(ip) && RANGES.some((range) => within(ip, range))) || localV6(String(ip)) || linkV6(String(ip));

const KAME = /^fe80:([0-9a-f]{1,4}):(.*)$/i;
const scoped = (ip) => {
  const kame = String(ip ?? "").match(KAME);
  return kame && !ip.includes("%") && Number.parseInt(kame[1], 16) > 0 ? `fe80:0:${kame[2]}%${Number.parseInt(kame[1], 16)}` : ip;
};

export function homeAddresses(text) {
  const words = String(text ?? "").split("\n").map((line) => line.match(/^\s*(?:ip_address|ipv6_address):\s*(\S+)/)?.[1] ?? line.match(/^(\S+)\s+STREAM\b/)?.[1]).map(scoped);
  return [...new Set(words.filter(privateIp))].toSorted((a, b) => familyRank(a) - familyRank(b));
}

const bitsOf = (hex) => [...parseInt(hex, 16).toString(2)].filter((bit) => bit === "1").length;

export function interfacesOf(text) {
  return String(text ?? "").split("\n").flatMap((line) => {
    const slash = line.match(/(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})\b/);
    if (slash) return [{ ip: slash[1], prefix: Number(slash[2]) }];
    const mask = line.match(/inet (\d{1,3}(?:\.\d{1,3}){3}).*?netmask 0x([0-9a-f]{8})/i);
    return mask ? [{ ip: mask[1], prefix: bitsOf(mask[2]) }] : [];
  }).filter(({ ip, prefix }) => privateIp(ip) && prefix > 0 && prefix < 32);
}

export function subnetHosts({ ip, prefix }) {
  const size = 2 ** (32 - Math.max(prefix, SPAN));
  const first = Math.floor(ipNumber(ip) / size) * size;
  return Array.from({ length: size - 2 }, (_, i) => ipText(first + i + 1)).filter((host) => host !== ip);
}

const sameNet = (ip, { ip: own, prefix }) => Math.floor(ipNumber(ip) / 2 ** (32 - prefix)) === Math.floor(ipNumber(own) / 2 ** (32 - prefix));

const shortName = (name) => String(name ?? "").split(".")[0].toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

export function neighborsOf(text) {
  return String(text ?? "").split("\n").flatMap((line) => {
    if (/incomplete|ff-ff-ff-ff-ff-ff|ff:ff:ff:ff:ff:ff/i.test(line)) return [];
    const named = line.match(/^\s*(\S+)\s+\((\d{1,3}(?:\.\d{1,3}){3})\)/);
    const ip = named?.[2] ?? line.match(IPV4)?.[1];
    if (!ip || !privateIp(ip)) return [];
    const name = named && named[1] !== "?" ? shortName(named[1]) : "";
    return [{ ip, name }];
  });
}

export function nearOf(interfaces, neighbors) {
  const own = new Set(interfaces.map(({ ip }) => ip));
  return [...new Set(neighbors.map(({ ip }) => ip))].filter((ip) => !own.has(ip) && interfaces.some((net) => sameNet(ip, net)));
}

export function candidates(interfaces, neighbors) {
  const own = new Set(interfaces.map(({ ip }) => ip));
  return [...new Set([...nearOf(interfaces, neighbors), ...interfaces.flatMap(subnetHosts)])].filter((ip) => !own.has(ip));
}

export function foundHosts(answered, neighbors) {
  const names = new Map(neighbors.filter(({ name }) => name).map(({ ip, name }) => [ip, name]));
  return [...new Set(answered)].map((ip) => ({ ip, name: names.get(ip) ?? "", os: "" }))
    .toSorted((a, b) => ipNumber(a.ip) - ipNumber(b.ip));
}

export const lanOf = (peer, found) => (peer?.lan ?? []).find((ip) => found.some((host) => host.ip === ip)) ?? "";

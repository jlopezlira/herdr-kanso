const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
const SPAN = 24;

export const ipNumber = (ip) => String(ip).split(".").reduce((n, part) => n * 256 + Number(part), 0);
export const ipText = (n) => [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join(".");

const validIp = (ip) => IPV4.test(ip) && String(ip).split(".").every((part) => Number(part) <= 255);
const RANGES = [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16]];
const within = (ip, [base, bits]) => Math.floor(ipNumber(ip) / 2 ** (32 - bits)) === Math.floor(ipNumber(base) / 2 ** (32 - bits));
export const privateIp = (ip) => validIp(ip) && RANGES.some((range) => within(ip, range));

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
  const bits = Math.max(prefix, SPAN);
  const size = 2 ** (32 - bits);
  const first = Math.floor(ipNumber(ip) / size) * size;
  return Array.from({ length: size - 2 }, (_, i) => ipText(first + i + 1)).filter((host) => host !== ip);
}

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

export function candidates(interfaces, neighbors) {
  const own = new Set(interfaces.map(({ ip }) => ip));
  const swept = interfaces.flatMap(subnetHosts);
  return [...new Set([...neighbors.map(({ ip }) => ip), ...swept])].filter((ip) => !own.has(ip));
}

const BANNER_OS = [["Windows", /for_Windows/i], ["Linux", /Ubuntu|Debian|Raspbian|Fedora|Alpine|Arch|Linux/i], ["FreeBSD", /FreeBSD/i]];
export const osOfBanner = (banner) => BANNER_OS.find(([, pattern]) => pattern.test(String(banner ?? "")))?.[0] ?? "";

export const bannerText = (bytes) => (bytes ? String.fromCharCode(...bytes.slice(0, 255)).split(/\r?\n/)[0].trim() : "");

export function foundHosts(answered, neighbors) {
  const names = new Map(neighbors.filter(({ name }) => name).map(({ ip, name }) => [ip, name]));
  return answered.map(({ ip, banner }) => ({ ip, name: names.get(ip) ?? "", os: osOfBanner(banner) }))
    .toSorted((a, b) => ipNumber(a.ip) - ipNumber(b.ip));
}

export const lanOf = (peer, found) => (peer?.lan ?? []).find((ip) => found.some((host) => host.ip === ip)) ?? "";

import { awayLine, destinationOf, kansoKeyed, keyOfRoute, knownFile, lanArgs, lanDest, lanFirst, lanOptions, lanParts, rekeyed, unkeyed, unquote, LAN_PROBE } from "./sign-in.js";
import { addArgs, hcError, listedMachines, machineRecord, rmArgs } from "./machines.js";

export function sshSettings(text) {
  return Object.fromEntries(String(text ?? "").split("\n").map((line) => line.trim().split(/\s+/)).filter((words) => words.length > 1)
    .map(([key, ...rest]) => [key.toLowerCase(), rest.join(" ")]));
}

export function targetOfAway(away) {
  const found = String(away ?? "").match(/^ssh (?:-p (\d+) )?('(?:[^']|'\\'')*'|[^\s']+)$/s);
  if (!found) return "";
  const dest = unquote(found[2]);
  return found[1] ? `${dest}:${found[1]}` : dest;
}

export function awayOf(record) {
  const parts = lanParts(record?.via);
  const via = unkeyed(record?.via);
  const away = parts?.away ?? (via || (record?.target ? awayLine(record.target) : ""));
  return { away, target: record?.target || targetOfAway(away), lan: parts, key: parts?.key ?? (kansoKeyed(record?.via) ? keyOfRoute(record.via) : "") };
}

export async function resolvedHost(target, run) {
  const r = await run("ssh", ["-G", destinationOf(target).dest]).catch(() => null);
  if (r?.code !== 0) return null;
  const settings = sshSettings(r.stdout);
  const key = settings.hostkeyalias && settings.hostkeyalias !== "none" ? settings.hostkeyalias : settings.hostname;
  return settings.hostname ? { hostname: settings.hostname, hostKey: key, user: settings.user ?? "" } : null;
}

export function lanRecord(record, host, { hostKey = "", user = "", known = "" } = {}) {
  const { away, target, key } = awayOf(record);
  if (!away) return null;
  const via = rekeyed(lanFirst(lanArgs(host, { target, user, hostKey, known }), away), key);
  return via === record.via ? null : { ...record, target: "", via };
}

export const lanProbeArgs = (host, { target = "", hostKey = "", user = "", known = "", key = "" } = {}) => {
  const { dest, port } = lanDest(host, { target, user });
  const identity = key ? ["-o", `IdentityFile=${key}`, "-o", "IdentitiesOnly=yes"] : [];
  return [...LAN_PROBE, ...identity, ...lanOptions(host, { target, hostKey, known }), ...(port ? ["-p", port] : []), "--", dest, "true"];
};

export const HOME_FACTS = [
  'n=$(busctl --system call org.freedesktop.Avahi / org.freedesktop.Avahi.Server GetHostNameFqdn 2>/dev/null | sed -n \'s/^s "\\(.*\\)"$/\\1/p\')',
  '[ -n "$n" ] || n=$(scutil --get LocalHostName 2>/dev/null || hostname -s 2>/dev/null || hostname)',
  'printf "home %s\\nuser %s\\n" "$n" "$(id -un)"',
  'for f in /etc/ssh/ssh_host_*_key.pub; do [ -r "$f" ] && sed "s/^/key /" "$f"; done',
  "exit 0",
].join("; ");

const HOME_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const HOST_KEY = /^((?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+|sk-[\w@.-]+) [A-Za-z0-9+/]+={0,3})(?:\s|$)/;

export function homeFacts(text) {
  const lines = String(text ?? "").split("\n").map((line) => line.trim());
  const field = (word) => lines.find((line) => line.startsWith(`${word} `))?.slice(word.length + 1).trim() ?? "";
  const name = field("home").toLowerCase().replace(/\.local$/, "");
  const keys = [...new Set(lines.filter((line) => line.startsWith("key ")).map((line) => line.slice(4).match(HOST_KEY)?.[1]).filter(Boolean))];
  return HOME_NAME.test(name) && keys.length ? { home: `${name}.local`, user: field("user"), keys } : null;
}

const PIN = 'f="$HOME/.ssh/$1"; h=$2; shift 2; umask 077; mkdir -p "$HOME/.ssh" || exit 1; t=$(mktemp "$f.XXXXXX") || exit 1; for k in "$@"; do printf "%s %s\\n" "$h" "$k"; done > "$t" && mv -f "$t" "$f" || { rm -f "$t"; exit 1; }';
export const pinArgs = (known, { home, keys }) => ["-c", PIN, "pin", known, home, ...keys];

export async function homeRoute(record, { run, remote }) {
  const { target, lan, away, key } = awayOf(record);
  if (!away) return null;
  const facts = homeFacts((await remote(["sh", "-c", HOME_FACTS]).catch(() => null))?.stdout);
  if (!facts) return null;
  const known = knownFile(record.name);
  const pinned = await run("sh", pinArgs(known, facts)).catch(() => null);
  if (pinned?.code !== 0 || (lan?.named && lan.ip === facts.home)) return null;
  const where = { target, user: facts.user, hostKey: facts.home, known };
  const probe = await run("ssh", lanProbeArgs(facts.home, { ...where, key })).catch(() => null);
  const next = probe?.code === 0 ? lanRecord(record, facts.home, where) : null;
  return next ? { home: facts.home, record: next } : null;
}

const savedRoute = async (name, hc) => {
  const rows = listedMachines(await hc(["machine", "ls", "--json"]).catch(() => null));
  return machineRecord(rows.find((row) => row.name === name)) ?? null;
};
const sameRoute = (a, b) => Boolean(a && b) && a.target === b.target && a.via === b.via;

export async function reroute(was, next, hc) {
  if (!sameRoute(await savedRoute(was.name, hc), was)) return false;
  if (hcError(await hc(rmArgs(was.name)).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) })))) return false;
  if (!hcError(await hc(addArgs(next)).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) })))) return true;
  if (!(await savedRoute(was.name, hc))) await hc(addArgs(was)).catch(() => null);
  return false;
}

export async function knownHome(record, run) {
  const { target, lan, key } = awayOf(record);
  const home = `${String(record.name).toLowerCase()}.local`;
  if (!target || lan?.named || !HOME_NAME.test(home.slice(0, -6))) return null;
  const resolved = await resolvedHost(target, run);
  if (!resolved) return null;
  const where = { target, hostKey: resolved.hostKey };
  const probe = await run("ssh", lanProbeArgs(home, { ...where, key })).catch(() => null);
  const next = probe?.code === 0 ? lanRecord(record, home, where) : null;
  return next ? { home, record: next } : null;
}

export async function preferHome(record, { run, hc, exec, timeout, connected = true }) {
  const remote = ([program, ...args]) => exec(program, args, { on: record.name, timeout });
  const found = await (connected ? homeRoute(record, { run, remote }) : knownHome(record, run)).catch(() => null);
  return found && (await reroute(record, found.record, hc)) ? found : null;
}

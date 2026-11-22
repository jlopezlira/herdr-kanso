import { awayLine, destinationOf, joined, lanArgs, lanFirst, lanParts, splitTarget, unquote } from "./sign-in.js";
import { privateIp } from "./nearby.js";

const LAN_PROBE = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=2", "-o", "StrictHostKeyChecking=accept-new"];

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
  const away = parts?.away ?? (record?.via || (record?.target ? awayLine(record.target) : ""));
  return { away, target: record?.target || targetOfAway(away), lan: parts };
}

export async function resolvedHost(target, run) {
  const r = await run("ssh", ["-G", destinationOf(target).dest]).catch(() => null);
  if (r?.code !== 0) return null;
  const settings = sshSettings(r.stdout);
  const key = settings.hostkeyalias && settings.hostkeyalias !== "none" ? settings.hostkeyalias : settings.hostname;
  return settings.hostname ? { hostname: settings.hostname, hostKey: key, user: settings.user ?? "" } : null;
}

export const peerFor = (peers, { host, hostname }) => (peers ?? []).find((peer) => peer.ip === hostname || peer.ip === host || peer.name === host || peer.name === hostname) ?? null;

export const lanCandidates = (peer) => [...new Set((peer?.lan ?? []).filter(privateIp))];

export function lanRecord(record, ip, { hostKey = "", user = "" } = {}) {
  const { away, target } = awayOf(record);
  if (!away) return null;
  const args = target ? lanArgs(ip, { target, hostKey }) : lanArgs(ip, { user });
  const via = lanFirst(args, away);
  return via === record.via ? null : { ...record, target: "", via };
}

export const lanProbeArgs = (ip, { target = "", hostKey = "", user = "" } = {}) => {
  if (!target) return [...LAN_PROBE, "--", joined(user, ip), "true"];
  const { dest, port } = destinationOf(target);
  return [...LAN_PROBE, "-o", `HostName=${ip}`, "-o", `HostKeyAlias=${hostKey || splitTarget(dest).host}`, ...(port ? ["-p", port] : []), "--", dest, "true"];
};

export async function homeRoute(record, peers, run) {
  const { target, lan } = awayOf(record);
  if (!target) return null;
  const host = splitTarget(destinationOf(target).dest).host;
  const resolved = await resolvedHost(target, run);
  if (!resolved) return null;
  const peer = peerFor(peers, { host, hostname: resolved.hostname });
  const candidates = lanCandidates(peer);
  if (!candidates.length || (lan?.ip && candidates.includes(lan.ip) && lanFirst(lan.args, lan.away) === record.via && /HostKeyAlias=/.test(lan.args))) return null;
  for (const ip of candidates) {
    const probe = await run("ssh", lanProbeArgs(ip, { target, hostKey: resolved.hostKey })).catch(() => null);
    if (probe?.code === 0) return { ip, record: lanRecord(record, ip, { hostKey: resolved.hostKey }) };
  }
  return null;
}

import { psQuote, shellQuote } from "./platform-command.js";
import { machineRecord } from "./machines.js";

export function splitTarget(text) {
  const value = String(text ?? "").trim();
  const at = value.lastIndexOf("@");
  return at < 0 ? { user: "", host: value } : { user: value.slice(0, at), host: value.slice(at + 1) };
}

export const joined = (user, host) => (user ? `${user}@${host}` : host);

export function destinationOf(target) {
  const { user, host } = splitTarget(target);
  const port = host.match(/^\[([^\]]+)\]:(\d+)$/) ?? (host.split(":").length === 2 ? host.match(/^([^:]+):(\d+)$/) : null);
  return port ? { dest: joined(user, port[1]), port: port[2] } : { dest: joined(user, host), port: "" };
}

export const KEY = "~/.ssh/id_ed25519_kanso";
const KEYED = `-i ${KEY} -o IdentitiesOnly=yes -o BatchMode=yes `;
const ASK = "-o PasswordAuthentication=yes -o KbdInteractiveAuthentication=yes -o StrictHostKeyChecking=accept-new ";
const SSH = /(^|['"]|\bexec )ssh (?=\S)/g;
const DONE = "Done: this tab can close.";
const refused = (name) => `${name} didn't let this computer in. Put this line in ~/.ssh/authorized_keys on ${name}, then sign in again:`;

const withSsh = (via, words) => via.split(KEYED).join("").replace(SSH, `$1ssh ${words}`);
const sshLine = (target, quote) => {
  const { dest, port } = destinationOf(target);
  return `ssh ${port ? `-p ${port} ` : ""}${quote(dest)}`;
};
export const awayLine = (target) => sshLine(target, shellQuote);

export function routeOf(machine) {
  const { name = "", target = "", via = "", session = "" } = machineRecord(machine) ?? {};
  return { name, target, via, session };
}

const LAN_SSH = "-o BatchMode=yes -o ConnectTimeout=2 -o StrictHostKeyChecking=accept-new";
const LAN_ASK = "-o ConnectTimeout=2 -o StrictHostKeyChecking=accept-new";
const lanLine = (args, away) => `ssh ${LAN_SSH} ${args} true >/dev/null 2>&1 && exec ssh -o StrictHostKeyChecking=accept-new ${args} "$1"; exec ${away} "$1"`;
export const lanFirst = (args, away) => `sh -c ${shellQuote(lanLine(args, away))} route`;

export function lanArgs(ip, { target = "", user = "", hostKey = "" } = {}) {
  if (!target) return shellQuote(joined(user, ip));
  const { dest, port } = destinationOf(target);
  const key = hostKey || splitTarget(dest).host;
  return [`-o HostName=${ip}`, `-o HostKeyAlias=${shellQuote(key)}`, ...(port ? [`-p ${port}`] : []), shellQuote(dest)].join(" ");
}

export const unquote = (word) => (/^'.*'$/s.test(word) ? word.slice(1, -1).replace(/'\\''/g, "'") : word);
const LAN_IP = /(?:^|\s)-o HostName=(\S+)(?:\s|$)/;

export function lanParts(via) {
  const inner = String(via ?? "").match(/^sh -c ('(?:[^']|'\\'')*'|\S+) route$/s);
  const line = inner ? unquote(inner[1]) : "";
  const found = line.match(/^ssh -o BatchMode=yes -o ConnectTimeout=2 -o StrictHostKeyChecking=accept-new (.+?) true >\/dev\/null 2>&1 && exec ssh -o StrictHostKeyChecking=accept-new \1 "\$1"; exec (.+) "\$1"$/s);
  if (!found || lanFirst(found[1], found[2]) !== via) return null;
  const ip = found[1].match(LAN_IP)?.[1] ?? splitTarget(unquote(found[1])).host;
  return { args: found[1], ip, away: found[2] };
}

export function keyable({ target = "", via = "" }, platform = "macos") {
  if (!via) return Boolean(target);
  if (platform === "windows" || /tailscale/i.test(via)) return false;
  return new RegExp(SSH.source).test(via);
}

export function keyedRoute({ target = "", via = "" }, platform = "macos") {
  const windows = platform === "windows";
  const base = (quote) => via.split(KEYED).join("") || sshLine(target, quote);
  const lan = lanParts(base(shellQuote));
  const ask = lan ? `sh -c ${shellQuote(`ssh ${ASK}${LAN_ASK} ${lan.args} "$1" || exec ${withSsh(lan.away, ASK)} "$1"`)} route` : withSsh(base(windows ? psQuote : shellQuote), ASK);
  return { ask, keyed: withSsh(base(windows ? String : shellQuote), KEYED) };
}

const nameOf = ({ name, target }) => name || splitTarget(destinationOf(target).dest).host;

const addLine = (route, { via, name, session, install = true }) => ["machine", "add", ...(via ? [] : [route]), ...(via ? ["--via", via] : []),
  "--name", name, ...(session ? ["--session", session] : []), ...(install ? ["--install"] : [])];

const pushLine = (pub) => `umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF '${pub}' ~/.ssh/authorized_keys || printf '\\n%s\\n' '${pub}' >> ~/.ssh/authorized_keys`;

function shSetup(machine, { replace }) {
  const name = nameOf(machine);
  const { ask, keyed } = keyedRoute(machine);
  const hc = (args) => ["hc", ...args].map(shellQuote).join(" ");
  const back = addLine(machine.target, { via: machine.via, name, session: machine.session });
  return [
    `k=${KEY.replace("~", '"$HOME"')}`,
    'mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh" || exit',
    '[ -f "$k" ] || ssh-keygen -q -t ed25519 -N "" -C kanso -f "$k" || exit',
    'pub=$(cat "$k.pub") || exit',
    `line="${pushLine("$pub")}"`,
    'e=$(mktemp) || exit',
    `${ask} "$line" 2>"$e"; s=$?; cat "$e" >&2`,
    `[ "$s" -eq 0 ] || { grep -q "Permission denied" "$e" && { echo; echo ${shellQuote(refused(name))}; echo "$pub"; }; rm -f "$e"; exit 1; }`,
    'rm -f "$e"',
    replace ? `${hc(["machine", "rm", name])} >/dev/null 2>&1` : "",
    `${hc(addLine("", { via: keyed, name, session: machine.session }))} || { ${replace ? `${hc(back)} >/dev/null 2>&1; ` : ""}exit 1; }`,
    `herdr-app do ${shellQuote(`kanso-spaces.retry-machine:${name}`)} >/dev/null 2>&1`,
    `echo; echo ${shellQuote(DONE)}`,
  ].filter(Boolean).join("\n");
}

function psSetup(machine, { replace }) {
  const name = nameOf(machine);
  const { ask, keyed } = keyedRoute(machine, "windows");
  const hc = (args) => `& hc ${args.map(psQuote).join(" ")}`;
  const back = addLine(machine.target, { name, session: machine.session });
  return [
    "$PSNativeCommandArgumentPassing = 'Legacy'",
    `$k = Join-Path $env:USERPROFILE '.ssh\\id_ed25519_kanso'`,
    "New-Item -ItemType Directory -Force (Split-Path $k) | Out-Null",
    `if (-not (Test-Path $k)) { ssh-keygen -q -t ed25519 -N '""' -C kanso -f $k }`,
    `$pub = (Get-Content "$k.pub" -Raw).Trim()`,
    `$said = ${ask} "${pushLine("$pub")}" 2>&1; $said | Write-Host`,
    `if ($LASTEXITCODE -ne 0) { if ("$said" -match 'Permission denied') { Write-Host ''; Write-Host ${psQuote(refused(name))}; Write-Host $pub }; exit 1 }`,
    replace ? `${hc(["machine", "rm", name])} *> $null` : "",
    hc(addLine("", { via: keyed, name, session: machine.session })),
    `if ($LASTEXITCODE -ne 0) { ${replace ? `${hc(back)} *> $null; ` : ""}exit 1 }`,
    `Write-Host ''; Write-Host '${DONE}'`,
  ].filter(Boolean).join("; ");
}

export function keySetup(machine, { platform = "macos", replace = false } = {}) {
  const route = { name: "", target: "", via: "", session: "", ...machine };
  if (!keyable(route, platform)) {
    return replace ? ["hc", "machine", "login", route.name] : ["hc", ...addLine(route.target, { via: route.via, name: nameOf(route), session: route.session })];
  }
  return platform === "windows"
    ? ["powershell", "-NoProfile", "-Command", psSetup(route, { replace })]
    : ["sh", "-c", shSetup(route, { replace })];
}

export const signInTab = (machine, platform = "macos") => ({ argv: keySetup(routeOf(machine), { platform, replace: true }), place: "right" });

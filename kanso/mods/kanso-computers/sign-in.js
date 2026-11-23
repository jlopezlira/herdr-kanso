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
const KEYED = `-o IdentityFile=${KEY} -o IdentitiesOnly=yes -o BatchMode=yes `;
const KEYED_BEFORE = `-i ${KEY} -o IdentitiesOnly=yes -o BatchMode=yes `;
const unkeyed = (via) => [KEYED, KEYED_BEFORE].reduce((rest, words) => rest.split(words).join(""), String(via ?? ""));
export const kansoKeyed = (via) => [KEYED, KEYED_BEFORE].some((words) => String(via ?? "").includes(words));
const ASK = "-o PasswordAuthentication=yes -o KbdInteractiveAuthentication=yes ";
const SSH = /(^|['"]|\bexec )ssh (?=\S)/g;
const DONE = "Done: this tab can close.";
const AGENT_FAILED = (name) => `The key in your ssh agent did not open ${name} on its own, so kansō makes its own key and asks once more.`;
const refused = (name) => `${name} didn't let this computer in. Put this line in ~/.ssh/authorized_keys on ${name}, then sign in again:`;

const withSsh = (via, words) => unkeyed(via).replace(SSH, `$1ssh ${words}`);
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
const LAN_ASK = "-o ConnectTimeout=2";
const lanLine = (args, away) => `ssh ${LAN_SSH} ${args} true </dev/null >/dev/null 2>&1 && exec ssh -o StrictHostKeyChecking=accept-new ${args} "$1"; exec ${away} "$1"`;
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
  const found = line.match(/^ssh -o BatchMode=yes -o ConnectTimeout=2 -o StrictHostKeyChecking=accept-new (.+?) true (?:<\/dev\/null )?>\/dev\/null 2>&1 && exec ssh -o StrictHostKeyChecking=accept-new \1 "\$1"; exec (.+) "\$1"$/s);
  if (!found || `sh -c ${shellQuote(line)} route` !== via) return null;
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
  const base = (quote) => unkeyed(via) || sshLine(target, quote);
  const lan = lanParts(base(shellQuote));
  const ask = lan ? `sh -c ${shellQuote(`ssh ${ASK}${LAN_ASK} ${lan.args} "$1" || exec ${withSsh(lan.away, ASK)} "$1"`)} route` : withSsh(base(windows ? psQuote : shellQuote), ASK);
  return { ask, keyed: withSsh(base(windows ? String : shellQuote), KEYED), reach: withSsh(base(windows ? psQuote : shellQuote), KEYED) };
}

const nameOf = ({ name, target }) => name || splitTarget(destinationOf(target).dest).host;

const addLine = (route, { via, name, session, install = true }) => ["machine", "add", ...(via ? [] : [route]), ...(via ? ["--via", via] : []),
  "--name", name, ...(session ? ["--session", session] : []), ...(install ? ["--install"] : [])];

const pushLine = (pub, b64) => `umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qF '${b64}' ~/.ssh/authorized_keys || printf '\\n%s\\n' '${pub}' >> ~/.ssh/authorized_keys`;
const forgetLine = (old) => `grep -vxF '${old}' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.kanso && mv ~/.ssh/authorized_keys.kanso ~/.ssh/authorized_keys; rm -f ~/.ssh/authorized_keys.kanso; `;
const LINE = "LINE";
const dropLine = `test -f ~/.ssh/authorized_keys || exit 0; grep -qxF '${LINE}' ~/.ssh/authorized_keys || { echo absent; exit 0; }; umask 077; grep -vxF '${LINE}' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.kanso; test $? -le 1 && mv ~/.ssh/authorized_keys.kanso ~/.ssh/authorized_keys && echo removed`;
const SH_LINE = `line=$(awk '{ print $1 " " $2 " kanso" }' "$k.pub")`;
const SH_KEY = [
  `agent() { ssh-add -L 2>/dev/null | awk '$1 ~ /^(ssh-ed25519|ecdsa-sha2-nistp[0-9]+|ssh-rsa)$/ { print $1 " " $2 }'; }`,
  `held() { [ -f "$k.pub" ] && agent | grep -qxF "$(awk '{ print $1 " " $2 }' "$k.pub")"; }`,
  `pick() { a=$(agent); [ -n "$a" ] && printf '%s\\n' "$a" | awk '/^ssh-ed25519 / { print $0 " kanso"; f = 1; exit } NR == 1 { first = $0 } END { if (!f) print first " kanso" }' > "$k.pub"; }`,
  'fresh() { rm -f "$k.pub"; ssh-keygen -q -t ed25519 -N "" -C kanso -f "$k"; }',
  `lines() { pub=$(awk '{ print $1 " " $2 " kanso" }' "$k.pub") && b64=$(awk '{ print $2 }' "$k.pub") && line="${pushLine("$pub", "$b64")}"; }`,
];
const PS_PAIR = "function Get-Pair { ((Get-Content \"$k.pub\" -Raw).Trim() -split '\\s+')[0..1] -join ' ' }";
const PS_KEY = [
  "function Get-Agent { @(ssh-add -L 2>$null | Where-Object { $_ -match '^(ssh-ed25519|ecdsa-sha2-nistp\\d+|ssh-rsa) ' } | ForEach-Object { ($_ -split ' ')[0..1] -join ' ' }) }",
  PS_PAIR,
  "function Test-Held { (Test-Path \"$k.pub\") -and ((Get-Agent) -contains (Get-Pair)) }",
  "function Select-Agent { $a = Get-Agent; if (-not $a) { return $false }; (@($a | Where-Object { $_ -like 'ssh-ed25519 *' }) + $a)[0] + ' kanso' | Set-Content \"$k.pub\" -Encoding ascii; $true }",
  "function New-Key { Remove-Item \"$k.pub\" -ErrorAction SilentlyContinue; ssh-keygen -q -t ed25519 -N '\"\"' -C kanso -f $k }",
  "function Read-Key { $script:pub = (Get-Pair) + ' kanso'; $script:b64 = (Get-Pair).Split(' ')[1] }",
];

function shSetup(machine, { replace }) {
  const name = nameOf(machine);
  const { ask, keyed, reach } = keyedRoute(machine);
  const hc = (args) => ["hc", ...args].map(shellQuote).join(" ");
  const back = addLine(machine.target, { via: machine.via, name, session: machine.session });
  return [
    `k=${KEY.replace("~", '"$HOME"')}`,
    'mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh" || exit',
    ...SH_KEY,
    `push() { e=$(mktemp) || exit; ${ask} "$line" 2>"$e"; s=$?; cat "$e" >&2; [ "$s" -eq 0 ] || { grep -q "Permission denied" "$e" && { echo; echo ${shellQuote(refused(name))}; echo "$pub"; }; rm -f "$e"; exit 1; }; rm -f "$e"; }`,
    '[ -f "$k" ] || held || pick || fresh || exit',
    'lines || exit',
    'push',
    `[ -f "$k" ] || ${reach} true </dev/null >/dev/null 2>&1 || { echo ${shellQuote(AGENT_FAILED(name))}; old=$pub; fresh && lines || exit; line="${forgetLine("$old")}$line"; push; }`,
    replace ? `${hc(["machine", "rm", name])} >/dev/null 2>&1` : "",
    `${hc(addLine("", { via: keyed, name, session: machine.session }))} || { ${replace ? `${hc(back)} >/dev/null 2>&1; ` : ""}exit 1; }`,
    `herdr-app do ${shellQuote(`kanso-spaces.retry-machine:${name}`)} >/dev/null 2>&1`,
    `echo; echo ${shellQuote(DONE)}`,
  ].filter(Boolean).join("\n");
}

function psSetup(machine, { replace }) {
  const name = nameOf(machine);
  const { ask, keyed, reach } = keyedRoute(machine, "windows");
  const hc = (args) => `& hc ${args.map(psQuote).join(" ")}`;
  const back = addLine(machine.target, { name, session: machine.session });
  return [
    "$PSNativeCommandArgumentPassing = 'Legacy'",
    `$k = Join-Path $env:USERPROFILE '.ssh\\id_ed25519_kanso'`,
    "New-Item -ItemType Directory -Force (Split-Path $k) | Out-Null",
    ...PS_KEY,
    `function Send-Key { $said = ${ask} "$pre${pushLine("$pub", "$b64")}" 2>&1; $said | Write-Host; if ($LASTEXITCODE -ne 0) { if ("$said" -match 'Permission denied') { Write-Host ''; Write-Host ${psQuote(refused(name))}; Write-Host $pub }; exit 1 } }`,
    "if (-not (Test-Path $k) -and -not (Test-Held)) { if (-not (Select-Agent)) { New-Key } }",
    "Read-Key",
    "$pre = ''",
    "Send-Key",
    `if (-not (Test-Path $k)) { ${reach} true *> $null; if ($LASTEXITCODE -ne 0) { Write-Host ${psQuote(AGENT_FAILED(name))}; $old = $pub; New-Key; Read-Key; $pre = "${forgetLine("$old")}"; Send-Key } }`,
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

const REMOVED = (name) => `Removed this computer's key from ${name}.`;
const NONE_THERE = (name) => `kansō had added no key on ${name}, so nothing was removed there.`;
const NO_KEY = "This computer has no kansō key, so there is nothing to remove.";
const UNREACHED = (name) => `${name} did not answer with the key, so nothing was removed.`;

function shRemoval(machine) {
  const name = nameOf(machine);
  const { reach } = keyedRoute(machine);
  const drop = dropLine.split(LINE).map(shellQuote).join('"$line"');
  return [
    `k=${KEY.replace("~", '"$HOME"')}`,
    `[ -f "$k.pub" ] || { echo ${shellQuote(NO_KEY)}; exit 1; }`,
    `${SH_LINE} || exit`,
    `said=$(${reach} ${drop} </dev/null) || { echo ${shellQuote(UNREACHED(name))}; exit 1; }`,
    `[ "$said" = removed ] || { echo ${shellQuote(NONE_THERE(name))}; exit 0; }`,
    `herdr-app do ${shellQuote(`kanso-spaces.remove-machine:${name}`)} >/dev/null 2>&1`,
    `echo ${shellQuote(REMOVED(name))}; echo; echo ${shellQuote(DONE)}`,
  ].join("\n");
}

function psRemoval(machine) {
  const name = nameOf(machine);
  const { reach } = keyedRoute(machine, "windows");
  const drop = `(${dropLine.split(LINE).map(psQuote).join(" + $line + ")})`;
  return [
    "$PSNativeCommandArgumentPassing = 'Legacy'",
    `$k = Join-Path $env:USERPROFILE '.ssh\\id_ed25519_kanso'`,
    `if (-not (Test-Path "$k.pub")) { Write-Host ${psQuote(NO_KEY)}; exit 1 }`,
    PS_PAIR,
    "$line = (Get-Pair) + ' kanso'",
    `$said = ${reach} ${drop}`,
    `if ($LASTEXITCODE -ne 0) { Write-Host ${psQuote(UNREACHED(name))}; exit 1 }`,
    `if ("$said".Trim() -ne 'removed') { Write-Host ${psQuote(NONE_THERE(name))}; exit 0 }`,
    `& herdr-app do ${psQuote(`kanso-spaces.remove-machine:${name}`)} *> $null`,
    `Write-Host ${psQuote(REMOVED(name))}; Write-Host ''; Write-Host '${DONE}'`,
  ].join("; ");
}

export function keyRemoval(machine, platform = "macos") {
  const route = { name: "", target: "", via: "", session: "", ...routeOf(machine) };
  return platform === "windows" ? ["powershell", "-NoProfile", "-Command", psRemoval(route)] : ["sh", "-c", shRemoval(route)];
}

export const removeKeyTab = (machine, platform = "macos") => ({ argv: keyRemoval(machine, platform), place: "right" });

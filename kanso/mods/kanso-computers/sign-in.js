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
export const AGENT_KEY = "~/.ssh/id_kanso_agent";
const keyedWords = (path) => `-o IdentityFile=${path} -o IdentitiesOnly=yes -o BatchMode=yes `;
const ROUTE_WORDS = [keyedWords(KEY), keyedWords(AGENT_KEY), `-i ${KEY} -o IdentitiesOnly=yes -o BatchMode=yes `];
const unkeyed = (via) => ROUTE_WORDS.reduce((rest, words) => rest.split(words).join(""), String(via ?? ""));
export const kansoKeyed = (via) => ROUTE_WORDS.some((words) => String(via ?? "").includes(words));
export const keyOfRoute = (via) => (String(via ?? "").includes(keyedWords(AGENT_KEY)) ? AGENT_KEY : KEY);
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
  return {
    ask,
    keyed: (path = KEY) => withSsh(base(windows ? String : shellQuote), keyedWords(path)),
    reach: (path = KEY) => withSsh(base(windows ? psQuote : shellQuote), keyedWords(path)),
  };
}

const nameOf = ({ name, target }) => name || splitTarget(destinationOf(target).dest).host;

const addLine = (route, { via, name, session, install = true }) => ["machine", "add", ...(via ? [] : [route]), ...(via ? ["--via", via] : []),
  "--name", name, ...(session ? ["--session", session] : []), ...(install ? ["--install"] : [])];

const pushLine = (pub, b64) => `umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qF '${b64}' ~/.ssh/authorized_keys || { printf '\\n%s\\n' '${pub}' >> ~/.ssh/authorized_keys && echo kanso-added; }`;
const LINE = "LINE";
const dropLine = `test -f ~/.ssh/authorized_keys || exit 0; grep -qxF '${LINE}' ~/.ssh/authorized_keys || { echo absent; exit 0; }; umask 077; grep -vxF '${LINE}' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.kanso; test $? -le 1 && mv ~/.ssh/authorized_keys.kanso ~/.ssh/authorized_keys && echo removed`;
const forgetLine = `umask 077; grep -vxF '${LINE}' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.kanso; test $? -le 1 && mv ~/.ssh/authorized_keys.kanso ~/.ssh/authorized_keys; rm -f ~/.ssh/authorized_keys.kanso; `;
const shSpliced = (template, variable) => template.split(LINE).map(shellQuote).join(`"$${variable}"`);
const psSpliced = (template, variable) => `(${template.split(LINE).map(psQuote).join(` + $${variable} + `)})`;
const shHome = (path) => path.replace("~", '"$HOME"');
const psHome = (path) => `Join-Path $env:USERPROFILE ${psQuote(path.slice(2).replace("/", "\\"))}`;
const VIA = "KANSO_VIA";

const SH_KEY = [
  `agent() { ssh-add -L 2>/dev/null | awk '$1 ~ /^(ssh-ed25519|ecdsa-sha2-nistp[0-9]+|ssh-rsa)$/ { print $1 " " $2 }'; }`,
  `held() { [ -f "$g.pub" ] && agent | grep -qxF "$(awk '{ print $1 " " $2 }' "$g.pub")"; }`,
  `pick() { a=$(agent); [ -n "$a" ] && printf '%s\\n' "$a" | awk '/^ssh-ed25519 / { print $0 " kanso"; f = 1; exit } NR == 1 { first = $0 } END { if (!f) print first " kanso" }' > "$g.pub"; }`,
  'own() { [ -f "$k" ] || { rm -f "$k.pub"; ssh-keygen -q -t ed25519 -N "" -C kanso -f "$k"; }; }',
  `lines() { pub=$(awk '{ print $1 " " $2 " kanso" }' "$1.pub") && b64=$(awk '{ print $2 }' "$1.pub") && line="${pushLine("$pub", "$b64")}"; }`,
];
const PS_START = ["$PSNativeCommandArgumentPassing = 'Legacy'", `$k = ${psHome(KEY)}`, `$g = ${psHome(AGENT_KEY)}`];
const PS_PAIR = "function Get-Pair($f) { ((Get-Content \"$f.pub\" -Raw).Trim() -split '\\s+')[0..1] -join ' ' }";
const PS_KEY = [
  "function Get-Agent { @(ssh-add -L 2>$null | Where-Object { $_ -match '^(ssh-ed25519|ecdsa-sha2-nistp\\d+|ssh-rsa) ' } | ForEach-Object { ($_ -split ' ')[0..1] -join ' ' }) }",
  PS_PAIR,
  "function Test-Held { (Test-Path \"$g.pub\") -and ((Get-Agent) -contains (Get-Pair $g)) }",
  "function Select-Agent { $a = Get-Agent; if (-not $a) { return $false }; (@($a | Where-Object { $_ -like 'ssh-ed25519 *' }) + $a)[0] + ' kanso' | Set-Content \"$g.pub\" -Encoding ascii; $true }",
  "function New-Own { if (-not (Test-Path $k)) { Remove-Item \"$k.pub\" -ErrorAction SilentlyContinue; ssh-keygen -q -t ed25519 -N '\"\"' -C kanso -f $k } }",
  "function Read-Key($f) { $script:pub = (Get-Pair $f) + ' kanso'; $script:b64 = (Get-Pair $f).Split(' ')[1] }",
];

function shSetup(machine, { replace }) {
  const name = nameOf(machine);
  const { ask, keyed, reach } = keyedRoute(machine);
  const hc = (args) => ["hc", ...args].map(shellQuote).join(" ");
  const back = addLine(machine.target, { via: machine.via, name, session: machine.session });
  const own = `lines "$k" || exit; push; via=${shellQuote(keyed(KEY))}`;
  return [
    `k=${shHome(KEY)}; g=${shHome(AGENT_KEY)}`,
    'mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh" || exit',
    ...SH_KEY,
    `push() { e=$(mktemp) || exit; said=$(${ask} "$line" 2>"$e"); s=$?; cat "$e" >&2; case $said in *kanso-added*) added=1 ;; *) added= ;; esac; [ "$s" -eq 0 ] || { grep -q "Permission denied" "$e" && { echo; echo ${shellQuote(refused(name))}; echo "$pub"; }; rm -f "$e"; exit 1; }; rm -f "$e"; }`,
    "if held || pick; then",
    '  lines "$g" || exit; push',
    `  if ${reach(AGENT_KEY)} true </dev/null >/dev/null 2>&1; then via=${shellQuote(keyed(AGENT_KEY))}`,
    `  else echo ${shellQuote(AGENT_FAILED(name))}; old=$pub; was=$added; own || exit; lines "$k" || exit; [ -z "$was" ] || line=${shSpliced(forgetLine, "old")}"$line"; push; via=${shellQuote(keyed(KEY))}; fi`,
    `else own || exit; ${own}; fi`,
    replace ? `${hc(["machine", "rm", name])} >/dev/null 2>&1` : "",
    `${hc(addLine("", { via: VIA, name, session: machine.session })).replace(VIA, '"$via"')} || { ${replace ? `${hc(back)} >/dev/null 2>&1; ` : ""}exit 1; }`,
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
    ...PS_START,
    "New-Item -ItemType Directory -Force (Split-Path $k) | Out-Null",
    ...PS_KEY,
    `function Send-Key { $said = ${ask} "$pre${pushLine("$pub", "$b64")}" 2>&1; $code = $LASTEXITCODE; $script:added = [bool]("$said" -match 'kanso-added'); $said | Where-Object { "$_" -notmatch 'kanso-added' } | Write-Host; if ($code -ne 0) { if ("$said" -match 'Permission denied') { Write-Host ''; Write-Host ${psQuote(refused(name))}; Write-Host $pub }; exit 1 } }`,
    "$pre = ''",
    `if ((Test-Held) -or (Select-Agent)) { Read-Key $g; Send-Key; ${reach(AGENT_KEY)} true *> $null; if ($LASTEXITCODE -eq 0) { $via = ${psQuote(keyed(AGENT_KEY))} } else { Write-Host ${psQuote(AGENT_FAILED(name))}; $old = $pub; $was = $added; New-Own; Read-Key $k; if ($was) { $pre = ${psSpliced(forgetLine, "old")} }; Send-Key; $via = ${psQuote(keyed(KEY))} } }`,
    `else { New-Own; Read-Key $k; Send-Key; $via = ${psQuote(keyed(KEY))} }`,
    replace ? `${hc(["machine", "rm", name])} *> $null` : "",
    hc(addLine("", { via: VIA, name, session: machine.session })).replace(psQuote(VIA), "$via"),
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
const STILL_LISTED = (name) => `Removed this computer's key from ${name}, but Herdr still lists ${name}: remove it from the sidebar.`;
const NONE_THERE = (name) => `kansō had added no key on ${name}, so nothing was removed there.`;
const NO_KEY = "This computer has no kansō key, so there is nothing to remove.";
const UNREACHED = (name) => `${name} did not answer with the key, so nothing was removed.`;

function shRemoval(machine, name, path) {
  const { reach } = keyedRoute(machine);
  return [
    `k=${shHome(path)}`,
    `[ -f "$k.pub" ] || { echo ${shellQuote(NO_KEY)}; exit 1; }`,
    `line=$(awk '{ print $1 " " $2 " kanso" }' "$k.pub") || exit`,
    `said=$(${reach(path)} ${shSpliced(dropLine, "line")} </dev/null) || { echo ${shellQuote(UNREACHED(name))}; exit 1; }`,
    `[ "$said" = removed ] || { echo ${shellQuote(NONE_THERE(name))}; exit 0; }`,
    `herdr-app do ${shellQuote(`kanso-spaces.remove-machine:${name}`)} >/dev/null 2>&1 || { echo ${shellQuote(STILL_LISTED(name))}; exit 1; }`,
    `echo ${shellQuote(REMOVED(name))}; echo; echo ${shellQuote(DONE)}`,
  ].join("\n");
}

function psRemoval(machine, name, path) {
  const { reach } = keyedRoute(machine, "windows");
  return [
    ...PS_START,
    `$f = ${path === AGENT_KEY ? "$g" : "$k"}`,
    `if (-not (Test-Path "$f.pub")) { Write-Host ${psQuote(NO_KEY)}; exit 1 }`,
    PS_PAIR,
    "$line = (Get-Pair $f) + ' kanso'",
    `$said = ${reach(path)} ${psSpliced(dropLine, "line")}`,
    `if ($LASTEXITCODE -ne 0) { Write-Host ${psQuote(UNREACHED(name))}; exit 1 }`,
    `if ("$said".Trim() -ne 'removed') { Write-Host ${psQuote(NONE_THERE(name))}; exit 0 }`,
    `& herdr-app do ${psQuote(`kanso-spaces.remove-machine:${name}`)} *> $null`,
    `if ($LASTEXITCODE -ne 0) { Write-Host ${psQuote(STILL_LISTED(name))}; exit 1 }`,
    `Write-Host ${psQuote(REMOVED(name))}; Write-Host ''; Write-Host '${DONE}'`,
  ].join("; ");
}

export function keyRemoval(machine, platform = "macos") {
  const route = { name: "", target: "", via: "", session: "", ...routeOf(machine) };
  const [name, path] = [nameOf(route), keyOfRoute(route.via)];
  return platform === "windows" ? ["powershell", "-NoProfile", "-Command", psRemoval(route, name, path)] : ["sh", "-c", shRemoval(route, name, path)];
}

export const removeKeyTab = (machine, platform = "macos") => ({ argv: keyRemoval(machine, platform), place: "right" });

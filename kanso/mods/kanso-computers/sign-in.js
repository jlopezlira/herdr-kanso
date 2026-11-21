import { psQuote, shellQuote } from "./platform-command.js";

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

export function routeOf(machine) {
  if (!machine) return { name: "", target: "", via: "", session: "" };
  const text = (value) => (typeof value === "string" && value !== "false" && value !== "null" ? value.trim() : "");
  const through = machine.via === true || machine.via === 1 || /\s/.test(text(machine.target));
  return {
    name: String(machine.name ?? ""),
    target: through ? "" : text(machine.target),
    via: through ? text(machine.target) : text(machine.via),
    session: text(machine.session),
  };
}

export function keyable({ target = "", via = "" }, platform = "macos") {
  if (!via) return Boolean(target);
  if (platform === "windows" || /tailscale/i.test(via)) return false;
  return new RegExp(SSH.source).test(via);
}

export function keyedRoute({ target = "", via = "" }, platform = "macos") {
  const windows = platform === "windows";
  const base = (quote) => via || sshLine(target, quote);
  return { ask: withSsh(base(windows ? psQuote : shellQuote), ASK), keyed: withSsh(base(windows ? String : shellQuote), KEYED) };
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

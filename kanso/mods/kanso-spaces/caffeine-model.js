import { psQuote, shellQuote } from "./platform-command.js";
import { xmlText, PLIST_HEAD } from "./platform-plist.js";

export const LOW = 15;
export const EVERY_MS = 270_000;
export const SETUP_EVERY_MS = 10_000;
export const SETUP_FOR_MS = 600_000;
export const CALL_MS = 30_000;
const CHECK_S = 60;
const MARK = "kanso-caffeine";
const WORDS = ["on", "off", "setup", "low", "missing", "refused", "busy"];
const KIND = { darwin: "macos", macos: "macos", linux: "linux", windows: "windows" };

export const kindOf = (os) => KIND[String(os ?? "").toLowerCase()] ?? null;

const PMSET = "/usr/bin/pmset -a disablesleep";
const MARKER = "/var/db/kanso-caffeine";
const GUARD = `dev.kanso.caffeine.guard`;
const agent = (args) => `${PLIST_HEAD}
<plist version="1.0"><dict><key>Label</key><string>LABEL</string><key>RunAtLoad</key><true/>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xmlText(arg)}</string>`).join("")}</array></dict></plist>`;
const plistAt = (plist, path) => {
  const [head, tail] = plist.split("SLOT");
  return `printf '%s%s%s\\n' ${shellQuote(head)} "$(printf '%s' ${path} | sed -e 's/&/\\&amp;/g' -e 's/</\\&lt;/g' -e 's/>/\\&gt;/g')" ${shellQuote(tail)}`;
};
const LAUNCH = (verb, target) => `u=$(id -u); launchctl ${verb} gui/$u${target} 2>/dev/null || launchctl ${verb} user/$u${target} 2>/dev/null`;
const SH_DIR = `d="$HOME/.local/state/${MARK}"`;
const SH_ALIVE = `alive() { p=$(cat "$d/pid" 2>/dev/null) && [ -n "$p" ] && ps -p "$p" -o command= 2>/dev/null | grep -q ${MARK}; }`;
const SH_WAIT = 'i=0; while [ "$i" -lt 20 ]; do alive && { echo on; exit 0; }; sleep 0.1; i=$((i + 1)); done';
const SH_LOCK = `lock() { i=0; until mkdir "$d/lock" 2>/dev/null && echo $$ > "$d/lock/pid"; do o=$(cat "$d/lock/pid" 2>/dev/null); if [ -n "$o" ] && ! kill -0 "$o" 2>/dev/null; then rm -rf "$d/lock"; continue; fi; i=$((i + 1)); [ "$i" -gt 50 ] && { echo busy; exit 0; }; sleep 0.1; done; trap '[ "$(cat "$d/lock/pid" 2>/dev/null)" = "$$" ] && rm -rf "$d/lock"' EXIT; }`;

const MAC = {
  low: `low() { b=$(pmset -g batt); case "$b" in *"Battery Power"*) p=$(printf '%s' "$b" | grep -Eo '[0-9]+%' | head -n 1 | tr -d %); [ "\${p:-100}" -le ${LOW} ];; *) return 1;; esac; }`,
  held: "held() { pmset -g | grep -Eq '^[[:space:]]*SleepDisabled[[:space:]]+1'; }",
  restore: `sudo -n ${PMSET} "$(cat "$d/prior" 2>/dev/null || echo 0)" 2>/dev/null && sudo -n /bin/rm -f ${MARKER} && rm -f "$d/prior"`,
  hold: [`[ -f "$d/prior" ] || { if held; then echo 1; else echo 0; fi; } > "$d/prior"`,
    `if [ "$(cat "$d/prior")" = 0 ]; then sudo -n /usr/bin/touch ${MARKER} 2>/dev/null || { rm -f "$d/prior"; echo setup; exit 0; }; fi`,
    `sudo -n ${PMSET} 1 2>/dev/null || { sudo -n /bin/rm -f ${MARKER} 2>/dev/null; rm -f "$d/prior"; echo setup; exit 0; }`],
  start: `${plistAt(agent(["/bin/sh", "SLOT"]).replace("LABEL", GUARD), '"$d/guard.sh"')} > "$d/guard.plist" && { ${LAUNCH("bootout", `/${GUARD}`)}; ${LAUNCH("bootstrap", ' "$d/guard.plist"')}; }`,
  stop: LAUNCH("bootout", `/${GUARD}`),
  failed: "stop; restore; echo missing",
};

const LINUX = {
  low: `low() { for b in /sys/class/power_supply/BAT*; do [ -r "$b/capacity" ] || continue; [ "$(cat "$b/status" 2>/dev/null)" = Discharging ] && [ "$(cat "$b/capacity")" -le ${LOW} ] && return 0; done; return 1; }`,
  held: "held() { false; }",
  restore: ":",
  hold: ["command -v systemd-inhibit >/dev/null 2>&1 && command -v systemd-run >/dev/null 2>&1 || { echo missing; exit 0; }"],
  start: 'systemctl --user stop kanso-caffeine 2>/dev/null; systemd-run --user --collect --quiet --unit=kanso-caffeine systemd-inhibit --what=handle-lid-switch:sleep:idle --who=kansō --why=Caffeine --mode=block /bin/sh "$d/guard.sh" >/dev/null 2>&1 </dev/null',
  stop: "systemctl --user stop kanso-caffeine 2>/dev/null",
  failed: "stop; echo setup",
};

const shHead = (os) => [SH_DIR, SH_ALIVE, SH_LOCK, os.low, os.held, `restore() { ${os.restore}; }`, `stop() { ${os.stop}; }`, 'mkdir -p "$d" || exit 1'];

const shGuard = (os) => [`: ${MARK}`, ...shHead(os), 'echo $$ > "$d/pid"',
  `while sleep ${CHECK_S}; do [ "$(cat "$d/pid" 2>/dev/null)" = "$$" ] || exit 0; if low; then lock; rm -f "$d/pid"; echo battery > "$d/reason"; restore; exit 0; fi; done`].join("\n");

const shScripts = (os) => ({
  on: [...shHead(os), "lock", "alive && { echo on; exit 0; }", "low && { echo low; exit 0; }", 'rm -f "$d/reason" "$d/pid"',
    `printf '%s\\n' ${shellQuote(shGuard(os))} > "$d/guard.sh" || exit 1`, ...os.hold, `{ ${os.start}; } || { ${os.failed}; exit 0; }`, SH_WAIT, os.failed].join("\n"),
  off: [...shHead(os), "lock", 'if alive; then kill "$p" 2>/dev/null; fi', 'rm -f "$d/pid"', "stop", 'if [ -f "$d/prior" ]; then restore || { echo setup; exit 0; }; fi', "echo off"].join("\n"),
  read: [...shHead(os), "lock", 'r=$(cat "$d/reason" 2>/dev/null); rm -f "$d/reason"', "alive && { echo on; exit 0; }", 'if [ -f "$d/prior" ]; then restore || { echo on; exit 0; }; fi', 'rm -f "$d/pid"', "stop", '[ -n "$r" ] || ! low || r=low', 'echo "off $r"'].join("\n"),
});

const PS_HEAD = [
  `$d = Join-Path $env:LOCALAPPDATA '${MARK}'`,
  "New-Item -ItemType Directory -Force -Path $d | Out-Null",
  "$pf = Join-Path $d 'pid'; $rf = Join-Path $d 'reason'; $gf = Join-Path $d 'guard.ps1'",
  `function Test-Alive { if (-not (Test-Path $pf)) { return $false }; $n = (Get-Content $pf -Raw) -as [int]; if (-not $n) { return $false }; $p = Get-CimInstance Win32_Process -Filter "ProcessId = $n" -ErrorAction SilentlyContinue; [bool]($p -and $p.CommandLine -like '*${MARK}*') }`,
  `function Test-Low { [bool](@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue) | Where-Object { $_.BatteryStatus -eq 1 -and $_.EstimatedChargeRemaining -le ${LOW} }) }`,
];
const PS_GUARD = [...PS_HEAD,
  "Add-Type -Namespace Kanso -Name Caffeine -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'",
  "Set-Content -Path $pf -Value $PID",
  `while ($true) { [void][Kanso.Caffeine]::SetThreadExecutionState([uint32]0x80000001); Start-Sleep -Seconds ${CHECK_S}; if (((Get-Content $pf -Raw -ErrorAction SilentlyContinue) -as [int]) -ne $PID) { exit }; if (Test-Low) { Remove-Item $pf; Set-Content -Path $rf -Value battery; exit } }`,
].join("; ");

const PS = {
  on: [...PS_HEAD, "if (Test-Alive) { 'on'; exit }", "if (Test-Low) { 'low'; exit }", "Remove-Item $rf, $pf -ErrorAction SilentlyContinue",
    `Set-Content -Path $gf -Value ${psQuote(PS_GUARD)}`,
    "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('\"' + $gf + '\"')",
    "for ($i = 0; $i -lt 20; $i++) { if (Test-Alive) { 'on'; exit }; Start-Sleep -Milliseconds 100 }", "'missing'"].join("\n"),
  off: [...PS_HEAD, "if (Test-Alive) { Stop-Process -Id ((Get-Content $pf -Raw) -as [int]) -Force -ErrorAction SilentlyContinue }", "Remove-Item $pf -ErrorAction SilentlyContinue", "'off'"].join("\n"),
  read: [...PS_HEAD, "$r = Get-Content $rf -Raw -ErrorAction SilentlyContinue; Remove-Item $rf -ErrorAction SilentlyContinue", "if (Test-Alive) { 'on'; exit }", "Remove-Item $pf -ErrorAction SilentlyContinue", "if (-not \"$r\".Trim() -and (Test-Low)) { $r = 'low' }", "'off ' + \"$r\".Trim()"].join("\n"),
};

const SCRIPTS = { macos: shScripts(MAC), linux: shScripts(LINUX) };

export function caffeineCall(os, verb) {
  const kind = kindOf(os);
  if (kind === "windows") return { command: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", PS[verb]] };
  const script = SCRIPTS[kind]?.[verb];
  return script ? { command: "sh", args: ["-c", script] } : null;
}

export function answerOf(result) {
  if (!result || result.threw || !(result.ok === true || result.code === 0)) return { word: null, battery: false, low: false };
  const [word = "", why = ""] = String(result.stdout ?? "").trim().split(/\s+/);
  return { word: WORDS.includes(word) ? word : null, battery: word === "off" && why === "battery", low: word === "off" && why === "low" };
}

const SUDOERS = `printf '%s ALL=(root) NOPASSWD: ${PMSET} 1, ${PMSET} 0, /usr/bin/touch ${MARKER}, /bin/rm -f ${MARKER}\n' "$(id -un)" > "$f"`;
const DAEMON = agent(["/bin/sh", "-c", `[ -f ${MARKER} ] || exit 0; ${PMSET} 0 && /bin/rm -f ${MARKER}`]).replace("LABEL", "dev.kanso.caffeine");
const POLKIT = `polkit.addRule(function (action, subject) {
  if (subject.user == "USER" && ["org.freedesktop.login1.inhibit-handle-lid-switch", "org.freedesktop.login1.inhibit-block-sleep", "org.freedesktop.login1.inhibit-block-idle"].indexOf(action.id) >= 0) return polkit.Result.YES;
});`;

const SETUP = {
  macos: [
    "echo 'Caffeine keeps this computer awake with its lid closed. macOS asks for your password once, so kansō can turn sleep off and on, and turn it back after a restart.'",
    'f=$(mktemp) && p=$(mktemp) || exit 1', SUDOERS, `printf '%s\\n' ${shellQuote(DAEMON)} > "$p"`,
    'sudo /usr/sbin/visudo -cf "$f" >/dev/null && sudo install -m 0440 -o root -g wheel "$f" /etc/sudoers.d/kanso-caffeine && sudo install -m 0644 -o root -g wheel "$p" /Library/LaunchDaemons/dev.kanso.caffeine.plist; ok=$?; rm -f "$f" "$p"',
  ],
  linux: [
    "echo 'Caffeine keeps this computer awake with its lid closed. Linux asks for your password once, so your user can hold off sleep, idle and the lid, and nothing else.'",
    'f=$(mktemp) || exit 1', `printf '%s\\n' ${shellQuote(POLKIT)} | sed "s|USER|$(id -un)|" > "$f"`,
    'sudo install -m 0644 "$f" /etc/polkit-1/rules.d/49-kanso-caffeine.rules; ok=$?; rm -f "$f"',
  ],
};

const DONE = { on: "Caffeine is on. This tab can close.", off: "Caffeine is off. This tab can close." };

export function setupArgv(os, verb = "on") {
  const kind = kindOf(os);
  const steps = SETUP[kind];
  if (!steps || !DONE[verb]) return null;
  const then = `sh -c ${shellQuote(SCRIPTS[kind][verb])}`;
  return ["sh", "-c", [...steps, `[ "$ok" = 0 ] || { echo 'Caffeine was not set up.'; exit 1; }`, `r=$(${then})`,
    `if [ "$r" = ${verb} ]; then echo ${shellQuote(DONE[verb])}; elif [ "$r" = low ]; then echo 'Caffeine is set up but did not turn on: the battery is at ${LOW}% or less.'; else echo 'Caffeine is set up but did not change.'; fi`].join("\n")];
}

const osOfProbe = (result) => {
  if (result?.missing || [127, 9009, "ENOENT"].includes(result?.code)) return "windows";
  if (!(result?.ok === true || result?.code === 0)) return null;
  return { Darwin: "macos", Linux: "linux" }[String(result.stdout ?? "").trim()] ?? null;
};

const EMPTY = Object.freeze({ state: "off", readAt: null, setupUntil: 0 });

export function createCaffeine({ run, local, now = () => Date.now() }) {
  return {
    rows: new Map(),
    systems: new Map(),
    chains: new Map(),
    row(key) { return this.rows.get(key) ?? EMPTY; },
    put(key, change) { this.rows.set(key, { ...this.row(key), ...change }); },
    queued(key, work) {
      const next = (this.chains.get(key) ?? Promise.resolve()).then(work, work);
      this.chains.set(key, next.catch(() => null));
      return next;
    },
    async probe(key) {
      if (!key) return kindOf(local);
      if (this.systems.has(key)) return this.systems.get(key);
      const os = await run({ command: "uname", args: ["-s"], on: key, timeout: CALL_MS }).then(osOfProbe, (error) => osOfProbe({ code: error?.code }));
      if (os) this.systems.set(key, os);
      return os;
    },
    async call(key, verb) {
      const os = await this.probe(key);
      const spec = caffeineCall(os, verb);
      if (!spec) return { word: null, battery: false, os, verb };
      const result = await run({ ...spec, ...(key ? { on: key } : {}), timeout: CALL_MS }).catch(() => ({ threw: true }));
      return { ...answerOf(result), os, verb };
    },
    settle(key, answer, changed = false) {
      const low = answer.word === "low" || (answer.low && this.settingUp(key) === "on");
      const state = answer.word === "low" ? "off" : answer.word;
      const sure = state === "on" || state === "off";
      const { pending = 0 } = this.row(key);
      const reason = low ? { battery: true, told: true } : answer.battery ? { battery: true, told: false } : state === "on" ? { battery: false } : {};
      this.put(key, { ...(sure ? { state } : {}), ...(changed && sure ? { setupUntil: 0 } : {}), unsure: !sure, pending: Math.max(0, pending - (changed ? 1 : 0)), readAt: now(), ...reason });
      return answer;
    },
    isOn(key) { return this.row(key).state === "on"; },
    isBusy(key) { return (this.row(key).pending ?? 0) > 0; },
    isSure(key) { return this.row(key).readAt != null && !this.row(key).unsure; },
    onKeys() { return [...this.rows.entries()].filter(([, value]) => value.state === "on").map(([key]) => key); },
    keep(keys) { [...this.rows.keys()].filter((key) => !keys.includes(key)).forEach((key) => this.rows.delete(key)); },
    untold(key) {
      const { battery, told } = this.row(key);
      if (battery && !told) this.put(key, { told: true });
      return Boolean(battery && !told);
    },
    look(key) {
      const { state, pending, want, battery, unsure, readAt, setupUntil } = this.row(key);
      return { on: state === "on", busy: (pending ?? 0) > 0, want: want === true, battery: battery === true, read: readAt != null && !unsure, setup: setupUntil > now() };
    },
    settingUp(key) { return this.row(key).setupUntil > now() ? this.row(key).setupVerb : null; },
    setup(key, verb) { this.put(key, { setupUntil: now() + SETUP_FOR_MS, setupVerb: verb }); },
    done(key) { this.put(key, { setupUntil: 0 }); },
    change(key, on) {
      this.put(key, { pending: (this.row(key).pending ?? 0) + 1, want: on ?? !this.isOn(key), battery: false });
      return this.queued(key, () => this.call(key, (on ?? !this.isOn(key)) ? "on" : "off").then((answer) => this.settle(key, answer, true)));
    },
    read(key) {
      return this.queued(key, () => this.call(key, "read").then((answer) => this.settle(key, answer)));
    },
    due(keys, at = now()) {
      return keys.filter((key) => {
        const { readAt, setupUntil, unsure, state } = this.row(key);
        if (readAt == null) return true;
        if (setupUntil > at) return at - readAt >= SETUP_EVERY_MS;
        return (unsure || state === "on") && at - readAt >= EVERY_MS;
      });
    },
    nextWait(keys, at = now()) {
      const waits = keys.map((key) => {
        const { readAt, setupUntil, unsure, state } = this.row(key);
        if (readAt == null) return 0;
        if (setupUntil > at) return Math.max(0, readAt + SETUP_EVERY_MS - at);
        return unsure || state === "on" ? Math.max(0, readAt + EVERY_MS - at) : null;
      }).filter((wait) => wait != null);
      return waits.length ? Math.min(...waits) : null;
    },
  };
}

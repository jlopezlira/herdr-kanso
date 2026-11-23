import { psQuote } from "./platform-command.js";

export const CLOCK_LABEL = "kanso.clock";
export const RUN_LABEL = "kanso.run";
export const TICK_S = 20;
export const PLAN_RUNS = 60;
const NAME_MAX = 32;
const DAY_MS = 86_400_000;
const UNIT_MS = Object.freeze({ minutes: 60_000, hours: 3_600_000 });

const hash = (text) => [...String(text)].reduce((h, ch) => (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0, 7).toString(36);
export const clockName = (kind, id) => {
  const name = `kanso-${kind}-${String(id).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-")}`;
  if (name.length <= NAME_MAX) return name;
  const tail = `-${hash(id)}`;
  return name.slice(0, NAME_MAX - tail.length) + tail;
};
export const localId = (id) => String(id ?? "").split("/").at(-1);
export const machineOfAddress = (address) => (String(address ?? "").includes("/") ? String(address).split("/")[0] : null);
const seconds = (ms) => Math.floor(ms / 1000);

const RESUME_SH = [
  'at=$1; t=$2; tok=$3; cmd=$4',
  'want="\\"kanso.limit.resume\\":\\"$tok\\""',
  'clear() { hc label "$t" kanso.limit= kanso.limit.resume= kanso.limit.cmd=; exit 0; }',
  `while [ "$(date +%s)" -lt "$at" ]; do sleep ${TICK_S}; done`,
  'while :; do',
  '  j=$(hc get "$t" --json 2>/dev/null) || exit 0',
  '  case "$j" in *"$want"*) ;; *) exit 0 ;; esac',
  '  case "$j" in',
  '    *\'"state":"working"\'*) clear ;;',
  '    *\'"state":"blocked"\'*) ;;',
  '    *\'"state":"done"\'*|*\'"state":"idle"\'*) hc send "$t" continue >/dev/null 2>&1 && clear ;;',
  '    *) [ -n "$cmd" ] && hc send "$t" "$cmd" >/dev/null 2>&1 && clear ;;',
  '  esac',
  `  sleep ${TICK_S}`,
  'done',
].join("\n");

const resumePs = (at, address, token, cmd) => [
  `$at = ${Number(at)}; $t = ${psQuote(address)}; $tok = ${psQuote(token)}; $cmd = ${psQuote(cmd ?? "")}`,
  "function Clear { hc label $t kanso.limit= kanso.limit.resume= kanso.limit.cmd= | Out-Null; exit 0 }",
  `while ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -lt $at) { Start-Sleep -Seconds ${TICK_S} }`,
  "while ($true) { $j = (hc get $t --json 2>$null) | ConvertFrom-Json; if (-not $j -or $j.labels.'kanso.limit.resume' -ne $tok) { exit 0 }; $s = $j.status.state;" +
    " if ($s -eq 'working') { Clear } elseif ($s -in 'done','idle') { hc send $t continue | Out-Null; if ($LASTEXITCODE -eq 0) { Clear } }" +
    ` elseif ($s -ne 'blocked' -and $cmd) { hc send $t $cmd | Out-Null; if ($LASTEXITCODE -eq 0) { Clear } }; Start-Sleep -Seconds ${TICK_S} }`,
].join("; ");

const waiter = (platform, sh, ps, args) => (platform === "windows"
  ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps]
  : ["sh", "-c", sh, "kanso-clock", ...args.map(String)]);

export function resumeWaiter({ platform, address, until, token, command = "", grace = 0 }) {
  const at = seconds(until + grace);
  return waiter(platform, RESUME_SH, resumePs(at, address, token, command), [at, address, token, command]);
}

export function runArgs({ cwd, space, on = null, id = null, name = null, tab = null }) {
  return [
    "run", "--bg", "--no-parent", "--outlive-parent",
    ...(on ? ["--on", on] : []),
    "--cwd", cwd,
    "--label", `herdr.space=${localId(space)}`,
    ...(tab ? ["--label", `herdr.tab=${localId(tab)}`] : []),
    "--label", "herdr.seen=0",
    ...(id ? ["--label", `${RUN_LABEL}=${id}`] : []),
    ...(name ? ["--label", `kanso.name=${name}`] : []),
    "--",
  ];
}

const SCHEDULE_SH = [
  'id=$1; log=$2; mode=$3; spec=$4; on=$5; folder=$6; space=$7; tree=$8; from=$9; shift 9; dir=$1; slug=$2; add=$3; shift 3',
  'x() { if [ -n "$on" ]; then hc exec --on "$on" -- "$@"; else "$@"; fi; }',
  'say() { printf \'%s %s\\n\' "$(date +%s)" "$1" >> "$log"; }',
  'fire() {',
  '  cwd=$folder',
  '  if [ "$tree" = 1 ]; then',
  '    branch="kanso/$slug-$(date +%Y%m%d-%H%M)"',
  '    x git -C "$folder" fetch --quiet origin "$from" >/dev/null 2>&1',
  '    start="origin/$from"; x git -C "$folder" rev-parse --verify --quiet "$start" >/dev/null 2>&1 || start=$from',
  '    if ! out=$(x sh -c "$add" sh "$folder" "$branch" "$dir" "$start" 2>&1); then say "failed $(printf %s "$out" | tail -n 1)"; return; fi',
  '    cwd=$(printf %s "$out" | tail -n 1 | cut -f2)',
  '  fi',
  '  if [ -n "$on" ]; then out=$(hc run --bg --no-parent --outlive-parent --on "$on" --cwd "$cwd" --label "herdr.space=$space" --label herdr.seen=0 --label "kanso.run=$id" -- "$@" 2>&1)',
  '  else out=$(hc run --bg --no-parent --outlive-parent --cwd "$cwd" --label "herdr.space=$space" --label herdr.seen=0 --label "kanso.run=$id" -- "$@" 2>&1); fi',
  '  if [ $? -eq 0 ]; then say ran; else say "failed $(printf %s "$out" | tail -n 1)"; fi',
  '}',
  'mkdir -p "$(dirname "$log")"',
  'if [ "$mode" = every ]; then',
  '  t=${spec% *}; step=${spec#* }',
  `  while :; do while [ "$(date +%s)" -lt "$t" ]; do sleep ${TICK_S}; done; fire "$@"; now=$(date +%s); while [ "$t" -le "$now" ]; do t=$((t + step)); done; done`,
  'fi',
  'last=0',
  'for t in $spec; do',
  '  [ "$t" -le "$last" ] && continue',
  `  while [ "$(date +%s)" -lt "$t" ]; do sleep ${TICK_S}; done`,
  '  fire "$@"; last=$(date +%s)',
  'done',
].join("\n");

const schedulePs = (job) => {
  const q = psQuote;
  const words = job.argv.map(q).join(", ");
  const on = job.on ? `@('--on', ${q(job.on)})` : "@()";
  return [
    `$id = ${q(job.id)}; $log = ${q(job.log)}; $mode = ${q(job.mode)}; $spec = ${q(job.spec)}; $folder = ${q(job.folder)}; $space = ${q(localId(job.space))}`,
    `$tree = ${job.tree ? 1 : 0}; $from = ${q(job.from ?? "")}; $dir = ${q(job.dir ?? "")}; $slug = ${q(job.slug ?? "run")}; $on = ${on}; $words = @(${words})`,
    "New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null",
    "function Now { [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }",
    "function Say($w) { Add-Content -Path $log -Value \"$(Now) $w\" }",
    "function Git { if ($on.Count) { hc exec @on -- git @args } else { git @args } }",
    "function Fire { $cwd = $folder; if ($tree -eq 1) { $stamp = Get-Date -Format 'yyyyMMdd-HHmm'; $branch = \"kanso/$slug-$stamp\"; $cwd = Join-Path $dir \"$slug-$stamp\"; Git -C $folder fetch --quiet origin $from 2>&1 | Out-Null; $start = \"origin/$from\"; Git -C $folder rev-parse --verify --quiet $start 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { $start = $from }; $out = Git -C $folder worktree add -b $branch $cwd $start 2>&1; if ($LASTEXITCODE -ne 0) { Say \"failed $(@($out)[-1])\"; return } }; $out = hc run --bg --no-parent --outlive-parent @on --cwd $cwd --label \"herdr.space=$space\" --label herdr.seen=0 --label \"kanso.run=$id\" -- @words 2>&1; if ($LASTEXITCODE -eq 0) { Say 'ran' } else { Say \"failed $(@($out)[-1])\" } }",
    "function Until($t) { while ((Now) -lt $t) { Start-Sleep -Seconds " + TICK_S + " } }",
    "if ($mode -eq 'every') { $p = $spec -split ' '; $t = [long]$p[0]; $step = [long]$p[1]; while ($true) { Until $t; Fire; $n = Now; while ($t -le $n) { $t += $step } } }",
    "$last = 0; foreach ($t in ($spec -split ' ' | ForEach-Object { [long]$_ })) { if ($t -le $last) { continue }; Until $t; Fire; $last = Now }",
  ].join("\n");
};

export function scheduleWaiter(job) {
  const args = [job.id, job.log, job.mode, job.spec, job.on ?? "", job.folder, localId(job.space), job.tree ? 1 : 0, job.from ?? "", job.dir ?? "", job.slug ?? "run", job.add ?? "", ...job.argv];
  return waiter(job.platform, SCHEDULE_SH, schedulePs(job), args);
}

export function waiterArgs(name, kind, argv, labels = {}) {
  const more = Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
  return ["run", "--bg", "--no-parent", "--outlive-parent", "--rm", "--name", name, "--label", `${CLOCK_LABEL}=${kind}`, ...more, "--", ...argv];
}

const LAUNCH = [
  'shell=${SHELL:-/bin/sh}',
  'case "${shell##*/}" in',
  '  fish) exec "$shell" -lic \'command $argv[2..]; exec $argv[1] -li\' "$shell" "$@" ;;',
  '  sh|bash|zsh|dash|ksh) exec "$shell" -lic \'"$@"; exec "$0" -li\' "$shell" "$@" ;;',
  '  *) exec sh -c \'"$@"; exec "${SHELL:-sh}" -i\' sh "$@" ;;',
  'esac',
].join("\n");

const psLine = (words) => `& ${words.map(psQuote).join(" ")}`;

export function agentLaunch(platform, argv, prompt = "") {
  const words = [...argv, ...(String(prompt).trim() ? [String(prompt).trim()] : [])].map(String);
  return platform === "windows" ? ["powershell.exe", "-NoLogo", "-NoExit", "-Command", psLine(words)] : ["sh", "-c", LAUNCH, "sh", ...words];
}

const pad = (n) => String(n).padStart(2, "0");
const dayAt = (ms, i) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).getTime(); };
const atClock = (dayMs, time) => {
  const [h, m] = String(time).split(":").map(Number);
  const d = new Date(dayMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0, 0, 0).getTime();
};
const stepOf = (when) => Math.max(1, Number(when.every) || 1) * (UNIT_MS[when.unit] ?? UNIT_MS.minutes);
const daysOf = (when) => (Array.isArray(when.days) && when.days.length ? when.days : [0, 1, 2, 3, 4, 5, 6]);

export function validWhen(when) {
  if (when?.kind === "daily") return /^\d{1,2}:\d{2}$/.test(String(when.time ?? "")) && daysOf(when).every((d) => d >= 0 && d <= 6);
  if (when?.kind === "every") return Number(when.every) >= 1 && Object.hasOwn(UNIT_MS, when.unit) && Number.isFinite(Number(when.start));
  if (when?.kind === "once") return Number.isFinite(Number(when.at)) && Number(when.at) > 0;
  return false;
}

function everyRuns(when, from, count) {
  const step = stepOf(when), start = Number(when.start);
  const first = start > from ? start : start + (Math.floor((from - start) / step) + 1) * step;
  return Array.from({ length: count }, (_, i) => first + i * step);
}

function everyLast(when, after, upTo) {
  const step = stepOf(when), start = Number(when.start);
  if (start > upTo) return null;
  const last = start + Math.floor((upTo - start) / step) * step;
  return last > after ? last : null;
}

export function nextRuns(when, from, count = PLAN_RUNS) {
  if (!validWhen(when) || count <= 0) return [];
  if (when.kind === "once") return Number(when.at) > from ? [Number(when.at)] : [];
  if (when.kind === "every") return everyRuns(when, from, count);
  const days = new Set(daysOf(when));
  return Array.from({ length: (count + 1) * 7 + 1 }, (_, i) => atClock(dayAt(from, i), when.time)).filter((at) => at > from && days.has(new Date(at).getDay())).slice(0, count);
}

export const nextRun = (when, from) => nextRuns(when, from, 1)[0] ?? null;

export function lastDue(when, after, upTo) {
  if (!validWhen(when) || upTo <= after) return null;
  if (when.kind === "once") return Number(when.at) > after && Number(when.at) <= upTo ? Number(when.at) : null;
  if (when.kind === "every") return everyLast(when, after, upTo);
  const days = new Set(daysOf(when));
  const last = Array.from({ length: 8 }, (_, i) => atClock(dayAt(upTo, -i), when.time)).find((at) => at <= upTo && days.has(new Date(at).getDay()));
  return last && last > after ? last : null;
}

export function waiterPlan(when, { now, since }) {
  const missed = lastDue(when, since, now) != null;
  if (when.kind === "every") {
    const next = missed ? now : nextRun(when, now);
    return next == null ? null : { mode: "every", spec: `${seconds(next)} ${seconds(stepOf(when))}` };
  }
  const times = [...(missed ? [now] : []), ...nextRuns(when, now, PLAN_RUNS)];
  return times.length ? { mode: "at", spec: times.map(seconds).join(" ") } : null;
}

export function parseRunLog(text) {
  return String(text ?? "").split(/\r?\n/).map((line) => line.match(/^(\d+) (ran|failed)(?: (.*))?$/)).filter(Boolean)
    .map(([, at, what, why]) => ({ at: Number(at) * 1000, ok: what === "ran", why: why?.trim() || null }));
}

export function lastOutcome(text) {
  const rows = parseRunLog(text);
  const last = rows.at(-1) ?? null;
  return { lastRun: rows.filter((r) => r.ok).at(-1)?.at ?? null, failed: last && !last.ok ? last : null };
}

export const slugOf = (text, fallback = "run") => String(text ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/, "") || fallback;

export function whenWords(when) {
  if (!validWhen(when)) return "";
  if (when.kind === "once") return `${new Date(Number(when.at)).toDateString().slice(4, 10)} ${new Date(Number(when.at)).toTimeString().slice(0, 5)}`;
  if (when.kind === "every") return `Every ${Number(when.every)} ${Number(when.every) === 1 ? when.unit.replace(/s$/, "") : when.unit}`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = daysOf(when);
  const which = days.length === 7 ? "Every day" : days.join() === "1,2,3,4,5" ? "Weekdays" : days.map((d) => names[d]).join(" ");
  const [h, m] = String(when.time).split(":").map(Number);
  return `${which} at ${pad(h)}:${pad(m)}`;
}

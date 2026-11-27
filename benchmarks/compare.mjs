#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = "node benchmarks/compare.mjs --display-free --base-repo <dir> [--current-repo <dir>] [--repeats 3] [--seconds 30] [--size 1800,1050] [--zoom 1] [--geometry] [--visual] [--bin herdr-app] [--out file.json]\nnode benchmarks/compare.mjs --evaluate measurement.json --temporal review.json";
const WINDOW_SWIFT = fileURLToPath(new URL("./window.swift", import.meta.url));
const MIN_REPEATS = 3;
const GATE_DROP = 0.3;
const S1 = { working: 3, done: 1 };
const S2 = { working: 0, done: 4 };
const AGENT = [
  "import sys, time",
  "state = sys.argv[1]",
  "sys.stdout.write(chr(27) + \"]7501;state=%s:app=claude-code\" % state + chr(27) + \"\\\\\")",
  "sys.stdout.flush()",
  "while True:",
  "    time.sleep(1)",
  "",
].join("\n");
const MAIN = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

export const parseCpuTime = (text) => {
  const out = String(text ?? "").trim();
  if (!out) return null;
  const [daysText, clock] = out.includes("-") ? out.split("-") : [null, out];
  const days = daysText == null ? 0 : Number(daysText);
  if (!Number.isInteger(days) || days < 0 || !/^[\d:.]+$/.test(clock)) return null;
  const parts = clock.split(":").map(Number);
  if (!parts.length || parts.some((part) => Number.isNaN(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0) + days * 86400;
};

export const parsePsM = (text) => {
  const lines = String(text ?? "").split("\n").filter((line) => line.trim());
  const thread = lines.slice(2).find((line) => /^\s+\d+/.test(line));
  if (!thread) return null;
  const times = thread.trim().split(/\s+/).filter((col) => col.includes(":"));
  if (times.length !== 2) return null;
  const seconds = times.map(parseCpuTime);
  if (seconds.some((value) => value == null)) return null;
  return seconds[0] + seconds[1];
};

export const parseTopWakeups = (text) => {
  const lines = String(text ?? "").trim().split("\n").filter(Boolean);
  if (lines.length < 2) return null;
  const cols = lines.at(-1).trim().split(/\s+/);
  if (cols.length < 2 || !/^\d+$/.test(cols[0])) return null;
  const value = Number(cols[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
};

export const parseSwitches = (text) => {
  const line = String(text ?? "").split("\n").find((row) => row.startsWith("voluntary_ctxt_switches:"));
  if (!line) return null;
  const value = Number(line.split(":")[1]?.trim());
  return Number.isFinite(value) ? value : null;
};

export const linuxMainSeconds = (text, ticks) => {
  const raw = String(text ?? "");
  const at = raw.lastIndexOf(")");
  if (at < 0 || !Number.isFinite(ticks) || ticks <= 0) return null;
  const fields = raw.slice(at + 2).trim().split(/\s+/);
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
  return (utime + stime) / ticks;
};

export const populationOf = (status, stdout) => {
  if (status !== 0) return null;
  try {
    const terminals = JSON.parse(stdout).terminals;
    if (!Array.isArray(terminals)) return null;
    const count = (name) => terminals.filter((row) => row?.status === name).length;
    const addresses = terminals.map((row) => row?.address).filter((address) => typeof address === "string");
    if (addresses.length !== terminals.length) return null;
    return { working: count("working"), done: count("done"), total: terminals.length, addresses };
  } catch {
    return null;
  }
};

export const populationExact = (population, expected, addresses) => {
  if (!population || !expected || !Array.isArray(addresses)) return false;
  const have = new Set(population.addresses);
  if (have.size !== addresses.length || addresses.some((address) => !have.has(address))) return false;
  return population.working === expected.working
    && population.done === expected.done
    && population.total === expected.working + expected.done;
};

export const rate = (before, after, wall) => {
  if (before == null || after == null || !(wall > 0) || after < before) return null;
  return Math.round(((after - before) / wall) * 1000) / 10;
};

export const meanOf = (rows, key) => {
  if (!Array.isArray(rows) || !rows.length || rows.some((row) => row?.[key] == null || Number.isNaN(Number(row[key])))) return null;
  return Math.round((rows.reduce((sum, row) => sum + Number(row[key]), 0) / rows.length) * 10) / 10;
};

export const median = (values) => {
  const nums = values.filter((value) => typeof value === "number" && !Number.isNaN(value));
  if (!nums.length) return null;
  const sorted = nums.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const strictMedian = (rows, field) => {
  if (!rows?.length || rows.some((row) => !row?.valid || row[field] == null)) return null;
  return median(rows.map((row) => row[field]));
};

export const drawsDiagnostic = (base, current) => ({
  diagnostic: true,
  proves_equal_motion: false,
  base: base ?? null,
  current: current ?? null,
  delta: base == null || current == null ? null : current - base,
});

const sameText = (left, right) => left != null && left === right;

export const s1DropOf = ({ base, current }) => {
  const reasons = [];
  if (!(base?.s1?.main_cpu > 0) || current?.s1?.main_cpu == null) reasons.push("S1 main-thread CPU is unavailable");
  if (!base?.s1?.main_source || base.s1.main_source !== current?.s1?.main_source) reasons.push("S1 main-thread metric is not comparable");
  if (!base?.s1?.population_exact || !current?.s1?.population_exact) reasons.push("working and done counts were not exact");
  if (!base?.s1?.valid || !current?.s1?.valid) reasons.push("S1 sample was not valid");
  if (reasons.length) return { s1_main_lower: null, change: null, reasons };
  const change = current.s1.main_cpu / base.s1.main_cpu - 1;
  return { s1_main_lower: change <= -GATE_DROP, change, reasons: [] };
};

export const pngDiagnostic = (base, current) => ({
  diagnostic: true,
  proves_equal_motion: false,
  disproves_equal_motion: false,
  base: base ?? null,
  current: current ?? null,
  equal: typeof base === "string" && typeof current === "string" && base !== "" && base === current ? true : base == null || current == null ? null : false,
});

export const runId = (invocation, role, repeat) => `${invocation}:${role}:${repeat}`;

export const sameIds = (cited, recorded) => {
  if (!Array.isArray(cited) || !Array.isArray(recorded) || !cited.length || cited.length !== recorded.length) return false;
  if (cited.some((id) => typeof id !== "string" || !id) || recorded.some((id) => typeof id !== "string" || !id)) return false;
  if (new Set(cited).size !== cited.length || new Set(recorded).size !== recorded.length) return false;
  const have = new Set(recorded);
  return cited.every((id) => have.has(id));
};

export const expectedIds = (invocation, roles, repeats) => {
  if (typeof invocation !== "string" || !invocation || !Array.isArray(roles) || !roles.length) return null;
  if (!Number.isInteger(repeats) || repeats < 1) return null;
  if (roles.some((role) => role !== "base" && role !== "current")) return null;
  const ids = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const role of [...roles].sort()) ids.push(runId(invocation, role, repeat));
  }
  return new Set(ids).size === ids.length ? ids : null;
};

export const recordedIds = (measurement) => {
  if (!Array.isArray(measurement?.runs)) return null;
  const roles = [...new Set(measurement.runs.map((run) => run?.role))].filter((role) => role === "base" || role === "current");
  const expected = expectedIds(measurement?.invocation, roles, measurement?.repeats);
  const cited = measurement.runs.map((run) => run?.id);
  return expected && sameIds(cited, expected) ? expected : null;
};

export const temporalEvidence = (record, recorded) => {
  if (record?.reviewed !== true || record?.method !== "temporal-review") return null;
  if (typeof record.elements !== "string" || !record.elements || typeof record.cycles !== "string" || !record.cycles) return null;
  if (record.visibility !== "onscreen" || typeof record.equivalent !== "boolean") return null;
  if (!sameIds(record.runs, recorded)) return null;
  return { method: "temporal-review", equivalent: record.equivalent, elements: record.elements, cycles: record.cycles, visibility: record.visibility, runs: record.runs };
};

export const mayLaunch = ({ displayFree, displayReady }) => {
  if (displayFree !== true) return { launch: false, reason: "pass --display-free to confirm this display may be interrupted" };
  if (displayReady !== true) return { launch: false, reason: "no available display confirmed; not launching" };
  return { launch: true, reason: null };
};

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const complete = (row, fields) => row?.valid === true && row?.population_exact === true && fields.every((field) => finite(row[field]) || (typeof row[field] === "string" && row[field]));

export const gateOf = ({ base, current, repeats, temporal, runIds }) => {
  if (!base || !current) return null;
  const missing = [];
  if (!(repeats >= MIN_REPEATS)) missing.push("repeats");
  if (!sameText(base.platform, current.platform)) missing.push("platform");
  if (!finite(base.zoom) || base.zoom !== current.zoom || base.zoom !== base.requested_zoom || current.zoom !== current.requested_zoom) missing.push("zoom");
  if (!sameText(base.requested_size, current.requested_size)) missing.push("requested size");
  if (!sameText(base.display_size, current.display_size)) missing.push("display size");
  if (!sameText(base.actual_size, current.actual_size)) missing.push("window size");
  if (base.visibility !== "onscreen" || current.visibility !== "onscreen") missing.push("visibility");
  if (!sameText(base.herdr, current.herdr)) missing.push("herdr");
  if (!complete(base.s1, ["main_cpu"]) || !complete(current.s1, ["main_cpu"]) || !sameText(base.s1?.main_source, current.s1?.main_source)) missing.push("S1");
  if (!complete(base.s2, ["main_cpu", "app_cpu", "wakes_s"]) || !complete(current.s2, ["main_cpu", "app_cpu", "wakes_s"]) || !sameText(base.s2?.main_source, current.s2?.main_source) || !sameText(base.s2?.wakes_source, current.s2?.wakes_source)) missing.push("S2");
  if (!complete(base.s3, ["status_p50_ms", "status_p95_ms"]) || !complete(current.s3, ["status_p50_ms", "status_p95_ms"])) missing.push("S3");
  if (!sameIds(temporal?.runs, runIds) || temporal?.method !== "temporal-review" || typeof temporal.equivalent !== "boolean" || !temporal.elements || !temporal.cycles || temporal.visibility !== "onscreen") missing.push("temporal");
  if (missing.length) return null;
  const drop = s1DropOf({ base, current });
  if (drop.s1_main_lower == null) return null;
  const reasons = [
    drop.s1_main_lower !== true && "S1 main-thread CPU was not 30% lower",
    current.s2.main_cpu > base.s2.main_cpu && "S2 main-thread CPU regressed",
    current.s2.app_cpu > base.s2.app_cpu && "S2 process CPU regressed",
    current.s2.wakes_s > base.s2.wakes_s && "S2 wakeups regressed",
    current.s3.status_p95_ms > base.s3.status_p95_ms && "S3 status p95 regressed",
    current.s3.status_p50_ms > base.s3.status_p50_ms && "S3 status p50 regressed",
    temporal.equivalent !== true && "temporal evidence is not equivalent",
  ].filter(Boolean);
  return { pass: reasons.length === 0, reasons };
};

export const evaluate = (measurement, review) => {
  const runIds = recordedIds(measurement);
  const temporal = temporalEvidence(review, runIds);
  return {
    invocation: measurement?.invocation ?? null,
    runIds,
    temporal,
    gate: runIds ? gateOf({ base: measurement?.summary?.base, current: measurement?.summary?.current, repeats: measurement?.repeats, temporal, runIds }) : null,
  };
};

export const displayOf = (value) => {
  const width = Number(value?.width);
  const height = Number(value?.height);
  if (value?.ready !== true || !(width > 0) || !(height > 0)) return { ready: false, size: null };
  return { ready: true, size: `${width}x${height}` };
};

export const linuxDisplay = (rows) => {
  if (!Array.isArray(rows)) return { ready: false, size: null };
  const connected = rows.find((row) => row?.status === "connected" && /^\d+x\d+$/.test(row?.mode ?? ""));
  return connected ? { ready: true, size: connected.mode } : { ready: false, size: null };
};

export const windowOf = (value) => {
  const width = Number(value?.width);
  const height = Number(value?.height);
  const x = Number(value?.x);
  const y = Number(value?.y);
  if ((value?.visibility !== "onscreen" && value?.visibility !== "offscreen") || ![width, height, x, y].every(Number.isFinite) || !(width > 0) || !(height > 0)) {
    return { visibility: "unknown", bounds: null };
  }
  return { visibility: value.visibility, bounds: `${x},${y},${width}x${height}` };
};

export const agreeWindows = (before, after) => {
  if (before?.visibility === "unknown" || after?.visibility === "unknown" || !before || !after) return { visibility: "unknown", bounds: null };
  if (before.visibility !== after.visibility || before.bounds !== after.bounds) return { visibility: "unknown", bounds: null };
  return { visibility: before.visibility, bounds: before.bounds };
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const which = (name) => {
  const found = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : "";
};

let active = null;
const stopOwned = (owned) => {
  if (!owned || owned.stopped) return;
  owned.stopped = true;
  for (const address of owned.terminals) {
    spawnSync("hc", ["kill", address], { env: owned.env, encoding: "utf8" });
  }
  owned.terminals = [];
  if (owned.app?.exitCode === null) owned.app.kill("SIGTERM");
  if (owned.awake?.exitCode === null) owned.awake.kill("SIGTERM");
  if (owned.core != null && owned.coreSince && startedAt(owned.core) === owned.coreSince) {
    spawnSync("hc", ["server", "stop"], { env: owned.env, encoding: "utf8" });
    if (startedAt(owned.core) === owned.coreSince) {
      try { process.kill(owned.core, "SIGTERM"); } catch { owned.core = null; }
    }
  }
};
const startedAt = (pid) => spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();

if (MAIN) {
  process.on("exit", () => stopOwned(active));
  process.on("SIGINT", () => { stopOwned(active); process.exit(130); });
}

const sessionEnv = (root, session) => {
  const env = {
    ...process.env,
    HERDR_APP_HOME: join(root, "home"),
    HC_SESSION: session,
    XDG_STATE_HOME: join(root, "state"),
    XDG_CONFIG_HOME: join(root, "config"),
    HERDR_APP_NO_SOUND: "1",
    HERDR_APP_BENCH: join(root, "frames.jsonl"),
  };
  for (const key of ["HC_SOCKET", "HC_TERMINAL_ID", "HC_TERMINAL_SOCKET", "HC_SCOPE"]) delete env[key];
  return env;
};

const run = (owned, command, args) => spawnSync(command, args, { env: owned.env, encoding: "utf8" });

const readFrames = (path) => {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  try {
    return text.split("\n").map((line) => JSON.parse(line));
  } catch {
    return null;
  }
};

const statusNow = (owned, bin) => {
  const result = run(owned, bin, ["status"]);
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
};

const coreNow = (owned) => {
  const result = run(owned, "hc", ["server", "status", "--json"]);
  if (result.status !== 0) return null;
  try {
    const pid = JSON.parse(result.stdout).pid;
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
};

const listNow = (owned) => {
  const result = run(owned, "hc", ["ls", "--json"]);
  return populationOf(result.status, result.stdout);
};

const cpuNow = (pid) => {
  const result = spawnSync("ps", ["-o", "time=", "-p", String(pid)], { encoding: "utf8" });
  return result.status === 0 ? parseCpuTime(result.stdout) : null;
};

const mainNow = (pid, ticks) => {
  if (process.platform === "linux") {
    try {
      return { value: linuxMainSeconds(readFileSync(`/proc/${pid}/task/${pid}/stat`, "utf8"), ticks), source: "linux-proc-task" };
    } catch {
      return { value: null, source: null };
    }
  }
  const result = spawnSync("ps", ["-M", "-p", String(pid)], { encoding: "utf8" });
  if (result.status !== 0) return { value: null, source: null };
  const value = parsePsM(result.stdout);
  return { value, source: value == null ? null : "macos-ps-m" };
};

const wakesNow = (pid) => {
  if (process.platform === "linux") {
    try {
      return { value: parseSwitches(readFileSync(`/proc/${pid}/status`, "utf8")), source: "linux-voluntary-ctxt" };
    } catch {
      return { value: null, source: null };
    }
  }
  const result = spawnSync("top", ["-l", "1", "-pid", String(pid), "-stats", "pid,idlew"], { encoding: "utf8" });
  if (result.status !== 0) return { value: null, source: null };
  const value = parseTopWakeups(result.stdout);
  return { value, source: value == null ? null : "macos-top-idlew" };
};

const inhibit = (appPid) => {
  if (process.platform === "darwin" && which("caffeinate")) {
    return { child: spawn("caffeinate", ["-d", "-w", String(appPid)], { stdio: "ignore" }), source: "caffeinate" };
  }
  if (process.platform === "linux" && which("systemd-inhibit")) {
    return {
      child: spawn("systemd-inhibit", ["--what=idle:sleep", "--who=kanso-bench", "--why=bench", "sleep", "infinity"], { stdio: "ignore" }),
      source: "systemd-inhibit",
    };
  }
  return { child: null, source: null };
};

const swiftJson = (arg) => {
  if (process.platform !== "darwin") return null;
  const result = spawnSync("swift", [WINDOW_SWIFT, String(arg)], { encoding: "utf8", timeout: 120000 });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
};

const confirmDisplay = () => {
  if (process.platform === "darwin") return displayOf(swiftJson("display"));
  if (process.platform !== "linux") return { ready: false, size: null };
  try {
    const root = "/sys/class/drm";
    const rows = readdirSync(root).filter((name) => name.includes("-")).map((name) => ({
      status: existsSync(join(root, name, "status")) ? readFileSync(join(root, name, "status"), "utf8").trim() : "",
      mode: existsSync(join(root, name, "modes")) ? readFileSync(join(root, name, "modes"), "utf8").trim().split("\n")[0] : "",
    }));
    return linuxDisplay(rows);
  } catch {
    return { ready: false, size: null };
  }
};

const inspectPid = (pid) => process.platform === "darwin" ? windowOf(swiftJson(pid)) : { visibility: "unknown", bounds: null };

const act = async (owned, bin, command, args) => {
  for (let tries = 0; tries < 50; tries += 1) {
    const result = run(owned, bin, ["do", command, JSON.stringify(args)]);
    if (result.status === 0) {
      try { return JSON.parse(result.stdout); } catch { return null; }
    }
    if (!/unavailable/.test(`${result.stdout}${result.stderr}`)) {
      throw new Error(`${command}: ${result.stdout}${result.stderr}`.trim());
    }
    await sleep(200);
  }
  throw new Error(`${command}: the window never answered`);
};

const clearOverlays = async (owned, bin) => {
  for (let tries = 0; tries < 25; tries += 1) {
    const now = statusNow(owned, bin);
    if (now && !(now.overlays ?? []).length) return now;
    for (const id of now?.overlays ?? []) {
      if (typeof id === "string") run(owned, bin, ["do", "overlay.close", JSON.stringify({ id })]);
    }
    run(owned, bin, ["do", "overlay.close"]);
    await sleep(200);
  }
  return statusNow(owned, bin);
};

async function measure(owned, bin, name, expected, addresses, { probes, seconds, ticks }) {
  const before = statusNow(owned, bin);
  const population = [listNow(owned)];
  const start = Date.now();
  const frames = readFrames(owned.env.HERDR_APP_BENCH);
  const from = frames?.length ?? 0;
  const appCpu = cpuNow(owned.app.pid);
  const mainCpu = mainNow(owned.app.pid, ticks);
  const coreCpu = owned.core == null ? null : cpuNow(owned.core);
  const wakes = wakesNow(owned.app.pid);
  const latencies = [];
  let failed = 0;
  while (Date.now() - start < seconds * 1000) {
    if (!probes) {
      await sleep(1000);
      continue;
    }
    const asked = Date.now();
    const result = run(owned, bin, ["status"]);
    if (result.status === 0) latencies.push(Date.now() - asked);
    else failed += 1;
    await sleep(100);
  }
  const wall = (Date.now() - start) / 1000;
  population.push(listNow(owned));
  const rows = readFrames(owned.env.HERDR_APP_BENCH);
  const slice = rows == null ? null : rows.slice(from);
  const draws = meanOf(slice, "window");
  const exact = population.every((row) => populationExact(row, expected, addresses));
  const problems = [
    !exact && `expected ${expected.working} working and ${expected.done} done at ${addresses.join(", ") || "no addresses"}`,
    (before?.overlays ?? ["unknown"]).length > 0 && `an overlay covered the window: ${(before?.overlays ?? ["unknown"]).join(", ")}`,
    before?.layout !== "kanso" && `the layout was ${before?.layout ?? "unknown"}, not kanso`,
    probes && failed > 0 && `${failed} status samples failed`,
    name === "S1" && !(draws > 0) && "S1 frame counter was zero",
    name !== "S3" && slice == null && "draws were not observed",
  ].filter(Boolean);
  return {
    scenario: name,
    valid: problems.length === 0,
    problems,
    population_exact: exact,
    working: population.at(-1)?.working ?? null,
    done: population.at(-1)?.done ?? null,
    app_cpu: rate(appCpu, cpuNow(owned.app.pid), wall),
    main_cpu: rate(mainCpu.value, mainNow(owned.app.pid, ticks).value, wall),
    main_source: mainCpu.source,
    core_cpu: owned.core == null ? null : rate(coreCpu, cpuNow(owned.core), wall),
    wakes_s: rate(wakes.value, wakesNow(owned.app.pid).value, wall),
    wakes_source: wakes.source,
    draws,
    frame_ms: meanOf(slice, "frame_ms"),
    script_ms: meanOf(slice, "script_ms"),
    materialize: meanOf(slice, "materialize"),
    materialize_ms: meanOf(slice, "materialize_ms"),
    terminal: meanOf(slice, "terminal"),
    status_p50_ms: probes ? percentile(latencies, 0.5) : null,
    status_p95_ms: probes ? percentile(latencies, 0.95) : null,
    status_samples: probes ? latencies.length : null,
    zoom: before?.zoom ?? null,
    layout: before?.layout ?? null,
  };
}

const percentile = (values, p) => values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? null;

const install = (repo, home, size) => {
  for (const folder of ["layouts", "themes", "mods"]) mkdirSync(join(home, folder), { recursive: true });
  cpSync(join(repo, "kanso", "layouts"), join(home, "layouts"), { recursive: true });
  cpSync(join(repo, "kanso", "themes"), join(home, "themes"), { recursive: true });
  for (const mod of readdirSync(join(repo, "kanso", "mods"))) cpSync(join(repo, "kanso", "mods", mod), join(home, "mods", mod), { recursive: true });
  writeFileSync(join(home, "window.json"), `${JSON.stringify({ state: "windowed", bounds: [0, 0, size[0], size[1]] })}\n`);
  writeFileSync(join(home, "settings.json"), `${JSON.stringify({ zoom: 1 })}\n`);
  writeFileSync(join(home, "shared.json"), `${JSON.stringify({ "frame.welcomed": "bench" })}\n`);
};

const prepareNotes = (home, bin) => {
  const version = spawnSync(bin, ["--version"], { encoding: "utf8" }).stdout.match(/\d+\.\d+\.\d+/)?.[0];
  if (version) writeFileSync(join(home, "update-notes.json"), `${JSON.stringify({ last_run: version, presented: [] })}\n`);
  return version ?? null;
};

async function openAgents(owned, bin, label, states) {
  const addresses = [];
  for (const [index, state] of states.entries()) {
    const shown = index === 0;
    const created = await act(owned, bin, "space.new", {
      name: `${label}${index}`,
      folder: owned.root,
      argv: ["python3", "-u", join(owned.root, "agent.py"), state],
      focus: shown,
    });
    if (!created?.terminal) throw new Error(`${label} did not return a terminal`);
    addresses.push(created.terminal);
    owned.terminals.push(created.terminal);
  }
  await sleep(3000);
  return addresses;
}

async function oneSession({ repo, role, repeat, bin, seconds, size, zoom, ticks, geometry, visual, displaySize, displayFree, invocation }) {
  const root = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "kb-"));
  const owned = {
    root, env: sessionEnv(root, `k${process.pid}r${repeat}${role[0]}`),
    app: null, awake: null, core: null, coreSince: "", terminals: [], stopped: false,
  };
  active = owned;
  const blank = {
    id: runId(invocation, role, repeat),
    role, repeat, repo, platform: process.platform, zoom: null, requested_zoom: zoom, requested_size: size.join("x"),
    actual_size: null, display_size: displaySize, visibility: "unknown", focus: "not controlled",
    display_awake: null, herdr: null, visual_hash: null, valid: false, problems: [], s1: null, s2: null, s3: null,
  };
  try {
    const allowed = mayLaunch({ displayFree, displayReady: Boolean(displaySize) });
    if (!allowed.launch) throw new Error(allowed.reason);
    const home = owned.env.HERDR_APP_HOME;
    install(repo, home, size);
    writeFileSync(join(home, "settings.json"), `${JSON.stringify({ zoom })}\n`);
    blank.herdr = prepareNotes(home, bin);
    writeFileSync(join(root, "agent.py"), AGENT);
    const started = run(owned, "hc", ["server", "start"]);
    const coreAfter = coreNow(owned);
    const coreSince = coreAfter == null ? "" : startedAt(coreAfter);
    const coreAge = Date.now() - Date.parse(coreSince);
    if (started.status === 0 && coreAfter != null && coreAge >= 0 && coreAge < 20000) {
      owned.core = coreAfter;
      owned.coreSince = coreSince;
    }
    if (owned.core == null) throw new Error(`core did not start: ${started.stdout}${started.stderr}`.trim());
    owned.app = spawn(bin, [], { env: owned.env, stdio: "ignore" });
    const held = inhibit(owned.app.pid);
    owned.awake = held.child;
    blank.display_awake = held.source;
    for (let i = 0; i < 100 && run(owned, bin, ["status"]).status !== 0; i += 1) await sleep(200);
    await act(owned, bin, "layout.switch", { name: "kanso" });
    const ready = await clearOverlays(owned, bin);
    blank.zoom = ready?.zoom ?? null;
    const seen = geometry ? [inspectPid(owned.app.pid)] : [];
    const s2Addresses = await openAgents(owned, bin, "s2", ["done", "done", "done", "done"]);
    blank.s2 = await measure(owned, bin, "S2", S2, s2Addresses, { probes: false, seconds, ticks });
    for (const address of s2Addresses) {
      const killed = run(owned, "hc", ["kill", address]);
      if (killed.status !== 0) throw new Error(`could not stop ${address}`);
    }
    owned.terminals = owned.terminals.filter((address) => !s2Addresses.includes(address));
    await sleep(1000);
    const s1Addresses = await openAgents(owned, bin, "s1", ["done", "working", "working", "working"]);
    blank.s1 = await measure(owned, bin, "S1", S1, s1Addresses, { probes: false, seconds, ticks });
    if (visual) {
      const shot = join(root, "s1.png");
      const saved = run(owned, bin, ["shot", shot]);
      blank.visual_hash = saved.status === 0 && existsSync(shot) ? createHash("sha256").update(readFileSync(shot)).digest("hex") : null;
    }
    if (geometry) seen.push(inspectPid(owned.app.pid));
    const agreed = geometry ? agreeWindows(seen[0], seen[1]) : { visibility: "unknown", bounds: null };
    blank.visibility = agreed.visibility;
    blank.actual_size = agreed.bounds;
    blank.s3 = await measure(owned, bin, "S3", S1, s1Addresses, { probes: true, seconds, ticks });
    blank.s3 = { ...blank.s3, app_cpu: null, main_cpu: null, main_source: null, core_cpu: null, wakes_s: null, wakes_source: null, draws: null, frame_ms: null, script_ms: null, materialize: null, materialize_ms: null, terminal: null };
    blank.valid = Boolean(blank.s1?.valid && blank.s2?.valid && blank.s3?.valid);
    blank.problems = [blank.s1, blank.s2, blank.s3].flatMap((row) => row?.problems ?? []);
    return blank;
  } catch (error) {
    blank.problems = [String(error.message ?? error)];
    return blank;
  } finally {
    stopOwned(owned);
    if (active === owned) active = null;
  }
}

const sideOf = (runs, role) => {
  const mine = runs.filter((run) => run.role === role);
  const pick = (scenario) => mine.map((run) => run[scenario]).filter(Boolean);
  const field = (scenario, name) => strictMedian(pick(scenario), name);
  const exact = (scenario) => pick(scenario).length > 0 && pick(scenario).every((row) => row.population_exact && row.valid);
  const source = (scenario, name) => {
    const values = pick(scenario).map((row) => row[name]);
    return values.length && values.every((value) => value && value === values[0]) ? values[0] : null;
  };
  const first = mine[0] ?? {};
  return {
    platform: sourceOf(mine, "platform"),
    zoom: sourceOf(mine, "zoom"),
    requested_zoom: sourceOf(mine, "requested_zoom"),
    requested_size: sourceOf(mine, "requested_size"),
    actual_size: sourceOf(mine, "actual_size"),
    display_size: sourceOf(mine, "display_size"),
    visibility: sourceOf(mine, "visibility"),
    herdr: sourceOf(mine, "herdr"),
    visual_hash: sourceOf(mine, "visual_hash"),
    focus: first.focus ?? null,
    s1: {
      valid: exact("s1"),
      population_exact: exact("s1"),
      app_cpu: field("s1", "app_cpu"),
      main_cpu: field("s1", "main_cpu"),
      main_source: source("s1", "main_source"),
      draws: field("s1", "draws"),
      frame_ms: field("s1", "frame_ms"),
    },
    s2: {
      valid: exact("s2"),
      population_exact: exact("s2"),
      app_cpu: field("s2", "app_cpu"),
      main_cpu: field("s2", "main_cpu"),
      wakes_s: field("s2", "wakes_s"),
      wakes_source: source("s2", "wakes_source"),
      main_source: source("s2", "main_source"),
      draws: field("s2", "draws"),
    },
    s3: {
      valid: exact("s3"),
      population_exact: exact("s3"),
      status_p50_ms: field("s3", "status_p50_ms"),
      status_p95_ms: field("s3", "status_p95_ms"),
    },
  };
};

const sourceOf = (runs, field) => {
  const values = runs.map((run) => run[field]);
  return values.length && values.every((value) => value != null && value === values[0]) ? values[0] : null;
};

const requireRepo = (path, label) => {
  const repo = resolve(path);
  if (!existsSync(join(repo, "kanso", "mods")) || !existsSync(join(repo, "kanso", "layouts"))) {
    throw new Error(`${label} is not a kansō checkout: ${repo}`);
  }
  return repo;
};

async function main() {
  if (flag("help")) {
    console.log(USAGE);
    return;
  }
  if (option("evaluate", "")) {
    const measurement = JSON.parse(readFileSync(option("evaluate"), "utf8"));
    const review = option("temporal", "") ? JSON.parse(readFileSync(option("temporal"), "utf8")) : null;
    console.log(JSON.stringify(evaluate(measurement, review), null, 2));
    return;
  }
  if (option("temporal", "")) throw new Error("a temporal review is applied with --evaluate to a saved measurement, not during a launch");
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error("this harness measures macOS and Linux only");
  }
  if (option("base", "")) throw new Error("pass --base-repo, a checkout that already exists; this harness does not create a worktree");
  const repeats = Number(option("repeats", MIN_REPEATS));
  const seconds = Number(option("seconds", 30));
  const zoom = Number(option("zoom", 1));
  const size = option("size", "1800,1050").split(",").map(Number);
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error("--repeats needs an integer of at least 1");
  if (!(seconds >= 1)) throw new Error("--seconds needs a number of at least 1");
  if (!(zoom > 0)) throw new Error("--zoom needs a number above 0");
  if (size.length !== 2 || size.some((value) => !(value > 0))) throw new Error("--size needs width,height");
  const base = option("base-repo", "");
  const current = option("current-repo", "");
  if (!base && !current) throw new Error(USAGE);
  const repos = [];
  if (base) repos.push({ role: "base", repo: requireRepo(base, "--base-repo") });
  if (current) repos.push({ role: "current", repo: requireRepo(current, "--current-repo") });
  const displayFree = flag("display-free");
  if (!mayLaunch({ displayFree, displayReady: true }).launch) throw new Error("pass --display-free to confirm this display may be interrupted");
  const bin = option("bin", "") || which("herdr-app");
  if (!bin) throw new Error("herdr-app was not found; pass --bin");
  const display = confirmDisplay();
  const allowed = mayLaunch({ displayFree, displayReady: display.ready });
  if (!allowed.launch) throw new Error(allowed.reason);
  const geometry = flag("geometry");
  const visual = flag("visual");
  const invocation = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const ticks = process.platform === "linux" ? Number(spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).stdout.trim()) : null;
  const runs = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const order = repeat % 2 === 0 ? repos : [...repos].reverse();
    for (const side of order) runs.push(await oneSession({ ...side, repeat, bin, seconds, size, zoom, ticks, geometry, visual, displaySize: display.size, displayFree, invocation }));
  }
  const sides = Object.fromEntries(repos.map(({ role }) => [role, sideOf(runs, role)]));
  const drop = sides.base && sides.current ? s1DropOf({ base: sides.base, current: sides.current }) : { s1_main_lower: null, change: null, reasons: ["one checkout: no comparison"] };
  const png = pngDiagnostic(sides.base?.visual_hash, sides.current?.visual_hash);
  const runIds = recordedIds({ invocation, repeats, runs });
  const gate = sides.base && sides.current ? gateOf({ base: sides.base, current: sides.current, repeats, temporal: null, runIds }) : null;
  const report = {
    at: new Date().toISOString(),
    invocation,
    platform: process.platform,
    bin,
    repeats,
    sample: repeats >= MIN_REPEATS ? "repeated" : "exploratory",
    requested_size: size.join("x"),
    requested_zoom: zoom,
    geometry,
    png,
    focus: "not controlled",
    focus_note: "no osascript, hyprctl, or raise. Herdr activates its own new window on launch; this harness does not restore the previous app.",
    visibility: sameText(sides.base?.visibility, sides.current?.visibility) ? sides.base.visibility : (sides.current?.visibility ?? sides.base?.visibility ?? "unknown"),
    fixture: "osc-once-then-sleep",
    repos: Object.fromEntries(repos.map(({ role, repo }) => [role, repo])),
    runs,
    summary: sides,
    draws_delta: {
      s1: drawsDiagnostic(sides.base?.s1?.draws, sides.current?.s1?.draws),
      s2: drawsDiagnostic(sides.base?.s2?.draws, sides.current?.s2?.draws),
    },
    s1_main_lower: drop.s1_main_lower,
    s1_main_reasons: drop.reasons,
    s1_main_change: drop.change == null ? null : { diagnostic: true, change: drop.change },
    gate,
  };
  const out = option("out", "") || join(fileURLToPath(new URL(".", import.meta.url)), "results", "compare", `${report.at.replace(/[:.]/g, "-")}.json`);
  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    out,
    sample: report.sample,
    visibility: report.visibility,
    s1_main_lower: report.s1_main_lower,
    gate: report.gate,
    s1_main_base: sides.base?.s1?.main_cpu ?? null,
    s1_main_current: sides.current?.s1?.main_cpu ?? null,
    draws_delta: report.draws_delta.s1,
  }, null, 2));
  if (runs.some((run) => !run.valid)) process.exitCode = 1;
}

if (MAIN) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 2;
  });
}

import { available } from "./sim-registration.js";
import { serviceFor } from "./platform-host.js";

export const NEEDS = Object.freeze({ containers: "docker", pr: "gh" });
const LOCAL = Object.freeze({ containers: true });
export const LOOKUP_MS = 1500;
export const RETRY_MS = 30_000;
export const ASK_MS = 40_000;

const ANSWERS = Object.freeze({ 0: true, 1: false });
const lookup = (run, platform, command) => (platform === "windows"
  ? run("where.exe", [command])
  : run("sh", ["-c", 'command -v "$1" >/dev/null 2>&1 || exit 1', "_", command]));
export const probeCommand = (run, platform, command) => lookup(run, platform, command).then((result) => ANSWERS[result?.code] ?? null, () => null);

export const machineKey = (space) => space?.machine ?? "";

export const toolFor = (id, machine) => ({ machine: LOCAL[id] ? "" : machine, command: NEEDS[id] });
export const toolKey = ({ machine, command }) => `${machine}\t${command}`;
export const toolsFor = (machine) => Object.keys(NEEDS).map((id) => toolFor(id, machine));

export const commandOn = ({ machine, command }) => serviceFor((platform, run) => probeCommand(run, platform, command), machine || null, machine ? null : LOOKUP_MS).catch(() => null);

export const forgetting = (answers, keys) => Object.fromEntries(Object.entries(answers).filter(([key, answer]) => answer !== null || !keys.includes(key)));
export const withoutNegatives = (answers) => Object.fromEntries(Object.entries(answers).filter(([, answer]) => answer === true));

export const UNKNOWN_TOOLS = Object.freeze({ state: "unknown" });
export const FAILED_TOOLS = Object.freeze({ state: "failed" });
export const simRecord = (tools) => (tools && typeof tools === "object" && !("state" in tools) && !("unknown" in tools) ? tools : null);

export const offered = (id, { sim, commands, machine = "" }) => (id === "sim" ? !simRecord(sim) || available(sim) : commands?.[toolKey(toolFor(id, machine))] !== false);

import { available } from "./sim-registration.js";
import { serviceFor } from "./platform-host.js";

export const COMMANDS = "kanso.panels.commands";
export const NEEDS = Object.freeze({ containers: "docker", pr: "gh" });
export const LOOKUP_MS = 1500;

const ANSWERS = Object.freeze({ 0: true, 1: false });
const lookup = (run, platform, command) => (platform === "windows"
  ? run("where.exe", [command])
  : run("sh", ["-c", 'command -v "$1" >/dev/null 2>&1 || exit 1', "_", command]));
const present = (run, platform, command) => lookup(run, platform, command).then((result) => ANSWERS[result?.code] ?? null, () => null);

export const probeCommands = async (run, platform) => Object.fromEntries(await Promise.all(Object.values(NEEDS).map(async (command) => [command, await present(run, platform, command)])));

export const machineKey = (space) => space?.machine ?? "";

export const commandsOn = (machine) => serviceFor((platform, run) => probeCommands(run, platform), machine || null, machine ? null : LOOKUP_MS).catch(() => null);

export const offered = (id, { sim, commands }) => (id === "sim" ? available(sim) : commands?.[NEEDS[id]] !== false);

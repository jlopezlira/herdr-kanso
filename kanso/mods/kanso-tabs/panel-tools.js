import { available } from "./sim-registration.js";

export const COMMANDS = "kanso.panels.commands";
export const NEEDS = Object.freeze({ containers: "docker", pr: "gh" });

const NOT_FOUND = /ENOENT|not found|not recognized|no such file/i;
const missing = (failure) => failure?.code === "ENOENT" || NOT_FOUND.test(String(failure?.message ?? ""));
const answered = (result) => (result?.code === 0 ? true : result?.code === 127 || result?.code === 9009 ? false : null);
const present = (run, command) => run(command, ["--version"], { timeout: 1500 }).then(answered, (failure) => (missing(failure) ? false : null));

export const probeCommands = async (run) => Object.fromEntries(await Promise.all(Object.values(NEEDS).map(async (command) => [command, await present(run, command)])));

export const offered = (id, { sim, commands }) => (id === "sim" ? available(sim) : commands?.[NEEDS[id]] !== false);

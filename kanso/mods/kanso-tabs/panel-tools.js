import { available } from "./sim-registration.js";

export const COMMANDS = "kanso.panels.commands";
export const NEEDS = Object.freeze({ containers: "docker", pr: "gh" });

const present = (run, command) => run(command, ["--version"], { timeout: 1500 }).then((result) => result?.code === 0, () => false);

export const probeCommands = async (run) => Object.fromEntries(await Promise.all(Object.values(NEEDS).map(async (command) => [command, await present(run, command)])));

export const offered = (id, { sim, commands }) => (id === "sim" ? available(sim) : commands?.[NEEDS[id]] !== false);

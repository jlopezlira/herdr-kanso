import { processTable, unixProcesses } from "./platform-processes.js";
import { elapsedSeconds } from "./platform-command.js";

export const parseProcesses = (text) => processTable(unixProcesses(text));
export const etimeSecs = (value) => elapsedSeconds(value);
export const etimeMs = (value) => etimeSecs(value) * 1000;

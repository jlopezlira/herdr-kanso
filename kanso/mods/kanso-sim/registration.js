import { simulatorApi } from "./platform-simulator.js";

export const TOOLS = "kanso.sim.tools";
export const PROBE_MS = 7000;
export const UNKNOWN_TOOLS = Object.freeze({ state: "unknown" });
export const FAILED_TOOLS = Object.freeze({ state: "failed" });
export const toolRecord = (tools) => (tools && typeof tools === "object" && !("state" in tools) && !("unknown" in tools) ? tools : null);
export const available = (tools) => Boolean(toolRecord(tools)?.ios || toolRecord(tools)?.adb);
export const probeTools = (platform, home, run) => simulatorApi(platform, run).probe(home);

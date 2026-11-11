import { simulatorApi } from "./platform-simulator.js";

export const TOOLS = "kanso.sim.tools";
export const PROBE_MS = 7000;
export const available = (tools) => Boolean(tools?.ios || tools?.adb);
export const simOn = (tools, off = []) => available(tools) && !off.includes("sim");
export const probeTools = (platform, home, run) => simulatorApi(platform, run).probe(home);

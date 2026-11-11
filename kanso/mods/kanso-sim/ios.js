import { checked } from "./platform-command.js";
import { parseSimctl } from "./model.js";

export const iosDevices = async (run) => parseSimctl(checked(await run("xcrun", ["simctl", "list", "devices", "--json"], { timeout: 5000 })).stdout);
export const iosCommand = (run, args) => run("xcrun", ["simctl", ...args], { timeout: 8000 }).then(checked);

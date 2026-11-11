import { checked } from "./platform-command.js";
import { parseSimctl } from "./model.js";

export const iosDevices = async (run, tools) => parseSimctl(checked(await run(tools.ios, ["list", "devices", "--json"], { timeout: 5000 })).stdout);
export const iosCommand = (run, tools, args) => run(tools.ios, args, { timeout: 8000 }).then(checked);

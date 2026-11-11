import { checked } from "./platform-command.js";
import { simulatorApi } from "./platform-simulator.js";
import { parseAdb, parseAvds, deviceList, parseSize } from "./model.js";
import { iosDevices, iosCommand } from "./ios.js";

export const adbCommand = (run, tools, target, args) => run(tools.adb, [...(target ? ["-s", target] : []), ...args], { timeout: 8000 }).then(checked);

export async function readDevices(run, tools, front = () => true) {
  const ios = tools.ios && front() ? await iosDevices(run) : [];
  const avds = tools.emulator && front() ? parseAvds(checked(await run(tools.emulator, ["-list-avds"], { timeout: 5000 })).stdout) : [];
  const rows = tools.adb && front() ? parseAdb((await adbCommand(run, tools, null, ["devices"])).stdout) : [];
  const android = await Promise.all(rows.map(async (row) => {
    if (!row.emulator || row.state !== "device" || !front()) return row;
    const name = await adbCommand(run, tools, row.serial, ["emu", "avd", "name"]);
    return { ...row, avd: name.stdout.split(/\r?\n/).find((line) => line.trim() && line.trim() !== "OK")?.trim() };
  }));
  return deviceList(tools, ios, avds, android);
}

export const startDevice = (run, platform, tools, device) => device.platform === "ios"
  ? iosCommand(run, ["boot", device.target])
  : simulatorApi(platform, run).start(tools.emulator, device.avd).then(checked);
export const deviceSize = async (run, tools, device) => parseSize((await adbCommand(run, tools, device.target, ["shell", "wm", "size"])).stdout);
export const captureDevice = (run, platform, tools, device, file) => device.platform === "ios"
  ? iosCommand(run, ["io", device.target, "screenshot", "--type=jpeg", file])
  : simulatorApi(platform, run).capture(tools.adb, device.target, file).then(checked);

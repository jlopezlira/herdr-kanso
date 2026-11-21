import { appHome, readTextFile } from "herdr";
import { paths } from "./platform-paths.js";

const readInstalled = async () => {
  try { return JSON.parse(await readTextFile(paths.join(appHome(), "mods", "kanso-chrome", "version.json")) ?? "{}").version ?? null; } catch { return null; }
};

export const whenInstalled = (cx, take) => cx.spawn(async (cx) => { take(await readInstalled()); cx.notify(); });

import { hc, readTextFile } from "herdr";
import { serviceOn, homeOn } from "./platform-host.js";
import { processApi } from "./platform-processes.js";
import { conversationIn, heldIn } from "./conversation-at.js";

async function hostOn(on) {
  const homeDir = await homeOn(on);
  const processes = await serviceOn(processApi, on);
  return { hc, readTextFile: (path) => readTextFile(path, on ? { on } : undefined), home: () => homeDir, platform: { processes } };
}

export const locateOn = async (on, address, hint) => conversationIn(await hostOn(on), address, hint);
export const heldOn = async (on, address, hint) => heldIn(await hostOn(on), address, hint);

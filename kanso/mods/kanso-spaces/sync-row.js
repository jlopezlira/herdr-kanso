// The sidebar's side of Sync: it reads the config and status, and turns one machine on or off.
import { readTextFile, writeTextFile, appHome, setShared } from "herdr";
import { SYNC_KICK, configFrom, configText, statusFrom, syncDir, withPeer } from "./sync.js";
import { tryOrAsync } from "./pure.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
import { localService } from "./platform-host.js";

const fileOf = (name) => paths.join(syncDir(appHome()), name);

export async function readSync() {
  return {
    config: configFrom(await tryOrAsync(() => readTextFile(fileOf("config.json")))),
    status: statusFrom(await tryOrAsync(() => readTextFile(fileOf("status.json")))),
  };
}

// Applied to the file as it is now, so another window's change is kept.
export async function saveSync(name, enabled) {
  const file = fileOf("config.json");
  await localService(fileApi).mkdir(syncDir(appHome()));
  const prev = await readTextFile(file);
  const config = withPeer(configFrom(prev), name, enabled);
  await writeTextFile(file, configText(config), prev);
  setShared(SYNC_KICK, Date.now());
  return config;
}

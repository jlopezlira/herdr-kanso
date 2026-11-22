import { readTextFile, writeTextFile, appHome, notify } from "herdr";
import { paths } from "./platform-paths.js";
import { DEFAULT_KEYS } from "./defaults.js";
import { migrateToLinux } from "./platform-linux-keys.js";
import { formerKeymap } from "./platform-keymap.js";
import { tryOr, tryOrAsync } from "./pure.js";

export async function arriveOnLinux(platform) {
  const former = formerKeymap(platform);
  if (!former) return false;
  const file = paths.join(appHome(), "keys.json");
  const text = await tryOrAsync(() => readTextFile(file));
  const user = text ? tryOr(() => JSON.parse(text), null) : null;
  if (!user) return false;
  const { keys, changed } = migrateToLinux(user, DEFAULT_KEYS[former]);
  if (!changed) return false;
  await writeTextFile(file, `${JSON.stringify(keys, null, 2)}\n`, text);
  notify({ title: "kansō's keys now work with Omarchy" });
  return true;
}

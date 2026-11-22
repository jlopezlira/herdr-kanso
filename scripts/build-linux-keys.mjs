import { readFileSync, writeFileSync } from "node:fs";
import { CHECK, ROOT_URL as ROOT } from "./cli.mjs";
import { linuxKeymap } from "../kanso/mods/kanso-panel/platform-linux-keys.js";

const target = new URL("kanso/keys.linux.json", ROOT);
const text = `${JSON.stringify(linuxKeymap(JSON.parse(readFileSync(new URL("kanso/keys.json", ROOT), "utf8"))), null, 2)}\n`;
const current = (() => { try { return readFileSync(target, "utf8"); } catch { return null; } })();
if (CHECK) {
  if (current !== text) { console.error("kanso/keys.linux.json differs from kanso/keys.json: run npm run build:linux-keys"); process.exit(1); }
  console.log("kanso/keys.linux.json matches kanso/keys.json");
} else if (current !== text) {
  writeFileSync(target, text);
  console.log("wrote kanso/keys.linux.json");
}

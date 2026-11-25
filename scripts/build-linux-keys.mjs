import { readFileSync } from "node:fs";
import { ROOT_URL as ROOT, generated } from "./cli.mjs";
import { shippedLinuxKeymap } from "../kanso/mods/kanso-panel/platform-linux-keys.js";

const text = `${JSON.stringify(shippedLinuxKeymap(JSON.parse(readFileSync(new URL("kanso/keys.json", ROOT), "utf8"))), null, 2)}\n`;
generated("kanso/keys.linux.json", text, { from: "kanso/keys.json", script: "build:linux-keys" });

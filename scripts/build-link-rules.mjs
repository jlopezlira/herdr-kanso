import { readFileSync, writeFileSync } from "node:fs";
import { CHECK, ROOT_URL as ROOT } from "./cli.mjs";
import { PREVIEWABLE } from "../kanso/mods/kanso-panel/kinds.js";

const target = new URL("kanso/mods/kanso-panel/mod.json", ROOT);
const current = readFileSync(target, "utf8");
const manifest = { ...JSON.parse(current), link_handlers: [{ kind: "file", pattern: `(?i)\\.(${PREVIEWABLE.join("|")})$` }] };
const text = `${JSON.stringify(manifest)}\n`;
if (CHECK) {
  if (current !== text) { console.error("kanso/mods/kanso-panel/mod.json differs from the preview's file kinds: run npm run build:link-rules"); process.exit(1); }
  console.log("kanso/mods/kanso-panel/mod.json matches the preview's file kinds");
} else if (current !== text) {
  writeFileSync(target, text);
  console.log("wrote kanso/mods/kanso-panel/mod.json");
}

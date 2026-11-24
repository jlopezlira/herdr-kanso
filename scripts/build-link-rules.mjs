import { readFileSync } from "node:fs";
import { ROOT_URL as ROOT, generated } from "./cli.mjs";
import { PREVIEWABLE } from "../kanso/mods/kanso-panel/kinds.js";

const name = "kanso/mods/kanso-panel/mod.json";
const manifest = { ...JSON.parse(readFileSync(new URL(name, ROOT), "utf8")), link_handlers: [{ kind: "file", pattern: `(?i)\\.(${PREVIEWABLE.join("|")})$` }] };
generated(name, `${JSON.stringify(manifest)}\n`, { from: "the preview's file kinds", script: "build:link-rules" });

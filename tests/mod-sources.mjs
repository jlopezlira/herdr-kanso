// Every mod source but the kit (kit.js and its ui-*.js drawing files) and no shared copy, whose source is read once.
import { readdirSync } from "node:fs";
import { SHARED } from "../scripts/sync-share.mjs";

const MODS = "kanso/mods/";
const COPIES = new Set(SHARED.flatMap(({ copies }) => copies));

export const outsideKit = () => [
  ...readdirSync(new URL(`../${MODS}`, import.meta.url), { recursive: true }).map((p) => `${MODS}${String(p).split("\\").join("/")}`),
  "markdown-panel/mods/markdown-panel/main.js",
].filter((file) => file.endsWith(".js") && !COPIES.has(file) && !/\/(?:ui(-[\w-]+)?|kit)\.js$/.test(file));

// Files used by more than one mod. Herdr loads a mod's files from its own
// folder only, so the source (the one you edit) is copied into every other
// mod that uses it. `--check` fails instead when a copy differs.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
// Each shared file (relative to the repo), and where it is copied.
export const SHARED = [
  { source: "kanso/mods/kanso-panel/share.js", copies: ["kanso/mods/kanso-spend/share.js", "kanso/mods/kanso-guard/share.js", "kanso/mods/kanso-dojo/share.js"] },
  // The panels' kit: tokens, spacing, quiet links, icon buttons, silhouettes.
  { source: "kanso/mods/kanso-panel/ui.js", copies: ["kanso/mods/kanso-spend/ui.js", "kanso/mods/kanso-settings/ui.js", "kanso/mods/kanso-guard/ui.js", "kanso/mods/kanso-help/ui.js", "kanso/mods/kanso-dojo/ui.js"] },
  // An agent's state mark, program icon and name, the same in the tabs, headers, status bar, sidebar and Send.
  { source: "kanso/mods/kanso-spaces/marks.js", copies: ["kanso/mods/kanso-tabs/marks.js", "kanso/mods/kanso-strip/marks.js", "kanso/mods/kanso-status/marks.js", "kanso/mods/kanso-send/marks.js", "kanso/mods/kanso-settings/marks.js", "kanso/mods/kanso-help/marks.js"] },
  // The layout writers' helpers: what each keeps, and how a write puts it all back.
  // Kanso's own updates: the footer shows the row, the tab bar (always on
  // screen, unlike the sidebar) checks, tells you and installs from the toast.
  { source: "kanso/mods/kanso-chrome/update.js", copies: ["kanso/mods/kanso-tabs/update.js"] },
  // Daru, the dōjō's daruma, also on kansō help's way into the dōjō.
  { source: "kanso/mods/kanso-dojo/mascot.js", copies: ["kanso/mods/kanso-help/mascot.js"] },
  // Lists by keyboard (j/k, gg/G, Enter, Esc), the same in every menu and list.
  { source: "kanso/mods/kanso-menu/listkeys.js", copies: ["kanso/mods/open-with/listkeys.js", "kanso/mods/kanso-spaces/listkeys.js", "kanso/mods/kanso-sleep/listkeys.js", "kanso/mods/kanso-arrange/listkeys.js"] },
  // Opening a tab from data: arrangements and sleeping tabs.
  { source: "kanso/mods/kanso-arrange/tabkit.js", copies: ["kanso/mods/kanso-sleep/tabkit.js", "kanso/mods/kanso-spaces/tabkit.js"] },
  { source: "kanso/mods/kanso-tabs/layout.js", copies: ["kanso/mods/kanso-strip/layout.js", "kanso/mods/kanso-spaces/layout.js", "kanso/mods/kanso-panel/layout.js", "kanso/mods/open-with/layout.js"] },
  // The Markdown editor: Kanso's preview panel is the source, the standalone
  // markdown-panel mod a copy.
  { source: "kanso/mods/kanso-panel/doc.js", copies: ["markdown-panel/mods/markdown-panel/doc.js"] },
  { source: "kanso/mods/kanso-panel/blocks.js", copies: ["markdown-panel/mods/markdown-panel/blocks.js"] },
  { source: "kanso/mods/kanso-tabs/markdown-handler.sh", copies: ["markdown-panel/mods/markdown-panel/markdown-handler.sh"] },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const { source: from, copies } of SHARED) {
    const source = await readFile(new URL(from, root), "utf8");
    for (const copy of copies) {
      const target = new URL(copy, root);
      const current = await readFile(target, "utf8").catch(() => null);
      if (current === source) continue;
      if (check) { console.error(`${copy} differs from ${from}: run npm run sync:share`); stale += 1; }
      else { await writeFile(target, source); console.log(`copied ${from} to ${copy}`); }
    }
  }
  process.exit(stale ? 1 : 0);
}

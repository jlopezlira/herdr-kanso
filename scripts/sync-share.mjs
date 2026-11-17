// Files used by more than one mod. Herdr loads a mod's files from its own
// folder only, so the source (the one you edit) is copied into every other
// mod that uses it. `--check` fails instead when a copy differs.
import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import { CHECK, isMain } from "./cli.mjs";

const root = new URL("../", import.meta.url);
// Each shared file (relative to the repo), and where it is copied.
const COMMON = [
  { source: "kanso/mods/kanso-panel/share.js", copies: ["kanso/mods/kanso-spend/share.js", "kanso/mods/kanso-guard/share.js", "kanso/mods/kanso-dojo/share.js"] },
  // What can be shown, shown when it has something to say, or hidden. Hide stops the work.
  { source: "kanso/mods/kanso-settings/pieces.js", copies: ["kanso-spaces", "kanso-strip", "kanso-chrome", "kanso-tabs", "kanso-status", "kanso-panel", "kanso-sim"].map((m) => `kanso/mods/${m}/pieces.js`) },
  // An agent's program icon and name, and the key caps, the same in the tabs, headers, status bar, sidebar and Send.
  { source: "kanso/mods/kanso-spaces/marks.js", copies: ["kanso/mods/kanso-strip/marks.js", "kanso/mods/kanso-status/marks.js", "kanso/mods/kanso-send/marks.js", "kanso/mods/kanso-settings/marks.js", "kanso/mods/kanso-help/marks.js", "kanso/mods/kanso-panel/marks.js", "kanso/mods/kanso-toast/marks.js", "kanso/mods/kanso-chrome/marks.js"] },
  // Text for an agent, delivered the same from Send and from Look.
  { source: "kanso/mods/kanso-send/deliver.js", copies: ["kanso/mods/kanso-panel/deliver.js"] },
  // What a file is by its name: the preview panel's text, Look's pictures, Open with's "Preview in the panel".
  { source: "kanso/mods/kanso-panel/kinds.js", copies: ["kanso/mods/open-with/kinds.js"] },
  // The layout writers' helpers: what each keeps, and how a write puts it all back.
  // Kanso's own updates: the footer shows the row, the tab bar (always on
  // screen, unlike the sidebar) checks, tells you and installs from the toast.
  { source: "kanso/mods/kanso-chrome/update.js", copies: ["kanso/mods/kanso-tabs/update.js"] },
  { source: "kanso/mods/kanso-chrome/notices.js", copies: ["kanso/mods/kanso-tabs/notices.js"] },
  // The footer's rows and sizes: the footer draws them, the tab bar's updater fits the footer to them.
  { source: "kanso/mods/kanso-chrome/footer-model.js", copies: ["kanso/mods/kanso-tabs/footer-model.js"] },
  // Order of a beta, a release candidate and a stable tag, shared with that updater.
  { source: "kanso/mods/kanso-chrome/release.js", copies: ["kanso/mods/kanso-tabs/release.js", "kanso/mods/kanso-settings/release.js"] },
  // A pull request's checks, read one way in the PR panel and the header.
  { source: "kanso/mods/kanso-panel/ghchecks.js", copies: ["kanso/mods/kanso-strip/ghchecks.js"] },
  // The key a second Cmd+F or Ctrl+F uses to select the query in the open bar.
  { source: "kanso/mods/kanso-panel/find-key.js", copies: ["kanso/mods/kanso-strip/find-key.js"] },
  // Hachi, the dōjō's shiba, also on kansō help's way into the dōjō.
  { source: "kanso/mods/kanso-dojo/mascot.js", copies: ["kanso/mods/kanso-help/mascot.js"] },
  { source: "kanso/mods/kanso-dojo/mascot-pixels.js", copies: ["kanso/mods/kanso-help/mascot-pixels.js"] },
  // Your pet and the one to choose, in the dōjō and on kansō help's dōjō page; the choice kept in the dōjō's SQLite.
  { source: "kanso/mods/kanso-dojo/pets.js", copies: ["kanso/mods/kanso-help/pets.js"] },
  { source: "kanso/mods/kanso-dojo/store.js", copies: ["kanso/mods/kanso-help/store.js"] },
  // The cap a key press lights for a moment, in the dōjō and on help's keyboard page.
  { source: "kanso/mods/kanso-dojo/lit.js", copies: ["kanso/mods/kanso-help/lit.js"] },
  // The Open with popup, from the terminal's menu and from the strip's pane menu.
  { source: "kanso/mods/open-with/popup.js", copies: ["kanso/mods/kanso-menu/popup.js", "kanso/mods/kanso-strip/popup.js"] },
  // The way into the arrangements dialog, from the tab bar and from the strip.
  { source: "kanso/mods/kanso-arrange/open.js", copies: ["kanso/mods/kanso-strip/open.js", "kanso/mods/kanso-tabs/open.js"] },
  // The answer both rename dialogs give: a terminal's label, or a command with the new name.
  { source: "kanso/mods/kanso-prompt/rename.js", copies: ["kanso/mods/kanso-prompt-editor/rename.js"] },
  // A folder's short word, the same in Send and in the strip's pane header.
  { source: "kanso/mods/kanso-send/folder.js", copies: ["kanso/mods/kanso-strip/folder.js"] },
  // The one window kansō help and kansō settings share.
  { source: "kanso/mods/kanso-settings/pages.js", copies: ["kanso/mods/kanso-help/pages.js"] },
  // The shell of a full-page mod view: Memory draws in it, Containers the same.
  { source: "kanso/mods/kanso-guard/page.js", copies: ["kanso/mods/kanso-containers/page.js"] },
  // One SQLite file under the app's folder: the stores of arrangements and of the dōjō (and help's copy of it).
  { source: "kanso/mods/kanso-dojo/file-store.js", copies: ["kanso/mods/kanso-help/file-store.js", "kanso/mods/kanso-arrange/file-store.js"] },
  // Lists by keyboard (j/k, gg/G, Enter, Esc), the same in every menu and list.
  { source: "kanso/mods/kanso-menu/listkeys.js", copies: ["kanso/mods/open-with/listkeys.js", "kanso/mods/kanso-spaces/listkeys.js", "kanso/mods/kanso-arrange/listkeys.js"] },
  // Opening a tab from data: arrangements; Sleep reads a few of its words.
  { source: "kanso/mods/kanso-arrange/tabkit.js", copies: ["kanso/mods/kanso-sleep/tabkit.js", "kanso/mods/kanso-spaces/tabkit.js"] },
  // Reading `ps`: the sidebar's tasks and liveness, the panel's ports.
  { source: "kanso/mods/kanso-spaces/procs.js", copies: ["kanso/mods/kanso-panel/procs.js", "kanso/mods/kanso-guard/procs.js"] },
  // How a Claude Code command resumes a conversation: Sleep labels and wakes with it, Memory
  // recycles with it (under Node), and a tab opened fresh drops what it names.
  { source: "kanso/mods/kanso-sleep/resume.js", copies: ["kanso/mods/kanso-guard/resume.js", "kanso/mods/kanso-arrange/resume.js", "kanso/mods/kanso-spaces/resume.js"] },
  // The left nav's one database: the sidebar owns it, the panels read the same files.
  { source: "kanso/mods/kanso-spaces/since-left-model.js", copies: ["kanso/mods/kanso-panel/since-left-model.js"] },
  { source: "kanso/mods/kanso-spaces/since-left-store.js", copies: ["kanso/mods/kanso-panel/since-left-store.js"] },
  { source: "kanso/mods/kanso-spaces/kdb.js", copies: ["kanso/mods/kanso-panel/kdb.js", "kanso/mods/kanso-tabs/kdb.js", "kanso/mods/kanso-spend/kdb.js"] },
  // Off is a saved row plus hc machine ls. Spend asks neither file from another mod.
  { source: "kanso/mods/kanso-spaces/machines.js", copies: ["kanso/mods/kanso-spend/machines.js"] },
  // Which panel is open, and the two hooks every panel uses to keep its own state.
  { source: "kanso/mods/kanso-panel/panel-state.js", copies: ["kanso/mods/kanso-tabs/panel-state.js"] },
  { source: "kanso/mods/kanso-sim/registration.js", copies: ["kanso/mods/kanso-tabs/sim-registration.js"] },
  // One key waiter: the sidebar's commands, and Preview's Save, each while that view is up.
  { source: "kanso/mods/kanso-spaces/sidebar.js", copies: ["kanso/mods/kanso-panel/sidebar.js"] },
  // No reassignment anywhere: retry, range, parseOr... in every mod.
  { source: "kanso/mods/kanso-spaces/pure.js", copies: ["kanso-arrange", "kanso-chrome", "kanso-containers", "kanso-dojo", "kanso-guard", "kanso-help", "kanso-menu", "kanso-panel", "kanso-prompt", "kanso-prompt-editor", "kanso-send", "kanso-settings", "kanso-sleep", "kanso-spend", "kanso-status", "kanso-strip", "kanso-tabs", "open-with"].map((m) => `kanso/mods/${m}/pure.js`).concat(["markdown-panel/mods/markdown-panel/pure.js", "open-with/mods/open-with/pure.js"]) },
  // Who this computer is, and rows exchanged with the others. Spend runs it; the sidebar turns it on per machine.
  { source: "kanso/mods/kanso-spend/sync.js", copies: ["kanso/mods/kanso-spaces/sync.js"] },
  { source: "kanso/mods/kanso-tabs/layout.js", copies: ["kanso/mods/kanso-strip/layout.js", "kanso/mods/kanso-spaces/layout.js", "kanso/mods/kanso-panel/layout.js", "kanso/mods/open-with/layout.js"] },
  // The Markdown editor: Kanso's preview panel is the source, the standalone
  // markdown-panel mod a copy.
  { source: "kanso/mods/kanso-panel/doc.js", copies: ["markdown-panel/mods/markdown-panel/doc.js"] },
  { source: "kanso/mods/kanso-panel/edit.js", copies: ["markdown-panel/mods/markdown-panel/edit.js"] },
  // A file on another machine, copied here so a picture can be drawn. The markdown editor uses it too.
  { source: "kanso/mods/kanso-panel/remote-file.js", copies: ["markdown-panel/mods/markdown-panel/remote-file.js"] },
  // One wake when a panel that was behind, or hidden, is in front again.
  { source: "kanso/mods/kanso-panel/front.js", copies: ["kanso/mods/kanso-containers/front.js", "kanso/mods/kanso-sim/front.js"] },
  // Storybook compositions the app draws as they are, each in the mod that draws it.
  { source: "stories/kit/session-row.js", copies: ["kanso/mods/kanso-spaces/session-row.js"] },
  { source: "kanso/mods/kanso-panel/blocks.js", copies: ["markdown-panel/mods/markdown-panel/blocks.js"] },
  { source: "kanso/mods/kanso-tabs/markdown-handler.sh", copies: ["markdown-panel/mods/markdown-panel/markdown-handler.sh"] },
];

// Platform modules and the panels' kit (ui.js, one ui-<piece>.js per piece, and kit.js for shared compositions): a mod gets only the ones it imports.
const PLATFORM = "kanso/mods/kanso-panel/";
export const sharedFile = (name) => /^(?:(?:platform|ui)(?:-[\w-]+)?|kit)\.js$/.test(name);
const imports = (text) => [...text.matchAll(/^import\s+(?:(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)\s+from\s+)?["']\.\/([^"']+)["'];/gm)].map((match) => match[1]);

export function sharedDependencies(modules, canonical) {
  const needed = new Set();
  const visit = (name) => {
    if (!sharedFile(name) || needed.has(name)) return;
    if (!canonical.has(name)) throw new Error(`Unknown shared module: ${name}`);
    needed.add(name);
    imports(canonical.get(name)).forEach(visit);
  };
  modules.flatMap(imports).forEach(visit);
  return needed;
}

// Every mod folder under kanso/mods, as a path from the repository.
export const kansoModFolders = async () => (await readdir(new URL("kanso/mods/", root), { withFileTypes: true })).filter((entry) => entry.isDirectory())
  .map((entry) => `kanso/mods/${entry.name}/`);

async function importedShares() {
  const canonical = new Map(await Promise.all((await readdir(new URL(PLATFORM, root))).filter(sharedFile)
    .map(async (name) => [name, await readFile(new URL(PLATFORM + name, root), "utf8")])));
  const shared = new Map([...canonical.keys()].map((name) => [name, { source: PLATFORM + name, copies: [] }]));
  const overrides = new Map(COMMON.flatMap(({ source, copies }) => copies.map((copy) => [copy, source])));
  const folders = (await kansoModFolders()).concat(["markdown-panel/mods/markdown-panel/"]);
  const obsolete = [];
  for (const folder of folders) {
    if (folder === PLATFORM) continue;
    const names = await readdir(new URL(folder, root));
    const planned = [...new Set([...names, ...[...overrides.keys()].filter((copy) => copy.startsWith(folder)).map((copy) => copy.slice(folder.length))])];
    const modules = await Promise.all(planned.filter((name) => /\.m?js$/.test(name) && !sharedFile(name))
      .map((name) => readFile(new URL(overrides.get(folder + name) ?? folder + name, root), "utf8")));
    const needed = sharedDependencies(modules, canonical);
    for (const name of needed) shared.get(name).copies.push(folder + name);
    obsolete.push(...names.filter((name) => sharedFile(name) && !needed.has(name)).map((name) => folder + name));
  }
  return { shared: [...shared.values()].filter(({ copies }) => copies.length), obsolete };
}
const imported = await importedShares();
export const SHARED = [...COMMON, ...imported.shared];

if (isMain(import.meta.url)) {
  let stale = 0;
  for (const copy of imported.obsolete) {
    if (CHECK) { console.error(`${copy} is unused: run npm run sync:share`); stale += 1; }
    else { await rm(new URL(copy, root)); console.log(`removed unused ${copy}`); }
  }
  for (const { source: from, copies } of SHARED) {
    const source = await readFile(new URL(from, root), "utf8");
    for (const copy of copies) {
      const target = new URL(copy, root);
      const current = await readFile(target, "utf8").catch(() => null);
      if (current === source) continue;
      if (CHECK) { console.error(`${copy} differs from ${from}: run npm run sync:share`); stale += 1; }
      else { await writeFile(target, source); console.log(`copied ${from} to ${copy}`); }
    }
  }
  process.exit(stale ? 1 : 0);
}

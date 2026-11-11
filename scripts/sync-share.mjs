// Files used by more than one mod. Herdr loads a mod's files from its own
// folder only, so the source (the one you edit) is copied into every other
// mod that uses it. `--check` fails instead when a copy differs.
import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
// Each shared file (relative to the repo), and where it is copied.
const COMMON = [
  { source: "kanso/mods/kanso-panel/share.js", copies: ["kanso/mods/kanso-spend/share.js", "kanso/mods/kanso-guard/share.js", "kanso/mods/kanso-dojo/share.js"] },
  // The panels' kit: tokens, spacing, quiet links, icon buttons, silhouettes.
  { source: "kanso/mods/kanso-panel/ui.js", copies: ["kanso/mods/kanso-spend/ui.js", "kanso/mods/kanso-settings/ui.js", "kanso/mods/kanso-guard/ui.js", "kanso/mods/kanso-help/ui.js", "kanso/mods/kanso-dojo/ui.js", "kanso/mods/kanso-containers/ui.js", "kanso/mods/kanso-spaces/ui.js", "kanso/mods/kanso-sleep/ui.js", "kanso/mods/kanso-arrange/ui.js", "kanso/mods/kanso-sim/ui.js", "markdown-panel/mods/markdown-panel/ui.js"] },
  // What can be shown, shown when it has something to say, or hidden. Hide stops the work.
  { source: "kanso/mods/kanso-settings/pieces.js", copies: ["kanso-spaces", "kanso-strip", "kanso-chrome", "kanso-tabs", "kanso-status", "kanso-panel", "kanso-sleep"].map((m) => `kanso/mods/${m}/pieces.js`) },
  // An agent's state mark, program icon and name, the same in the tabs, headers, status bar, sidebar and Send.
  { source: "kanso/mods/kanso-spaces/marks.js", copies: ["kanso/mods/kanso-tabs/marks.js", "kanso/mods/kanso-strip/marks.js", "kanso/mods/kanso-status/marks.js", "kanso/mods/kanso-send/marks.js", "kanso/mods/kanso-settings/marks.js", "kanso/mods/kanso-help/marks.js", "kanso/mods/kanso-panel/marks.js"] },
  // Text for an agent, delivered the same from Send and from Look.
  { source: "kanso/mods/kanso-send/deliver.js", copies: ["kanso/mods/kanso-panel/deliver.js"] },
  // What a file is by its name: the preview panel's text, Look's pictures, Open with's "Preview in the panel".
  { source: "kanso/mods/kanso-panel/kinds.js", copies: ["kanso/mods/open-with/kinds.js"] },
  // The layout writers' helpers: what each keeps, and how a write puts it all back.
  // Kanso's own updates: the footer shows the row, the tab bar (always on
  // screen, unlike the sidebar) checks, tells you and installs from the toast.
  { source: "kanso/mods/kanso-chrome/update.js", copies: ["kanso/mods/kanso-tabs/update.js"] },
  // Order of a beta, a release candidate and a stable tag, shared with that updater.
  { source: "kanso/mods/kanso-chrome/release.js", copies: ["kanso/mods/kanso-tabs/release.js", "kanso/mods/kanso-settings/release.js"] },
  // A pull request's checks, read one way in the PR panel and the header's digest.
  { source: "kanso/mods/kanso-panel/ghchecks.js", copies: ["kanso/mods/kanso-strip/ghchecks.js"] },
  // The key a second Cmd+F or Ctrl+F uses to select the query in the open bar.
  { source: "kanso/mods/kanso-panel/find-key.js", copies: ["kanso/mods/kanso-strip/find-key.js"] },
  // Hachi, the dōjō's shiba, also on kansō help's way into the dōjō.
  { source: "kanso/mods/kanso-dojo/mascot.js", copies: ["kanso/mods/kanso-help/mascot.js"] },
  // Your pet and the one to choose, in the dōjō and on kansō help's dōjō page; the choice kept in the dōjō's SQLite.
  { source: "kanso/mods/kanso-dojo/pets.js", copies: ["kanso/mods/kanso-help/pets.js"] },
  { source: "kanso/mods/kanso-dojo/store.js", copies: ["kanso/mods/kanso-help/store.js"] },
  // Lists by keyboard (j/k, gg/G, Enter, Esc), the same in every menu and list.
  { source: "kanso/mods/kanso-menu/listkeys.js", copies: ["kanso/mods/open-with/listkeys.js", "kanso/mods/kanso-spaces/listkeys.js", "kanso/mods/kanso-sleep/listkeys.js", "kanso/mods/kanso-arrange/listkeys.js"] },
  // Opening a tab from data: arrangements and sleeping tabs.
  { source: "kanso/mods/kanso-arrange/tabkit.js", copies: ["kanso/mods/kanso-sleep/tabkit.js", "kanso/mods/kanso-spaces/tabkit.js"] },
  // Reading `ps`: the sidebar's tasks and liveness, the panel's ports.
  { source: "kanso/mods/kanso-spaces/procs.js", copies: ["kanso/mods/kanso-panel/procs.js", "kanso/mods/kanso-guard/procs.js", "kanso/mods/kanso-sleep/procs.js"] },
  // How a Claude Code command resumes a conversation: Sleep wakes with it, Memory
  // recycles with it (under Node), and a tab opened fresh drops what it names.
  { source: "kanso/mods/kanso-sleep/resume.js", copies: ["kanso/mods/kanso-guard/resume.js", "kanso/mods/kanso-arrange/resume.js", "kanso/mods/kanso-spaces/resume.js"] },
  // The left nav's one database and what sleeps in it (sleep is a state of an
  // agent there): the sidebar owns them, Sleep uses the same files.
  { source: "kanso/mods/kanso-spaces/since-left-model.js", copies: ["kanso-sleep", "kanso-panel"].map((m) => `kanso/mods/${m}/since-left-model.js`) },
  { source: "kanso/mods/kanso-spaces/since-left-store.js", copies: ["kanso/mods/kanso-panel/since-left-store.js"] },
  { source: "kanso/mods/kanso-spaces/kdb.js", copies: ["kanso/mods/kanso-sleep/kdb.js", "kanso/mods/kanso-panel/kdb.js", "kanso/mods/kanso-tabs/kdb.js", "kanso/mods/kanso-spend/kdb.js"] },
  // Off is a saved row plus hc machine ls. Spend asks neither file from another mod.
  { source: "kanso/mods/kanso-spaces/machines.js", copies: ["kanso/mods/kanso-spend/machines.js"] },
  // Which panel is open, and the two hooks every panel uses to keep its own state.
  { source: "kanso/mods/kanso-panel/panel-state.js", copies: ["kanso/mods/kanso-tabs/panel-state.js"] },
  { source: "kanso/mods/kanso-sim/sim-register.js", copies: ["kanso/mods/kanso-tabs/sim-register.js"] },
  { source: "kanso/mods/kanso-spaces/store.js", copies: ["kanso/mods/kanso-sleep/store.js"] },
  // Sleep as the sidebar's work: the dialog writes what is to sleep, the sidebar moves it step by step.
  { source: "kanso/mods/kanso-spaces/sleepwork.js", copies: ["kanso/mods/kanso-sleep/sleepwork.js"] },
  // No reassignment anywhere: retry, range, parseOr... in every mod.
  { source: "kanso/mods/kanso-spaces/pure.js", copies: ["kanso-arrange", "kanso-chrome", "kanso-containers", "kanso-dojo", "kanso-guard", "kanso-help", "kanso-menu", "kanso-panel", "kanso-prompt", "kanso-prompt-editor", "kanso-send", "kanso-settings", "kanso-sleep", "kanso-spend", "kanso-status", "kanso-strip", "kanso-tabs", "open-with"].map((m) => `kanso/mods/${m}/pure.js`).concat(["markdown-panel/mods/markdown-panel/pure.js"]) },
  // Who this computer is, and rows exchanged with the others. Spend runs it; the sidebar turns it on per machine.
  { source: "kanso/mods/kanso-spend/sync.js", copies: ["kanso/mods/kanso-spaces/sync.js"] },
  { source: "kanso/mods/kanso-tabs/layout.js", copies: ["kanso/mods/kanso-strip/layout.js", "kanso/mods/kanso-spaces/layout.js", "kanso/mods/kanso-panel/layout.js", "kanso/mods/open-with/layout.js"] },
  // The Markdown editor: Kanso's preview panel is the source, the standalone
  // markdown-panel mod a copy.
  { source: "kanso/mods/kanso-panel/doc.js", copies: ["markdown-panel/mods/markdown-panel/doc.js"] },
  // A file on another machine, copied here so a picture can be drawn. The markdown editor uses it too.
  { source: "kanso/mods/kanso-panel/remote-file.js", copies: ["markdown-panel/mods/markdown-panel/remote-file.js"] },
  // One wake when a panel that was behind, or hidden, is in front again.
  { source: "kanso/mods/kanso-panel/front.js", copies: ["kanso/mods/kanso-containers/front.js"] },
  { source: "kanso/mods/kanso-panel/blocks.js", copies: ["markdown-panel/mods/markdown-panel/blocks.js"] },
  { source: "kanso/mods/kanso-tabs/markdown-handler.sh", copies: ["markdown-panel/mods/markdown-panel/markdown-handler.sh"] },
];

const PLATFORM = "kanso/mods/kanso-panel/";
const platformFile = (name) => /^platform(?:-[\w-]+)?\.js$/.test(name);
const imports = (text) => [...text.matchAll(/^import\s+(?:(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)\s+from\s+)?["']\.\/([^"']+)["'];/gm)].map((match) => match[1]);

export function platformDependencies(modules, canonical) {
  const needed = new Set();
  const visit = (name) => {
    if (!platformFile(name) || needed.has(name)) return;
    if (!canonical.has(name)) throw new Error(`Unknown platform module: ${name}`);
    needed.add(name);
    imports(canonical.get(name)).forEach(visit);
  };
  modules.flatMap(imports).forEach(visit);
  return needed;
}

async function platformShares() {
  const canonical = new Map(await Promise.all((await readdir(new URL(PLATFORM, root))).filter(platformFile)
    .map(async (name) => [name, await readFile(new URL(PLATFORM + name, root), "utf8")])));
  const shared = new Map([...canonical.keys()].map((name) => [name, { source: PLATFORM + name, copies: [] }]));
  const overrides = new Map(COMMON.flatMap(({ source, copies }) => copies.map((copy) => [copy, source])));
  const folders = (await readdir(new URL("kanso/mods/", root), { withFileTypes: true })).filter((entry) => entry.isDirectory())
    .map((entry) => `kanso/mods/${entry.name}/`).concat(["markdown-panel/mods/markdown-panel/"]);
  const obsolete = [];
  for (const folder of folders) {
    if (folder === PLATFORM) continue;
    const names = await readdir(new URL(folder, root));
    const planned = [...new Set([...names, ...[...overrides.keys()].filter((copy) => copy.startsWith(folder)).map((copy) => copy.slice(folder.length))])];
    const modules = await Promise.all(planned.filter((name) => /\.m?js$/.test(name) && !platformFile(name))
      .map((name) => readFile(new URL(overrides.get(folder + name) ?? folder + name, root), "utf8")));
    const needed = platformDependencies(modules, canonical);
    for (const name of needed) shared.get(name).copies.push(folder + name);
    obsolete.push(...names.filter((name) => platformFile(name) && !needed.has(name)).map((name) => folder + name));
  }
  return { shared: [...shared.values()].filter(({ copies }) => copies.length), obsolete };
}
const platform = await platformShares();
export const SHARED = [...COMMON, ...platform.shared];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const copy of platform.obsolete) {
    if (check) { console.error(`${copy} is unused: run npm run sync:share`); stale += 1; }
    else { await rm(new URL(copy, root)); console.log(`removed unused ${copy}`); }
  }
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

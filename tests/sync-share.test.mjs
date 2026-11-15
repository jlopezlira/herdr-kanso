import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { SHARED, sharedDependencies } from "../scripts/sync-share.mjs";

const root = new URL("../", import.meta.url);
const source = "kanso/mods/kanso-panel/";
const platformFile = (name) => /^(?:platform|ui)(?:-[\w-]+)?\.js$/.test(name);

test("Platform copies follow only direct and transitive imports, including cycles", () => {
  const canonical = new Map([
    ["platform-files.js", 'import { quote } from "./platform-command.js";\n'],
    ["platform-command.js", 'import { files } from "./platform-files.js";\n'],
    ["platform-processes.js", ""],
  ]);
  const modules = ['import {\n fileApi,\n} from "./platform-files.js";\nimport { paths } from "./ordinary.js";\n'];
  assert.deepEqual([...sharedDependencies(modules, canonical)].sort(), ["platform-command.js", "platform-files.js"]);
  assert.equal(sharedDependencies(["const platform = 'windows';"], canonical).size, 0);
  assert.throws(() => sharedDependencies(['import "./platform-missing.js";'], canonical), /Unknown shared module/);
});

test("A mod that imports one piece of the kit gets that piece and the base it uses, nothing else", () => {
  const canonical = new Map([
    ["ui.js", ""],
    ["ui-button.js", 'import { G } from "./ui.js";\n'],
    ["ui-field.js", 'import { G } from "./ui.js";\nimport { iconButton } from "./ui-button.js";\n'],
    ["ui-tab.js", 'import { G } from "./ui.js";\n'],
  ]);
  assert.deepEqual([...sharedDependencies(['import { tab } from "./ui-tab.js";\n'], canonical)].sort(), ["ui-tab.js", "ui.js"]);
  assert.deepEqual([...sharedDependencies(['import { field } from "./ui-field.js";\n'], canonical)].sort(), ["ui-button.js", "ui-field.js", "ui.js"]);
  assert.deepEqual([...sharedDependencies(['import { G } from "./ui.js";\n'], canonical)], ["ui.js"]);
});

test("Every shipped platform and kit copy is required by its mod's imports", async () => {
  const names = (await readdir(new URL(source, root))).filter(platformFile);
  const canonical = new Map(await Promise.all(names.map(async (name) => [name, await readFile(new URL(source + name, root), "utf8")])));
  const folders = (await readdir(new URL("kanso/mods/", root), { withFileTypes: true })).filter((entry) => entry.isDirectory())
    .map((entry) => `kanso/mods/${entry.name}/`).concat(["markdown-panel/mods/markdown-panel/", "open-with/mods/open-with/"]);
  for (const folder of folders.filter((folder) => folder !== source)) {
    const files = await readdir(new URL(folder, root));
    const modules = await Promise.all(files.filter((name) => /\.m?js$/.test(name) && !platformFile(name)).map((name) => readFile(new URL(folder + name, root), "utf8")));
    const needed = [...sharedDependencies(modules, canonical)].sort();
    assert.deepEqual(files.filter(platformFile).sort(), needed, folder);
    if (folder.startsWith("kanso/") || folder.startsWith("markdown-panel/")) {
      const listed = SHARED.flatMap(({ copies }) => copies).filter((copy) => copy.startsWith(folder) && platformFile(copy.slice(folder.length))).map((copy) => copy.slice(folder.length)).sort();
      assert.deepEqual(listed, needed, `${folder} sync map`);
    }
  }
});

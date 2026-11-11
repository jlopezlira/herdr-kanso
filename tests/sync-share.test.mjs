import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { SHARED, platformDependencies } from "../scripts/sync-share.mjs";

const root = new URL("../", import.meta.url);
const source = "kanso/mods/kanso-panel/";
const platformFile = (name) => /^platform(?:-[\w-]+)?\.js$/.test(name);

test("Platform copies follow only direct and transitive imports, including cycles", () => {
  const canonical = new Map([
    ["platform-files.js", 'import { quote } from "./platform-command.js";\n'],
    ["platform-command.js", 'import { files } from "./platform-files.js";\n'],
    ["platform-processes.js", ""],
  ]);
  const modules = ['import {\n fileApi,\n} from "./platform-files.js";\nimport { paths } from "./ordinary.js";\n'];
  assert.deepEqual([...platformDependencies(modules, canonical)].sort(), ["platform-command.js", "platform-files.js"]);
  assert.equal(platformDependencies(["const platform = 'windows';"], canonical).size, 0);
  assert.throws(() => platformDependencies(['import "./platform-missing.js";'], canonical), /Unknown platform module/);
});

test("Every shipped platform copy is required by its mod's imports", async () => {
  const names = (await readdir(new URL(source, root))).filter(platformFile);
  const canonical = new Map(await Promise.all(names.map(async (name) => [name, await readFile(new URL(source + name, root), "utf8")])));
  const folders = (await readdir(new URL("kanso/mods/", root), { withFileTypes: true })).filter((entry) => entry.isDirectory())
    .map((entry) => `kanso/mods/${entry.name}/`).concat(["markdown-panel/mods/markdown-panel/", "open-with/mods/open-with/"]);
  for (const folder of folders.filter((folder) => folder !== source)) {
    const files = await readdir(new URL(folder, root));
    const modules = await Promise.all(files.filter((name) => /\.m?js$/.test(name) && !platformFile(name)).map((name) => readFile(new URL(folder + name, root), "utf8")));
    const needed = [...platformDependencies(modules, canonical)].sort();
    assert.deepEqual(files.filter(platformFile).sort(), needed, folder);
    if (folder.startsWith("kanso/") || folder.startsWith("markdown-panel/")) {
      const listed = SHARED.flatMap(({ copies }) => copies).filter((copy) => copy.startsWith(folder) && platformFile(copy.slice(folder.length))).map((copy) => copy.slice(folder.length)).sort();
      assert.deepEqual(listed, needed, `${folder} sync map`);
    }
  }
});

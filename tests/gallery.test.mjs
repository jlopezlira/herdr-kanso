import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ROOT, STANDALONE, differences } from "../scripts/sync-mods.mjs";
import { SHARED } from "../scripts/sync-share.mjs";

// herdr.dev's indexer skips a whole folder whose RECIPE.md is over 64 KB
// ("RECIPE.md exceeds 64 KB"), so Kanso dropped out of the gallery at 2.1.0.
const RECIPE_LIMIT = 64 * 1024;
// Mods listed on their own that Kanso doesn't install (Kanso has its own
// version of what they do): their shared files are checked below.
const OWN = ["markdown-panel"];
const FOLDERS = ["kanso", ...STANDALONE, ...OWN];
const RECIPES = [
  ...FOLDERS.map((folder) => `${folder}/RECIPE.md`),
  ...readdirSync(join(ROOT, "kanso")).filter((file) => /^RECIPE-.+\.md$/.test(file)).map((file) => `kanso/${file}`),
];

for (const file of RECIPES) {
  test(`${file} fits the gallery's 64 KB`, () => {
    const bytes = statSync(join(ROOT, file)).size;
    assert.ok(bytes <= RECIPE_LIMIT, `${file} is ${bytes} bytes; move a part into its own file`);
  });
}

test("kanso/RECIPE.md leaves room below 60,000 bytes", () => {
  const bytes = statSync(join(ROOT, "kanso/RECIPE.md")).size;
  assert.ok(bytes < 60_000, `kanso/RECIPE.md is ${bytes} bytes; move a part into its own file`);
});

for (const { source, copies } of SHARED) {
  for (const copy of copies) {
    test(`${copy} is the same file as ${source}`, () => {
      assert.equal(readFileSync(join(ROOT, copy), "utf8"), readFileSync(join(ROOT, source), "utf8"), "run npm run sync:share");
    });
  }
}

for (const mod of OWN) {
  test(`${mod} is a folder the gallery lists as a mod`, () => {
    const dir = join(ROOT, mod);
    for (const f of ["RECIPE.md", "preview.png", `mods/${mod}/main.js`, `mods/${mod}/mod.json`]) {
      assert.ok(existsSync(join(dir, f)), `${mod}/${f} is missing`);
    }
    assert.ok(!existsSync(join(dir, "layouts")), "a mod folder has no layouts/");
    assert.ok(!existsSync(join(ROOT, "kanso", "mods", mod)), "Kanso doesn't install it: Herdr would dock a second copy");
  });
}

for (const mod of STANDALONE) {
  test(`${mod} on its own is the same mod Kanso installs`, async () => {
    assert.deepEqual(await differences(mod), [], "run npm run sync:mods");
  });

  test(`${mod} on its own is a folder the gallery lists as a mod`, () => {
    const dir = join(ROOT, mod);
    for (const f of ["RECIPE.md", "preview.png", `mods/${mod}/main.js`, `mods/${mod}/mod.json`]) {
      assert.ok(existsSync(join(dir, f)), `${mod}/${f} is missing`);
    }
    assert.ok(!existsSync(join(dir, "layouts")), "a mod folder has no layouts/");
    assert.match(readFileSync(join(dir, "RECIPE.md"), "utf8"), /!\[[^\]]*\]\(preview\.png\)/);
    if (existsSync(join(dir, "keys.json"))) JSON.parse(readFileSync(join(dir, "keys.json"), "utf8"));
  });
}

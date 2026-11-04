import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ROOT, STANDALONE, differences } from "../scripts/sync-mods.mjs";

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

import assert from "node:assert/strict";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "./helpers.mjs";
import { windows, test, updates, small, tree, stages, recovered, sweep } from "./update-harness.mjs";

test("Killed after any step of the swap, recovery ends at the whole old install or the whole new one, and the next install goes through", { timeout: 170_000 }, async (t) => {
  const s = await small(t);
  assert.equal(s.after["mods/kanso-chrome/version.json"], '{ "version": "1.1.0" }\n');
  assert.equal(s.after["layouts/kanso.json.old-20261108-1200"], '{"root":{"id":"yours"}}\n');
  assert.equal(s.after["themes/kanso-day.json"], '{"theme":"1.1.0"}\n');
  // Forward, slot by slot, each aside and in: keys, layout, picture, theme (8), open-with in (1),
  // kanso-tabs and kanso-chrome (4); then the commit, the layout you had kept, the journal gone.
  const forward = await sweep(s);
  assert.deepEqual(forward.kills, [...Array(13).fill("old"), ...Array(3).fill("new")]);
  assert.deepEqual(forward.end, s.after);
});

test("An undoing killed as its stage was being removed never takes back what it put back", async (t) => {
  const s = await small(t);
  // The sabotaged install, killed once every slot is back (its last step, the journal emptied,
  // before the journal goes); then all the stage holds but its journal is gone, as a removal
  // cut short could leave it: the release's keys.json, your backups.
  const home = await s.fresh("undone");
  assert.equal(await s.run(home, 31, { sabotage: true }), "killed");
  const [stage] = await stages(home);
  const st = join(updates(home), stage);
  assert.equal(await readFile(join(st, "slots"), "utf8"), "", "every slot is out of the journal");
  if (windows) await exec("icacls", [st, "/reset", "/T", "/C", "/Q"]);
  else await exec("chmod", ["-R", "u+w", st]); // the sabotaged kanso-chrome
  await Promise.all(["keys.json", "kanso.json", "old", "src"].map((x) => rm(join(st, x), { recursive: true, force: true })));
  assert.equal(await recovered(s, home, "a removal cut short"), "old");
});

test("A finished install killed as its stage was being removed is not done again: the next install goes through", async (t) => {
  const s = await small(t);
  // Killed after the commit and the layout you had kept; then the stage loses all but its journal
  // and the `committed` mark, as a removal cut short could leave it: the release's themes and
  // picture, its other files, your backups, the stamp.
  const home = await s.fresh("committed");
  assert.equal(await s.run(home, 15), "killed");
  const [stage] = await stages(home);
  const st = join(updates(home), stage);
  await Promise.all(["src", "old", "stamp", "slots.part"].map((x) => rm(join(st, x), { recursive: true, force: true })));
  assert.deepEqual((await readdir(st)).toSorted(), ["committed", "slots"]);
  assert.equal(await recovered(s, home, "a removal cut short"), "new");
});

test("Keys merged from another keys.json than the one in place are not installed: nothing changes", async (t) => {
  const s = await small(t);
  const home = await s.fresh("stale");
  assert.equal(await s.run(home, 0, { base: '{"half":true}\n' }), "failed: your keys.json changed while the update was prepared; try again");
  assert.deepEqual(await tree(home), s.before);
  assert.deepEqual(await stages(home), []);
});

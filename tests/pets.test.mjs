// The dōjō's pets: Codex Pets read from ~/.codex/pets, and installed from codex-pets.net when chosen.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { load, clone, temporary, exec } from "./helpers.mjs";

const NAMES = ["petOf", "parsePets", "catalogOf", "frameOf", "installedPets", "install", "ROWS", "FRAMES", "HACHI"];
const pets = (host = {}) => load("kanso-dojo/pets.js", NAMES, { div: () => null, image: () => null, exec, appHome: () => "/app", home: () => "/home", ...host });
const exists = (p) => stat(p).then(() => true, () => false);

test("a pet.json with only its id takes the Codex Pets atlas: nine rows, their frames, 192 x 208 cells", async () => {
  const { petOf, ROWS } = await pets();
  const p = clone(petOf("codex", "codex.png", { id: "codex" }));
  assert.deepEqual(p.rows, clone(ROWS));
  assert.deepEqual([p.frames.idle, p.frames.waving, p.frames.jumping, p.frames.failed], [6, 4, 5, 8]);
  assert.deepEqual([p.cell, p.columns, p.name, p.sheet], [{ width: 192, height: 208 }, 8, "Codex", "data/kanso-dojo/pets/codex.png"]);
  assert.equal(petOf("null-signal", "n.png", {}).name, "Null Signal", "named from its id when pet.json gives no name");
  assert.equal(petOf("../etc", "x.png"), null, "an id is a folder name, never a path");
  assert.equal(petOf("clawd", "clawd.png", { displayName: "Clawd", frames: { idle: 999 } }).frames.idle, 6, "a frame count past the sheet is not trusted");
});

test("the list script's lines become pets, a broken pet.json keeps its id, a stray file is skipped", async () => {
  const { parsePets } = await pets();
  const list = clone(parsePets("rocky\trocky.png\t{\"displayName\":\"Rocky\"}\nbad\tbad.png\t{not json\nx\t../x.png\t{}\n\n"));
  assert.deepEqual(list.map((p) => [p.id, p.name]), [["bad", "Bad"], ["rocky", "Rocky"]]);
});

test("codex-pets.net's list: only its own posters and downloads are fetched", async () => {
  const { catalogOf } = await pets();
  const site = (id, extra = {}) => ({ id, displayName: id.toUpperCase(), posterUrl: `https://codex-pets.net/assets/pets/v/1/${id}/poster.webp`, downloadUrl: `/api/pets/${id}/download?v=1`, likeCount: 3, ...extra });
  const list = clone(catalogOf(JSON.stringify({ pets: [site("clawd"), site("evil", { posterUrl: "https://elsewhere.example/p.webp" }), site("bad", { downloadUrl: "https://elsewhere.example/x.zip" }), site("../up")] })));
  assert.deepEqual(list, [{ id: "clawd", name: "CLAWD", poster: "https://codex-pets.net/assets/pets/v/1/clawd/poster.webp", download: "https://codex-pets.net/api/pets/clawd/download?v=1", likes: 3 }]);
  assert.deepEqual(clone(catalogOf("<html>")), [], "a page that is not the list gives nothing");
});

test("each reaction is its own row, played at its own pace", async () => {
  const { petOf, frameOf } = await pets();
  const p = petOf("codex", "codex.png", {});
  assert.deepEqual(clone(frameOf(p, "jumping", 0)), { row: 4, col: 0 });
  assert.equal(frameOf(p, "jumping", 140 * 6).col, 1, "jumping has five frames: the sixth step wraps");
  assert.equal(frameOf(p, "unknown", 0).row, 0, "an unknown state is idle");
  const cols = new Set(Array.from({ length: 40 }, (_, i) => frameOf(p, "waving", i * 140).col));
  assert.deepEqual([...cols].sort(), [0, 1, 2, 3], "waving has four frames");
});

test("your installed pets are read from ~/.codex/pets and their atlas is copied where the app draws it", async (t) => {
  const dir = await temporary(t);
  const home = join(dir, "home"), app = join(dir, "app");
  const png = join(dir, "sheet.png");
  // A one-pixel PNG stands in for an atlas.
  await writeFile(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));
  for (const id of ["seedy", "nosheet", ".hidden"]) await mkdir(join(home, ".codex/pets", id), { recursive: true });
  await writeFile(join(home, ".codex/pets/seedy/pet.json"), "{\n\t\"id\": \"seedy\",\n\t\"displayName\": \"Seedy\"\n}\n");
  await writeFile(join(home, ".codex/pets/seedy/spritesheet.png"), await readFile(png));
  await writeFile(join(home, ".codex/pets/nosheet/pet.json"), "{}");
  const { installedPets } = await pets({ home: () => home, appHome: () => app });
  const list = clone(await installedPets());
  assert.deepEqual(list.map((p) => [p.id, p.name, p.sheet]), [["seedy", "Seedy", "data/kanso-dojo/pets/seedy.png"]], "a folder without an atlas is no pet");
  assert.ok(await exists(join(app, "data/kanso-dojo/pets/seedy.png")));
  assert.ok(await exists(join(app, "data/kanso-dojo/pets/thumbs/seedy.png")), "and a small one for the chooser");
});

test("a pet from codex-pets.net goes in ~/.codex/pets/<id> as the site says: only its pet.json and atlas", async (t) => {
  const dir = await temporary(t);
  const home = join(dir, "home"), pack = join(dir, "pack");
  await mkdir(pack, { recursive: true });
  await writeFile(join(pack, "pet.json"), JSON.stringify({ id: "clawd", displayName: "Clawd" }));
  await writeFile(join(pack, "spritesheet.webp"), "webp");
  await writeFile(join(pack, "extra.sh"), "echo nope");
  const zipped = await exec("zip", ["-q", "-j", join(dir, "clawd.zip"), join(pack, "pet.json"), join(pack, "spritesheet.webp"), join(pack, "extra.sh")]);
  assert.equal(zipped.code, 0, zipped.stderr);
  const { install } = await pets({ home: () => home });
  await install({ id: "clawd", name: "Clawd", download: `file://${join(dir, "clawd.zip")}` });
  assert.ok(await exists(join(home, ".codex/pets/clawd/pet.json")));
  assert.ok(await exists(join(home, ".codex/pets/clawd/spritesheet.webp")));
  assert.equal(await exists(join(home, ".codex/pets/clawd/extra.sh")), false, "nothing else from the zip");
  await assert.rejects(install({ id: "../x", name: "x", download: `file://${join(dir, "clawd.zip")}` }), /not a pet id/);
  await assert.rejects(install({ id: "gone", name: "Gone", download: `file://${join(dir, "missing.zip")}` }), /did not answer/);
});

test("the dōjō draws its pet at each reaction, and the chooser with yours and the site's", async () => {
  const { singleUse } = await import("./helpers.mjs");
  const ui = singleUse(), images = [];
  const image = (path) => { images.push(path); return ui.div(); };
  const { petOf } = await pets();
  const { Dojo } = await load("kanso-dojo/main.js", ["Dojo"], {
    ...ui, image, exec, appHome: () => "/app", home: () => "/home", settings: () => ({}),
    theme: () => ({ foreground: "#fff", accent: "#f80", dim: "#666", muted: "#888", border: "#333", ansi1: "#f00" }),
    props: () => ({ overlay: "ov" }), closeOverlay: () => {}, notify: () => {}, window: () => ({ platform: "macos" }),
  });
  const timers = [];
  const cx = { focus_handle: () => ({ focus() {} }), spawn: () => {}, notify() {}, timer: { every: (ms, f) => timers.push(f), after() {} }, stop_propagation() {} };
  const dojo = new Dojo();
  dojo.init({}, cx);
  const rocky = petOf("rocky", "rocky.png", { displayName: "Rocky" });
  dojo.pets = [dojo.pets[0], rocky]; dojo.petId = "rocky";
  assert.equal(dojo.petState(), "idle");
  dojo.render();
  assert.ok(images.includes("data/kanso-dojo/pets/rocky.png"), "the pet's own atlas");
  dojo.hitAt = Date.now();
  assert.equal(dojo.petState(), "jumping", "a target reached");
  dojo.hitAt = 0; dojo.missAt = Date.now();
  assert.equal(dojo.petState(), "failed", "a key that is no move here");
  dojo.missAt = 0; dojo.over = { kept: true, score: 9, hits: 10, perfect: 3, longest: 2, ms: 1000 }; dojo.overAt = Date.now();
  assert.equal(dojo.petState(), "waving", "the round won");
  dojo.overAt = Date.now() - 5000;
  assert.equal(dojo.petState(), "review", "then the result, looked over");
  dojo.render();
  dojo.over = null; dojo.choosing = true;
  dojo.catalog = [{ id: "clawd", name: "Clawd", poster: "", download: "", likes: 1 }, { id: "rocky", name: "Rocky", poster: "", download: "", likes: 1 }];
  images.length = 0;
  dojo.render();
  assert.ok(images.includes("data/kanso-dojo/pets/catalog/clawd.png"), "a pet from the site, by its poster");
  assert.ok(images.includes("data/kanso-dojo/pets/thumbs/rocky.png"), "yours, by the small atlas");
  assert.equal(images.filter((p) => p.includes("catalog/rocky")).length, 0, "one you have shows once, as yours");
  dojo.key({ key: "escape", modifiers: {} }, cx);
  assert.equal(dojo.choosing, false, "Esc closes the chooser, not the dōjō");
  dojo.petId = "hachi"; images.length = 0;
  dojo.render();
  assert.equal(images.length, 0, "Hachi is drawn, no sheet");
});

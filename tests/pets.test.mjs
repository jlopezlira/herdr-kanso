// The dōjō's pets: Codex Pets read from ~/.codex/pets, and installed from codex-pets.net when chosen.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { load, clone, temporary, exec } from "./helpers.mjs";

const NAMES = ["petOf", "parsePets", "frameOf", "installedPets", "bringAgentPets", "AGENT_PETS", "ROWS", "FRAMES", "HACHI", "Companion"];
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

test("the agents' pets: Codex's eight from OpenAI, Claude's Clawd, a cat who codes, Mistral's cat and a shiba, each from its own place", async () => {
  const { AGENT_PETS } = await pets();
  const list = clone(AGENT_PETS);
  assert.deepEqual(list.map((p) => p.id), ["codex", "dewey", "fireball", "rocky", "seedy", "stacky", "bsod", "null-signal", "clawd-crab", "moomew-coder-cat", "le-chaton-fat", "aka-shiba"]);
  assert.ok(list.filter((p) => p.from === "Codex").every((p) => p.url.startsWith("https://persistent.oaistatic.com/codex/pets/v1/") && !p.zip));
  assert.ok(list.filter((p) => p.zip).every((p) => p.url.startsWith("https://codex-pets.net/api/pets/")));
});

test("each reaction is its own row, played at its own pace", async () => {
  const { petOf, frameOf } = await pets();
  const p = petOf("codex", "codex.png", {});
  assert.deepEqual(clone(frameOf(p, "jumping", 5000, 5000)), { row: 4, col: 0 }, "a reaction starts at its first frame");
  assert.equal(frameOf(p, "jumping", 5000 + 140 * 6, 5000).col, 1, "jumping has five frames: the sixth step wraps");
  assert.equal(frameOf(p, "unknown", 0).row, 0, "an unknown state is idle");
  const still = Array.from({ length: 70 }, (_, i) => frameOf(p, "idle", i * 100).col);
  assert.ok(still.filter((c) => c === 0).length > 55, "at rest it holds still, and only now and then breathes");
  assert.ok(still.some((c) => c > 0), "but it is alive");
  const cols = new Set(Array.from({ length: 40 }, (_, i) => frameOf(p, "waving", i * 140, 0).col));
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

test("the agents' pets are brought into Kanso's folder, never Codex's; one missing is told, one there is not fetched again", async (t) => {
  const dir = await temporary(t);
  const home = join(dir, "home"), app = join(dir, "app"), pack = join(dir, "pack");
  await mkdir(pack, { recursive: true });
  await writeFile(join(pack, "pet.json"), JSON.stringify({ id: "clawd", displayName: "Clawd by someone" }));
  await writeFile(join(pack, "spritesheet.webp"), "webp");
  await writeFile(join(pack, "extra.sh"), "echo nope");
  const zipped = await exec("zip", ["-q", "-j", join(dir, "clawd.zip"), join(pack, "pet.json"), join(pack, "spritesheet.webp"), join(pack, "extra.sh")]);
  assert.equal(zipped.code, 0, zipped.stderr);
  await writeFile(join(dir, "rocky.webp"), "webp");
  const { bringAgentPets } = await pets({ home: () => home, appHome: () => app });
  const list = [
    { id: "rocky", name: "Rocky", from: "Codex", url: `file://${join(dir, "rocky.webp")}` },
    { id: "clawd", name: "Clawd", from: "Claude Code", url: `file://${join(dir, "clawd.zip")}`, zip: true },
    { id: "gone", name: "Gone", from: "Codex", url: `file://${join(dir, "missing.webp")}` },
    { id: "seedy", name: "Seedy", from: "Codex", url: `file://${join(dir, "missing.webp")}` },
  ];
  const missed = clone(await bringAgentPets(new Set(["seedy"]), list));
  assert.deepEqual(missed, ["gone"], "one that could not be had is told; one you have is not asked for");
  const at = join(app, "data/kanso-dojo/pets/agents");
  assert.deepEqual(JSON.parse(await readFile(join(at, "rocky/pet.json"), "utf8")), { id: "rocky", displayName: "Rocky" });
  assert.ok(await exists(join(at, "clawd/spritesheet.webp")));
  assert.equal(await exists(join(at, "clawd/extra.sh")), false, "only its pet.json and atlas from the zip");
  assert.equal(await exists(join(home, ".codex/pets")), false, "Codex's folder is left alone");
  await writeFile(join(dir, "rocky.webp"), "changed");
  await bringAgentPets(new Set(), list.slice(0, 1));
  assert.equal(await readFile(join(at, "rocky/spritesheet.webp"), "utf8"), "webp", "brought once");
});

test("the dōjō draws its pet at each reaction, and the chooser with every pet", async () => {
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
  dojo.pal.pets = [dojo.pal.pets[0], rocky]; dojo.pal.id = "rocky";
  assert.equal(dojo.petState(), "idle", "still until the game gives it something");
  dojo.render();
  assert.ok(images.includes("data/kanso-dojo/pets/rocky.png"), "the pet's own atlas");
  dojo.round = { at: Date.now(), score: 0, hits: 0, perfect: 0, streak: 0, longest: 0 }; dojo.moves = 0; dojo.need = 9;
  dojo.idleAt = Date.now();
  assert.equal(dojo.petState(), "idle", "moving about is no reason to jump");
  dojo.hitAt = Date.now(); dojo.cheer = false;
  assert.equal(dojo.petState(), "jumping", "a target in the fewest moves");
  dojo.cheer = true;
  assert.equal(dojo.petState(), "waving", "a streak");
  dojo.hitAt = Date.now() - 5000;
  assert.equal(dojo.petState(), "idle", "and still again");
  dojo.missAt = Date.now();
  assert.equal(dojo.petState(), "failed", "a key that is no move here");
  dojo.missAt = null; dojo.round = null; dojo.record = true;
  dojo.over = { kept: true, score: 9, hits: 10, perfect: 3, longest: 2, ms: 1000 }; dojo.overAt = Date.now();
  assert.equal(dojo.petState(), "jumping", "a new best");
  dojo.record = false;
  assert.equal(dojo.petState(), "waving", "a round won");
  dojo.overAt = Date.now() - 5000;
  assert.equal(dojo.petState(), "idle", "the result read, it rests");
  dojo.render();
  dojo.over = null; dojo.choosing = true;
  images.length = 0;
  dojo.render();
  assert.ok(images.includes("data/kanso-dojo/pets/thumbs/rocky.png"), "each pet in the chooser by its small atlas");
  assert.equal(images.filter((p) => p === "data/kanso-dojo/pets/rocky.png").length, 1, "the whole atlas only for the one in the dōjō");
  dojo.key({ key: "escape", modifiers: {} }, cx);
  assert.equal(dojo.choosing, false, "Esc closes the chooser, not the dōjō");
  dojo.pal.id = "hachi"; images.length = 0;
  dojo.render();
  assert.equal(images.length, 0, "Hachi is drawn, no sheet");
});

test("kansō help's dōjō page shows your pet, and every pet to choose from there", async () => {
  const { singleUse } = await import("./helpers.mjs");
  const ui = singleUse(), images = [];
  const image = (path) => { images.push(path); return ui.div(); };
  const { petOf } = await pets();
  const { Help } = await load("kanso-help/main.js", ["Help"], {
    ...ui, image, exec, appHome: () => "/app", home: () => "/home", keys: () => ({}), run: () => {}, openOverlay: () => {},
    theme: () => ({ foreground: "#fff", accent: "#f80", dim: "#666", muted: "#888", border: "#333" }),
    props: () => ({ overlay: "ov", page: "dojo" }), closeOverlay: () => {},
  });
  const spawned = [];
  const cx = { focus_handle: () => ({ focus() {} }), spawn: (f) => spawned.push(f), notify() {}, timer: { every() {}, after() {} } };
  const help = new Help();
  help.init({}, cx);
  assert.equal(spawned.length, 2, "your choice read, and the agents' pets brought: the page opened on the dōjō");
  help.pal.pets = [help.pal.pets[0], petOf("clawd", "clawd.png", { displayName: "Clawd" })];
  help.pal.id = "clawd";
  help.render();
  assert.ok(images.includes("data/kanso-dojo/pets/clawd.png"), "your pet, drawn");
  assert.ok(images.includes("data/kanso-dojo/pets/thumbs/clawd.png"), "and in the grid to choose from");
});

test("a share card carries your pet: Hachi in its squares, a pet's first frame cut from its atlas copied beside the card", async (t) => {
  const dir = await temporary(t);
  const { Companion, petOf, HACHI } = await pets({ appHome: () => dir });
  const pal = new Companion({ pet: async () => null, setPet: async () => {} });
  const hachi = await pal.figure({ accent: "#e8728a", chrome: "#161615" }, join(dir, "share"), 160);
  assert.equal(hachi.width, 160);
  assert.ok(hachi.svg.includes('fill="#e8963a"') && !hachi.svg.includes("image"), "Hachi is drawn, square by square");
  await mkdir(join(dir, "data/kanso-dojo/pets"), { recursive: true });
  await writeFile(join(dir, "data/kanso-dojo/pets/rocky.png"), "png");
  pal.pets = [HACHI, petOf("rocky", "rocky.png", {})]; pal.id = "rocky";
  const rocky = await pal.figure({}, join(dir, "share"), 192);
  assert.equal(rocky.height, 208, "a cell's own proportions");
  assert.match(rocky.svg, /viewBox="0 0 192 208".*href="pet.png" width="1536" height="1872"/, "the first cell of the whole atlas, beside the card");
  assert.equal(await readFile(join(dir, "share/pet.png"), "utf8"), "png", "the atlas copied, never read into the card: a few MiB would pass the 1 MiB a mod may write");
});

import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
import { petApi } from "./platform-pets.js";
// The dōjō's pets, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Pets in the Codex Pets format (https://codex-pets.net): a pet.json and an atlas of
// 8 columns by 9 rows of 192 x 208 cells, a row per state. Kanso ships none: it reads the ones
// you have in ~/.codex/pets, and brings the agents' own (from OpenAI and codex-pets.net) into its
// folder the first time you open the chooser, for you only, never into Codex's.
// Kept byte for byte in kanso-help/ (`npm run sync:share`): edit kanso-dojo/pets.js.
import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, home } from "herdr";
import { parseOr } from "./pure.js";
import { G, H, T, W } from "./ui.js";
import { button } from "./kit.js";
import { hachi, hachiInk } from "./mascot.js";
import { hachiPixels } from "./mascot-pixels.js";
import { Store } from "./store.js";

export const SITE = "https://codex-pets.net";
export const ROWS = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"];
export const FRAMES = { idle: 6, "running-right": 8, "running-left": 8, waving: 4, jumping: 5, failed: 8, waiting: 6, running: 6, review: 6 };
const CELL = { width: 192, height: 208 }, COLUMNS = 8;
// A reaction plays from its first frame at this pace; at rest a pet holds still and only now and
// then plays its row once (a blink, a breath): `every` ms, at `ms` a frame.
const REACT_MS = 140;
const REST = { idle: { every: 7000, ms: 180 }, waiting: { every: 3200, ms: 260 } };
export const TICK_MS = 120;
export const HACHI = { id: "hachi", name: "Hachi" };
const DIR = "data/kanso-dojo/pets";
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const petsHome = () => paths.join(home(), ".codex", "pets");
const OPENAI = "https://persistent.oaistatic.com/codex/pets/v1";

// The agents' pets: Codex's eight from OpenAI, Claude's Clawd, a cat who codes, Mistral's cat, and a shiba like Hachi.
// `from`: who made it; `zip`: a codex-pets.net package, else an OpenAI atlas.
export const AGENT_PETS = [
  ...[["codex", "Codex", "5cd7af9cfeae88fe9c6e47a72460e0dc4c6fb04baf7fdc6cca14a212f0bf44d1"],
    ["dewey", "Dewey", "a53372a73467c5583fe512ed18443d1a8107cfb43060e4398ba1b7c679358ed0"],
    ["fireball", "Fireball", "2c257615a71374da82c802c78856e8a80ce336cfbeb1077b26051a5f6a7e49df"],
    ["rocky", "Rocky", "524f3e6ac6508c60cf9d898940ea5f271ca66ca6b9bca66a73ac2b32296290fb"],
    ["seedy", "Seedy", "4989cc19272ed944261bb4e29bfff842bbbb50aa9da1df9215cfbf47cb83f3ed"],
    ["stacky", "Stacky", "f532c6701fb5f21d94be898e349f44fb218f1521d3747da1281f7b80fd3c35d1"],
    ["bsod", "BSOD", "0daf44c643c289772c01df97c5aa1383a4e2b05f4e50cf5e899c005a3876fbad"],
    ["null-signal", "Null Signal", "6fe899a334f906ce863bf986e5fcf629615bc7513697bba5b075f69564bf5508"]]
    .map(([id, name, sheet]) => ({ id, name, from: "Codex", url: `${OPENAI}/${id}-spritesheet-v4.webp`, sheet })),
  ...[["clawd-crab", "Clawd", "Claude Code", "f6ca8e6ad933c8dfe6479d01262b94ad016a3e30bde4d6cfb7d6a0aa21bc92e0", "8152732d5476688b0fe6e0024a1e7fce6c3babe58ccd2d8401c38eab5314c9f0"],
    ["moomew-coder-cat", "MooMew", "a cat who codes", "0a09c6a33e9d8d45f562d942f4358710d6f9ee9ef27ba0e9f294f90ae1c8f8ca", "4b88abfae7469214cde9a72c88cd68ee1a648578c969c924aa3bb85de38c8816"],
    ["le-chaton-fat", "Le Chaton", "Mistral", "a6dcc8f01840a0610f512a05bd2f1dfc3e01050fa1631d879941421b4996ef85", "8ab04a4fbe2028b4de1c980c1ac4f9e46fedab295c73e72d74fd367c14c0ee28"],
    ["aka-shiba", "July", "a shiba, like Hachi", "747c5f0b9346eef68aad26ec20c989d32bb1ce3dd307de2e4012987433ff3e24", "62ffe5a170aed112ef076da591eaa71c8d7ed9b10daf47e3c54edadb3a964128"]]
    .map(([id, name, from, sheet, json]) => ({ id, name, from, url: `${SITE}/api/pets/${id}/download`, zip: true, sheet, json })),
];
// Pets Kanso brought once and replaced by a better one: gone from its folder, and a choice of one moves to its successor.
export const RETIRED = { clawd: "clawd-crab" };

const count = (n, fallback) => (Number.isInteger(n) && n > 0 && n <= 64 ? n : fallback);

// A pet.json as found on disk; `file`: its atlas, in Kanso's folder (the app draws images from there only).
export function petOf(id, file, manifest = {}) {
  if (!ID.test(id ?? "")) return null;
  const m = manifest && typeof manifest === "object" ? manifest : {};
  const rows = Array.isArray(m.rows) && m.rows.length && m.rows.every((r) => typeof r === "string") ? m.rows : ROWS;
  const frames = Object.fromEntries(rows.map((r) => [r, count(m.frames?.[r], FRAMES[r] ?? 1)]));
  const cell = { width: count(m.cell?.width, CELL.width), height: count(m.cell?.height, CELL.height) };
  // Codex's own pets name only their id: "null-signal" reads Null Signal.
  const name = typeof m.displayName === "string" && m.displayName.trim() ? m.displayName.trim()
    : id.split(/[-_.]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  // `thumb`: the same atlas, smaller, for the chooser (a whole atlas each would weigh 11 MB drawn).
  return { id, name, sheet: `${DIR}/${file}`, thumb: `${DIR}/thumbs/${file}`, rows, frames, cell, columns: count(m.columns, COLUMNS) };
}

// The list script's lines: id, atlas file and pet.json, tab-separated.
export function parsePets(stdout) {
  return String(stdout ?? "").split("\n").map((line) => {
    const [id, file, json] = line.split("\t");
    if (!id || !file || !/^[A-Za-z0-9._-]+\.(png|webp)$/.test(file)) return null;
    return petOf(id, file, parseOr(json || "{}", {}));
  }).filter(Boolean).toSorted((a, b) => a.name.localeCompare(b.name));
}

// The row and column a state shows at `now`; an unknown state shows idle.
// `since`: when a reaction began, so it plays from its first frame.
export function frameOf(pet, state, now = Date.now(), since = 0) {
  const name = pet.rows.includes(state) ? state : "idle";
  const row = Math.max(0, pet.rows.indexOf(name));
  const n = Math.min(pet.columns, pet.frames[name] ?? 1);
  const rest = REST[name];
  if (rest) { const at = Math.floor((now % rest.every) / rest.ms); return { row, col: at < n ? at : 0 }; }
  return { row, col: Math.floor(Math.max(0, now - since) / REACT_MS) % n };
}

// One cell of the atlas: the whole sheet, moved under a window the size of a cell.
export function petFrame(pet, state, { scale = 0.6, now = Date.now(), since = 0, still = false, small = false } = {}) {
  const w = Math.round(pet.cell.width * scale), h = Math.round(pet.cell.height * scale);
  const { row, col } = still ? { row: 0, col: 0 } : frameOf(pet, state, now, since);
  return div().relative().w(w).h(h).flex_none().overflow_hidden()
    .child(image(small ? pet.thumb : pet.sheet).absolute().left(-col * w).top(-row * h).w(w * pet.columns).h(h * pet.rows.length));
}

// Each installed pet's atlas, as a PNG in Kanso's folder (a WebP copied as it is where there is no sips).
// Yours in ~/.codex/pets first; one Kanso brought with the same id is not listed twice.
const failed = (r, what) => new Error((r.stderr || what).trim().split("\n")[0]);
const brought = () => paths.join(appHome(), DIR, "agents");

export async function installedPets() {
  const r = await localService(petApi).list(paths.join(appHome(), DIR), [petsHome(), brought()]);
  if (r.code !== 0) throw failed(r, "Your pets could not be read.");
  // The agents' pets go by their agent's name for them, and say whose they are.
  // In the agents' order, then yours by name.
  const at = (p) => { const i = AGENT_PETS.findIndex((x) => x.id === p.id); return i < 0 ? AGENT_PETS.length : i; };
  return parsePets(r.stdout).map((p) => {
    const a = AGENT_PETS.find((x) => x.id === p.id);
    return a ? { ...p, name: a.name, from: a.from } : p;
  }).toSorted((a, b) => at(a) - at(b));
}

// Brings the agents' pets you do not have yet; the ids that could not be had, if any.
export async function bringAgentPets(have = new Set(), list = AGENT_PETS) {
  await localService(fileApi).remove(Object.keys(RETIRED).map((id) => paths.join(brought(), id)), { recursive: true });
  const want = list.filter((p) => !have.has(p.id));
  if (!want.length) return [];
  const r = await localService(petApi).bring(brought(), want);
  return String(r.stderr ?? "").split("\n").map((x) => x.trim()).filter((x) => want.some((p) => p.id === x));
}

// Your pet, wherever it shows (the dōjō, and kansō help's way into it): which it is, the ones to choose from,
// and the agents' pets brought the first time you look at them. The choice is kept in the dōjō's own SQLite.
export class Companion {
  constructor(timer, store = new Store(timer)) {
    this.store = store;
    this.pets = [HACHI]; this.id = HACHI.id;
    this.bringing = false; this.brought = false; this.error = null; this.frameKey = null;
  }

  // A retired pet you chose shows as its successor.
  get pet() { return this.pets.find((p) => p.id === this.id) ?? this.pets.find((p) => p.id === RETIRED[this.id]) ?? HACHI; }

  load(cx) {
    cx.spawn(async (cx) => {
      const [mine, chosen] = await Promise.all([installedPets().catch(() => []), this.store.pet().catch(() => null)]);
      this.pets = [HACHI, ...mine];
      // Codex's own pet, when you have it, until you choose another.
      this.id = chosen ?? (mine.some((p) => p.id === "codex") ? "codex" : HACHI.id);
      cx.notify();
    });
  }

  // Once per window: yours read again (one Codex installed meanwhile shows too), then the agents' you lack.
  bring(cx) {
    if (this.bringing || this.brought) return;
    this.bringing = true; this.error = null;
    cx.spawn(async (cx) => {
      try {
        this.pets = [HACHI, ...await installedPets()];
        cx.notify();
        const missed = await bringAgentPets(new Set(this.pets.map((p) => p.id)));
        this.pets = [HACHI, ...await installedPets()];
        this.brought = !missed.length;
        if (missed.length) this.error = `${missed.map((id) => AGENT_PETS.find((p) => p.id === id)?.name ?? id).join(", ")} could not be brought.`;
      } catch (e) { this.error = String(e?.message ?? e); }
      this.bringing = false;
      cx.notify();
    });
  }

  choose(id) {
    this.id = id; this.frameKey = null;
    this.store.setPet(id).catch(() => {});
  }

  // True when the pet's frame for `state` changed since the last call: the one redraw a timer needs.
  moved(state, since = 0) {
    const p = this.pet;
    if (!p.sheet) return false;
    const f = frameOf(p, state, Date.now(), since), key = `${f.row}:${f.col}`;
    if (key === this.frameKey) return false;
    this.frameKey = key;
    return true;
  }

  // `mood`: Hachi's face, which has no sheet of reactions.
  face(t, state, { now = Date.now(), since = 0, scale = 0.6, mood = "calm", px = 8 } = {}) {
    const p = this.pet;
    return p.sheet ? petFrame(p, state, { now, since, scale }) : hachi(t, { mood, px });
  }

  // The pet for a share card made in `dir`: SVG of `width` that a card places as it is. Hachi in its own squares;
  // a pet's first frame, cut from its whole atlas copied beside the card. Embedded, an atlas of a few MiB
  // passes the 1 MiB a mod may write; beside it, the card stays small and the frame stays sharp.
  async figure(t, dir, width = 200) {
    const p = this.pet;
    if (!p.sheet) {
      const rows = hachiPixels("glad"), ink = hachiInk(t), px = width / rows[0].length;
      const squares = rows.flatMap((row, y) => row.map((v, x) => (v === "." ? "" : `<rect x="${x * px}" y="${y * px}" width="${px}" height="${px}" fill="${ink[v] ?? t.accent}"/>`)));
      return { width, height: rows.length * px, svg: squares.join("") };
    }
    const file = `pet.${p.sheet.split(".").at(-1)}`;
    const r = await localService(fileApi).mkdir(dir).then(() => localService(fileApi).copy(paths.join(appHome(), p.sheet), paths.join(dir, file)));
    if (r.code !== 0) return null;
    const { width: cw, height: ch } = p.cell, height = Math.round((width * ch) / cw);
    return { width, height, svg: `<svg width="${width}" height="${height}" viewBox="0 0 ${cw} ${ch}"><image href="${file}" width="${cw * p.columns}" height="${ch * p.rows.length}"/></svg>` };
  }

  // Every pet at rest, a click and it is yours. `onChoose` after the choice.
  grid(t, c, onChoose = () => {}) {
    const tile = (p) => {
      const on = p.id === this.id;
      const face = v_flex().w(W.petTile).gap(G.xs).p(G.sm).items_center()
        .child(h_flex().h(H.petPicture).items_end().justify_center()
          .child(p.sheet ? petFrame(p, "idle", { scale: 0.4, still: true, small: true }) : hachi(t, { mood: "calm", px: 5 })))
        .child(div().w_full().text_center().truncate().text_size(T.body).font_medium().text_color(on ? c.text : c.muted).child(p.name))
        .child(div().w_full().text_center().truncate().text_size(T.body).text_color(c.dim).child(p.from ?? (p.sheet ? "yours" : "Kanso")));
      // The kit's button with the pet as its face: Tab reaches it, Enter and Space choose it, the chosen one is filled.
      return button({ label: p.name, kind: "quiet", active: on, content: [face] })(`pet-${p.id}`, c, { onClick: (cx) => { this.choose(p.id); onChoose(p, cx); cx.notify(); } });
    };
    const coming = this.bringing ? AGENT_PETS.filter((a) => !this.pets.some((p) => p.id === a.id)).length : 0;
    const note = this.error ?? (coming ? `Bringing ${coming} more\u2026` : null);
    return v_flex().gap(G.md)
      .child(h_flex().flex_wrap().gap(8).children(this.pets.map(tile)))
      .when(Boolean(note), (el) => el.child(v_flex().items_start().gap(G.xs)
        .child(div().w_full().text_size(T.body).text_color(this.error ? c.red ?? c.accent : c.dim).child(note))
        .when(Boolean(this.error), (line) => line.child(button({ label: "Retry", kind: "quiet", small: true })("pets-retry", c, { onClick: (cx) => this.bring(cx) })))));
  }
}

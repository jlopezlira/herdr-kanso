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
import { hachi, hachiPixels, hachiInk } from "./mascot.js";
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
  ...[["codex", "Codex"], ["dewey", "Dewey"], ["fireball", "Fireball"], ["rocky", "Rocky"], ["seedy", "Seedy"],
    ["stacky", "Stacky"], ["bsod", "BSOD"], ["null-signal", "Null Signal"]]
    .map(([id, name]) => ({ id, name, from: "Codex", url: `${OPENAI}/${id}-spritesheet-v4.webp` })),
  { id: "clawd-crab", name: "Clawd", from: "Claude Code", url: `${SITE}/api/pets/clawd-crab/download`, zip: true },
  { id: "moomew-coder-cat", name: "MooMew", from: "a cat who codes", url: `${SITE}/api/pets/moomew-coder-cat/download`, zip: true },
  { id: "le-chaton-fat", name: "Le Chaton", from: "Mistral", url: `${SITE}/api/pets/le-chaton-fat/download`, zip: true },
  { id: "aka-shiba", name: "July", from: "a shiba, like Hachi", url: `${SITE}/api/pets/aka-shiba/download`, zip: true },
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
        if (missed.length) this.error = `${missed.map((id) => AGENT_PETS.find((p) => p.id === id)?.name ?? id).join(", ")} could not be brought. Open this again to retry.`;
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
      return v_flex().id(`pet-${p.id}`).w(104).gap(4).p(8).items_center().rounded(10).cursor_pointer()
        .border_1().border_color(on ? c.accent : c.text + "00").bg(on ? c.accent + "1c" : c.text + "00")
        .hover((s) => s.bg(c.text + "0a"))
        .on_click((_e, cx) => { this.choose(p.id); onChoose(p, cx); cx.notify(); })
        .child(h_flex().h(84).items_end().justify_center()
          .child(p.sheet ? petFrame(p, "idle", { scale: 0.4, still: true, small: true }) : hachi(t, { mood: "calm", px: 5 })))
        .child(div().w_full().text_center().truncate().text_size(12).font_medium().text_color(on ? c.text : c.muted).child(p.name))
        .child(div().w_full().text_center().truncate().text_size(10.5).text_color(c.dim).child(p.from ?? (p.sheet ? "yours" : "Kanso")));
    };
    const coming = this.bringing ? AGENT_PETS.filter((a) => !this.pets.some((p) => p.id === a.id)).length : 0;
    const note = this.error ?? (coming ? `Bringing ${coming} more\u2026` : null);
    return v_flex().gap(G_NOTE)
      .child(h_flex().flex_wrap().gap(8).children(this.pets.map(tile)))
      .when(Boolean(note), (el) => el.child(div().text_size(12).text_color(this.error ? c.red ?? c.accent : c.dim).child(note)));
  }
}
const G_NOTE = 12;

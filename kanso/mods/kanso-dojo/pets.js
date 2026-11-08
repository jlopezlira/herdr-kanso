// The dōjō's pets, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Pets in the Codex Pets format (https://codex-pets.net): a pet.json and an atlas of
// 8 columns by 9 rows of 192 x 208 cells, a row per state. Kanso ships none: it reads the ones
// you have in ~/.codex/pets, and brings the agents' own (from OpenAI and codex-pets.net) into its
// folder the first time you open the chooser, for you only, never into Codex's.
import { div, image } from "gpui-kit";
import { exec, appHome, home } from "herdr";
import { parseOr } from "./pure.js";

export const SITE = "https://codex-pets.net";
export const ROWS = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"];
export const FRAMES = { idle: 6, "running-right": 8, "running-left": 8, waving: 4, jumping: 5, failed: 8, waiting: 6, running: 6, review: 6 };
const CELL = { width: 192, height: 208 }, COLUMNS = 8;
// Idle and waiting breathe slower than the rest.
const FRAME_MS = { idle: 220, waiting: 260 };
export const TICK_MS = 120;
export const HACHI = { id: "hachi", name: "Hachi" };
const DIR = "data/kanso-dojo/pets";
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const petsHome = () => `${home()}/.codex/pets`;
const OPENAI = "https://persistent.oaistatic.com/codex/pets/v1";

// The agents' pets: Codex's eight from OpenAI, Claude's Clawd, Mistral's cat, and a shiba like Hachi.
// `from`: who made it; `zip`: a codex-pets.net package, else an OpenAI atlas.
export const AGENT_PETS = [
  ...[["codex", "Codex"], ["dewey", "Dewey"], ["fireball", "Fireball"], ["rocky", "Rocky"], ["seedy", "Seedy"],
    ["stacky", "Stacky"], ["bsod", "BSOD"], ["null-signal", "Null Signal"]]
    .map(([id, name]) => ({ id, name, from: "Codex", url: `${OPENAI}/${id}-spritesheet-v4.webp` })),
  { id: "clawd", name: "Clawd", from: "Claude Code", url: `${SITE}/api/pets/clawd/download`, zip: true },
  { id: "le-chaton-fat", name: "Le Chaton", from: "Mistral", url: `${SITE}/api/pets/le-chaton-fat/download`, zip: true },
  { id: "aka-shiba", name: "July", from: "a shiba, like Hachi", url: `${SITE}/api/pets/aka-shiba/download`, zip: true },
];

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
export function frameOf(pet, state, now = Date.now()) {
  const row = Math.max(0, pet.rows.indexOf(pet.rows.includes(state) ? state : "idle"));
  const n = Math.min(pet.columns, pet.frames[pet.rows[row]] ?? 1);
  return { row, col: Math.floor(now / (FRAME_MS[pet.rows[row]] ?? 140)) % n };
}

// One cell of the atlas: the whole sheet, moved under a window the size of a cell.
export function petFrame(pet, state, { scale = 0.6, now = Date.now(), still = false, small = false } = {}) {
  const w = Math.round(pet.cell.width * scale), h = Math.round(pet.cell.height * scale);
  const { row, col } = still ? { row: 0, col: 0 } : frameOf(pet, state, now);
  return div().relative().w(w).h(h).flex_none().overflow_hidden()
    .child(image(small ? pet.thumb : pet.sheet).absolute().left(-col * w).top(-row * h).w(w * pet.columns).h(h * pet.rows.length));
}

// Each installed pet's atlas, as a PNG in Kanso's folder (a WebP copied as it is where there is no sips).
// Yours in ~/.codex/pets first; one Kanso brought with the same id is not listed twice.
const LIST = `out="$1"; shift; mkdir -p "$out" || exit 1; seen=" "
for d in "$@"; do [ -d "$d" ] && printf '%s\\n' "$d"/*/; done | while IFS= read -r d; do
  [ -d "$d" ] || continue
  id=$(basename "$d")
  case "$id" in .*|*[!A-Za-z0-9._-]*) continue;; esac
  case "$seen" in *" $id "*) continue;; esac
  j="$d/pet.json"; [ -f "$j" ] || continue
  s="$d/spritesheet.webp"; [ -f "$s" ] || s="$d/spritesheet.png"; [ -f "$s" ] || continue
  f="$id.png"
  if [ ! -s "$out/$f" ] || [ "$s" -nt "$out/$f" ]; then
    if command -v sips >/dev/null 2>&1 && sips -s format png "$s" --out "$out/.$f" >/dev/null 2>&1; then
      mkdir -p "$out/thumbs" && sips -Z 749 "$out/.$f" --out "$out/thumbs/$f" >/dev/null 2>&1 || cp -f "$out/.$f" "$out/thumbs/$f"
      mv -f "$out/.$f" "$out/$f"
    else f="$id.\${s##*.}"; mkdir -p "$out/thumbs" && cp -f "$s" "$out/$f" && cp -f "$s" "$out/thumbs/$f" || continue; fi
  fi
  seen="$seen$id "
  printf '%s\\t%s\\t' "$id" "$f"; head -c 4096 "$j" | tr '\\n\\r\\t' '   '; echo
done`;

// The agents' pets not here yet, brought into Kanso's folder: id, name, URL and kind (zip or webp) each.
// A codex-pets.net zip is unpacked aside and only its pet.json and atlas kept.
const BRING = `src="$1"; shift; mkdir -p "$src" || exit 1
tmp=$(mktemp -d) || exit 1; trap 'rm -rf "$tmp"' EXIT
while [ $# -ge 4 ]; do
  id="$1"; name="$2"; url="$3"; kind="$4"; shift 4
  case "$id" in ""|.*|*[!A-Za-z0-9._-]*) continue;; esac
  [ -f "$src/$id/pet.json" ] && continue
  rm -rf "$tmp/x" "$tmp/p"; mkdir -p "$tmp/x"
  if [ "$kind" = zip ]; then
    curl -fsSL --max-time 90 "$url" -o "$tmp/p" 2>/dev/null && unzip -qq "$tmp/p" -d "$tmp/x" 2>/dev/null || { echo "$id" >&2; continue; }
    j=$(find "$tmp/x" -maxdepth 2 -type f -name pet.json | head -n 1); [ -n "$j" ] || { echo "$id" >&2; continue; }
    d=$(dirname "$j"); s="$d/spritesheet.webp"; [ -f "$s" ] || s="$d/spritesheet.png"; [ -f "$s" ] || { echo "$id" >&2; continue; }
    mkdir -p "$src/$id" && cp -f "$s" "$src/$id/" && cp -f "$j" "$src/$id/pet.json"
  else
    curl -fsSL --max-time 90 "$url" -o "$tmp/x/spritesheet.webp" 2>/dev/null || { echo "$id" >&2; continue; }
    mkdir -p "$src/$id" && mv -f "$tmp/x/spritesheet.webp" "$src/$id/" && printf '{"id":"%s","displayName":"%s"}\\n' "$id" "$name" > "$src/$id/pet.json"
  fi
done`;

const failed = (r, what) => new Error((r.stderr || what).trim().split("\n")[0]);
const brought = () => `${appHome()}/${DIR}/agents`;

export async function installedPets() {
  const r = await exec("sh", ["-c", LIST, "sh", `${appHome()}/${DIR}`, petsHome(), brought()]);
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
  const want = list.filter((p) => !have.has(p.id));
  if (!want.length) return [];
  const r = await exec("sh", ["-c", BRING, "sh", brought(), ...want.flatMap((p) => [p.id, p.name, p.url, p.zip ? "zip" : "webp"])]);
  return String(r.stderr ?? "").split("\n").map((x) => x.trim()).filter((x) => want.some((p) => p.id === x));
}

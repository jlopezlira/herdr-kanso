// The dōjō's pets, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Pets in the Codex Pets format (https://codex-pets.net): a pet.json and an atlas of
// 8 columns by 9 rows of 192 x 208 cells, a row per state. Kanso ships none: it reads
// the ones installed in ~/.codex/pets, and installs one from codex-pets.net when you pick it,
// the way the site says to (its zip unpacked in ~/.codex/pets/<id>).
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
  const thumb = file.endsWith(".png") ? `${DIR}/thumbs/${file}` : `${DIR}/${file}`;
  return { id, name, sheet: `${DIR}/${file}`, thumb, rows, frames, cell, columns: count(m.columns, COLUMNS) };
}

// The list script's lines: id, atlas file and pet.json, tab-separated.
export function parsePets(stdout) {
  return String(stdout ?? "").split("\n").map((line) => {
    const [id, file, json] = line.split("\t");
    if (!id || !file || !/^[A-Za-z0-9._-]+\.(png|webp)$/.test(file)) return null;
    return petOf(id, file, parseOr(json || "{}", {}));
  }).filter(Boolean).toSorted((a, b) => a.name.localeCompare(b.name));
}

// codex-pets.net's list, only what is safe to fetch from it.
export function catalogOf(body) {
  const d = typeof body === "string" ? parseOr(body, null) : body;
  return (Array.isArray(d?.pets) ? d.pets : []).map((p) => {
    const id = String(p?.id ?? ""), poster = String(p?.posterUrl ?? ""), download = String(p?.downloadUrl ?? "");
    if (!ID.test(id) || !poster.startsWith(`${SITE}/`) || !download.startsWith("/api/pets/")) return null;
    const name = typeof p.displayName === "string" && p.displayName.trim() ? p.displayName.trim() : id;
    return { id, name, poster, download: `${SITE}${download}`, likes: Number(p.likeCount) || 0 };
  }).filter(Boolean);
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

// A poster from the site, once fetched: one cell, the pet at rest.
export const posterImage = (id, size) => image(`${DIR}/catalog/${id}.png`).w(size).h(Math.round(size * CELL.height / CELL.width)).flex_none();

// Each installed pet's atlas, as a PNG in Kanso's folder (a WebP copied as it is where there is no sips).
const LIST = `out="$1"; src="$2"; mkdir -p "$out" || exit 1
for d in "$src"/*/; do
  [ -d "$d" ] || continue
  id=$(basename "$d")
  case "$id" in .*|*[!A-Za-z0-9._-]*) continue;; esac
  j="$d/pet.json"; [ -f "$j" ] || continue
  s="$d/spritesheet.webp"; [ -f "$s" ] || s="$d/spritesheet.png"; [ -f "$s" ] || continue
  f="$id.png"
  if [ ! -s "$out/$f" ] || [ "$s" -nt "$out/$f" ]; then
    if command -v sips >/dev/null 2>&1 && sips -s format png "$s" --out "$out/.$f" >/dev/null 2>&1; then
      mkdir -p "$out/thumbs" && sips -Z 749 "$out/.$f" --out "$out/thumbs/$f" >/dev/null 2>&1 || cp -f "$out/.$f" "$out/thumbs/$f"
      mv -f "$out/.$f" "$out/$f"
    else f="$id.\${s##*.}"; cp -f "$s" "$out/$f" || continue; fi
  fi
  printf '%s\\t%s\\t' "$id" "$f"; head -c 4096 "$j" | tr '\\n\\r\\t' '   '; echo
done`;

// Posters of the site's pets, fetched once each: pairs of id and URL.
const POSTERS = `out="$1"; shift; mkdir -p "$out" || exit 1
while [ $# -ge 2 ]; do
  id="$1"; url="$2"; shift 2
  case "$id" in .*|*[!A-Za-z0-9._-]*) continue;; esac
  [ -s "$out/$id.png" ] && continue
  curl -fsSL --max-time 20 "$url" -o "$out/.$id.webp" && sips -s format png "$out/.$id.webp" --out "$out/.$id.png" >/dev/null 2>&1 && mv -f "$out/.$id.png" "$out/$id.png"
  rm -f "$out/.$id.webp"
done`;

// The site's zip, unpacked aside and only its pet.json and atlas kept, in ~/.codex/pets/<id>.
const INSTALL = `src="$1"; id="$2"; url="$3"
case "$id" in ""|.*|*[!A-Za-z0-9._-]*) echo "not a pet id" >&2; exit 2;; esac
tmp=$(mktemp -d) || exit 1; trap 'rm -rf "$tmp"' EXIT
curl -fsSL --max-time 90 "$url" -o "$tmp/pet.zip" 2>/dev/null || { echo "codex-pets.net did not answer" >&2; exit 3; }
unzip -qq "$tmp/pet.zip" -d "$tmp/x" 2>/dev/null || { echo "not a pet package" >&2; exit 4; }
j=$(find "$tmp/x" -maxdepth 2 -type f -name pet.json | head -n 1); [ -n "$j" ] || { echo "no pet.json in it" >&2; exit 5; }
d=$(dirname "$j"); s="$d/spritesheet.webp"; [ -f "$s" ] || s="$d/spritesheet.png"; [ -f "$s" ] || { echo "no spritesheet in it" >&2; exit 5; }
mkdir -p "$src/$id" && cp -f "$j" "$src/$id/pet.json" && cp -f "$s" "$src/$id/" || exit 6`;

const failed = (r, what) => new Error((r.stderr || what).trim().split("\n")[0]);

export async function installedPets() {
  const r = await exec("sh", ["-c", LIST, "sh", `${appHome()}/${DIR}`, petsHome()]);
  if (r.code !== 0) throw failed(r, "Your pets could not be read.");
  return parsePets(r.stdout);
}

// The site's popular pets, with their posters fetched.
export async function catalog(size = 12) {
  const r = await exec("curl", ["-fsSL", "--max-time", "20", `${SITE}/api/pets?sort=popular&pageSize=${size}`]);
  if (r.code !== 0) throw failed(r, "codex-pets.net did not answer.");
  const list = catalogOf(r.stdout);
  await exec("sh", ["-c", POSTERS, "sh", `${appHome()}/${DIR}/catalog`, ...list.flatMap((p) => [p.id, p.poster])]);
  return list;
}

export async function install(pet) {
  const r = await exec("sh", ["-c", INSTALL, "sh", petsHome(), pet.id, pet.download]);
  if (r.code !== 0) throw failed(r, `${pet.name} could not be installed.`);
}

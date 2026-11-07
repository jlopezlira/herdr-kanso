// Kanso's share card, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Kept byte for byte in kanso-panel/ and kanso-spend/ (`npm run sync:share`): edit kanso-panel/share.js.
import { div } from "gpui-kit";
import { h_flex, Button } from "gpui-base";
import { exec, home, readTextFile, writeTextFile, window, notify, theme, appHome } from "herdr";
import { findAsync, retry, tryOrAsync } from "./pure.js";

export const NETWORKS = {
  x: { name: "X", wait: 4, url: (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}` },
  linkedin: { name: "LinkedIn", wait: 5, url: (text) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}` },
  bluesky: { name: "Bluesky", wait: 3, url: (text) => `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}` },
};
export const REPO_URL = "github.com/jlopezlira/herdr-kanso";
const W = 1200, PAD = 72, INNER = W - 2 * PAD;
const FONT = "Inter, 'SF Pro Display', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function palette(t = theme() ?? {}) {
  return {
    canvas: t.canvas ?? t.background, text: t.foreground, muted: t.muted ?? t.dim, dim: t.dim,
    border: t.border ?? t.dim, subtle: t.hover ?? t.raised, accent: t.accent ?? t.foreground, red: t.ansi1, green: t.ansi2,
  };
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// #rrggbb (or #rrggbbaa) as fill plus opacity, which every renderer understands.
function paint(hex, alpha) {
  const h = String(hex ?? "#888888").replace(/^#/, "");
  const base = `#${h.slice(0, 6).padEnd(6, "8")}`;
  const a = alpha ?? (h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1);
  return `fill="${base}"${a < 1 ? ` fill-opacity="${Math.round(a * 1000) / 1000}"` : ""}`;
}
export function wrap(body, width) {
  const { lines, line } = String(body).split(/\s+/).reduce((acc, word) => (
    acc.line && acc.line.length + 1 + word.length > width
      ? { lines: [...acc.lines, acc.line], line: word }
      : { lines: acc.lines, line: acc.line ? `${acc.line} ${word}` : word }
  ), { lines: [], line: "" });
  return line ? [...lines, line] : lines;
}
const text = (x, y, size, color, body, extra = "") => `<text x="${x}" y="${y}" font-size="${size}" ${paint(color)} ${extra}>${esc(body)}</text>`;

export function postText(parts, fallback) {
  const line = parts.length ? `${parts.join(", ")}.` : fallback;
  return `${line[0].toUpperCase()}${line.slice(1)}\n\nCounted by kansō for Herdr: ${REPO_URL}`.slice(0, 280);
}

// Each part takes the y it starts at and answers { y, out }: where it ends and what it drew.
const drawn = (y, out = []) => ({ y, out });
const stack = (y, parts) => parts.reduce((acc, part) => {
  const next = part(acc.y);
  return { y: next.y, out: acc.out.concat(next.out) };
}, drawn(y));

const headerPart = (spec, c) => (from) => {
  const y = from + 30;
  return drawn(y, [
    text(PAD, y, 30, c.text, spec.title, 'font-weight="600"'),
    ...(spec.right ? [text(W - PAD, y, 24, c.muted, spec.right, 'text-anchor="end"')] : []),
  ]);
};

const heroPart = (hero, c) => (from) => {
  const top = from + 150;
  const labelY = hero.label ? top + 52 : top;
  const y = hero.delta?.text ? labelY + 44 : labelY;
  const color = hero.delta?.up ? c.green : c.red;
  return drawn(y, [
    `<text x="${PAD}" y="${top}" font-size="132" font-weight="300" ${paint(c.text)} letter-spacing="-3">${esc(hero.big ?? "—")}${hero.small ? `<tspan font-size="52" dx="24" ${paint(c.muted)}>${esc(hero.small)}</tspan>` : ""}</text>`,
    ...(hero.label ? [text(PAD, labelY, 26, c.muted, hero.label)] : []),
    ...(hero.delta?.text ? [`<circle cx="${PAD + 7}" cy="${y - 9}" r="7" ${paint(color)}/>`, text(PAD + 26, y, 26, color, hero.delta.text)] : []),
  ]);
};

const statsPart = (stats, c) => (from) => {
  if (!stats.length) return drawn(from);
  const top = from + 80;
  const col = INNER / Math.min(3, stats.length);
  return drawn(top + Math.floor((stats.length - 1) / 3) * 128 + 128, stats.flatMap((x, i) => {
    const y = top + Math.floor(i / 3) * 128, cx = PAD + (i % 3) * col;
    return [text(cx, y + 56, 64, c.text, x.value, 'font-weight="300"'), text(cx, y + 92, 22, c.dim, x.unit)];
  }));
};

const notePart = (note, c) => (from) => {
  if (!note) return drawn(from);
  const lines = wrap(note, 88);
  return drawn(from + lines.length * 32 + 8, lines.map((line, i) => text(PAD, from + i * 32 + 12, 22, c.muted, line)));
};

const LEVEL = { NONE: null, FIRST_QUARTILE: 0.3, SECOND_QUARTILE: 0.55, THIRD_QUARTILE: 0.8, FOURTH_QUARTILE: 1 };
const streakBlock = (b, c) => (from) => {
  const titleY = from + 48, bigY = titleY + 100, top = bigY + 32;
  // Always a year's 53 columns, the latest at the right, so the squares keep their size.
  const weeks = (b.weeks ?? []).slice(-53), gap = 4, cell = Math.floor((INNER - 52 * gap) / 53), first = 53 - weeks.length;
  return drawn(top + 7 * cell + 6 * gap, [
    text(PAD, titleY, 30, c.text, b.title),
    ...(b.right ? [text(W - PAD, titleY, 22, c.dim, b.right, 'text-anchor="end"')] : []),
    `<text x="${PAD}" y="${bigY}" font-size="96" font-weight="300" ${paint(c.text)}>${esc(b.n)}<tspan font-size="24" dx="16" ${paint(c.dim)}>${esc(b.unit)}</tspan></text>`,
    ...weeks.flatMap((w, wi) => w.contributionDays.map((d) => {
      const a = LEVEL[d.contributionLevel];
      return `<rect x="${PAD + (first + wi) * (cell + gap)}" y="${top + d.weekday * (cell + gap)}" width="${cell}" height="${cell}" rx="${Math.max(2, Math.round(cell / 5))}" ${a ? paint(c.accent, a) : paint(c.subtle)}/>`;
    })),
  ]);
};

const listBlock = (b, c) => (from) => {
  const titleY = from + 76, top = titleY + 16;
  return drawn(top + b.rows.length * 92, [
    text(PAD, titleY, 30, c.text, b.title),
    ...b.rows.flatMap((r, i) => {
      const y = top + i * 92;
      return [
        ...(i ? [`<rect x="${PAD}" y="${y}" width="${INNER}" height="1" ${paint(c.border)}/>`] : []),
        text(PAD, y + 40, 24, c.text, r.name),
        ...(r.detail ? [text(PAD, y + 70, 20, c.dim, r.detail)] : []),
        `<text x="${W - PAD}" y="${y + 56}" font-size="40" font-weight="300" text-anchor="end" ${paint(c.text)}>${esc(r.value)}${r.unit ? `<tspan font-size="20" dx="10" ${paint(c.dim)}>${esc(r.unit)}</tspan>` : ""}</text>`,
      ];
    }),
  ]);
};

const barsBlock = (b, c) => (from) => {
  const titleY = from + 64, top = titleY + 28;
  const values = b.values, highest = Math.max(...values), peak = values.indexOf(highest), n = values.length;
  const gap = n > 40 ? 3 : 6, bw = (INNER - (n - 1) * gap) / n, bh = 140, y = top + bh + 30;
  const ticks = b.ticks ?? [], last = ticks.length - 1;
  return drawn(y, [
    text(PAD, titleY, 30, c.text, b.title),
    ...(b.right ? [text(W - PAD, titleY, 22, c.dim, b.right, 'text-anchor="end"')] : []),
    ...values.map((v, i) => {
      const height = Math.max(4, Math.round((v / highest) * bh));
      return `<rect x="${PAD + i * (bw + gap)}" y="${top + bh - height}" width="${bw}" height="${height}" rx="3" ${v ? paint(c.accent, i === peak ? 1 : 0.55) : paint(c.subtle)}/>`;
    }),
    ...ticks.map((t, i) => text(PAD + (last ? (i * INNER) / last : 0), y, 18, c.dim, t, `text-anchor="${i === 0 ? "start" : i === last ? "end" : "middle"}"`)),
  ]);
};

const blockPart = (b, c) =>
  b.kind === "streak" ? streakBlock(b, c)
    : b.kind === "list" && b.rows?.length ? listBlock(b, c)
      : b.kind === "bars" && b.values?.some((n) => n > 0) ? barsBlock(b, c)
        : (from) => drawn(from);

export function cardSvg(spec, c) {
  const body = stack(PAD, [
    headerPart(spec, c),
    heroPart(spec.hero ?? {}, c),
    statsPart(spec.stats ?? [], c),
    notePart(spec.note, c),
    ...(spec.blocks ?? []).map((b) => blockPart(b, c)),
  ]);
  const y = body.y + 72;
  const out = [
    ...body.out,
    `<rect x="${PAD}" y="${y - 40}" width="${INNER}" height="1" ${paint(c.border)}/>`,
    text(PAD, y, 20, c.dim, "kansō for Herdr"),
    text(W - PAD, y, 20, c.dim, REPO_URL, 'text-anchor="end"'),
  ];
  const height = y + PAD - 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" font-family="${esc(FONT)}">
<rect width="${W}" height="${height}" ${paint(c.canvas)}/>
${out.join("\n")}
</svg>
`;
  return { svg, width: W, height };
}

const CHROMIUMS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "brave", "brave-browser", "microsoft-edge",
];

const exists = async (path) => (await exec("sh", ["-c", 'test -s "$1"', "sh", path]).catch(() => null))?.code === 0;
const macos = () => window()?.platform === "macos";
const pause = (seconds) => exec("sleep", [String(seconds)]).catch(() => null);

export async function renderPng(card, svgPath, pngPath) {
  await writeTextFile(svgPath, card.svg, await readTextFile(svgPath));
  await exec("rm", ["-f", pngPath]).catch(() => {});
  const html = svgPath.replace(/\.svg$/, ".html");
  await writeTextFile(html, `<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style></head><body>${card.svg}</body></html>`, await readTextFile(html));
  const tries = [
    ...CHROMIUMS.map((bin) => [bin, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--force-device-scale-factor=2",
      `--window-size=${card.width},${card.height}`, `--screenshot=${pngPath}`, `file://${html}`]]),
    ["rsvg-convert", ["-z", "2", "-o", pngPath, svgPath]],
    ["magick", ["-density", "192", svgPath, pngPath]],
  ];
  const made = await findAsync(tries, async ([bin, args]) => {
    const tried = await tryOrAsync(async () => ({ r: await exec(bin, args) })); // null: not installed here
    return tried !== null && tried.r.code === 0 && await exists(pngPath);
  });
  if (made) return made[0].split("/").at(-1);
  if (macos()) {
    const dir = svgPath.replace(/\/[^/]+$/, "");
    const r = await exec("qlmanage", ["-t", "-s", String(card.width * 2), "-o", dir, svgPath]).catch(() => null);
    if (r?.code === 0 && await exists(`${svgPath}.png`)) { await exec("mv", ["-f", `${svgPath}.png`, pngPath]); return "QuickLook"; }
  }
  throw new Error("Install Chrome, Chromium or rsvg-convert to make the image.");
}

export async function copyImage(pngPath) {
  const tries = macos()
    ? [["osascript", ["-e", `set the clipboard to (read (POSIX file "${pngPath.replace(/"/g, '\\"')}") as «class PNGf»)`]]]
    : [["sh", ["-c", 'wl-copy --type image/png < "$1"', "sh", pngPath]], ["xclip", ["-selection", "clipboard", "-t", "image/png", "-i", pngPath]]];
  return (await findAsync(tries, async ([bin, args]) => (await exec(bin, args).catch(() => null))?.code === 0)) !== null;
}

export const openPath = (target) => exec(macos() ? "open" : "xdg-open", [target]).catch(() => null);

async function frontApp() {
  const r = await exec("osascript", ["-l", "JavaScript", "-e",
    'ObjC.import("AppKit"); var a = $.NSWorkspace.sharedWorkspace.frontmostApplication; a ? ObjC.unwrap(a.bundleIdentifier) : ""']).catch(() => null);
  return r?.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

async function pasteInto(network, before) {
  if (macos()) {
    // Wait until the app in front is no longer Herdr: the browser came up.
    const front = await retry(13, () => frontApp(), { done: (app) => !(app && app === before), between: () => pause(0.5) });
    if (front && front === before) return false; // the browser never came up
    await pause(network.wait);
    if (front && (await frontApp()) !== front) return false; // you moved on: not into another app
    const r = await exec("osascript", ["-e", 'tell application "System Events" to keystroke "v" using command down']).catch(() => null);
    return r?.code === 0;
  }
  await pause(network.wait);
  const keys = [["wtype", ["-M", "ctrl", "-k", "v", "-m", "ctrl"]], ["xdotool", ["key", "--clearmodifiers", "ctrl+v"]]];
  return (await findAsync(keys, async ([bin, args]) => (await exec(bin, args).catch(() => null))?.code === 0)) !== null;
}

export async function outputPath(name) {
  const downloads = (await exec("test", ["-d", `${home()}/Downloads`]).catch(() => null))?.code === 0;
  const dir = downloads ? `${home()}/Downloads` : home();
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${dir}/kanso-${slug(name)}-${day}.png`;
}

export async function shareImage(network, make, workDir) {
  const { spec, text: words, name, title } = make();
  const card = cardSvg(spec, palette());
  const png = await outputPath(name);
  await exec("mkdir", ["-p", workDir]);
  await renderPng(card, `${workDir}/share.svg`, png);
  const where = png.replace(/^.*\/(Downloads\/)?/, (m, d) => (d ? "Downloads/" : ""));
  if (!network) {
    await openPath(png);
    notify({ title: `${title} image saved`, body: where, level: "success" });
    return;
  }
  const n = NETWORKS[network];
  const copied = await copyImage(png);
  const before = macos() ? await frontApp() : null;
  await openPath(n.url(words));
  const pasted = copied && await pasteInto(n, before);
  const key = macos() ? "Cmd-V" : "Ctrl-V";
  notify(pasted
    ? { title: `Your ${n.name} post has the image and the text`, body: `Check it and post. Not there? It is on the clipboard: ${key}. Saved in ${where}.`, level: "success" }
    : copied
      ? { title: `Paste the image into your ${n.name} post: ${key}`, body: macos() ? `It is on the clipboard and in ${where}. To have it pasted for you, allow Herdr in System Settings > Privacy & Security > Accessibility.` : `It is on the clipboard and in ${where}.`, level: "success" }
      : { title: `Attach ${png.split("/").at(-1)} to your ${n.name} post`, body: png, level: "success" });
  if (!copied) await openPath(png.replace(/\/[^/]+$/, ""));
}

export class Share {
  constructor(id, workDir) { this.id = id; this.workDir = workDir ?? `${appHome()}/data/${id}`; this.open = false; this.busy = null; }

  toggle(cx) { this.open = !this.open; cx.notify(); }

  run(network, make, cx) {
    if (this.busy) return;
    this.busy = network ?? "save"; cx.notify();
    cx.spawn(async (cx) => {
      try {
        await shareImage(network, make, this.workDir);
        this.open = false;
      } catch (e) {
        notify({ title: "The image could not be made", body: String(e?.message ?? e), level: "error" });
      } finally { this.busy = null; cx.notify(); }
    });
  }

  row(c, make, note, gap = 8) {
    const choice = (key, label, network) => Button.new(`${this.id}-share-${key}`).h(26).px(10).flex_none().items_center().rounded(6).cursor_pointer()
      .border_1().border_color(c.border).hover((s) => s.bg(c.subtle))
      .accessibility_label(label)
      .on_click((_e, cx) => this.run(network, make, cx))
      .child(div().text_size(12).text_color(this.busy === key ? c.dim : c.text).child(this.busy === key ? "Making the image…" : label));
    return h_flex().w_full().flex_wrap().gap(gap).items_center()
      .child(div().text_size(12).text_color(c.dim).child("Share to"))
      .children(Object.entries(NETWORKS).map(([key, n]) => choice(key, n.name, key)))
      .child(choice("save", "Save image", null))
      .child(div().w_full().text_size(11).text_color(c.dim).child(note));
  }
}

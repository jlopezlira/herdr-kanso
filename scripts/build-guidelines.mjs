#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const OUT = "site/guidelines";
export const ELEMENTS = `${OUT}/elements.json`;
export const TOKENS = "kanso/tokens.json";
export const STATUSES = ["Approved", "Built", "Verified"];
export const TEXT = ["fg", "muted", "dim"];
export const SURFACES = ["canvas", "chrome", "bg", "raised", "popover"];
export const MIN_CONTRAST = 4.5;
const THEMES = ["dark", "light"];
const GROUPS = [
  ["type", "Type"], ["space", "Space"], ["radius", "Radius"], ["height", "Height"],
  ["icon", "Icon"], ["switch", "Switch"], ["motion", "Motion"],
];

const read = (path) => readFileSync(ROOT + path, "utf8");

export function load() {
  return { elements: JSON.parse(read(ELEMENTS)).elements, tokens: JSON.parse(read(TOKENS)) };
}

export const published = (elements) => elements.filter((e) => STATUSES.includes(e.status));

export function statusLabel(e) {
  if (e.status === "Built") return `Built in ${e.version}`;
  if (e.status === "Verified") return "Verified against the running app";
  return e.status;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export function colour(tokens, theme, name) {
  const t = tokens.colour[theme].find((x) => x.name === name);
  if (!t) throw new Error(`no colour ${name} in ${theme}`);
  const mix = /^color-mix\(in srgb, var\(--([a-z]+)\) ([\d.]+)%, var\(--([a-z]+)\)\)$/.exec(t.value);
  if (!mix) return t.value;
  const a = rgb(colour(tokens, theme, mix[1])), b = rgb(colour(tokens, theme, mix[3])), p = Number(mix[2]) / 100;
  return toHex(a.map((v, i) => v * p + b[i] * (1 - p)));
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

export function pairs(tokens) {
  return THEMES.flatMap((theme) => TEXT.flatMap((text) => SURFACES.map((surface) => ({
    theme, text, surface,
    ratio: contrast(colour(tokens, theme, text), colour(tokens, theme, surface)),
  }))));
}

const ratio = (r) => (Math.floor(r * 100) / 100).toFixed(2);

function page({ title, description, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#161615">
<link rel="icon" href="../assets/enso.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../style.css">
<link rel="stylesheet" href="guidelines.css">
</head>
<body>

<header class="nav">
  <div class="nav-in">
    <a class="brand" href="../"><img src="../assets/enso.svg" alt="" width="22" height="22">kansō</a>
    <nav class="nav-links" aria-label="Pages">
      <a href="../#features">Features</a>
      <a href="./">Guidelines</a>
      <a href="../changelog.html">Changelog</a>
      <a href="../credits.html">Credits</a>
    </nav>
  </div>
</header>

<main class="doc guide">
${body}
</main>

<footer class="foot">
  <div class="foot-in">
    <span class="brand brand-small"><img src="../assets/enso.svg" alt="" width="18" height="18">kansō</span>
    <nav aria-label="Links">
      <a href="../changelog.html">Changelog</a>
      <a href="../credits.html">Credits and contact</a>
      <a href="../privacy.html">Privacy</a>
      <a href="../terms.html">Terms</a>
      <a href="../use.html">Use policy</a>
      <a href="https://github.com/jlopezlira/herdr-kanso">GitHub</a>
    </nav>
  </div>
</footer>

<script src="guidelines.js"></script>
</body>
</html>
`;
}

const status = (e) => `<span class="status status-${esc(e.status.toLowerCase())}">${esc(statusLabel(e))}</span>`;

function indexPage(elements) {
  const rows = elements.map((e) => `  <li><a href="${esc(e.page)}"><strong>${esc(e.title)}</strong>${e.summary ? `<span>${esc(e.summary)}</span>` : ""}</a>${status(e)}</li>`).join("\n");
  return page({
    title: "UX/UI guidelines · kansō",
    description: "kansō's approved design elements: tokens, components and states, each with its status and a block to give your coding agent.",
    body: `<h1>UX/UI guidelines</h1>
<p class="lede">The elements kansō is drawn with. Reuse them instead of drawing new ones.</p>
<p class="meta">Only approved elements appear here. Each one shows its status: Approved, Built in a version, or Verified against the running app.</p>

<ul class="elements">
${rows}
</ul>`,
  });
}

function sample(t) {
  const v = esc(t.value);
  if (/^k-fs-/.test(t.name)) return `<span class="sample-type" style="font-size:${v}">Aa</span>`;
  if (/^k-fw-/.test(t.name)) return `<span class="sample-type" style="font-weight:${v}">Aa</span>`;
  if (/^k-(sp|sw-w)/.test(t.name)) return `<span class="sample-bar" style="width:${v}"></span>`;
  if (/^k-(h-|sw-h)/.test(t.name)) return `<span class="sample-bar" style="width:8px;height:${v}"></span>`;
  if (/^k-(ic-|sw-knob)/.test(t.name)) return `<span class="sample-box" style="width:${v};height:${v}"></span>`;
  if (/^k-r-/.test(t.name)) return `<span class="sample-box sample-radius" style="border-radius:${v}"></span>`;
  return "";
}

function groupTable(tokens, [id, title]) {
  const rows = tokens[id].map((t) => `    <tr><td><code>--${esc(t.name)}</code></td><td class="value">${esc(t.value)}</td><td class="sample">${sample(t)}</td><td>${esc(t.role)}</td></tr>`).join("\n");
  return `<h2 id="${id}">${title}</h2>
<div class="scroll">
  <table class="tokens">
    <thead><tr><th>Token</th><th>Value</th><th><span class="sr-only">Sample</span></th><th>Role</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

function swatch(tokens, theme, t) {
  const hex = colour(tokens, theme, t.name);
  const lines = [`<span class="swatch" style="background:${esc(hex)}"></span><span class="value">${esc(hex)}</span>`];
  if (hex !== t.value) lines.push(`<span class="note">${esc(t.value)}</span>`);
  if (t.palette) lines.push(`<span class="note">palette ${esc(t.palette)}</span>`);
  return lines.join("");
}

function colourTable(tokens) {
  const rows = tokens.colour.dark.map((d) => {
    const l = tokens.colour.light.find((x) => x.name === d.name);
    return `    <tr><td><code>--${esc(d.name)}</code></td><td class="cell-dark">${swatch(tokens, "dark", d)}</td><td class="cell-light">${swatch(tokens, "light", l)}</td><td>${esc(d.role)}</td></tr>`;
  }).join("\n");
  return `<h2 id="colour">Colour</h2>
<p>Each colour has a dark and a light value. Where the kit overrides a theme colour for contrast, the published value is the override and the palette value is shown under it; otherwise the published value is the palette's.</p>
<div class="scroll">
  <table class="tokens colours">
    <thead><tr><th>Token</th><th>Dark</th><th>Light</th><th>Role</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

function contrastTables(tokens) {
  const all = pairs(tokens);
  const tables = THEMES.map((theme) => {
    const head = SURFACES.map((s) => `<th>${s}</th>`).join("");
    const rows = TEXT.map((text) => {
      const cells = SURFACES.map((surface) => {
        const p = all.find((x) => x.theme === theme && x.text === text && x.surface === surface);
        const low = p.ratio < MIN_CONTRAST;
        const style = `background:${colour(tokens, theme, surface)};color:${colour(tokens, theme, text)}`;
        return `<td class="pair${low ? " low" : ""}" style="${style}">${ratio(p.ratio)}${low ? " below" : ""}</td>`;
      }).join("");
      return `      <tr><th><code>--${text}</code></th>${cells}</tr>`;
    }).join("\n");
    return `<h3>${theme === "dark" ? "Dark" : "Light"}</h3>
<div class="scroll">
  <table class="contrast">
    <thead><tr><th><span class="sr-only">Text</span></th>${head}</tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
  }).join("\n");
  const low = all.filter((p) => p.ratio < MIN_CONTRAST);
  const verdict = low.length
    ? `<p class="fails">Below ${MIN_CONTRAST}:1 now: ${low.map((p) => `${p.text} on ${p.surface} (${p.theme}, ${ratio(p.ratio)})`).join("; ")}.</p>`
    : `<p>Every pair passes.</p>`;
  return `<h2 id="contrast">Contrast</h2>
<p>Text is <code>--fg</code>, <code>--muted</code> or <code>--dim</code>. Each must keep at least ${MIN_CONTRAST}:1 against every surface it can sit on (<code>--canvas</code>, <code>--chrome</code>, <code>--bg</code>, <code>--raised</code>, <code>--popover</code>) in both themes. The ratios below are measured from the published values with the WCAG 2 formula.</p>
${tables}
${verdict}`;
}

function howTo(e) {
  const files = e.files.map((f) => `  <li><code>${esc(f.path)}</code>: ${esc(f.role)}</li>`).join("\n");
  return `<h2 id="how">How to use it</h2>
<ul>
${files}
</ul>
<p>Give this to your coding agent:</p>
<div class="code prompt" data-copy-box>
  <code data-copy-text>${esc(e.agent)}</code>
  <button type="button" data-copy hidden><span data-copy-label>Copy</span></button>
</div>
<p class="sr-only" role="status" aria-live="polite" data-copy-status></p>`;
}

const cite = (s) => esc(s).replace(/\*([^*]+)\*/g, "<i>$1</i>");
const list = (items) => `<ul>\n${items.map((i) => `  <li>${cite(i)}</li>`).join("\n")}\n</ul>`;
const kanji = (p) => `<span class="kanji" lang="ja">${esc(p.kanji)}</span>`;

function principle(elements, id) {
  const p = elements.find((e) => e.id === "philosophy")?.principles.find((x) => x.id === id);
  if (!p) throw new Error(`no principle ${id}`);
  return p;
}

const serves = (elements, e) => {
  const p = principle(elements, e.serves);
  return `<p class="serves"><a href="philosophy.html#${esc(p.id)}">${esc(p.name)} ${kanji(p)}</a></p>`;
};

function head(e) {
  return `<p class="crumb"><a href="./">UX/UI guidelines</a></p>
<h1>${esc(e.title)}</h1>
${e.summary ? `<p class="lede">${esc(e.summary)}</p>\n` : ""}<p class="meta">${status(e)}</p>`;
}

function philosophyPage(e) {
  const sections = e.principles.map((p) => `<section class="principle" id="${esc(p.id)}">
<h2>${esc(p.name)} ${kanji(p)}</h2>
<h3>What it means</h3>
<p>${esc(p.means)}</p>
<h3>How kansō applies it</h3>
<p>${esc(p.applies)}</p>
</section>`).join("\n\n");
  return page({
    title: `${e.title} · UX/UI guidelines · kansō`,
    description: e.why[0].replace(/\*/g, ""),
    body: `${head(e)}

${sections}

<h2 id="why">Why</h2>
${list(e.why)}`,
  });
}

function tokensPage(e, tokens, elements) {
  const toc = [...GROUPS, ["colour", "Colour"], ["contrast", "Contrast"], ["when", "When to use"], ["how", "How to use it"]]
    .map(([id, title]) => `<a href="#${id}">${title}</a>`).join("\n  ");
  return page({
    title: `${e.title} · UX/UI guidelines · kansō`,
    description: e.summary,
    body: `${head(e)}
<nav class="toc" aria-label="On this page">
  ${toc}
</nav>

${GROUPS.map((g) => groupTable(tokens, g)).join("\n\n")}

${colourTable(tokens)}

${contrastTables(tokens)}

<h2 id="when">When to use</h2>
${serves(elements, e)}
${list(e.use)}
<h3>When not to</h3>
${list(e.avoid)}

${howTo(e)}`,
  });
}

const PAGES = { philosophy: philosophyPage, tokens: tokensPage };

export function render({ elements, tokens }) {
  const shown = published(elements);
  const out = { [`${OUT}/index.html`]: indexPage(shown) };
  for (const e of shown) {
    if (!PAGES[e.id]) throw new Error(`no page for element ${e.id}`);
    if (e.status === "Built" && !e.version) throw new Error(`element ${e.id} is Built but has no version`);
    if (e.id !== "philosophy" && !e.serves) throw new Error(`element ${e.id} names no principle`);
    out[`${OUT}/${e.page}`] = PAGES[e.id](e, tokens, shown);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(ROOT + OUT, { recursive: true });
  for (const [path, html] of Object.entries(render(load()))) {
    let old = null;
    try { old = read(path); } catch {}
    if (old !== html) { writeFileSync(ROOT + path, html); console.log(`wrote ${path}`); }
  }
}

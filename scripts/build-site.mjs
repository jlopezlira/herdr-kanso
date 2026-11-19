#!/usr/bin/env node
// Usage: npm run build:site [-- --check]
// Writes each site/<page>.html from site/pages/<page>.html and the layout it names; --check fails when one differs.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { CHECK, isMain, ROOT_URL as ROOT } from "./cli.mjs";

const SOURCES = "site/pages/";
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

export const PAGES = readdirSync(new URL(SOURCES, ROOT)).filter((name) => name.endsWith(".html")).toSorted();
export const BUILT = PAGES.map((name) => `site/${name}`);

const generated = (name) => `<!-- Generated from ${SOURCES}${name} by npm run build:site. -->`;

const PIECES = {
  chrome: ['"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \\'],
  pages: ['<a href="changelog.html">Changelog</a>'],
  install: [
    "<code data-copy-text>add herdr.dev/layouts/jlopezlira/herdr-kanso--kanso</code>",
    '<button type="button" data-copy><span data-copy-label>Copy</span></button>',
  ],
};

const NAV = `<header class="nav">
  <div class="nav-in">
    <a class="brand" href="./"><img src="assets/enso.svg" alt="" width="22" height="22">kansō</a>
    <nav class="nav-links" aria-label="Pages">
      <a href="./#features">Features</a>
      <!-- piece: pages -->
      <a href="credits.html">Credits</a>
    </nav>
  </div>
</header>

`;

const FOOTER = `<footer class="foot">
  <div class="foot-in">
    <span class="brand brand-small"><img src="assets/enso.svg" alt="" width="18" height="18">kansō</span>
    <nav aria-label="Links">
      <a href="changelog.html">Changelog</a>
      <a href="credits.html">Credits and contact</a>
      <a href="privacy.html">Privacy</a>
      <a href="terms.html">Terms</a>
      <a href="use.html">Use policy</a>
      <a href="https://github.com/jlopezlira/herdr-kanso">GitHub</a>
    </nav>
  </div>
</footer>
`;

const page = (name, { head, body, after = "" }) => `<!doctype html>
${generated(name)}
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}<meta name="theme-color" content="#161615">
<link rel="icon" href="assets/enso.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="style.css">
</head>
<body>

${body}${FOOTER}${after}</body>
</html>
`;

const card = (name, { size, fonts, about, glow, style, body }) => {
  const [width, height] = size.trim().split("x");
  return `<!doctype html>
${generated(name)}
<!--
${about}-->
<html lang="en">
<head>
<meta charset="utf-8">
<link href="${fonts.trim()}" rel="stylesheet">
<style>
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #161615; }
  body { position: relative; font-family: "Geist", -apple-system, sans-serif; color: #ece8de; }
  body::before {
${glow}  }
${style}  .shot img { display: block; width: 100%; }
</style>
</head>
<body>
${body}  <div class="shot"><img src="shots/hero.png" alt=""></div>
</body>
</html>
`;
};

const LAYOUTS = {
  page,
  doc: (name, { head, main, after }) => page(name, { head, body: `${withPieces(NAV)}<main class="doc">\n\n${main}</main>\n\n`, after }),
  card,
};

// A source's parts, each after its `<!-- part -->` line; its first line names the layout.
const partsOf = (text) => {
  const [, layout, rest] = text.match(/^<!-- layout: (\w+) -->\n([\s\S]*)$/);
  const [head, ...named] = rest.split(/^<!-- (\w+) -->\n/m);
  const parts = Object.fromEntries(Array.from({ length: named.length / 2 }, (_, i) => [named[i * 2], named[i * 2 + 1]]));
  return { layout, parts: { head, ...parts } };
};

const withPieces = (text) => text.replace(/^( *)<!-- piece: (\w+) -->\n/gm, (_, indent, piece) => PIECES[piece].map((line) => `${indent}${line}\n`).join(""));

export const build = (name) => {
  const { layout, parts } = partsOf(withPieces(read(`${SOURCES}${name}`)));
  return LAYOUTS[layout](name, parts);
};

if (isMain(import.meta.url)) {
  const stale = PAGES.filter((name) => read(`site/${name}`) !== build(name));
  if (CHECK && stale.length) {
    console.error(`${stale.map((name) => `site/${name}`).join(", ")} differ from site/pages: run npm run build:site`);
    process.exit(1);
  }
  if (!CHECK) for (const name of stale) writeFileSync(new URL(`site/${name}`, ROOT), build(name));
  console.log(CHECK ? "site pages match their sources" : `wrote ${stale.length} site pages`);
}

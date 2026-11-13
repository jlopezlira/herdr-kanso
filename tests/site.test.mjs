import test from "node:test";
import assert from "node:assert/strict";
import { MIN_CONTRAST, SURFACES, THEMES, colour, contrast, loadTokens, pairs, read } from "../scripts/tokens.mjs";
import { OUT, render } from "../scripts/build-site-tokens.mjs";

const CSS = ["site/style.css"];
const PAGES = ["index", "changelog", "credits", "privacy", "terms", "use"].map((p) => `site/${p}.html`);
const SCRIPTS = ["site/main.js", "site/changelog.js"];

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const declarations = (body) => body.split(";").map((d) => d.trim()).filter(Boolean)
  .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]);

function layout() {
  const css = strip(read("site/style.css")).trim();
  const block = /^:root\s*\{([^{}]*)\}/.exec(css);
  assert.ok(block, "style.css starts with its :root layout block");
  return { rest: css.slice(block[0].length), vars: declarations(block[1]) };
}

function sheets() {
  const { rest } = layout();
  return CSS.map((path) => {
    const css = path === "site/style.css" ? rest : strip(read(path));
    const rules = [...css.matchAll(/\{([^{}]*)\}/g)].flatMap((m) => declarations(m[1]));
    const media = [...css.matchAll(/@media([^{]*)\{/g)].map((m) => m[1]);
    return { path, css, rules, media };
  });
}

const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i;
const UNIT = /(?<![\w-])-?\d*\.?\d+(?:px|ms|s)\b/;

test("site/tokens.css matches kanso/tokens.json", () => {
  assert.equal(read(OUT), render(loadTokens()), `${OUT} is out of date: run npm run build:site-tokens`);
});

test("field edges (input) keep 3:1 on every surface in both themes", () => {
  const tokens = loadTokens();
  const low = THEMES.flatMap((theme) => SURFACES.map((surface) => ({
    theme, surface, ratio: contrast(colour(tokens, theme, "input"), colour(tokens, theme, surface)),
  }))).filter((p) => p.ratio < 3).map((p) => `${p.theme} input on ${p.surface}: ${p.ratio.toFixed(2)}`);
  assert.deepEqual(low, []);
});

test("every text colour keeps 4.5:1 on every surface in both themes", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  const low = pairs(loadTokens()).filter((p) => p.ratio < MIN_CONTRAST)
    .map((p) => `${p.theme} ${p.text} on ${p.surface}: ${p.ratio.toFixed(2)}`);
  assert.deepEqual(low, []);
});

test("the layout block holds only layout literals and font stacks", () => {
  for (const [name, value] of layout().vars) {
    assert.doesNotMatch(value, COLOUR, `${name}: ${value}`);
    if (UNIT.test(value)) assert.match(value, /^\d+px$/, `${name}: ${value}`);
  }
});

test("site CSS has no colour, px or ms literal outside the layout block", () => {
  for (const { path, rules } of sheets()) {
    for (const [name, value] of rules) {
      assert.doesNotMatch(value, COLOUR, `${path} ${name}: ${value}`);
      assert.doesNotMatch(value, UNIT, `${path} ${name}: ${value}`);
    }
  }
});

test("every font-size in the site CSS is a type token", () => {
  const sizes = new Set(loadTokens().type.filter((t) => t.name.startsWith("k-fs-")).map((t) => t.name));
  for (const { path, rules } of sheets()) {
    for (const [name, value] of rules) {
      assert.notEqual(name, "font", `${path}: use font-size and font-family, not the font shorthand`);
      if (name !== "font-size") continue;
      const token = /^var\(--([\w-]+)\)$/.exec(value)?.[1];
      assert.ok(sizes.has(token), `${path} font-size: ${value}`);
    }
  }
});

test("media queries use only the declared breakpoints", () => {
  const points = layout().vars.filter(([name]) => name.startsWith("--bp-")).map(([, value]) => value);
  assert.ok(points.length, "style.css declares its breakpoints");
  for (const { path, media } of sheets()) {
    for (const query of media) {
      for (const [px] of query.matchAll(/\d+px/g)) assert.ok(points.includes(px), `${path} @media${query}`);
    }
  }
});

test("every variable the site CSS reads is defined", () => {
  const defined = new Set([
    ...[...read(OUT).matchAll(/(--[\w-]+):/g)].map((m) => m[1]),
    ...layout().vars.map(([name]) => name),
  ]);
  for (const path of CSS) {
    for (const [, name] of strip(read(path)).matchAll(/var\((--[\w-]+)\)/g)) assert.ok(defined.has(name), `${path} reads ${name}`);
  }
});

test("site pages and scripts carry no inline styles", () => {
  for (const path of PAGES) assert.doesNotMatch(read(path), /<style\b|\sstyle="/, path);
  for (const path of SCRIPTS) assert.doesNotMatch(read(path), /\.style\b|style=/, path);
});

test("every site page loads the tokens before its stylesheet", () => {
  for (const path of PAGES) assert.match(read(path), /href="tokens\.css">\n<link rel="stylesheet" href="style\.css">/, path);
});

test("every site page's nav links storybook/", () => {
  for (const path of PAGES) {
    const nav = /<nav class="nav-links"[\s\S]*?<\/nav>/.exec(read(path))[0];
    assert.match(nav, /href="storybook\/" target="_blank" rel="noopener">Storybook</, path);
  }
});

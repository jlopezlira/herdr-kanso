#!/usr/bin/env node
// Reads the prototype's Storybook export (sb-atomic-stories.json, sb-atomic.css, sb-atomic-sprite.svg, board-notes.md) from <dir> and writes stories/proto*.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const src = process.argv[2];
if (!src) throw new Error("usage: node scripts/import-proto.mjs <dir>");
const read = (name) => readFileSync(join(src, name), "utf8");
const OUT = "stories/proto";

const LAYOUTS = ["Window at rest", "Sidebar at rest", "Sidebar header, three ways", "hjkl dōjō", "Right-click any piece"];
const SETTINGS = ["Settings", "Settings, what shows", "Keys", "Window map", "What's new", "Credits"];
const SUBS = { "States (S21)": "States" };
const TABLES = ["Every value", "Contrast, light and dark"];

const BOARDS = {
  Z: "Philosophy",
  K: "Tokens/Every value",
  S21: "Compositions/States",
  I1: "Tokens/Icons",
  A: "Tokens/Colour and wash",
  10: "Layouts/Right-click any piece",
  "01": "Layouts/Window at rest",
  11: "Tokens/Dawn",
  S01: "Layouts/Sidebar at rest",
  S02: "Components/Title and tools",
  S03: "Compositions/Sidebar rows",
  S04: "Compositions/Sidebar rows",
  S05: "Compositions/Sidebar rows",
  S06: "Compositions/Sidebar rows",
  S07: "Compositions/Sidebar rows",
  S08: "Components/While you were away",
  S09: "Compositions/Sidebar rows",
  S10: "Compositions/Sidebar rows",
  S11: "Compositions/Sidebar rows",
  S13: "Compositions/Sidebar rows",
  S14: "Components/New project",
  S15: "Compositions/Sidebar rows",
  S16: "Compositions/Sidebar rows",
  S17: "Compositions/Sidebar rows",
  S18: "Components/Menu",
  S19: "Compositions/Sidebar rows",
  S20: "Layouts/Sidebar at rest",
  S12: "Components/Collapsed rail",
  B1: "Components/Tab bar",
  B2: "Components/Tab bar",
  B3: "Components/Panel menu",
  B4: "Components/Pane header",
  B5: "Components/Pane header",
  B11: "Components/Header digest",
  B7: "Components/Find in the conversation",
  B10: "Layouts/Right-click any piece",
  B8: "Components/Status bar",
  B6: "Components/Edges and minimap",
  B9: "Compositions/Bars",
  "08": "Compositions/Panel pieces",
  P17: "Compositions/Panel pieces",
  S0: "Compositions/Panel pieces",
  Q7: "Components/Menu",
  Q10: "Components/Annotated picture",
  Q8: "Compositions/Panel pieces",
  Q9: "Compositions/Panel pieces",
  P01: "Compositions/Files and PR",
  P02: "Compositions/Files and PR",
  P03: "Components/Code",
  P04: "Components/Markdown",
  P05: "Compositions/Files and PR",
  "06": "Compositions/Files and PR",
  "07": "Compositions/Files and PR",
  P06: "Compositions/Files and PR",
  P07: "Compositions/Files and PR",
  P08: "Compositions/Files and PR",
  P09: "Compositions/Files and PR",
  P10: "Compositions/Files and PR",
  P16: "Compositions/Files and PR",
  P15: "Compositions/Files and PR",
  P11: "Components/Shipped",
  P12: "Components/Shipped",
  P13: "Components/Worktree row, open",
  P14: "Components/New worktree",
  Q1: "Compositions/Panel pieces",
  S1: "Compositions/Panel pieces",
  Q2: "Compositions/Panel pieces",
  S2: "Compositions/Panel pieces",
  Q3: "Compositions/Panel pieces",
  S3: "Compositions/Panel pieces",
  Q4: "Compositions/Panel pieces",
  S4: "Compositions/Panel pieces",
  Q5: "Compositions/Panel pieces",
  S5: "Compositions/Panel pieces",
  Q6: "Components/Simulator screen",
  S6: "Components/Simulator screen",
  D12: "Components/Settings tabs",
  D13: "Components/Settings tabs",
  D2: "Components/Settings tabs",
  D3: "Components/Settings tabs",
  D4: "Components/Settings tabs",
  D5: "Components/Settings tabs",
  D14: "Components/Settings tabs",
  D1: "Components/Dialog",
  D6: "Compositions/Menu and dialog",
  D7: "Compositions/Menu and dialog",
  D8: "Components/Pick list",
  D9: "Components/Pick list",
  D10: "Components/Markdown window",
  D15: "Components/Dialog",
  D11a: "Layouts/hjkl dōjō",
  D11b: "Layouts/hjkl dōjō",
  D11c: "Layouts/hjkl dōjō",
};

function place({ group, sub, title }) {
  if (group === "Tokens") return "Tokens/Every value";
  if (group === "Atoms") return `${sub === "Controls" ? "Compositions" : "Tokens"}/${sub}`;
  if (group === "Molecules") return `Compositions/${SUBS[sub] ?? sub}`;
  if (group === "Compositions") return LAYOUTS.includes(title) ? `Layouts/${title}` : `Components/${SETTINGS.includes(title) ? "Settings tabs" : title}`;
  return null;
}

const plain = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "");
const slug = (text) => plain(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const exportName = (text) => plain(text).replace(/'/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");

function closeOf(html, start) {
  const tag = /<(\/?)div\b[^>]*>/g;
  tag.lastIndex = start;
  let depth = 0;
  for (let m; (m = tag.exec(html)); ) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return tag.lastIndex;
  }
  throw new Error(`unbalanced div at ${start}`);
}

function children(html) {
  const out = [];
  for (let i = html.indexOf("<div"); i !== -1; ) {
    const end = closeOf(html, i);
    out.push(html.slice(i, end));
    i = html.indexOf("<div", end);
  }
  return out;
}

const LIGHT = /<div class="[^"]*\bk-light\b[^"]*"/;

function dropLight(html) {
  for (let m; (m = LIGHT.exec(html)); ) {
    let start = m.index;
    let end = closeOf(html, start);
    const cap = /<p class="cap"[^>]*>[^<]*light<\/p>\s*$/i.exec(html.slice(0, start));
    if (cap) start = cap.index;
    html = html.slice(0, start) + html.slice(end);
  }
  return html.replace(/<div>\s*<\/div>/g, "");
}

function example(html) {
  const start = html.indexOf('<div class="st-ex">');
  const inner = html.slice(start, closeOf(html, start)).replace(/^<div class="st-ex">/, "").replace(/<\/div>$/, "");
  const kids = children(inner);
  const paired = kids.length > 1 && kids.some((k) => LIGHT.test(k.slice(0, k.indexOf(">") + 1)));
  const kept = paired ? kids.filter((k) => !LIGHT.test(k.slice(0, k.indexOf(">") + 1))).join("") : inner;
  const one = dropLight(kept).replace(/class="([^"]*)"/g, (_, c) => `class="${c.split(/\s+/).filter((n) => n !== "k-dark" && n !== "k-light").join(" ")}"`);
  if (/k-(dark|light)/.test(one)) throw new Error("a theme class is left");
  return `<div class="st-ex">${one}</div>`;
}

function notes() {
  const byFolder = {};
  for (const board of read("board-notes.md").split(/^## /m).slice(1)) {
    const [head, ...body] = board.trim().split("\n");
    const folder = BOARDS[head.split(" ")[0]];
    if (!folder) throw new Error(`board ${head} has no folder`);
    (byFolder[folder] ??= []).push({ name: head.replace(/\s*\(`#[^`]*`\)$/, ""), body: body.join("\n").trim() });
  }
  return byFolder;
}

const tokens = new Set(readFileSync("site/tokens.css", "utf8").match(/--[\w-]+(?=:)/g));
const CHROME = /^(:root\{color-scheme|@import|body\{|a\{color|\.page[{.]|\.top[{ ]|\.nav[{ ]|\.board\{|\.bh[{ ]|\.bg\{|@media \(max-width:1100px\)|\.notes|\.cap\{|\.ctl-|\.st\{|\.st-wait|\.hrow|:root\{--nav-w|\.lnav|\.grp-|section\.board|@media \(prefers-reduced-motion:reduce\)\{\.lnav|@media \(max-width:960px\)|\.kz\{|\.st-page|\.st-nav|\.story|\.st-h )/;
const css = read("sb-atomic.css")
  .split("\n")
  .filter((line) => !CHROME.test(line))
  .join("\n")
  .replace(/(?<=^|\})(\.k\.k-|\.k-)(dark|light)\{([^}]*)\}/gm, (_, __, t, body) => {
    const kept = body.split(";").filter((d) => d.trim() && !tokens.has(d.split(":")[0].trim()));
    return kept.length ? `:root[data-theme="${t}"] .k{${kept.join(";")}}` : "";
  })
  .replaceAll(".k.k-dark,.k.k-light{", ".k{")
  .replaceAll(".k-light ", ':root[data-theme="light"] ')
  .replace(/\n{3,}/g, "\n\n");
if (/k-(dark|light)/.test(css)) throw new Error("a theme selector is left");

const text = (html) => html.replace(/<svg.*?<\/svg>/gs, "").replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
const q = (s) => JSON.stringify(s);
const mdxText = (text) => text.split(/(`[^`]*`)/).map((part, i) => (i % 2 ? part : part.replace(/[{}<>]/g, (c) => `\\${c}`))).join("");
const cell = (tag, value, span) => `<${tag}${span ? ` colSpan={${span}}` : ""}>{${q(value)}}</${tag}>`;
const jsxTable = (head, rows) => `<table>\n<thead><tr>${head.map((h) => cell("th", h)).join("")}</tr></thead>\n<tbody>\n${rows.map((r) => `<tr>${r}</tr>`).join("\n")}\n</tbody>\n</table>`;

function tableOf(html) {
  if (html.includes("<table")) {
    const [, cap, table] = /<p class="cap">([^<]*)<\/p>(?:<div[^>]*>)?\s*(<table.*?<\/table>)/s.exec(html);
    const [head, ...rows] = [...table.matchAll(/<tr>(.*?)<\/tr>/gs)].map((m) =>
      [...m[1].matchAll(/<(td|th)([^>]*)>(.*?)<\/\1>/gs)].map(([, , attrs, inner]) => ({ value: text(inner), span: /colspan="(\d+)"/.exec(attrs)?.[1] })));
    return `${mdxText(text(cap))}\n\n${jsxTable(head.map((c) => c.value), rows.map((r) => r.map((c) => cell("td", c.value, c.span)).join("")))}`;
  }
  const out = [];
  let rows = [];
  const flush = () => {
    if (!rows.length) return;
    const values = rows.some((r) => r.value);
    out.push(jsxTable(values ? ["Token", "Value", "Use"] : ["Token", "Use"], rows.map((r) => (values ? [r.name, r.value, r.use] : [r.name, r.use]).map((v) => cell("td", v)).join(""))));
    rows = [];
  };
  for (const m of html.matchAll(/<span class="p-t">(.*?)<\/span>|<div class="p-scope">(.*?)<\/div>|<div class="sect">(.*?)<\/div>|<div class="kbx-t">(.*?)<\/div>/gs)) {
    if (m[4]) {
      const part = (c) => text(new RegExp(`<span class="${c}"[^>]*>(.*?)</span>`, "s").exec(m[4])[1]);
      const value = part("kbx-s");
      rows.push({ name: part("kbx-n"), value: value === "Aa" ? "" : value, use: part("r") });
      continue;
    }
    flush();
    if (m[1]) out.push(`### ${mdxText(text(m[1]))}`);
    if (m[2]) out.push(`{${q(text(m[2]))}}`);
    if (m[3]) out.push(`#### ${mdxText(text(m[3]))}`);
  }
  flush();
  return out.join("\n\n");
}

const folders = new Map();
const tables = {};
for (const entry of JSON.parse(read("sb-atomic-stories.json"))) {
  const folder = place(entry);
  if (!folder) continue;
  const [, title, caption] = /<div class="st-h"><b>(.*?)<\/b><span>(.*?)<\/span>/s.exec(entry.html);
  if (title !== entry.title) throw new Error(`title mismatch: ${entry.title}`);
  if (!folders.has(folder)) folders.set(folder, {});
  if (TABLES.includes(title)) {
    (tables[folder] ??= []).push(`## ${mdxText(title)}\n\n${mdxText(text(caption))}\n\n${tableOf(entry.html)}`);
    continue;
  }
  const stories = folders.get(folder);
  let name = exportName(title);
  while (stories[name]) name += "2";
  stories[name] = { title, caption: caption.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), html: example(entry.html) };
}

const why = notes();
for (const folder of Object.keys(why)) {
  if (folder !== "Philosophy" && !folders.has(folder)) throw new Error(`no folder ${folder}`);
}

const cssRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
  classes: (sel.match(/\.[\w-]+/g) ?? []).map((c) => c.slice(1)),
  vars: [...body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]),
}));
const isToken = (v) => tokens.has(v) || /^--w\d+$/.test(v);

function prompt(folder, stories, boards) {
  const html = Object.values(stories).map((s) => s.html).join("");
  const used = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)));
  const vars = new Set([...html.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  for (const r of cssRules) if (r.classes.length && r.classes.every((c) => used.has(c))) r.vars.forEach((v) => vars.add(v));
  const kit = [...used].filter((c) => /^(kit|kst)-/.test(c)).sort();
  const sentences = boards.flatMap((b) => b.body.split("\n").filter((l) => l.startsWith("- ")).flatMap((l) => l.replace(/^- (\*\*[^*]+\*\* )?/, "").split(/(?<=\.)\s+(?=[A-Z"])/)));
  const defects = sentences.filter((s) => /\bdefect\b|^(Never|No)\b/.test(s) && !/^No \w+ is\b/.test(s));
  const [level, sub] = folder.split("/");
  return [
    `Build ${sub} (${level}) for kansō with the kit only: the tokens in kanso/tokens.json and the drawings in stories/proto.css.`,
    ...(vars.size ? [`Use these tokens: ${[...vars].filter(isToken).sort().join(", ")}.`] : []),
    ...(html ? [`Draw these pieces: ${Object.values(stories).map((s) => s.title).join("; ")}.`] : []),
    ...(kit.length ? [`Reuse these kit classes: ${kit.join(", ")}.`] : []),
    ...(html ? ["Follow these rules:", ...Object.values(stories).map((s) => `- ${s.title}: ${s.caption}`)] : []),
    ...(boards.length ? [`Apply every guideline of ${boards.map((b) => b.name).join("; ")}.`] : []),
    ...(defects.length ? ["Treat as a defect:", ...defects.map((s) => `- ${s}`)] : []),
  ].join("\n");
}


rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "story.js"), "export const story = ({ html, caption }) => ({ render: () => html, parameters: { docs: { description: { story: caption } } } });\n");
for (const [folder, stories] of folders) {
  const file = slug(folder);
  const boards = why[folder] ?? [];
  const drawn = Object.keys(stories).length > 0;
  if (drawn) writeFileSync(join(OUT, `${file}.json`), `${JSON.stringify(stories, (k, v) => (k === "title" ? undefined : v), 1)}\n`);
  if (drawn) writeFileSync(join(OUT, `${file}.stories.js`), `import stories from './${file}.json';
import { story } from './story.js';

export default { title: ${q(folder)} };

${Object.entries(stories).map(([k, s]) => `export const ${k} = { name: ${q(s.title)}, ...story(stories.${k}) };`).join("\n")}
`);
  writeFileSync(join(OUT, `${file}.mdx`), `import { Canvas, Meta } from '@storybook/addon-docs/blocks';
${drawn ? `import * as stories from './${file}.stories.js';\n` : ""}
<Meta title=${q(folder)} />

# ${mdxText(folder.split("/")[1])}

${[...Object.entries(stories).map(([k, s]) => `## ${mdxText(s.title)}\n\n${mdxText(s.caption)}\n\n<Canvas of={stories.${k}} />`), ...(tables[folder] ?? [])].join("\n\n")}
${boards.map((b) => `\n## ${mdxText(b.name)}\n\n${mdxText(b.body)}\n`).join("")}
## Prompt for agents

\`\`\`text
${prompt(folder, stories, boards)}
\`\`\`
`);
}
writeFileSync("stories/proto.css", `/* The prototype's own CSS, minus its page chrome; palettes follow site/tokens.css. Written by scripts/import-proto.mjs. */\n${css}`);
writeFileSync("stories/proto-sprite.svg", read("sb-atomic-sprite.svg"));

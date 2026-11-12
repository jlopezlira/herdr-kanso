#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = "stories/panels";
const CSS_MARK = "/* Additional panel drawing rules. Written by scripts/import-panels.mjs. */";
export const CLASS_NAMES = {};
const q = JSON.stringify;
const plain = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const slug = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const identifier = (s) => plain(s).replace(/'/g, "").split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, (v) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&nbsp;": " " })[v]);
const text = (s) => decode(s.replace(/<[^>]*>/g, "")).trim();

export function closeOf(html, start) {
  const tags = /<(\/?)div\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let m; (m = tags.exec(html)); ) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return tags.lastIndex;
  }
  throw new Error(`Unbalanced div at ${start}`);
}

function block(html, className) {
  const m = new RegExp(`<div class="${className}"[^>]*>`).exec(html);
  if (!m) throw new Error(`Missing ${className}`);
  return html.slice(m.index, closeOf(html, m.index));
}

export function clean(s) {
  return decode(s)
    .replace(/\bboards?\s+(?:[AKLZ]|[A-Z]\d{1,2}[a-z]?|\d{2})(?:\s*(?:,|to|and)\s*(?:[A-Z]\d{1,2}[a-z]?|\d{2}))*\b/gi, "")
    .replace(/\b[A-Z]\d{1,2}[a-z]?\b/g, "")
    .replace(/\((?:[AKLZ]|0[0-9]|10|11)\)/g, "")
    .replace(/\b(?:from|as in|on) [AKLZ]\b/g, "")
    .replace(/\bboards?\b/gi, "example")
    .replace(/\bprototype(?:'s)?\b/gi, "example")
    .replace(/`?\b[\w-]+\.(?:html|css|m?js|json)(?::[\d-]+)?`?/g, "")
    .replace(/\(\s*[,;:]?\s*\)/g, "")
    .replace(/\s*\(subtracted\)/gi, "")
    .replace(/^[\s:,.·]+|[ \t]+([,.;:)])/g, "$1")
    .replace(/[ \t]{2,}/g, " ").trim();
}

const mdx = (s) => clean(s).split(/(`[^`]*`)/).map((part, i) => i % 2 ? part : part.replace(/[{}<>]/g, (c) => `\\${c}`)).join("");
export const drawing = (html) => html.replace(/class="([^"]*)"/g, (_, classes) => `class="${classes.split(/\s+/).filter((c) => c !== "k-dark" && c !== "k-light").map((c) => CLASS_NAMES[c] ?? c).join(" ")}"`);

export function entriesOf(html) {
  const entries = [];
  let group = "";
  const tags = /<h3>(.*?)<\/h3>|<div class="story\b[^>]*>/gs;
  for (let m; (m = tags.exec(html)); ) {
    if (m[1]) { group = text(m[1]).replace(/^Panel · /, ""); continue; }
    const end = closeOf(html, m.index);
    const story = html.slice(m.index, end);
    const header = block(story, "st-h");
    const title = text(/<b>(.*?)<\/b>/s.exec(header)[1]);
    const code = /Board ([^:]+):/.exec(header)?.[1];
    if (!code) throw new Error(`Missing source reference: ${title}`);
    entries.push({ group, title, code, html: block(story, "st-ex"), spec: block(story, "st-doc") });
    tags.lastIndex = end;
  }
  return entries;
}

function specRows(html) {
  const principle = text(/<p class="st-pz">(.*?)<\/p>/s.exec(html)?.[1] ?? "");
  const rows = [];
  for (const m of html.matchAll(/<h4>(.*?)<\/h4>(.*?)(?=<\/div>)/gs)) {
    const body = m[2].replace(/<p class="st-pz">.*?<\/p>/gs, "");
    rows.push([text(m[1]), [...body.matchAll(/<(?:li|p)[^>]*>(.*?)<\/(?:li|p)>/gs)].map((p) => clean(text(p[1]))).join("\n")]);
  }
  rows.push(["Principle", clean(principle).replace(/[\s·]+$/, "")]);
  if (rows.length !== 5 || rows.some(([, value]) => !value)) throw new Error("Incomplete specification");
  return rows;
}

const PANEL_CODES = {
  "08": "Skeleton", P17: "First screens", S0: "First screens", Q7: "Share", Q10: "Pins", Q8: "Availability", Q9: "Overview",
  P01: "Files", P02: "Files", P03: "Preview", P04: "Preview", P05: "Preview",
  "06": "PR", "07": "PR", P06: "PR", P07: "PR", P08: "PR", P09: "PR", P10: "PR", P15: "PR", P16: "PR",
  P11: "Shipped", P12: "Shipped", P13: "Worktrees", P14: "Worktrees",
  Q1: "Ports", S1: "Ports", Q2: "Containers", S2: "Containers", Q3: "Memory", S3: "Memory", Q4: "Spend", S4: "Spend", Q5: "Images", S5: "Images", Q6: "Simulator", S6: "Simulator",
};
const CONTEXT = { P03: "Text", P04: "Markdown", P05: "Pictures", "06": "List", "07": "List, light", P06: "List", P07: "Verdict", P08: "Actions", P09: "Details", P10: "Diff", P15: "Long diff", P16: "Conversation" };
const FOLDERS = {
  Z: "Philosophy", K: "Tokens/Every value", I1: "Tokens/Icons", A: "Tokens/Colour and wash", "11": "Tokens/Dawn", S21: "Compositions/States",
  "00": "Reference/Control", L: "Reference/One fact, one home", "01": "Layouts/Window at rest", "10": "Layouts/Right-click any piece",
  S01: "Layouts/Sidebar at rest", S20: "Layouts/Sidebar at rest", S02: "Components/Title and tools", S08: "Components/While you were away", S12: "Components/Collapsed rail", S14: "Components/New project", S18: "Components/Menu",
  B1: "Components/Tab bar", B2: "Components/Tab bar", B3: "Components/Panel menu", B4: "Components/Pane header", B5: "Components/Pane header", B11: "Components/Header digest", B7: "Components/Find in the conversation", B10: "Layouts/Right-click any piece", B8: "Components/Status bar", B6: "Components/Edges and minimap", B9: "Compositions/Bars",
  D12: "Panels/Settings", D13: "Panels/Settings", D2: "Panels/Settings", D3: "Panels/Settings", D4: "Panels/Settings", D5: "Panels/Settings", D14: "Panels/Help",
  D1: "Components/Dialog", D6: "Compositions/Menu and dialog", D7: "Compositions/Menu and dialog", D8: "Panels/Send", D9: "Panels/Look", D10: "Panels/Markdown", D15: "Components/Dialog",
  D11a: "Panels/Dojo", D11b: "Panels/Dojo", D11c: "Panels/Dojo",
};
const DESCRIPTIONS = {
  Skeleton: "The shared panel shell appears wherever a tool opens beside the current pane.",
  Share: "Share opens from a panel header to send or copy its current result.",
  Pins: "Pins attach notes to a picture or device screen when sending feedback to an agent.",
  Availability: "Panel availability follows the tools installed on the current computer.",
  Files: "Files shows the current pane's changed files or repository tree when opened from its header or the panel bar.",
  Preview: "Preview opens a selected file for reading, editing or annotating beside the current pane.",
  PR: "PR shows pull requests and their checks, reviews and changes when opened from the current branch or the panel bar.",
  Shipped: "Shipped shows contribution totals for the selected period when opened from the panel bar.",
  Worktrees: "Worktrees lists repository checkouts and cleanup actions when opened from the project or the panel bar.",
  Ports: "Ports lists listening services and their panes when opened from the panel bar or status bar.",
  Containers: "Containers shows Docker projects, running containers and disk use when Docker is available.",
  Memory: "Memory shows free memory, agent use and guard controls when the computer supports the guard.",
  Spend: "Spend shows plan use and session costs when opened from the panel bar.",
  Images: "Images collects pictures and pinned notes when preparing feedback for an agent.",
  Simulator: "Simulator shows connected devices and their screens when simulator tools are available.",
};

function pageFor(entry, firstScreen) {
  if (entry.code === "P17") {
    const label = entry.title.split(" · ")[0];
    if (entry.title.includes(" · rows")) firstScreen.name = /^Pull request/.test(label) ? "PR" : label;
    if (!firstScreen.name) throw new Error("First screen without a panel");
    return firstScreen.name;
  }
  const page = PANEL_CODES[entry.code];
  if (!DESCRIPTIONS[page]) throw new Error(`No page for ${entry.code}`);
  return page;
}

export function cssBlocks(css) {
  const blocks = [];
  let start = 0, depth = 0, quote = "", comment = false;
  for (let i = 0; i < css.length; i++) {
    const c = css[i], next = css[i + 1];
    if (comment) { if (c === "*" && next === "/") { comment = false; i++; if (!depth) start = i + 1; } continue; }
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === "/" && next === "*") { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ";" && depth === 0) { start = i + 1; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) { blocks.push(css.slice(start, i + 1).trim()); start = i + 1; }
  }
  if (depth || quote || comment) throw new Error("Unbalanced CSS");
  return blocks;
}

function addCss(sources, markup) {
  const file = "stories/proto.css";
  const base = readFileSync(file, "utf8").split(CSS_MARK)[0].trimEnd();
  const existing = new Set();
  const used = new Set([...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)));
  const additions = [];
  function visit(css, context = "", collect = false) {
    const kept = [];
    for (const rule of cssBlocks(css)) {
      const brace = rule.indexOf("{");
      const selector = rule.slice(0, brace).trim();
      const key = `${context}|${selector.replace(/\s+/g, " ")}`;
      if (selector.startsWith("@media") || selector.startsWith("@supports")) {
        const nested = visit(rule.slice(brace + 1, -1), key, collect);
        if (nested.length) kept.push(`${rule.slice(0, brace + 1)}${nested.join("\n")}}`);
      } else if (!collect) existing.add(key);
      else if (!existing.has(key)) {
        const classes = [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
        const chrome = /\b(?:board|bh|bg|notes|ctl-[\w-]+|lnav|grp-[\w-]+|st-doc|st-code|st-body|story|page|nav|top|k-dark|k-light)\b/;
        const applies = selector.split(",").some((part) => {
          const names = [...part.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
          return names.length && names.every((name) => used.has(name));
        });
        if (classes.length && applies && !classes.some((c) => chrome.test(c))) {
          kept.push(rule); existing.add(key);
        }
      }
    }
    return kept;
  }
  visit(base);
  for (const source of sources) for (const m of source.matchAll(/<style[^>]*>(.*?)<\/style>/gs)) additions.push(...visit(m[1], "", true));
  const definitions = new Set([...(base + readFileSync("site/tokens.css", "utf8")).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const needed = new Set([...(markup + additions.join("\n")).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const themeDefinitions = new Set();
  for (const theme of ["dark", "light"]) {
    const declarations = [];
    for (const source of sources) for (const match of source.matchAll(new RegExp(`\\.k(?:\\.k)?-${theme}\\{([^{}]*)\\}`, "g"))) {
      for (const declaration of match[1].split(";")) {
        const name = declaration.split(":")[0].trim();
        const key = `${theme}:${name}`;
        if (needed.has(name) && !definitions.has(name) && !themeDefinitions.has(key)) {
          declarations.push(declaration); themeDefinitions.add(key);
        }
      }
    }
    if (declarations.length) additions.push(`:root[data-theme="${theme}"] .k{${declarations.join(";")}}`);
  }
  writeFileSync(file, `${base}\n\n${CSS_MARK}\n${additions.join("\n")}\n`);
  return additions.length;
}

const canonical = (s) => drawing(s).replace(/<!--.*?-->/gs, "").replace(/ tabindex="0"/g, "").replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

function inventory(master, reportDir) {
  const previous = readdirSync("stories/proto").filter((f) => f.endsWith(".json")).flatMap((f) => Object.values(JSON.parse(readFileSync(join("stories/proto", f), "utf8"))).map((s) => canonical(s.html)));
  const rows = [];
  for (const m of master.matchAll(/<section class="board" id="([^"]+)">(.*?)<\/section>/gs)) {
    const [, id, body] = m;
    const title = text(/<h2>(.*?)<\/h2>/s.exec(body)[1]);
    const code = text(/<span class="no">(.*?)<\/span>/.exec(body)[1]);
    const frames = [];
    const tags = /<div class="[^"]*\bk\b[^"]*"[^>]*>/g;
    for (let k; (k = tags.exec(body)); ) {
      if (!/class="([^"]*)"/.exec(k[0])[1].split(/\s+/).includes("k")) continue;
      const end = closeOf(body, k.index);
      const inner = body.slice(k.index + k[0].length, end - 6);
      if (inner.trim()) frames.push(canonical(inner));
      tags.lastIndex = end;
    }
    const covered = frames.length > 0 && frames.every((frame) => previous.some((story) => story.includes(frame)));
    const folder = PANEL_CODES[code] ? `Panels/${PANEL_CODES[code]}` : FOLDERS[code] ?? (id.startsWith("sidebar-") ? "Compositions/Sidebar rows" : null);
    if (!folder) throw new Error(`No inventory folder for ${id}`);
    rows.push({ id, title, folder, covered, frames: frames.length });
  }
  if (rows.length !== 95) throw new Error(`Expected 95 sections, found ${rows.length}`);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "boards.md"), `# Drawing coverage before the panel import\n\nCoverage compares complete drawn frames against existing JSON markup, ignoring theme classes, whitespace and added keyboard focus attributes. A matching primitive or a matching title does not cover a full frame. Yes means every frame is present. No-frame reference tables are marked no; they are not missing panel states. Folders describe the content's home; the updated source limits this import to the supplied 280 panel stories.\n\n| Id | Title | Folder | Covered |\n| --- | --- | --- | --- |\n${rows.map((r) => `| ${r.id} | ${r.title.replaceAll("|", "\\|")} | ${r.folder} | ${r.covered ? "yes" : "no"} |`).join("\n")}\n\nTotal: ${rows.length}; covered before: ${rows.filter((r) => r.covered).length}; reference sections without drawn frames: ${rows.filter((r) => !r.frames).map((r) => r.id).join(", ")}.\n`);
  return rows;
}

export function generate(sourceDir, masterPath, notesPath, reportDir) {
  const sources = ["a", "b", "c"].map((part) => readFileSync(join(sourceDir, `kanso-sb-panels-${part}.html`), "utf8"));
  const entries = sources.flatMap(entriesOf);
  const expected = [...readFileSync(join(sourceDir, "panel-stories.md"), "utf8").matchAll(/^- /gm)].length;
  if (entries.length !== expected || expected !== 280) throw new Error(`Expected 280 states, found ${entries.length}, listed ${expected}`);
  const notes = new Map(readFileSync(notesPath, "utf8").split(/^## /m).slice(1).map((part) => [part.split(" ")[0], part.slice(part.indexOf("\n") + 1).trim()]));
  const pages = new Map();
  const firstScreen = {};
  for (const entry of entries) {
    const page = pageFor(entry, firstScreen);
    if (!pages.has(page)) pages.set(page, { stories: {}, codes: new Set() });
    const dest = pages.get(page);
    dest.codes.add(entry.code);
    let state = clean(entry.title);
    if (entry.code === "P17" && entry.title.includes(" · rows")) state = "At rest, comparison";
    if (entry.code === "P17" && state === "Before") state = "Before";
    const context = CONTEXT[entry.code];
    if (entry.code === "P17" && state === "Before") state = "At rest, Before";
    if (state === "Now, at rest") state = "At rest, Now";
    if (state === "Now, light") state = "At rest, Now, light";
    if (entry.code === "P17" && /^Now, pointer/.test(state)) state = "On the pointer";
    let name = `${page}, ${context ? `${context}, ` : ""}${state}`;
    let key = identifier(name);
    let alternate = 1;
    while (dest.stories[key]) { alternate++; key = `${identifier(name)}${alternate}`; }
    if (alternate > 1) name += `, alternate ${alternate}`;
    const before = entry.code === "P17" && (state === "At rest, Before" || state === "At rest, comparison");
    dest.stories[key] = { name, caption: `${before ? "The previous design is kept as a reference beside the current design. " : ""}${clean(entry.title)}.`, html: drawing(entry.html), spec: specRows(entry.spec) };
  }
  mkdirSync(OUT, { recursive: true });
  const counts = {};
  for (const [page, { stories, codes }] of pages) {
    const file = slug(page);
    counts[page] = Object.keys(stories).length;
    writeFileSync(join(OUT, `${file}.json`), `${JSON.stringify(stories, null, 1)}\n`);
    writeFileSync(join(OUT, `${file}.stories.js`), `import stories from './${file}.json';\nimport { story } from '../proto/story.js';\n\nexport default { title: ${q(`Panels/${page}`)} };\n\n${Object.entries(stories).map(([key, s]) => `export const ${key} = { name: ${q(s.name)}, ...story(stories.${key}) };`).join("\n")}\n`);
    const canvases = Object.entries(stories).map(([key, s]) => `## ${mdx(s.name)}\n\n${mdx(s.caption)}\n\n<Canvas of={stories.${key}} />\n\n<table>\n<tbody>\n${s.spec.map(([label, value]) => `<tr><th>{${q(label)}}</th><td>{${q(value)}}</td></tr>`).join("\n")}\n</tbody>\n</table>`);
    const guidelines = [...codes].map((code) => {
      if (!notes.has(code)) throw new Error(`Missing guidelines for ${code}`);
      return mdx(notes.get(code));
    });
    writeFileSync(join(OUT, `${file}.mdx`), `import { Canvas, Meta } from '@storybook/addon-docs/blocks';\nimport * as stories from './${file}.stories.js';\n\n<Meta title=${q(`Panels/${page}`)} />\n\n# ${page}\n\n${DESCRIPTIONS[page]}\n\n${canvases.join("\n\n")}\n\n${guidelines.join("\n\n")}\n\n## Prompt for agents\n\n\`\`\`text\nBuild ${page} for kansō from the states and specifications above. Use the shared tokens and kit primitives. Preserve the drawn geometry, content, state transitions and principle-tagged guidelines. Keep each action available in its documented context.\n\`\`\`\n`);
  }
  const master = readFileSync(masterPath, "utf8");
  const css = addCss(sources, entries.map((e) => e.html).join(""));
  const rows = inventory(master, reportDir);
  const summary = { boards: rows.length, coveredBefore: rows.filter((r) => r.covered).length, stories: entries.length, counts, cssRules: css };
  writeFileSync(join(reportDir, "import-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceDir, masterPath, notesPath, reportDir] = process.argv.slice(2);
  if (!sourceDir || !masterPath || !notesPath || !reportDir) throw new Error("usage: node scripts/import-panels.mjs <panel-source-dir> <master.html> <board-notes.md> <report-dir>");
  console.log(JSON.stringify(generate(sourceDir, masterPath, notesPath, reportDir), null, 2));
}

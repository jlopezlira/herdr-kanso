#!/usr/bin/env node
// Usage: node scripts/import-approved.mjs <approved-master.html>.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renameMarkup, renameCss } from "./import-proto.mjs";
import { expand, replaceSource } from "./storybook-catalog.mjs";
import { markupElements, referenceText, textOf } from "./storybook-markup.mjs";
import { normalizeComponent, COMPONENT_CSS } from "./storybook-components.mjs";
import { selectorCoverage, selectorList } from "./storybook-selectors.mjs";
import { cssBlocks, normalizeCss } from "./storybook-css.mjs";

const withoutNavigation = (css) => cssBlocks(css).flatMap((rule) => {
  const brace = rule.indexOf("{"), selector = rule.slice(0, brace);
  if (/^@(media|supports|layer)\b/.test(selector)) {
    const nested = withoutNavigation(rule.slice(brace + 1, -1));
    return nested ? `${selector}{${nested}}` : [];
  }
  return selector.includes("kanso-prototype__sidebar") ? [] : [rule];
}).join("\n");
export const sharedThemeCss = (css) => cssBlocks(css).flatMap((rule) => {
  const brace = rule.indexOf("{"), selector = rule.slice(0, brace);
  let body = rule.slice(brace + 1, -1);
  if (/^@(media|supports|layer)\b/.test(selector)) {
    const nested = sharedThemeCss(body);
    return nested ? `${selector}{${nested}}` : [];
  }
  if (/\.kanso-story--(?:dark|light)\b/.test(selector)) body = body.split(";").filter((declaration) => !/^\s*--[\w-]+\s*:/.test(declaration)).join(";");
  if (selector.includes("kanso-prototype__theme-control")) {
    const colors = { "#6b6862": "dim", "#272725": "border", "#1f1f1d": "border", "#bdb8ad": "muted", "#d8d4cb": "fg" };
    body = body.replace(/#[\da-f]{3,8}\b/gi, (color) => colors[color.toLowerCase()] ? `var(--${colors[color.toLowerCase()]})` : color);
  }
  if (selector.includes(".kanso-story--light .kanso-dojo__mascot")) return [];
  return body.trim() ? `${selector}{${body}}` : [];
}).join("\n");
export function additionalCss(existing, incoming) {
  const known = new Set();
  const visit = (css, context = "", collect = false) => cssBlocks(css).flatMap((rule) => {
    const brace = rule.indexOf("{"), selector = rule.slice(0, brace), body = rule.slice(brace + 1, -1);
    if (/^@(media|supports|layer)\b/.test(selector)) {
      const nested = visit(body, `${context}|${selector}`, collect);
      return nested ? `${selector}{${nested}}` : [];
    }
    const selectors = selector.startsWith("@") ? [selector] : selectorList(selector);
    if (!collect) { selectors.forEach((selector) => known.add(`${context}|${selector}`)); return []; }
    const missing = selectors.filter((selector) => !known.has(`${context}|${selector}`));
    missing.forEach((selector) => known.add(`${context}|${selector}`));
    return missing.length ? `${missing.join(",")}{${body}}` : [];
  }).join("\n");
  visit(existing);
  return visit(incoming, "", true);
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const themed = (node) => node.classes.some((name) => ["k-dark", "k-light"].includes(name));
const hasParent = (node, predicate) => { for (let parent = node.parent; parent; parent = parent.parent) if (predicate(parent)) return true; return false; };

export function approvedDrawings(master, board) {
  const start = master.indexOf(`<section class="board" id="${board.anchor}">`);
  if (start < 0) throw new Error(`Missing approved reference: ${board.code}`);
  const next = master.indexOf('<section class="board"', start + 20);
  const section = master.slice(start, next < 0 ? master.indexOf("</section>", start) + 10 : next);
  const nodes = markupElements(section);
  const frames = nodes.filter((node) => themed(node) && !hasParent(node, themed));
  const tables = nodes.filter((node) => node.tag === "table" && !hasParent(node, themed));
  const drawings = [...frames, ...tables].sort((a, b) => a.start - b.start).map((node, index) => {
    const previous = nodes.filter((item) => item.end <= node.start && item.classes.includes("cap")).at(-1);
    const caption = referenceText(previous ? textOf(section.slice(previous.open, previous.close)) : board.title);
    const source = section.slice(node.start, node.end);
    if (node.end === node.open) throw new Error(`Unclosed drawing: ${board.code}/${index}`);
    return { source, caption, theme: node.classes.includes("k-light") ? "light" : node.classes.includes("k-dark") ? "dark" : "both", hash: hash(source) };
  });
  if (!drawings.length) throw new Error(`No drawings: ${board.code}`);
  const notes = nodes.filter((node) => node.tag === "aside" && node.classes.includes("notes"));
  const guidelines = notes.flatMap((aside) => nodes.filter((node) => node.start > aside.open && node.end < aside.close && ["li", "p"].includes(node.tag)).map((node) => referenceText(textOf(section.slice(node.open, node.close)))));
  return { drawings, guidelines, hash: hash(section) };
}

export function importApproved(file, root = ".") {
  const master = readFileSync(file, "utf8");
  const references = JSON.parse(readFileSync(`${root}/stories/references.json`, "utf8"));
  const controlStart = master.indexOf('<section class="board" id="control">');
  const controlEnd = master.indexOf("</section>", controlStart);
  const control = master.slice(controlStart, controlEnd + 10);
  const approved = new Set([...control.matchAll(/<tr><td class="no">([^<]+)<\/td>([\s\S]*?)<\/tr>/g)].filter((match) => /<span class="st st-ok"><i><\/i>Approved<\/span>/.test(match[2])).map((match) => match[1]));
  if (approved.size !== 94 || references.boards.length !== 94 || references.boards.some((board) => !approved.has(board.code))) throw new Error("Approved reference inventory differs from the control table");
  const retained = expand(JSON.parse(readFileSync(`${root}/stories/catalog.json`, "utf8"))).filter((record) => record.source === "proto" && !record.approvedBoard);
  const records = [], evidence = [];
  for (const board of references.boards) {
    const reference = references.pages.find((page) => page.page === board.page);
    const extracted = approvedDrawings(master, board);
    const owner = reference.components[0] ?? "Compositions/State patterns";
    const ids = extracted.drawings.map((drawing, index) => {
      const id = `proto/approved-${board.anchor}/Reference/${index + 1}`;
      const linked = renameMarkup(drawing.source).replace(/<a\b([^>]*?)href="#([^"]+)"([^>]*)>/g, (match, before, anchor, after) => {
        const target = references.boards.find((item) => item.anchor === anchor);
        const slug = target?.page.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return target ? `<a class="kanso-reference__link"${before}href="./?path=/docs/${slug}--${target.page.startsWith("Start/") || !references.pages.find((item) => item.page === target.page)?.existing ? "docs" : "overview"}"${after}>` : match;
      });
      const normalized = normalizeComponent({ id, source: "proto", page: owner, label: `${board.title} · ${drawing.caption} · ${drawing.theme} ${index + 1}`, caption: drawing.caption, html: `<section class="kanso-story" data-reference-board="${board.anchor}">${linked}</section>`, approvedBoard: board.code, referenceTheme: drawing.theme, sourceHash: drawing.hash });
      records.push({ ...normalized, drawingHash: hash(normalized.html) });
      return id;
    });
    reference.records = [...ids, ...reference.records.filter((id) => !id.startsWith("proto/approved-"))];
    reference.components = [...new Set([owner, ...reference.components])];
    reference.approvedRecords = ids;
    reference.status = "Approved reference";
    if (extracted.guidelines.length) reference.guidelines = extracted.guidelines;
    reference.sourceHash = extracted.hash;
    evidence.push({ code: board.code, page: board.page, result: "fixed", sourceHash: extracted.hash, drawings: ids.length, states: ids });
  }
  for (const reference of references.pages.filter((page) => page.boards.length && !references.boards.some((board) => board.page === page.page))) {
    const ids = reference.boards.flatMap((code) => evidence.find((board) => board.code === code)?.states ?? []);
    reference.approvedRecords = [...new Set(ids)];
    reference.records = [...reference.approvedRecords, ...reference.records.filter((id) => !id.startsWith("proto/approved-"))];
    reference.components = [...new Set([...records.filter((record) => ids.includes(record.id)).map((record) => record.page), ...reference.components])];
    reference.status = ids.length ? "Approved reference" : "Proposed";
  }
  references.masterHash = hash(master);
  const masterCss = [...master.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
  const approvedCss = cssBlocks(masterCss).filter((rule) => !rule.includes(".kanso-spend-") && !rule.includes(".ks-nav") && !/^(?:body|html|:root\{color-scheme|img\{|\[hidden\])/.test(rule)).join("\n");
  const currentCss = sharedThemeCss(withoutNavigation(readFileSync(`${root}/stories/proto.css`, "utf8")));
  const missingCss = additionalCss(currentCss, normalizeCss(sharedThemeCss(withoutNavigation(renameCss(approvedCss))).replace(/section\[id\^=/g, "section[data-reference-board^=").replace(/#(pr-light|pr)(?=\s)/g, '[data-reference-board="$1"]')));
  const unused = new Set(selectorCoverage(missingCss, Object.fromEntries([...retained, ...records].filter((record) => record.html).map((record) => [record.id, record.html]))).unused);
  const usedCss = (text) => cssBlocks(text).flatMap((rule) => {
    const brace = rule.indexOf("{"), selector = rule.slice(0, brace), body = rule.slice(brace + 1, -1);
    if (/^@(media|supports|layer)\b/.test(selector)) {
      const nested = usedCss(body);
      return nested ? `${selector}{${nested}}` : [];
    }
    if (selector.startsWith("@")) return rule;
    const kept = selectorList(selector).filter((selector) => !unused.has(selector));
    return kept.length ? `${kept.join(",")}{${body}}` : [];
  }).join("\n");
  const css = normalizeCss(`${currentCss}\n${usedCss(missingCss)}\n${COMPONENT_CSS}`, { kit: true });
  writeFileSync(`${root}/stories/references.json`, `${JSON.stringify(references, null, 2).replaceAll("<", "\\u003c")}\n`);
  writeFileSync(`${root}/stories/proto.css`, css);
  replaceSource("proto", [...retained, ...records], root);
  return { boards: evidence.length, drawings: records.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(importApproved(process.argv[2])));

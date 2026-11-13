// Check approved source extraction and its named catalog placements.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { additionalCss, approvedDrawings, sharedThemeCss } from "../scripts/import-approved.mjs";
import { cleanText, expand } from "../scripts/storybook-catalog.mjs";
import { normalizeComponent } from "../scripts/storybook-components.mjs";
import { markupElements, textOf } from "../scripts/storybook-markup.mjs";
import { cssBlocks } from "../scripts/storybook-css.mjs";
import references from "../stories/references.json" with { type: "json" };
import alignment from "../stories/ALIGNMENT.json" with { type: "json" };

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const records = expand(JSON.parse(read("stories/catalog.json")));
const byId = new Map(records.map((record) => [record.id, record]));
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("Public reference guidance describes roles instead of named sample sessions", () => {
  const prose = [...references.pages.flatMap((page) => page.guidelines ?? []), ...records.flatMap((record) => record.notes ?? [])].join("\n");
  assert.doesNotMatch(prose, /\b[\w-]+'s \+ and [\w-]+'s ⋯ are not drawn at rest/);
  assert.doesNotMatch(prose, /\([^(),]+, after the unified menu\)/);
  assert.doesNotMatch(prose, /Drawn at Only when needed: [^.]+ works and [^.]+ waits/);
  assert.doesNotMatch(prose, /(?:Tab bar|app\.settings) \([A-Z][a-z]+\)|no \?, [A-Z][a-z]+\)|\b[A-Z][a-z]+'s (?:pax-|markup)/);
});

test("Imported reference drawings inherit the shared theme instead of competing palettes", () => {
  const check = (css) => {
    for (const rule of cssBlocks(css)) {
      const brace = rule.indexOf("{"), selector = rule.slice(0, brace), body = rule.slice(brace + 1, -1);
      if (/^@(media|supports|layer)\b/.test(selector)) { check(body); continue; }
      if (/\.kanso-story--(?:dark|light)\b/.test(selector)) assert.doesNotMatch(body, /(?:^|;)\s*--[\w-]+\s*:/, selector);
      if (/kanso-prototype__theme-control|\.kanso-story--(?:dark|light)\b/.test(selector)) assert.doesNotMatch(body, /#[\da-f]{3,8}\b/i, selector);
    }
  };
  check(read("stories/proto.css"));
});

test("Regeneration cleans reference prose and uses semantic colors without losing layout rules", () => {
  const prose = "demo's + and Sample's ⋯ are not drawn at rest. (Sample, after the unified menu) Drawn at Only when needed: Sample works and Another waits, so they show a second line.";
  const source = `<section class="board" id="sample"><div class="k k-dark">Session</div><aside class="notes"><ul><li>${prose}</li></ul></aside></section>`;
  const expected = "project and session row actions are not drawn at rest. (after the unified menu) At Only when needed, working and waiting sessions show a second line.";
  assert.equal(cleanText(prose), expected);
  assert.equal(cleanText("Tab bar (Sample): app.settings (Sample), (the tab bar keeps no gear and no ?, Sample). (Sample's pax-fail) editor conflict, Sample's markup:"), "Tab bar: app.settings, (the tab bar keeps no gear and no ?). (pax-fail) editor conflict:");
  assert.deepEqual(approvedDrawings(source, { code: "S", anchor: "sample", title: "Sessions" }).guidelines, [expected]);
  const input = ".kanso-story--light{--input:#817b72;padding:8px}.kanso-story--light{--input:#d4cec4}@media (width > 1px){.kanso-story--dark{--fg:#d8d4cb}}.kanso-prototype__theme-control td{color:#bdb8ad;border-bottom:1px solid #1f1f1d}.kanso-prototype__theme-control th{color:#6b6862;border-bottom:1px solid #272725}.kanso-prototype__theme-control td a{color:#d8d4cb}";
  const output = sharedThemeCss(input);
  assert.equal(output, ".kanso-story--light{padding:8px}\n.kanso-prototype__theme-control td{color:var(--muted);border-bottom:1px solid var(--border)}\n.kanso-prototype__theme-control th{color:var(--dim);border-bottom:1px solid var(--border)}\n.kanso-prototype__theme-control td a{color:var(--fg)}");
  assert.equal(sharedThemeCss(output), output);
  assert.equal(additionalCss(output, sharedThemeCss(input)), "");
  assert.equal(sharedThemeCss(".kanso-story--light .kanso-dojo__mascot .kanso-mascot__pixel--eye{background:#161615}"), "");
});

test("Approved references retain every imported drawing and its source comparison", () => {
  assert.equal(alignment.boards.length, 94);
  assert.equal(alignment.masterHash, references.masterHash);
  assert.equal(new Set(alignment.boards.map((board) => board.code)).size, 94);
  let count = 0;
  for (const board of alignment.boards) {
    const page = references.pages.find((page) => page.page === board.page);
    assert.equal(board.result, "fixed", board.code);
    assert.equal(board.sourceHash, page.sourceHash, board.code);
    assert.deepEqual(board.states, page.approvedRecords, board.code);
    assert.equal(board.drawings, board.states.length, board.code);
    for (const id of board.states) {
      const drawing = byId.get(id);
      assert.equal(drawing.approvedBoard, board.code, id);
      assert.equal(hash(drawing.html), drawing.drawingHash, id);
      assert.equal(normalizeComponent(drawing).html, drawing.html, id);
      assert.match(drawing.sourceHash, /^[a-f0-9]{64}$/, id);
      count++;
    }
  }
  assert.equal(count, 455);
  assert.ok(records.every((record) => !/^Q4[a-e]$/.test(record.approvedBoard ?? "")));
});

test("Reference extraction keeps nested states, both themes and the exact values", () => {
  const source = '<section class="board" id="sample"><div class="bh">Sample</div><div class="bg"><div><p class="cap">Four panes</p><div class="k k-dark"><div class="stage">claude --model opus</div><div class="stage">pnpm dev · 30 · 13.5</div></div><div class="k k-light"><div class="stage">claude --model opus</div></div></div><aside class="notes"><ul><li>Keep every option.</li></ul></aside></div></section><section class="board" id="excluded"><div class="k k-dark">Never import</div></section>';
  const result = approvedDrawings(source, { code: "D7", anchor: "sample", title: "Arrangements" });
  assert.equal(result.drawings.length, 2);
  assert.deepEqual(result.drawings.map((drawing) => drawing.theme), ["dark", "light"]);
  assert.deepEqual(result.guidelines, ["Keep every option."]);
  assert.match(result.drawings[0].source, /claude --model opus/);
  assert.match(result.drawings[0].source, /pnpm dev · 30 · 13.5/);
  assert.doesNotMatch(result.drawings[1].source, /Never import/);
  assert.throws(() => approvedDrawings(source, { anchor: "absent" }), /Missing approved/);
});

test("Arrangements show the captured columns, commands and all list states", () => {
  const drawings = records.filter((record) => record.approvedBoard === "D7");
  assert.equal(drawings.length, 2);
  const html = drawings[0].html;
  for (const words of ["Opens in acme-shop", "review pair", "i18n", "docs-site", "Save this tab", "checkout and docs", "claude --model opus", "pnpm dev", "Press again to overwrite", "database is locked"]) assert.ok(textOf(html).includes(words), words);
  assert.ok(markupElements(html).filter((node) => node.classes.includes("kanso-story__stage")).length >= 7);
});

test("Every unmatched predicate is explicitly Proposed on its own named feature page", () => {
  const predicates = references.pages.flatMap((page) => page.proposedPredicates ?? []);
  assert.equal(predicates.length, 130);
  assert.equal(new Set(predicates.map((predicate) => predicate.id)).size, 130);
  for (const page of references.pages) {
    for (const predicate of page.proposedPredicates ?? []) {
      const feature = byId.get(predicate.id);
      assert.equal(feature.location, predicate.location);
      assert.ok(page.features.includes(predicate.id.split("/").slice(0, 3).join("/")), predicate.id);
      assert.ok(page.records.includes(feature.design ?? feature.id), predicate.id);
    }
  }
  assert.match(read("stories/kit/ReferencePage.jsx"), /<h2>Proposed states<\/h2>/);
});

test("Approved drawings use only symbols in the shared icon and mark sprite", () => {
  const symbols = new Set([...read("stories/proto-sprite.svg").matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  for (const drawing of records.filter((record) => record.approvedBoard)) {
    for (const match of drawing.html.matchAll(/(?:href|xlink:href)="#([^"]+)"/g)) assert.ok(symbols.has(match[1]), `${drawing.id}: ${match[1]}`);
  }
});

test("Reimported selector groups keep existing kit values and add each missing selector once", () => {
  const existing = ".one{gap:8px}@media (width > 1px){.one{color:red}}";
  const incoming = ".one,.two{gap:16px}@media (width > 1px){.one,.three{color:blue}}";
  const added = additionalCss(existing, incoming);
  assert.equal(added, ".two{gap:16px}\n@media (width > 1px){.three{color:blue}}");
  assert.equal(additionalCss(existing + added, incoming), "");
  assert.equal(additionalCss(existing, "@media (width > 1px){}"), "");
});

// Check approved source extraction and its named catalog placements.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { additionalCss, approvedDrawings } from "../scripts/import-approved.mjs";
import { expand } from "../scripts/storybook-catalog.mjs";
import { normalizeComponent } from "../scripts/storybook-components.mjs";
import { markupElements, textOf } from "../scripts/storybook-markup.mjs";
import references from "../stories/references.json" with { type: "json" };
import alignment from "../stories/ALIGNMENT.json" with { type: "json" };

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const records = expand(JSON.parse(read("stories/catalog.json")));
const byId = new Map(records.map((record) => [record.id, record]));
const hash = (value) => createHash("sha256").update(value).digest("hex");

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

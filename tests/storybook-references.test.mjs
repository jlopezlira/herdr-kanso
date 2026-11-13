// Check named entry points without duplicating component drawings.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import references from "../stories/references.json" with { type: "json" };
import { records } from "../stories/kit/catalog.js";
import { referenceFor, referenceStates } from "../stories/kit/references.js";
import { generateReferences, referenceSlug } from "../scripts/storybook-references.mjs";

test("Every approved reference is reachable by its own name", () => {
  assert.equal(references.boards.length, 94);
  assert.equal(new Set(references.boards.map((board) => board.code)).size, 94);
  for (const board of references.boards) {
    assert.equal(board.page.split("/")[1], board.title, board.code);
    assert.ok(referenceFor(board.page)?.boards.includes(board.code), board.code);
    assert.doesNotMatch(board.code, /^Q4[a-e]$/);
  }
  for (const name of ["Open with", "Sleep", "Arrangements", "Send to an agent", "Share", "Find", "Agent rows"]) {
    assert.ok(references.pages.some((page) => page.page.split("/")[1] === name), name);
  }
});

test("Named features reuse selectable catalog states and keep proposals distinct from approvals", () => {
  const coverage = records.filter((record) => record.source === "coverage");
  const groups = new Set(coverage.map((record) => record.id.split("/").slice(0, 3).join("/")));
  const routed = references.pages.flatMap((page) => page.features);
  assert.deepEqual(new Set(routed), groups);
  assert.equal(routed.length, groups.size);
  assert.equal(new Set(references.pages.map((page) => page.page)).size, references.pages.length);
  for (const page of references.pages) {
    const states = referenceStates(page.page);
    assert.equal(states.length, page.records.length, page.page);
    assert.deepEqual(new Set(states.map((state) => state.id)), new Set(page.records), page.page);
    assert.equal(page.status === "Proposed", page.boards.length === 0, page.page);
    assert.ok(states.every((state) => records.includes(records.find((record) => record.id === state.id))));
  }
});

test("Reference generation keeps existing pages and removes only its obsolete entry points", () => {
  const root = mkdtempSync(join(tmpdir(), "kanso-reference-pages-"));
  try {
    mkdirSync(join(root, "stories/references"), { recursive: true });
    writeFileSync(join(root, "stories/references.json"), JSON.stringify(references));
    const keep = join(root, "stories/references/local-notes.mdx");
    writeFileSync(keep, "Local notes\n");
    const count = generateReferences(root);
    assert.equal(count, references.pages.filter((page) => !page.existing).length);
    for (const page of references.pages.filter((page) => !page.existing)) {
      const file = join(root, `stories/references/${referenceSlug(page.page)}.mdx`);
      const text = readFileSync(file, "utf8");
      assert.ok(text.includes(`<Meta title=${JSON.stringify(page.page)} />`));
      assert.ok(text.includes(`<ReferencePage page=${JSON.stringify(page.page)} />`));
      assert.doesNotMatch(text, /<button|<svg|<div/);
    }
    writeFileSync(join(root, "stories/references.json"), JSON.stringify({ ...references, pages: [] }));
    assert.equal(generateReferences(root), 0);
    assert.deepEqual(readdirSync(join(root, "stories/references")), ["local-notes.mdx"]);
    assert.equal(readFileSync(keep, "utf8"), "Local notes\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

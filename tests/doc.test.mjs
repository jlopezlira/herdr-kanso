// A Markdown file in the side panel, edited where it reads: blocks that give
// the file back byte for byte, tables as cells, links, and saving that never
// overwrites a change made on disk meanwhile.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, context } from "./helpers.mjs";

const SAMPLE = `---
name: plan
---
# Plan

Fuentes: \`origin/develop\` 5b27af6
y una segunda línea.

| Estado | Cómo | Bloqueo |
|---|:---:|---:|
| trial | \`is_in_trial\` | no |
| grace | a \\| b | **false** |

- one
  continued
- two

> quoted
> more

\`\`\`js
const a = 1;

const b = 2;
\`\`\`
---
Last paragraph.
`;

test("a document splits into blocks that give it back byte for byte", async () => {
  const { parseBlocks, joinBlocks } = await load("kanso-panel/blocks.js", ["parseBlocks", "joinBlocks"]);
  const blocks = parseBlocks(SAMPLE);
  assert.equal(joinBlocks(blocks), SAMPLE);
  assert.deepEqual(clone(blocks.filter((b) => b.kind !== "blank").map((b) => b.kind)),
    ["front", "heading", "paragraph", "table", "list", "quote", "code", "rule", "paragraph"]);
  assert.equal(blocks.find((b) => b.kind === "code").lines.length, 5, "a blank line inside a fence stays in it");
  for (const text of ["", "\n", "plain", "a\n\n\nb\n", "# only\n", "| not | a table"]) assert.equal(joinBlocks(parseBlocks(text)), text);
});

test("a table reads as cells and prints back, with its alignment", async () => {
  const { parseBlocks, parseTable, tableLines } = await load("kanso-panel/blocks.js", ["parseBlocks", "parseTable", "tableLines"]);
  const table = parseTable(parseBlocks(SAMPLE).find((b) => b.kind === "table").lines);
  assert.deepEqual(clone(table.head), ["Estado", "Cómo", "Bloqueo"]);
  assert.deepEqual(clone(table.align), [null, "center", "right"]);
  assert.deepEqual(clone(table.rows[1]), ["grace", "a | b", "**false**"], "an escaped pipe is part of the cell");
  table.rows.push(["expired", "x", "yes"]);
  assert.deepEqual(clone(tableLines(table)), [
    "| Estado | Cómo | Bloqueo |", "| --- | :---: | ---: |",
    "| trial | `is_in_trial` | no |", "| grace | a \\| b | **false** |", "| expired | x | yes |"]);
});

test("a heading is edited without its marks", async () => {
  const { headingOf, headingLine } = await load("kanso-panel/blocks.js", ["headingOf", "headingLine"]);
  assert.deepEqual(clone(headingOf("### Estados de plan")), { level: 3, text: "Estados de plan" });
  assert.equal(headingLine(3, "Estados\nde plan "), "### Estados de plan");
});

test("front matter reads as a code block, the rest as written", async () => {
  const { readable } = await load("kanso-panel/doc.js", ["readable"]);
  assert.equal(readable("---\nname: plan\nmodel: opus\n---\n# Plan\n"), "```yaml\nname: plan\nmodel: opus\n```\n\n# Plan\n");
  assert.equal(readable("# Title\n\n---\n\ntext"), "# Title\n\n---\n\ntext", "a rule further down is a rule");
});

test("links go to the web, or to a file beside the document", async () => {
  const { linkTarget } = await load("kanso-panel/doc.js", ["linkTarget"]);
  const doc = "/repo/docs/guide/README.md";
  assert.deepEqual(clone(linkTarget("https://example.com/a", doc)), { web: "https://example.com/a" });
  assert.deepEqual(clone(linkTarget("setup.md", doc)), { file: "/repo/docs/guide/setup.md" });
  assert.deepEqual(clone(linkTarget("../../CHANGELOG.md#2.2.0", doc)), { file: "/repo/CHANGELOG.md" });
  assert.deepEqual(clone(linkTarget("./My%20Notes.md", doc)), { file: "/repo/docs/guide/My Notes.md" });
  assert.equal(linkTarget("vscode://file/x", doc), null);
});

// A host where typing into a block, the autosave timer and the disk can be driven.
async function fixture(initial) {
  const disk = { text: initial };
  const timers = [];
  const states = [];
  const state = (o) => {
    let v = o?.value ?? ""; const on = {};
    const s = { value: () => v, set_value: (x) => { v = x; }, on: (n, f) => { on[n] = f; }, type(x, cx) { v = x; on.change?.({}, cx); },
      set_auto_grow() {}, focus() {}, release() { s.released = true; } };
    states.push(s); return s;
  };
  const blocks = await load("kanso-panel/blocks.js", ["parseBlocks", "joinBlocks", "headingOf", "headingLine", "parseTable", "tableLines"]);
  const { MarkdownDoc } = await load("kanso-panel/doc.js", ["MarkdownDoc"], {
    ...blocks,
    readTextFile: async () => disk.text,
    writeTextFile: async (_p, text, expected) => { if (expected !== disk.text) throw new Error("stale"); disk.text = text; return null; },
    TextareaState: { new: state }, EditorState: { new: state },
    theme: () => ({}), settings: () => ({}), home: () => "/Users/me",
  });
  const { cx, drain } = context();
  cx.timer = { after: (_ms, f) => timers.push(f) };
  const tick = async () => { while (timers.length) timers.shift()(cx); await drain(); };
  const doc = new MarkdownDoc("/repo/PLAN.md", null);
  doc.load(cx); await drain();
  return { doc, disk, cx, drain, tick, states };
}

test("a click opens one block; what you type is saved by itself", async () => {
  const { doc, disk, cx, tick } = await fixture("# Plan\n\nFirst.\n");
  const at = doc.blocks.findIndex((b) => b.kind === "paragraph");
  doc.open(at, cx);
  doc.box.type("First, edited.\n\nAnd a new one.", cx);
  await tick();
  assert.equal(disk.text, "# Plan\n\nFirst, edited.\n\nAnd a new one.\n");
  doc.close();
  assert.equal(doc.blocks.filter((b) => b.kind === "paragraph").length, 2, "an empty line makes two paragraphs");

  doc.open(0, cx);
  assert.equal(doc.box.value(), "Plan", "the heading without its #");
  doc.box.type("Plan v2", cx);
  await tick();
  assert.match(disk.text, /^# Plan v2\n/);

  doc.close();
  doc.append(cx);
  doc.box.type("Appended.", cx);
  await tick();
  assert.match(disk.text, /\n\nAppended\.\n$/, "a new paragraph at the end, and the file still ends with a newline");
});

test("a table is edited as cells, rows and columns", async () => {
  const { doc, disk, cx, tick } = await fixture("| A | B |\n|---|---|\n| 1 | 2 |\n");
  doc.open(0, cx);
  doc.cells.rows[0][1].type("two", cx);
  doc.reshape((tb) => { tb.rows.push(["", ""]); }, cx);
  doc.cells.rows[1][0].type("3", cx);
  doc.reshape((tb) => { tb.head.push("C"); tb.align.push(null); tb.rows.forEach((r) => r.push("")); }, cx);
  await tick();
  assert.equal(disk.text, "| A | B | C |\n| --- | --- | --- |\n| 1 | two |  |\n| 3 |  |  |\n");
});

test("a change on disk while you edit is never overwritten: you choose", async () => {
  const { doc, disk, cx, drain, tick } = await fixture("One.\n");
  doc.open(0, cx);
  doc.box.type("Mine.", cx);
  disk.text = "An agent's.\n";
  await tick();
  assert.equal(disk.text, "An agent's.\n", "the save is refused");
  assert.equal(doc.conflict, true);
  doc.takeTheirs(cx);
  assert.equal(doc.text, "An agent's.\n");
  assert.equal(doc.dirty, false);

  doc.open(0, cx);
  doc.box.type("Mine again.", cx);
  disk.text = "The agent again.\n";
  doc.load(cx); await drain();
  assert.equal(doc.conflict, true, "read while yours is unsaved: the choice, not a silent replace");
  doc.keepMine(cx); await drain();
  assert.equal(disk.text, "Mine again.\n");
  assert.equal(doc.dirty, false);
});

test("a file on another computer can be edited", async () => {
  const { MarkdownDoc } = await load("kanso-panel/doc.js", ["MarkdownDoc"]);
  const doc = new MarkdownDoc("/x.md", "server");
  doc.saved = doc.text = "x";
  assert.equal(doc.canEdit, true);
  assert.equal(doc.big, false);
});

test("an edit you leave comes back when you open the file again", async () => {
  const disk = { text: "One.\n" };
  const { MarkdownDoc } = await load("kanso-panel/doc.js", ["MarkdownDoc"], {
    readTextFile: async () => disk.text,
    writeTextFile: async (_p, text, expected) => { if (expected !== disk.text) throw new Error("stale"); disk.text = text; return null; },
    TextareaState: { new: (o) => { let v = o?.value ?? ""; const on = {}; return { value: () => v, set_value: (x) => { v = x; }, on: (n, f) => { on[n] = f; }, type(x, cx) { v = x; on.change?.({}, cx); }, set_auto_grow() {}, focus() {}, release() {} }; } },
    EditorState: { new: () => ({}) },
    theme: () => ({}), settings: () => ({}), home: () => "/Users/me",
  });
  const { cx, drain } = context();
  cx.timer = { after() {} };
  const doc = new MarkdownDoc("/repo/PLAN.md", null);
  doc.load(cx); await drain();
  doc.open(0, cx);
  doc.box.type("Changed.", cx);
  const again = new MarkdownDoc("/repo/PLAN.md", null);
  again.load(cx); await drain();
  assert.equal(again.text, "Changed.\n");
  assert.equal(again.dirty, true);
  assert.equal(again.conflict, false);
  const other = new MarkdownDoc("/repo/OTHER.md", null);
  other.load(cx); await drain();
  assert.equal(other.text, "One.\n");
});

test("the standalone panel lists a folder's Markdown, shallowest first", async () => {
  const { markdownIn } = await load("../../markdown-panel/mods/markdown-panel/main.js", ["markdownIn"]);
  assert.deepEqual(clone(markdownIn("docs/guide/setup.md\nREADME.md\nsrc/a.ts\ndocs/PLAN.md\nCHANGELOG.markdown\n")),
    ["CHANGELOG.markdown", "README.md", "docs/PLAN.md", "docs/guide/setup.md"]);
});

test("the standalone panel looks in the focused pane's machine and folder", async () => {
  const { placeOf } = await load("../../markdown-panel/mods/markdown-panel/main.js", ["placeOf"]);
  const list = [{ id: "s1", machine: null, folder: "/here" }, { id: "vps/s2", machine: "vps", folder: "" }];
  assert.deepEqual(clone(placeOf({ space: "vps/s2", cwd: "/srv/app" }, list, "/Users/me")), { on: "vps", folder: "/srv/app" });
  assert.deepEqual(clone(placeOf({ space: "vps/s2", cwd: null }, list, "/Users/me")), { on: "vps", folder: "" });
  assert.deepEqual(clone(placeOf({ space: "s1", cwd: null }, list, "/Users/me")), { on: null, folder: "/here" });
  assert.deepEqual(clone(placeOf(null, list, "/Users/me")), { on: null, folder: "/Users/me" });
});

test("the standalone panel lists the files the focused terminal mentioned, each once, at most 15", async () => {
  const { recentIn } = await load("../../markdown-panel/mods/markdown-panel/main.js", ["recentIn"]);
  const many = Array.from({ length: 20 }, (_, i) => `/p/${i}.md`).join("\n");
  assert.deepEqual(clone(recentIn("/a/plan.md\nrelative.md\n/a/x.ts\n/a/plan.md\n /b/notes.markdown \n")), ["/a/plan.md", "/b/notes.markdown"]);
  assert.equal(recentIn(many).length, 15);
  assert.deepEqual(clone(recentIn("")), []);
});

test("reviews still waiting are read one per md-review process, by its pid", async () => {
  const { reviewsIn } = await load("../../markdown-panel/mods/markdown-panel/main.js", ["reviewsIn"]);
  assert.deepEqual(clone(reviewsIn("101\t/a/plan.md\u0000102\t/a/plan.md\u0000x\t/b.md\u0000103\trelative.md\u0000")),
    [{ id: "101", path: "/a/plan.md" }, { id: "102", path: "/a/plan.md" }]);
  assert.deepEqual(clone(reviewsIn("")), []);
});

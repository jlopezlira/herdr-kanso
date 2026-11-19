// The card and code pieces: every state, drawn from the tokens, and the PR panel's cards drawn through them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, nodes, texts, calls, one, numberArguments, themed, KIT_NIGHT, drawingHost, svgsOf, drawn } from "./helpers.mjs";

const night = { ...KIT_NIGHT, ansi4: "#93a3b5", ansi5: "#ad9cab" };
const host = () => ({ ...drawingHost(), theme: () => night, settings: () => ({ font_family: "Berkeley Mono" }) });
const kit = async (extra = {}) => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "alpha", "G", "H", "R", "T", "LH", "CODE", "TINT", "ICON_INLINE"], { ...host(), ...extra }),
  ...await load("kanso-panel/ui-card.js", ["card"], { ...host(), ...extra }),
  ...await load("kanso-panel/ui-code.js", ["code", "sourceState"], { ...host(), ...extra }),
  ...await load("kanso-panel/pure.js", ["diffNumbers"]),
  ...await load("kanso-panel/ui-avatar.js", ["avatar"], { ...host(), ...extra }),
  app: await load("kanso-panel/kit.js", ["card", "code", "row"], { ...host(), ...extra }),
  body: await load("kanso-panel/pr-body.js", ["verdictBody"], { ...host(), ...extra }),
}, night);

const lineTexts = (el) => el.kids.map((line) => texts(line).at(-1));
const numbersOf = (el) => el.kids.map((line) => (line.kids.length > 1 ? texts(line.kids[0])[0] : undefined));
const DIFF = "@@ -10,3 +10,4 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;\n const d = 5;";

test("A card at rest is the author's avatar, name and age over its prose, on the canvas with the card radius and the tokens' padding", async () => {
  const { card, avatar, G, R, T, LH, c } = await kit();
  const el = card("k", c, { author: "sam", age: "1h", body: "Batches of 50, flushed every 2 s." });
  assert.equal(one(el, "id"), "k");
  assert.equal(one(el, "p"), G.md);
  assert.equal(one(el, "rounded"), R.card);
  assert.equal(one(el, "bg"), c.canvas);
  assert.deepEqual(texts(el), ["s", "sam", "1h", "Batches of 50, flushed every 2 s."], "the avatar's letter first");
  const [header, prose] = el.kids;
  assert.deepEqual(drawn(header.kids[0]), drawn(avatar(c, { initial: "sam", image: null })), "the md avatar of the author");
  assert.equal(one(prose, "line_height"), LH.body);
  assert.equal(one(prose, "text_size"), T.value);
});

test("A card loading is one breathing silhouette, two lines high", async () => {
  const { card, H, R, c } = await kit();
  const el = card("k", c, { author: "sam", loading: true });
  assert.equal(one(el, "h"), H.two);
  assert.equal(one(el, "rounded"), R.card);
  assert.equal(calls(el, "loop").length, 1);
  assert.deepEqual(texts(el), []);
});

test("A card without an avatar, with a step or with a path draws each beside the name", async () => {
  const { card, T, c } = await kit();
  const plain = card("k", c, { author: "CI / test", initial: "", body: "x" });
  assert.equal(nodes(plain).some((kid) => calls(kid, "rounded_full").length), false, "no avatar");
  const step = card("k", c, { author: "CI / test", initial: "", step: "Run tests", age: "1m 30s" });
  assert.deepEqual(svgsOf(step), ["mods/kanso-chrome/icons/chevron-right.svg"]);
  assert.deepEqual(texts(step).slice(0, 3), ["CI / test", "Run tests", "1m 30s"]);
  const where = card("k", c, { author: "ana", where: "src/api.js:12", body: "Why 50?" });
  const path = nodes(where).find((kid) => calls(kid, "child").some((call) => call[1] === "src/api.js:12"));
  assert.equal(one(path, "font_family"), "Berkeley Mono");
  assert.equal(one(path, "text_size"), T.mono);
});

test("A card's content takes the prose's place, each piece drawn under the card's id", async () => {
  const { app, code, c } = await kit();
  const el = app.card({ author: "CI", initial: "", content: [app.code({ text: "ok", kind: "log" })] })("k", c);
  assert.equal(el.kids.length, 2);
  assert.deepEqual(drawn(el.kids[1]), drawn(code("k-content-0", c, { text: "ok", kind: "log" })));
});

test("A diff numbers each line from its hunk, deleted lines by the old file, and washes added and deleted lines", async () => {
  const { code, diffNumbers, alpha, TINT, CODE, c } = await kit();
  assert.deepEqual([...diffNumbers(DIFF.split("\n"), 1)], [undefined, 10, 11, 11, 12, 13]);
  const el = code("d", c, { text: DIFF, kind: "diff" });
  assert.equal(el.kids.length, 6);
  assert.deepEqual(numbersOf(el), [undefined, "10", "11", "11", "12", "13"]);
  assert.deepEqual(lineTexts(el), ["@@ -10,3 +10,4 @@", "const a = 1;", "const b = 2;", "const b = 3;", "const c = 4;", "const d = 5;"]);
  assert.equal(one(el.kids[0], "bg"), c.w4, "the hunk on the 4% wash");
  assert.equal(one(el.kids[2], "bg"), alpha(c.blocked, TINT.diff));
  assert.equal(one(el.kids[3], "bg"), alpha(c.done, TINT.diff));
  assert.equal(calls(el.kids[1], "bg").length, 0);
  for (const line of el.kids) assert.equal(one(line, "h"), CODE.line);
});

test("A snippet numbers from its first line and puts the highlighted one on the 7% wash; a log has no numbers and marks its failures", async () => {
  const { code, c } = await kit();
  const snippet = code("s", c, { text: "a\nb\nc", kind: "snippet", first: 11, line: 12 });
  assert.deepEqual(numbersOf(snippet), ["11", "12", "13"]);
  assert.equal(one(snippet.kids[1], "bg"), c.w7);
  assert.equal(calls(snippet.kids[0], "bg").length, 0);
  const log = code("l", c, { text: "ok\nTypeError: boom\nFAIL no", kind: "log" });
  assert.deepEqual(numbersOf(log), ["", "", ""]);
  const tone = (line) => one(line.kids.at(-1), "text_color");
  assert.deepEqual(log.kids.map(tone), [c.text, c.blocked, c.blocked]);
});

test("A source is Herdr's editor in the terminal's mono, read only past its limit, and released by its owner", async () => {
  const made = [];
  const EditorState = { new: (options) => { const state = { options, on: (name, fn) => made.push([name, fn]), value: () => options.value }; return state; } };
  const { sourceState, T } = await kit({ EditorState });
  const small = sourceState("a.ts", "let a;", { limit: 100, readonly: false, onChange: () => {} });
  assert.equal(small.options.language, "js");
  assert.equal(small.options.readonly, false);
  assert.equal(small.options.font_family, "Berkeley Mono");
  assert.equal(small.options.font_size, T.value);
  assert.equal(made.length, 1, "an editable source reports its changes");
  const big = sourceState("a.md", "x".repeat(10), { limit: 4, readonly: false, onChange: () => {} });
  assert.equal(big.options.readonly, true);
  assert.equal(big.options.value, "xxxx\n… (file truncated)");
  assert.equal(made.length, 1, "a cut source is read only");
});

test("The PR panel's log, comment, running and checks cards are the kit's card with the props the verdict gives", async () => {
  const { app, body, c } = await kit();
  const log = { kind: "log", job: "CI / test", step: "Run", elapsed: "1m 30s", lines: ["line 1", "FAIL no"] };
  assert.deepEqual(drawn(body.verdictBody(c, log)), drawn(app.card({ author: "CI / test", initial: "", step: "Run", age: "1m 30s", content: [app.code({ text: "line 1\nFAIL no", kind: "log" })] })("pr-body", c)));
  const comment = { kind: "comment", author: "ana", letter: "A", path: "src/api.js", line: 12, text: "Why 50?" };
  assert.deepEqual(drawn(body.verdictBody(c, comment)), drawn(app.card({ author: "ana", initial: "A", where: "src/api.js:12", body: "Why 50?" })("pr-body", c)));
  const running = { kind: "running", rows: [{ name: "test", workflow: "CI", elapsed: "2m" }] };
  assert.deepEqual(drawn(body.verdictBody(c, running)), drawn(app.card({ content: [app.row({ name: "test", mark: "working", detail: "CI", meta: "2m" })] })("pr-body", c)));
  const checks = { kind: "checks", rows: [{ name: "lint", state: "pass" }, { name: "test", state: "fail" }] };
  assert.deepEqual(drawn(body.verdictBody(c, checks)), drawn(app.card({ content: [app.row({ name: "lint", meta: "passed" }), app.row({ name: "test", meta: "failed" })] })("pr-body", c)));
  assert.deepEqual(texts(body.verdictBody(c, { kind: "note", text: "Nothing to do." })), ["Nothing to do."]);
  assert.deepEqual(texts(body.verdictBody(c, { kind: "lines", lines: ["a", "", null, "b"] })), ["a", "b"]);
  assert.equal(body.verdictBody(c, null), null);
  assert.equal(body.verdictBody(c, { kind: "toString" }), null);
});

test("The kit's card and code take only handlers from the app", async () => {
  const { app, c } = await kit();
  assert.throws(() => app.card({ author: "sam" })("k", c, { body: "x" }), /only handlers, not body/);
  assert.throws(() => app.code({ text: "x" })("k", c, { kind: "log" }), /only handlers, not kind/);
});

test("The hand-drawn cards, the diff view and codeState are gone, and the pieces read every size from the tokens", () => {
  const read = (file) => readFileSync(new URL(`../kanso/mods/${file}`, import.meta.url), "utf8");
  const panel = ["pr-body.js", "pr.js", "pr-view.js", "lib.js", "preview.js"].map((file) => read(`kanso-panel/${file}`)).join("\n");
  for (const name of ["logCard", "commentCard", "runningCard", "checkCard", "verdictCard", "diffView", "diffRows", "codeState"]) assert.doesNotMatch(panel, new RegExp(`\\b${name}\\b`), name);
  assert.doesNotMatch(read("kanso-panel/pr-body.js"), /\bVIEW\b/);
  assert.deepEqual(numberArguments("kanso-panel/ui-card.js"), []);
  assert.deepEqual(numberArguments("kanso-panel/ui-code.js"), [".slice(1)"], "only the sign's one character is cut");
});

test("The sidebar's copies of the card and code are the panel's, byte for byte", () => {
  for (const name of ["ui-card.js", "ui-code.js"]) {
    const read = (mod) => readFileSync(new URL(`../kanso/mods/${mod}/${name}`, import.meta.url), "utf8");
    assert.equal(read("kanso-spaces"), read("kanso-panel"), `${name}: run npm run sync:share`);
  }
});

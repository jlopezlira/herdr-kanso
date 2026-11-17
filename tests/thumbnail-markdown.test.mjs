// The thumbnail and markdown pieces: every state their Storybook stories show, drawn from the tokens, and the panels drawn through them.
import test from "node:test";
import assert from "node:assert/strict";
import { load, nodes, calls, one, arg, chain, themed, KIT_NIGHT, drawingHost, numberArguments, repoText } from "./helpers.mjs";
import { thumbnail as storyThumbnail, markdown as storyMarkdown, markdownBlock as storyBlock } from "../stories/kit/pieces.js";
import { markdownBlocks } from "../kanso/mods/kanso-spaces/pure.js";

// Herdr's TextView, as a chain that keeps the Markdown it was given.
const textView = { markdown: (id, source) => { const el = chain("text"); el.calls.push(["markdown", id, source]); return el; } };
const host = () => ({ ...drawingHost(), TextView: textView });
const kit = async () => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "G", "H", "R", "T", "LH"], host()),
  ...await load("kanso-panel/ui-thumbnail.js", ["thumbnail"], host()),
  ...await load("kanso-panel/ui-markdown.js", ["markdown", "markdownBlock"], host()),
  app: await load("kanso-panel/kit.js", ["thumbnail", "markdown", "markdownBlock"], host()),
}, KIT_NIGHT);

const faceOf = (el) => el.kids[0];
const images = (el) => nodes(el).flatMap((kid) => calls(kid, "image").map((call) => call[1]));
const sources = (el) => nodes(el).flatMap((kid) => calls(kid, "markdown").map((call) => call[2]));
const SAMPLE = "# Rate limits\n\nEach customer gets a bucket.\n\n| Plan | Burst |\n| --- | --- |\n| Free | 10 |\n\n```sh\ncurl -i /api\n\nexit 0\n```\n\n- one\n- two";

test("A thumbnail at rest is a kit button: a square of the header's height with its edge on the raised ground, its name its tooltip", async () => {
  const { thumbnail, H, G, R, c } = await kit();
  const el = thumbnail("t", c, { label: "cart.png" });
  assert.equal(el.tag, "t", "a Button: Tab reaches it, Enter and Space press it");
  assert.equal(arg(el, "accessibility_label"), "cart.png");
  assert.equal(arg(el, "tooltip"), "cart.png");
  assert.ok(calls(el, "focus").length, "the focus ring");
  const face = faceOf(el);
  assert.deepEqual([one(face, "size"), one(face, "p"), one(face, "rounded"), one(face, "bg"), one(face, "border_color")], [H.row, G.hair, R.sm, c.raised, c.border]);
  assert.deepEqual(images(el), []);
  const story = storyThumbnail({ label: "cart.png", selected: false, loading: false });
  assert.match(story, /class="kanso-thumbnail"/);
  assert.match(story, /title="cart.png"/);
});

test("A thumbnail with a picture draws it; selected takes the accent ring; loading breathes as its own silhouette", async () => {
  const { thumbnail, c } = await kit();
  const drawnPicture = thumbnail("t", c, { image: "data/look/a.png", label: "a.png" });
  assert.deepEqual(images(drawnPicture), ["data/look/a.png"]);
  assert.match(storyThumbnail({ image: "a.png", label: "a.png", selected: false, loading: false }), /<img src="a.png"/);
  const rest = thumbnail("t", c, { label: "a.png" }), selected = thumbnail("t", c, { label: "a.png", selected: true });
  assert.notEqual(arg(rest, "border_color"), c.accent);
  assert.equal(arg(selected, "border_color"), c.accent, "the accent ring, as a focused control");
  assert.match(storyThumbnail({ label: "a.png", selected: true, loading: false }), /kanso-control--selected/);
  const loading = thumbnail("t", c, { image: "data/look/a.png", label: "a.png", loading: true });
  assert.equal(calls(faceOf(loading), "loop").length, 1);
  assert.equal(one(faceOf(loading), "bg"), c.border);
  assert.deepEqual(images(loading), [], "no picture while it loads");
  assert.match(storyThumbnail({ image: "a.png", label: "a.png", selected: false, loading: true }), /kanso-skeleton--shape/);
  assert.doesNotMatch(storyThumbnail({ image: "a.png", label: "a.png", selected: false, loading: true }), /<img/);
});

test("Proposed: a thumbnail not drawn yet shows the picture's own colour, in both kits", async () => {
  const { thumbnail, c } = await kit();
  assert.equal(one(faceOf(thumbnail("t", c, { label: "a.png", color: "#c45a3a" })), "bg"), "#c45a3a");
  const story = storyThumbnail({ label: "a.png", selected: false, loading: false, color: "var(--working)" });
  assert.match(story, /kanso-thumbnail--color/);
  assert.match(story, /data-color="var\(--working\)"/);
  assert.match(repoText("stories/primitives.css"), /\/\* Proposed: a picture not drawn yet shows its own colour\. \*\/\n\.kanso-thumbnail--color\{background:var\(--kanso-color\)\}/);
  assert.match(repoText("scripts/storybook-kit.mjs"), /add\('Thumbnail', 'Colour, not drawn yet'[\s\S]*?'Proposed\./);
});

test("The kit's thumbnail takes only its press: it picks the picture, and anything else throws", async () => {
  const { app, c } = await kit();
  const hits = [];
  const el = app.thumbnail({ label: "a.png" })("t", c, { onClick: () => hits.push("picked") });
  calls(el, "on_click")[0][1]({}, {});
  assert.deepEqual(hits, ["picked"]);
  assert.throws(() => app.thumbnail({ label: "a.png" })("t", c, { selected: true }), /only handlers, not selected/);
});

test("A markdown block at rest, under the pointer and edited takes the Storybook's grounds from the tokens", async () => {
  const { markdownBlock, G, R, T, LH, c } = await kit();
  const rest = markdownBlock("b", c, { source: "Each customer gets a bucket." });
  assert.deepEqual([one(rest, "px"), one(rest, "py"), one(rest, "rounded"), one(rest, "text_size"), one(rest, "line_height"), one(rest, "text_color")], [G.sm, G.hair, R.control, T.card, LH.body, c.text]);
  assert.deepEqual(calls(rest, "bg"), [], "no ground at rest");
  assert.deepEqual(sources(rest), ["Each customer gets a bucket."]);
  assert.equal(one(markdownBlock("b", c, { source: "x", state: "hover" }), "bg"), c.subtle);
  const editing = markdownBlock("b", c, { source: "x", state: "editing" });
  assert.deepEqual([arg(editing, "bg"), one(editing, "border_color"), one(editing, "py")], [c.raised, c.accent, G.xs]);
  assert.doesNotMatch(storyBlock({ source: "x" }), /kanso-row--hover|kanso-editor--editing/);
  assert.match(storyBlock({ source: "x", state: "hover" }), /kanso-markdown__block kanso-row--hover/);
  assert.match(storyBlock({ source: "x", state: "editing" }), /kanso-editor--editing kanso-control--focus" contenteditable="true"/);
});

test("Proposed: a block's content takes its words' place, in both kits", async () => {
  const { app, c } = await kit();
  const field = chain("field");
  const el = app.markdownBlock({ state: "editing", content: [field] })("b", c);
  assert.deepEqual(sources(el), []);
  assert.ok(el.kids.includes(field));
  assert.equal(storyBlock({ source: "# Lost", state: "editing", content: "<span>field</span>" }).includes("Lost"), false);
  assert.match(repoText("stories/kit/pieces.js"), /Proposed: `content`/);
  assert.match(repoText("scripts/storybook-kit.mjs"), /add\('Markdown', 'Editing, in its field'[\s\S]*?'Proposed\./);
});

test("A block's double press and its links come as handlers: a pressable block takes the pointer's wash, and anything else throws", async () => {
  const { app, c } = await kit();
  const presses = [], links = [];
  const el = app.markdownBlock({ source: "[a](b.md)" })("b", c, { onPress: (e) => presses.push(e.click_count), onLink: (url) => links.push(url) });
  calls(el, "on_mouse_down")[0][2]({ click_count: 2 }, {});
  assert.deepEqual(presses, [2]);
  assert.equal(calls(el, "hover").length, 1);
  const words = nodes(el).find((kid) => kid.tag === "text");
  assert.deepEqual(calls(words, "selectable").map((call) => call[1]), [false], "a pressable block's words are not selected by a press");
  calls(words, "on_link_click")[0][1]("b.md", {});
  assert.deepEqual(links, ["b.md"]);
  const still = app.markdownBlock({ source: "x" })("b", c);
  assert.deepEqual([calls(still, "hover").length, calls(still, "on_mouse_down").length], [0, 0]);
  assert.throws(() => app.markdownBlock({ source: "x" })("b", c, { state: "hover" }), /only handlers, not state/);
  assert.throws(() => app.markdown({ source: "x" })("m", c, { block: 1 }), /only handlers, not block/);
});

test("A markdown document is split into the Storybook's blocks, a fenced block kept whole, and its `block`th is drawn in `state`", async () => {
  const { markdown, c } = await kit();
  assert.deepEqual(markdownBlocks(SAMPLE).length, 5);
  assert.equal(markdownBlocks(SAMPLE)[3], "```sh\ncurl -i /api\n\nexit 0\n```");
  for (const state of ["rest", "hover", "editing"]) {
    const el = markdown("m", c, { source: SAMPLE, block: 2, state });
    const story = storyMarkdown({ source: SAMPLE, block: 2, state });
    assert.equal(el.kids.length, (story.match(/kanso-markdown__block/g) ?? []).length, state);
    assert.deepEqual(sources(el), markdownBlocks(SAMPLE));
    const grounds = el.kids.map((kid) => arg(kid, "bg") ?? null);
    assert.deepEqual(grounds, [null, { rest: null, hover: c.subtle, editing: c.raised }[state], null, null, null], state);
  }
});

test("Markdown and thumbnails are drawn only by the kit: the hand helpers are gone, and each kit file is copied as it is", () => {
  assert.equal(repoText("kanso/mods/kanso-panel/lib.js").includes("markdownView"), false);
  for (const file of ["lib.js", "doc.js", "find-view.js"]) assert.equal(repoText(`kanso/mods/kanso-panel/${file}`).includes("TextView"), false, file);
  for (const name of ["pictureBlock", "look-dot", "dots(list"]) assert.equal(/pictureBlock|look-dot|dots\(list/.test(repoText("kanso/mods/kanso-panel/doc.js") + repoText("kanso/mods/kanso-panel/look.js")), false, name);
  assert.deepEqual(numberArguments("kanso-panel/ui-thumbnail.js"), []);
  assert.deepEqual(numberArguments("kanso-panel/ui-markdown.js"), []);
  for (const name of ["ui-thumbnail.js", "ui-markdown.js", "kit.js", "doc.js", "pure.js"]) {
    const source = name === "pure.js" ? "kanso/mods/kanso-spaces/pure.js" : `kanso/mods/kanso-panel/${name}`;
    assert.equal(repoText(`markdown-panel/mods/markdown-panel/${name}`), repoText(source), `markdown-panel's ${name}`);
  }
});

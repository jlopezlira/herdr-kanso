// The metric and the facts as words: the app kit draws them with the Storybook's props, and every panel that shows a number calls them.
import test from "node:test";
import assert from "node:assert/strict";
import { load, calls, one, nodes, texts, themed, KIT_NIGHT, drawingHost, repoText } from "./helpers.mjs";
import * as storybook from "../stories/kit/pieces.js";

const kit = async () => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "G", "R", "T", "CLEAR"], drawingHost()),
  ...await load("kanso-panel/kit.js", ["metric", "diffText", "facts", "plus"], drawingHost()),
}, KIT_NIGHT);

// The Storybook's metric as its words, in the order it draws them.
const storybookWords = (props) => [...storybook.metric(props).matchAll(/>([^<>]+)</g)].map((m) => m[1].replace(/&amp;/g, "&"));
const textOf = (el, words) => nodes(el).find((kid) => calls(kid, "child").some((call) => call[1] === words));
// The Storybook's playground args for Primitives/Metric, and the states its controls give.
const SAMPLE = { value: "31%", unit: "free of 16 GB · 2.4 GB swap", facts: "14 tasks | $2.94 a task | 9.1M tokens" };
const STATES = {
  "the number alone": { value: "142", unit: "" },
  "with its unit": { value: "2.4 GB", unit: "in 9 worktrees" },
  "with its facts": SAMPLE,
  loading: { ...SAMPLE, loading: true },
};

for (const [state, props] of Object.entries(STATES)) {
  test(`Metric, ${state}: the app draws the Storybook's words in its order`, async () => {
    const { metric, c } = await kit();
    assert.deepEqual(texts(metric(props)("m", c)), storybookWords(props));
  });
}

test("The value is the display size in the text colour, its unit the meta size in dim, its facts the body size in muted", async () => {
  const { metric, T, G, c } = await kit();
  const el = metric(SAMPLE)("m", c);
  assert.equal(one(el, "id"), "m");
  assert.equal(one(el, "gap"), G.sm);
  const value = textOf(el, "31%"), unit = textOf(el, SAMPLE.unit), fact = textOf(el, "14 tasks");
  assert.deepEqual([one(value, "text_size"), one(value, "text_color")], [T.display, c.text]);
  assert.deepEqual([one(unit, "text_size"), one(unit, "text_color")], [T.body, c.dim]);
  assert.deepEqual([one(fact, "text_size"), one(fact, "text_color")], [T.value, c.muted]);
  assert.equal(calls(value.parent, "items_baseline").length, 1, "the value and its unit share one baseline");
  assert.equal(calls(fact.parent, "flex_wrap").length, 1, "the facts wrap");
});

test("Loading keeps each piece's size and draws it as a skeleton shape, its words hidden", async () => {
  const { metric, R, CLEAR, c } = await kit();
  const el = metric(STATES.loading)("m", c);
  for (const words of ["31%", SAMPLE.unit, "14 tasks", "$2.94 a task", "9.1M tokens"]) {
    const piece = textOf(el, words);
    assert.deepEqual([one(piece, "rounded"), one(piece, "bg"), one(piece, "text_color")], [R.sm, c.border, CLEAR], words);
  }
  assert.equal(calls(textOf(metric(SAMPLE)("m", c), "31%"), "bg").length, 0, "at rest nothing is a shape");
});

test("The app's own tone colours the value and its tip is the value's tooltip", async () => {
  const { metric, c } = await kit();
  const value = textOf(metric({ value: "6%", unit: "free", tone: "blocked", tip: "6.2% free" })("m", c), "6%");
  assert.equal(one(value, "text_color"), c.blocked);
  assert.equal(one(value, "tooltip"), "6.2% free");
});

test("The kit's metric takes only handlers from the app, and throws on anything else", async () => {
  const { metric, c } = await kit();
  assert.throws(() => metric(SAMPLE)("m", c, { tone: "blocked" }), /the app gives only handlers, not tone/);
});

test("diffText, facts and plus write what the Storybook writes", async () => {
  const { diffText, facts, plus } = await kit();
  for (const counts of [{ add: 14, del: 3 }, { add: 0, del: 0 }, {}, { add: "120", del: 9 }]) assert.equal(diffText(counts), storybook.diffText(counts));
  for (const parts of [["3 commits", null, "2 files"], [], ["Approved"]]) assert.equal(facts(...parts), storybook.facts(...parts));
  for (const count of [1, 3, 12]) assert.equal(plus(count), storybook.plus(count));
});

// Each file the PR redraws, and the kit call it now makes.
const SITES = {
  "kanso-panel/worktrees.js": ["metric(", "metric("],
  "kanso-panel/ports.js": ["metric("],
  "kanso-panel/shipped.js": ["metric(", "metric("],
  "kanso-guard/main.js": ["metric(", "metric("],
  "kanso-containers/main.js": ["metric("],
  "kanso-spend/main.js": ["metric(", "metric("],
  "kanso-dojo/main.js": ["metric("],
  "kanso-panel/pr.js": ["diffText(", "diffText("],
  "kanso-panel/pr-view.js": ["diffText("],
  "kanso-panel/pr-verdict.js": ["diffText(", "plus(", "plus("],
};
const source = (file) => repoText(`kanso/mods/${file}`).replace(/^import .*$/gm, "");
const count = (text, words) => text.split(words).length - 1;

test("Every number a panel shows with its unit is the kit's metric, and every diff count is diffText", () => {
  for (const [file, made] of Object.entries(SITES)) {
    const text = source(file);
    for (const call of new Set(made)) assert.equal(count(text, call), made.filter((m) => m === call).length, `${file} calls ${call}`);
  }
});

test("No hand metric is left: metricValue and metricStats are gone, and no light figure is drawn beside its unit", () => {
  for (const file of Object.keys(SITES)) {
    const text = source(file);
    assert.doesNotMatch(text, /\bmetric(?:Value|Stats)\b/, file);
    assert.doesNotMatch(text, /text_size\((?:narrow \? \d+ : \d+|2[2-9]|[3-9]\d)\)[^\n]*?\.font_(?:light|semibold)\(\)/, `${file} draws a figure by hand`);
    assert.doesNotMatch(text, /`\+\$\{[^`]*\} −\$\{/, `${file} writes a diff count by hand`);
  }
  assert.doesNotMatch(repoText("kanso/mods/kanso-panel/ui-page.js"), /\bmetric(?:Value|Stats)\b/);
});

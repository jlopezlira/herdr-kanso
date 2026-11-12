import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MIN_CONTRAST, load, pairs, published, render } from "../scripts/build-guidelines.mjs";
import { contrast } from "../scripts/tokens.mjs";

const disk = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("generated guideline pages match elements.json and kanso/tokens.json", async () => {
  for (const [path, html] of Object.entries(render(load()))) {
    assert.equal(await disk(path), html, `${path} is out of date: run npm run build:guidelines`);
  }
});

test("an element that is not Approved, Built or Verified stays out of the output", async () => {
  const { elements, tokens } = load();
  const draft = { ...elements[0], id: "draft-only", title: "Draft only element", status: "Draft", page: "draft-only.html" };
  const out = render({ elements: [...elements, draft], tokens });
  assert.ok(!Object.keys(out).some((p) => p.endsWith("draft-only.html")));
  assert.ok(!Object.values(out).some((html) => html.includes("Draft only element")));
  const index = await disk("site/guidelines/index.html");
  for (const e of published(elements)) assert.ok(index.includes(`href="${e.page}"`), `${e.id} is missing from the index`);
});

test("every text colour keeps 4.5:1 on every surface in both themes", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  const low = pairs(load().tokens).filter((p) => p.ratio < MIN_CONTRAST)
    .map((p) => `${p.theme} ${p.text} on ${p.surface}: ${p.ratio.toFixed(2)}`);
  assert.deepEqual(low, []);
});

test("every site page links the guidelines from its nav", async () => {
  for (const page of ["index", "changelog", "credits", "privacy", "terms", "use"]) {
    const nav = /<nav class="nav-links"[\s\S]*?<\/nav>/.exec(await disk(`site/${page}.html`))[0];
    assert.match(nav, /href="guidelines\/">Guidelines</, page);
  }
});

test("every element page names a principle from the philosophy", () => {
  const { elements } = load();
  const ids = elements.find((e) => e.id === "philosophy").principles.map((p) => p.id);
  for (const e of published(elements).filter((x) => x.id !== "philosophy")) {
    assert.ok(ids.includes(e.serves), `${e.id} serves ${e.serves}`);
  }
});

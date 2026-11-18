import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { load, repoText } from "./helpers.mjs";

const SHEETS = ["stories/proto.css", "stories/primitives.css", "stories/compositions.css", "stories/utilities.css"];
const tokenPx = (value) => Number(new RegExp(`${value.match(/^var\((--[\w-]+)\)$/)?.[1]}:\\s*([\\d.]+)px`).exec(repoText("site/tokens.css"))?.[1]);

test("The Storybook's sidebar Find keeps its search icon first once mounted, on the gutter as the rows' content", async () => {
  const { G, SIDEBAR } = await load("kanso-panel/ui.js", ["G", "SIDEBAR"], {});
  const { window } = new JSDOM(`<style>${SHEETS.map(repoText).join("\n")}</style><div></div>`);
  globalThis.AbortController = window.AbortController;
  const { content, statesFor } = await import("../stories/kit/catalog.js");
  const { mountBehaviours } = await import("../stories/kit/behaviours.js");
  const root = window.document.querySelector("div");
  const finds = statesFor("Layouts/Sidebar").flatMap(({ value, markup }) => {
    root.innerHTML = content(markup);
    mountBehaviours(root, { page: "Layouts/Sidebar", state: value });
    return [...root.querySelectorAll(":is(.kanso-sidebar,.kanso-sidebar--slice)>.kanso-field")]
      .map((field) => ({ first: field.firstElementChild.tagName, inset: tokenPx(window.getComputedStyle(field).paddingLeft) }));
  });
  assert.equal(finds.length, 6, "the six Find states");
  assert.deepEqual([...new Set(finds.map(({ first }) => first))], ["svg"], "the search icon stays the field's first child");
  assert.deepEqual([...new Set(finds.map(({ inset }) => inset))], [SIDEBAR.gutter - G.sm], "from the rows' ground to the gutter");
});

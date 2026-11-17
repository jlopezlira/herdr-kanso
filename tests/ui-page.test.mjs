import assert from "node:assert/strict";
import test from "node:test";
import { gpuiHost, load } from "./helpers.mjs";

const { pageSize } = await load("kanso-panel/ui-page.js", ["pageSize"], gpuiHost());
const resize = (view, width, options) => {
  const notes = [];
  pageSize.call(view, options)({ width }, { notify: () => notes.push(width) });
  return notes.length;
};

test("A panel redraws when its width changes by a pixel or more, and not for less", () => {
  const view = { width: 800 };
  assert.equal(resize(view, 800.5), 0);
  assert.equal(view.width, 800);
  assert.equal(resize(view, 900), 1);
  assert.equal(view.width, 900);
});

test("A page that always follows its width keeps the exact width without redrawing", () => {
  const view = { width: 800 };
  assert.equal(resize(view, 800.5, { always: true }), 0);
  assert.equal(view.width, 800.5);
});

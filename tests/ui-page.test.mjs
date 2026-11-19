import assert from "node:assert/strict";
import test from "node:test";
import { KIT_NIGHT, calls, gpuiHost, load, one, press, repoText } from "./helpers.mjs";
import { memoryPage, spendPage } from "./mod-fixtures.mjs";

const { pageSize, refreshTip, refreshTool } = await load("kanso-panel/ui-page.js", ["pageSize", "refreshTip", "refreshTool"], gpuiHost());
const { tokens } = await load("kanso-panel/ui.js", ["tokens"], gpuiHost());
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

test("Reading a panel again is Refresh, with when it was last read; while it reads, its tool is off and says what it is doing", () => {
  const stamp = "checked 14:00", checking = { busy: true, working: "Checking…", stamp };
  assert.deepEqual([{}, { stamp }, checking].map(refreshTip), ["Refresh", "Refresh · checked 14:00", "Checking…"]);
  const pressed = [];
  const [idle, busy] = [{ stamp }, checking].map((state) => refreshTool("page-refresh", tokens(KIT_NIGHT), state, () => pressed.push(state)));
  assert.deepEqual([idle, busy].map((tool) => [one(tool, "tooltip"), one(tool, "disabled")]), [["Refresh · checked 14:00", false], ["Checking…", true]]);
  press(idle, "page-refresh");
  press(busy, "page-refresh");
  assert.equal(pressed.length, 1, "a press while it reads starts nothing");
});

test("Memory and Spend draw in the kit's page frame: one scrolling column that follows its width, with no frame or width test of their own", async () => {
  for (const [page, file] of [[await memoryPage(), "kanso-guard/main.js"], [await spendPage(), "kanso-spend/main.js"]]) {
    const frame = page.render({});
    assert.equal(calls(frame, "overflow_y_scrollbar").length, 1, file);
    const redraws = [];
    const resize = (width) => one(frame, "on_size_change")({ width }, { notify: () => redraws.push(width) });
    resize(500);
    resize(500.5);
    assert.deepEqual([page.width, redraws], [500.5, [500]], `${file} follows its width and redraws from a pixel`);
    assert.doesNotMatch(repoText(`kanso/mods/${file}`), /overflow_y_scrollbar|on_size_change/, `${file} builds no frame of its own`);
  }
});

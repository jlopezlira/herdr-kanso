// A state mark is drawn at the row icon token unless its caller names a size.
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost } from "./helpers.mjs";

const marks = () => load("kanso-spaces/marks.js", ["stateMark"], gpuiHost());
const night = { working: "#7aa2c7", blocked: "#d5674f", done: "#8fb37d", idle: "#6b6860", dim: "#6b6860", muted: "#949086", chrome: "#161615" };
const size = (el) => el.calls.find((call) => call[0] === "size")?.[1];

test("A working, blocked, done, idle or asleep mark drawn without a size is 14px, the row icon token", async () => {
  const { stateMark } = await marks();
  const { ICON_ROW } = await load("kanso-panel/ui.js", ["ICON_ROW"], gpuiHost());
  assert.equal(ICON_ROW, 14);
  for (const status of ["working", "blocked", "done", "idle", "asleep"]) {
    assert.equal(size(stateMark(night, status, undefined, { idle: true })), 14, status);
  }
  assert.equal(size(stateMark(night, "done")), 14);
});

test("A mark whose caller names a size keeps that size", async () => {
  const { stateMark } = await marks();
  for (const own of [11, 12, 13, 14]) {
    for (const status of ["working", "blocked", "done", "idle", "asleep"]) {
      assert.equal(size(stateMark(night, status, own, { idle: true })), own, `${status} at ${own}`);
    }
  }
});

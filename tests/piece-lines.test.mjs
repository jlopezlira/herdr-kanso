// What every right-click menu ends with: Only when needed, Hide with an Undo toast, and Settings for this.
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, clone } from "./helpers.mjs";

async function lines() {
  const store = {}, toasts = [], opened = [];
  const host = { ...gpuiHost(), shared: (key) => store[key] ?? null, setShared: (key, value) => { store[key] = value; }, notify: (note) => toasts.push(note), openOverlay: (spec) => opened.push(spec) };
  const lib = await load("kanso-panel/piece-lines.js", ["pieceLines", "hidePiece", "undoHide", "UNDO_COMMAND"], host);
  return { ...lib, store, toasts, opened };
}

test("A piece with a needed state ends its menu with Only when needed, Hide this and Settings for this", async () => {
  const { pieceLines } = await lines();
  const words = pieceLines("status.agents").filter((line) => line.label).map((line) => line.label);
  assert.deepEqual(clone(words), ["Only when needed", "Hide this", "Settings for this…"]);
  assert.deepEqual(clone(pieceLines("status.computer").filter((line) => line.label).map((line) => line.label)), ["Hide this", "Settings for this…"]);
  assert.equal(pieceLines("tabs.state", { named: true }).find((line) => /^Hide/.test(line.label)).label, "Hide “Agent state on tabs”");
});

test("Hide stores the state and says what stopped; Undo puts the piece back as it was", async () => {
  const { hidePiece, undoHide, UNDO_COMMAND, store, toasts } = await lines();
  store["kanso.pieces"] = { "header.pr": "show" };
  hidePiece("header.pr");
  assert.equal(store["kanso.pieces"]["header.pr"], "hide");
  assert.equal(toasts[0].title, "Hidden: PR");
  assert.equal(toasts[0].body, "gh stops");
  assert.deepEqual(clone(toasts[0].action), { name: UNDO_COMMAND, args: { label: "Undo" } });
  undoHide();
  assert.equal(store["kanso.pieces"]["header.pr"], "show");
});

test("Only when needed toggles, and Settings opens the pieces page on that piece", async () => {
  const { pieceLines, store, opened } = await lines();
  const shut = [];
  const by = (label) => pieceLines("status.agents", { done: () => shut.push(label) }).find((line) => line.label === label);
  by("Only when needed").onClick({});
  assert.equal(store["kanso.pieces"]["status.agents"], "show", "it was needed, so it shows always");
  by("Settings for this…").onClick({});
  assert.equal(opened[0].props.page, "pieces");
  assert.equal(opened[0].props.find, "Agents at work");
  assert.equal(shut.length, 2);
});

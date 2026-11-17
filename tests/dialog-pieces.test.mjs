import assert from "node:assert/strict";
import test from "node:test";
import { clone, load } from "./helpers.mjs";

const timerCx = () => {
  const timers = [];
  return { timers, cx: { timer: { after: (ms, fn) => { timers.push([ms, fn]); return { cancel() {} }; } } } }; };
const rest = () => new Promise((resolve) => setTimeout(resolve, 2));

test("A pressed key lights its cap, and only its own timer darkens it", async () => {
  const { Lit } = await load("kanso-dojo/lit.js", ["Lit"]);
  const { cx, timers } = timerCx();
  let draws = 0;
  const notifyCx = { notify: () => { draws += 1; } };
  const cap = new Lit(600);
  assert.equal(cap.lit, null);

  cap.light("h", cx);
  assert.equal(cap.on("h"), true);
  assert.equal(cap.on("j"), false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0][0], 600, "the dōjō's own light time");

  await rest();
  cap.light("j", cx);
  timers[0][1](notifyCx);
  assert.equal(cap.on("j"), true, "the first press's timer does not dark the second press");
  assert.equal(draws, 0);
  timers[1][1](notifyCx);
  assert.equal(cap.lit, null);
  assert.equal(draws, 1);
});

test("A rename is a terminal's label or a command with the new name, and neither answers false", async () => {
  const served = [];
  const { applyRename, trackText } = await load("kanso-prompt/rename.js", ["applyRename", "trackText"], {
    hc: (args) => { served.push(["hc", args]); return Promise.resolve({ code: 0 }); },
    run: (name, args) => { served.push(["run", name, args]); },
  });

  assert.equal(applyRename({ label: { terminal: "t1", key: "kanso.name" } }, "web"), true);
  assert.deepEqual(clone(served[0]), ["hc", ["label", "t1", "kanso.name=web"]]);

  assert.equal(applyRename({ command: { name: "tab.rename", args: { tab: 2 } } }, "x"), true);
  assert.deepEqual(clone(served[1]), ["run", "tab.rename", { tab: 2, name: "x" }]);

  assert.equal(applyRename({ command: { name: "pane.name", key: "title" } }, "y"), true);
  assert.deepEqual(clone(served[2]), ["run", "pane.name", { title: "y" }]);

  served.length = 0;
  assert.equal(applyRename({}, "z"), false, "a dialog with neither label nor command answers, so the caller can");
  assert.deepEqual(served, []);

  let typed = null;
  let draws = 0;
  const input = { value: () => "the text", on: (event, fn) => { assert.equal(event, "change"); input.handler = fn; } };
  trackText(input, (text) => { typed = text; });
  input.handler({}, { notify: () => { draws += 1; } });
  assert.equal(typed, "the text");
  assert.equal(draws, 1);
});

test("The Open with popup opens on the machine the pane's space lives on", async () => {
  const opened = [];
  const { openWithPopup } = await load("open-with/popup.js", ["openWithPopup"], {
    spaces: () => [{ id: "s1", machine: "big", tabs: [{ id: "t9" }] }, { id: "s2", tabs: [{ id: "t1" }] }],
    openOverlay: (ask) => opened.push(ask),
  });
  openWithPopup({ tab: "t9", cwd: "/src/app" });
  assert.deepEqual(clone(opened), [{ mod: "open-with", kind: "popup", width: 340, props: { folder: "/src/app", machine: "big" } }]);
  openWithPopup({ tab: "t1", cwd: "/local" });
  assert.equal(opened[1].props.machine, null, "a space with no machine opens here");
});

test("The arrangements dialog opens the same from the tab bar and from the strip", async () => {
  const opened = [];
  const { openArrange } = await load("kanso-arrange/open.js", ["openArrange"], { openOverlay: (ask) => opened.push(ask) });
  openArrange();
  assert.deepEqual(clone(opened), [{ mod: "kanso-arrange", kind: "dialog", width: 480 }]);
});

test("A folder's short word is its tilde form, and nothing when there is no folder", async () => {
  const { shortFolder } = await load("kanso-send/folder.js", ["shortFolder"], { home: () => "/Users/jj" });
  assert.equal(shortFolder("/Users/jj/src/app"), "~/src/app");
  assert.equal(shortFolder("/elsewhere"), "/elsewhere");
  assert.equal(shortFolder(null), "");
});

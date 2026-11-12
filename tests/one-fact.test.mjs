// Each fact is one sentence: a finished row, an update, a question, low memory, a failed sleep, a server with no pane.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { load } from "./helpers.mjs";

const text = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

function paint() {
  const marks = [];
  const texts = [];
  const node = () => {
    const mark = {};
    const el = new Proxy({}, {
      get(_target, key) {
        if (key === "then") return undefined;
        if (key === "size") return (n) => { mark.size = n; return el; };
        if (key === "rounded_full") return () => { mark.round = true; return el; };
        if (key === "child") return (value) => { if (typeof value === "string") texts.push(value); return el; };
        if (key === "when") return (on, apply) => (on ? apply(el) : el);
        return () => el;
      },
    });
    marks.push(mark);
    return el;
  };
  return { node, marks, texts };
}

const theme = () => new Proxy({}, { get: (_target, key) => String(key) });

test("A finished row says its last words and not the header digest", async () => {
  const { activityOf } = await load("kanso-spaces/agents.js", ["activityOf"]);
  const digest = { files: 3, add: 42, del: 7, ahead: 2, pr: { number: 142, checks: "failing" } };
  assert.equal(activityOf({ status: "done", msg: "" }, digest), null);
  assert.equal(activityOf({ status: "done", msg: "Shipped the notes." }, digest), "Shipped the notes.");
});

test("An update draws no dot on the gear or the footer", async () => {
  const drawn = paint();
  const host = {
    div: drawn.node, svg: drawn.node, image: drawn.node, h_flex: drawn.node, v_flex: drawn.node,
    theme, run: () => {}, openOverlay: () => {}, home: () => "/Users/me", window: () => ({ platform: "macos" }),
  };
  const { WorkspaceChrome } = await load("kanso-chrome/main.js", ["WorkspaceChrome"], {
    ...host, props: () => ({ footer: true }), shared: () => null, setShared: () => {},
    updates: () => ({ app: { ready: true } }), agents: () => [],
  });
  const footer = new WorkspaceChrome();
  footer.updater = { available: () => "3.31.0", busy: false, install() {} };
  footer.render();
  const { Tabs } = await load("kanso-tabs/main.js", ["Tabs"], {
    ...host, spaces: () => [{ id: "s", active: true, tabs: [] }], panes: () => [], layout: () => null,
    shared: () => null, setShared: () => {},
  });
  const tabs = new Tabs();
  tabs.updater = { available: () => "3.31.0" };
  tabs.render();
  assert.equal(drawn.marks.some((mark) => mark.size === 6 && mark.round), false);
  assert.ok(drawn.texts.includes("Update kansō to 3.31.0"));
  assert.ok(drawn.texts.includes("Settings · update ready"));
});

test("A waiting question is one sentence, cut at 200", async () => {
  const { oneLine, DID_CAP } = await load("kanso-spaces/pure.js", ["oneLine", "DID_CAP"]);
  const { questionOf } = await load("kanso-status/model.js", ["questionOf"]);
  const { said } = await load("kanso-spaces/agents.js", ["said"]);
  const msg = `Add the countdown? ${"x".repeat(240)}`;
  const sentence = oneLine(msg);
  assert.equal(DID_CAP, 200);
  assert.equal(sentence.length, 200);
  assert.equal(sentence.endsWith("\u2026"), true);
  const ask = { msg, title: "Other", name: "Fury", program: { key: "claude", name: "Claude" } };
  assert.equal(questionOf(ask), sentence);
  assert.equal(said({ msg }), sentence);
});

test("Low memory is one sentence", async () => {
  const { memoryFree } = await load("kanso-spaces/pure.js", ["memoryFree"]);
  const { memoryLow } = await load("kanso-status/model.js", ["memoryLow"]);
  const now = 1_700_000_000_000;
  const reading = JSON.stringify({ v: 1, at: now, machine: { freePct: 8.4 }, limits: { lowFreePct: 20 } });
  assert.equal(memoryFree(8.4), "Memory 8% free");
  assert.equal(memoryLow(reading, now).words, memoryFree(8.4));
  const guard = await text("kanso/mods/kanso-guard/guard.mjs");
  assert.match(guard, /memoryFree\(freePct\)/);
  assert.equal(guard.includes("Memory low:"), false);
});

test("Ports says no pane from one constant", async () => {
  const { NO_PANE } = await load("kanso-panel/ports.js", ["NO_PANE"]);
  assert.equal(NO_PANE, "no pane");
  const source = await text("kanso/mods/kanso-panel/ports.js");
  assert.equal(source.includes("No pane runs it"), false);
  assert.equal(source.includes("with no pane"), false);
  assert.equal(source.split("NO_PANE").length - 1, 5);
});

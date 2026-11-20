import test from "node:test";
import assert from "node:assert/strict";
import { load, texts, calls, arg, themed, chain, KIT_NIGHT, popoverHost, everyDrawn as every, repoText } from "./helpers.mjs";

const question = "Run pnpm add react-countdown@2.3?";
const pieceLines = [{ separator: true }, { icon: "lu-check", label: "Only when needed" }, { icon: "lu-eye-off", label: "Hide this" }, { icon: "lu-sliders-vertical", label: "Settings for this…" }];
const unreachable = (name) => `ssh: connect to host ${name} port 22: Operation timed out`;
const paletteTip = "Command palette ⇧⌘P";
const sampleColumns = [{ width: 15, panes: ["seen"] }, { width: 21, panes: ["seen", "current"] }, { width: 9, panes: ["seen"] }, { width: 15, panes: ["away"] }, { width: 15, panes: ["away"] }];
const BAR = {
  args: { width: 1040, computer: "none", paused: false, stepper: "rest", minimap: false, needs: "question", memory: "none", panels: false, open: "none" },
  states: [
    { label: "At rest", args: { needs: "none" } },
    { label: "Panes per view menu", args: { needs: "none", stepper: "menu" } },
    { label: "Layout paused", args: { needs: "none", paused: true } },
    { label: "Minimap", args: { needs: "none", minimap: true } },
    { label: "Sidebar folded", args: { computer: "on" } },
    { label: "Unreachable", args: { computer: "unreachable", needs: "none" } },
    { label: "Needs you", args: {} },
    { label: "Servers, containers and reviews", args: { width: 520, needs: "none", panels: true } },
    { label: "Servers open", args: { width: 520, needs: "none", panels: true, open: "servers" } },
    { label: "Containers open", args: { width: 520, needs: "none", panels: true, open: "containers" } },
    { label: "Reviews open", args: { width: 520, needs: "none", panels: true, open: "reviews" } },
    { label: "Everything, 1200", args: { width: 1200, memory: "word", panels: true } },
    { label: "Everything, 1040", args: { memory: "folded", panels: true } },
    { label: "Everything, 760", args: { width: 760, memory: "folded" } },
    { label: "Everything, 520", args: { width: 520, needs: "folded", memory: "folded" } },
  ],
};
const ITEM = { args: { icon: "lu-container", mark: "none", text: "1", tone: "blocked", pending: false },
  states: [{ label: "Memory", args: { icon: "none", text: "Memory 8% free" } }, { label: "Memory folded", args: { icon: "none", text: "8% free" } }] };
const COMPUTER = { args: { name: "devbox", remote: true, state: "on", folded: false },
  states: [{ label: "Out of sight", args: {} }, { label: "Folded", args: { folded: true } }, { label: "Unreachable", args: { state: "unreachable" } }, { label: "Reconnecting", args: { state: "pending" } }] };
const NEEDS = { args: { name: "cart-ui", question, more: 1 },
  states: [{ label: "One", args: { more: 0 } }, { label: "Several", args: {} }, { label: "Folded", args: { question: "" } }] };
const hide = [{ separator: true }, { icon: "lu-eye-off", label: "Hide this" }];
const panelMenus = {
  servers: { title: ":5173 vite · no pane", items: [{ icon: "lu-external-link", label: "Open in the browser" }, { icon: "lu-copy", label: "Copy localhost:5173" },
    { separator: true }, { icon: "lu-square", label: "Stop" }, { separator: true }, { icon: "lu-plug", label: "Open Ports" }, ...hide.slice(1)] },
  containers: { title: "cart-db · exited 1", items: [{ icon: "lu-power", label: "Start" }, { icon: "lu-terminal", label: "Logs" },
    { separator: true }, { icon: "lu-x", label: "Remove" }, { separator: true }, { icon: "lu-container", label: "Open Containers" }, ...hide.slice(1)] },
  reviews: { title: "2 reviews requested", items: [{ icon: "lu-git-pull-request", label: "#142 Checkout auth flow", hint: "acme-shop" },
    { icon: "lu-git-pull-request", label: "#87 Locale files", hint: "docs-site" }, ...hide] },
};

const compositions = async () => {
  const host = popoverHost();
  return themed({
    ...await load("kanso-panel/kit.js", ["menu", "needsItem", "statusItem", "stepper"], host),
    ...await load("kanso-status/status-bar.js", ["statusBar", "computerItem", "paletteDoor", "layoutPaused"], host),
    ...await load("kanso-panel/ui.js", ["tokens", "OPACITY"], host),
  }, KIT_NIGHT);
};

const surface = (el) => [...texts(el), ...every(el).flatMap((kid) => calls(kid, "accessibility_label").map((call) => call[1])),
  ...every(el).flatMap((kid) => calls(kid, "tooltip").map((call) => String(call[1])))].join("\n");
const byId = (el, id) => every(el).find((kid) => kid.tag === id || calls(kid, "id").some((call) => call[1] === id));
const says = (el, word) => assert.ok(surface(el).includes(word), `the app says ${word}`);
const leavesOut = (el, word) => assert.equal(surface(el).includes(word), false, `the app leaves out ${word}`);

const drawBar = (kit, args, handlers = {}) => {
  const { statusBar, computerItem, paletteDoor, layoutPaused, needsItem, statusItem, stepper, menu, c } = kit;
  const menuOpen = !args.paused && args.stepper === "menu";
  const popup = menuOpen
    ? menu({ title: "Panes per view", items: [{ icon: "lu-move-horizontal", label: "Even out", hint: "⇧⌘0" }, ...pieceLines] })
    : args.panels && args.open !== "none" ? menu(panelMenus[args.open]) : null;
  const needs = args.needs === "none" ? null : needsItem({ name: "cart-ui", question: args.needs === "folded" ? "" : question, more: 1 });
  const memory = args.memory === "none" ? null : statusItem({ text: args.memory === "folded" ? "8% free" : "Memory 8% free", tone: "blocked" });
  const panels = args.panels ? [
    statusItem({ icon: "lu-plug", tone: "working", text: 1, open: args.open === "servers" }),
    statusItem({ icon: "lu-container", tone: "blocked", text: 1, open: args.open === "containers" }),
    statusItem({ icon: "lu-git-pull-request", text: 2, open: args.open === "reviews" }),
  ] : [];
  return statusBar({
    left: args.computer === "none" ? [] : [computerItem({ name: "devbox", state: args.computer, detail: unreachable("devbox") })],
    middle: args.paused ? layoutPaused({ detail: "layout write refused 3 times" }) : stepper({ hover: args.stepper === "hover", open: menuOpen, columns: args.minimap ? sampleColumns : [] }),
    right: [needs, memory, ...panels, paletteDoor({ tip: paletteTip })].filter(Boolean),
    popup,
  })("bar", c, handlers);
};

test("The strip and the status bar draw only through the shared status bar", () => {
  assert.equal(repoText("kanso/mods/kanso-strip/main.js").includes("Strip paused"), false);
  assert.equal(repoText("kanso/mods/kanso-strip/main.js").includes("strip-fewer"), false);
  assert.equal(repoText("kanso/mods/kanso-status/main.js").includes("h_flex"), false);
});

test("Every status bar state draws in the app with its words", async () => {
  const kit = await compositions();
  const drawn = Object.fromEntries(BAR.states.map(({ label, args }) => [label, { el: drawBar(kit, { ...BAR.args, ...args }) }]));
  const see = (label, ...words) => words.forEach((word) => says(drawn[label].el, word));
  const skip = (label, ...words) => words.forEach((word) => leavesOut(drawn[label].el, word));
  assert.deepEqual(Object.keys(drawn), ["At rest", "Panes per view menu", "Layout paused", "Minimap", "Sidebar folded", "Unreachable", "Needs you", "Servers, containers and reviews", "Servers open", "Containers open", "Reviews open", "Everything, 1200", "Everything, 1040", "Everything, 760", "Everything, 520"]);
  see("At rest", "Command palette", "2 per view");
  skip("At rest", "cart-ui", "Layout paused");
  see("Panes per view menu", "Even out", "Panes per view", "⇧⌘0");
  see("Layout paused", "Layout paused", "Resume", "layout write refused 3 times");
  see("Minimap", "Column 1", "Column 5");
  see("Sidebar folded", "devbox");
  skip("Sidebar folded", "Can't reach");
  see("Unreachable", "Can't reach devbox", "Refresh", "ssh: connect to host devbox port 22: Operation timed out");
  see("Needs you", "cart-ui", question, "+1");
  see("Servers, containers and reviews", "Command palette");
  assert.ok(texts(drawn["Servers, containers and reviews"].el).filter((word) => word === "1").length >= 2);
  see("Servers open", ":5173 vite · no pane", "Open in the browser", "Stop");
  see("Containers open", "cart-db · exited 1", "Start", "Logs");
  see("Reviews open", "2 reviews requested", "#142 Checkout auth flow", "acme-shop");
  see("Everything, 1200", "Memory 8% free", "cart-ui", question);
  see("Everything, 1040", "8% free", question);
  skip("Everything, 1040", "Memory 8% free");
  see("Everything, 760", "8% free", question);
  skip("Everything, 760", "Open Ports");
  see("Everything, 520", "cart-ui", "+1", "8% free");
  skip("Everything, 520", question);
});

test("Every item, computer and needs-you state draws in the app with the same words", async () => {
  const kit = await compositions();
  const { statusBar, statusItem, computerItem, needsItem, c, OPACITY } = kit;
  for (const { args } of ITEM.states) {
    const merged = { ...ITEM.args, ...args };
    const el = statusBar({ right: [statusItem({ icon: merged.icon === "none" ? "" : merged.icon, mark: merged.mark === "none" ? "" : merged.mark, text: merged.text, tone: merged.tone, pending: merged.pending })] })("bar", c);
    says(el, merged.text);
  }
  for (const { label, args } of COMPUTER.states) {
    const merged = { ...COMPUTER.args, ...args };
    const el = statusBar({ left: [computerItem({ ...merged, detail: unreachable(merged.name) })] })("bar", c);
    if (label === "Folded") leavesOut(el, "devbox");
    if (label === "Out of sight") says(el, "devbox");
    if (label === "Unreachable") ["Can't reach devbox", "Refresh"].forEach((word) => says(el, word));
    if (label === "Reconnecting") {
      says(el, "devbox");
      assert.equal(arg(byId(el, "bar-left-0"), "opacity"), OPACITY.pending);
    }
  }
  for (const { label, args } of NEEDS.states) {
    const merged = { ...NEEDS.args, ...args };
    const el = statusBar({ right: [needsItem(merged)] })("bar", c);
    says(el, "cart-ui");
    if (label === "One") { says(el, question); leavesOut(el, "+1"); }
    if (label === "Several") [question, "+1"].forEach((word) => says(el, word));
    if (label === "Folded") { leavesOut(el, question); says(el, "+1"); }
  }
});

test("Panes per view is buttons the keyboard reaches, and a press named for nothing throws", async () => {
  const kit = await compositions();
  const { statusBar, stepper, paletteDoor, statusItem, c } = kit;
  const hits = [];
  const cx = {};
  const el = statusBar({ middle: stepper({ hover: true, columns: sampleColumns }) })("bar", c, {
    presses: { minus: () => hits.push("minus"), plus: () => hits.push("plus") },
    onClick: () => hits.push("even"),
    onChange: (i) => hits.push(i),
  });
  for (const id of ["bar-middle-0-minus", "bar-middle-0-value", "bar-middle-0-plus", "bar-middle-0-column-0"]) {
    const tool = byId(el, id);
    assert.equal(tool.tag, id, `${id} is a button`);
    const ring = chain();
    arg(tool, "focus")(ring);
    assert.equal(arg(ring, "border_color"), c.accent, `${id} draws the focus ring`);
  }
  arg(byId(el, "bar-middle-0-minus"), "on_click")({}, cx);
  arg(byId(el, "bar-middle-0-value"), "on_click")({}, cx);
  arg(byId(el, "bar-middle-0-plus"), "on_click")({}, cx);
  arg(byId(el, "bar-middle-0-column-1"), "on_click")({}, cx);
  const palette = statusBar({ right: [paletteDoor({ tip: paletteTip })] })("bar", c, { presses: { command: () => hits.push("palette") } });
  arg(byId(palette, "bar-right-0"), "on_click")({}, cx);
  assert.deepEqual(hits, ["minus", "even", "plus", 1, "palette"]);
  assert.throws(() => paletteDoor({ tip: "Command palette" })("palette", c, { presses: { search: () => {} } }), /no tool search/);
  assert.throws(() => statusItem({ text: "Memory" })("memory", c, { tone: "blocked" }), /handlers/);
});

test("The bar's three tracks stand in for the grid columns", async () => {
  const { statusBar, statusItem, stepper, c } = await compositions();
  const { G, H } = await load("kanso-panel/ui.js", ["G", "H"], popoverHost());
  const el = statusBar({ left: [statusItem({ text: "devbox" })], middle: stepper({ value: 2 }), right: [statusItem({ text: "1" })] })("bar", c);
  assert.equal(arg(el, "h"), H.bar);
  assert.ok(calls(el, "whitespace_nowrap").length, "the bar keeps its figures on one line");
  assert.equal(calls(el, "w_full").length, 1);
  assert.equal(calls(el, "size_full").length, 0);
  assert.equal(el.calls.filter(([name]) => name === "grid" || name === "flex").at(-1)[0], "flex");
  const left = byId(el, "bar-left");
  const middle = byId(el, "bar-middle");
  const right = byId(el, "bar-right");
  assert.equal(calls(left, "flex_1").length, 1);
  assert.equal(arg(left, "gap"), G.lg);
  assert.equal(arg(left, "px"), G.md);
  assert.equal(calls(right, "justify_end").length, 1);
  assert.equal(calls(middle, "flex_none").length, 1);
  assert.equal(calls(middle, "flex_1").length, 0);
  assert.equal(arg(middle, "gap"), G.md);
});

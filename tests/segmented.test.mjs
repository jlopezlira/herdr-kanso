// One segmented control: its box from the tokens, selection by tone, and nothing that moves.
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost } from "./helpers.mjs";

const kit = () => load("kanso-panel/ui.js", ["segmented", "tokens", "mix", "WASH", "G", "H", "R", "T"], gpuiHost());

const calls = (el, name) => el.calls.filter((call) => call[0] === name);
const one = (el, name) => {
  const found = calls(el, name);
  assert.equal(found.length, 1, name);
  return found[0][1];
};
const styled = (el, name) => {
  const style = chain();
  one(el, name)(style);
  return style.calls;
};

const night = { background: "#1b1b19", foreground: "#d8d4cb", hover: "#232321", selected: "#2b2b28", accent: "#da627d", dim: "#6b6860", muted: "#949086", blocked: "#e06c75" };
const day = { background: "#f4f1eb", foreground: "#3c3934", hover: "#ebe6de", selected: "#e0dbd2", accent: "#b8405e", dim: "#a19c92", muted: "#7a756c", blocked: "#c0392b" };
const ITEMS = [{ key: "day", label: "Today" }, { key: "month", label: "Month" }, { key: "all", label: "All time" }];
// What sizes an item: every call but its colours and its state.
const TONE = new Set(["bg", "text_color", "selected", "hover", "on_click", "when"]);
const plain = (a) => a === null || (typeof a !== "object" && typeof a !== "function");
const sizing = (el) => el.calls.filter((call) => !TONE.has(call[0])).map((call) => call.filter(plain));
const box = (el) => JSON.stringify([sizing(el), el.kids.map(sizing)]);

test("The track is 30 high on the 4% wash, radius 8, 2 inside; each item radius 6 with 8 inside", async () => {
  const { segmented, tokens, mix, WASH, G, H, R } = await kit();
  for (const theme of [night, day]) {
    const c = tokens(theme);
    const el = segmented("seg", ITEMS, "day", () => {}, c);
    assert.equal(one(el, "h"), H.control);
    assert.equal(one(el, "p"), G.hair);
    assert.equal(one(el, "gap"), G.hair);
    assert.equal(one(el, "rounded"), R.card);
    assert.equal(one(el, "bg"), mix(c.text, c.background, WASH.off));
    assert.equal(el.kids.length, ITEMS.length);
    for (const item of el.kids) {
      assert.equal(one(item, "rounded"), R.control);
      assert.equal(one(item, "px") + G.hair, G.sm, "the ring's border counts inside the padding");
      assert.equal(calls(item, "flex_1").length, 1, "items share the track");
    }
  }
});

test("Selection is a tone: the chosen item is the 12% wash in the text colour, the others muted with a hover wash", async () => {
  const { segmented, tokens } = await kit();
  for (const theme of [night, day]) {
    const c = tokens(theme);
    const [chosen, other] = segmented("seg", ITEMS, "day", () => {}, c).kids;
    assert.equal(one(chosen, "bg"), c.selected);
    assert.equal(one(chosen, "selected"), true);
    assert.equal(calls(chosen, "hover").length, 0, "the chosen item keeps its wash");
    assert.equal(one(chosen.kids[0], "text_color"), c.text);
    assert.equal(calls(other, "bg").length, 0, "no edge, no fill until hovered");
    assert.deepEqual(styled(other, "hover"), [["bg", c.subtle]]);
    assert.equal(one(other.kids[0], "text_color"), c.muted);
    for (const item of [chosen, other]) {
      assert.equal(calls(item, "border_1").length, 0, "no edge");
      for (const weight of ["font_medium", "font_semibold", "font_bold"]) assert.equal(calls(item.kids[0], weight).length, 0, weight);
    }
  }
});

test("Choosing another item changes no width and moves nothing", async () => {
  const { segmented, tokens } = await kit();
  const c = tokens(night);
  for (const item of ITEMS) {
    const sizes = ITEMS.map((value) => box(segmented("seg", ITEMS, value.key, () => {}, c).kids[ITEMS.indexOf(item)]));
    assert.equal(new Set(sizes).size, 1, `${item.label} is one box whether chosen or not`);
  }
  const before = segmented("seg", ITEMS, "day", () => {}, c), after = segmented("seg", ITEMS, "all", () => {}, c);
  assert.equal(box(before), box(after), "the track is the same box");
});

test("A press on another item hands its key; on the chosen one, nothing", async () => {
  const { segmented, tokens } = await kit();
  const handed = [];
  const [chosen, other] = segmented("seg", ITEMS, "day", (key) => handed.push(key), tokens(day)).kids;
  one(other, "on_click")({}, {});
  one(chosen, "on_click")({}, {});
  assert.deepEqual(handed, ["month"]);
  assert.equal(one(other, "accessibility_label"), "Month");
  assert.deepEqual(calls(other, "set_position")[0].slice(1), [2, 3]);
});

test("Focus draws the accent ring on a border kept clear at rest", async () => {
  const { segmented, tokens } = await kit();
  for (const theme of [night, day]) {
    const c = tokens(theme);
    for (const item of segmented("seg", ITEMS, "day", () => {}, c).kids) {
      assert.equal(calls(item, "border_2").length, 1);
      assert.equal(one(item, "border_color"), "#00000000");
      assert.deepEqual(styled(item, "focus"), [["border_color", c.accent]]);
    }
  }
});

test("Off: dim text, no hover, no pointer, no press", async () => {
  const { segmented, tokens } = await kit();
  const c = tokens(night);
  for (const item of segmented("seg", ITEMS, "day", () => assert.fail("pressed"), c, { disabled: true }).kids) {
    assert.equal(one(item, "disabled"), true);
    for (const name of ["hover", "on_click", "cursor_pointer"]) assert.equal(calls(item, name).length, 0, name);
    assert.equal(one(item.kids[0], "text_color"), c.dim);
  }
});

test("A dot marks an unselected item; collapsed, the items are icons with their label as tip", async () => {
  const { segmented, tokens, H, G } = await kit();
  const c = tokens(night);
  const items = [{ key: "spaces", label: "Projects", icon: "folder" }, { key: "agents", label: "Status", icon: "pulse", dot: true }];
  const open = segmented("v", items, "spaces", () => {}, c);
  assert.equal(open.kids[1].kids.at(-1).calls.some((call) => call[0] === "bg" && call[1] === c.blocked), true);
  assert.equal(segmented("v", items, "agents", () => {}, c).kids[1].kids.some((kid) => kid.calls.some((call) => call[0] === "bg" && call[1] === c.blocked)), false, "no dot on the chosen item");
  const rail = segmented("v", items, "spaces", () => {}, c, { collapsed: true });
  assert.equal(rail.tag, "v_flex");
  assert.equal(calls(rail, "h").length, 0);
  for (const [i, item] of rail.kids.entries()) {
    assert.equal(one(item, "size"), H.icon);
    assert.equal(one(item, "tooltip"), items[i].label);
    assert.equal(item.kids.some((kid) => kid.calls.some((call) => call[0] === "child" && call[1] === items[i].label)), false, "no label beside the icon");
  }
  assert.equal(one(rail.kids[1].kids.at(-1), "top"), G.hair);
});

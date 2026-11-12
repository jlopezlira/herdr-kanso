// One text field: its box from the tokens, its edge, ring, error, off and multi-line states.
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost } from "./helpers.mjs";

const textState = (kind) => ({
  new: (options = {}) => {
    const handlers = {}, grow = [];
    return { kind, options, handlers, grow, on: (event, fn) => { handlers[event] = fn; return true; }, set_auto_grow: (...rows) => grow.push(rows), value: () => options.value ?? "" };
  },
});
const host = () => ({ ...gpuiHost(), Input: { new: () => chain("input") }, Textarea: { new: () => chain("textarea") }, InputState: textState("input"), TextareaState: textState("textarea") });
const kit = () => load("kanso-panel/ui.js", ["field", "TextField", "FIELD_LINES", "tokens", "mix", "WASH", "G", "H", "R", "T", "ICON"], host());

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

const night = { background: "#1b1b19", foreground: "#d8d4cb", input: "#3a3935", hover: "#232321", selected: "#2b2b28", accent: "#da627d", dim: "#6b6860", muted: "#949086", blocked: "#d0675f" };
const parts = (ring) => {
  const box = ring.kids[0];
  return { box, editor: box.kids[0], icon: box.kids[1] };
};
const notify = { notify() {} };

test("At rest: 30 high, radius 6, 12.5 text, 12 inside, a 1 px input edge on the canvas", async () => {
  const { field, TextField, tokens, G, H, R, T } = await kit();
  const c = tokens(night);
  const ring = field("f", new TextField({ placeholder: "Find" }), c);
  const { box, editor } = parts(ring);
  assert.equal(one(box, "h"), H.control);
  assert.equal(calls(box, "min_h").length, 0, "a single line never grows");
  assert.equal(one(box, "rounded"), R.control);
  assert.equal(calls(box, "border_1").length, 1);
  assert.equal(one(box, "border_color"), c.input);
  assert.equal(one(box, "bg"), c.canvas);
  assert.equal(editor.tag, "input");
  assert.equal(one(editor, "text_size"), T.value);
  assert.equal(one(editor, "pl"), G.md);
  assert.equal(one(editor, "pr"), G.md);
  assert.deepEqual(styled(box, "hover"), [["border_color", c.muted]], "hover darkens the edge one step");
});

test("Focus is a 2 px accent ring outside the edge that takes no room", async () => {
  const { field, TextField, tokens, G, R } = await kit();
  const c = tokens(night);
  const text = new TextField();
  const rest = field("f", text, c);
  assert.equal(calls(rest, "border_2").length, 1);
  assert.equal(one(rest, "m"), -G.hair);
  assert.equal(one(rest, "rounded"), R.control + G.hair);
  assert.equal(one(rest, "border_color"), "#00000000");
  text.state.handlers.focus({}, notify);
  assert.equal(one(field("f", text, c), "border_color"), c.accent);
  assert.equal(one(parts(field("f", text, c)).box, "border_color"), c.input, "the edge stays");
  text.state.handlers.blur({}, notify);
  assert.equal(one(field("f", text, c), "border_color"), "#00000000");
});

test("An error turns the edge to the blocked colour, and hover leaves it", async () => {
  const { field, TextField, tokens } = await kit();
  const c = tokens(night);
  const { box } = parts(field("f", new TextField(), c, { error: true }));
  assert.equal(one(box, "border_color"), c.blocked);
  assert.equal(calls(box, "hover").length, 0);
});

test("Off: a w4 ground, dim text, nothing to type into or hover", async () => {
  const { field, TextField, tokens, mix, WASH } = await kit();
  const c = tokens(night);
  const { box, editor } = parts(field("f", new TextField({ value: "cart-retry" }), c, { disabled: true }));
  assert.equal(one(box, "bg"), mix(c.text, c.background, WASH.off));
  assert.equal(calls(box, "hover").length, 0);
  assert.equal(editor.tag, "div");
  assert.equal(one(editor, "text_color"), c.dim);
  assert.equal(calls(editor, "cursor_pointer").length, 0);
});

test("A trailing icon button is 24 with a 15 icon, 4 from the edge", async () => {
  const { field, TextField, tokens, G, H, ICON } = await kit();
  const c = tokens(night);
  const { box, editor, icon } = parts(field("f", new TextField(), c, { icon: "send", iconTip: "Send", onIcon: () => {} }));
  assert.equal(one(box, "pr"), G.xs);
  assert.equal(one(box, "gap"), G.sm);
  assert.equal(calls(editor, "pr").length, 0);
  assert.equal(one(icon, "h"), H.compact);
  assert.equal(one(icon, "w"), H.compact);
  assert.equal(one(icon.kids[0], "size"), ICON);
});

test("Multi-line grows with its text from the tall size", async () => {
  const { field, TextField, FIELD_LINES, tokens, G, H } = await kit();
  const c = tokens(night);
  const text = new TextField({ value: "Batching looks right." }, { multiline: true });
  assert.equal(text.state.kind, "textarea");
  assert.deepEqual(text.state.grow, [[1, FIELD_LINES]]);
  const { box, editor } = parts(field("f", text, c));
  assert.equal(editor.tag, "textarea");
  assert.equal(one(box, "min_h"), H.control * 2 + G.md);
  assert.equal(calls(box, "h").length, 0);
  assert.equal(one(editor, "py"), G.sm);
});

test("A label sits 8 above in 12.5 medium muted", async () => {
  const { field, TextField, tokens, G, T } = await kit();
  const c = tokens(night);
  const col = field("f", new TextField(), c, { label: "Name" });
  assert.equal(one(col, "gap"), G.sm);
  const [label, ring] = col.kids;
  assert.equal(one(label, "text_size"), T.value);
  assert.equal(calls(label, "font_medium").length, 1);
  assert.equal(one(label, "text_color"), c.muted);
  assert.equal(one(parts(ring).editor, "accessibility_label"), "Name");
});

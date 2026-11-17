// One button in four kinds: its box from the tokens, its washes, focus and off.
import test from "node:test";
import assert from "node:assert/strict";
import { load, gpuiHost, calls, one, styled, themed, eachTheme } from "./helpers.mjs";

const kit = async () => themed({ ...await load("kanso-panel/ui.js", ["mix", "WASH", "tokens", "G", "H", "R", "T", "ICON", "ICON_ROW", "ICON_INLINE"], gpuiHost()), ...await load("kanso-panel/ui-button.js", ["button", "quietLink", "iconButton"], gpuiHost()) }, night);

const night = { background: "#1b1b19", foreground: "#d8d4cb", hover: "#232321", selected: "#2b2b28", solid: "#d8d4cb", solid_foreground: "#161615", accent: "#da627d", accent_foreground: "#161615", dim: "#6b6860", muted: "#949086" };
const day = { background: "#f4f1eb", foreground: "#3c3934", hover: "#ebe6de", selected: "#e0dbd2", solid: "#3c3934", solid_foreground: "#f4f1eb", accent: "#b8405e", accent_foreground: "#f4f1eb", dim: "#a19c92", muted: "#7a756c" };

test("mix lays one colour over an opaque ground, and leaves anything it cannot read", async () => {
  const { mix } = await kit();
  assert.equal(mix("#ffffff", "#000000", 0.5), "#808080");
  assert.equal(mix("#d8d4cb", "#1b1b19", 1), "#d8d4cb");
  assert.equal(mix("#d8d4cb", "#1b1b19", 0), "#1b1b19");
  assert.equal(mix("red", "#000000", 0.5), "red");
});

test("Every kind is one box from the tokens: 30 high, 12 inside, radius 6, and the small kind 24 with 8", async () => {
  const { button, G, H, R, T, c } = await kit();
  for (const kind of ["solid", "tonal", "quiet"]) {
    for (const small of [false, true]) {
      const el = button("b", "Merge", () => {}, c, { kind, small });
      assert.equal(one(el, "h"), small ? H.compact : H.control);
      assert.equal(one(el, "px") + G.hair, small ? G.sm : G.md, "the ring's border counts inside the padding");
      assert.equal(one(el, "rounded"), R.control);
      assert.equal(one(el, "gap"), G.sm);
      const label = el.kids.at(-1);
      assert.equal(one(label, "text_size"), small ? T.body : T.value);
      assert.equal(calls(label, "font_medium").length, 1);
    }
  }
  const icon = button("i", "Refresh", () => {}, c, { kind: "icon", icon: "refresh-cw" });
  assert.equal(one(icon, "h"), H.icon);
  assert.equal(one(icon, "w"), H.icon);
  assert.equal(one(icon, "tooltip"), "Refresh");
  assert.equal(calls(icon, "px").length, 0);
});

test("Solid, tonal and quiet wash from the theme, press with the selected wash, and a quiet label is muted", async () => {
  const { button, tokens, mix, WASH } = await kit();
  for (const { theme, c } of eachTheme(tokens, night, day)) {
    const solid = button("s", "Merge", () => {}, c);
    assert.equal(one(solid, "bg"), c.primary);
    assert.deepEqual(styled(solid, "hover"), [["bg", mix(c.primary, c.background, WASH.hover)]]);
    assert.deepEqual(styled(solid, "active"), [["bg", mix(c.primary, c.background, WASH.press)]]);
    assert.equal(one(solid.kids.at(-1), "text_color"), c.primaryText);

    const tonal = button("t", "Refresh", () => {}, c, { kind: "tonal" });
    assert.equal(one(tonal, "bg"), theme.hover);
    assert.deepEqual(styled(tonal, "hover"), [["bg", theme.selected]]);
    assert.deepEqual(styled(tonal, "active"), [["bg", theme.selected]]);
    assert.equal(calls(tonal, "border_1").length, 0, "tonal has no edge");

    const quiet = button("q", "Cancel", () => {}, c, { kind: "quiet" });
    assert.equal(calls(quiet, "bg").length, 0, "quiet is text only");
    assert.deepEqual(styled(quiet, "hover"), [["bg", theme.hover]]);
    assert.deepEqual(styled(quiet, "active"), [["bg", theme.selected]]);
    assert.equal(one(quiet.kids.at(-1), "text_color"), c.muted);
  }
});

test("Focus is an accent ring on a border kept clear at rest, so the box never changes size", async () => {
  const { button, c } = await kit();
  for (const kind of ["solid", "tonal", "quiet", "icon"]) {
    const el = button("f", "Merge", () => {}, c, { kind, icon: kind === "icon" ? "copy" : null });
    assert.equal(calls(el, "border_2").length, 1);
    assert.equal(one(el, "border_color"), "#00000000");
    assert.deepEqual(styled(el, "focus"), [["border_color", c.accent]]);
  }
});

test("Off is a w4 fill with dim text for solid and icon alike, and never reacts to the pointer", async () => {
  const { button, tokens, mix, WASH } = await kit();
  const c = tokens(day);
  let pressed = 0;
  for (const kind of ["solid", "icon"]) {
    const el = button("o", "Merge", () => { pressed += 1; }, c, { kind, icon: kind === "icon" ? "copy" : null, disabled: true });
    assert.equal(one(el, "disabled"), true);
    assert.equal(one(el, "bg"), mix(c.text, c.background, WASH.off));
    for (const name of ["hover", "active", "on_click", "cursor_pointer"]) assert.equal(calls(el, name).length, 0, name);
  }
  const quiet = button("oq", "Cancel", () => {}, c, { kind: "quiet", disabled: true });
  assert.equal(calls(quiet, "bg").length, 0);
  assert.equal(one(quiet.kids.at(-1), "text_color"), c.dim);
  assert.equal(pressed, 0);
});

test("A press runs the action; armed fills with the accent and reads Press again to <verb>", async () => {
  const { button, c } = await kit();
  const ran = [];
  const el = button("a", "Remove", (cx) => ran.push(cx), c, { verb: "remove", armed: true });
  assert.equal(one(el, "bg"), c.accent);
  assert.equal(one(el, "accessibility_label"), "Press again to remove");
  for (const label of el.kids.at(-1).kids) assert.equal(one(label, "text_color"), c.accentText);
  one(el, "on_click")(null, "cx");
  assert.deepEqual(ran, ["cx"]);
});

test("Arming changes no width: both labels share one cell at rest and armed, the hidden one at no height", async () => {
  const { button, tokens } = await kit();
  const c = tokens(day);
  const words = (cell) => cell.kids.map((label) => one(label, "child"));
  const hidden = (cell) => cell.kids.map((label) => calls(label, "h").some((call) => call[1] === 0) && calls(label, "overflow_hidden").length === 1);
  for (const [kind, small] of [["solid", false], ["tonal", true], ["quiet", true]]) {
    const rest = button("r", "Delete", () => {}, c, { kind, small, verb: "delete" });
    const armed = button("r", "Delete", () => {}, c, { kind, small, verb: "delete", armed: true });
    const [restCell, armedCell] = [rest.kids.at(-1), armed.kids.at(-1)];
    assert.deepEqual(words(restCell), ["Delete", "Press again to delete"], kind);
    assert.deepEqual(words(armedCell), words(restCell), kind);
    assert.deepEqual(hidden(restCell), [false, true], kind);
    assert.deepEqual(hidden(armedCell), [true, false], kind);
    for (const cell of [restCell, armedCell]) for (const label of cell.kids) assert.equal(calls(label, "whitespace_nowrap").length, 1);
    for (const name of ["h", "px", "gap", "rounded", "w", "min_w", "max_w"]) assert.deepEqual(calls(armed, name), calls(rest, name), `${kind} ${name}`);
  }
});
test("quietLink and iconButton are the quiet and icon kinds", async () => {
  const { quietLink, iconButton, H, ICON, c } = await kit();
  const link = quietLink("l", "Open", () => {}, c, { label: "Open the file" });
  assert.equal(one(link, "h"), H.compact);
  assert.equal(one(link, "accessibility_label"), "Open the file");
  assert.equal(calls(link, "bg").length, 0);
  assert.equal(one(link.kids.at(-1), "text_color"), c.muted);
  const icon = iconButton("ic", "pin", "Stay on this agent", () => {}, c, { active: true });
  assert.equal(one(icon, "h"), H.icon);
  assert.equal(one(icon, "bg"), c.selected);
  assert.equal(one(icon.kids[0], "size"), ICON);
});

test("A small icon button is the row's tool, 20 with a 12 glyph, and the field's small icon and the plain one keep 24 and 26 with 15", async () => {
  const { button, H, T, ICON, ICON_INLINE, c } = await kit();
  const side = (o) => { const el = button("i", "Pin", () => {}, c, { kind: "icon", icon: "pin", ...o }); return [one(el, "h"), one(el, "w"), one(el.kids[0], "size")]; };
  assert.deepEqual([H.badge, ICON_INLINE], [20, 12]);
  assert.deepEqual(side({ size: "sm" }), [H.badge, H.badge, ICON_INLINE]);
  assert.deepEqual(side({ small: true }), [H.compact, H.compact, ICON]);
  assert.deepEqual(side({}), [H.icon, H.icon, ICON]);
  const text = button("w", "Wake", () => {}, c, { kind: "quiet", size: "sm" });
  assert.equal(one(text, "h"), H.compact, "a small text button is the compact one");
  assert.equal(one(text.kids.at(-1), "text_size"), T.body);
});

test("A trimmed button cuts a long label at the token's width, as Spend's project menu does (press-targets checks it uses it), and any other grows with its label", async () => {
  const { button, c } = await kit();
  const { W } = await load("kanso-panel/ui.js", ["W"], gpuiHost());
  const long = "a-project-folder-with-a-very-long-name-that-would-push-the-filters-away";
  const label = (o) => button("b", long, () => {}, c, { kind: "quiet", small: true, icon: "chevron-down", ...o }).kids.at(-1);
  assert.equal(one(label({ truncate: true }), "max_w"), W.buttonLabel);
  assert.equal(calls(label({ truncate: true }), "truncate").length, 1);
  assert.equal(calls(label({}), "max_w").length, 0);
});

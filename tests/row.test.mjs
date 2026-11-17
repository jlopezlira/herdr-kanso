// The row: one named item with its facts, mark and tools, in every state its Storybook story shows.
import { loadRow, loadPendingState } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, numberArguments, calls, one, styled, themed, KIT_NIGHT, drawingHost } from "./helpers.mjs";
import { marks, rowDepths } from "../stories/kit/pieces.js";

const kit = async () => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "G", "H", "R", "T", "ICON_ROW", "ICON_INLINE", "CLEAR"], drawingHost()),
  ...await loadPendingState(drawingHost()),
  ...await loadRow(drawingHost()),
}, night);

const all = (el) => [el, ...el.kids.flatMap(all)];
const byTag = (el, tag) => all(el).find((kid) => kid.tag === tag);
const svgs = (el) => all(el).flatMap((kid) => calls(kid, "svg").map((call) => call[1]));
const texts = (el) => all(el).flatMap((kid) => calls(kid, "child").map((call) => call[1]).filter((value) => typeof value === "string"));
const line = (el) => all(el).find((kid) => kid.tag === "h_flex" && kid !== el);

const night = KIT_NIGHT;
const tools = (hits = []) => [{ icon: "pin", label: "Pin", onClick: () => hits.push("pin") }, { icon: "ellipsis", label: "More", onClick: () => hits.push("more") }];

test("A row at rest is one line from the tokens: 32 high, 8 inside, radius 6, the body size, its ring kept clear, and washes on hover and press", async () => {
  const { row, G, H, R, T, CLEAR, c } = await kit();
  const el = row("r", c, { icon: "file", name: "checkout.ts", detail: "src/api", meta: "+14 −3" });
  assert.equal(one(el, "id"), "r");
  assert.equal(one(el, "h"), H.line);
  assert.equal(one(el, "pl") + G.hair, G.sm, "the ring's border counts inside the padding");
  assert.equal(one(el, "pr") + G.hair, G.sm);
  assert.equal(one(el, "mx"), -G.sm);
  assert.equal(one(el, "rounded"), R.control);
  assert.equal(one(el, "text_size"), T.value);
  assert.equal(one(el, "border_color"), CLEAR);
  assert.equal(calls(el, "bg").length, 0);
  assert.deepEqual(styled(el, "hover"), [["bg", c.subtle]]);
  assert.deepEqual(styled(el, "active"), [["bg", c.selected]], "a press is the selected wash");
  assert.deepEqual(texts(el), ["checkout.ts", "src/api", "+14 −3"]);
  assert.deepEqual(svgs(el), ["mods/kanso-chrome/icons/file.svg"]);
});

test("The meta is the meta size in dim, and the detail's facts are dim, each with its inline icon", async () => {
  const { row, T, ICON_INLINE, c } = await kit();
  const el = row("r", c, { name: "kansō", detail: ["herdr-kanso", { icon: "git-branch", text: "main" }], meta: "2m" });
  const meta = all(el).find((kid) => calls(kid, "child").some((call) => call[1] === "2m"));
  assert.equal(one(meta, "text_size"), T.body);
  assert.equal(one(meta, "text_color"), c.dim);
  const detail = all(el).find((kid) => calls(kid, "whitespace_nowrap").length && calls(kid, "children").length);
  assert.equal(one(detail, "text_color"), c.dim);
  const branch = all(detail).find((kid) => calls(kid, "svg").length);
  assert.equal(one(branch, "size"), ICON_INLINE);
  assert.deepEqual(texts(el), ["kansō", "herdr-kanso", "main", "2m"]);
});

test("Each depth steps in by the lead icon and its gap, and depth two draws its guide under the parent's icon", async () => {
  const { row, G, ICON_ROW, c } = await kit();
  const pads = rowDepths.map((depth) => one(row("r", c, { name: "Juno", depth }), "pl") + G.hair);
  assert.deepEqual(pads, [G.sm, G.sm * 2 + ICON_ROW, G.sm * 3 + ICON_ROW * 2]);
  assert.deepEqual(pads, [8, 30, 52]);
  const deep = row("r", c, { name: "Juno", depth: 2 });
  const guide = deep.kids.find((kid) => calls(kid, "absolute").length);
  assert.equal(one(guide, "left"), G.sm * 2 + ICON_ROW * 1.5);
  assert.equal(one(guide, "border_color"), c.w12);
  for (const depth of [0, 1]) assert.equal(row("r", c, { name: "Juno", depth }).kids.some((kid) => calls(kid, "absolute").length), false, `depth ${depth}`);
});

test("Heading, current, selected, focus, dimmed and pending are each one state of the same row", async () => {
  const { row, PENDING, c } = await kit();
  const name = (el) => all(el).find((kid) => calls(kid, "child").some((call) => call[1] === "kansō"));
  assert.equal(calls(name(row("r", c, { name: "kansō", heading: true })), "font_semibold").length, 1);
  assert.equal(calls(name(row("r", c, { name: "kansō" })), "font_semibold").length, 0);
  const current = row("r", c, { name: "kansō", current: true });
  assert.equal(one(current, "bg"), c.selected);
  assert.deepEqual(styled(current, "hover"), [["bg", c.selected]], "the current row keeps its wash under the pointer");
  assert.equal(one(row("r", c, { name: "kansō", selected: true }), "border_color"), c.accent);
  assert.equal(one(row("r", c, { name: "kansō", focus: true }), "border_color"), c.accent);
  assert.equal(one(row("r", c, { name: "kansō", hover: true }), "bg"), c.subtle);
  const dimmed = row("r", c, { name: "kansō", meta: "3m", dimmed: true });
  assert.equal(one(dimmed, "text_color"), c.muted);
  assert.equal(one(name(dimmed), "text_color"), c.muted);
  const pending = row("r", c, { name: "kansō", pending: true });
  assert.equal(one(pending, "opacity"), PENDING);
  assert.ok(all(pending).some((kid) => calls(kid, "id").some((call) => call[1] === "r-pending")), "the pending dot breathes beside it");
});

test("Two lines put the second fact under the name in the meta size, dim, and let the row grow", async () => {
  const { row, G, T, c } = await kit();
  const el = row("r", c, { name: "Atlas", second: "Reviewing step 01", meta: "3m" });
  assert.equal(calls(el, "h").length, 0);
  assert.equal(one(el, "py") + G.hair, G.sm);
  const body = byTag(el, "v_flex");
  assert.equal(one(body, "gap"), G.sm);
  const second = body.kids.at(-1);
  assert.equal(one(second, "text_size"), T.body);
  assert.equal(one(second, "text_color"), c.dim);
  assert.deepEqual(texts(el), ["Atlas", "3m", "Reviewing step 01"]);
});

test("The mark closes the row in every state the kit draws, and none draws nothing", async () => {
  const { row, c } = await kit();
  const last = (el) => line(el).kids.at(-1);
  for (const status of Object.keys(marks)) assert.ok(last(row("r", c, { name: "Nova", chip: 2, mark: status })), status);
  assert.deepEqual(texts(last(row("r", c, { name: "Nova", chip: 2, mark: "none" }))), ["2"], "with no mark the chip ends the row");
});

test("The flag and the chip sit after the meta, and the flag is a row icon in dim", async () => {
  const { row, ICON_ROW, c } = await kit();
  const el = row("r", c, { name: "Juno", meta: "3m", flag: "pin", chip: 4 });
  const kids = line(el).kids;
  const flag = kids.find((kid) => calls(kid, "svg").some((call) => call[1].endsWith("pin.svg")));
  assert.equal(one(flag, "size"), ICON_ROW);
  assert.equal(one(flag, "text_color"), c.dim);
  assert.deepEqual(texts(el), ["Juno", "3m", "4"]);
});

test("Tools wait for the pointer or the keyboard, then take the meta's and the flag's place as small icon buttons", async () => {
  const { row, H, ICON_INLINE, c } = await kit();
  const rest = row("r", c, { name: "Juno", meta: "3m", flag: "pin", actions: tools() });
  assert.equal(all(rest).some((kid) => kid.tag === "r-tool-0"), false);
  assert.deepEqual(texts(rest), ["Juno", "3m"]);
  for (const state of [{ hover: true }, { focus: true }]) {
    const shown = row("r", c, { name: "Juno", meta: "3m", flag: "pin", actions: tools(), ...state });
    const pin = byTag(shown, "r-tool-0"), more = byTag(shown, "r-tool-1");
    assert.ok(pin && more, JSON.stringify(state));
    assert.deepEqual([one(pin, "h"), one(pin, "w"), one(pin.kids[0], "size")], [H.badge, H.badge, ICON_INLINE]);
    assert.equal(one(more, "tooltip"), "More");
    assert.deepEqual(texts(shown), ["Juno"], "meta gives way to the tools");
    assert.equal(svgs(shown).filter((path) => path.endsWith("pin.svg")).length, 1, "the flag gives way too");
  }
  const bare = row("r", c, { name: "Juno", meta: "3m", hover: true });
  assert.deepEqual(texts(bare), ["Juno", "3m"], "with no tools the meta stays under the pointer");
});

// A press bubbles from the innermost handler out, until one stops it.
const press = (...handlers) => {
  const state = { stopped: false };
  const cx = { stop_propagation: () => { state.stopped = true; }, notify: () => {} };
  for (const handler of handlers) {
    if (state.stopped) break;
    handler({ click_count: 1 }, cx);
  }
};

test("Clicking the action runs its handler once, and the row's own click does not run", async () => {
  const { row, c } = await kit();
  const hits = [];
  const el = row("r", c, { name: "site", dimmed: true, depth: 1, action: { label: "Wake", kind: "quiet", onClick: () => hits.push("wake") }, onClick: () => hits.push("row") });
  const wake = byTag(el, "r-action");
  assert.equal(one(wake, "h") > 0, true);
  press(one(wake, "on_click"), one(el, "on_click"));
  assert.deepEqual(hits, ["wake"]);
  press(one(el, "on_click"));
  assert.deepEqual(hits, ["wake", "row"]);
});

test("Clicking a tool runs that tool once and not the row", async () => {
  const { row, c } = await kit();
  const hits = [];
  const el = row("r", c, { name: "Juno", hover: true, actions: tools(hits), onClick: () => hits.push("row") });
  press(one(byTag(el, "r-tool-1"), "on_click"), one(el, "on_click"));
  assert.deepEqual(hits, ["more"]);
});

test("The row takes its click, hover, keyboard and focus from the caller, and wires none it is not given", async () => {
  const { row, c } = await kit();
  const onHover = () => {}, onKey = () => {}, focusHandle = { is_focused: () => false };
  const wired = row("r", c, { name: "Juno", onClick: () => {}, onHover, onKey, focusHandle });
  assert.equal(calls(wired, "on_click").length, 1);
  assert.equal(calls(wired, "cursor_pointer").length, 1);
  assert.equal(one(wired, "on_hover"), onHover);
  assert.equal(one(wired, "on_key_down"), onKey);
  assert.equal(one(wired, "track_focus"), focusHandle);
  assert.deepEqual(styled(wired, "focus"), [["border_color", c.accent]]);
  const bare = row("r", c, { name: "Juno" });
  for (const name of ["on_click", "cursor_pointer", "on_hover", "on_key_down", "track_focus", "focus"]) assert.equal(calls(bare, name).length, 0, name);
});

test("The row's code has no number of pixels: every size comes from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-row.js"), []);
});

test("The title form is the panel's title line: 40 high, the title size, semibold, and no wash under the pointer or the press", async () => {
  const { row, H, T, G, c } = await kit();
  const name = (el) => all(el).find((kid) => calls(kid, "child").some((call) => call[1] === "Pull request"));
  const el = row("r", c, { name: "Pull request", title: true, hover: true });
  assert.equal(one(el, "h"), H.row);
  assert.equal(one(name(el), "text_size"), T.page);
  assert.equal(calls(name(el), "font_semibold").length, 1);
  for (const style of ["hover", "active", "bg"]) assert.equal(calls(el, style).length, 0, style);
  const scoped = row("r", c, { name: "Pull request", title: true, second: "kansō · main" });
  assert.equal(calls(scoped, "h").length, 0, "with its scope line the row grows");
  assert.equal(calls(scoped, "py").length, 0, "and keeps no padding above and below");
  assert.equal(one(line(scoped), "h"), H.row);
  assert.equal(one(byTag(scoped, "v_flex"), "gap"), G.sm);
});

test("A tone colours the lead icon, and the drawn start comes before it", async () => {
  const { row, tokens, ICON_ROW } = await kit();
  const { toneColor } = await load("kanso-panel/ui.js", ["toneColor"], drawingHost());
  const c = tokens(night);
  const grip = chain("grip");
  const el = row("r", c, { icon: "circle-alert", tone: "blocked", name: "Build failed", start: [grip] });
  const [first, icon] = line(el).kids;
  assert.equal(first, grip);
  assert.equal(one(icon, "size"), ICON_ROW);
  assert.equal(one(icon, "text_color"), toneColor(c, "blocked"));
  assert.equal(one(line(row("r", c, { icon: "file", name: "a.ts" })).kids[0], "text_color"), c.text, "with no tone the icon takes the row's ink");
});

test("Tools are always shown after the action, and key hints close the right side before the mark", async () => {
  const { row, c } = await kit();
  const reset = chain("reset");
  const el = row("r", c, { name: "Next agent", tools: [reset], keys: [{ text: "⌘⇧↓" }, { text: "No key", faint: true }], action: { label: "Change", kind: "quiet" }, mark: "done", meta: "changed" });
  const kids = line(el).kids;
  const at = (kid) => kids.indexOf(kid);
  const hints = kids.filter((kid) => calls(kid, "border_1").length);
  assert.deepEqual(hints.map((kid) => calls(kid, "child")[0][1]), ["⌘⇧↓", "No key"]);
  assert.ok(at(byTag(el, "r-action")) < at(reset) && at(reset) < at(hints[0]), "action, tools, then keys");
  assert.equal(at(hints[1]), kids.length - 2, "the mark stays last");
  assert.ok(texts(el).includes("changed"), "tools do not hide the meta: only the hover tools do");
});

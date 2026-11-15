// The state mark: every status and size the Storybook draws, from the tokens, and nothing for any other status.
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost, numberArguments } from "./helpers.mjs";
import { marks, markSizes } from "../stories/kit/pieces.js";

const host = () => ({ ...gpuiHost(), svg: (path) => { const el = chain("svg"); el.calls.push(["svg", path]); return el; } });
const kit = async () => ({
  ...await load("kanso-panel/ui.js", ["tokens", "ICON", "ICON_ROW", "ICON_INLINE", "SPIN"], host()),
  ...await load("kanso-panel/ui-mark.js", ["mark", "MARK_SIZES"], host()),
});

const calls = (el, name) => el.calls.filter((call) => call[0] === name);
const one = (el, name) => {
  const found = calls(el, name);
  assert.equal(found.length, 1, name);
  return found[0][1];
};

const night = { foreground: "#d8d4cb", background: "#1b1b19", chrome: "#161615", working: "#c4b07e", blocked: "#ca938b", done: "#98ad8f", idle: "#a3a09a", dim: "#6b6862", muted: "#949086" };
const ICONS = "mods/kanso-chrome/icons/";

test("Each status the Storybook draws has its own ensō art and colour", async () => {
  const { mark, tokens } = await kit();
  const c = tokens(night);
  const art = { working: ["working", c.working], done: ["enso", c.done], idle: ["enso-idle", c.idle], asleep: ["moon", c.muted] };
  assert.deepEqual(Object.keys(marks).sort(), [...Object.keys(art), "blocked"].sort());
  for (const [status, [name, color]] of Object.entries(art)) {
    const el = mark(c, { status });
    assert.equal(one(el, "svg"), `${ICONS}${name}.svg`, status);
    assert.equal(one(el, "text_color"), color, status);
  }
});

test("The working ring turns at the spinner's token pace, and the idle ring is faint", async () => {
  const { mark, tokens, SPIN } = await kit();
  const c = tokens(night);
  assert.equal(SPIN, 900);
  assert.equal(one(mark(c, { status: "working" }), "spin"), SPIN);
  assert.equal(one(mark(c, { status: "idle" }), "opacity"), 0.7);
  for (const status of ["blocked", "done", "asleep"]) assert.equal(calls(mark(c, { status }), "spin").length, 0, status);
});

test("A blocked agent is a round dot in the blocked colour with an exclamation mark in the chrome colour", async () => {
  const { mark, tokens } = await kit();
  const c = tokens(night);
  const el = mark(c, { status: "blocked" });
  assert.equal(el.tag, "div");
  assert.equal(calls(el, "rounded_full").length, 1);
  assert.equal(one(el, "bg"), night.blocked);
  assert.equal(one(el, "text_color"), night.chrome);
  assert.equal(one(el, "child"), "!");
  assert.equal(calls(el, "font_bold").length, 1);
});

test("Small, medium and large are the inline, row and control icon tokens, and medium is the default", async () => {
  const { mark, tokens, MARK_SIZES, ICON, ICON_ROW, ICON_INLINE } = await kit();
  const c = tokens(night);
  assert.deepEqual(Object.keys(MARK_SIZES), Object.keys(markSizes));
  assert.deepEqual({ ...MARK_SIZES }, { sm: ICON_INLINE, md: ICON_ROW, lg: ICON });
  assert.deepEqual([ICON_INLINE, ICON_ROW, ICON], [12, 14, 15]);
  for (const status of Object.keys(marks)) {
    for (const [size, side] of Object.entries(MARK_SIZES)) assert.equal(one(mark(c, { status, size }), "size"), side, `${status} ${size}`);
    assert.equal(one(mark(c, { status }), "size"), ICON_ROW, status);
  }
});

test("Any other status draws nothing, so a row without a status keeps no mark", async () => {
  const { mark, tokens } = await kit();
  const c = tokens(night);
  for (const status of [null, undefined, "", "none", "unknown", "constructor", "toString"]) assert.equal(mark(c, { status }), null, String(status));
});

test("The mark's code has no number of pixels: every size comes from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-mark.js"), []);
});

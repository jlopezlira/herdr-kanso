// The switch: the knob's end, in both states, from the element tree.
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./helpers.mjs";

function chain() {
  const calls = [];
  let knob;
  const node = new Proxy({}, {
    get(_target, prop) {
      if (prop === "calls") return calls;
      if (prop === "knob") return knob;
      if (prop === "when") return (condition, build) => {
        calls.push(["when", Boolean(condition)]);
        return condition ? build(node) : node;
      };
      if (prop === "child") return (child) => { calls.push(["child"]); knob = child; return node; };
      return (...args) => { calls.push([String(prop), ...args]); return node; };
    },
  });
  return node;
}

const host = () => ({
  div: () => chain(),
  Toggle: { new: (id) => { const el = chain(); el.calls.push(["new", id]); return el; } },
});

const kit = () => load("kanso-panel/ui.js", ["toggleSwitch", "H", "G"], host());

const arg = (el, name) => {
  const found = el.calls.filter((call) => call[0] === name);
  assert.equal(found.length, 1, name);
  return found[0][1];
};

const day = { primary: "#3c3934", primaryText: "#f4f1eb", raised: "#faf8f4", input: "#d4cec4", muted: "#7a756c", accent: "#b8405e" };
const night = { primary: "#d8d4cb", primaryText: "#161615", raised: "#262624", input: "#353430", muted: "#949086", accent: "#da627d" };

test("A switch parks its knob at the left when off and at the right when on", async () => {
  const { toggleSwitch, H, G } = await kit();
  const pad = G.xs;
  const knob = H.compact - pad * 2 - 2;
  const width = knob * 2 + pad * 2 + 2;
  for (const [checked, end] of [[false, "justify_start"], [true, "justify_end"]]) {
    const track = toggleSwitch("mods", checked, () => {}, night);
    assert.equal(arg(track, "w"), width);
    assert.equal(arg(track, "h"), H.compact);
    assert.equal(arg(track, "p"), pad);
    assert.equal(track.calls.filter((call) => call[0] === "items_center").length, 1);
    const justify = track.calls.filter((call) => call[0] === "justify_start" || call[0] === "justify_end").map((call) => call[0]);
    assert.equal(justify.at(-1), end);
    assert.equal(arg(track.knob, "size"), knob);
    assert.equal(track.knob.calls.some((call) => call[0] === "flex_none"), true);
    assert.equal(track.knob.calls.some((call) => call[0] === "ml" || call[0] === "mr"), false);
    assert.equal(track.calls.filter((call) => call[0] === "bg").length, 1, "the track has one fill");
    assert.equal(track.knob.calls.filter((call) => call[0] === "bg").length, 1, "the knob has one fill");
    assert.equal(track.knob.calls.some((call) => call[0] === "border_1" || call[0] === "shadow_sm"), false);
  }
});

test("A switch fills from the theme when on and marks focus, in light and in dark", async () => {
  const { toggleSwitch } = await kit();
  for (const c of [day, night]) {
    for (const checked of [false, true]) {
      let handed;
      const track = toggleSwitch("auto", checked, (next) => { handed = next; }, c, { label: "Check for updates automatically" });
      assert.equal(arg(track, "bg"), checked ? c.primary : c.raised);
      assert.equal(arg(track, "border_color"), checked ? c.primary : c.input);
      assert.equal(track.calls.filter((call) => call[0] === "border_1").length, 1);
      assert.equal(arg(track, "pressed"), checked);
      assert.equal(arg(track, "accessibility_label"), "Check for updates automatically");
      assert.equal(arg(track.knob, "bg"), checked ? c.primaryText : c.muted);
      const focus = chain();
      arg(track, "focus")(focus);
      assert.deepEqual(focus.calls, [["border_color", c.accent]]);
      const cx = { notify() { cx.notified = true; } };
      arg(track, "on_change")(!checked, cx);
      assert.equal(handed, !checked);
      assert.equal(cx.notified, true);
    }
  }
});

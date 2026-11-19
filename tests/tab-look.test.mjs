import test from "node:test";
import assert from "node:assert/strict";
import { gpuiHost, load, calls, arg, kansoColours } from "./helpers.mjs";

const tabItems = (first = {}, second = {}, third = {}) => [
  { key: "checkout", label: "checkout", ...first },
  { key: "cart-ui", label: "cart-ui", mark: "blocked", ...second },
  { key: "tests", label: "tests", ...third },
];
const look = (ink, extra = {}) => ({ gap: 8, h: 28, rounded: 6, text_size: 13, text_color: ink, ...extra });
const CHOSEN = look("text", { bg: "w12" }), REST = look("muted");
const TABS = [
  { label: "At rest", items: tabItems(), want: [CHOSEN, REST, REST] },
  { label: "Close armed", items: tabItems({ armed: true, tip: "Press again to close checkout" }), want: [look("accentText", { bg: "accent" }), REST, REST] },
  { label: "Renaming", items: tabItems({ editing: true }), want: [CHOSEN, REST, REST] },
  { label: "Renamed on devbox, waiting", items: tabItems({ label: "api-limits", pending: true }), want: [look("text", { bg: "w12", opacity: 0.8 }), REST, REST] },
  { label: "Dragging", items: tabItems({}, { drop: true }, { held: true }), want: [CHOSEN, REST, look("muted", { bg: "selected" })] },
  { label: "Long name", items: tabItems({}, {}, { label: "retry-after-header-for-cart-and-checkout" }), want: [CHOSEN, REST, REST] },
  { label: "Unreachable", items: tabItems(), disabled: true, want: [look("dim", { bg: "w12" }), look("dim"), look("dim")] },
];
const DOORS = ["Files", "Spend", "PR", "Shipped", "Worktrees", "Ports", "Containers", "Memory", "Images"];
const appButton = async () => ({ ...(await load("kanso-panel/ui-button.js", ["button"], gpuiHost())), c: await kansoColours() });

test("Each tab in each state draws its height, radius, gap, text size, ground, ink and opacity", async () => {
  const { tab } = await load("kanso-panel/ui-tab.js", ["tab"], gpuiHost());
  const c = await kansoColours();
  const field = { state: {}, value: () => "checkout", focused: false, multiline: false };
  for (const { label, items: given, disabled = false, want } of TABS) {
    const items = given.map((item) => ({ closable: true, ...item, ...(item.editing ? { editing: field } : {}) }));
    const drawn = tab("t", items, "checkout", null, c, { track: false, size: "md", bar: true, disabled,
      on: Object.fromEntries(items.map(({ key }) => [key, { onClose: () => {} }])) });
    const tabs = drawn.kids.filter((kid) => calls(kid, "set_position").length);
    assert.equal(tabs.length, want.length, label);
    want.forEach((ops, i) => {
      for (const [op, value] of Object.entries(ops)) {
        assert.deepEqual(arg(tabs[i], op), op === "bg" || op === "text_color" ? c[value] : value, `${label}, tab ${i}: ${op}`);
      }
    });
  }
});

test("Connecting draws each tab's skeleton 28 high on radius 4, the first 92 wide and the rest 64", async () => {
  const { tabSkeleton } = await load("kanso-panel/ui-skeleton.js", ["tabSkeleton"], gpuiHost());
  const c = await kansoColours();
  [92, 64, 64].forEach((w, i) => {
    const drawn = tabSkeleton(`s${i}`, c, i);
    assert.deepEqual([arg(drawn, "w"), arg(drawn, "h"), arg(drawn, "rounded")], [w, 28, 4], `skeleton ${i}`);
  });
});

test("A door is a 28 square icon Button on radius 6 with a 16 icon: muted and groundless when closed, the text ink on wash-12 when open", async () => {
  const { button, c } = await appButton();
  for (const title of DOORS) {
    const open = title === "PR";
    const drawn = button("d", title, () => {}, c, { kind: "icon", icon: "file", active: open });
    assert.deepEqual([arg(drawn, "w"), arg(drawn, "h"), arg(drawn, "rounded")], [28, 28, 6], title);
    assert.equal(arg(drawn.kids[0], "size"), 16, `${title}: its icon`);
    assert.equal(arg(drawn, "bg"), open ? c.w12 : undefined, `${title}: its wash`);
    assert.equal(arg(drawn.kids[0], "text_color"), open ? c.text : c.muted, `${title}: its ink`);
  }
});

test("The same door held is on the selected wash, and held while open keeps its open wash-12", async () => {
  const { button, c } = await appButton();
  for (const [open, want] of [[false, c.selected], [true, c.w12]]) {
    assert.equal(arg(button("d", "Ports", () => {}, c, { kind: "icon", icon: "plug", held: true, active: open }), "bg"), want, open ? "active and held" : "held");
  }
});

// The card over an edge: the panes beyond it as the kit's Menu, each with its agent's mark, a press brings one into view.
import test from "node:test";
import assert from "node:assert/strict";
import { svgsOf as svgs, keyboard, clone } from "./helpers.mjs";
import { loadStripWith } from "./mod-fixtures.mjs";

const program = (name, icon, tint) => ({ agent: true, shell: false, name, icon, tint });
const PANES = [
  { pane: "p1", terminal: "t1", title: "checkout", status: "working", program: program("Claude Code", "mods/kanso-chrome/icons/claude.svg", true) },
  { pane: "p2", terminal: "t2", title: "site", status: "idle", program: program("Codex", "/apps/codex.png", false) },
];

async function edge() {
  const store = {};
  const { Strip } = await loadStripWith({ edge: "p1", panes: ["p1", "p2"], side: "left" }, PANES, store);
  const view = new Strip();
  view.init({}, {});
  return { view, store };
}

const calls = (el, name) => el.calls.filter((call) => call[0] === name);
const all = (el) => [el, ...el.kids.flatMap(all)];
const texts = (el) => all(el).flatMap((kid) => calls(kid, "child").map((call) => call[1]).filter((x) => typeof x === "string"));
const cardOf = (root) => all(root).flatMap((el) => calls(el, "content").map((call) => call[1]))[0];

test("The card over an edge lists each pane beyond it as a Menu item under how many there are, and a press brings that pane into view", async () => {
  const { view, store } = await edge();
  const card = cardOf(view.render());
  assert.ok(card, "the hover card has content");
  assert.equal(texts(card)[0], "2 panes beyond the left edge");
  assert.ok(["Claude Code", "Codex"].every((name) => texts(card).includes(name)), "each pane by its name");
  const items = all(card).filter((el) => /^edge-menu-\d+$/.test(el.tag));
  assert.equal(items.length, 2);
  const stopped = [];
  calls(items[1], "on_click").at(-1)[1]({}, { stop_propagation: () => stopped.push(true) });
  assert.equal(store["strip.req"].op, "focus");
  assert.equal(store["strip.req"].pane, "p2");
  assert.deepEqual(stopped, [true], "the press stays on the item, not the edge under it");
});

test("A pane's agent mark shows only while it works, waits or is done, and its program's art leads the item", async () => {
  const { view } = await edge();
  const card = cardOf(view.render());
  const items = all(card).filter((el) => /^edge-menu-\d+$/.test(el.tag));
  assert.ok(svgs(items[0]).includes("mods/kanso-chrome/icons/claude.svg"), "a tinted program's icon");
  assert.ok(svgs(items[0]).some((path) => /working/.test(path)), "working shows its mark");
  assert.equal(svgs(items[1]).some((path) => /enso-idle/.test(path)), false, "idle shows none");
  assert.ok(all(items[1]).some((kid) => calls(kid, "image").some((call) => call[1] === "/apps/codex.png")), "an untinted program's own picture");
});

test("Tab reaches the edge and each pane's tile, each with the kit's ring, and Enter and Space bring that pane into view", async () => {
  const { view, store } = await edge();
  const keys = keyboard(view.render());
  const walked = ["edge", "edge-tile-p1", "edge-tile-p2"];
  assert.deepEqual(keys.stops.map((stop) => stop.tag).filter((tag) => !tag.startsWith("edge-menu-")), walked, "the edge, then a tile per pane beyond it");
  for (const [tag, pane] of [["edge", "p1"], ["edge-tile-p1", "p1"], ["edge-tile-p2", "p2"]]) {
    const stop = keys.tab();
    assert.equal(stop.tag, tag);
    assert.ok(calls(stop, "focus").length > 0, `${tag}: its ring`);
    for (const key of ["enter", "space"]) {
      store["strip.req"] = null;
      keys.key(key, {});
      assert.deepEqual([store["strip.req"].op, store["strip.req"].pane], ["focus", pane], `${tag}, ${key}`);
    }
  }
  assert.deepEqual(keys.stops.slice(0, 3).map((stop) => calls(stop, "accessibility_label")[0][1]), ["2 panes beyond the left edge", "Claude Code", "Codex"], "each says what it is");
});

test("The edge keeps what the pointer does there: a held pane lands beyond it, the wheel slides the strip, and the card waits as long as before", async () => {
  const { view, store } = await edge();
  store["strip.drag"] = { pane: "p9", at: 1 };
  const root = view.render();
  calls(root, "on_mouse_up").at(-1)[2]({}, {});
  assert.deepEqual(clone([store["strip.req"].op, store["strip.req"].pane, store["strip.req"].to, store["strip.req"].side, store["strip.drag"]]), ["move", "p9", "p1", "after", null]);
  calls(root, "on_scroll_wheel").at(-1)[1]({ delta_lines: { y: -1 } }, {});
  assert.equal(store["strip.req"].op, "scroll");
  const card = all(root).find((el) => calls(el, "content").length > 0);
  assert.deepEqual([calls(card, "open_delay")[0][1], calls(card, "close_delay")[0][1]], [350, 250]);
});

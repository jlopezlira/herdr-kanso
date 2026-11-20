import test from "node:test";
import assert from "node:assert/strict";
import { clone, load, layoutHost } from "./helpers.mjs";
import { loadStrip } from "./mod-fixtures.mjs";

const TAB = "t";
const pane = (id) => ({ pane: id, terminal: `term-${id}`, tab: TAB });
const col = (w, pin) => ({ panes: [`c${w}`], w, ...(pin ? { pin } : {}) });

const quarters = ["p1", "p2", "p3", "p4"].map((id) => ({ panes: [id], w: 1 / 4 }));
const pinned = { panes: ["pin"], w: 1 / 4, pin: "left" };

const stripWith = async (store = {}, { tab = null, focused = null } = {}) => {
  const host = { ...layoutHost(store, () => null, () => {}), focused: () => focused && { pane: focused, terminal: `term-${focused}` }, spaces: () => [{ tabs: [{ id: TAB }] }], theme: () => ({ accent: "#000000" }) };
  const { Strip } = await loadStrip(host);
  const strip = Object.assign(new Strip(), { sets: [], state: tab ? { [TAB]: tab } : {} });
  const ids = tab ? tab.cols.flatMap((c) => c.panes) : [];
  const now = () => strip.state[TAB];
  const widths = () => clone(now().cols.map((c) => c.w));
  const seen = () => clone(strip.shownCols(now()).map((ci) => now().cols[ci].panes[0]));
  const settle = () => strip.commit(TAB, strip.sync(TAB, ids.map(pane)));
  const open = (dir = "right", from = ids.at(-1), id = `p${ids.length + 1}`) => {
    if (ids.length) host.setShared("strip.intent", { dir, from, at: Date.now() + ids.length });
    ids.push(id);
    settle();
  };
  const close = (id) => { ids.splice(ids.indexOf(id), 1); settle(); };
  const shown = () => { strip.refresh(TAB, ids.map(pane), "first", null); return seen(); };
  return { strip, host, now, widths, seen, open, close, shown, ids };
};

test("The page a pane opens on is shared evenly, up to the stepper's number, in strip order", async () => {
  const { paged } = await load("kanso-strip/strip-model.js", ["paged"]);
  const cases = [
    ["one column on its own page", 4, 1, [col(0.3)], 0, [1]],
    ["the second column halves its page", 4, 1, [col(1), col(1)], 1, [1 / 2, 1 / 2]],
    ["the third column makes thirds", 4, 1, [col(0.5), col(0.5), col(1)], 2, [1 / 3, 1 / 3, 1 / 3]],
    ["the fourth column makes quarters", 4, 1, [col(1 / 3), col(1 / 3), col(1 / 3), col(1)], 3, [1 / 4, 1 / 4, 1 / 4, 1 / 4]],
    ["the fifth column starts the next page whole", 4, 1, [...Array(4).fill(col(1 / 4)), col(0.6)], 4, [1 / 4, 1 / 4, 1 / 4, 1 / 4, 1]],
    ["the sixth column halves the next page and leaves the first", 4, 1, [col(0.7), col(0.1), col(0.1), col(0.1), col(1), col(1)], 5, [0.7, 0.1, 0.1, 0.1, 1 / 2, 1 / 2]],
    ["with three a page, the fourth column starts the next page", 3, 1, [...Array(3).fill(col(1 / 3)), col(0.5)], 3, [1 / 3, 1 / 3, 1 / 3, 1]],
    ["with one a page, every column is whole", 1, 1, [col(1), col(0.5)], 1, [1, 1]],
    ["a column opened inside a full page shares that page and leaves the one pushed past it", 2, 1, [col(1 / 2), col(0.4), col(0.9), col(1)], 1, [1 / 2, 1 / 2, 0.9, 1]],
    ["pinned columns keep their width, are not counted, and the page shares what they leave", 2, 0.5, [col(0.2, "left"), col(1), col(0.6), col(0.3, "right")], 2, [0.2, 1 / 4, 1 / 4, 0.3]],
    ["a page opened beside a quarter pin fills the other three quarters", 4, 3 / 4, [col(1 / 4, "left"), ...Array(4).fill(col(1 / 4)), col(1)], 5, [1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 3 / 4]],
    ["the stepper re-pages every column", 2, 1, [col(1 / 4), col(1 / 4), col(1 / 4), col(1 / 4), col(1)], null, [1 / 2, 1 / 2, 1 / 2, 1 / 2, 1]],
    ["the stepper leaves pinned columns as they are and shares what they leave", 3, 3 / 4, [col(0.25, "left"), col(0.5), col(0.5)], null, [0.25, 3 / 8, 3 / 8]],
  ];
  for (const [name, n, view, cols, at, want] of cases) {
    assert.deepEqual(clone(paged(cols, { n, view, at, opened: at !== null }).cols.map((c) => c.w)), want, name);
  }
  assert.deepEqual(clone(paged([col(0.2, "left"), col(1), col(1), col(1)], { n: 2, view: 0.8, at: 3, opened: true }).page), [3], "the page a column lands on, by index");
  assert.deepEqual(clone(paged([col(1), col(1), col(1)], { n: 2, view: 1, at: 1 }).page), [0, 1], "the page of the focused column when the stepper re-pages");
});

test("With four a page, panes opened one by one fill the page evenly, then start the next page beside it", async () => {
  const { open, widths, seen } = await stripWith({ "strip.n": 4 });
  const steps = [
    [[1], ["p1"]],
    [[1 / 2, 1 / 2], ["p1", "p2"]],
    [[1 / 3, 1 / 3, 1 / 3], ["p1", "p2", "p3"]],
    [[1 / 4, 1 / 4, 1 / 4, 1 / 4], ["p1", "p2", "p3", "p4"]],
    [[1 / 4, 1 / 4, 1 / 4, 1 / 4, 1], ["p5"]],
    [[1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 2, 1 / 2], ["p5", "p6"]],
  ];
  for (const [want, shown] of steps) {
    open();
    assert.deepEqual(widths(), want);
    assert.deepEqual(seen(), shown, "the view shows the new pane's page");
  }
});

test("With three a page, the fourth pane starts the second page", async () => {
  const { open, widths, seen } = await stripWith({ "strip.n": 3 });
  for (const _ of Array(4)) open();
  assert.deepEqual(widths(), [1 / 3, 1 / 3, 1 / 3, 1]);
  assert.deepEqual(seen(), ["p4"]);
});

test("Changing the stepper from four to two re-pages five columns into halves and a whole one, and fit does the same", async () => {
  const { strip, open, now, widths } = await stripWith({ "strip.n": 4 });
  for (const _ of Array(5)) open();
  strip.commit(TAB, strip.setN(now(), 2, now().focus));
  assert.deepEqual(widths(), [1 / 2, 1 / 2, 1 / 2, 1 / 2, 1]);
  strip.commit(TAB, { ...now(), cols: now().cols.with(0, { ...now().cols[0], w: 0.8 }) });
  strip.commit(TAB, strip.fit(now(), now().focus));
  assert.deepEqual(widths(), [1 / 2, 1 / 2, 1 / 2, 1 / 2, 1]);
});

test("Splitting a pane down stacks it in its column and changes no width", async () => {
  const { open, now, widths } = await stripWith({ "strip.n": 4 });
  for (const _ of Array(3)) open();
  open("down", "p2");
  assert.deepEqual(widths(), [1 / 3, 1 / 3, 1 / 3]);
  assert.deepEqual(clone(now().cols.map((c) => c.panes)), [["p1"], ["p2", "p4"], ["p3"]]);
});

test("Someone who never chose panes per view gets four, and a stored choice is kept", async () => {
  const fresh = await stripWith();
  fresh.open();
  assert.equal(fresh.now().n, 4);
  const chosen = await stripWith({ "strip.n": 3 });
  chosen.open();
  assert.equal(chosen.now().n, 3);
  const kept = await stripWith({ "strip.n": 3 });
  kept.strip.state = { [TAB]: { cols: [], vx: 0, n: 6 } };
  kept.open();
  assert.equal(kept.now().n, 6);
});

test("Closing a pane leaves the other columns' widths as they were", async () => {
  const { open, close, widths } = await stripWith({ "strip.n": 4 });
  for (const _ of Array(5)) open();
  close("p2");
  assert.deepEqual(widths(), [1 / 4, 1 / 4, 1 / 4, 1]);
  close("p5");
  assert.deepEqual(widths(), [1 / 4, 1 / 4, 1 / 4]);
});

test("With a quarter pinned and four a page, a pane opened after the last column fills the three quarters left and is on screen", async () => {
  const { open, widths, seen } = await stripWith({}, { tab: { n: 4, vx: 0, focus: "p4", cols: [pinned, ...quarters] } });
  open("right", "p4", "new");
  assert.deepEqual(widths(), [1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 3 / 4]);
  assert.deepEqual(seen(), ["new"]);
  open("right", "new", "next");
  assert.deepEqual(widths(), [1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 3 / 8, 3 / 8]);
  assert.deepEqual(seen(), ["new", "next"]);
});

test("With a quarter pinned, the stepper shares each page in the three quarters left and shows the focused pane's page", async () => {
  const { strip, now, widths, seen } = await stripWith({}, { tab: { n: 4, vx: 0, focus: "p4", cols: [pinned, ...quarters, { panes: ["p5"], w: 1 }] } });
  strip.commit(TAB, strip.setN(now(), 2, "p4"));
  assert.deepEqual(widths(), [1 / 4, 3 / 8, 3 / 8, 3 / 8, 3 / 8, 3 / 4]);
  assert.deepEqual(seen(), ["p3", "p4"]);
});

test("A tab seen for the first time shows the focused pane's page", async () => {
  const { shown, widths, ids } = await stripWith({ "strip.n": 4 }, { focused: "p5" });
  ids.push("p1", "p2", "p3", "p4", "p5", "p6");
  assert.deepEqual(shown(), ["p5", "p6"]);
  assert.deepEqual(widths(), [1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 2, 1 / 2]);
});

test("With a pin leaving less than a whole last column, a pane opened mid-strip still shows its page", async () => {
  const { strip, open, now, widths, seen } = await stripWith({ "strip.n": 2 });
  for (const _ of Array(5)) open();
  strip.commit(TAB, strip.pin(now(), "p1"));
  open("right", "p2", "x");
  assert.deepEqual(seen(), ["p2", "x"]);
  open("right", "x", "y");
  assert.deepEqual(widths(), [1 / 2, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 2, 1]);
  assert.equal(now().vx, 1 / 2);
  assert.deepEqual(seen(), ["y", "p3"]);
});

test("Stepping right reaches a last column wider than the view the pins leave", async () => {
  const { strip, now, seen } = await stripWith({}, { tab: { n: 4, vx: 0, focus: "p1", cols: [pinned, { panes: ["p1"], w: 1 / 2 }, { panes: ["p2"], w: 1 }] } });
  strip.commit(TAB, strip.step(now(), 1));
  assert.deepEqual(seen(), ["p2"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { temporary } from "./helpers.mjs";
import { element, fixture, initialised, sidebarOn } from "./perf-harness.mjs";

const retained = (cx) => {
  const own = { ...cx, depth: 0, current: null };
  const refuse = (call) => { if (own.depth) throw new Error(`${call} cannot run during render`); };
  own.within = (entity, run) => {
    const outer = own.current;
    own.current = entity;
    try { return run(); } finally { own.current = outer; }
  };
  own.drawing = (render) => {
    own.depth += 1;
    try { return render(); } finally { own.depth -= 1; }
  };
  const invalidate = (entity) => {
    entity.dirty = true;
    if (entity.mounted) entity.draw();
  };
  own.new = (Class, props) => {
    refuse("cx.new");
    const view = new Class(props);
    const entity = { view, renders: 0, mounted: false, dirty: true, release: () => true };
    own.within(entity, () => view.init?.(props, own));
    entity.draw = () => { entity.renders += 1; entity.dirty = false; return own.within(entity, () => own.drawing(() => view.render(own))); };
    entity.mount = () => {
      if (entity.mounted && !entity.dirty) return;
      entity.mounted = true;
      entity.draw();
    };
    entity.set_props = (next) => { refuse("entity.set_props"); view.update?.(next); invalidate(entity); };
    return entity;
  };
  own.notify = (target) => { refuse("cx.notify"); if (target) invalidate(target); else cx.notify(); };
  return own;
};

const isEntity = (value) => Boolean(value) && typeof value === "object" && typeof value.mount === "function";
const mount = (kid) => { if (isEntity(kid)) kid.mount(); };
const mounting = () => element({ child: mount, children: (kids) => (kids ?? []).forEach(mount) });

const field = (cx) => {
  const listeners = {};
  const state = { on: (event, fn) => { (listeners[event] ??= []).push({ fn, view: cx.current }); return {}; }, value: () => "", focus() {}, release() {}, set_value() {} };
  return { state, fire: (event) => (listeners[event] ?? []).forEach(({ fn, view }) => fn({}, { notify: () => cx.notify(view) })) };
};

const mounted = async (t) => {
  const dir = await temporary(t), f = fixture({ dir });
  const cx = retained(f.cx);
  const input = field(cx);
  Object.assign(f.host, { v_flex: mounting, h_flex: mounting, div: mounting, InputState: { new: () => input.state } });
  const view = await initialised(f, await sidebarOn(f), {}, cx);
  const draw = async () => {
    cx.drawing(() => view.render(cx));
    await f.advance(0);
  };
  await draw();
  return { f, cx, view, input, draw, renders: () => Object.fromEntries(Object.entries(view.parts ?? {}).map(([name, part]) => [name, part.renders])) };
};

test("The sidebar mounts its header, view switch, rows and footer once, as retained views of one composition", async (t) => {
  const { view, draw, renders } = await mounted(t);
  const parts = view.parts ?? {};
  assert.deepEqual(Object.keys(parts), ["header", "switch", "rows", "footer"]);
  assert.deepEqual(Object.values(parts).map((part) => part.mounted), [true, true, true, true], "each is mounted in the composition");
  const first = renders();
  assert.ok(Object.values(first).every((n) => n >= 1), "each is on screen");
  await draw();
  assert.equal(view.parts.header, parts.header, "the same header after another draw");
  assert.equal(view.parts.footer, parts.footer, "the same footer after another draw");
  assert.equal(renders().footer, first.footer, "a draw of the sidebar alone does not draw the footer again");
});

const drawnAfter = async (t, change) => {
  const { f, draw, renders } = await mounted(t);
  const before = renders();
  change(f);
  await draw();
  return { before, after: renders() };
};

test("A change in one session row draws the rows again, and neither the header nor the footer", async (t) => {
  const { before, after } = await drawnAfter(t, (f) => {
    f.list[3].status = "done";
    f.terms[3].status = "done";
  });
  assert.ok(before.header >= 1 && before.footer >= 1, "both are on screen");
  assert.equal(after.header, before.header, "the header is not drawn again");
  assert.equal(after.footer, before.footer, "the footer is not drawn again");
  assert.ok(after.rows > before.rows, "the rows are");
});

test("A shared value the rows do not show changes, and the sidebar's refresh draws no part again", async (t) => {
  const { before, after } = await drawnAfter(t, (f) => f.shared.set("kanso.update", { checked: f.state.now }));
  assert.deepEqual(after, before, "the update check is the footer's bookkeeping, and nothing shows it");
});

test("A refresh that changes nothing the rows show does not draw them again, and a hover, a press or a fold does", async (t) => {
  const { f, cx, view, draw, renders } = await mounted(t);
  await f.advance(3000);
  assert.ok(view.threads && Object.keys(view.threads).length > 0, "the conversations are read");
  f.state.now += 310_000;
  await draw();
  const rows = () => renders().rows;
  const before = rows();
  view.redraw(cx);
  view.redraw(cx);
  view.refreshThreads(cx);
  await f.settle();
  view.sinceLeft.leave();
  view.redraw(cx);
  assert.equal(rows(), before, "nothing the rows show changed: a conversation checked again, an empty While you were away left");
  view.hoverRow = "t2";
  view.redraw(cx);
  assert.equal(rows(), before + 1, "the row under the pointer lights");
  view.redraw(cx);
  assert.equal(rows(), before + 1, "the pointer stayed on it");
  view.pressed = "s1";
  view.over = "s2";
  view.redraw(cx);
  assert.equal(rows(), before + 2, "a project held over another shows where it drops");
  view.toggleFold("s1", false, cx);
  view.redraw(cx);
  assert.equal(rows(), before + 3, "a fold starts");
});

test("A paint with nothing changed draws no part, and opening Sort draws the header alone", async (t) => {
  const { view, renders } = await mounted(t);
  const before = renders();
  view.paint();
  assert.deepEqual(renders(), before, "nothing changed, nothing drawn");
  view.orderOpen = "bar";
  view.paint();
  assert.deepEqual(renders(), { ...before, header: before.header + 1 }, "Sort's menu is the header's");
});

test("A change the header shows draws the header again: a view picked by its key", async (t) => {
  const { cx, view, draw, renders } = await mounted(t);
  const before = renders();
  view.command("view-agents", cx);
  await draw();
  const after = renders();
  assert.ok(after.header > before.header, "the header shows Status's tools");
  assert.ok(after.switch > before.switch, "the switch marks Status");
  assert.equal(after.footer, before.footer, "the footer is not drawn again");
});

test("Search opened from the header draws its focus ring in the switch as the keyboard comes and goes, and not the header", async (t) => {
  const { cx, view, input, renders } = await mounted(t);
  cx.within(view.parts.header, () => view.openFind(cx));
  const open = renders();
  input.fire("focus");
  assert.equal(view.drawnLooks.switch.focused, true, "focused");
  const focused = renders();
  assert.ok(focused.switch > open.switch, "the switch draws the ring");
  input.fire("blur");
  assert.equal(view.drawnLooks.switch.focused, false, "Tab took the keyboard away");
  assert.ok(renders().switch > focused.switch, "the switch draws it gone");
  assert.equal(renders().header, open.header, "the header is not drawn for it");
});

test("The footer draws again for an install that starts, and not for the notes or phase the install writes", async (t) => {
  const { f, draw, renders } = await mounted(t);
  const install = (patch) => f.shared.set("kanso.update", { installs: { a: { version: "9.9.9", at: f.state.now, phase: "preparing", notes: "", ...patch } } });
  const before = renders();
  install({});
  await draw();
  assert.equal(renders().footer, before.footer + 1, "an install began: the row goes quiet");
  const started = renders();
  install({ notes: "New layout; the one you had is in layouts/kanso.json.old-*.", phase: "started" });
  await draw();
  assert.equal(renders().footer, started.footer, "its notes and phase are bookkeeping the footer does not show");
});

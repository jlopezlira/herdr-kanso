import test from "node:test";
import assert from "node:assert/strict";
import { temporary } from "./helpers.mjs";
import { element, fixture, initialised, sidebarOn } from "./perf-harness.mjs";

const retained = (cx) => {
  const own = { ...cx, depth: 0 };
  const refuse = (call) => { if (own.depth) throw new Error(`${call} cannot run during render`); };
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
    view.init?.(props, own);
    const entity = { view, renders: 0, mounted: false, dirty: true, release: () => true };
    entity.draw = () => { entity.renders += 1; entity.dirty = false; return own.drawing(() => view.render(own)); };
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

const field = () => {
  const listeners = {};
  const state = { on: (event, fn) => { (listeners[event] ??= []).push(fn); return {}; }, value: () => "", focus() {}, release() {}, set_value() {} };
  return { state, fire: (event) => (listeners[event] ?? []).forEach((fn) => fn({}, { notify() {} })) };
};

const mounted = async (t) => {
  const dir = await temporary(t), f = fixture({ dir });
  const input = field();
  Object.assign(f.host, { v_flex: mounting, h_flex: mounting, div: mounting, InputState: { new: () => input.state } });
  const cx = retained(f.cx);
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

test("A change in one session row draws the rows again, and neither the header nor the footer", async (t) => {
  const { f, draw, renders } = await mounted(t);
  const before = renders();
  assert.ok(before.header >= 1 && before.footer >= 1, "both are on screen");
  f.list[3].status = "done";
  f.terms[3].status = "done";
  await draw();
  const after = renders();
  assert.equal(after.header, before.header, "the header is not drawn again");
  assert.equal(after.footer, before.footer, "the footer is not drawn again");
  assert.ok(after.rows > before.rows, "the rows are");
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

test("Search's field draws its focus ring as the keyboard comes and goes, in the switch that shows it", async (t) => {
  const { cx, view, input, renders } = await mounted(t);
  view.openFind(cx);
  const open = renders();
  input.fire("focus");
  assert.equal(view.drawnLooks.switch.focused, true, "focused");
  assert.equal(renders().switch, open.switch + 1, "the switch draws the ring");
  input.fire("blur");
  assert.equal(view.drawnLooks.switch.focused, false, "Tab took the keyboard away");
  assert.equal(renders().switch, open.switch + 2, "the switch draws it gone");
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

import test from "node:test";
import assert from "node:assert/strict";
import { temporary } from "./helpers.mjs";
import { fixture, initialised, sidebarOn } from "./perf-harness.mjs";

const retained = (cx) => {
  const own = { ...cx, drawing: false };
  const refuse = (call) => { if (own.drawing) throw new Error(`${call} cannot run during render`); };
  own.new = (Class, props) => {
    refuse("cx.new");
    const view = new Class(props);
    view.init?.(props, own);
    const entity = { view, renders: 0, release: () => true };
    entity.draw = () => { entity.renders += 1; return view.render(own); };
    entity.set_props = (next) => { refuse("entity.set_props"); view.update?.(next); entity.draw(); };
    entity.draw();
    return entity;
  };
  own.notify = (target) => { refuse("cx.notify"); if (target) target.draw(); else cx.notify(); };
  return own;
};

const mounted = async (t) => {
  const dir = await temporary(t), f = fixture({ dir });
  const cx = retained(f.cx);
  const view = await initialised(f, await sidebarOn(f), {}, cx);
  const draw = async () => {
    cx.drawing = true;
    try { view.render(cx); } finally { cx.drawing = false; }
    await f.advance(0);
  };
  await draw();
  return { f, cx, view, draw, renders: () => Object.fromEntries(Object.entries(view.parts ?? {}).map(([name, part]) => [name, part.renders])) };
};

test("The sidebar mounts its header, view switch, rows and footer once, as retained views of one composition", async (t) => {
  const { view, draw, renders } = await mounted(t);
  const parts = view.parts ?? {};
  assert.deepEqual(Object.keys(parts), ["header", "switch", "rows", "footer"]);
  await draw();
  assert.deepEqual(Object.keys(renders()), ["header", "switch", "rows", "footer"]);
  assert.equal(view.parts.header, parts.header, "the same header after another draw");
  assert.equal(view.parts.footer, parts.footer, "the same footer after another draw");
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

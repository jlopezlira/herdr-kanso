import test from "node:test";
import assert from "node:assert/strict";
import { svgsOf as svgs } from "./helpers.mjs";
import { loadStripWith, STRIP_NIGHT } from "./mod-fixtures.mjs";

const night = STRIP_NIGHT;
const program = (name, icon) => ({ agent: true, shell: false, name, icon, tint: true });
const PANES = [
  { pane: "p1", terminal: "t1", title: "tests", status: "working", program: program("Claude Code", "mods/kanso-chrome/icons/claude.svg") },
  { pane: "p2", terminal: "t2", title: "site", status: "idle", program: program("Codex", "mods/kanso-chrome/icons/codex.svg") },
];
const all = (el) => [el, ...el.kids.flatMap(all)];
const texts = (el) => all(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "child" && typeof call[1] === "string").map((call) => call[1]));
const bg = (el) => all(el).flatMap((kid) => kid.calls.filter((call) => call[0] === "bg").map((call) => call[1]));

const strip = async (props, store) => {
  const { Strip } = await loadStripWith(props, PANES, store);
  const view = new Strip();
  view.init({}, { timer: { after: () => ({ cancel() {} }) } });
  return { root: view.render() };
};

test("A pane standing in: while it is dragged its place keeps its mark and name, the pane it would land beside shows it on the accent, and the ruler lights at a drop below", async () => {
  const store = { "strip.drag": { pane: "p1" }, "strip.drop": { to: "p2", side: "before" } };
  const { root: own } = await strip({ drop: "p1" }, store);
  assert.ok(own.calls.some(([op, value]) => op === "opacity" && value === 0.4), "the held pane steps back");
  assert.ok(svgs(own).includes("mods/kanso-chrome/icons/claude.svg") && texts(own).includes("Claude Code"), "and keeps its mark and name");
  const { root: target } = await strip({ drop: "p2" }, store);
  assert.ok(svgs(target).includes("mods/kanso-chrome/icons/claude.svg") && texts(target).includes("Claude Code"), "where it would land, the held pane's mark and name");
  assert.ok(bg(target).some((colour) => String(colour).startsWith(night.accent)), "on the accent");
  const { root: ruler } = await strip({ ruler: "p2" }, { "strip.drag": { pane: "p1" }, "strip.drop": { to: "p2", side: "below" } });
  assert.ok(bg(ruler).some((colour) => String(colour).startsWith(night.accent)), "the ruler lit at the drop below");
  const { root: quiet } = await strip({ ruler: "p2" }, { "strip.drag": { pane: "p1" }, "strip.drop": { to: "p2", side: "before" } });
  assert.equal(bg(quiet).some((colour) => String(colour).startsWith(night.accent)), false, "and dark elsewhere");
});

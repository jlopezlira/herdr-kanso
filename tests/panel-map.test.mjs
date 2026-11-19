import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { panelPages } from "../stories/kit/panel-states.js";
import { factsOf, lossOf, together } from "./panel-facts.mjs";

const map = JSON.parse(readFileSync(new URL("./panel-map.json", import.meta.url), "utf8"));
const CEILING = { sample: 45, pointer: 82, redraw: 139, unruled: 1 };
const REACHED = ["selected", "tabs.selected", "groups.selected", "rows.selected"];
const kitFacts = (target) => {
  const [page, ...label] = target.split("/");
  const { states, markup } = panelPages[`Panels/${page}`] ?? { states: [] };
  assert.ok(states.some((state) => state.label === label.join("/")), `${target} is not a kit state`);
  return factsOf(markup({ view: label.join("/") }));
};
const gives = (item, before, facts) => {
  const [kind, ...rest] = item.split(" ");
  const what = rest.join(" ");
  return {
    action: () => lossOf({ marks: [], counts: {}, actions: [what] }, facts, map.renamed).length === 0,
    chosen: () => facts.chosen.includes(what),
    mark: () => REACHED.includes(what) && facts.marks.includes(what),
    count: () => what === "tabs" && (facts.counts.tabs ?? 0) >= before.counts.tabs,
  }[kind]?.() ?? false;
};
const judged = ({ page, state, kit, reach = {}, says = [], holds = [], free = [], differs = {}, ...before }) => {
  const own = together(kit.map(kitFacts));
  const lost = lossOf(before, own, map.renamed);
  const credited = Object.entries(reach).flatMap(([target, items]) => items.map((item) => [target, item]));
  const elsewhere = credited.filter(([target, item]) => target.startsWith(`${page}/`) && gives(item, before, kitFacts(target))).map(([, item]) => item);
  const name = (item) => `${page} | ${state}: ${item}`;
  return {
    unlisted: lost.filter((item) => !differs[item] && !elsewhere.includes(item)).map(name),
    stale: [...Object.keys(differs), ...credited.map(([, item]) => item)].filter((item) => !lost.includes(item)).map(name),
    unsaid: says.filter((words) => !own.text.includes(words)).map(name),
    unheld: holds.filter((label) => !own.held.includes(label)).map(name),
    unfree: free.filter((label) => own.held.includes(label) || !own.actions.includes(label)).map(name),
  };
};

test("Every state develop drew on a panel page keeps its marks, its actions, what is held or chosen and its repeated items in the kit state that draws it", () => {
  const all = map.states.map(judged);
  const every = (key) => all.flatMap((one) => one[key]);
  assert.equal(map.states.length, 450);
  assert.deepEqual(every("unlisted"), [], "develop draws it and the kit state does not");
  assert.deepEqual(every("stale"), [], "drawn in the state itself now: take it off the list");
  assert.deepEqual(every("unsaid"), [], "the kit state no longer says what set the state apart");
  assert.deepEqual(every("unheld"), [], "a control the operation blocks is free");
  assert.deepEqual(every("unfree"), [], "a control the operation leaves alone is held or gone");
});

test("The listed differences never grow, and each has a reason", () => {
  const listed = map.states.flatMap(({ differs = {} }) => Object.values(differs));
  for (const [reason, most] of Object.entries(CEILING)) assert.ok(listed.filter((given) => given === reason).length <= most, `more than ${most} listed as ${reason}`);
  assert.deepEqual(listed.filter((given) => !map.reasons[given] || !(given in CEILING)), []);
});

test("A drawing that drops the chosen point, a control, a group or frees a held control is found, and a control from another state is not credited", () => {
  const develop = factsOf('<div class="kanso-annotation__layer"><span class="kanso-annotation">1</span><span class="kanso-annotation kanso-annotation--selected">2</span></div><div class="kanso-section">Left behind</div><div class="kanso-section">Still checking</div><span class="kanso-button">Send to checkout</span><span class="kanso-button">Clear</span><span class="kanso-button kanso-control--off">Stop</span>');
  const kit = factsOf('<div class="kanso-annotation__layer"><span class="kanso-annotation">1</span></div><div class="kanso-row kanso-row--heading">Left behind</div><span class="kanso-button" title="Send to checkout">Send to checkout</span><span class="kanso-button">Stop</span>');
  assert.deepEqual(lossOf(develop, kit), ["mark selected", "mark disabled", "mark points.selected", "mark buttons.disabled", "count points", "count groups", "action clear", "held stop"]);
  assert.deepEqual(lossOf(develop, kit, { clear: ["send to checkout"] }).filter((item) => item.startsWith("action")), []);
  assert.deepEqual(lossOf(develop, develop), []);
  const failed = map.states.find(({ state }) => state === "Images · Send failed");
  assert.ok(!Object.values(failed.reach ?? {}).flat().includes("action clear # pins"));
  assert.ok(failed.actions.includes("clear # pins"));
  assert.deepEqual(judged({ ...failed, kit: ["Images/Sending"] }).unlisted.filter((item) => item.endsWith("action clear # pins")), []);
  assert.notDeepEqual(judged({ ...failed, kit: ["Images/No conversation"] }).unlisted, []);
});

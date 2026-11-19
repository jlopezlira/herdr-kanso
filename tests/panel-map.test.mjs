import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { panelPages } from "../stories/kit/panel-states.js";

const map = JSON.parse(readFileSync(new URL("./panel-map.json", import.meta.url), "utf8"));
const CEILING = { sample: 32, pointer: 84, "another way": 174 };
const CHOSEN = '.kanso-control--on, .kanso-tabs__tab--on, .kanso-settings__area--on, .kanso-button--active, [aria-checked="true"], .kanso-control--selected, .kanso-row--selected, .kanso-control--current, .kanso-cell--current, .kanso-excerpt--current, .kanso-annotation--selected';
const MARKS = {
  selected: CHOSEN,
  hover: ".kanso-control--hover, .kanso-row--hover, .kanso-button--hover, .kanso-panel__row--hover, .kanso-settings__area--hover, .kanso-annotation--hover",
  armed: ".kanso-action--armed",
  disabled: '[disabled], [aria-disabled="true"], .kanso-control--off, .kanso-button--off',
  waiting: '.kanso-skeleton, [aria-busy="true"], .kanso-state-line--pending, .kanso-state-line__pending-dot, .kanso-button--pending, .kanso-button--spinning, .kanso-icon--spinning, .kanso-menu__item--busy',
  failure: '.kanso-state-block, [role="alert"], .kanso-field--invalid, .kanso-mark--blocked, .kanso-text--blocked, .kanso-sentence--blocked, .kanso-metric--blocked, .kanso-dot--blocked, .kanso-fill--blocked, .kanso-row__letter--blocked',
  empty: ".kanso-state-empty",
  focus: ".kanso-control--focus, .kanso-panel--focus, .kanso-simulator--focus, .kanso-markdown__cell--focus, .kanso-caret",
};
const ITEMS = {
  rows: ".kanso-row:not(.kanso-row--heading):not(.kanso-row--title), .kanso-panel__row, .kanso-credit, .kanso-settings__piece, .kanso-setting",
  points: ".kanso-simulator__note-layer .kanso-simulator__note-point, .kanso-annotation__layer .kanso-annotation, .kanso-picture .kanso-annotation",
  regions: ".kanso-annotation__region",
  groups: ".kanso-section, .kanso-row--heading, .kanso-row--level-0, .kanso-menu__heading",
  tabs: ".kanso-segmented > *, .kanso-segmented--tabs > *, .kanso-segmented--options > *, .kanso-tabs__tab",
  items: ".kanso-menu__item",
  fields: ".kanso-field, input, textarea",
  buttons: 'button, .kanso-button, [role="button"]',
  bars: ".kanso-chart__bars > *, .kanso-bars__slot",
  days: ".kanso-heatmap > *, .kanso-days__day",
  failures: ".kanso-state-block",
  switches: '[role="switch"]',
};
const SAID = ["waiting", /ing…/, "armed", /(Press|Click) again/];
const tidy = (text) => text.replace(/\s+/g, " ").replace(/[’‘]/g, "'").replace(/(Press|Click) again.*$/i, "").replace(/\d[\d.,]*/g, "#").replace(/[….]+$/, "").trim().toLowerCase();
const labelOf = (node) => tidy(node.textContent) || tidy(node.getAttribute("aria-label") ?? node.getAttribute("title") ?? "");
const carries = (node, selector) => node.matches(selector) || Boolean(node.querySelector(selector));
const factsOf = (html) => {
  const { document } = new JSDOM(html).window;
  const marks = new Set(Object.keys(MARKS).filter((kind) => document.querySelector(MARKS[kind])));
  for (let index = 0; index < SAID.length; index += 2) if (SAID[index + 1].test(document.body.textContent)) marks.add(SAID[index]);
  const counts = {};
  for (const [kind, selector] of Object.entries(ITEMS)) {
    const found = [...document.querySelectorAll(selector)];
    if (found.length && kind !== "buttons") counts[kind] = found.length;
    for (const mark of Object.keys(MARKS)) if (found.some((node) => carries(node, MARKS[mark]))) marks.add(`${kind}.${mark}`);
  }
  const actions = [...document.querySelectorAll(`${ITEMS.buttons}, ${ITEMS.tabs}, ${ITEMS.items}`)].map(labelOf).filter(Boolean);
  return { marks: [...marks], counts, actions: [...new Set(actions)] };
};
const together = (facts) => ({
  marks: [...new Set(facts.flatMap(({ marks }) => marks))],
  counts: Object.fromEntries(facts.flatMap(({ counts }) => Object.keys(counts)).map((kind) => [kind, Math.max(...facts.map(({ counts }) => counts[kind] ?? 0))])),
  actions: [...new Set(facts.flatMap(({ actions }) => actions))],
});
const lossOf = (before, after, renamed = {}) => {
  const drawn = new Set(after.actions);
  const said = (label) => drawn.has(label) || (renamed[label] ?? []).some((other) => drawn.has(other));
  return [
    ...before.marks.filter((mark) => !after.marks.includes(mark)).map((mark) => `mark ${mark}`),
    ...Object.keys(before.counts).filter((kind) => (after.counts[kind] ?? 0) < before.counts[kind]).map((kind) => `count ${kind}`),
    ...before.actions.filter((label) => !said(label)).map((label) => `action ${label}`),
  ];
};
const kitFacts = (target) => {
  const [page, ...label] = target.split("/");
  const { states, markup } = panelPages[`Panels/${page}`] ?? { states: [] };
  assert.ok(states.some((state) => state.label === label.join("/")), `${target} is not a kit state`);
  return factsOf(markup({ view: label.join("/") }));
};
const REACHED = ["selected", "tabs.selected", "groups.selected", "rows.selected"];
const near = Object.fromEntries(Object.entries(map.reach).map(([page, labels]) => [page, together(labels.map((label) => kitFacts(`${page}/${label}`)))]));
const withReach = (after, reached) => (reached ? {
  marks: [...after.marks, ...reached.marks.filter((mark) => REACHED.includes(mark))],
  counts: { ...after.counts, tabs: Math.max(after.counts.tabs ?? 0, reached.counts.tabs ?? 0) },
  actions: [...after.actions, ...reached.actions],
} : after);

test("Every state develop drew on a panel page keeps its marks, its actions and its repeated items in the kit state that draws it", () => {
  const unlisted = [];
  const stale = [];
  for (const { page, state, kit, differs = {}, ...before } of map.states) {
    const lost = lossOf(before, withReach(together(kit.map(kitFacts)), near[page]), map.renamed);
    unlisted.push(...lost.filter((item) => !differs[item]).map((item) => `${page} | ${state}: ${item}`));
    stale.push(...Object.keys(differs).filter((item) => !lost.includes(item)).map((item) => `${page} | ${state}: ${item}`));
  }
  assert.equal(map.states.length, 450);
  assert.deepEqual(unlisted, [], "develop draws it and the kit state does not");
  assert.deepEqual(stale, [], "drawn now: take it off the list");
});

test("The listed differences never grow, and each has a reason", () => {
  const listed = map.states.flatMap(({ differs = {} }) => Object.values(differs));
  for (const [reason, most] of Object.entries(CEILING)) assert.ok(listed.filter((given) => given === reason).length <= most, `more than ${most} listed as ${reason}`);
  assert.deepEqual(listed.filter((given) => !map.reasons[given]), []);
});

test("A drawing that drops the chosen point, a control or a group is found", () => {
  const develop = factsOf('<div class="kanso-annotation__layer"><span class="kanso-annotation">1</span><span class="kanso-annotation kanso-annotation--selected">2</span></div><div class="kanso-section">Left behind</div><div class="kanso-section">Still checking</div><span class="kanso-button">Send to checkout</span><span class="kanso-button">Clear</span>');
  const kit = factsOf('<div class="kanso-annotation__layer"><span class="kanso-annotation">1</span></div><div class="kanso-row kanso-row--heading">Left behind</div><span class="kanso-button" title="Send to checkout">Send to checkout</span>');
  assert.deepEqual(lossOf(develop, kit), ["mark selected", "mark points.selected", "count points", "count groups", "action clear"]);
  assert.deepEqual(lossOf(develop, kit, { clear: ["send to checkout"] }).filter((item) => item.startsWith("action")), []);
  assert.deepEqual(lossOf(develop, develop), []);
});

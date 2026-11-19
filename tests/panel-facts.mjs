import { JSDOM } from "jsdom";

const CHOSEN = '.kanso-control--on, .kanso-tabs__tab--on, .kanso-settings__area--on, .kanso-button--active, [aria-checked="true"], .kanso-control--selected, .kanso-row--selected, .kanso-control--current, .kanso-cell--current, .kanso-excerpt--current, .kanso-annotation--selected';
const MARKS = {
  selected: CHOSEN,
  hover: ".kanso-control--hover, .kanso-row--hover, .kanso-button--hover, .kanso-panel__row--hover, .kanso-settings__area--hover, .kanso-annotation--hover",
  armed: ".kanso-action--armed",
  disabled: '[disabled], [aria-disabled="true"], .kanso-control--off, .kanso-button--off',
  waiting: '.kanso-mark--working, .kanso-skeleton, [aria-busy="true"], .kanso-state-line--pending, .kanso-state-line__pending-dot, .kanso-button--pending, .kanso-button--spinning, .kanso-icon--spinning, .kanso-menu__item--busy',
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
const ACTIONS = `${ITEMS.buttons}, ${ITEMS.tabs}, ${ITEMS.items}`;
const SAID = [["waiting", /ing( the \w+)?…/], ["armed", /(Press|Click) again/]];
const tidy = (text) => text.replace(/\s+/g, " ").replace(/[’‘]/g, "'").replace(/(Press|Click) again.*$/i, "").replace(/\d[\d.,]*/g, "#").replace(/[….]+$/, "").trim().toLowerCase();
const labelOf = (node) => tidy(node.textContent) || tidy(node.getAttribute("aria-label") ?? node.getAttribute("title") ?? "");
const carries = (node, selector) => node.matches(selector) || Boolean(node.querySelector(selector));
const labelsOf = (nodes) => [...new Set(nodes.map(labelOf).filter(Boolean))];
const wordsOf = (document) => [...document.querySelectorAll("[aria-label], [title]")].map((node) => node.getAttribute("aria-label") ?? node.getAttribute("title"));

export const factsOf = (html) => {
  const { document } = new JSDOM(html).window;
  const marks = new Set(Object.keys(MARKS).filter((kind) => document.querySelector(MARKS[kind])));
  for (const [mark, words] of SAID) if (words.test(document.body.textContent)) marks.add(mark);
  const counts = {};
  for (const [kind, selector] of Object.entries(ITEMS)) {
    const found = [...document.querySelectorAll(selector)];
    if (found.length && kind !== "buttons") counts[kind] = found.length;
    for (const mark of Object.keys(MARKS)) if (found.some((node) => carries(node, MARKS[mark]))) marks.add(`${kind}.${mark}`);
  }
  const acts = [...document.querySelectorAll(ACTIONS)];
  return {
    marks: [...marks], counts, actions: labelsOf(acts),
    held: labelsOf(acts.filter((node) => node.matches(MARKS.disabled))),
    chosen: labelsOf(acts.filter((node) => node.matches(CHOSEN))),
    text: `${document.body.textContent} ${wordsOf(document).join(" ")}`.replace(/\s+/g, " "),
  };
};

const LISTS = [["action", "actions"], ["held", "held"], ["chosen", "chosen"]];
export const together = (facts) => ({
  marks: [...new Set(facts.flatMap(({ marks }) => marks))],
  counts: Object.fromEntries(facts.flatMap(({ counts }) => Object.keys(counts)).map((kind) => [kind, Math.max(...facts.map(({ counts }) => counts[kind] ?? 0))])),
  ...Object.fromEntries(LISTS.map(([, key]) => [key, [...new Set(facts.flatMap((fact) => fact[key]))]])),
  text: facts.map(({ text }) => text).join(" "),
});
const namedIn = (drawn, renamed) => (label) => drawn.includes(label) || (renamed[label] ?? []).some((other) => drawn.includes(other));
export const lossOf = (before, after, renamed = {}) => [
  ...before.marks.filter((mark) => !after.marks.includes(mark)).map((mark) => `mark ${mark}`),
  ...Object.keys(before.counts).filter((kind) => (after.counts[kind] ?? 0) < before.counts[kind]).map((kind) => `count ${kind}`),
  ...LISTS.flatMap(([word, key]) => (before[key] ?? []).filter((label) => !namedIn(after[key], renamed)(label)).map((label) => `${word} ${label}`)),
];

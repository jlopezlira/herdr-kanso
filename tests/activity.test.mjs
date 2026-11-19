// While you were away and Needs you: the Storybook's Activity composition, Session rows and state patterns, drawn by the app kit.
import test from "node:test";
import assert from "node:assert/strict";
import { load, nodes, texts, svgsOf, themed, calls, KIT_NIGHT, drawingHost as host, drawn, repoText, sameCopies } from "./helpers.mjs";
import { activity as storyActivity, awayMax } from "../stories/kit/activity.js";
import { present } from "../kanso/mods/kanso-spaces/since-left-model.js";

const MIN = 60_000;
const NOW = 100 * MIN;
// The playground's six events, as the store keeps them.
const STORED = [
  { id: 1, target: "pr:https://x/pull/166", kind: "pr", text: "PR #166 merged", at: NOW - 32 * MIN },
  { id: 2, target: "pr:https://x/pull/165", kind: "pr", text: "PR #165 checks failed", at: NOW - 9 * MIN },
  { id: 3, target: "agent:orion", kind: "error", text: "Orion errored", at: NOW - 60 * MIN },
  { id: 4, target: "agent:iris", kind: "finished", text: "Iris finished", did: "Boards 01 to 04 done", at: NOW - 12 * MIN },
  { id: 5, target: "pr:https://x/pull/164", kind: "pr", text: "PR #164 approved", at: NOW - 41 * MIN },
  { id: 6, target: "agent:nova", kind: "blocked", text: "Nova needs you", at: NOW - 2 * MIN },
];
const project = ":/work/kanso";
const cx = { stop_propagation() {}, notify() {} };
const minutes = (ms) => `${Math.round(ms / MIN)}m`;

const kit = async () => themed({
  ...await load("kanso-spaces/activity.js", ["activity"], host()),
  ...await load("kanso-panel/kit.js", ["row", "stack", "button"], host()),
  ...await load("kanso-panel/ui.js", ["tokens"], host()),
}, KIT_NIGHT);
// A return view holding `count` of the events, with the clock and the age as the tests read them.
const sinceLeft = async (count, extra = {}) => {
  const { SinceLeft } = await load("kanso-spaces/since-left.js", ["SinceLeft"], host());
  const view = Object.assign(new SinceLeft(null), { project, rows: STORED.slice(0, count), ...extra });
  view.viewOf = () => ({ now: NOW, focus: view.target ?? null, format: minutes });
  view.store = { dismiss: async () => {} };
  return view;
};
const byTag = (el, tag) => nodes(el).find((kid) => kid.tag === tag) ?? null;
const clicked = (el, tag) => calls(byTag(el, tag), "on_click").forEach(([, fn]) => fn({}, cx));

test("The sidebar's copy of the Activity composition is the Storybook's, byte for byte", () => {
  sameCopies(["activity"]);
  assert.match(repoText("scripts/sync-share.mjs"), /source: "stories\/kit\/activity\.js", copies: \["kanso\/mods\/kanso-spaces\/activity\.js"\]/);
  assert.match(repoText("scripts/lint-storybook.mjs"), /'stories\/kit\/activity\.js'\]/);
});

test("Every Activity state the Storybook shows is the app's card with the same props: none, a few, past four, all of them, and the keyboard on a row", async () => {
  const { activity, c } = await kit();
  for (const [count, extra, props] of [
    [0, {}, null],
    [3, {}, { max: awayMax, focus: -1 }],
    [6, {}, { max: awayMax, focus: -1 }],
    [6, { expanded: true }, { max: 6, focus: -1 }],
  ]) {
    const view = await sinceLeft(count, extra);
    const card = view.render(KIT_NIGHT, project, () => false, () => () => {});
    if (!props) {
      assert.equal(card, null, "nothing new takes no space");
      assert.equal(storyActivity({ events: [] }), null);
      continue;
    }
    const events = present(STORED.slice(0, count), { now: NOW, format: minutes });
    const pressAll = Object.fromEntries([...events.slice(0, props.max).map((e) => e.icon), "lu-x", ...(count > props.max ? [`+${count - props.max} more`] : [])].map((key) => [key, () => {}]));
    const presses = Object.fromEntries(Object.entries(pressAll).map(([key, fn]) => [key, key === "lu-x" || key.endsWith("more") ? fn : events.slice(0, props.max).filter((e) => e.icon === key).map(() => fn)]));
    assert.deepEqual(drawn(card), drawn(activity({ events, ...props })("since-left", c, { presses })), `${count} events`);
    assert.equal(texts(card).includes(`+${count - awayMax} more`), count > awayMax && !extra.expanded, "+N more past four rows");
  }
  const view = await sinceLeft(3);
  let at = 0;
  const ringed = view.render(KIT_NIGHT, project, () => at++ === 1, () => () => {});
  const ring = (el) => nodes(el).filter((kid) => calls(kid, "border_color").some((call) => call[1] === c.accent) && /^since-left-\d$/.test(kid.tag)).map((kid) => kid.tag);
  assert.deepEqual(ring(ringed), ["since-left-2"], "the keyboard's ring is on the second event row");
  const past = await sinceLeft(6);
  const onMore = past.render(KIT_NIGHT, project, (key) => key === "since-more", () => () => {});
  assert.deepEqual(ring(onMore), ["since-left-5"], "Proposed: the ring on +N more, the list's last stop");
});

test("Each event is a row with its icon in the state colour, the subject, the fact muted and what it did under it, as the playground's", async () => {
  const events = present(STORED, { now: NOW, format: minutes });
  assert.deepEqual(events.map(({ icon, tone, subject, fact, detail, age }) => [icon, tone, subject, fact, detail, age]), [
    ["e-blk", "blocked", "Nova", "needs you", null, "2m"],
    ["e-blk", "blocked", "Orion", "failed", null, "60m"],
    ["lu-git-pull-request", "blocked", "PR #165", "checks failed", null, "9m"],
    ["lu-git-pull-request", null, "PR #166", "merged", null, "32m"],
    ["lu-check", "done", "PR #164", "approved", null, "41m"],
    ["e-done", "done", "Iris", "finished", "Boards 01 to 04 done", "12m"],
  ]);
  const view = await sinceLeft(6, { expanded: true });
  const card = view.render(KIT_NIGHT, project, () => false, () => () => {});
  const { c } = await kit();
  const shown = texts(card);
  for (const text of ["While you were away", "Nova", "needs you", "PR #164", "approved", "Iris", "finished", "Boards 01 to 04 done", "41m"]) assert.ok(shown.includes(text), text);
  assert.ok(svgsOf(card).some((path) => path.endsWith("enso.svg")), "a finished agent leads with the done mark");
  assert.ok(svgsOf(card).some((path) => path.endsWith("check.svg")) && svgsOf(card).some((path) => path.endsWith("git-pull-request.svg")));
  const card4 = nodes(card)[0];
  assert.ok(calls(card4, "bg").some((call) => call[1] === c.popover), "a raised card");
  assert.ok(calls(card4, "rounded").length && calls(card4, "border_1").length);
});

test("Keyboard first: each event row is a kit Button that goes there and drops the rows, × dismisses, +N more shows the rest, and a row that leads nowhere does not act", async () => {
  const view = await sinceLeft(6);
  const went = [], stops = [];
  let dismissed = 0;
  view.dismiss = async () => { dismissed += 1; };
  const reach = (row) => (row.target === "agent:orion" ? null : () => went.push(row.target));
  const card = view.render(KIT_NIGHT, project, (key) => { stops.push(key); return false; }, reach);
  assert.deepEqual(stops, ["since-6", "since-2", "since-1", "since-more"], "the list's stops: the rows that act, then +N more, in screen order");
  assert.equal(byTag(card, "since-left-1").tag, "since-left-1", "Nova's row is a Button: Tab reaches it, Enter and Space press it");
  assert.ok(calls(byTag(card, "since-left-1"), "focus").length, "with the focus ring");
  assert.equal(byTag(card, "since-left-2"), null, "Orion's pane is gone: its row is plain");
  clicked(card, "since-left-3");
  clicked(card, "since-left-1");
  assert.deepEqual(went, ["pr:https://x/pull/165", "agent:nova"], "each row by its own press, though two share the pull request icon");
  assert.equal(dismissed, 2, "a press drops the rows");
  clicked(card, "since-left-0-action");
  assert.equal(dismissed, 3, "× dismisses them all");
  assert.equal(view.expanded, false);
  clicked(card, "since-left-5");
  assert.equal(view.expanded, true, "+N more, a quiet Button, shows the rest");
  assert.equal(view.render(KIT_NIGHT, project, () => false, reach).kids.length, 7, "the heading and all six rows");
});

test("Docked under the list: the card leaves the list's rows and sits at the sidebar's foot", () => {
  const main = repoText("kanso/mods/kanso-spaces/main.js");
  assert.match(main, /collapsed \? null : this\.awayCard\(t, active\)\]\.filter\(Boolean\)/);
  assert.doesNotMatch(main, /returnRows|bareHead|blockHeight/);
});

test("The kit: rows sharing an icon take a list of presses in drawing order, a mark symbol is the app's mark, and a row's tool takes its press by name", async () => {
  const { row, stack, c } = await kit();
  const hits = [];
  const drawnStack = stack({ variant: "away" },
    row({ name: "Heading", heading: true, action: { label: "Dismiss these", kind: "icon", icon: "lu-x" } }),
    row({ icon: "e-done", name: "A" }), row({ icon: "e-done", name: "B" }), row({ icon: "e-done", name: "C" }),
  )("s", c, { presses: { "lu-x": () => hits.push("x"), "e-done": [() => hits.push("a"), null, () => hits.push("c")] } });
  ["s-0-action", "s-1", "s-3"].forEach((tag) => clicked(drawnStack, tag));
  assert.deepEqual(hits, ["x", "a", "c"]);
  assert.equal(byTag(drawnStack, "s-2"), null, "null: the row does not act");
  assert.ok(svgsOf(drawnStack).filter((path) => path.endsWith("enso.svg")).length === 3, "e-done is the app's done mark");
  assert.throws(() => stack({ variant: "away" }, row({ name: "A" }))("s", c, { presses: { "lu-x": () => {} } }), /has no tool lu-x/);
  assert.throws(() => row({ name: "A" })("r", c, { max: 4 }), /only handlers, not max/);
});

test("Needs you: the count is the kit's quiet Button, each waiting agent its Session row with the project after the name, and the queue's states the kit's patterns", async () => {
  const { queueControl, queueList } = await load("kanso-spaces/needs-you-view.js", ["queueControl", "queueList"], host());
  const { waitingQueue } = await load("kanso-spaces/needs-you.js", ["waitingQueue"], host());
  const rows = waitingQueue([{ address: "a", status: "blocked", pane: "p", space: "s", space_name: "kansō", tab: "t", title: "Nova", seq: 1, program: { icon: "claude.svg", tint: false } }], []);
  let toggled = 0;
  const control = queueControl(KIT_NIGHT, { rows, state: "ready" }, false, false, () => { toggled += 1; });
  const count = byTag(control, "needs-you-count");
  assert.ok(count && calls(count, "focus").length, "a Button with the ring");
  assert.deepEqual(texts(count), ["Needs you · 1"]);
  assert.match(calls(count, "tooltip")[0][1], /^Needs you: 1/);
  calls(count, "on_click")[0][1]({}, cx);
  assert.equal(toggled, 1);
  assert.equal(queueControl(KIT_NIGHT, { rows: [], state: "ready" }, false, false, () => {}), null, "nobody waits: nothing drawn");
  assert.deepEqual(texts(byTag(queueControl(KIT_NIGHT, { rows, state: "ready" }, true, false, () => {}), "needs-you-count")), ["1"], "collapsed, the count");
  let went = 0;
  const list = queueList(KIT_NIGHT, { rows, state: "ready" }, () => ({ selected: true, go: () => { went += 1; } }), () => "3m");
  const nova = byTag(list, "needs-you-a");
  assert.ok(nova, "a Button");
  for (const text of ["Nova", "kansō", "3m", "Waiting for you"]) assert.ok(texts(nova).includes(text), text);
  calls(nova, "on_click")[0][1]({}, cx);
  assert.equal(went, 1);
  const states = (state, queueRows = []) => texts(queueList(KIT_NIGHT, { rows: queueRows, state }, () => ({}), () => ""));
  assert.ok(states("ready").includes("Nobody is waiting"), "empty: the kit's empty state");
  assert.ok(states("unavailable").includes("Queue unavailable"), "unavailable: the kit's failure block");
  const loading = queueList(KIT_NIGHT, { rows: [], state: "loading" }, () => ({}), () => "");
  assert.ok(nodes(loading).some((kid) => calls(kid, "id").some((call) => call[1] === "needs-you-loading")), "loading: the kit's skeleton");
});

test("No hand drawing is left: the deleted helpers are gone and both views call only the kit", () => {
  const since = repoText("kanso/mods/kanso-spaces/since-left.js"), needs = repoText("kanso/mods/kanso-spaces/needs-you-view.js");
  for (const gone of ["heightOf", "blockHeight", "dismissControl", "lineCount", "statusMark", "iconButton", "h_flex", "v_flex", "div("]) assert.equal(since.includes(gone), false, gone);
  for (const gone of ["quietLink", "div(", "text_size", "R.control"]) assert.equal(needs.includes(gone), false, gone);
  assert.equal(repoText("kanso/mods/kanso-spaces/since-left-model.js").includes("LINE_CAP"), false);
  assert.equal(repoText("kanso/tokens-baseline.json").includes("needs-you-view.js"), false);
  assert.equal(repoText("tests/press-targets-baseline.json").includes("since-left.js"), false);
});

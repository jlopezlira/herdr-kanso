// A project or tab that is asleep is one quiet row until a click; waking it opens the usual group.
import { drawEachTime, loadSidebar, mountedState, withParts, recorder, shell, SIDEBAR_THEME } from "./sidebar-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

// Asleep is Herdr's state: a settled tab, and terminals at their prompt that keep a conversation.
const fury = (tabs) => [{ id: "sp1", name: "fury", folder: "/Users/me/fury", machine: null, active: false, tabs }];
const asleepTab = { id: "tb", name: "Notes", index: 0, settled: true, settled_at: 1 };
const sleepers = [{ pane: "p1", tab: "tb", terminal: "t1", cwd: "/Users/me/fury" }, { pane: "p2", tab: "tb", terminal: "t2", cwd: "/Users/me/fury" }];
const sleeperTerms = [shell("t1", "00000000-0000-4000-8000-000000000001", "Ada"), shell("t2", "00000000-0000-4000-8000-000000000002", "Bea")];
const registry = [{ id: "p-fury", name: "fury", folder: "/Users/me/fury", machine: "", missing: false }];

async function draw({ spaces = () => [], agents = () => [], panes = () => [], terminals = () => [], collapsed = false, view: shown = "spaces" } = {}) {
  const { host, handlers, ids, texts, icons, clear } = recorder();
  const overlays = [], popup = { now: {} };
  const shared = (k) => (k === "kanso.registry" ? registry : k === "sidebar.collapsed" ? collapsed : null);
  const { Spaces } = await loadSidebar(host, { shared, spaces, panes, agents, terminals, machines: () => [], openOverlay: (o) => overlays.push(o), closeOverlay() {}, props: () => popup.now });
  const view = withParts(Object.assign(new Spaces(), mountedState({ shown: new Set(spaces().map((w) => w.id)), threadGroup: true, view: shown, threads: {} })));
  const render = drawEachTime(view, clear);
  return { view, handlers, ids, texts, icons, render, overlays, popup };
}
const asleepProject = (more = {}) => draw({ spaces: () => fury([asleepTab]), panes: () => sleepers, terminals: () => sleeperTerms, ...more });

const cx = { stop_propagation() {}, notify() {} };
const has = (ids, id) => ids.includes(id);
// A press and its release on the row: the project row opens only on a press that began on it.
const click = (handlers, id) => {
  handlers[`on_mouse_down:left:${id}`]({ click_count: 1 }, cx);
  handlers[`on_mouse_up:left:${id}`]({}, cx);
};

test("a project with nothing awake is one group, and a sleeping tab beside a live agent is its own", async () => {
  const { asleepGroups } = await load("kanso-spaces/roster.js", ["asleepGroups"], {});
  const row = (id, asleep) => ({ address: id, asleep });
  const z = (id, tab) => ({ id, tab });
  const whole = asleepGroups([row("zz:a", z("s1", "Notes")), row("zz:b", z("s1", "Notes"))], { key: "sp1" });
  assert.deepEqual(clone(whole.groups.map((g) => [g.id, g.whole, g.rows.map((r) => r.address)])), [["project:sp1", true, ["zz:a", "zz:b"]]]);
  const mixed = asleepGroups([row("t1", null), row("zz:a", z("s1", "Notes")), row("zz:b", z("s2", "Plan"))], { key: "sp1" });
  assert.deepEqual(clone(mixed.live.map((r) => r.address)), ["t1"]);
  assert.deepEqual(clone(mixed.groups.map((g) => [g.id, g.name, g.whole, g.rows.length])), [["sleep:s1", "Notes", false, 1], ["sleep:s2", "Plan", false, 1]]);
});

test("an asleep project renders collapsed, a click shows its agents without showing the project, and waking restores the usual group", async () => {
  const { view, handlers, ids, texts, icons, render } = await asleepProject();
  const row = "space-sp1";
  assert.equal(has(ids, row), true, "the project keeps its row");
  assert.equal(icons.includes("mods/kanso-chrome/icons/moon.svg") && texts.includes("2"), true, "the row carries the moon and how many agents sleep");
  assert.equal(has(ids, "space-agent-zz:t1"), false, "its agents are hidden while it sleeps");
  click(handlers, row);
  render();
  assert.equal(has(ids, "space-agent-zz:t1"), true, "a click shows the agents");
  assert.equal(has(ids, "space-agent-zz:t2"), true);
  click(handlers, row);
  render();
  assert.equal(has(ids, "space-agent-zz:t1"), false, "a second click hides them again");

  const live = [{ address: "t1", pane: "p1", tab: "tb", space: "sp1", space_name: "fury", status: "idle", name: "Ada", seq: 1 }];
  const woke = await draw({
    spaces: () => fury([{ ...asleepTab, settled: false, active: true }]), agents: () => live,
    panes: () => sleepers, terminals: () => [{ address: "t1", state: "live", program: { agent: true }, labels: {} }, { address: "t2", state: "live", program: { shell: true }, labels: {} }],
  });
  assert.equal(has(woke.ids, "space-agent-t1"), true, "awake, the usual agent row is back");
  assert.equal([...woke.ids].some((id) => id.startsWith("asleep-group-")), false, "the quiet row is gone");
  assert.equal(view.asleepOpen.has("project:sp1"), false);
});

test("a sleeping tab inside a live project is one row, and a click shows its agents", async () => {
  const tabs = [{ id: "tb0", name: "Main", index: 0, active: true }, asleepTab];
  const live = [{ address: "t0", pane: "p0", tab: "tb0", space: "sp1", space_name: "fury", status: "idle", name: "Live", seq: 1 }];
  const { handlers, ids, render } = await draw({
    spaces: () => fury(tabs), agents: () => live,
    panes: () => [{ pane: "p0", tab: "tb0", terminal: "t0", cwd: "/Users/me/fury" }, ...sleepers],
    terminals: () => [{ address: "t0", state: "live", program: { agent: true }, labels: {} }, ...sleeperTerms],
  });
  assert.equal(has(ids, "space-agent-t0"), true, "the agent still awake keeps its row");
  assert.equal(has(ids, "asleep-group-sleep:tb"), true, "the sleeping tab is one row");
  assert.equal(has(ids, "space-agent-zz:t1"), false);
  assert.equal(typeof handlers["on_mouse_up:space-sp1"], "function", "the project row is still the project row");
  handlers["on_click:asleep-group-sleep:tb"]({}, cx);
  render();
  assert.equal(has(ids, "space-agent-zz:t1"), true, "a click shows who sleeps in that tab");
  assert.equal(has(ids, "space-agent-zz:t2"), true);
});

test("Status and Threads start an asleep project collapsed", async () => {
  const status = await asleepProject();
  status.view.view = "agents";
  status.view.redraw();
  status.render();
  assert.equal(has(status.ids, "section-asleep"), true);
  assert.equal(has(status.ids, "asleep-group-project:sp1"), true);
  assert.equal(has(status.ids, "space-agent-zz:t1"), false);
  status.handlers["on_click:asleep-group-project:sp1"]({}, cx);
  status.render();
  assert.equal(has(status.ids, "space-agent-zz:t1"), true);

  const threads = await asleepProject();
  threads.view.view = "threads";
  threads.view.threads = {};
  threads.view.redraw();
  threads.render();
  assert.equal(has(threads.ids, "space-agent-zz:t1"), false, "a project asleep is closed in Threads too");
  const head = [...threads.ids].find((id) => id.startsWith("thread-project-"));
  assert.ok(head, "the project still heads its conversations");
  threads.handlers[`on_click:${head}`]({}, cx);
  threads.render();
  assert.equal(has(threads.ids, "space-agent-zz:t1"), true);
});

test("On the rail, the asleep tile of each view opens the popup of who sleeps, and a sleeper there opens its Wake menu", async () => {
  for (const [shown, tile, title, hint] of [["spaces", "space-sp1", "fury", null], ["agents", "rail-section-asleep", "Asleep", "fury"], ["threads", "rail-thread-project-sp1", "fury", null]]) {
    const { view, handlers, ids, icons, overlays, popup } = await asleepProject({ collapsed: true, view: shown });
    assert.equal(has(ids, tile), true, `${shown}: the asleep tile is on the rail`);
    assert.equal(icons.includes("mods/kanso-chrome/icons/moon.svg"), true, `${shown}: it carries the moon`);
    handlers[`on_click:${tile}`]({}, cx);
    const { railMenu } = overlays.at(-1).props;
    assert.deepEqual(clone([railMenu.title, railMenu.rows.map((r) => [r.name, r.status, r.hint])]), [title, [["Ada", "asleep", hint], ["Bea", "asleep", hint]]], `${shown}: pressed, the popup lists who sleeps`);
    popup.now = { railMenu, overlay: 1 };
    view.railMenuView(SIDEBAR_THEME);
    view.menuActs[0](cx);
    assert.deepEqual(clone([overlays.at(-1).props.menu?.address, overlays.at(-1).props.menu?.name]), ["zz:t1", "Ada"], `${shown}: a sleeper opens its Wake menu`);
  }
});

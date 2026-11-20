// Asleep rows, Wake, a failed sleep and the away summary share one set of states.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, texts, nodes, KIT_NIGHT, drawingHost } from "./helpers.mjs";
import { canWake } from "../kanso/mods/kanso-spaces/sidebar-rows.js";
import { asleepLook, withPending, withoutWaking, AWAY_MENU, machineReaches } from "../kanso/mods/kanso-spaces/row-states.js";
import { COULD_NOT_SLEEP, SLEEP_FAILED, SLEEP_PENDING } from "../kanso/mods/kanso-sleep/resume.js";
import { present } from "../kanso/mods/kanso-spaces/since-left-model.js";

const asleep = { address: "zz:t1", asleep: { terminal: "t1" } };

test("Wake is offered on a reachable asleep row, and not when the computer cannot be reached, the sleep failed, or forget is armed", async () => {
  assert.equal(machineReaches("unavailable"), false);
  assert.equal(machineReaches("connected"), true);
  assert.equal(canWake(asleep), true);
  assert.equal(canWake(asleep, false), false);
  assert.equal(asleepLook({}).wake, "Wake");
  assert.equal(asleepLook({}).enterWakes, true);
  assert.equal(asleepLook({ reachable: false }).wake, null);
  const failed = asleepLook({ failed: true });
  assert.equal(failed.wake, null);
  assert.equal(failed.failure, COULD_NOT_SLEEP);
  assert.equal(failed.undo, true);
  assert.equal(asleepLook({ armed: true }).armed, true);
  assert.equal(asleepLook({ armed: true }).wake, null);
  const { asleep: asleepRows } = await load("kanso-spaces/asleep.js", ["asleep"], drawingHost());
  const { tokens } = await load("kanso-spaces/ui.js", ["tokens"], drawingHost());
  const drawn = (look) => texts(asleepRows({ names: ["Ada"], open: true, ...look })[1]("row", tokens(KIT_NIGHT), {}));
  assert.equal(drawn({ wake: null, failure: COULD_NOT_SLEEP }).includes("Wake"), false);
  assert.ok(drawn({ wake: null, failure: COULD_NOT_SLEEP }).includes(COULD_NOT_SLEEP));
  assert.ok(drawn({ wake: null, failure: COULD_NOT_SLEEP }).includes("Undo"));
  assert.ok(drawn({ armed: true }).includes("Press again to forget"));
  assert.equal(drawn({ wake: null }).includes("Wake"), false);
});

test("Sleep pressed moves the row at once, and the screen does not keep that fact", () => {
  const agent = { address: "t1", space: "sp1", name: "Ada", space_name: "fury" };
  const moved = withPending({ rows: [], dozing: new Set() }, [agent], ["t1"]);
  assert.deepEqual(moved.rows.map((row) => row.asleep.terminal), ["t1"]);
  assert.equal(moved.dozing.has("t1"), true);
  assert.equal(moved.rows[0].status, "asleep");
  const back = withoutWaking(moved, ["t1"]);
  assert.equal(back.rows.length, 0);
  assert.equal(back.dozing.has("t1"), false);
});

test("a sleep that fails publishes could not sleep for those terminals and clears the move", async () => {
  const store = {};
  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], {
    home: () => "/home/me",
    hc: async () => ({ code: 1 }),
    spaces: () => [{ id: "sp1", active: true, tabs: [{ id: "a", active: true }] }],
    props: () => ({}),
    run: () => {},
    closeOverlay: () => {},
    shared: (key) => store[key] ?? null,
    setShared: (key, value) => { store[key] = value; },
  });
  const view = new Sleep();
  view.order = { scope: "agent" };
  view.space = { id: "sp1", tabs: [{ id: "a", active: true }] };
  view.reads = [{ terminal: "t1", name: "Ada", resume: "00000000-0000-4000-8000-000000000001", running: true }];
  await view.sleep({ notify() {}, sleep: async () => {} });
  assert.match(view.error, /can't sleep/);
  assert.equal(store[SLEEP_PENDING], null);
  assert.equal(store[SLEEP_FAILED].text, COULD_NOT_SLEEP);
  assert.equal(JSON.stringify(store[SLEEP_FAILED].terminals), JSON.stringify(["t1"]));
});

const away = async (rows) => {
  const { SinceLeft } = await load("kanso-spaces/since-left.js", ["SinceLeft"], drawingHost());
  return Object.assign(new SinceLeft(null), { project: ":/work", rows });
};

test("a closed pane keeps its last words, and a right-click offers dismiss or switch off", async () => {
  const event = { id: 1, target: "agent:gone", kind: "finished", text: "Ada finished", did: "shipped the row", at: 0 };
  assert.equal(present([event], { now: 0, format: () => "" })[0].detail, "shipped the row");
  const menus = [];
  const view = await away([event]);
  const card = view.render(KIT_NIGHT, ":/work", () => false, () => null, () => menus.push("menu"));
  assert.ok(texts(card).includes("shipped the row"), "the last words stay on the row");
  const press = nodes(card).flatMap((el) => el.calls).find((call) => call[0] === "on_mouse_down" && call[1] === "right");
  assert.equal(typeof press?.[2], "function");
  press[2]({}, { stop_propagation() {} });
  assert.deepEqual(menus, ["menu"]);
  assert.deepEqual(AWAY_MENU, ["Dismiss", "Switch off"]);
});

test("the away summary draws inside a 420-wide sidebar and does not take a width of its own", async () => {
  const tokens = JSON.parse(readFileSync(new URL("../kanso/tokens.json", import.meta.url), "utf8"));
  const width = (name) => Number.parseInt(tokens.layout.find((token) => token.name === name).value, 10);
  assert.equal(420 >= width("k-w-sidebar-min") && 420 <= width("k-w-sidebar-max"), true);
  const view = await away([{ id: 1, target: "agent:a", kind: "finished", text: "Ada finished", did: "the last line", at: 0 }]);
  const card = view.render(KIT_NIGHT, ":/work", () => false, () => () => {});
  assert.ok(texts(card).includes("While you were away"));
  assert.ok(texts(card).includes("the last line"));
  assert.equal(nodes(card).some((el) => el.calls.some((call) => call[0] === "w" && call[1] === 420)), false);
});

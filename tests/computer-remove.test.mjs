import test from "node:test";
import assert from "node:assert/strict";
import { loadSpaces } from "./mod-fixtures.mjs";
import { clone, context } from "./helpers.mjs";

const record = { name: "grey", target: "grey.example", via: "", session: "", temporary: false };

const viewFor = async ({ machines = [], parked = [], hc, notices }) => {
  const { Spaces } = await loadSpaces({
    hc,
    notify: (note) => notices.push(clone(note)),
  });
  const forgotten = [];
  const view = Object.assign(new Spaces(), {
    powerBusy: new Set(), login: new Set(), failed: new Set(), waking: new Set(),
    machines, parked, names: { title: (name) => name }, awake: false,
  });
  view.db = () => ({ forgetMachine: async (name) => { forgotten.push(name); } });
  view.readMachines = async () => {};
  view.redraw = () => {};
  return { view, forgotten };
};

test("removeMachine drops a listed computer with rm, and an Off-only one without it, then offers to add it back", async () => {
  const listedCalls = [];
  const listedNotes = [];
  const listed = await viewFor({
    machines: [{ name: "grey", target: "grey.example", via: false, state: "connected" }],
    parked: [record],
    hc: async (args) => { listedCalls.push(clone(args)); return { code: 0, stdout: "" }; },
    notices: listedNotes,
  });
  const tasks = context();
  listed.view.removeMachine("grey", tasks.cx);
  await tasks.drain();
  assert.deepEqual(listedCalls, [["machine", "rm", "grey"]]);
  assert.deepEqual(listed.view.parked, []);
  assert.deepEqual(listed.view.machines, []);
  assert.deepEqual(listed.forgotten, ["grey"]);
  assert.equal(listedNotes[0].action.name, "kanso-spaces.restore-machine:grey");

  const offCalls = [];
  const offNotes = [];
  const off = await viewFor({
    parked: [record],
    hc: async (args) => { offCalls.push(clone(args)); return { code: 0, stdout: "" }; },
    notices: offNotes,
  });
  const offTasks = context();
  off.view.removeMachine("grey", offTasks.cx);
  await offTasks.drain();
  assert.deepEqual(offCalls, []);
  assert.deepEqual(off.view.parked, []);
  assert.deepEqual(off.forgotten, ["grey"]);
  assert.equal(offNotes[0].action.name, "kanso-spaces.restore-machine:grey");
});

test("restoreMachine adds the kept record back, and an error toast names the failure", async () => {
  const added = [];
  const notices = [];
  const { view } = await viewFor({
    hc: async (args) => { added.push(clone(args)); return { code: 0, stdout: "" }; },
    notices,
  });
  view.removed = { grey: record };
  const tasks = context();
  view.restoreMachine("grey", tasks.cx);
  await tasks.drain();
  assert.deepEqual(added, [["machine", "add", "grey.example", "--name", "grey", "--json"]]);
  assert.equal(view.removed.grey, undefined);
  assert.deepEqual(notices, []);

  const failed = [];
  const errors = [];
  const again = await viewFor({
    hc: async (args) => { failed.push(clone(args)); return { code: 1, stderr: "timed out" }; },
    notices: errors,
  });
  again.view.removed = { grey: record };
  const failTasks = context();
  again.view.restoreMachine("grey", failTasks.cx);
  await failTasks.drain();
  assert.deepEqual(failed, [["machine", "add", "grey.example", "--name", "grey", "--json"]]);
  assert.deepEqual(again.view.removed.grey, record);
  assert.equal(errors[0].level, "error");
  assert.equal(errors[0].body, "timed out");
});

import test from "node:test";
import assert from "node:assert/strict";
import { computersDialog, nodes, texts } from "./helpers.mjs";

const MACHINE = { name: "box", target: "ada@10.0.0.9", via: "ssh -J bastion" };

const open = async ({ failRm = false } = {}) => {
  const asked = [];
  const ran = [];
  let listed = [{ ...MACHINE }];
  const { view, cx, flush } = await computersDialog({
    hc: async (args) => {
      asked.push([...args]);
      if (args[1] === "ls") return { code: 0, stdout: JSON.stringify({ machines: listed }), stderr: "" };
      if (args[1] === "rm") {
        if (failRm) return { code: 1, stdout: "", stderr: "could not remove" };
        listed = listed.filter((row) => row.name !== args[2]);
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[1] === "add") {
        const nameAt = args.indexOf("--name");
        const viaAt = args.indexOf("--via");
        const name = args[nameAt + 1];
        listed = [...listed.filter((row) => row.name !== name), {
          name, target: args[2] === "--name" ? "" : args[2], via: viaAt < 0 ? "" : args[viaAt + 1],
        }];
        return { code: 0, stdout: "{}", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "unexpected" };
    },
    run: (command) => { ran.push(command); },
    shared: (key) => (key === "kanso.pieces" ? { "computers.network": "hide" } : null),
  });
  const click = (el) => {
    const handler = el.calls.find((call) => call[0] === "on_click")?.[1];
    assert.ok(handler, el?.tag);
    handler({}, cx);
  };
  const button = (drawn, tag) => nodes(drawn).find((el) => el.tag === tag);
  return { view, asked, ran, click, flush, button };
};

const ROW = "computer-added:box-action";

test("Disconnect removes an added computer, then the row shows Disconnected with Add and Undo, and Undo adds it back the same way", async () => {
  const { view, asked, ran, click, flush, button } = await open();
  const before = view.render();
  assert.deepEqual(texts(button(before, ROW)), ["Disconnect"]);
  click(button(before, ROW));
  await flush();
  assert.deepEqual(asked.filter((args) => args[1] === "rm"), [["machine", "rm", "box"]]);
  assert.ok(ran.includes("kanso-spaces.retry-machine:box"));
  const gone = view.render();
  assert.ok(texts(gone).includes("Disconnected"));
  const undo = nodes(gone).find((el) => el.tag?.startsWith("computer-added:box-detail") && texts(el).includes("Undo"));
  assert.ok(undo);
  const add = button(gone, ROW);
  click(undo);
  await flush();
  assert.deepEqual(asked.filter((args) => args[1] === "add"), [[
    "machine", "add", "ada@10.0.0.9", "--name", "box", "--via", "ssh -J bastion", "--json",
  ]]);
  assert.deepEqual(texts(button(view.render(), ROW)), ["Disconnect"]);
  assert.deepEqual(add ? texts(add) : [], ["Add"]);
});

test("When Disconnect cannot remove the computer, it stays listed and Retry tries again", async () => {
  const { view, asked, click, flush, button } = await open({ failRm: true });
  click(button(view.render(), ROW));
  await flush();
  const stayed = view.render();
  assert.ok(texts(stayed).includes("box"));
  assert.deepEqual(texts(button(stayed, ROW)), ["Disconnect"]);
  const retry = button(stayed, "computer-fail-added:box-fix");
  assert.deepEqual(texts(retry), ["Retry"]);
  click(retry);
  await flush();
  assert.deepEqual(asked.filter((args) => args[1] === "rm"), [["machine", "rm", "box"], ["machine", "rm", "box"]]);
  assert.ok(texts(view.render()).includes("box"));
});

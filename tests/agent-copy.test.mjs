import test from "node:test";
import assert from "node:assert/strict";
import { clone, load } from "./helpers.mjs";

const { copiesToViewer } = await load("kanso-panel/platform-viewer.js", ["copiesToViewer", "VIEWER_ENV"]);
const marker = [
  "env",
  "SSH_CONNECTION=0.0.0.0 0 0.0.0.0 0",
  "SSH_CLIENT=0.0.0.0 0 0",
  "HERDR_ENV=1",
  "HERDR_REMOTE_VIEWER=1",
];
const on = (platform) => load("kanso-panel/platform-viewer.js", ["viewerFor"], { window: () => ({ platform }) });

test("copiesToViewer wraps an agent's argv on macOS and Linux, and leaves Windows plain", () => {
  assert.deepEqual(clone(copiesToViewer("macos")(["claude"])), [...marker, "claude"]);
  assert.deepEqual(clone(copiesToViewer("linux")(["pi"])), [...marker, "pi"]);
  assert.deepEqual(clone(copiesToViewer("windows")(["claude"])), ["claude"]);
});

test("copiesToViewer leaves an empty or null argv alone, and does not wrap a command that already starts with env", () => {
  const empty = [];
  assert.equal(copiesToViewer("linux")(empty), empty);
  assert.equal(copiesToViewer("macos")(null), null);
  const once = copiesToViewer("macos")(["claude"]);
  assert.equal(copiesToViewer("linux")(once), once);
});

test("viewerFor with no machine uses this computer's platform", async () => {
  const linux = await on("linux");
  assert.deepEqual(clone(await (await linux.viewerFor(null))(["claude"])), [...marker, "claude"]);
  const windows = await on("windows");
  assert.deepEqual(clone(await (await windows.viewerFor(null))(["claude"])), ["claude"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checks, marks, steps, summary, TESTS } from "../scripts/pre-pr.mjs";

const ci = () => readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("Pre-PR runs every check CI runs and then the tests, and CI runs the same checks through it", async () => {
  const text = await ci();
  assert.match(text, /run: npm run pre-pr -- --checks-only\n/);
  const runs = [...text.matchAll(/^\s+run: (npm (?:run|test).*)$/gm)].map(([, command]) => command);
  assert.deepEqual(runs.filter((command) => !command.startsWith("npm test") && !command.startsWith("npm run pre-pr")), [], "a check CI runs outside pre-pr is one a pull request never ran");
  assert.deepEqual(steps(["node", "pre-pr.mjs"]).map(({ name }) => name).at(-1), TESTS.name);
  assert.ok(!steps(["node", "pre-pr.mjs", "--checks-only"]).includes(TESTS));
  assert.deepEqual(checks("develop").map(({ name }) => name), [
    "npm run check:version -- --branch develop",
    "npm run sync:share -- --check",
    "npm run build:site -- --check",
    "npm run build:issue-forms -- --check",
    "npm run build:linux-keys -- --check",
    "npm run build:link-rules -- --check",
    "npm run check:dupes",
  ]);
});

test("Pre-PR checks a pull request against develop's version rules unless CI names the branch", () => {
  assert.equal(checks()[0].argv.at(-1), process.env.KANSO_BRANCH || "develop");
  assert.equal(checks("main")[0].argv.at(-1), "main");
});

test("Pre-PR marks a clean, full local run", () => {
  assert.equal(marks({ env: {}, argv: [], dirty: "" }), true);
});

test("Pre-PR does not mark CI, checks-only runs, or uncommitted tracked changes", () => {
  const local = { env: {}, argv: [], dirty: "" };
  assert.equal(marks({ ...local, env: { CI: "true" } }), false);
  assert.equal(marks({ ...local, argv: ["--checks-only"] }), false);
  assert.equal(marks({ ...local, dirty: " M scripts/pre-pr.mjs\n" }), false);
});

test("Pre-PR ends with one line per step, ready for the Tests section", () => {
  assert.equal(summary([{ name: "npm run check:dupes", ok: true }, { name: "npm test", ok: false }]), "- npm run check:dupes: passed\n- npm test: failed");
});

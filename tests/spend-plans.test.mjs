import assert from "node:assert/strict";
import test from "node:test";
import { claudePlan } from "../kanso/mods/kanso-spend/core/detect-plans.mjs";
import { planLines, withDetected } from "../kanso/mods/kanso-spend/core/plans.mjs";
import { clone, load } from "./helpers.mjs";

const max = { name: "Claude Max 20x", usdPerMonth: 200 };
const chat = { name: "ChatGPT Pro", usdPerMonth: 100 };
const grok = { name: "SuperGrok", usdPerMonth: 20 };
const month = (byProvider, day = 7) => ({ name: "November", days: 30, day, byProvider });
const detectedMax = () => claudePlan({ oauthAccount: { organizationRateLimitTier: "default_claude_max_20x" } });
const exampleLines = () => planLines([max, chat, grok], month({ anthropic: 5_000, openai: 300, "openai-codex": 10, xai: 6 }));

test("Each plan shows its own multiple and flags one that is not paying for itself.", () => {
  const lines = exampleLines();
  assert.deepEqual(lines.map((line) => line.multiple), ["25×", "3.1×", "0.3×"]);
  assert.equal(lines[2].detail, "$6.00 of work for $20.00 · not paying for itself");
  assert.equal(lines[2].tone, "working");
});

test("Before day seven Spend shows a quiet pace estimate instead of judging the plan.", () => {
  const [line] = planLines([max], month({ anthropic: 60 }, 6));
  assert.equal(line.unit, "Claude Max 20x · too early to say");
  assert.equal(line.detail, "on pace: $60.00 in 6 days, about $300 by November 30");
  assert.equal(line.tone, "dim");
});

test("Two plans on one provider split its work in proportion to their prices.", () => {
  const pro = { name: "Claude Pro", usdPerMonth: 20 };
  const lines = planLines([pro, max], month({ anthropic: 660 }));
  assert.deepEqual(lines.map((line) => line.detail), ["$60.00 of work for $20.00", "$600 of work for $200"]);
});

test("A plan with an unrecognized name covers only providers no other plan claims.", () => {
  const other = { name: "My subscription", usdPerMonth: 20 };
  const lines = planLines([max, other], month({ anthropic: 400, openai: 40, xai: 20 }));
  const byName = Object.fromEntries(lines.map(({ name, multiple }) => [name, multiple]));
  assert.deepEqual(byName, { [max.name]: "2×", [other.name]: "3×" });
});

test("Spend detects Claude Max 20x at $200 a month and shows nothing when no plan is known.", () => {
  assert.deepEqual(detectedMax(), { ...max, providers: ["anthropic"], detected: true });
  assert.equal(claudePlan({ oauthAccount: {} }), null);
});

test("The user's own Claude plan replaces the detected plan for that provider.", () => {
  const manual = { name: "Claude Max", usdPerMonth: 150 };
  const detected = [detectedMax()];
  assert.deepEqual(withDetected([manual], detected), [manual]);
  assert.deepEqual(withDetected([chat], detected), [chat, ...detected]);
});

const share = () => load("kanso-spend/spend-card.js", ["spendSpec", "spendText"]);

test("The Spend share card lists the multiples for each plan.", async () => {
  const { spendSpec } = await share();
  const spec = spendSpec({ plans: exampleLines() });
  assert.equal(spec.note, "25× Claude Max 20x · 3.1× ChatGPT Pro · 0.3× SuperGrok");
});

test("Sharing spend from several computers leaves out the local-only counts and chart.", async () => {
  const { spendSpec, spendText } = await share();
  const costs = {
    machines: [{ id: "local" }, { id: "peer" }],
    hero: {
      value: "$15.00",
      stats: [{ value: "150", unit: "tokens" }, { value: "2", unit: "tasks" }],
    },
    projectCount: "1",
    modelCount: "2",
    chart: { bars: [{ ratio: 1 }] },
  };
  const spec = spendSpec(costs);
  assert.equal(spec.hero.big, "$15.00");
  assert.deepEqual(clone(spec.stats), [{ value: "150", unit: "tokens" }]);
  assert.equal(spec.blocks.length, 0);
  assert.doesNotMatch(spendText(costs), /tasks/);
});

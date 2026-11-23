import test from "node:test";
import assert from "node:assert/strict";
import { load, plain } from "./helpers.mjs";

const now = new Date(2026, 5, 10, 12, 0, 0, 0).getTime();
const clock = (ms, zone) => new Intl.DateTimeFormat("en-GB", {
  timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(ms));

const model = await load("kanso-strip/limits-model.js", [
  "parseLimit", "withLimits", "limitStep", "foundLabels", "limitedProviders",
]);

test("A Claude Code or Codex limit shows when it resets, a limit with no time has no reset, and a fast-mode limit or a normal finish is not a limit", () => {
  const read = (screen) => model.parseLimit(screen, now);
  const madrid = read("You've hit your limit · resets 3pm (Europe/Madrid)");
  assert.equal(clock(madrid.until, "Europe/Madrid"), "15:00");
  assert.ok(madrid.until > now);
  const local = read("Claude usage limit reached. Your limit will reset at 3pm.");
  assert.equal(clock(local.until), "15:00");
  assert.ok(local.until > now);
  const monday = read("Weekly limit reached ∙ resets Mon 10am");
  assert.equal(new Date(monday.until).getDay(), 1);
  assert.equal(clock(monday.until), "10:00");
  assert.ok(monday.until > now);
  const afternoon = read("You've hit your usage limit. try again at 3:05 PM.");
  assert.equal(clock(afternoon.until), "15:05");
  assert.ok(afternoon.until > now);
  assert.equal(read("You've hit your usage limit. try again in 2 hours 13 minutes.").until, now + (2 * 60 + 13) * 60_000);
  assert.equal(read("try again at 3:05 PM."), null);
  assert.equal(read("You've hit your usage limit.").until, null);
  assert.equal(read("You've hit your fast mode limit. resets at 3pm."), null);
  assert.equal(read("Finished the review."), null);
});

test("A done agent with a limit shows Limited until the reset, and a working one stays working", () => {
  const until = new Date(2026, 5, 10, 15, 0, 0, 0).getTime();
  const terms = [{ address: "t1", labels: { "kanso.limit": String(until) } }];
  const done = { address: "t1", status: "done", msg: "old" };
  const working = { address: "t1", status: "working", msg: "still going" };
  const [limited, left] = model.withLimits([done, working], terms, now);
  assert.equal(limited.status, "limited");
  assert.equal(limited.msg, "Limited until 15:00");
  assert.deepEqual(left, working);
});

test("A stopped Claude Code or Codex agent is read once, and working again clears the limit, the resume and our snooze", () => {
  assert.deepEqual(plain(model.limitStep({ status: "done", app: "claude-code" })), { act: "read" });
  assert.deepEqual(plain(model.limitStep({ status: "idle", app: "codex" })), { act: "read" });
  assert.deepEqual(plain(model.limitStep({ status: "blocked", app: "claude-code" })), { act: "read" });
  const until = String(now + 60_000);
  const labeled = { "kanso.limit": until };
  assert.deepEqual(plain(model.limitStep({ status: "done", app: "claude-code", labels: labeled })), { act: "none" });
  const ours = { "kanso.limit": until, "kanso.limit.resume": until, "kanso.limit.cmd": "[\"claude\"]", "kanso.snooze": until };
  assert.deepEqual(plain(model.limitStep({ status: "working", app: "claude-code", labels: ours })), {
    act: "clear",
    labels: ["kanso.limit=", "kanso.limit.resume=", "kanso.limit.cmd=", "kanso.snooze="],
  });
  const hand = { ...ours, "kanso.snooze": String(now + 3_600_000) };
  assert.deepEqual(plain(model.limitStep({ status: "working", app: "codex", labels: hand }).labels), ["kanso.limit=", "kanso.limit.resume=", "kanso.limit.cmd="]);
});

test("Resume at reset is armed only when it is on and the reset is known", () => {
  assert.deepEqual(plain(model.foundLabels({ until: 5000 }, true)), ["kanso.limit=5000", "kanso.limit.resume=5000"]);
  assert.deepEqual(plain(model.foundLabels({ until: 5000 }, false)), ["kanso.limit=5000"]);
  assert.deepEqual(plain(model.foundLabels({ until: null }, true)), ["kanso.limit=?"]);
});

test("A limited Claude Code provider is Claude, and a reset that has passed is dropped", () => {
  const list = [
    { status: "limited", app: "claude-code", limit: { until: now + 60_000 } },
    { status: "limited", app: "codex", limit: { until: now - 1000 } },
  ];
  assert.deepEqual(plain(model.limitedProviders(list, now)), { claude: { until: now + 60_000 } });
});

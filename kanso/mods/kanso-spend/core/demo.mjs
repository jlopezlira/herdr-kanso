// Sample data for screenshots and trying the panel without any sessions:
// create `data/kanso-spend/demo` (any content) and refresh. Nothing here is
// read from disk; delete the file to go back to your own sessions.

import { range } from "../pure.js";

const PROJECTS = ["/work/web-app", "/work/api-server", "/work/mobile", "/work/docs", "/work/infra"];
const MODELS = [
  { harness: "claude", provider: "anthropic", model: "claude-opus-5-5" },
  { harness: "claude", provider: "anthropic", model: "claude-sonnet-5-5" },
  { harness: "codex", provider: "openai", model: "gpt-6-sol" },
  { harness: "pi", provider: "xai", model: "grok-4.7" },
  { harness: "pi", provider: "minimax", model: "MiniMax-M3" },
];
const TASKS = [
  ["WEB-142", "Add rate limiting to the public API"],
  [null, "Migrate the billing page to the new design system"],
  ["MOB-88", "Fix the login crash on Android 15"],
  [null, "Write the onboarding guide for new contributors"],
  ["OPS-31", "Move the staging cluster to the new region"],
  [null, "Refactor the search indexer into a worker"],
  ["WEB-150", "Dark mode for the settings screen"],
  [null, "Investigate the flaky checkout tests"],
  ["API-77", "Paginate the audit log endpoint"],
  [null, "Upgrade the build to Node 22"],
];

// A small deterministic generator so every screenshot looks the same: one
// step turns a seed into the next seed and a number in [0, 1).
const step = (seed) => {
  const next = (seed * 1664525 + 1013904223) >>> 0;
  return [next, next / 2 ** 32];
};
// `n` numbers in a row from `seed`, and the seed after them.
const draws = (seed, n) => range(n).reduce(([s, out]) => {
  const [next, value] = step(s);
  return [next, [...out, value]];
}, [seed, []]);

const pad = (n) => String(n).padStart(2, "0");

/** Rows shaped like snapshotRows(), labels shaped like labels.json, live like liveSessions(). */
export function demoData(today) {
  const [year, month, dayOfMonth] = today.split("-").map(Number);
  // Day by day from 75 days back to today, each with one to four sessions;
  // the seed and the session count carry from one day to the next.
  const { days } = range(76).map((k) => 75 - k).reduce(({ seed, session, days }, back) => {
    const date = new Date(year, month - 1, dayOfMonth - back);
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const [afterCount, [count]] = draws(seed, 1);
    const sessionsToday = 1 + Math.floor(count * 4);
    const made = range(sessionsToday).reduce(({ seed: s, list }, i) => {
      const [after, [pick, pickModel, size]] = draws(s, 3);
      const taskIndex = Math.floor(pick * TASKS.length);
      const model = MODELS[Math.floor(pickModel * MODELS.length)];
      return { seed: after, list: [...list, { back, i, day, id: `demo:${session + i + 1}`, taskIndex, model, scale: 0.3 + size * 2.2 }] };
    }, { seed: afterCount, list: [] });
    return { seed: made.seed, session: session + sessionsToday, days: [...days, made.list] };
  }, { seed: 42 >>> 0, session: 0, days: [] });
  const sessions = days.flat();
  const rows = sessions.map(({ day, id, taskIndex, model, scale }) => {
    const cacheRead = Math.round(9e6 * scale);
    const counts = {
      input: Math.round(1.6e5 * scale),
      output: Math.round(6e4 * scale),
      cacheRead,
      cacheWrite: model.harness === "claude" ? Math.round(cacheRead * 0.02) : 0,
      reasoning: 0,
    };
    return {
      day, session: id, harness: model.harness, provider: model.provider, model: model.model, project: PROJECTS[taskIndex % PROJECTS.length],
      tokens: { ...counts, total: counts.input + counts.output + counts.cacheRead + counts.cacheWrite },
      messages: Math.round(20 * scale),
    };
  });
  const labels = {
    version: 0,
    sessions: Object.fromEntries(sessions.map(({ id, taskIndex }) => {
      const task = TASKS[taskIndex];
      return [id, { prompt: task[1], tickets: task[0] ? [task[0]] : [] }];
    })),
  };
  const live = new Map(sessions.filter(({ back, i }) => back === 0 && i < 2).map(({ id, i }) => [id, Date.now() - i * 4 * 60 * 1000]));
  return { rows, labels, live };
}

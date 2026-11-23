import { field, labelled, choices } from "./ui-field.js";
import { tabs } from "./kit.js";
import { validWhen, whenWords, pad } from "./clock-model.js";

export const KINDS = [{ key: "daily", label: "Time of day" }, { key: "every", label: "Every" }, { key: "once", label: "Once" }];
export const UNITS = [{ key: "minutes", label: "Minutes" }, { key: "hours", label: "Hours" }];
export const DAYS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ key: d, label: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d] }));
const stamp = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function draftOf(s, now) {
  const when = s?.when ?? null;
  return {
    agent: s?.agent ?? null,
    prompt: s?.prompt ?? "",
    kind: when?.kind ?? "daily",
    time: when?.kind === "daily" ? when.time : "09:00",
    days: when?.kind === "daily" ? when.days : [1, 2, 3, 4, 5],
    every: when?.kind === "every" ? String(when.every) : "30",
    unit: when?.kind === "every" ? when.unit : "minutes",
    at: stamp(when?.kind === "once" ? when.at : now + 3_600_000),
    tree: Boolean(s?.tree),
  };
}

const atOf = (text) => {
  const m = String(text).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime() : null;
};

export function whenOfDraft(d, now) {
  if (d.kind === "daily") {
    if (!/^\d{1,2}:\d{2}$/.test(d.time.trim()) || Number(d.time.split(":")[0]) > 23 || Number(d.time.split(":")[1]) > 59) return { error: "Write the time as 09:00." };
    if (!d.days.length) return { error: "Pick at least one day." };
    return { when: { kind: "daily", time: d.time.trim(), days: d.days.toSorted((a, b) => a - b) } };
  }
  if (d.kind === "every") {
    const every = Number(d.every);
    return Number.isInteger(every) && every >= 1 ? { when: { kind: "every", every, unit: d.unit, start: now } } : { error: "Every how many? Write a whole number." };
  }
  const at = atOf(d.at);
  return at && at > now ? { when: { kind: "once", at } } : { error: "Write a later date and time, as 2026-11-23 09:00." };
}

export function checkDraft(d, now) {
  if (!d.agent) return { error: "Pick an agent." };
  if (!d.prompt.trim()) return { error: "Write what the agent is asked." };
  const w = whenOfDraft(d, now);
  return w.error ? w : validWhen(w.when) ? w : { error: "That time can't be scheduled." };
}

export const scheduleWords = (s) => `${s.agentName} · ${whenWords(s.when)}`;

export function scheduleBody(id, c, { draft, agents, fields, base, on }) {
  const kindPart = draft.kind === "daily"
    ? [field(`${id}-time`, fields.time, c, { label: "Time" }), labelled("Days", choices(`${id}-days`, DAYS, (d) => draft.days.includes(d), on.day, c), c)]
    : draft.kind === "every"
      ? [field(`${id}-every`, fields.every, c, { label: "Every" }), tabs({ items: UNITS, value: draft.unit })(`${id}-unit`, c, { onChange: on.unit })]
      : [field(`${id}-at`, fields.at, c, { label: "Date and time" })];
  return [
    labelled("Agent", agents, c),
    field(`${id}-prompt`, fields.prompt, c, { label: "Prompt" }),
    labelled("When", tabs({ items: KINDS, value: draft.kind })(`${id}-kind`, c, { onChange: on.kind }), c),
    ...kindPart,
    choices(`${id}-tree`, [{ key: "tree", label: `New worktree from ${base || "the default branch"}` }], () => draft.tree, on.tree, c),
  ];
}

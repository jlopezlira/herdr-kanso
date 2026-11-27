import { EASE } from "./ui.js";

export const glowState = (previous, agents, now) => {
  const live = new Set(agents.map(({ address }) => address));
  const working = new Set(agents.filter(({ status }) => status === "working").map(({ address }) => address));
  const leaving = new Map([
    ...[...previous.leaving].filter(([id, until]) => live.has(id) && !working.has(id) && until > now),
    ...[...previous.working].filter((id) => live.has(id) && !working.has(id)).map((id) => [id, now + EASE.duration]),
  ]);
  return { working, leaving };
};

export const glowDeadline = (state) => Array.from(state.leaving.values()).reduce((first, until) => Math.min(first, until), Infinity);

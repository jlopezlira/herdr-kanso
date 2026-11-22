// One set of states for asleep rows, Wake, the away summary and Needs you. Apache-2.0.
import { COULD_NOT_SLEEP } from "./resume.js";

export const FORGET_HELD = "kanso.sleep.forget";

export function forgetHeld(record, terminal, now, ms) {
  return Boolean(terminal && record?.terminal === terminal && now - record.at <= ms);
}

export function holdForget(terminal, now) {
  return { terminal, at: now };
}

export const machineReaches = (layout) => layout !== "unavailable";

export function asleepLook({ reachable = true, failed = false, armed = false } = {}) {
  const offer = reachable && !failed && !armed;
  return {
    dimmed: true,
    wake: offer ? "Wake" : null,
    enterWakes: offer,
    failure: failed ? COULD_NOT_SLEEP : null,
    undo: Boolean(failed),
    armed: Boolean(armed),
  };
}

export function withPending(asleep, agents, pending = []) {
  const ids = [...new Set(pending)].filter(Boolean);
  const base = asleep ?? { rows: [], dozing: new Set() };
  if (!ids.length) return base;
  const have = new Set(base.rows.map((row) => row.asleep?.terminal));
  const extra = (agents ?? []).filter((agent) => ids.includes(agent.address) && !have.has(agent.address)).map((agent) => ({
    address: `zz:${agent.address}`,
    pane: null,
    tab: null,
    space: agent.space,
    status: "asleep",
    labels: {},
    pin: null,
    seq: agent.seq ?? 0,
    turn: agent.turn ?? 0,
    name: agent.name || agent.title || "Claude",
    title: agent.title ?? null,
    program: agent.program ?? null,
    asleep: {
      id: agent.address,
      spaceName: agent.space_name ?? null,
      tab: agent.name || "Claude",
      n: 1,
      saved: null,
      said: null,
      resume: null,
      terminal: agent.address,
      tabId: agent.tab ?? null,
      settled: false,
      space: agent.space,
      pending: true,
    },
  }));
  return { rows: [...base.rows, ...extra], dozing: new Set([...base.dozing, ...ids]) };
}

export function withoutWaking(asleep, waking = []) {
  const ids = new Set(waking.filter(Boolean));
  const base = asleep ?? { rows: [], dozing: new Set() };
  if (!ids.size) return base;
  return {
    rows: base.rows.filter((row) => !ids.has(row.asleep?.terminal)),
    dozing: new Set([...base.dozing].filter((id) => !ids.has(id))),
  };
}


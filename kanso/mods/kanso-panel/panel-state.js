// What a panel keeps for one project, and which panel is the open one.
// A panel saves with saveState() and restores with restoreState(state).
export const OPEN = "_open";
export const STATE_MS = 1500;
export const LATE = Symbol("late");

const BACKS = new Set(["files", "look"]);
const PERIODS = new Set(["day", "week", "month", "year"]);
const RANGES = new Set(["day", "week", "month"]);

const safeRel = (p) => typeof p === "string" && p.length > 0 && !p.startsWith("/") && !p.startsWith("\\") && !/^[A-Za-z]:/.test(p)
  && p.split(/[\\/]/).every((part) => part !== ".." && part !== "");

export function openOf(state) {
  const id = state?.id;
  return typeof id === "string" && id ? id : null;
}

// Preview has no button. A button that is turned off does not come back.
export function canOpen(id, enabled) {
  if (typeof id !== "string" || !id) return null;
  if (id === "preview") return "preview";
  return Array.isArray(enabled) && enabled.includes(id) ? id : null;
}

// `record` undefined: this project has no row. `{ id: null }`: it was closed.
export function projectOpen({ record, legacy, enabled, now, first }) {
  const known = record !== undefined && record !== null;
  if (!known && first && legacy === undefined) return { mount: undefined, save: now ?? null, adopt: true };
  const mount = canOpen(known ? openOf(record) : (typeof legacy === "string" ? legacy : null), enabled);
  return { mount, save: mount, adopt: false };
}

export function takeState(panel) {
  if (typeof panel?.saveState !== "function") return undefined;
  try {
    const state = panel.saveState();
    if (state === undefined) return undefined;
    if (!state || typeof state !== "object" || Array.isArray(state)) return null;
    return state;
  } catch { return undefined; }
}

// The saved state, or LATE once `ms` pass on cx.timer: a lost read never keeps a panel on its skeleton.
export const stateWithin = (read, timer, ms = STATE_MS) => Promise.race([read, new Promise((resolve) => timer.after(ms, () => resolve(LATE)))]);

export async function giveState(panel, state, cx) {
  if (state == null || typeof panel?.restoreState !== "function") return false;
  try { return (await panel.restoreState(state, cx)) !== false; }
  catch { return false; }
}

export function fileMemory(state, exists) {
  if (!state || typeof state.path !== "string" || !state.path || !exists(state.path)) return null;
  return { path: state.path, back: BACKS.has(state.back) ? state.back : null, on: state.on ?? null };
}

export function filesMemory(state, cwd, fileExists) {
  if (!state || state.cwd !== cwd) return null;
  const folders = Array.isArray(state.folders) ? state.folders.filter(safeRel) : [];
  const file = safeRel(state.file) && fileExists(state.file) ? state.file : null;
  return { cwd, folders, file };
}

export function prMemory(state, status) {
  const url = typeof state?.url === "string" ? state.url : "";
  if (!url || status(url) !== "open") return null;
  return { url };
}

export function lookMemory(state, exists) {
  const path = typeof state?.path === "string" ? state.path : "";
  if (!path || !exists(path)) return null;
  return { path };
}

export function shippedMemory(state) {
  if (!PERIODS.has(state?.kind)) return null;
  const offset = Number.isFinite(Number(state.offset)) ? Math.min(0, Math.round(Number(state.offset))) : 0;
  return { kind: state.kind, offset };
}

export function portsMemory(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return {
    range: RANGES.has(state.range) ? state.range : "day",
    tab: typeof state.tab === "string" ? state.tab : null,
    showAll: Boolean(state.showAll),
  };
}

export function worktreesMemory(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return {
    picked: typeof state.picked === "string" && state.picked ? state.picked : null,
    more: Array.isArray(state.more) ? state.more.filter((x) => typeof x === "string") : [],
    allRepos: Boolean(state.allRepos),
  };
}

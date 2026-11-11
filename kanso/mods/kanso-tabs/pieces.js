// One list of everything kansō can show, and the one read every mod uses.
// An id missing from the map means its default. Hide stops a piece whose work is a command.

export const STORE = "kanso.pieces";
export const MIGRATED = "kanso.pieces.migrated";

export const GROUPS = ["Sidebar", "Pane header", "Status bar", "Tab bar and panels", "Notifications", "Background"];

const SHOW = ["show", "hide"];
const THREE = ["show", "needed", "hide"];

const piece = (id, label, group, states, def, stops, job = null) => ({ id, label, group, states, default: def, stops, job });

const PANELS = [
  ["files", "Files", "git"], ["insights", "Spend"], ["pr", "PR", "gh"], ["shipped", "Shipped", "git"], ["worktrees", "Worktrees", "git"],
  ["ports", "Ports", "lsof"], ["containers", "Containers", "docker"], ["memory", "Memory", "ps"], ["look", "Images"], ["sim", "Simulator"],
];

export const PIECES = [
  piece("sidebar.switch", "Projects, Status, Threads", "Sidebar", SHOW, "show", "draw"),
  piece("sidebar.activity", "What each agent is on", "Sidebar", SHOW, "show", "work", "ps"),
  piece("sidebar.time", "Time in its state", "Sidebar", SHOW, "show", "draw"),
  piece("sidebar.tasks", "Commands still running", "Sidebar", SHOW, "show", "work", "ps"),
  piece("sidebar.git", "Branch, ahead, behind", "Sidebar", SHOW, "show", "work", "git"),
  piece("sidebar.away", "While you were away", "Sidebar", THREE, "needed", "work"),
  // The list already appears only when it has rows, so the default stays When needed.
  piece("sidebar.needs", "Needs you", "Sidebar", THREE, "needed", "draw"),
  piece("sidebar.computers", "Computers", "Sidebar", SHOW, "show", "work"),
  piece("footer.machine", "Add a computer", "Sidebar", SHOW, "show", "draw"),
  piece("header.place", "Folder and branch", "Pane header", SHOW, "show", "draw"),
  piece("header.digest", "Files and commits", "Pane header", THREE, "needed", "work", "git"),
  piece("header.pr", "PR", "Pane header", THREE, "needed", "work", "gh"),
  piece("status.computer", "Computer and branch", "Status bar", SHOW, "show", "draw"),
  piece("status.agents", "Agents at work", "Status bar", SHOW, "show", "draw"),
  piece("strip.minimap", "Minimap", "Status bar", SHOW, "show", "draw"),
  piece("status.palette", "Command palette key", "Status bar", SHOW, "show", "draw"),
  piece("tabs.arrange", "Arrangements", "Tab bar and panels", SHOW, "show", "draw"),
  ...PANELS.map(([id, label, job = null]) => piece(`panel.${id}`, label, "Tab bar and panels", SHOW, "show", "work", job)),
  piece("toast.update", "kansō update", "Notifications", SHOW, "show", "draw"),
  piece("toast.memory", "Memory low", "Notifications", SHOW, "show", "draw"),
  piece("update.check", "Check for updates", "Background", SHOW, "show", "work", "git"),
];

export const STATE_LABEL = { show: "Show", needed: "When needed", hide: "Hide" };

export function pieceOf(id) {
  const found = PIECES.find((row) => row.id === id);
  if (found) return found;
  if (typeof id === "string" && id.startsWith("panel.") && id.length > "panel.".length) {
    return piece(id, id.slice("panel.".length), "Tab bar and panels", SHOW, "show", "work");
  }
  return null;
}

const asMap = (map) => (map && typeof map === "object" && !Array.isArray(map) ? map : {});

export function pieces(read) {
  return asMap(read?.(STORE));
}

export function choice(id, map) {
  const row = pieceOf(id);
  const stored = asMap(map)[id];
  if (row?.states.includes(stored)) return stored;
  return row?.default ?? "show";
}

export function shown(id, has, map) {
  const state = choice(id, map);
  if (state === "hide") return false;
  if (state === "needed") return Boolean(has);
  return true;
}

export function runs(id, map) {
  const row = pieceOf(id);
  return Boolean(row && row.stops === "work" && choice(id, map) !== "hide");
}

export function asksPs(map, { working = false, alive = false } = {}) {
  const table = (runs("sidebar.activity", map) || runs("sidebar.tasks", map)) && working;
  return Boolean(table || alive);
}

export function setPiece(map, id, state) {
  const row = pieceOf(id);
  const current = asMap(map);
  if (!row || !row.states.includes(state)) return { ...current };
  if (state === row.default) return Object.fromEntries(Object.entries(current).filter(([key]) => key !== id));
  return { ...current, [id]: state };
}

export function panelOff(map) {
  return Object.entries(asMap(map)).flatMap(([id, state]) => (id.startsWith("panel.") && state === "hide" ? [id.slice("panel.".length)] : []));
}

export function hiddenSet(map) {
  const ids = [...new Set([...PIECES.map((row) => row.id), ...Object.keys(asMap(map))])];
  return new Set(ids.filter((id) => choice(id, map) === "hide"));
}

const panelPiece = (id) => (String(id).startsWith("panel.") ? String(id) : `panel.${id}`);

export function migratePieces({ hidden, off, autoCheck, pieces, migrated }) {
  const base = asMap(pieces);
  if (migrated) return { pieces: { ...base }, migrated: true };
  const hiddenIds = (Array.isArray(hidden) ? hidden : []).filter((id) => pieceOf(id));
  const offIds = (Array.isArray(off) ? off : []).map(panelPiece).filter((id) => pieceOf(id));
  const extra = Object.fromEntries([
    ...hiddenIds.map((id) => [id, "hide"]),
    ...offIds.map((id) => [id, "hide"]),
    ...(autoCheck === false ? [["update.check", "hide"]] : []),
  ]);
  return { pieces: { ...base, ...extra }, migrated: true };
}

export function loadPieces(shared, setShared) {
  const migrated = shared(MIGRATED) === true;
  const pieces = asMap(shared(STORE));
  if (migrated) return pieces;
  const update = shared("kanso.update");
  const done = migratePieces({
    hidden: shared("kanso.hidden"),
    off: shared("kanso.panels.off"),
    autoCheck: update && typeof update === "object" ? update.autoCheck : undefined,
    pieces,
    migrated: false,
  });
  if (typeof setShared === "function") {
    setShared(STORE, done.pieces);
    setShared(MIGRATED, true);
  }
  return done.pieces;
}

export function filterPieces(query, list = PIECES) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter((row) => row.label.toLowerCase().includes(q) || row.id.toLowerCase().includes(q));
}

export function groupsOf(list) {
  return GROUPS.flatMap((name) => {
    const rows = list.filter((row) => row.group === name);
    return rows.length ? [{ name, rows }] : [];
  });
}

export function withRoster(roster, list = PIECES) {
  const known = new Set(list.map((row) => row.id));
  const extra = (Array.isArray(roster) ? roster : []).flatMap((panel) => {
    const id = panel && typeof panel.id === "string" ? `panel.${panel.id}` : "";
    if (!id || known.has(id)) return [];
    const row = pieceOf(id);
    if (!row) return [];
    const label = typeof panel.label === "string" && panel.label ? panel.label : row.label;
    return [{ ...row, label }];
  });
  return [...list, ...extra];
}

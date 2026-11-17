// The tab bar's model: what each tab draws, which tabs fold behind +N, and how the project's computer stands.

/** A tab out of view whose agent waits for you carries the blocked mark; working and done carry none. */
export const tabMark = (tab) => (tab.status === "blocked" && !tab.active ? "blocked" : null);

const PHASES = { loading: "connecting", unavailable: "unreachable" };
/** connected, connecting or unreachable: a project on another computer while its layout loads, or when it cannot be read. */
export const barState = (space, machineList) => {
  if (!space?.machine) return "connected";
  const layout = (machineList ?? []).find((machine) => machine.name === space.machine)?.layout;
  return PHASES[layout] ?? "connected";
};

const spanOf = (widths, gap) => (list) => list.reduce((sum, i) => sum + (widths[i] ?? 0) + gap, -gap);

/** Which tabs show in `room`: all when they fit; else the chosen one and the first that fit beside +N, which takes `more` with its gap, the rest folded in order.
 * An unmeasured tab counts as nothing, so it draws once and is measured. */
export function foldTabs({ widths, chosen, room, gap, more }) {
  const all = widths.map((_, i) => i);
  const span = spanOf(widths, gap);
  if (!room || span(all) <= room) return { shown: all, folded: [] };
  const kept = all.filter((i) => i === chosen);
  const others = all.filter((i) => i !== chosen);
  const fits = others.filter((_, n) => span([...kept, ...others.slice(0, n + 1)]) <= room - more);
  const shown = [...kept, ...fits].toSorted((a, b) => a - b);
  return { shown, folded: all.filter((i) => !shown.includes(i)) };
}

/** The chosen fill's place among the drawn tabs, or null until every one is measured. */
export function pillAt(widths, chosen, gap) {
  if (chosen < 0 || widths.some((width) => !width)) return null;
  return { left: widths.slice(0, chosen).reduce((x, width) => x + width + gap, 0), width: widths[chosen] };
}

/** A tab dragged onto another lands in its place: before it when it moves left, after it when it moves right. */
export const dropSide = (from, to) => (from > to ? "before" : "after");

/** A rename waits until the tab carries the new name; "" asks Herdr for its own name, which nothing can wait for. */
export const renameWaits = (rename, tabs) => Boolean(rename?.name) && tabs.some((tab) => tab.id === rename.id && tab.name !== rename.name);

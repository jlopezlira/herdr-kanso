// Which toasts are on screen, as every copy of kanso-toast in one window's mods sees them (a list, oldest
// first, under that window's own mark): { id: the overlay, key: what it says, until: when Herdr takes it down }.

// The newest this many stay up; an older one makes room.
export const MOST = 3;

// Herdr's own clock for a toast: `timeout`, else 8 s for an error or a warning and 5 s for the rest.
export const lasts = (n) => n.timeout ?? (n.level === "error" || n.level === "warning" ? 8000 : 5000);

// Two toasts are the same when they say the same thing the same way and a click on them does the same:
// two agents of one name finishing are two toasts, each going to its own.
export const keyOf = (n) => JSON.stringify([n.level ?? "", n.title ?? "", n.body ?? "", n.action ?? null]);

export const onScreen = (list, now) => (Array.isArray(list) ? list : []).filter((s) => s.until > now);

// The shared value: each window's list under its mark. Herdr numbers overlays afresh in every window and
// every start, so another mark's ids are never ours to read or close; a mark with nothing up is dropped.
export const marked = (all) => (all && typeof all === "object" && !Array.isArray(all) ? all : {});
export const keep = (all, mark, list, now) => Object.fromEntries([
  ...Object.entries(marked(all)).filter(([m, l]) => m !== mark && onScreen(l, now).length > 0),
  ...(list.length > 0 ? [[mark, list]] : []),
]);

// A new toast `n` against what is on screen: shown unless the same one is up; when shown, the oldest
// beyond MOST close. `next` is the list to keep.
export function admit(showing, n, now) {
  if (showing.some((s) => s.key === keyOf(n))) return { show: false, close: [], next: showing };
  const all = [...showing, { id: n.overlay, key: keyOf(n), until: now + lasts(n) }];
  const over = Math.max(0, all.length - MOST);
  return { show: true, close: all.slice(0, over).map((s) => s.id), next: all.slice(over) };
}

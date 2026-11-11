// What the pull request panel asks GitHub, and what it keeps when an answer does not arrive.
export const TICK_MS = 20_000;
export const QUIET_MS = 58_000;
export const AUTH_MS = 10 * 60_000;
export const CALL_MS = 30_000;

// Herdr can leave an exec promise unsettled; this is the result the timer settles instead.
export const LATE = Object.freeze({ late: true, code: 1, stdout: "", stderr: "timed out" });

export const readDue = (loadedAt, now, pending) => Boolean(pending) || now - (loadedAt ?? 0) > QUIET_MS;

// In front: the window is not behind others and this panel is not hidden.
export const pollFacing = (active, hidden) => active !== false && hidden !== true;

// The 20s timer. Behind or hidden it returns and remembers; the first look in front reads at once.
export function pollTick({ shown, away, picker, due }) {
  if (!shown) return { away: true, read: false };
  if (picker) return { away: Boolean(away), read: false };
  return { away: false, read: Boolean(away) || Boolean(due) };
}

const ticksFrom = (t, from, pending, until) => {
  if (t > until) return [];
  const due = readDue(from, t, pending);
  const rest = ticksFrom(t + TICK_MS, due ? t : from, pending, until);
  return due ? [t, ...rest] : rest;
};

// Reads a timer would start in one quiet minute after a read at t = 0, or while a check is still running.
export function refreshTicks({ pending = false, until = 60_000, loadedAt = 0 } = {}) {
  return ticksFrom(TICK_MS, loadedAt, pending, until);
}

export const authFresh = (auth, now) => auth?.at != null && now - auth.at < AUTH_MS;

export const threadKey = (url, updatedAt) => `${url}\0${updatedAt ?? ""}`;

export const needsThreads = (prev, url, updatedAt) => prev !== threadKey(url, updatedAt);

export const needsPermission = (permission, repo, next) => permission == null || repo !== next;

// The panel opens on the branch. A review waiting does not take the page.
export const stayOnBranch = (open) => (open == null ? false : open);

export function ageOf(isoOrMs, now) {
  const then = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  const s = Math.max(0, (now - then) / 1000);
  if (!Number.isFinite(s)) return "just now";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const asOfAge = (at, now) => `as of ${ageOf(at, now)}`;

export function waitLine(retryAt) {
  const d = new Date(retryAt);
  return `GitHub asks to wait until ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function heldView(hasPr, freshAt, now) {
  return hasPr ? { keep: true, text: asOfAge(freshAt ?? now, now) } : { keep: false, text: null };
}

export function bounded(promise, timer, ms = CALL_MS) {
  if (!timer?.after) return promise;
  const deadline = new Promise((resolve) => { timer.after(ms, () => resolve(LATE)); });
  return Promise.race([promise, deadline]);
}

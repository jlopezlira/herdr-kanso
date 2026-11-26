import { agents, focused, shared, setShared } from "herdr";

export const RECENT = "kanso.recent";
export const KEPT = 50;

export const recentWith = (list, address, live) => [address, ...(Array.isArray(list) ? list : []).filter((a) => a !== address && live.has(a))].slice(0, KEPT);

export function noteFocus() {
  const at = focused();
  const live = new Set(agents().map((a) => a.address));
  const now = [at?.agent, at?.terminal].find((address) => live.has(address));
  const list = shared(RECENT);
  if (!now || (Array.isArray(list) && list[0] === now)) return;
  setShared(RECENT, recentWith(list, now, live));
}

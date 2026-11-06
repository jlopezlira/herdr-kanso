// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Lists by keyboard, as vim moves: j / k (or the arrows) down and up, gg
// and G (or Home and End) to the first and the last, Enter to choose, Esc
// to leave. Only plain keys: with cmd, ctrl or alt held a key is not the
// list's. Every Kanso list and menu reads its keys through here, so they
// all answer the same; kanso-menu/listkeys.js is the one you edit
// (`npm run sync:share` copies it, and a test fails when a copy differs).

const GG_MS = 1000; // the second g of gg, within this long (vim's timeoutlen)

// What a key does in a list: "down", "up", "first", "last", "enter",
// "escape", "pending" (a first g, waiting for the second) or null (not the
// list's). `memo` keeps the pending g between keys: one object per list.
export function listKey(e, memo = {}, now = Date.now()) {
  const m = e?.modifiers ?? {};
  if (m.control || m.platform || m.alt || m.function) return null;
  const k = String(e?.key ?? "").toLowerCase();
  const gg = memo.g && now - memo.g <= GG_MS;
  memo.g = 0;
  if (k === "escape") return "escape";
  if (k === "enter") return "enter";
  if (k === "down" || (k === "j" && !m.shift)) return "down";
  if (k === "up" || (k === "k" && !m.shift)) return "up";
  if (k === "home") return "first";
  if (k === "end" || (k === "g" && m.shift)) return "last";
  if (k === "g") { if (gg) return "first"; memo.g = now; return "pending"; }
  return null;
}

// Where a move lands in a list of `n` rows from row `at`: j and k stop at
// the ends, as in vim.
export function moveTo(move, at, n) {
  if (n <= 0) return 0;
  const i = Math.min(Math.max(0, at ?? 0), n - 1);
  if (move === "down") return Math.min(n - 1, i + 1);
  if (move === "up") return Math.max(0, i - 1);
  if (move === "first") return 0;
  if (move === "last") return n - 1;
  return i;
}

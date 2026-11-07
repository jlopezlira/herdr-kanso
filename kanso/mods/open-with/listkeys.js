// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Lists by keyboard, as vim moves: j / k (or the arrows) down and up, gg
// and G (or Home and End) to the first and the last, Enter to choose, Esc
// to leave. Only plain keys: with cmd, ctrl or alt held a key is not the
// list's. Every Kanso list and menu reads its keys through here, so they
// all answer the same; kanso-menu/listkeys.js is the one you edit
// (`npm run sync:share` copies it, and a test fails when a copy differs).

const GG_MS = 1000; // the second g of gg, within this long (vim's timeoutlen)

// What a key does in a list: { move, gAt }. `move`: "down", "up", "first",
// "last", "enter", "escape", "pending" (a first g, waiting for the second)
// or null (not the list's). `gAt`: when a first g is pending (0: none),
// for the list to keep and hand back with the next key.
export function listKey(e, gAt = 0, now = Date.now()) {
  const m = e?.modifiers ?? {};
  if (m.control || m.platform || m.alt || m.function) return { move: null, gAt };
  const k = String(e?.key ?? "").toLowerCase();
  const gg = gAt && now - gAt <= GG_MS;
  const move = k === "escape" ? "escape" : k === "enter" ? "enter"
    : k === "down" || (k === "j" && !m.shift) ? "down" : k === "up" || (k === "k" && !m.shift) ? "up"
    : k === "home" ? "first" : k === "end" || (k === "g" && m.shift) ? "last"
    : k === "g" ? (gg ? "first" : "pending") : null;
  return { move, gAt: move === "pending" ? now : 0 };
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

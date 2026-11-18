// Kanso's piece lines: what every right-click menu ends with, and Hide with its Undo. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/piece-lines.js.
import { shared, setShared, openOverlay, notify } from "herdr";
import { W } from "./ui.js";
import { menuHeight } from "./ui-menu.js";
import { STORE, pieces, pieceOf, choice, setPiece } from "./pieces.js";

/** The piece that was hidden last and what it was before, for the toast's Undo. */
export const UNDO = "kanso.pieces.undo";
export const UNDO_COMMAND = "kanso-chrome.piece-undo";

const stopsOf = (row) => (row.stops === "work" && row.job ? `${row.job} stops` : null);

/** Hide stores the state; the toast says what stopped and offers Undo. */
export function hidePiece(id) {
  const row = pieceOf(id);
  if (!row) return;
  const map = pieces(shared);
  setShared(UNDO, { id, state: map[id] ?? row.default });
  setShared(STORE, setPiece(map, id, "hide"));
  notify({ title: `Hidden: ${row.label}`, body: stopsOf(row) ?? undefined, level: "info", action: { name: UNDO_COMMAND, args: { label: "Undo" } } });
}

/** Puts the last hidden piece back as it was. */
export function undoHide() {
  const last = shared(UNDO);
  if (!last?.id) return;
  setShared(STORE, setPiece(pieces(shared), last.id, last.state));
  setShared(UNDO, null);
}

/** A rule, Only when needed (checked while on) for a piece that has it, Hide, and Settings for this…. `named`: Hide says the piece's name. `done`: runs after each press, to close the menu. */
export function pieceLines(id, { named = false, done = () => {} } = {}) {
  const row = pieceOf(id);
  if (!row) return [];
  const needed = choice(id, pieces(shared)) === "needed";
  return [
    { separator: true },
    ...(row.states.includes("needed") ? [{ icon: "check", label: "Only when needed", selected: needed, onClick: (cx) => { setShared(STORE, setPiece(pieces(shared), id, needed ? "show" : "needed")); done(cx); } }] : []),
    { icon: "eye-off", label: named ? `Hide “${row.label}”` : "Hide this", onClick: (cx) => { hidePiece(id); done(cx); } },
    { icon: "sliders-vertical", label: "Settings for this…", onClick: (cx) => { openOverlay({ mod: "kanso-settings", kind: "dialog", width: 860, height: 680, props: { page: "pieces", find: row.label } }); done(cx); } },
  ];
}

/** The menu a right-click on a piece opens, at the pointer, sized to its rows. `actions`: { icon, label, hint, command, args } the piece does, each a command to run;
 * the piece lines follow. `named`: Hide says the piece's name. */
export function openPieceMenu({ id, title, actions = [], named = false }) {
  const items = [...actions, ...pieceLines(id, { named })];
  openOverlay({ mod: "kanso-menu", kind: "popup", width: W.menu, height: menuHeight({ title, items }), at: "pointer", props: { target: { piece: { id, title, actions, named } } } });
}

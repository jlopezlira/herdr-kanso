// An agent's state, drawn the same everywhere Kanso shows it: the tabs,
// the pane headers, the status bar and the sidebar. This file is the one
// you edit; `npm run sync:share` copies it into kanso-tabs, kanso-strip
// and kanso-status (Herdr loads a mod's files from its own folder only).
//
// The marks are one circle in four states (kanso-chrome/icons, tinted):
// idle, a thin even ring; working, the same ring as a faint track with a
// short arc (100°, round caps) running along it, turning once every 0.9 s
// (`working.svg`, concentric so it turns without wobble; native `.spin`,
// drawn only while in view); done, the circle closed as a brush ensō;
// needs you, a solid disc with "!".
import { div, svg } from "gpui-kit";

const ICONS = "mods/kanso-chrome/icons/";
const TURN = 900;

// The mark for `status` at `size` px, or null where there is none to draw
// (no status; idle unless asked for with `idle`).
export function stateMark(t, status, size = 13, { idle = false } = {}) {
  const enso = (name, color) => svg(`${ICONS}${name}.svg`).size(size).flex_none().text_color(color);
  if (status === "working") return enso("working", t.working).spin(TURN);
  if (status === "blocked") return div().size(size).flex_none().rounded_full().bg(t.blocked)
    .text_size(Math.round(size * 0.68)).font_bold().text_color(t.chrome).flex().items_center().justify_center().child("!");
  if (status === "done") return enso("enso", t.done);
  if (status === "idle" && idle) return enso("enso-idle", t.idle ?? t.dim).opacity(0.7);
  return null;
}

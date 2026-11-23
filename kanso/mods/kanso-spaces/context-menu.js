import { keys } from "herdr";
import { menu, menuList } from "./ui-menu.js";
import { hintOf } from "./ui-tooltip.js";
import { ACTIONS, contextItems } from "./menu-actions.js";

const keyed = (lines) => lines.some((line) => (line?.act ? Boolean(ACTIONS[line.act].key) && !("hint" in line) : Boolean(line?.scroll) && keyed(line.scroll)));

export const contextRows = (lines, make) => {
  const bindings = keyed(lines) ? keys() : [];
  return contextItems(lines, { hint: (key) => hintOf(key, bindings), make });
};

export const contextMenu = (id, { title = null, lines = [], make, framed = false }, c) => (framed ? menu : menuList)(id, { title, items: contextRows(lines, make) }, c);

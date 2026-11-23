import { load, popoverHost, chain, CHROME_NIGHT } from "./helpers.mjs";
import { loadSidebar } from "./sidebar-fixtures.mjs";
import { BINDINGS } from "./menu-fixtures.mjs";

export const menuSidebar = (over) => loadSidebar({ ...popoverHost(), Scrollbar: { vertical: () => chain() } }, over);

export const loadStrip = (theme = () => CHROME_NIGHT) => load("kanso-strip/main.js", ["Strip", "tokens"], {
  ...popoverHost(), theme, shared: () => null, keys: () => BINDINGS, window: () => ({ platform: "macos" }),
});

export const openHeaderEntries = async () => {
  const { menuEntries } = await load("kanso-strip/header-model.js", ["menuEntries"]);
  return menuEntries({ strip: true, pinned: false, zoomed: false, tools: { sleep: "menu", send: "menu" }, fold: 0, canOpen: true });
};

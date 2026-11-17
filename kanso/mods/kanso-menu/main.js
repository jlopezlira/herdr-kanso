// Kanso's terminal right-click menu, by jlopezlira (https://github.com/jlopezlira/herdr-kanso).
// Apache-2.0; derived from Herdr's shipped `menu` mod.
// In the strip Herdr's menu gets the block id ("term-<pane>"), so pane commands fail: this menu resolves the real pane.
import { View } from "gpui-kit";
import { run, props, closeOverlay, openOverlay, theme, terminals, panes, shared, setShared, keys } from "herdr";
import { listKey, moveTo } from "./listkeys.js";
import { focusOn } from "./pure.js";
import { openWithPopup } from "./popup.js";
import { tokens } from "./ui.js";
import { menuList } from "./ui-menu.js";

function items(tg) {
  const ps = panes();
  const pane = ps.find((p) => p.pane === tg.pane)?.pane
    ?? ps.find((p) => p.terminal && p.terminal === tg.terminal)?.pane
    ?? String(tg.pane ?? "").replace(/^term-/, "");
  const all = terminals();
  const term = all.find((t) => t.address === tg.terminal);
  const parent = term?.parent && all.find((t) => t.address === term.parent);
  const toProgram = term?.labels?.["herdr.right-click"] === "program";
  const info = ps.find((p) => p.pane === pane);
  const pinned = Boolean(shared("strip.state")?.[info?.tab]?.cols?.find((c) => c.panes?.includes(pane))?.pin);
  // A split first tells the strip where the new pane goes.
  const split = (label, dir, icon, key) => [label, () => {
    setShared("strip.intent", { dir, from: pane, at: Date.now() });
    run("pane.split", { pane, direction: dir === "down" ? "down" : "right" });
  }, icon, key];
  return [
    split("Split right", "right", "columns-2", "kanso-strip.new-right"),
    split("Split left", "left", "columns-2", "kanso-strip.new-left"),
    split("Split down", "down", "rows-2", "kanso-strip.new-down"),
    ["Wider or narrower", () => setShared("strip.req", { op: "width", pane, n: Date.now() + Math.random() }), "move-horizontal", "kanso-strip.width"],
    [pinned ? "Unpin pane" : "Pin pane", () => setShared("strip.req", { op: "pin", pane, n: Date.now() + Math.random() }), "pin", "kanso-strip.pin"],
    ...(term ? [[toProgram ? "Use Herdr right-click menu" : "Send right-clicks to pane",
      () => run("terminal.right_click", { terminal: term.address, to: toProgram ? "menu" : "program" }), "panel-left", null]] : []),
    ...(parent ? [[`Send back to ${parent.name || parent.address}`, () => run("terminal.park", { terminal: term.address }), "chevron-right", null]] : []),
    ...(info?.cwd ? [["Open with…", () => openWithPopup(info), "external-link", "mod.open:open-with"]] : []),
    ...(info?.terminal ? [["Send to an agent…", () => openOverlay({ mod: "kanso-send", kind: "dialog", width: 520, props: { pane } }), "send", "kanso-strip.send"]] : []),
    ["Close pane", () => run("pane.close", { pane }), "x", "kanso-strip.close"],
  ];
}

const shortcut = (action) => (action ? keys().find((b) => b.action === action)?.keys ?? "" : "");

export default class KansoMenu extends View {
  init(_props, cx) {
    this.at = -1; // nothing chosen for you: j or the down arrow lights the first
    this.handle = focusOn(cx);
  }

  // The pending g (for gg) is kept on the view between keys.
  listed(e) {
    const nav = listKey(e, this.listG);
    this.listG = nav.gAt;
    return nav.move;
  }

  choose(i) {
    const it = items(props()?.target ?? {})[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    it[1]();
  }

  render() {
    const list = items(props()?.target ?? {});
    // A line before the first move, before Open with and before Close.
    const ruled = (it, i) => i > 0 && (i === 3 || it[0] === "Open with…" || it[0] === "Close pane");
    const lines = list.flatMap((it, i) => [...(ruled(it, i) ? [{ separator: true }] : []),
      { icon: it[2], label: it[0], hint: shortcut(it[3]) || null, selected: i === this.at, onClick: () => this.choose(i) }]);
    return menuList("kanso-menu", { items: lines }, tokens(theme())).track_focus(this.handle)
      .on_key_down((e, cx) => {
        const move = this.listed(e);
        if (!move) return;
        if (move === "enter") this.choose(this.at);
        else if (move === "escape") closeOverlay(props().overlay);
        else this.at = moveTo(move, this.at, list.length);
        cx.stop_propagation();
        cx.notify();
      });
  }
}

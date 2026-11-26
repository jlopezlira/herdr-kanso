// Kanso's terminal right-click menu, by jlopezlira (https://github.com/jlopezlira/herdr-kanso).
// Apache-2.0; derived from Herdr's shipped `menu` mod.
// In the strip Herdr's menu gets the block id ("term-<pane>"), so pane commands fail: this menu resolves the real pane.
import { View } from "gpui-kit";
import { ScrollHandle } from "gpui-base";
import { menu } from "./ui-menu.js";
import { run, props, closeOverlay, theme, terminals, panes, spaces, agents, shared, setShared, nextCommand } from "herdr";
import { listKey, moveTo } from "./listkeys.js";
import { focusOn, readCommands } from "./pure.js";
import { switchRows, REVEAL_MS, SWITCH_ROWS } from "./switcher.js";
import { currentAgent, land } from "./recent.js";
import { openWithPopup } from "./popup.js";
import { openSend, openSleep } from "./launch.js";
import { tokens } from "./ui.js";
import { Armed } from "./ui-button.js";
import { pieceLines } from "./piece-lines.js";
import { contextRows, contextMenu } from "./context-menu.js";

const nonce = () => Date.now() + Math.random();

// The story's order: the pane's own moves, then what it can do with its agent, then the program's right click, then Close.
function groups(tg, armed) {
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
  const agent = Boolean(info?.program?.agent || info?.status);
  const canSend = agent && Boolean(info?.terminal) && ps.some((p) => p.pane !== pane && p.terminal && (p.program?.agent || p.status));
  const space = spaces().find((s) => s.tabs.some((t) => t.id === info?.tab));
  const canSleep = Boolean(info?.terminal && info?.tab && agents().some((x) => x.address === info.terminal));
  const name = info?.name || term?.name || "Terminal";
  const title = space?.machine ? `${name} \u00b7 ${space.machine}` : name;
  // A split first tells the strip where the new pane goes.
  const split = (act, dir) => ({ act, does: () => {
    setShared("strip.intent", { dir, from: pane, at: Date.now() });
    run("pane.split", { pane, direction: dir === "down" ? "down" : "right" });
  } });
  const inTerminal = (command) => () => {
    if (ps.some((p) => p.terminal === term.address)) run("pane.focus", { terminal: term.address });
    run(command);
  };
  const clipboard = term ? [
    { act: "copy", does: inTerminal("terminal.copy") },
    { act: "cut", disabled: true, does: () => {} },
    { act: "paste", does: inTerminal("terminal.paste") },
  ] : [];
  const close = { act: "close-pane", verb: `close ${name}`, arms: agent, does: () => run("pane.close", { pane }) };
  return { title, armedKey: close.arms ? "close" : null, groups: [
    clipboard,
    [
      split("split-right", "right"),
      split("split-down", "down"),
      split("split-left", "left"),
      { act: "width", does: () => setShared("strip.req", { op: "width", pane, n: nonce() }) },
      { act: pinned ? "unpin" : "pin", does: () => setShared("strip.req", { op: "pin", pane, n: nonce() }) },
    ],
    [
      ...(canSend ? [{ act: "send", does: () => openSend(info) }] : []),
      ...(agent ? [{ act: "find", does: () => { run("pane.focus", { pane }); run("kanso-strip.find"); } }] : []),
      ...(info?.cwd ? [{ act: "open-with", does: () => openWithPopup(info) }] : []),
      ...(canSleep && space ? [{ act: "sleep-agent", does: () => openSleep(info) }] : []),
      ...(parent ? [{ act: "send-back", of: [parent.name || parent.address], does: () => run("terminal.park", { terminal: term.address }) }] : []),
    ],
    ...(term ? [[{ act: "right-clicks", checked: toProgram,
      does: () => run("terminal.right_click", { terminal: term.address, to: toProgram ? "menu" : "program" }) }]] : []),
    [{ ...close, armed: Boolean(close.arms) && armed.is("close") }],
  ].filter((group) => group.length) };
}

export default class KansoMenu extends View {
  init(_props, cx) {
    this.at = -1; // nothing chosen for you: j or the down arrow lights the first
    this.handle = focusOn(cx);
    this.armed = new Armed();
    if (props()?.switcher) this.openSwitcher(cx);
  }

  openSwitcher(cx) {
    this.rows = switchRows();
    this.at = this.rows.length > 1 && this.rows[0].address === currentAgent() ? 1 : 0;
    this.scroll = ScrollHandle.new();
    this.shown = false;
    this.landed = false;
    cx.timer.after(REVEAL_MS, (cx) => { this.shown = true; cx.notify(); });
    cx.timer.every(REVEAL_MS, () => { if (this.shown && !this.handle.is_focused()) this.go(null); });
    readCommands(cx, () => nextCommand(), (c, cx) => this.switchStep(String(c).endsWith(".prev") ? -1 : 1, cx));
  }

  switchStep(by, cx) {
    const n = this.rows.length;
    this.at = n ? (this.at + by + n) % n : 0;
    this.scroll.scroll_to_item(this.at);
    this.shown = true;
    cx.notify();
  }

  go(row) {
    if (this.landed) return;
    this.landed = true;
    closeOverlay(props()?.overlay);
    land(row);
  }

  switcherView(c) {
    const rows = this.rows.map((r, i) => ({ icon: r.program?.icon ?? null, label: r.name, hint: r.place, mark: r.asleep ? "asleep" : null, selected: i === this.at, onClick: () => this.go(r) }));
    const items = rows.length ? [{ scroll: rows, rows: Math.min(rows.length, SWITCH_ROWS), handle: this.scroll }] : [{ label: "No other sessions", disabled: true }];
    return menu("kanso-switcher", { items, wide: true }, c).opacity(this.shown ? 1 : 0).track_focus(this.handle)
      .on_modifiers_changed((e) => { if (!e.modifiers.control) this.go(this.rows[this.at]); })
      .on_key_down((e, cx) => {
        const k = e?.key;
        if (k === "escape") this.go(null);
        else if (k === "enter") this.go(this.rows[this.at]);
        else if (k === "down" || k === "up" || k === "tab") { this.switchStep(k === "up" || (k === "tab" && e.modifiers?.shift) ? -1 : 1, cx); }
        else return;
        cx.stop_propagation();
      });
  }

  // The pending g (for gg) is kept on the view between keys.
  listed(e) {
    const nav = listKey(e, this.listG);
    this.listG = nav.gAt;
    return nav.move === "enter" && !this.handle.is_focused() ? null : nav.move;
  }

  // Close asks twice while an agent is in the pane: the first press arms it and keeps the menu open.
  choose(it, cx) {
    if (!it) return;
    if (it.arms) { this.armed.press("close", cx, () => { closeOverlay(props()?.overlay); it.does(); }); return; }
    closeOverlay(props()?.overlay);
    it.does();
  }

  // A right-click on a piece of the window: what it does, then the piece lines.
  pieceView(piece) {
    const shut = () => closeOverlay(props()?.overlay);
    return {
      title: piece.title,
      lines: [
        ...piece.actions.map((a) => ({ icon: a.icon, label: a.label, hint: a.hint ?? null, mark: a.mark ?? null, onClick: () => { shut(); run(a.command, a.args); } })),
        ...pieceLines(piece.id, { named: piece.named, done: shut }),
      ],
    };
  }

  // A pane's menu: its groups, a rule between them.
  paneView(target) {
    const { title, groups: sets } = groups(target, this.armed);
    const make = (label, does, { arms, ...look }) => ({ ...look, label, onClick: (cx) => this.choose({ arms, does }, cx) });
    return { title, lines: contextRows(sets.flatMap((set, g) => [...(g ? [{ separator: true }] : []), ...set]), make) };
  }

  render() {
    if (props()?.switcher) return this.switcherView(tokens(theme()));
    const target = props()?.target ?? {};
    const { title, lines: drawn } = target.piece ? this.pieceView(target.piece) : this.paneView(target);
    const list = drawn.filter((line) => line.onClick && !line.disabled);
    const lines = drawn.map((line) => (line.onClick ? { ...line, selected: list.indexOf(line) === this.at } : line));
    return contextMenu("kanso-menu", { title, lines }, tokens(theme())).track_focus(this.handle)
      .on_key_down((e, cx) => {
        const move = this.listed(e);
        if (!move) return;
        if (move === "enter") list[this.at]?.onClick(cx);
        else if (move === "escape") closeOverlay(props().overlay);
        else this.at = moveTo(move, this.at, list.length);
        cx.stop_propagation();
        cx.notify();
      });
  }
}

// kansō help, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// How to use kansō, how to set it up, and its keys on a keyboard you can
// see: hold ⌘ ⌥ ⇧ ⌃ (or pick them) and the keys that do something light
// up; press one and it says what it does. A practice board for vim's moves
// (h j k l, 0 $, gg G). Opened with ⌘? (keys.json) or from kansō settings;
// `page` in its props picks the tab.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, keys, openOverlay } from "herdr";
import { G, tokens, quietTabs, quietLink } from "./ui.js";
import { glyphs } from "./marks.js";
import { ROWS, MODIFIERS, CAP, layer, LIST_LAYER, LIST_SHIFT, describe, step, fewest } from "./keymap.js";

const PAGES = [
  { key: "keys", label: "Keyboard" },
  { key: "practice", label: "Practice vim" },
  { key: "guide", label: "Guide" },
  { key: "setup", label: "Configure" },
];
const U = 40, GAP = 5; // a key's unit and the space between keys
const BOARD = { w: 18, h: 8, cell: 28 };
const LIT_MS = 650;
const MOD_GLYPH = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" };
const MOD_WORD = { ctrl: "Control", alt: "Option", shift: "Shift", cmd: "Command" };

// The modifiers of a key event, as keys.json names them.
const modsOf = (m = {}) => MODIFIERS.filter((k) => (k === "cmd" ? m.platform : k === "ctrl" ? m.control : m[k]));

export default class Help extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.page = PAGES.some((p) => p.key === props()?.page) ? props().page : "keys";
    this.mods = ["cmd", "alt"]; // the layer shown first: the vim panes
    this.lists = false; // the lists' layer (j k gg G) instead
    this.picked = "h";
    this.lit = null; // { key, at }: a key just pressed
    this.at = { x: 2, y: 2 };
    this.target = this.newTarget();
    this.moves = 0;
    this.score = { hits: 0, perfect: 0 };
    this.g = 0;
  }

  newTarget() {
    for (;;) {
      const t = { x: Math.floor(Math.random() * BOARD.w), y: Math.floor(Math.random() * BOARD.h) };
      if (t.x !== this.at.x || t.y !== this.at.y) { this.best = fewest(this.at, t, BOARD.w, BOARD.h); return t; }
    }
  }

  light(key, cx) {
    const at = Date.now();
    this.lit = { key, at };
    cx.timer.after(LIT_MS, (cx) => { if (this.lit?.at === at) { this.lit = null; cx.notify(); } });
  }

  key(e, cx) {
    const k = String(e.key ?? "").toLowerCase();
    if (k === "escape") { closeOverlay(props()?.overlay); cx.stop_propagation(); return; }
    const mods = modsOf(e.modifiers);
    if (this.page === "practice") {
      const ch = e.key_char ?? k;
      let move = null;
      if (["h", "j", "k", "l", "0"].includes(ch) && !mods.length) move = ch;
      else if (ch === "$" || (k === "4" && mods.includes("shift"))) move = "$";
      else if (k === "g" && mods.includes("shift")) move = "G";
      else if (k === "g" && !mods.length) { if (Date.now() - this.g < 1000) { move = "gg"; this.g = 0; } else { this.g = Date.now(); this.light("g", cx); cx.notify(); cx.stop_propagation(); return; } }
      if (!move) return;
      this.light(move === "$" ? "4" : move === "gg" || move === "G" ? "g" : move, cx);
      this.at = step(this.at, move, BOARD.w, BOARD.h);
      this.moves += 1;
      if (this.at.x === this.target.x && this.at.y === this.target.y) {
        this.score.hits += 1;
        if (this.moves <= this.best) this.score.perfect += 1;
        this.last = { moves: this.moves, best: this.best };
        this.moves = 0;
        this.target = this.newTarget();
      }
      cx.stop_propagation(); cx.notify();
      return;
    }
    if (this.page !== "keys") return;
    // The keyboard page: the key pressed lights up, with its layer.
    if (["shift", "control", "alt", "platform", "meta", "cmd", "ctrl", "option", "command"].includes(k)) return;
    const key = k === "return" ? "enter" : k === " " ? "space" : k;
    if (mods.length) { this.mods = mods; this.lists = false; }
    this.picked = key;
    this.light(key, cx);
    cx.stop_propagation(); cx.notify();
  }

  // The keys lit on the keyboard page: key -> { action, chord }.
  shown() {
    if (this.lists) return this.mods.includes("shift") ? LIST_SHIFT : LIST_LAYER;
    return layer(keys(), this.mods);
  }

  // One key: its cap, lit when it does something in this layer, filled
  // when picked or just pressed. Modifier keys light while held.
  cap(t, c, [name, w = 1], i, bound) {
    const width = Math.round(U * w + GAP * (w - 1));
    const isMod = MODIFIERS.includes(name);
    const held = isMod && (this.lists ? name === "shift" && this.mods.includes("shift") : this.mods.includes(name));
    const does = bound.get(name);
    const pressed = this.lit?.key === name;
    const picked = !isMod && this.picked === name;
    const fill = pressed || picked ? c.accent : held ? c.text + "26" : does ? c.accent + "24" : c.text + "08";
    const ink = pressed || picked ? (t.accent_foreground ?? c.canvas) : does || held ? c.text : c.dim;
    const label = CAP[name] ?? (name.length === 1 ? name.toUpperCase() : name);
    return div().id(`cap-${name}-${i}`).w(width).h(U).flex_none().rounded(7)
      .border_1().border_color(pressed || picked ? c.accent : does ? c.accent + "70" : held ? c.text + "40" : c.border)
      .bg(fill).flex().items_center().justify_center()
      .text_size(label.length > 1 ? 11 : 13.5).font_medium().text_color(ink)
      .cursor_pointer().hover((s) => s.border_color(c.accent))
      .on_click((_e, cx) => {
        if (isMod) { this.lists = false; this.mods = this.mods.includes(name) ? this.mods.filter((m) => m !== name) : MODIFIERS.filter((m) => m === name || this.mods.includes(m)); }
        else this.picked = name;
        cx.notify();
      })
      .child(label);
  }

  chip(c, id, text, on, act) {
    return div().id(id).h(28).px(12).flex().items_center().rounded(7).cursor_pointer()
      .border_1().border_color(on ? c.accent : c.border).bg(on ? c.accent + "24" : c.text + "06")
      .text_size(12.5).font_medium().text_color(on ? c.text : c.muted)
      .hover((s) => s.border_color(c.accent))
      .on_click((_e, cx) => { act(); cx.notify(); })
      .child(text);
  }

  keysPage(t, c) {
    const bound = this.shown();
    const chosen = bound.get(this.picked);
    const layerName = this.lists ? "In every list and menu" : this.mods.length ? this.mods.map((m) => MOD_GLYPH[m]).join("") : "No modifier";
    const list = [...bound.entries()].sort((a, b) => describe(a[1].action).localeCompare(describe(b[1].action)));
    const chordOf = (d) => (this.lists ? d.chord.split(" ").map((x) => glyphs(x)).join(" ") : glyphs(d.chord));
    return v_flex().gap(G.lg)
      .child(h_flex().gap(G.sm).items_center().flex_wrap()
        .children(MODIFIERS.map((m) => this.chip(c, `mod-${m}`, `${MOD_GLYPH[m]} ${MOD_WORD[m]}`, !this.lists && this.mods.includes(m),
          () => { this.lists = false; this.mods = this.mods.includes(m) ? this.mods.filter((x) => x !== m) : MODIFIERS.filter((x) => x === m || this.mods.includes(x)); })))
        .child(div().w(G.sm))
        .child(this.chip(c, "mod-lists", "Lists: j k gg G", this.lists, () => { this.lists = !this.lists; this.mods = []; this.picked = "j"; }))
        .child(div().flex_1())
        .child(div().text_size(12).text_color(c.dim).child(`${layerName} · ${bound.size} ${bound.size === 1 ? "key" : "keys"}`)))
      .child(v_flex().gap(GAP).p(14).rounded(12).bg(c.text + "05").border_1().border_color(c.border).items_center()
        .children(ROWS.map((row, r) => h_flex().gap(GAP).children(row.map((k, i) => this.cap(t, c, k, `${r}-${i}`, bound))))))
      // The key picked (or pressed), in words.
      .child(h_flex().h(44).px(14).gap(G.md).items_center().rounded(10).bg(chosen ? c.accent + "18" : c.text + "06")
        .child(div().min_w(64).text_size(17).font_semibold().text_color(chosen ? c.text : c.dim).child(chosen ? chordOf(chosen) : glyphs([...this.mods, this.picked].join("-"))))
        .child(div().flex_1().text_size(13.5).text_color(chosen ? c.text : c.dim)
          .child(chosen ? describe(chosen.action) : "Nothing on this key here. Press a key, or pick one.")))
      // Everything in this layer, as a list to read.
      .child(v_flex().gap(2)
        .children(list.map(([key, d]) => h_flex().id(`row-${key}`).h(26).px(10).gap(G.md).items_center().rounded(6).cursor_pointer()
          .when(key === this.picked, (el) => el.bg(c.selected))
          .hover((s) => s.bg(c.subtle))
          .on_click((_e, cx) => { this.picked = key; cx.notify(); })
          .child(div().w(84).flex_none().text_size(12.5).font_medium().text_color(c.text).child(chordOf(d)))
          .child(div().flex_1().truncate().text_size(12.5).text_color(c.muted).child(describe(d.action))))));
  }

  practicePage(t, c) {
    const cell = BOARD.cell;
    const grid = v_flex().gap(3).p(12).rounded(12).bg(c.text + "05").border_1().border_color(c.border)
      .children(Array.from({ length: BOARD.h }, (_, y) => h_flex().gap(3).children(Array.from({ length: BOARD.w }, (_, x) => {
        const here = x === this.at.x && y === this.at.y, goal = x === this.target.x && y === this.target.y;
        return div().size(cell).rounded(5)
          .bg(here ? c.accent : c.text + "08")
          .when(goal && !here, (el) => el.border_2().border_color(c.accent));
      }))));
    const hint = (key, word) => {
      const lit = this.lit?.key === key;
      return h_flex().gap(G.sm).items_center()
        .child(div().h(30).min_w(30).px(8).rounded(6).border_1().border_color(lit ? c.accent : c.border).bg(lit ? c.accent : c.text + "08")
          .flex().items_center().justify_center().text_size(13).font_semibold().text_color(lit ? (t.accent_foreground ?? c.canvas) : c.text)
          .child(key === "4" ? "$" : key === "g" ? "g" : key))
        .child(div().text_size(12).text_color(c.muted).child(word));
    };
    const last = this.last;
    return v_flex().gap(G.lg).items_start()
      .child(div().text_size(13).line_height(1.5).text_color(c.muted)
        .child("Move the block onto the ring with vim's keys. Try the fewest moves: 0 and $ jump to the ends of a row, gg and G to the first and last row."))
      .child(grid)
      .child(h_flex().gap(G.xl).flex_wrap()
        .child(hint("h", "left")).child(hint("j", "down")).child(hint("k", "up")).child(hint("l", "right"))
        .child(hint("0", "row start")).child(hint("4", "row end")).child(hint("g", "gg top, G bottom")))
      .child(h_flex().gap(G.xl).text_size(12.5).text_color(c.muted)
        .child(div().child(`Reached ${this.score.hits}`))
        .child(div().child(`In the fewest moves ${this.score.perfect}`))
        .child(div().child(last ? `Last: ${last.moves} ${last.moves === 1 ? "move" : "moves"}, best ${last.best}` : `This one: ${this.best} at best`)));
  }

  // A heading and its lines; `k` draws a key inline.
  block(c, title, lines) {
    return v_flex().gap(6)
      .child(div().text_size(14).font_semibold().text_color(c.text).child(title))
      .children(lines.map((l) => div().text_size(12.8).line_height(1.55).text_color(c.muted).child(l)));
  }

  guidePage(t, c) {
    return v_flex().gap(G.xl)
      .child(this.block(c, "The strip", [
        "Every pane sits in a row you slide along, each one wide enough to read. ⌘D opens one to the right, ⌘⇧D one below it in the same column.",
        "⌘⌥H J K L moves between panes as vim does; with ⇧ it moves the pane itself. ⌘1 to ⌘9 jump to a pane, ⌘⇧- and ⌘⇧= show fewer or more at once.",
        "⌘⌥P pins a pane to its side so it stays in view while you slide.",
      ]))
      .child(this.block(c, "The sidebar", [
        "Projects lists your spaces and their agents, Status sorts them by what they need from you, Threads by conversation. ⌃⌥P, ⌃⌥S and ⌃⌥T switch.",
        "⌘⌥H from the first pane puts the keyboard on the list: J and K move, gg and G go to the ends, Enter or L opens the row, / searches, Esc goes back.",
        "⌘J goes to the next agent that needs you, in any space.",
      ]))
      .child(this.block(c, "Panels", [
        "The icons at the top right open a panel beside the strip: Files, the PR, Ports, Memory, Spend and more. ⌃⇧1 to ⌃⇧9 open them by place.",
      ]))
      .child(this.block(c, "Sleep and Arrangements", [
        "Sleep puts a tab, or a whole project, away: its agents exit and keep their conversations; Wake brings them back on the same ones. Right-click a project, or the moon in a pane's header.",
        "Arrangements (⌘⌥T) saves a tab as it is, agents and widths included, to open again in any project.",
      ]))
      .child(this.block(c, "Every list and menu", [
        "J and K (or the arrows) move, gg and G go to the first and last, Enter chooses, Esc closes.",
      ]));
  }

  setupPage(t, c) {
    const settings = (page) => () => openOverlay({ mod: "kanso-settings", kind: "dialog", width: 720, height: 620, props: { page } });
    const item = (id, title, note, link, act) => h_flex().w_full().py(10).gap(G.lg).items_start().border_b_1().border_color(c.border)
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().text_size(13.5).font_medium().text_color(c.text).child(title))
        .child(div().text_size(12.5).line_height(1.5).text_color(c.muted).child(note)))
      .when(Boolean(link), (el) => el.child(quietLink(id, link, act, c, { color: c.accent })));
    return v_flex()
      .child(item("setup-keys", "Your keys", "kansō's own keys are rebound in kansō settings: click one and press the new chord. Herdr's keys for tabs and spaces stay in Herdr's settings.", "Open Keys", settings("keys")))
      .child(item("setup-mods", "Panels and pieces", "Order the panels in the tab bar, turn off the ones you don't use, hide the activity line or the Projects, Status and Threads switch.", "Open Mods", settings("mods")))
      .child(item("setup-theme", "Themes", "Two themes come with kansō: kanso (dark) and kanso-day (light). Pick one in Herdr's settings, under Appearance.", null, null))
      .child(item("setup-files", "Where it lives", "Your keys are in ~/.config/herdr-app/keys.json, the layout in layouts/kanso.json, kansō's data under data/. An update changes a key only where the release changed it, never one you set.", null, null))
      .child(item("setup-update", "Updates", "kansō checks for a new release on start and every few minutes; the row above Settings updates it. What changed is in kansō settings, What's new.", "Open What's new", settings("news")));
  }

  render() {
    const t = theme(), c = tokens(t);
    const page = this.page === "practice" ? this.practicePage(t, c) : this.page === "guide" ? this.guidePage(t, c) : this.page === "setup" ? this.setupPage(t, c) : this.keysPage(t, c);
    return v_flex().id("kanso-help").track_focus(this.handle).size_full().min_h(0).p(20).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().w_full().items_center().gap(G.md)
        .child(svg("mods/kanso-chrome/icons/enso.svg").size(17).text_color(c.accent))
        .child(div().flex_1().text_size(15).font_semibold().child("kansō help"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(G.md).child(quietTabs("help-pages", PAGES, this.page, (key, cx) => { this.page = key; cx.notify(); }, c)))
      .child(v_flex().flex_1().min_h(0).pt(G.lg).overflow_y_scrollbar().child(page));
  }
}

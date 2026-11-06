// kansō help, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// How to use kansō, how to set it up, and its keys on a keyboard you can
// see: hold ⌘ ⌥ ⇧ ⌃ (or pick them) and the keys that do something light
// up; press one and it says what it does. A practice board for vim's moves
// (h j k l, 0 $, gg G). Opened with ⌘? (keys.json) or from kansō settings;
// `page` in its props picks the tab.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, keys, openOverlay, appHome } from "herdr";
import { G, tokens, quietTabs, quietLink, iconButton } from "./ui.js";
import { Store } from "./store.js";
import { Share } from "./share.js";
import { vimShare } from "./vim-card.js";
import { glyphs } from "./marks.js";
import { ROWS, MODIFIERS, CAP, layer, LIST_LAYER, LIST_SHIFT, describe, LEVELS, step, fewest, bestMove, newTarget, points } from "./keymap.js";

const PAGES = [
  { key: "keys", label: "Keyboard" },
  { key: "practice", label: "Practice vim" },
  { key: "guide", label: "Guide" },
  { key: "setup", label: "Configure" },
];
const U = 40, GAP = 5; // a key's unit and the space between keys
const BOARD = { w: 18, h: 8, cell: 28 };
const ROUND_S = 60, HINT_MS = 2000;

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
    this.g = 0;
    // Your rounds and level live in data/kanso-help/vim.db (store.js).
    this.store = new Store();
    this.totals = { bests: {}, rounds: 0, rings: 0, fewest: 0, longest: 0, days: [], first: null };
    this.share = new Share("kanso-help", `${appHome()}/data/kanso-help/share`);
    this.setLevel(1, false);
    cx.spawn(async (cx) => {
      try {
        const n = await this.store.level();
        if (!this.round && n !== this.level.n) this.setLevel(Math.min(LEVELS.length, Math.max(1, n)), false);
        this.totals = await this.store.totals();
      } catch (e) { this.say = String(e?.message ?? e); }
      cx.notify();
    });
  }
  get bests() { return this.totals.bests ?? {}; }

  // The game: a level, a 60 s round that starts on the first move, a ring
  // to reach, points, a streak of rings reached in the fewest moves.
  setLevel(n, keep = true) {
    this.level = LEVELS[n - 1];
    if (keep) this.store.setLevel(n).catch(() => {});
    this.at = { x: Math.floor(BOARD.w / 2), y: Math.floor(BOARD.h / 2) };
    this.round = null; this.over = null; this.count = ""; this.say = null;
    this.ring();
  }
  ring() {
    this.target = newTarget(this.at, BOARD.w, BOARD.h, this.level);
    this.need = fewest(this.at, this.target, BOARD.w, BOARD.h, this.level);
    this.moves = 0;
    this.idleAt = Date.now();
  }
  startRound(cx) {
    this.round = { at: Date.now(), score: 0, hits: 0, perfect: 0, streak: 0 };
    this.over = null;
    const tick = (cx) => {
      if (!this.round || this.page !== "practice") return;
      if (Date.now() - this.round.at >= ROUND_S * 1000) { this.endRound(cx); cx.notify(); return; }
      cx.notify();
      cx.timer.after(500, tick);
    };
    cx.timer.after(500, tick);
  }
  endRound(cx) {
    const r = this.round, n = this.level.n;
    const record = r.score > (this.bests[n] ?? 0);
    this.over = { ...r, record };
    this.round = null;
    cx.spawn(async (cx) => {
      try {
        await this.store.add({ at: r.at, level: n, score: r.score, rings: r.hits, fewest: r.perfect, streak: r.longest ?? r.streak });
        this.totals = await this.store.totals();
      } catch (e) { this.say = `Your round could not be kept: ${String(e?.message ?? e)}`; }
      cx.notify();
    });
  }

  // A practice key: a move of this level (a number first, at the counts
  // level), else a word on what it does here.
  practice(e, k, mods, cx) {
    const ch = e.key_char ?? k;
    if (this.over && (k === "enter" || k === "space")) { this.over = null; this.ring(); cx.notify(); return true; }
    if (["left", "right", "up", "down"].includes(k)) { this.say = "Arrows don't count here: h j k l"; cx.notify(); return true; }
    if (this.level.counts && /^[1-9]$/.test(ch) && !mods.length) { this.count = (this.count + ch).slice(-2); this.light(ch, cx); cx.notify(); return true; }
    let move = null;
    if (["h", "j", "k", "l", "0"].includes(ch) && !mods.length) move = ch;
    else if (ch === "$" || (k === "4" && mods.includes("shift"))) move = "$";
    else if (k === "g" && mods.includes("shift")) move = "G";
    else if (k === "g" && !mods.length) {
      if (Date.now() - this.g < 1000) { move = "gg"; this.g = 0; } else { this.g = Date.now(); this.light("g", cx); cx.notify(); return true; }
    }
    if (!move) return false;
    if (!this.level.keys.includes(move)) { this.say = `${move} is for a later level; here: ${this.level.keys.join(" ")}`; this.count = ""; cx.notify(); return true; }
    if (this.over) { this.over = null; }
    if (!this.round) this.startRound(cx);
    const n = this.level.counts && this.count ? Number(this.count) : 1;
    this.count = ""; this.say = null;
    this.light(move === "$" ? "4" : move === "gg" || move === "G" ? "g" : move, cx);
    this.at = step(this.at, move, BOARD.w, BOARD.h, n);
    this.moves += 1;
    this.idleAt = Date.now();
    if (this.at.x === this.target.x && this.at.y === this.target.y) {
      const r = this.round, fine = this.moves <= this.need;
      r.score += points(this.moves, this.need, r.streak);
      r.hits += 1;
      if (fine) { r.perfect += 1; r.streak += 1; r.longest = Math.max(r.longest ?? 0, r.streak); } else r.streak = 0;
      this.last = { moves: this.moves, best: this.need, fine };
      this.ring();
    }
    cx.notify();
    return true;
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
      if (this.practice(e, k, mods, cx)) cx.stop_propagation();
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
    const lv = this.level, cell = BOARD.cell, r = this.round, now = Date.now();
    const left = r ? Math.max(0, ROUND_S - Math.floor((now - r.at) / 1000)) : ROUND_S;
    const hint = r && now - this.idleAt >= HINT_MS ? bestMove(this.at, this.target, BOARD.w, BOARD.h, lv) : null;
    const hintKey = hint ? hint.replace(/^\d+/, "") : null;
    const ink = t.accent_foreground ?? c.canvas;
    const levels = h_flex().gap(G.sm).flex_wrap().children(LEVELS.map((L) => {
      const on = L.n === lv.n, best = this.bests[L.n];
      return h_flex().id(`level-${L.n}`).h(30).px(10).gap(G.sm).items_center().rounded(7).cursor_pointer()
        .border_1().border_color(on ? c.accent : c.border).bg(on ? c.accent + "24" : c.text + "06")
        .hover((s) => s.border_color(c.accent))
        .on_click((_e, cx) => { this.setLevel(L.n); cx.notify(); })
        .child(div().text_size(11).font_semibold().text_color(on ? c.accent : c.dim).child(String(L.n)))
        .child(div().text_size(12.5).font_medium().text_color(on ? c.text : c.muted).child(L.name))
        .when(best != null, (el) => el.child(div().text_size(11).text_color(c.dim).child(String(best))));
    }));
    const board = v_flex().gap(3).p(12).rounded(12).bg(c.text + "05").border_1().border_color(c.border)
      .children(Array.from({ length: BOARD.h }, (_, y) => h_flex().gap(3).children(Array.from({ length: BOARD.w }, (_, x) => {
        const here = x === this.at.x && y === this.at.y, goal = x === this.target.x && y === this.target.y;
        return div().size(cell).rounded(5)
          .bg(here ? c.accent : c.text + "08")
          .when(goal && !here, (el) => el.border_2().border_color(c.accent));
      }))));
    // The home row as your right hand sits on it: which finger, which way.
    const FINGER = { h: ["←", "index, reach"], j: ["↓", "index"], k: ["↑", "middle"], l: ["→", "ring"] };
    const home = h_flex().gap(6).items_start().children(["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"].map((key) => {
      const vim = FINGER[key], usable = lv.keys.includes(key), lit = this.lit?.key === key, hinted = hintKey === key;
      return v_flex().gap(4).items_center()
        .child(div().w(40).h(40).rounded(7).border_1()
          .border_color(lit ? c.accent : hinted ? c.accent : usable ? c.accent + "70" : c.border)
          .bg(lit ? c.accent : hinted ? c.accent + "40" : usable ? c.accent + "1c" : c.text + "06")
          .flex().items_center().justify_center().text_size(14).font_semibold()
          .text_color(lit ? ink : usable || vim ? c.text : c.dim)
          .child(key.toUpperCase()))
        .child(div().h(14).text_size(12).text_color(vim ? (usable ? c.accent : c.dim) : c.canvas).child(vim ? vim[0] : "·"))
        .child(div().h(12).text_size(9.5).text_color(c.dim).child(vim ? vim[1] : ""));
    }));
    const jumps = lv.edges ? h_flex().gap(G.md).children([["0", "row start", "0"], ["$", "row end", "4"], ["gg", "first row", "g"], ["G", "last row", "g"]].map(([k2, word, cap]) => {
      const lit = this.lit?.key === cap && (k2 !== "G" || true), hinted = hint === k2;
      return h_flex().gap(6).items_center()
        .child(div().h(28).min_w(30).px(7).rounded(6).border_1().border_color(lit || hinted ? c.accent : c.border).bg(lit ? c.accent : hinted ? c.accent + "40" : c.text + "08")
          .flex().items_center().justify_center().text_size(12.5).font_semibold().text_color(lit ? ink : c.text).child(k2))
        .child(div().text_size(11.5).text_color(c.muted).child(word));
    })) : null;
    const stat = (label, value, strong = false) => v_flex().gap(2)
      .child(div().text_size(10.5).text_color(c.dim).child(label))
      .child(div().text_size(strong ? 20 : 15).font_semibold().text_color(strong ? c.accent : c.text).child(String(value)));
    const o = this.over;
    const shareable = (this.totals.rounds ?? 0) > 0;
    return v_flex().gap(G.lg)
      .child(h_flex().gap(G.md).items_center()
        .child(div().flex_1().child(levels))
        .when(shareable, (el) => el.child(iconButton("help-share", "share", "Share", (cx) => this.share.toggle(cx), c, { active: this.share.open }))))
      .when(shareable && this.share.open, (el) => el.child(this.share.row(c, () => ({ ...vimShare(this.totals), name: "vim", title: "Learning vim" }),
        "Your best round, rings, days practiced and levels: nothing else. The post opens with the image in it.", G.sm)))
      .child(div().text_size(12.8).line_height(1.5).text_color(c.muted).child(lv.tip))
      .child(h_flex().gap(G.xl).items_start()
        .child(v_flex().gap(G.md)
          .child(board)
          // The time left, as a line that empties.
          .child(div().w_full().h(3).rounded_full().bg(c.text + "10")
            .child(div().h(3).rounded_full().bg(c.accent).w_full().when(Boolean(r), (el) => el.w(Math.round((BOARD.w * (cell + 3) + 21) * left / ROUND_S))))))
        .child(v_flex().gap(G.lg).min_w(120)
          .child(stat(r ? "Score" : o ? "Last round" : "Score", r ? r.score : o ? o.score : 0, true))
          .child(stat("Time", r ? `${left} s` : `${ROUND_S} s`))
          .child(stat("Streak", r ? r.streak : 0))
          .child(stat("Best", this.bests[lv.n] ?? "–"))))
      .child(home)
      .when(Boolean(jumps), (el) => el.child(jumps))
      .child(div().h(18).text_size(12.5).text_color(this.say ? c.text : c.dim)
        .child(o ? `Round over: ${o.score} points, ${o.hits} rings, ${o.perfect} in the fewest moves${o.record ? ". A new best." : "."} Move to play again.`
          : this.say ? this.say
          : this.count ? `${this.count}…`
          : hint ? `Try ${hint}`
          : !r ? "Make a move to start: 60 seconds, as many rings as you can."
          : this.last ? (this.last.fine ? `Fewest moves: ${this.last.moves}. Streak ${r.streak}.` : `${this.last.moves} moves; ${this.last.best} would do.`) : `This one takes ${this.need} at best.`));
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

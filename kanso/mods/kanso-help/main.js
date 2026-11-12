// kansō help, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { paths } from "./platform-paths.js";
import { localName } from "./platform-host.js";
import { modifierLabels, guideSections } from "./guide.js";
import { theme, appHome, home, props, closeOverlay, keys, openOverlay, run } from "herdr";
import { G, tokens, quietTabs, quietLink } from "./ui.js";
import { glyphs } from "./marks.js";
import { TICK_MS, Companion } from "./pets.js";
import { ROWS, MODIFIERS, CAP, layer, LIST_LAYER, LIST_SHIFT, describe } from "./keymap.js";

// kansō help and kansō settings: one window size, so going from one to the other feels like a page.
const DIALOG = { width: 860, height: 680 };
const PAGES = [
  { key: "keys", label: "Keyboard" },
  { key: "dojo", label: "hjkl dōjō" },
  { key: "guide", label: "Guide" },
];
const U = 40, GAP = 5; // a key's unit and the space between keys

const LIT_MS = 650;

const modsOf = (m = {}) => MODIFIERS.filter((k) => (k === "cmd" ? m.platform : k === "ctrl" ? m.control : m[k]));

export default class Help extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.page = PAGES.some((p) => p.key === props()?.page) ? props().page : "keys";
    this.pal = new Companion(cx.timer);
    this.pal.load(cx);
    // The agents' pets come the first time the dōjō's page shows.
    if (this.page === "dojo") this.pal.bring(cx);
    // Your pet waves once when the dōjō's page shows, then is still; a redraw only when its frame changes.
    this.hello = Date.now();
    cx.timer.every(TICK_MS, (cx) => { if (this.page === "dojo" && this.pal.moved(this.petState(), this.hello)) cx.notify(); });
    this.mods = localName() === "windows" ? ["alt"] : ["cmd", "alt"]; // the layer shown first: the vim panes
    this.lists = false;
    this.picked = "h";
    this.lit = null;
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
    if (this.page === "dojo" && k === "enter") { this.enterDojo(); cx.stop_propagation(); return; }
    if (this.page !== "keys") return;
    if (["shift", "control", "alt", "platform", "meta", "cmd", "ctrl", "option", "command"].includes(k)) return;
    const key = k === "return" ? "enter" : k === " " ? "space" : k;
    if (mods.length) { this.mods = mods; this.lists = false; }
    this.picked = key;
    this.light(key, cx);
    cx.stop_propagation(); cx.notify();
  }

  shown() {
    if (this.lists) return this.mods.includes("shift") ? LIST_SHIFT : LIST_LAYER;
    return layer(keys(), this.mods);
  }

  cap(t, c, [name, w = 1], i, bound) {
    const width = Math.round(U * w + GAP * (w - 1));
    const isMod = MODIFIERS.includes(name);
    const held = isMod && (this.lists ? name === "shift" && this.mods.includes("shift") : this.mods.includes(name));
    const does = bound.get(name);
    const pressed = this.lit?.key === name;
    const picked = !isMod && this.picked === name;
    const fill = pressed || picked ? c.accent : held ? c.text + "26" : does ? c.accent + "24" : c.text + "08";
    const ink = pressed || picked ? (t.accent_foreground ?? c.canvas) : does || held ? c.text : c.dim;
    const label = (isMod ? modifierLabels(localName()).MOD_GLYPH[name] : CAP[name]) ?? (name.length === 1 ? name.toUpperCase() : name);
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
    const { MOD_GLYPH, MOD_WORD, join } = modifierLabels(localName());
    const layerName = this.lists ? "In every list and menu" : this.mods.length ? this.mods.map((m) => MOD_GLYPH[m]).join(join) : "No modifier";
    const list = [...bound.entries()].toSorted((a, b) => describe(a[1].action).localeCompare(describe(b[1].action)));
    const chordOf = (d) => (this.lists ? d.chord.split(" ").map((x) => glyphs(x)).join(" ") : glyphs(d.chord));
    return v_flex().gap(G.lg)
      .child(h_flex().gap(G.sm).items_center().flex_wrap()
        .children(MODIFIERS.map((m) => this.chip(c, `mod-${m}`, join ? MOD_WORD[m] : `${MOD_GLYPH[m]} ${MOD_WORD[m]}`, !this.lists && this.mods.includes(m),
          () => { this.lists = false; this.mods = this.mods.includes(m) ? this.mods.filter((x) => x !== m) : MODIFIERS.filter((x) => x === m || this.mods.includes(x)); })))
        .child(div().w(G.sm))
        .child(this.chip(c, "mod-lists", "Lists: j k gg G", this.lists, () => { this.lists = !this.lists; this.mods = []; this.picked = "j"; }))
        .child(div().flex_1())
        .child(div().text_size(12).text_color(c.dim).child(`${layerName} · ${bound.size} ${bound.size === 1 ? "key" : "keys"}`)))
      .child(v_flex().gap(GAP).p(14).rounded(12).bg(c.text + "05").border_1().border_color(c.border).items_center()
        .children(ROWS.map((row, r) => h_flex().gap(GAP).children(row.map((k, i) => this.cap(t, c, k, `${r}-${i}`, bound))))))
      .child(h_flex().h(44).px(14).gap(G.md).items_center().rounded(10).bg(chosen ? c.accent + "18" : c.text + "06")
        .child(div().min_w(64).text_size(17).font_semibold().text_color(chosen ? c.text : c.dim).child(chosen ? chordOf(chosen) : glyphs([...this.mods, this.picked].join("-"))))
        .child(div().flex_1().text_size(13.5).text_color(chosen ? c.text : c.dim)
          .child(chosen ? describe(chosen.action) : "Nothing on this key here. Press a key, or pick one.")))
      .child(v_flex().gap(2)
        .children(list.map(([key, d]) => h_flex().id(`row-${key}`).h(26).px(10).gap(G.md).items_center().rounded(6).cursor_pointer()
          .when(key === this.picked, (el) => el.bg(c.selected))
          .hover((s) => s.bg(c.subtle))
          .on_click((_e, cx) => { this.picked = key; cx.notify(); })
          .child(div().w(84).flex_none().text_size(12.5).font_medium().text_color(c.text).child(chordOf(d)))
          .child(div().flex_1().truncate().text_size(12.5).text_color(c.muted).child(describe(d.action))))));
  }

  enterDojo() {
    closeOverlay(props()?.overlay);
    run("mod.open", { name: "kanso-dojo" });
  }

  petState() { return Date.now() - this.hello < 1800 ? "waving" : "idle"; }

  dojoPage(t, c) {
    const ink = t.accent_foreground ?? c.canvas, pet = this.pal.pet;
    return v_flex().gap(G.xl).pt(G.lg)
      .child(h_flex().gap(G.xl).items_center()
      .child(h_flex().w(150).h(150).flex_none().items_center().justify_center().child(this.pal.face(t, this.petState(), { since: this.hello, scale: 0.7, mood: "glad", px: 9 })))
      .child(v_flex().flex_1().gap(G.md)
        .child(div().text_size(20).font_semibold().text_color(c.text).child("hjkl dōjō"))
        .child(div().text_size(13).line_height(1.55).text_color(c.muted).child("Practice vim's moves until your fingers know them. Nine levels, from h and l alone to w b e, f t and gg G on real lines of code; rounds of ten targets, points for the fewest moves, a streak, and a hint when you stop to think."))
        .child(div().text_size(13).line_height(1.55).text_color(c.muted).child(pet.sheet
          ? `${pet.name} keeps you company, still until you earn it: a jump for a target in the fewest moves, a wave for a streak or a round won, a slump for a key that is no move or the long way round.`
          : "Hachi, the dōjō's shiba, keeps you company: tongue out on a streak or a new best, sweating when you go the long way, asleep if you leave it alone."))
        .child(h_flex().pt(G.sm).gap(G.md).items_center()
          .child(div().id("enter-dojo").h(34).px(16).rounded(8).bg(c.accent).flex().items_center().cursor_pointer()
            .text_size(13).font_semibold().text_color(ink).hover((s) => s.opacity(0.88))
            .on_click(() => this.enterDojo())
            .child("Enter the dōjō"))
          .child(div().text_size(11.5).text_color(c.dim).child("or press Enter")))))
      .child(v_flex().gap(G.md)
        .child(div().text_size(14).font_semibold().text_color(c.text).child("Your pet"))
        .child(this.pal.grid(t, c)));
  }

  block(c, title, lines) {
    return v_flex().gap(6)
      .child(div().text_size(14).font_semibold().text_color(c.text).child(title))
      .children(lines.map((l) => div().text_size(12.8).line_height(1.55).text_color(c.muted).child(l)));
  }

  guidePage(t, c) {
    return v_flex().gap(G.xl).children(guideSections(keys(), localName(), paths.shorten(appHome(), home())).map(([title, lines]) => this.block(c, title, lines)));
  }

  render() {
    const t = theme(), c = tokens(t);
    const page = this.page === "dojo" ? this.dojoPage(t, c) : this.page === "guide" ? this.guidePage(t, c) : this.keysPage(t, c);
    // The same window as kansō settings, in its place: each leads to the other, so you can always go back.
    const toSettings = () => { closeOverlay(props()?.overlay); openOverlay({ mod: "kanso-settings", kind: "dialog", width: DIALOG.width, height: DIALOG.height, props: { page: "keys" } }); };
    return v_flex().id("kanso-help").track_focus(this.handle).size_full().min_h(0).p(20).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().w_full().items_center().gap(G.md)
        .child(svg("mods/kanso-chrome/icons/help.svg").size(17).text_color(c.accent))
        .child(div().flex_1().text_size(15).font_semibold().child("kansō help"))
        .child(quietLink("help-settings", "Settings", toSettings, c, { color: c.accent }))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(G.md).child(quietTabs("help-pages", PAGES, this.page, (key, cx) => { this.page = key; if (key === "dojo") { this.hello = Date.now(); this.pal.bring(cx); } cx.notify(); }, c)))
      .child(v_flex().id(`help-scroll-${this.page}`).flex_1().min_h(0).pt(G.lg).overflow_y_scrollbar().child(div().flex_none().w_full().child(page)));
  }
}

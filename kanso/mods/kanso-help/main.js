// kansō help, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { paths } from "./platform-paths.js";
import { localName } from "./platform-host.js";
import { modifierLabels, guideSections } from "./guide.js";
import { theme, appHome, home, props, closeOverlay, keys, shared } from "herdr";
import { focusOn } from "./pure.js";
import { installedRelease } from "./release.js";
import { whenInstalled } from "./installed.js";
import { readNews, newsPage, NEWS_LOADING } from "./news.js";
import { readAvatars, creditsPage } from "./credits.js";
import { Lit } from "./lit.js";
import { pagedDialog } from "./pages.js";
import { R, T, G, FOCUS, ICON_CHROME, KEY, TINT, alpha, tokens } from "./ui.js";
import { button as kitButton } from "./kit.js";
import { row } from "./ui-row.js";
import { glyphs } from "./marks.js";
import { ROWS, MODIFIERS, CAP, layer, LIST_LAYER, LIST_SHIFT, describe } from "./keymap.js";

const PAGES = [
  { key: "keys", label: "Keyboard" },
  { key: "guide", label: "Guide" },
  { key: "news", label: "What's new" },
  { key: "credits", label: "Credits" },
];

const MODIFIER_KEYS = ["shift", "control", "alt", "platform", "meta", "cmd", "ctrl", "option", "command"];
const NAMED = { return: "enter", " ": "space" };
const ACTIVATING = ["enter", "space"];

export const keyName = (key) => {
  const k = String(key ?? "").toLowerCase();
  return NAMED[k] ?? k;
};

export const heldModifiers = (m = {}) => ["shift", "control", "alt", "platform", "function"].filter((name) => m[name]);

export function keyPress({ page, key, held = [], onControl = false }) {
  const raw = String(key ?? "").toLowerCase();
  const reverseTab = raw === "tab" && held.every((m) => m === "shift");
  if (raw === "escape") return { does: "close", stop: true };
  if (onControl && (reverseTab || (held.length === 0 && ACTIVATING.includes(raw)))) return { does: null, stop: false };
  if (page !== "keys" || MODIFIER_KEYS.includes(raw)) return { does: null, stop: false };
  return { does: "pick", stop: !reverseTab };
}

const modsOf = (m = {}) => MODIFIERS.filter((k) => (k === "cmd" ? m.platform : k === "ctrl" ? m.control : m[k]));

export default class Help extends View {
  init(_props, cx) {
    this.handle = focusOn(cx);
    this.page = PAGES.some((p) => p.key === props()?.page) ? props().page : "keys";
    this.installed = null;
    this.news = null;
    this.avatars = null;
    whenInstalled(cx, (version) => { this.installed = version; });
    this.load(this.page, cx);
    this.mods = localName() === "windows" ? ["alt"] : ["cmd", "alt"]; // the layer shown first: the vim panes
    this.lists = false;
    this.picked = "h";
    this.capLight = new Lit();
  }

  key(e, cx) {
    const key = keyName(e.key), mods = modsOf(e.modifiers);
    const { does, stop } = keyPress({ page: this.page, key: e.key, held: heldModifiers(e.modifiers), onControl: !this.handle.is_focused() });
    if (stop) cx.stop_propagation();
    if (does === "close") closeOverlay(props()?.overlay);
    if (does !== "pick") return;
    if (mods.length) { this.mods = mods; this.lists = false; }
    this.picked = key;
    this.capLight.light(key, cx);
    cx.notify();
  }

  load(page, cx) {
    if (page === "news" && !this.news) {
      this.news = NEWS_LOADING;
      cx.spawn(async (cx) => { this.news = await readNews(); cx.notify(); });
    }
    if (page === "credits" && !this.avatars) {
      this.avatars = new Set();
      cx.spawn(async (cx) => { this.avatars = await readAvatars(); cx.notify(); });
    }
  }

  target(id, c, label, face, act) {
    return kitButton({ label, kind: "quiet", content: [face] })(id, c, { onClick: (cx) => { act(); cx.notify(); } }).m(-FOCUS);
  }

  shown() {
    if (this.lists) return this.mods.includes("shift") ? LIST_SHIFT : LIST_LAYER;
    return layer(keys(), this.mods);
  }

  cap(t, c, [name, w = 1], i, bound) {
    const width = Math.round(KEY.unit * w + KEY.gap * (w - 1));
    const isMod = MODIFIERS.includes(name);
    const held = isMod && (this.lists ? name === "shift" && this.mods.includes("shift") : this.mods.includes(name));
    const does = bound.get(name);
    const pressed = this.capLight.lit?.key === name;
    const picked = !isMod && this.picked === name;
    const fill = pressed || picked ? c.accent : held ? alpha(c.text, TINT.soft) : does ? alpha(c.accent, TINT.bound) : alpha(c.text, TINT.cell);
    const ink = pressed || picked ? (t.accent_foreground ?? c.canvas) : does || held ? c.text : c.dim;
    const label = (isMod ? modifierLabels(localName()).MOD_GLYPH[name] : CAP[name]) ?? (name.length === 1 ? name.toUpperCase() : name);
    const face = div().id(`cap-face-${name}-${i}`).w(width).h(KEY.unit).flex_none().rounded(R.control)
      .border_1().border_color(pressed || picked ? c.accent : does ? alpha(c.accent, TINT.boundLine) : held ? alpha(c.text, TINT.strong) : c.border)
      .bg(fill).flex().items_center().justify_center()
      .text_size(label.length > 1 ? 11 : 13.5).font_medium().text_color(ink)
      .hover((s) => s.border_color(c.accent))
      .child(label);
    return this.target(`cap-${name}-${i}`, c, label || name, face, () => {
      if (isMod) this.hold(name);
      else this.picked = name;
    });
  }

  hold(name) {
    this.lists = false;
    this.mods = this.mods.includes(name) ? this.mods.filter((m) => m !== name) : MODIFIERS.filter((m) => m === name || this.mods.includes(m));
  }

  chip(c, id, text, on, act) {
    const face = div().id(`${id}-face`).h(28).px(G.md).flex().items_center().rounded(R.control)
      .border_1().border_color(on ? c.accent : c.border).bg(on ? alpha(c.accent, TINT.bound) : alpha(c.text, TINT.chip))
      .text_size(T.value).font_medium().text_color(on ? c.text : c.muted)
      .hover((s) => s.border_color(c.accent))
      .child(text);
    return this.target(id, c, text, face, act);
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
        .children(MODIFIERS.map((m) => this.chip(c, `mod-${m}`, join ? MOD_WORD[m] : `${MOD_GLYPH[m]} ${MOD_WORD[m]}`, !this.lists && this.mods.includes(m), () => this.hold(m))))
        .child(div().w(G.sm))
        .child(this.chip(c, "mod-lists", "Lists: j k gg G", this.lists, () => { this.lists = !this.lists; this.mods = []; this.picked = "j"; }))
        .child(div().flex_1())
        .child(div().text_size(T.body).text_color(c.dim).child(`${layerName} · ${bound.size} ${bound.size === 1 ? "key" : "keys"}`)))
      .child(v_flex().gap(KEY.gap).p(14).rounded(12).bg(alpha(c.text, TINT.board)).border_1().border_color(c.border).items_center()
        .children(ROWS.map((row, r) => h_flex().gap(KEY.gap).children(row.map((k, i) => this.cap(t, c, k, `${r}-${i}`, bound))))))
      .child(h_flex().h(44).px(14).gap(G.md).items_center().rounded(R.card).bg(chosen ? alpha(c.accent, TINT.diff) : alpha(c.text, TINT.chip))
        .child(div().min_w(64).text_size(17).font_semibold().text_color(chosen ? c.text : c.dim).child(chosen ? chordOf(chosen) : glyphs([...this.mods, this.picked].join("-"))))
        .child(div().flex_1().text_size(T.card).text_color(chosen ? c.text : c.dim)
          .child(chosen ? describe(chosen.action) : "Nothing on this key here. Press a key, or pick one.")))
      .child(v_flex()
        .children(list.map(([key, d]) => row(`row-${key}`, c, {
          name: describe(d.action), keys: [{ text: chordOf(d) }], current: key === this.picked,
          onClick: (cx) => { this.picked = key; cx.notify(); },
        }))));
  }

  block(c, title, lines) {
    return v_flex().gap(6)
      .child(div().text_size(T.card).font_semibold().text_color(c.text).child(title))
      .children(lines.map((l) => div().text_size(T.value).line_height(1.55).text_color(c.muted).child(l)));
  }

  guidePage(t, c) {
    return v_flex().gap(G.xl).children(guideSections(keys(), localName(), paths.shorten(appHome(), home())).map(([title, lines]) => this.block(c, title, lines)));
  }

  render() {
    const t = theme(), c = tokens(t);
    const have = installedRelease(this.installed, shared("kanso.update")?.tag);
    const page = this.page === "guide" ? this.guidePage(t, c)
      : this.page === "news" ? newsPage(c, this.news ?? NEWS_LOADING, have)
        : this.page === "credits" ? creditsPage(c, this.avatars)
          : this.keysPage(t, c);
    return pagedDialog({
      name: "help", handle: this.handle, onKey: (e, cx) => this.key(e, cx),
      head: h_flex().w_full().items_center().gap(G.md)
        .child(svg("mods/kanso-chrome/icons/circle-question-mark.svg").size(ICON_CHROME).text_color(c.accent))
        .child(div().flex_1().text_size(T.title).font_semibold().child("kansō help"))
        .child(div().text_size(T.micro).text_color(t.dim).child("Esc")),
      tabs: PAGES, tab: this.page, page, t, c,
      onTab: (key, cx) => { this.page = key; this.load(key, cx); cx.notify(); },
    }).on_mouse_up("left", () => this.handle.focus());
  }
}

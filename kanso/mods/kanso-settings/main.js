// Kanso settings, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// One dialog, three pages, opened from the gear at the end of the tab bar
// (after the panel buttons, fixed) or ⌃⇧, (kanso-tabs.settings):
// - Keys: Kanso's own keys (never Herdr's), the tab bar's first, drawn as
//   the bar. Click a key and press a new one in its place, Backspace while
//   pressing drops it, Reset goes back to what Kanso ships. A key something else already uses
//   says so and takes a second press. What you press is written to Herdr's
//   keys.json (`layout:kanso`, `mod:kanso-spend`, `mod:kanso-guard`), which Herdr applies at
//   once and the updater keeps as yours.
// - Mods: the side panels and the pieces of Kanso you can do without, each
//   with a switch. Panels follow the same list as the tab bar's Panels
//   popup (`kanso.panels.off`); pieces are `kanso.hidden`, which each mod
//   reads.
// - What's new: Kanso's CHANGELOG, newest first, with the version you have
//   marked; read from GitHub and kept in data/kanso-settings for when it
//   can't be reached, and the update button when a newer release waits.
// - Credits: Herdr, Kanso's repository and the people who make it.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, keys, shared, setShared, readTextFile, writeTextFile, appHome, exec, run } from "herdr";
import { G, tokens, quietTabs, toggleSwitch, quietLink } from "./ui.js";
import { glyphs, keycap } from "./marks.js";
import { GROUPS, ofRow, familyPattern, familyChords, conflictsOf, rebound } from "./actions.js";
import { DEFAULT_KEYS } from "./defaults.js";
import { parseChangelog, plain, compare } from "./changelog.js";

const PAGES = [{ key: "keys", label: "Keys" }, { key: "mods", label: "Mods" }, { key: "news", label: "What's new" }, { key: "credits", label: "Credits" }];
// Credits: where Kanso comes from and who makes it, each opened in the browser.
// The people's GitHub avatars ship in avatars/ (96 px), so the page needs no network.
const PLACES = [
  { id: "herdr", name: "Herdr", note: "The app kansō runs in", url: "https://herdr.dev" },
  { id: "kanso", name: "kansō", note: "Source, releases and issues", url: "https://github.com/jlopezlira/herdr-kanso" },
];
const PEOPLE = [
  { login: "jlopezlira", name: "Juan José López Lira" },
  { login: "icampana", name: "Iván Campaña" },
];
export const HIDDEN = "kanso.hidden";
// The pieces of Kanso a switch can hide; each mod reads `kanso.hidden`.
export const PIECES = [
  { id: "sidebar.switch", label: "Projects, Status and Threads", note: "The switch at the top of the sidebar; without it the sidebar stays on Projects" },
  { id: "sidebar.activity", label: "What each agent is on", note: "The line under each agent in the sidebar" },
  { id: "tabs.arrange", label: "Arrangements", note: "The button in the tab bar; the key still opens them" },
  { id: "footer.machine", label: "Add machine", note: "In the sidebar's footer" },
  { id: "status.agents", label: "Agents at work", note: "The count in the status bar" },
  { id: "status.palette", label: "Command palette key", note: "In the status bar" },
  { id: "strip.minimap", label: "Minimap", note: "The columns in the status bar" },
];
const CHANGELOG_URL = "https://raw.githubusercontent.com/jlopezlira/herdr-kanso/main/CHANGELOG.md";
const MODIFIERS = new Set(["shift", "control", "ctrl", "alt", "option", "cmd", "platform", "function", "fn", "capslock"]);
const hiddenSet = () => new Set(Array.isArray(shared(HIDDEN)) ? shared(HIDDEN) : []);

export default class Settings extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.page = PAGES.some((p) => p.key === props()?.page) ? props().page : "keys";
    this.capture = null; // { key, section, row, old }: the row waiting for a press
    this.conflict = null; // { chord, taken }: the press that needs a second one
    this.message = null;
    this.installed = null;
    this.news = { entries: null, error: null, from: null };
    cx.spawn(async (cx) => {
      try { this.installed = JSON.parse(await readTextFile(`${appHome()}/mods/kanso-chrome/version.json`) ?? "{}").version ?? null; } catch {}
      cx.notify();
      await this.readNews(cx);
    });
  }

  // ---- Keys ----------------------------------------------------------------------

  // Every binding in Kanso's sections, by section then chord, as Herdr has them now.
  bound() { return keys().filter((k) => GROUPS.some((g) => g.section === k.section)); }

  // A row's chords now, and as shipped; a family's as one pattern each.
  chordsOf(row, section, list) {
    const mine = list.filter((k) => k.section === section && ofRow(row, k.action)).map((k) => k.keys);
    return row.family ? [...new Set(mine.map(familyPattern))] : mine;
  }
  shipped(row, section) {
    const sec = DEFAULT_KEYS[section] ?? {};
    const mine = Object.keys(sec).filter((k) => ofRow(row, sec[k]));
    return row.family ? [...new Set(mine.map(familyPattern))] : mine;
  }

  startCapture(row, section, old, cx) {
    this.capture = { row, section, old, key: `${section}:${row.family ?? row.action}:${old ?? "+"}` };
    this.conflict = null; this.message = null;
    this.handle.focus();
    cx.notify();
  }

  key(e, cx) {
    if (!this.capture) {
      if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
      return;
    }
    cx.stop_propagation();
    if (e.key === "escape") { this.capture = null; this.conflict = null; this.message = null; cx.notify(); return; }
    if (MODIFIERS.has(String(e.key).toLowerCase())) return;
    const { row, section, old } = this.capture;
    if ((e.key === "backspace" || e.key === "delete") && !e.modifiers.control && !e.modifiers.alt && !e.modifiers.platform) {
      if (old) this.change(cx, (doc) => rebound(doc, section, { drop: row.family ? familyChords(old.replace(/N$/, "1")) ?? [] : [old] }));
      else { this.capture = null; cx.notify(); }
      return;
    }
    const chord = e.keystroke;
    const chords = row.family ? familyChords(chord) : [chord];
    if (!chords) { this.message = "Press a key with a digit from 1 to 9: N takes its place."; cx.notify(); return; }
    const taken = chords.flatMap((c) => conflictsOf(keys(), c, row.family ? `${row.family}${c.slice(-1)}` : row.action));
    if (taken.length && this.conflict?.chord !== chord) { this.conflict = { chord, taken }; cx.notify(); return; }
    const set = Object.fromEntries(chords.map((c) => [c, row.family ? `${row.family}${c.slice(-1)}` : row.action]));
    const drop = old ? (row.family ? familyChords(old.replace(/N$/, "1")) ?? [] : [old]) : [];
    this.change(cx, (doc) => rebound(doc, section, { drop, set }));
  }

  reset(row, section, cx) {
    const sec = DEFAULT_KEYS[section] ?? {};
    const set = Object.fromEntries(Object.entries(sec).filter(([, a]) => ofRow(row, a)));
    this.change(cx, (doc) => {
      const drop = Object.keys(doc[section] ?? {}).filter((k) => ofRow(row, doc[section][k]));
      return rebound(doc, section, { drop, set });
    });
  }

  // keys.json rewritten with `change(doc)`; Herdr applies it as it lands.
  change(cx, change) {
    const path = `${appHome()}/keys.json`;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(path);
        const doc = text ? JSON.parse(text) : {};
        await writeTextFile(path, JSON.stringify(change(doc), null, 2) + "\n", text);
        this.message = null;
      } catch (e) { this.message = `keys.json could not be written: ${String(e?.message ?? e)}`; }
      this.capture = null; this.conflict = null;
      cx.notify();
    });
  }

  // A row's keys as a person reads them: a family's "⌃⌥N" as "⌃⌥1–9".
  shown(chord) { return glyphs(chord).replace(/N$/, "1–9"); }

  // The panels as the tab bar shows them, in its order, each with its key
  // by place (the Nth shown panel is the family's N), then the gear. A click
  // on a key takes a new one for all of them: each keeps its number.
  barKeys(t, c, group, list) {
    const [panelRow, gearRow] = group.actions;
    const roster = Array.isArray(shared("kanso.panels.all")) ? shared("kanso.panels.all") : [];
    const panels = roster.filter((p) => p && p.on !== false).slice(0, 9);
    const pattern = this.chordsOf(panelRow, group.section, list)[0] ?? null;
    const capturing = this.capture?.row === panelRow || this.capture?.row === gearRow;
    const tile = (id, icon, label, row, chord, old) => v_flex().id(`bar-${id}`).w(78).flex_none().py(G.sm).gap(6).items_center().rounded(8)
      .cursor_pointer().hover((s) => s.bg(c.subtle)).tooltip(`${label}: click, then press the new key`)
      .when(this.capture?.row === row, (el) => el.bg(c.subtle))
      .on_click((_e, cx) => this.startCapture(row, group.section, old, cx))
      .child(icon ? svg(icon).size(16).text_color(c.muted) : div().size(16).rounded(4).bg(c.subtle))
      .child(div().w_full().px(4).text_center().truncate().text_size(11.5).text_color(c.text).child(label))
      .child(chord ? keycap(t, glyphs(chord)) : keycap(t, "No key", true));
    const gear = this.chordsOf(gearRow, group.section, list)[0] ?? null;
    const tiles = [
      ...panels.map((pnl, i) => tile(pnl.id, pnl.icon, pnl.label, panelRow, pattern ? pattern.replace(/N$/, String(i + 1)) : null, pattern)),
      tile("settings", "mods/kanso-chrome/icons/settings.svg", "Settings", gearRow, gear, gear),
    ];
    const changed = [panelRow, gearRow].some((row) => JSON.stringify(this.chordsOf(row, group.section, list).sort()) !== JSON.stringify(this.shipped(row, group.section).sort()));
    return v_flex().w_full().gap(G.sm)
      .child(h_flex().w_full().items_center().pt(G.lg)
        .child(div().flex_1().text_size(12).text_color(c.dim).child("The tab bar"))
        .when(changed, (el) => el.child(quietLink("reset-bar", "Reset", (cx) => { this.reset(panelRow, group.section, cx); this.reset(gearRow, group.section, cx); }, c, { size: 11.5 }))))
      .child(h_flex().w_full().flex_wrap().gap(2).p(4).rounded(10).bg(c.raised).children(tiles))
      .when(capturing, (el) => el.child(this.pressNote(c, this.capture.row === panelRow
        ? "Press the new key with any digit: each panel keeps its number. Esc to keep, Backspace to remove."
        : "Press the new key. Esc to keep, Backspace to remove.")));
  }

  // What a press needs said: the key to press, a key already in use, an error.
  pressNote(c, ask) {
    const text = this.conflict
      ? `${glyphs(this.conflict.chord)} already does ${[...new Set(this.conflict.taken.map((k) => k.action))].join(", ")}. Press it again to take it, Esc to keep yours.`
      : this.message ?? ask;
    return div().px(G.sm).py(4).text_size(12).line_height(1.45).text_color(this.conflict ? c.yellow : this.message ? c.red : c.accent).child(text);
  }

  keysPage(t, c) {
    const list = this.bound();
    const rows = GROUPS.map((g) => g.bar ? this.barKeys(t, c, g, list) : v_flex().w_full()
      .child(div().pt(G.lg).pb(G.xs).text_size(12).text_color(c.dim).child(g.name))
      .children(g.actions.map((row) => {
        const id = row.family ?? row.action;
        const chords = this.chordsOf(row, g.section, list);
        const changed = JSON.stringify([...chords].sort()) !== JSON.stringify([...this.shipped(row, g.section)].sort());
        const capturing = this.capture?.row === row;
        const line = h_flex().id(`key-${id}`).w_full().h(32).gap(G.sm).items_center().px(G.sm).rounded(6)
          .cursor_pointer().hover((s) => s.bg(c.subtle)).when(capturing, (el) => el.bg(c.subtle))
          .on_click((_e, cx) => this.startCapture(row, g.section, chords[0] ?? null, cx))
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.text).child(row.label))
          .when(changed && !capturing, (el) => el.child(quietLink(`reset-${id}`, "Reset", (cx) => this.reset(row, g.section, cx), c, { size: 11.5 })))
          .when(!capturing, (el) => el.children(chords.length ? chords.map((k) => keycap(t, this.shown(k))) : [keycap(t, "No key", true)]))
          .when(capturing, (el) => el.child(div().flex_none().text_size(12).text_color(c.accent).child(row.family ? "Press a key with a digit" : "Press the new key")));
        return capturing ? v_flex().w_full().child(line).child(this.pressNote(c, "Esc to keep, Backspace to remove.")) : line;
      })));
    return v_flex().w_full()
      .child(div().text_size(12.5).line_height(1.5).text_color(c.muted).child("kansō's own keys. Click one and press the new key."))
      .child(div().text_size(12).line_height(1.5).text_color(c.dim).child("Panes, tabs and spaces use Herdr's keys, in Herdr's settings."))
      .children(rows);
  }

  // ---- Mods ----------------------------------------------------------------------

  modsPage(t, c) {
    const off = new Set(Array.isArray(shared("kanso.panels.off")) ? shared("kanso.panels.off") : []);
    const panels = Array.isArray(shared("kanso.panels.all")) ? shared("kanso.panels.all") : [];
    const hidden = hiddenSet();
    const row = (id, label, note, on, flip, order = null) => h_flex().id(`mod-${id}`).w_full().py(G.sm).gap(G.md).items_center()
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(13).text_color(c.text).child(label))
        .when(Boolean(note), (el) => el.child(div().truncate().text_size(11.5).text_color(c.dim).child(note))))
      .when(Boolean(order), (el) => el.child(h_flex().flex_none().gap(2).children(order)))
      .child(toggleSwitch(`toggle-${id}`, on, (next) => flip(next), c, { label }));
    // The panels' order in the bar, moved one step at a time (`kanso.panels.order`, the same list the bar's drag writes).
    const ids = panels.map((p) => p.id);
    const step = (id, by, glyph) => {
      const i = ids.indexOf(id), j = i + by, can = j >= 0 && j < ids.length;
      return div().id(`order-${id}-${by}`).size(22).flex_none().rounded(4).flex().items_center().justify_center().text_size(12)
        .text_color(can ? c.muted : c.border).when(can, (el) => el.cursor_pointer().hover((s) => s.bg(c.input).text_color(c.text))
          .on_click(() => { const next = [...ids]; [next[i], next[j]] = [next[j], next[i]]; setShared("kanso.panels.order", next); }))
        .child(glyph);
    };
    return v_flex().w_full()
      .child(div().text_size(12.5).line_height(1.5).text_color(c.muted).child("What kansō shows, and in what order. The arrows move a panel's button along the tab bar; a panel or piece turned off leaves its place at once, and comes back the same way."))
      .child(div().pt(G.lg).pb(G.xs).text_size(12).text_color(c.dim).child("Side panels"))
      .when(!panels.length, (el) => el.child(div().py(G.sm).text_size(12).text_color(c.dim).child("The tab bar lists the panels once it has drawn.")))
      .children(panels.map((p) => row(p.id, p.label, null, !off.has(p.id), (on) => { const next = new Set(off); on ? next.delete(p.id) : next.add(p.id); setShared("kanso.panels.off", [...next]); },
        [step(p.id, -1, "\u2191"), step(p.id, 1, "\u2193")])))
      .child(div().pt(G.lg).pb(G.xs).text_size(12).text_color(c.dim).child("Pieces"))
      .children(PIECES.map((p) => row(p.id, p.label, p.note, !hidden.has(p.id), (on) => { const next = hiddenSet(); on ? next.delete(p.id) : next.add(p.id); setShared(HIDDEN, [...next]); })));
  }

  // ---- What's new -------------------------------------------------------------------

  async readNews(cx) {
    const dir = `${appHome()}/data/kanso-settings`, cache = `${dir}/CHANGELOG.md`;
    let text = null, from = null;
    try { const r = await fetch(CHANGELOG_URL); if (r.ok) { text = await r.text(); from = "github"; } } catch {}
    if (text) {
      try { await exec("mkdir", ["-p", dir]); await writeTextFile(cache, text, await readTextFile(cache)); } catch {}
    } else {
      try { text = await readTextFile(cache); from = text ? "cache" : null; } catch {}
    }
    this.news = text ? { entries: parseChangelog(text), error: null, from } : { entries: [], error: "GitHub could not be reached, and nothing was kept from before.", from: null };
    cx.notify();
  }

  newsPage(t, c) {
    const { entries, error, from } = this.news;
    if (entries === null) return div().py(G.md).text_size(12.5).text_color(c.dim).child("Reading");
    const have = this.installed;
    const entry = (e) => {
      const rel = have ? compare(e.version, have) : null;
      const tag = rel === 0 ? "installed" : rel > 0 ? "newer than yours" : null;
      return v_flex().id(`news-${e.version}`).w_full().pt(G.lg).gap(G.xs)
        .child(h_flex().w_full().gap(G.sm).items_baseline()
          .child(div().text_size(15).font_medium().text_color(c.text).child(e.version))
          .when(Boolean(e.date), (el) => el.child(div().text_size(11.5).text_color(c.dim).child(e.date)))
          .when(Boolean(tag), (el) => el.child(div().px(6).h(18).rounded_full().bg((rel === 0 ? c.green : c.accent) + "26").flex().items_center()
            .text_size(11).font_medium().text_color(rel === 0 ? c.green : c.accent).child(tag))))
        .children(e.sections.map((s) => v_flex().w_full().pt(G.xs).gap(G.xs)
          .child(div().text_size(12).text_color(c.dim).child(s.name))
          .children(s.items.map((item, i) => h_flex().w_full().gap(G.sm).items_start()
            .child(div().flex_none().w(6).pt(7).child(div().size(4).rounded_full().bg(c.dim)))
            .child(div().flex_1().min_w(0).text_size(12.5).line_height(1.5).text_color(c.muted).child(plain(item)))))));
    };
    // A release newer than yours: one button, the same update as the footer's row.
    const latest = shared("kanso.update")?.latest ?? null;
    const waiting = have && latest && compare(latest, have) > 0 ? latest : null;
    return v_flex().w_full()
      .when(Boolean(waiting), (el) => el.child(h_flex().w_full().gap(G.md).items_center().p(G.md).rounded(8).bg(c.accent + "1a")
        .child(div().flex_1().text_size(13).text_color(c.text).child(`kansō ${waiting} is available. You have ${have}.`))
        .child(div().id("update-kanso").flex_none().h(28).px(12).rounded(6).bg(c.primary).text_color(c.primaryText).text_size(12.5).font_medium()
          .flex().items_center().cursor_pointer().child(`Update to ${waiting}`)
          .on_click((_e, _cx) => { run("kanso-tabs.update"); closeOverlay(props().overlay); }))))
      .when(Boolean(error), (el) => el.child(div().text_size(12.5).text_color(c.red).child(error)))
      .when(from === "cache", (el) => el.child(div().text_size(11.5).text_color(c.dim).child("GitHub could not be reached; this is the last copy read.")))
      .children(entries.map(entry));
  }

  // Where Kanso comes from and who makes it. Each row opens in the browser.
  creditsPage(t, c) {
    const link = (id, lead, title, note, url) => h_flex().id(`credit-${id}`).w_full().h(52).gap(G.md).items_center().px(G.sm).rounded(8)
      .cursor_pointer().hover((s) => s.bg(c.subtle)).tooltip(url).on_click((_e, cx) => cx.open_url(url))
      .child(lead)
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(13).text_color(c.text).child(title))
        .child(div().truncate().text_size(11.5).text_color(c.dim).child(note)))
      .child(div().flex_none().text_size(11.5).text_color(c.muted).child(url.replace(/^https:\/\//, "")))
      .child(svg("mods/kanso-chrome/icons/open-with.svg").size(13).flex_none().text_color(c.dim));
    const heading = (text) => div().pt(G.lg).pb(G.xs).text_size(12).text_color(c.dim).child(text);
    return v_flex().w_full()
      .child(div().text_size(12.5).line_height(1.5).text_color(c.muted).child("kansō is a layout for Herdr, made in the open."))
      .child(heading("Where it comes from"))
      // Herdr's own mark (the app ships it) and Kanso's ensō.
      .children(PLACES.map((p) => link(p.id, p.id === "herdr"
        ? image("frame/welcome/herdr.png").size(28).flex_none().rounded(7)
        : div().size(28).flex_none().rounded(7).bg(c.subtle).flex().items_center().justify_center().child(svg("mods/kanso-chrome/icons/enso.svg").size(16).text_color(c.text)),
        p.name, p.note, p.url)))
      .child(heading("Made by"))
      .children(PEOPLE.map((p) => link(p.login, image(`mods/kanso-settings/avatars/${p.login}.jpg`).size(28).flex_none().rounded_full(), p.name, `@${p.login} on GitHub`, `https://github.com/${p.login}`)));
  }

  render() {
    const t = theme(), c = tokens(t), p = props() ?? {};
    const page = this.page === "mods" ? this.modsPage(t, c) : this.page === "news" ? this.newsPage(t, c) : this.page === "credits" ? this.creditsPage(t, c) : this.keysPage(t, c);
    return v_flex().id("kanso-settings").track_focus(this.handle).size_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().w_full().items_center().gap(G.md)
        .child(div().flex_1().text_size(15).font_semibold().child(this.installed ? `kansō ${this.installed}` : "kansō"))
        // How to use it, and its keys on a keyboard (kanso-help, ⌘?).
        .child(quietLink("settings-help", "Help and keys", () => { closeOverlay(p.overlay); run("mod.open", { name: "kanso-help" }); }, c, { color: c.accent }))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(G.md).child(quietTabs("settings-pages", PAGES, this.page, (key, cx) => { this.page = key; this.capture = null; this.conflict = null; this.message = null; cx.notify(); }, c)))
      .child(v_flex().flex_1().min_h(0).pt(G.md).overflow_y_scrollbar().child(page));
  }
}

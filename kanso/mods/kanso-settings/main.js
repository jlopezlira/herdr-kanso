import { localName, localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
import { imageApi } from "./platform-images.js";
// Kanso settings, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { theme, props, closeOverlay, keys, shared, setShared, readTextFile, writeTextFile, appHome, run } from "herdr";
import { G, H, T, SEG, tokens, quietTabs, quietLink, skeleton, breathe, Armed, controlInput, section, segmented } from "./ui.js";
import { loadPieces, choice, setPiece, filterPieces, groupsOf, withRoster, STATE_LABEL, STORE } from "./pieces.js";
import { glyphs, keycap, familyPattern, shownChord } from "./marks.js";
import { GROUPS, ofRow, familyChords, conflictsOf, rebound } from "./actions.js";
import { DEFAULT_KEYS } from "./defaults.js";
import { shippedKeymap } from "./platform-keymap.js";
import { parseChangelog, plain, compare } from "./changelog.js";
import { tryOrAsync } from "./pure.js";

const PAGES = [{ key: "pieces", label: "Pieces" }, { key: "keys", label: "Keys" }, { key: "news", label: "What's new" }, { key: "credits", label: "Credits" }];
const PLACES = [
  { id: "herdr", name: "Herdr", note: "The app kansō runs in", url: "https://herdr.dev" },
  { id: "kanso", name: "kansō", note: "Source, releases and issues", url: "https://github.com/jlopezlira/herdr-kanso" },
  { id: "herdr-sim", name: "herdr-sim", note: "The simulator, by Robert Soriano (MIT)", url: "https://github.com/wobsoriano/herdr-sim" },
  { id: "lucide", name: "Lucide", note: "Toolbar icons (ISC)", url: "https://lucide.dev" },
];
const PEOPLE = [
  { login: "jlopezlira", name: "JJ" },
  { login: "icampana", name: "Iván Campaña" },
  { login: "leangseu", name: "Leangseu Kim" },
  { login: "h0ru5", name: "Johannes Hund" },
];
// image() reads only the app's folder: GitHub avatars are downloaded there; prints the logins that have one.
const AVATARS_DIR = "data/kanso-settings/avatars";
const CHANGELOG_URL = "https://raw.githubusercontent.com/jlopezlira/herdr-kanso/main/CHANGELOG.md";
const MODIFIERS = new Set(["shift", "control", "ctrl", "alt", "option", "cmd", "platform", "function", "fn", "capslock"]);

export default class Settings extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    const asked = props()?.page === "mods" ? "pieces" : props()?.page;
    this.page = PAGES.some((p) => p.key === asked) ? asked : "pieces";
    this.capture = null; // { key, section, row, old }: the row waiting for a press
    this.conflict = null; // { chord, taken }: the press that needs a second one
    this.armed = new Armed();
    this.message = null;
    this.installed = null;
    this.news = { entries: null, error: null, from: null };
    this.avatars = null;
    this.find = typeof InputState === "undefined" ? null : InputState.new({ placeholder: "Find" });
    this.find?.on("change", (_e, cx) => cx.notify());
    if (this.page === "credits") this.readAvatars(cx);
    cx.spawn(async (cx) => {
      try { this.installed = JSON.parse(await readTextFile(paths.join(appHome(), "mods", "kanso-chrome", "version.json")) ?? "{}").version ?? null; } catch {}
      cx.notify();
      await this.readNews(cx);
    });
  }

  bound() { return keys().filter((k) => GROUPS.some((g) => g.section === k.section)); }

  chordsOf(row, section, list) {
    const mine = list.filter((k) => k.section === section && ofRow(row, k.action)).map((k) => k.keys);
    return row.family ? [...new Set(mine.map(familyPattern))] : mine;
  }
  shippedBindings(row, section) {
    return Object.entries(DEFAULT_KEYS[shippedKeymap(localName())][section] ?? {}).filter(([, action]) => ofRow(row, action));
  }

  shipped(row, section) {
    const mine = this.shippedBindings(row, section).map(([chord]) => chord);
    return row.family ? [...new Set(mine.map(familyPattern))] : mine;
  }

  startCapture(row, section, old, cx) {
    this.capture = { row, section, old, key: `${section}:${row.family ?? row.action}:${old ?? "+"}` };
    this.conflict = null; this.message = null; this.armed.clear();
    this.handle.focus();
    cx.notify();
  }

  key(e, cx) {
    if (!this.capture) {
      if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
      return;
    }
    cx.stop_propagation();
    if (e.key === "escape") { this.capture = null; this.conflict = null; this.message = null; this.armed.clear(); cx.notify(); return; }
    if (MODIFIERS.has(String(e.key).toLowerCase())) return;
    const { row, section, old } = this.capture;
    if ((e.key === "backspace" || e.key === "delete") && !e.modifiers.control && !e.modifiers.alt && !e.modifiers.platform) {
      if (old) this.change(cx, (doc) => rebound(doc, section, { drop: row.family ? familyChords(old.replace(/N$/, "1")) ?? [] : [old] }));
      else { this.capture = null; this.conflict = null; this.armed.clear(); cx.notify(); }
      return;
    }
    const chord = e.keystroke;
    const chords = row.family ? familyChords(chord) : [chord];
    if (!chords) { this.message = "Press a key with a digit from 1 to 9: N takes its place."; cx.notify(); return; }
    const taken = chords.flatMap((c) => conflictsOf(keys(), c, row.family ? `${row.family}${c.slice(-1)}` : row.action));
    const apply = () => {
      this.armed.clear();
      const set = Object.fromEntries(chords.map((c) => [c, row.family ? `${row.family}${c.slice(-1)}` : row.action]));
      const drop = old ? (row.family ? familyChords(old.replace(/N$/, "1")) ?? [] : [old]) : [];
      this.change(cx, (doc) => rebound(doc, section, { drop, set }));
    };
    if (taken.length && !this.armed.is(chord)) {
      this.conflict = { chord, taken };
      this.armed.press(chord, cx, apply);
      return;
    }
    apply();
  }

  reset(row, section, cx) {
    const set = Object.fromEntries(this.shippedBindings(row, section));
    this.change(cx, (doc) => {
      const drop = Object.keys(doc[section] ?? {}).filter((k) => ofRow(row, doc[section][k]));
      return rebound(doc, section, { drop, set });
    });
  }

  // Herdr applies keys.json as it lands.
  change(cx, change) {
    const path = paths.join(appHome(), "keys.json");
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(path);
        const doc = text ? JSON.parse(text) : {};
        await writeTextFile(path, JSON.stringify(change(doc), null, 2) + "\n", text);
        this.message = null;
      } catch (e) { this.message = `keys.json could not be written: ${String(e?.message ?? e)}`; }
      this.capture = null; this.conflict = null; this.armed.clear();
      cx.notify();
    });
  }

  // The Nth shown panel gets the family's Nth chord; a new key is taken for all of them.
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
    const changed = [panelRow, gearRow].some((row) => JSON.stringify(this.chordsOf(row, group.section, list).toSorted()) !== JSON.stringify(this.shipped(row, group.section).toSorted()));
    return v_flex().w_full().gap(G.sm)
      .child(h_flex().w_full().items_center().pt(G.lg)
        .child(div().flex_1().text_size(12).text_color(c.dim).child("The tab bar"))
        .when(changed, (el) => el.child(quietLink("reset-bar", "Reset", (cx) => { this.reset(panelRow, group.section, cx); this.reset(gearRow, group.section, cx); }, c, { size: 11.5 }))))
      .child(h_flex().w_full().flex_wrap().gap(2).p(4).rounded(10).bg(c.raised).children(tiles))
      .when(capturing, (el) => el.child(this.pressNote(c, this.capture.row === panelRow
        ? "Press the new key with any digit: each panel keeps its number. Esc to keep, Backspace to remove."
        : "Press the new key. Esc to keep, Backspace to remove.")));
  }

  pressNote(c, ask) {
    const live = this.conflict && this.armed.is(this.conflict.chord);
    const text = live
      ? `${glyphs(this.conflict.chord)} already does ${[...new Set(this.conflict.taken.map((k) => k.action))].join(", ")}. Press again to take it, Esc to keep yours.`
      : this.message ?? ask;
    return div().px(G.sm).py(4).text_size(12).line_height(1.45).text_color(live ? c.yellow : this.message ? c.red : c.accent).child(text);
  }

  keysPage(t, c) {
    const list = this.bound();
    const rows = GROUPS.map((g) => g.bar ? this.barKeys(t, c, g, list) : v_flex().w_full()
      .child(div().pt(G.lg).pb(G.xs).text_size(12).text_color(c.dim).child(g.name))
      .children(g.actions.map((row) => {
        const id = row.family ?? row.action;
        const chords = this.chordsOf(row, g.section, list);
        const changed = JSON.stringify(chords.toSorted()) !== JSON.stringify(this.shipped(row, g.section).toSorted());
        const capturing = this.capture?.row === row;
        const line = h_flex().id(`key-${id}`).w_full().h(32).gap(G.sm).items_center().px(G.sm).rounded(6)
          .cursor_pointer().hover((s) => s.bg(c.subtle)).when(capturing, (el) => el.bg(c.subtle))
          .on_click((_e, cx) => this.startCapture(row, g.section, chords[0] ?? null, cx))
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.text).child(row.label))
          .when(changed && !capturing, (el) => el.child(quietLink(`reset-${id}`, "Reset", (cx) => this.reset(row, g.section, cx), c, { size: 11.5 })))
          .when(!capturing, (el) => el.children(chords.length ? chords.map((k) => keycap(t, shownChord(k))) : [keycap(t, "No key", true)]))
          .when(capturing, (el) => el.child(div().flex_none().text_size(12).text_color(c.accent).child(row.family ? "Press a key with a digit" : "Press the new key")));
        return capturing ? v_flex().w_full().child(line).child(this.pressNote(c, "Esc to keep, Backspace to remove.")) : line;
      })));
    return v_flex().w_full()
      .child(div().text_size(12.5).line_height(1.5).text_color(c.muted).child("kansō's own keys. Click one and press the new key."))
      .child(div().text_size(12).line_height(1.5).text_color(c.dim).child("Panes, tabs and spaces use Herdr's keys, in Herdr's settings."))
      .children(rows);
  }

  query() {
    const value = this.find && typeof this.find.value === "function" ? this.find.value() : "";
    return String(value ?? "");
  }

  findField(c) {
    if (!this.find || typeof Input === "undefined") return div().id("pieces-find").w_full().h(H.control);
    return controlInput(Input.new(this.find).w_full(), c).id("pieces-find");
  }

  piecesPage(t, c) {
    this.armed ??= new Armed();
    const map = loadPieces(shared, setShared);
    const groups = groupsOf(filterPieces(this.query(), withRoster(shared("kanso.panels.all"))));
    const row = (piece) => {
      const items = piece.states.map((key) => ({ key, label: STATE_LABEL[key] }));
      return h_flex().id(`piece-row-${piece.id}`).w_full().h(H.row).gap(G.md).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.text).child(piece.label))
        .when(piece.stops === "work" && piece.job, (el) => el.child(div().flex_none().text_size(T.body).text_color(c.dim).child(piece.job)))
        .child(segmented(`piece-${piece.id}`, items, choice(piece.id, map), (state, cx) => {
          setShared(STORE, setPiece(loadPieces(shared, setShared), piece.id, state));
          cx.notify();
        }, c, { width: items.length > 2 ? SEG.three : SEG.two }));
    };
    const armed = this.armed.is("reset");
    return v_flex().w_full()
      .child(this.findField(c))
      .when(!groups.length, (el) => el.child(div().id("pieces-none").py(G.sm).text_size(T.body).text_color(c.dim).child("None")))
      .children(groups.map((group) => v_flex().w_full().pt(G.lg).child(section(c, group.name)).children(group.rows.map(row))))
      .child(h_flex().w_full().justify_end().pt(G.lg).child(quietLink("pieces-reset", armed ? "Press again" : "Reset all", (cx) => {
        this.armed.press("reset", cx, () => { setShared(STORE, {}); cx.notify(); });
      }, c, { color: armed ? c.accent : c.muted })));
  }

  async readNews(cx) {
    const dir = paths.join(appHome(), "data", "kanso-settings"), cache = paths.join(dir, "CHANGELOG.md");
    const fresh = await tryOrAsync(async () => { const r = await fetch(CHANGELOG_URL); return r.ok ? await r.text() : null; });
    if (fresh) await tryOrAsync(async () => { await localService(fileApi).mkdir(dir); await writeTextFile(cache, fresh, await readTextFile(cache)); });
    const kept = fresh ? null : await tryOrAsync(() => readTextFile(cache));
    const text = fresh || kept, from = fresh ? "github" : kept ? "cache" : null;
    this.news = text ? { entries: parseChangelog(text), error: null, from } : { entries: [], error: "GitHub could not be reached, and nothing was kept from before.", from: null };
    cx.notify();
  }

  readAvatars(cx) {
    if (this.avatars) return;
    this.avatars = new Set();
    cx.spawn(async (cx) => {
      const r = await tryOrAsync(() => localService(imageApi).avatars(paths.join(appHome(), AVATARS_DIR), PEOPLE.map((p) => p.login)));
      this.avatars = new Set((r?.stdout ?? "").split("\n").filter(Boolean));
      cx.notify();
    });
  }

  newsBones(c) {
    const { line } = skeleton(c);
    return breathe(v_flex().id("kanso-skeleton").w_full().pt(G.lg).gap(G.sm))
      .child(line(72, 15)).child(line(220, 12)).child(line(180, 12))
      .child(line(64, 15)).child(line(200, 12));
  }

  newsPage(t, c) {
    const { entries, error, from } = this.news;
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
    const latest = shared("kanso.update")?.latest ?? null;
    const waiting = have && latest && compare(latest, have) > 0 ? latest : null;
    return v_flex().w_full()
      .child(h_flex().w_full().pt(G.sm).items_center()
        .child(
          div().id("check-kanso-update").h(34).px(16).rounded(8).bg(c.accent).flex().items_center().cursor_pointer()
            .text_size(13).font_semibold().text_color(c.canvas).hover((s) => s.opacity(0.88))
            .on_click(() => run("kanso-tabs.check"))
            .child("Check for updates")))
      .when(entries === null, (el) => el.child(this.newsBones(c)))
      .when(Boolean(waiting), (el) => el.child(h_flex().w_full().gap(G.md).items_center().p(G.md).rounded(8).bg(c.accent + "1a")
        .child(div().flex_1().text_size(13).text_color(c.text).child(`kansō ${waiting} is available. You have ${have}.`))
        .child(div().id("update-kanso").flex_none().h(28).px(12).rounded(6).bg(c.primary).text_color(c.primaryText).text_size(12.5).font_medium()
          .flex().items_center().cursor_pointer().child(`Update to ${waiting}`)
          .on_click((_e, _cx) => { run("kanso-tabs.update"); closeOverlay(props().overlay); }))))
      .when(Boolean(error), (el) => el.child(div().text_size(12.5).text_color(c.red).child(error)))
      .when(from === "cache", (el) => el.child(div().text_size(11.5).text_color(c.dim).child("GitHub could not be reached; this is the last copy read.")))
      .children((entries ?? []).map(entry));
  }

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
      // Herdr's mark ships with the app; the ensō is Kanso's.
      .children(PLACES.map((p) => link(p.id, p.id === "herdr"
        ? image("frame/welcome/herdr.png").size(28).flex_none().rounded(7)
        : div().size(28).flex_none().rounded(7).bg(c.subtle).flex().items_center().justify_center().child(svg("mods/kanso-chrome/icons/enso.svg").size(16).text_color(c.text)),
        p.name, p.note, p.url)))
      .child(heading("Made by"))
      .children(PEOPLE.map((p) => link(p.login, this.avatars?.has(p.login)
        ? image(`${AVATARS_DIR}/${p.login}.jpg`).size(28).flex_none().rounded_full()
        : div().size(28).flex_none().rounded_full().bg(c.subtle).flex().items_center().justify_center().text_size(12).font_medium().text_color(c.muted).child(p.name[0]),
        p.name, `@${p.login} on GitHub`, `https://github.com/${p.login}`)));
  }

  render() {
    const t = theme(), c = tokens(t), p = props() ?? {};
    const page = this.page === "keys" ? this.keysPage(t, c) : this.page === "news" ? this.newsPage(t, c) : this.page === "credits" ? this.creditsPage(t, c) : this.piecesPage(t, c);
    // The same window as kansō help, in its place: each leads to the other, so you can always go back.
    return v_flex().id("kanso-settings").track_focus(this.handle).size_full().min_h(0).p(20).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().w_full().items_center().gap(G.md)
        .child(svg("mods/kanso-chrome/icons/settings.svg").size(17).text_color(c.accent))
        .child(div().flex_1().text_size(15).font_semibold().child("kansō settings"))
        .when(Boolean(this.installed), (el) => el.child(div().text_size(12).text_color(t.dim).child(this.installed ?? "")))
        .child(quietLink("settings-help", "Help", () => { closeOverlay(p.overlay); run("mod.open", { name: "kanso-help" }); }, c, { color: c.accent }))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().pt(G.md).child(quietTabs("settings-pages", PAGES, this.page, (key, cx) => { this.page = key; if (key === "credits") this.readAvatars(cx); this.capture = null; this.conflict = null; this.message = null; this.armed.clear(); cx.notify(); }, c)))
      .child(v_flex().id(`settings-scroll-${this.page}`).flex_1().min_h(0).pt(G.lg).overflow_y_scrollbar().child(div().flex_none().w_full().child(page)));
  }
}

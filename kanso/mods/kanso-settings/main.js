import { localName } from "./platform-host.js";
import { paths } from "./platform-paths.js";
// Kanso settings, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, keys, shared, setShared, readTextFile, writeTextFile, appHome, run } from "herdr";
import { G, R, T, W, ICON, ICON_CHROME, TINT, alpha, tokens } from "./ui.js";
import { button, quietLink, iconButton, Armed, pressAgain } from "./ui-button.js";
import { field, TextField } from "./ui-field.js";
import { row } from "./ui-row.js";
import { section } from "./ui-section.js";
import { button as kitButton, tooltip } from "./kit.js";
import { undoLine } from "./ui-state.js";
import { segmented } from "./ui-tab.js";
import { toggleSwitch } from "./ui-toggle.js";
import { pieces, choice, setPiece, filterPieces, groupsOf, withRoster, STATE_LABEL, STORE } from "./pieces.js";
import { glyphs, keycap, familyPattern, shownChord } from "./marks.js";
import { GROUPS, ofRow, familyChords, conflictsOf, rebound } from "./actions.js";
import { DEFAULT_KEYS } from "./defaults.js";
import { shippedKeymap } from "./platform-keymap.js";
import { channelOf, installedRelease, offerRelease, stableStay } from "./release.js";
import { focusOn } from "./pure.js";
import { whenInstalled } from "./installed.js";
import { pagedDialog } from "./pages.js";

// A shortcut's key hints: each chord, or a faint No key.
const keysOf = (chords) => (chords.length ? chords.map((k) => ({ text: shownChord(k) })) : [{ text: "No key", faint: true }]);

const REPO = "https://github.com/jlopezlira/herdr-kanso";
const UPDATE_CHOICES = [{ key: "stable", label: "Stable" }, { key: "beta", label: "Early" }];

const PAGES = [{ key: "pieces", label: "Pieces" }, { key: "keys", label: "Keys" }, { key: "updates", label: "Updates" }];
const ASKED = { mods: "pieces", news: "updates" };
const MODIFIERS = new Set(["shift", "control", "ctrl", "alt", "option", "cmd", "platform", "function", "fn", "capslock"]);

export default class Settings extends View {
  init(_props, cx) {
    this.handle = focusOn(cx);
    const asked = ASKED[props()?.page] ?? props()?.page;
    this.page = PAGES.some((p) => p.key === asked) ? asked : "pieces";
    this.capture = null; // { key, section, row, old }: the row waiting for a press
    this.conflict = null; // { chord, taken }: the press that needs a second one
    this.armed = new Armed();
    this.undo = null; // the pieces before Reset all
    this.message = null;
    this.installed = null;
    this.find = new TextField({ placeholder: "Find", value: props()?.find ?? "" });
    this.find.on("change", (_e, cx) => cx.notify());
    whenInstalled(cx, (version) => { this.installed = version; });
  }

  shown() { return installedRelease(this.installed, shared("kanso.update")?.tag); }

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
    // Each tile is the kit's button with the panel's icon, name and key as its face: Tab reaches it, Enter and Space start the capture.
    const tile = (id, icon, label, row, chord, old) => kitButton({ label, kind: "quiet", active: this.capture?.row === row, content: [v_flex().w(W.keyTile).py(G.sm).gap(G.xs).items_center()
      .child(icon ? svg(icon).size(ICON).text_color(c.muted) : div().size(ICON).rounded(R.sm).bg(c.subtle))
      .child(div().w_full().px(G.xs).text_center().truncate().text_size(T.body).text_color(c.text).child(label))
      .child(chord ? keycap(t, glyphs(chord)) : keycap(t, "No key", true))] })(`bar-${id}`, c, { onClick: (cx) => this.startCapture(row, group.section, old, cx) })
      .tooltip(tooltip({ label, detail: "click, then press the new key" }));
    const gear = this.chordsOf(gearRow, group.section, list)[0] ?? null;
    const tiles = [
      ...panels.map((pnl, i) => tile(pnl.id, pnl.icon, pnl.label, panelRow, pattern ? pattern.replace(/N$/, String(i + 1)) : null, pattern)),
      tile("settings", "mods/kanso-chrome/icons/settings.svg", "Settings", gearRow, gear, gear),
    ];
    const changed = [panelRow, gearRow].some((row) => JSON.stringify(this.chordsOf(row, group.section, list).toSorted()) !== JSON.stringify(this.shipped(row, group.section).toSorted()));
    return v_flex().w_full().gap(G.sm)
      .child(h_flex().w_full().items_center().pt(G.lg)
        .child(div().flex_1().text_size(T.body).text_color(c.dim).child("The tab bar"))
        .when(changed, (el) => el.child(quietLink("reset-bar", "Reset", (cx) => { this.reset(panelRow, group.section, cx); this.reset(gearRow, group.section, cx); }, c))))
      .child(h_flex().w_full().flex_wrap().gap(G.hair).p(G.xs).rounded(R.card).bg(c.raised).children(tiles))
      .when(capturing, (el) => el.child(this.pressNote(c, this.capture.row === panelRow
        ? "Press the new key with any digit: each panel keeps its number. Esc to keep, Backspace to remove."
        : "Press the new key. Esc to keep, Backspace to remove.")));
  }

  pressNote(c, ask) {
    const live = this.conflict && this.armed.is(this.conflict.chord);
    const text = live
      ? `${glyphs(this.conflict.chord)} already does ${[...new Set(this.conflict.taken.map((k) => k.action))].join(", ")}. ${pressAgain("take it")}, Esc to keep yours.`
      : this.message ?? ask;
    return div().px(G.sm).py(G.xs).text_size(T.value).line_height(1.45).text_color(live ? c.yellow : this.message ? c.red : c.accent).child(text);
  }

  keysPage(t, c) {
    const list = this.bound();
    const rows = GROUPS.map((g) => g.bar ? this.barKeys(t, c, g, list) : v_flex().w_full().pt(G.lg)
      .child(row(`keys-${g.section}-${g.name}`, c, { name: g.name, heading: true }))
      .children(g.actions.map((action) => {
        const id = action.family ?? action.action;
        const chords = this.chordsOf(action, g.section, list);
        const changed = JSON.stringify(chords.toSorted()) !== JSON.stringify(this.shipped(action, g.section).toSorted());
        const capturing = this.capture?.row === action;
        const line = row(`key-${id}`, c, {
          name: action.label, current: capturing,
          action: changed && !capturing ? { label: "Reset", kind: "quiet", onClick: (cx) => this.reset(action, g.section, cx) } : null,
          keys: capturing ? [{ text: action.family ? "Press a key with a digit" : "Press the new key", recording: true }] : keysOf(chords),
          onClick: (cx) => this.startCapture(action, g.section, chords[0] ?? null, cx),
        });
        return capturing ? v_flex().w_full().child(line).child(this.pressNote(c, "Esc to keep, Backspace to remove.")) : line;
      })));
    return v_flex().w_full()
      .child(div().text_size(T.value).line_height(1.5).text_color(c.muted).child("kansō's own keys. Click one and press the new key."))
      .child(div().text_size(T.body).line_height(1.5).text_color(c.dim).child("Panes, tabs and spaces use Herdr's keys, in Herdr's settings."))
      .children(rows);
  }

  query() {
    return String(this.find.value() ?? "");
  }

  findField(c) {
    return field("pieces-find", this.find, c);
  }

  piecesPage(t, c) {
    const map = pieces(shared);
    const roster = shared("kanso.panels.all");
    const full = withRoster(roster);
    const known = full.filter((row) => row.id.startsWith("panel.")).map((row) => row.id.slice("panel.".length));
    const fromBar = (Array.isArray(roster) ? roster : []).flatMap((panel) => (panel && typeof panel.id === "string" && known.includes(panel.id) ? [panel.id] : []));
    const panelIds = [...fromBar, ...known.filter((id) => !fromBar.includes(id))];
    const listed = filterPieces(this.query(), full);
    const first = listed.findIndex((row) => row.id.startsWith("panel."));
    const ordered = first < 0 ? listed : [
      ...listed.slice(0, first),
      ...panelIds.flatMap((id) => listed.filter((row) => row.id === `panel.${id}`)),
      ...listed.slice(first).filter((row) => !row.id.startsWith("panel.")),
    ];
    const groups = groupsOf(ordered);
    // kanso.panels.order: the same list the bar's drag writes.
    const step = (id, by, icon, label) => {
      const i = panelIds.indexOf(id), j = i + by, can = i >= 0 && j >= 0 && j < panelIds.length;
      return iconButton(`order-${id}-${by}`, icon, label, () => setShared("kanso.panels.order", panelIds.with(i, panelIds[j]).with(j, panelIds[i])), c, { size: "sm", disabled: !can });
    };
    const pieceRow = (piece) => {
      const items = piece.states.map((key) => ({ key, label: STATE_LABEL[key] }));
      const bare = piece.id.startsWith("panel.") ? piece.id.slice("panel.".length) : "";
      return row(`piece-row-${piece.id}`, c, {
        name: piece.label, meta: piece.stops === "work" && piece.job ? piece.job : null,
        tools: [...(bare ? [step(bare, -1, "chevron-up", "Move up"), step(bare, 1, "chevron-down", "Move down")] : []),
          segmented(`piece-${piece.id}`, items, choice(piece.id, map), (state, cx) => {
            setShared(STORE, setPiece(pieces(shared), piece.id, state));
            this.undo = null; cx.notify();
          }, c)],
      });
    };
    return v_flex().w_full()
      .child(this.findField(c))
      .when(!groups.length, (el) => el.child(div().id("pieces-none").py(G.sm).text_size(T.body).text_color(c.dim).child("No piece matches.")))
      .children(groups.map((group) => v_flex().w_full().pt(G.lg).child(section(c, group.name)).children(group.rows.map(pieceRow))))
      .child(h_flex().w_full().justify_end().pt(G.lg).child(this.undo
        ? undoLine("pieces-reset", "Back to the defaults", (cx) => { setShared(STORE, this.undo); this.undo = null; cx.notify(); }, c)
        : quietLink("pieces-reset", "Reset all", (cx) => { this.undo = pieces(shared); setShared(STORE, {}); cx.notify(); }, c)));
  }

  updatesPage(t, c) {
    const updateState = shared("kanso.update") ?? {};
    const autoCheck = updateState.autoCheck !== false;
    const channel = channelOf(updateState.channel);
    const have = installedRelease(this.installed, updateState.tag);
    const stay = channel === "stable" ? stableStay(this.installed, updateState.tag, updateState.latest) : null;
    const waiting = offerRelease(updateState.latest, have, channel);
    const setChannel = (key, cx) => { setShared("kanso.update", { ...(shared("kanso.update") ?? {}), channel: key }); cx.notify(); };
    return v_flex().w_full()
      .child(h_flex().w_full().gap(G.md).items_center()
        .child(div().flex_1().text_size(T.card).text_color(c.text).child("Updates"))
        .child(segmented("updates-channel", UPDATE_CHOICES, channel, setChannel, c)))
      .when(channel === "beta", (el) => el.child(h_flex().id("updates-early").w_full().pt(G.xs).gap(G.xs).items_center().flex_wrap()
        .child(div().text_size(T.body).text_color(c.dim).child("Early gets changes before they are tested by everyone. If kansō is useful to you, "))
        .child(quietLink("updates-star", "Star on GitHub", (cx) => cx.open_url(REPO), c))
        .child(div().text_size(T.body).text_color(c.dim).child(" helps others find it."))))
      .when(Boolean(stay), (el) => el.child(div().id("updates-stay").pt(G.xs).text_size(T.body).text_color(c.dim).child(stay)))
      .child(h_flex().w_full().pt(G.lg).gap(G.md).items_center()
        .child(v_flex().flex_1().min_w(0).gap(G.hair)
          .child(div().text_size(T.card).text_color(c.text).child("Check for updates automatically"))
          .child(div().text_size(T.body).text_color(c.dim).child("Checks on start and every few minutes; updates are only installed when you choose.")))
        .child(toggleSwitch("auto-update-check", autoCheck, (next) => setShared("kanso.update", { ...(shared("kanso.update") ?? {}), autoCheck: next }), c, { label: "Check for updates automatically" })))
      .child(h_flex().w_full().pt(G.sm).items_center()
        .child(
          button("check-kanso-update", "Check for updates", () => run("kanso-tabs.check"), c)))
      .when(Boolean(waiting), (el) => el.child(h_flex().w_full().gap(G.md).items_center().p(G.md).rounded(R.card).bg(alpha(c.accent, TINT.faint))
        .child(div().flex_1().text_size(T.card).text_color(c.text).child(`kansō ${waiting} is available. You have ${have}.`))
        .child(button("update-kanso", `Update to ${waiting}`, () => { run("kanso-tabs.update"); closeOverlay(props().overlay); }, c))));
  }

  render() {
    const t = theme(), c = tokens(t);
    const page = this.page === "keys" ? this.keysPage(t, c) : this.page === "updates" ? this.updatesPage(t, c) : this.piecesPage(t, c);
    return pagedDialog({
      name: "settings", handle: this.handle, t, c, page,
      tabs: PAGES, tab: this.page,
      onTab: (key, cx) => { this.page = key; this.undo = null; this.capture = null; this.conflict = null; this.message = null; this.armed.clear(); cx.notify(); },
      onKey: (e, cx) => this.key(e, cx),
      head: h_flex().w_full().items_center().gap(G.md)
        .child(svg("mods/kanso-chrome/icons/settings.svg").size(ICON_CHROME).text_color(c.accent))
        .child(div().flex_1().text_size(T.title).font_semibold().child("kansō settings"))
        .when(Boolean(this.shown()), (el) => el.child(div().text_size(T.body).text_color(t.dim).child(this.shown())))
        .child(div().text_size(T.micro).text_color(t.dim).child("Esc")),
    });
  }
}

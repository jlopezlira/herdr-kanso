// Gallery (the panel is "look" inside): the pictures an agent made, shown beside it, and a note back to it about
// one. Herdr tells no mod about a click on a terminal's link, so the gallery reads what the agent printed: its
// screen, and for a Claude agent its conversation on disk, where every path is whole and stays.
import { div, image } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { exec, hc, focused, panes, terminals, theme, appHome, home, shared, setShared, watchFolder, openOverlay } from "herdr";
import { tilde } from "./lib.js";
import { G, R, tokens, quietLink, iconButton } from "./ui.js";
import { programIcon, givenNames, nameOf } from "./marks.js";
import { deliver, isAgent, sendKey, waitingNote } from "./deliver.js";
import { openPath, toPng } from "./share.js";
import { mentions, resolvePath, itemOf, shows, arrived, pinFrom, aboutMessage, noted, keyOf } from "./look-model.js";
import { transcriptPaths, MOST } from "./transcript.js";

const LINES = 400;
const READ_MS = 4000; // a terminal's text is read at most this often
const TICK_MS = 1000; // which agent is in focus: Herdr's state, no process
const DIR = "data/kanso-panel/look"; // the copies image() draws, under the app's folder
const KEPT = "kanso.look"; // { follow, pinned }: who the gallery is about, kept while it is closed
const NOTE = "kanso.look.note"; // the dialog's answer for the pin being asked about: { text, at }
const THUMBS = 12; // the newest pictures drawn small under the big one
const MISSING = { image: "This picture can't be read", convert: "Nothing here turns this into a picture" };
// $1 the copies' folder, $2 one file's key: its older copies go, and any left from yesterday.
const FRESH = 'mkdir -p "$1" && rm -f "$1/$2"-* && find "$1" -type f -mtime +1 -exec rm -f {} + 2>/dev/null; true';
const EXISTING = 'for f; do [ -f "$f" ] && printf "%s\\n" "$f"; done; true';
// An agent's terminal on this computer that still runs, or null: a shell would run the note, and another
// machine's files are not here.
function live(address) {
  if (!address || String(address).includes("/")) return null;
  const term = terminals().find((k) => k.address === address);
  return term && isAgent(term, panes().find((q) => q.terminal === address)) ? address : null;
}

export class Look {
  init(cx, p) {
    const kept = shared(KEPT) ?? {};
    this.pinned = live(kept.pinned);
    this.follow = this.focusedTerminal() ?? live(kept.follow);
    this.items = []; this.asked = []; // what the agent printed; what `kanso-tabs.look` opened
    this.selected = null; this.picked = false; this.shown = null; this.pins = [];
    this.readAt = 0; this.reading = false; this.sending = false; this.note = null; this.width = 368; this.watching = null;
    this.asking = null; this.answered = shared(NOTE)?.at ?? 0; // the pin (by id) whose note the dialog asks for; the last answer taken
    this.pinId = 0; // each pin its own id: dropping one never moves the dialog's answer onto another
    this.transcript = null; // the agent's conversation on disk, as last read
    this.chains = new Map(); this.waiting = new Set(); // per file: its last draw, and the files with one not started yet
    this.thumbs = new Map(); // per file: the copy drawn small in the gallery
    this.handle = cx.focus_handle();
    if (p.path) this.ask(p.path, cx);
    this.tick(cx);
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
  }

  focusedTerminal() { return live(focused()?.terminal); }

  // Asked again each time: an agent that ends leaves its terminal to the shell, which must never get a note.
  agent() { return this.pinned ? live(this.pinned) : live(this.follow); }

  keep() { setShared(KEPT, { follow: this.follow, pinned: this.pinned }); }

  // A click on another terminal moves Look to it, unless you pinned one; a click on Look itself keeps it.
  tick(cx) {
    if (this.pinned && !live(this.pinned)) { this.pinned = null; this.keep(); cx.notify(); } // its agent ended
    const now = this.pinned ? null : this.focusedTerminal();
    if (now && now !== this.follow) {
      // A note goes to the agent shown, so what another agent made is not left selected.
      this.follow = now; this.items = []; this.picked = false; this.readAt = 0;
      if (!this.asked.some((i) => i.path === this.selected?.path)) { this.selected = null; this.shown = null; this.pins = []; }
      this.keep();
      cx.notify();
    }
    if (Date.now() - this.readAt >= READ_MS) this.read(cx);
  }

  read(cx) {
    const address = this.agent();
    if (this.reading || !address) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", address, "--lines", String(LINES)]);
        // The conversation first, the screen after: the newest mention wins, and the screen has the latest.
        const before = this.transcript?.address === address ? this.transcript : null;
        const written = await transcriptPaths(address, home(), before);
        if (address !== this.agent()) return;
        // Another program or conversation in the same terminal (a new Claude, or Codex after Claude): what the
        // last one made is not this one's.
        const other = (before?.front && written.front && before.front.pid !== written.front.pid) || (before?.file && written.file && before.file !== written.file);
        if (other && !this.asked.some((i) => i.path === this.selected?.path)) {
          this.items = []; this.picked = false; this.selected = null; this.shown = null; this.pins = [];
        }
        // A read that tells nothing (the terminal unread, a Claude still starting) keeps the last identity, so
        // the next program or conversation is still told apart from it.
        this.transcript = written.front || !before ? { address, ...written, file: written.file ?? (other ? null : before?.file ?? null), paths: written.paths } : before;
        const text = `${written.paths.join("\n")}\n${r.code === 0 ? r.stdout : ""}`;
        const cwd = terminals().find((k) => k.address === address)?.cwd ?? null;
        // Every mention, then only the files that exist: a picture is not lost behind the files deleted since.
        const paths = [...new Set(mentions(text, MOST).map((m) => resolvePath(m, cwd, home())).filter(Boolean))];
        const there = paths.length ? new Set((await exec("sh", ["-c", EXISTING, "sh", ...paths])).stdout.split("\n")) : new Set();
        const found = paths.filter((path) => there.has(path)).map(itemOf);
        if (address !== this.agent()) return;
        const fresh = arrived(found, this.items);
        this.items = found;
        // A pin or a note started counts as looking at it.
        if (fresh && !this.picked && !this.pins.length) this.select(fresh, cx, false);
        this.list().slice(0, THUMBS).forEach((i) => this.thumbnail(i, cx));
      } catch { /* the next tick reads again */ }
      finally { this.reading = false; this.readAt = Date.now(); cx.notify(); }
    });
  }

  // Opened from outside (`herdr-app do 'kanso-tabs.look <path>'`): shown first, as if you picked it.
  ask(raw, cx) {
    const path = resolvePath(String(raw).trim().replace(/^file:\/\//, ""), null, home());
    const item = path ? itemOf(path) : null;
    if (!item?.kind) { this.note = { error: true, text: `The gallery shows pictures: ${raw}` }; return; }
    this.asked = [item, ...this.asked.filter((i) => i.path !== path)];
    this.select(item, cx, true);
  }

  list() {
    const asked = new Set(this.asked.map((i) => i.path));
    return [...this.asked, ...this.items.filter((i) => !asked.has(i.path))];
  }

  select(item, cx, picked) {
    this.picked = this.picked || picked;
    if (this.selected?.path === item.path) return;
    this.selected = item; this.pins = []; this.shown = null; this.watching = null;
    if (shows(item)) { this.draw(item, cx); this.watch(item, cx); }
    cx.notify();
  }

  // image() draws only from the app's folder, so each picture is a copy there, under a new name each time
  // so a changed file is never an old picture kept by the image cache.
  // A file's draws run one after another (each clears that file's older copies first, so two at once could
  // delete the one shown); one waiting is already the newest, so no other joins it. Only the last lands,
  // and one whose file you left before it started does nothing.
  draw(item, cx) {
    const path = item.path;
    if (this.selected?.path === path) this.shown = { path, busy: true };
    if (this.waiting.has(path)) return;
    this.waiting.add(path);
    const done = (this.chains.get(path) ?? Promise.resolve())
      .then(() => { this.waiting.delete(path); return this.selected?.path === path ? this.copy(item) : null; })
      .catch(() => null);
    this.chains.set(path, done);
    cx.spawn(async (cx) => {
      const made = await done;
      const last = this.chains.get(path) === done;
      if (last) this.chains.delete(path);
      if (!last || this.selected?.path !== path) return;
      this.shown = made ? { path, ...made } : { path, error: MISSING[item.kind] };
      if (made) this.thumbs.set(path, made.image);
      cx.notify();
    });
  }

  // The small copy in the gallery: made once per file, after any draw of it in flight (each draw clears the
  // file's older copies), and replaced by the draw's own copy when the file is drawn big.
  thumbnail(item, cx) {
    const path = item.path;
    if (this.thumbs.has(path) || this.waiting.has(path)) return;
    const done = (this.chains.get(path) ?? Promise.resolve()).then(() => (this.thumbs.has(path) ? null : this.copy(item))).catch(() => null);
    this.chains.set(path, done);
    cx.spawn(async (cx) => {
      const made = await done;
      if (this.chains.get(path) === done) this.chains.delete(path);
      if (made && !this.thumbs.has(path)) { this.thumbs.set(path, made.image); cx.notify(); }
    });
  }

  // The copy image() draws: { image, picture } (the file the pins are on), or null.
  async copy(item) {
    const key = keyOf(item.path), dir = `${appHome()}/${DIR}`;
    const name = `${key}-${Date.now()}.${item.kind === "image" ? item.path.split(".").at(-1).toLowerCase() : "png"}`, out = `${dir}/${name}`;
    await exec("sh", ["-c", FRESH, "sh", dir, key]);
    const made = item.kind === "image" ? (await exec("cp", ["-f", item.path, out])).code === 0 : await toPng(item.path, out);
    return made ? { image: `${DIR}/${name}`, picture: item.kind === "image" ? item.path : out } : null;
  }

  // A file the agent writes again shows again. One watch at a time: picking another ends this one at its next change.
  // macOS may name the folder through /private, hence endsWith.
  watch(item, cx) {
    const dir = item.path.replace(/\/[^/]+$/, "") || "/";
    if (this.watching?.path === item.path) return;
    const mine = { path: item.path };
    this.watching = mine;
    cx.spawn(async (cx) => {
      try {
        while (this.watching === mine) {
          const changed = await watchFolder(dir);
          if (this.watching === mine && changed.some((c) => c.endsWith(item.path) || c.endsWith(dir))) this.draw(item, cx);
        }
      } catch { /* no watch here: Read again does it */ }
    });
  }

  // A click drops a pin and asks what about that spot, in a dialog; the answer comes back through shared state.
  pin(e, cx) {
    const at = pinFrom(e.local_position, e.bounds);
    if (!at) return;
    this.pinId += 1;
    this.pins = [...this.pins, { ...at, note: null, id: this.pinId }];
    this.askNote(this.pins.length - 1, cx);
  }

  askNote(index, cx) {
    const p = this.pins[index];
    if (!p) return;
    this.asking = p.id; this.note = null;
    openOverlay({ mod: "kanso-prompt", kind: "dialog", width: 420, props: {
      title: `Pin ${index + 1}`, field: "What about this spot?", value: p.note ?? "", button: p.note ? "Save" : "Add", shared: NOTE } });
    cx.notify();
  }

  // The dialog's answer, read when the shared value changes: the note goes on its pin; cancelled, a new pin goes.
  answer() {
    const a = shared(NOTE);
    if (!a || a.at === this.answered || this.asking == null) return;
    this.answered = a.at;
    const id = this.asking; this.asking = null;
    if (a.text) this.pins = this.pins.map((p) => (p.id === id ? { ...p, note: a.text } : p));
    else this.pins = this.pins.filter((p) => p.id !== id || p.note);
  }

  drop(index, cx) {
    const p = this.pins[index];
    this.pins = this.pins.filter((_, k) => k !== index);
    if (p && this.asking === p.id) this.asking = null;
    cx.notify();
  }

  who(address) {
    const k = terminals().find((x) => x.address === address);
    const pane = panes().find((q) => q.terminal === address);
    return { name: k?.labels?.["kanso.shown"] || nameOf(pane ?? { terminal: address }, givenNames()), status: k?.status ?? pane?.status ?? null, pane };
  }

  send(cx) {
    const item = this.selected, address = this.agent();
    if (!noted(this.pins).length || !item || this.sending) return;
    if (!address) { this.note = { error: true, text: "No agent to send to" }; cx.notify(); return; }
    const { name, status } = this.who(address);
    if (status === "blocked") { this.note = { error: true, text: waitingNote([name]) }; cx.notify(); return; }
    const picture = this.shown?.path === item.path ? this.shown.picture : undefined;
    this.sending = true; cx.notify();
    cx.spawn(async (cx) => {
      const r = await deliver(address, aboutMessage(item, this.pins, picture), "you");
      this.sending = false;
      if (r.code === 0) { this.pins = []; this.note = { text: `Sent to ${name}.` }; }
      else this.note = { error: true, text: `Not sent: ${(r.stderr || r.stdout || "hc send failed").trim()}` };
      cx.notify();
    });
  }

  // One pin's row: its number, its note (or that it has none yet), a click to write it again, an x to drop it.
  noteRow(p, i, c) {
    return h_flex().id(`look-note-${i}`).flex_none().min_h(26).px(G.sm).gap(G.sm).items_center().rounded(R.control).cursor_pointer()
      .hover((s) => s.bg(c.subtle)).on_click((_e, cx) => this.askNote(i, cx))
      .child(div().flex_none().size(18).rounded_full().bg(p.note ? c.accent : c.border).flex().items_center().justify_center().text_size(10).font_bold().text_color(c.canvas).child(String(i + 1)))
      .child(div().flex_1().min_w(0).text_size(12.5).text_color(p.note ? c.text : c.dim).child(p.note ?? "No note yet"))
      .child(div().id(`look-drop-${i}`).flex_none().px(G.xs).text_size(14).text_color(c.muted).cursor_pointer().hover((s) => s.text_color(c.text))
        .on_click((_e, cx) => { cx.stop_propagation(); this.drop(i, cx); }));
  }

  // One picture in the gallery: the copy, cropped to a tile, the one shown marked.
  thumb(item, c) {
    const on = this.selected?.path === item.path, src = this.thumbs.get(item.path);
    const tile = div().id(`look-${keyOf(item.path)}`).flex_none().w(this.tile()).h(Math.round(this.tile() * 0.7)).rounded(R.control).overflow_hidden()
      .bg(c.raised).border_1().border_color(on ? c.accent : c.border).cursor_pointer()
      .when(!on, (el) => el.hover((s) => s.border_color(c.muted)))
      .on_click((_e, cx) => this.select(item, cx, true));
    return src ? tile.child(image(src).w_full()) : tile.child(div().size_full().flex().items_center().justify_center().text_size(10).text_color(c.dim).child(item.name));
  }

  // Three tiles a row, in the width the panel has.
  tile() { return Math.max(72, Math.floor((this.width - G.md * 2 - G.sm * 2) / 3)); }

  picture(c) {
    const s = this.shown;
    if (!s || s.busy) return div().p(G.md).text_size(12).text_color(c.dim).child("Drawing it");
    if (s.error) return div().p(G.md).text_size(12).text_color(c.dim).child(s.error);
    const mark = (p, i) => div().absolute().left(`${p.x * 100}%`).top(`${p.y * 100}%`).ml(-9).mt(-9).size(18).rounded_full().bg(p.note ? c.accent : c.muted)
      .flex().items_center().justify_center().text_size(10).font_bold().text_color(c.canvas).child(String(i + 1));
    return div().id("look-picture").relative().w_full().cursor_crosshair()
      .on_mouse_down("left", (e, cx) => this.pin(e, cx))
      .child(image(s.image).w_full())
      .children(this.pins.map(mark));
  }

  view(c) {
    const item = this.selected;
    if (!item) return div().p(G.md).text_size(12).text_color(c.dim).child(this.agent() ? "No pictures yet" : "No agent in focus");
    return this.picture(c);
  }

  render() {
    const c = tokens(theme()), item = this.selected, address = this.agent();
    const who = address ? this.who(address) : null;
    const list = this.list();
    this.answer();
    const ready = Boolean(item && address && noted(this.pins).length) && !this.sending;
    const actions = item ? [
      div().flex_1().min_w(0).truncate().text_size(11.5).text_color(c.dim).child(tilde(item.path)),
      quietLink("look-open", "Open", () => openPath(item.path), c),
      ...(this.pins.length ? [quietLink("look-unpin", this.pins.length === 1 ? "Clear the pin" : `Clear ${this.pins.length} pins`, (cx) => { this.pins = []; this.asking = null; cx.notify(); }, c)] : []),
    ] : [];
    return v_flex().id("kanso-look").track_focus(this.handle).size_full().min_h(0).bg(c.canvas).text_color(c.text).text_size(13)
      .on_size_change((size, cx) => { if (Math.abs(this.width - size.width) >= 1) { this.width = size.width; cx.notify(); } })
      .on_key_down((e, cx) => { if (sendKey(e)) { this.send(cx); cx.stop_propagation(); } })
      .child(h_flex().h(42).flex_none().px(10).gap(G.sm).items_center().border_b(1).border_color(c.border)
        .child(programIcon(who?.pane?.program, 15, c.muted) ?? div())
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_semibold().text_size(13).child(who?.name ?? "Gallery"))
          .child(div().truncate().text_size(11).text_color(c.dim).child(who ? tilde(terminals().find((k) => k.address === address)?.cwd ?? "") : "")))
        .when(Boolean(address), (el) => el.child(iconButton("look-pin", "pin", this.pinned ? "Follow the pane in focus" : "Stay on this agent",
          (cx) => { this.pinned = this.pinned ? null : address; this.keep(); cx.notify(); }, c, { active: Boolean(this.pinned) })))
        .child(iconButton("look-refresh", "refresh", "Read again", (cx) => { this.read(cx); if (item && shows(item)) this.draw(item, cx); }, c, { spin: this.reading })))
      .child(v_flex().id("look-view").flex_1().min_h(0).overflow_y_scrollbar().child(this.view(c)))
      .when(actions.length > 0, (el) => el.child(h_flex().flex_none().h(30).px(G.md).gap(G.lg).items_center().border_t(1).border_color(c.border).children(actions)))
      .when(list.length > 1, (el) => el.child(h_flex().id("look-gallery").flex_none().max_h(Math.round(this.tile() * 0.7) * 2 + G.sm * 3).px(G.md).py(G.sm).gap(G.sm).flex_wrap().overflow_y_scrollbar().border_t(1).border_color(c.border)
        .children(list.slice(0, THUMBS).map((i) => this.thumb(i, c)))))
      .when(Boolean(item), (el) => el.child(v_flex().flex_none().p(G.md).gap(G.sm).border_t(1).border_color(c.border)
        .when(this.pins.length > 0, (el) => el.child(v_flex().id("look-notes").max_h(26 * 5 + G.xs * 4).gap(G.xs).overflow_y_scrollbar().children(this.pins.map((p, i) => this.noteRow(p, i, c)))))
        .child(h_flex().gap(G.md).items_center()
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(this.note?.error ? c.red : c.dim)
            .child(this.note?.text ?? (this.pins.length ? "" : "Click the picture to pin a spot and say what about it")))
          .child(Button.new("look-send").h(28).px(12).flex_none().items_center().rounded(R.control).bg(c.primary)
            .when(!ready, (b) => b.opacity(0.45))
            .when(ready, (b) => b.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => this.send(cx)))
            .child(div().text_size(12).font_medium().text_color(c.primaryText).child(this.sending ? "Sending…" : noted(this.pins).length > 1 ? `Send ${noted(this.pins).length}  ⌘↩` : "Send  ⌘↩"))))));
  }
}

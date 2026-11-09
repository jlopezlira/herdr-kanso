// Look: the files an agent made (pictures, PDFs, documents), shown beside it, and a note back to it about one.
// Herdr tells no mod about a click on a terminal's link, so Look reads what the agent printed instead: its
// screen, and for a Claude agent its conversation on disk, where every path is whole and stays.
import { div, image } from "gpui-kit";
import { v_flex, h_flex, Button, TextareaState, Textarea } from "gpui-base";
import { exec, hc, focused, panes, terminals, theme, appHome, home, shared, setShared, watchFolder } from "herdr";
import { tilde, showPanel } from "./lib.js";
import { G, R, tokens, quietLink, iconButton } from "./ui.js";
import { programIcon, givenNames, nameOf } from "./marks.js";
import { deliver, isAgent, sendKey, waitingNote } from "./deliver.js";
import { openPath, toPng, firstPage } from "./share.js";
import { mentions, resolvePath, itemOf, shows, arrived, pinFrom, aboutMessage, keyOf } from "./look-model.js";
import { transcriptPaths, MOST } from "./transcript.js";

const LINES = 400;
const READ_MS = 4000; // a terminal's text is read at most this often
const TICK_MS = 1000; // which agent is in focus: Herdr's state, no process
const DIR = "data/kanso-panel/look"; // the copies image() draws, under the app's folder
const KEPT = "kanso.look"; // { follow, pinned }: who Look is about, kept while it is closed
const ROWS = 5;
const MISSING = { image: "This picture can't be read", convert: "Nothing here turns this into a picture", pdf: "Nothing here draws a PDF" };
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
    this.transcript = null; // the agent's conversation on disk, as last read
    this.chains = new Map(); this.waiting = new Set(); // per file: its last draw, and the files with one not started yet
    this.box = TextareaState.new({ placeholder: "A note for the agent", rows: 3 });
    this.box.on("change", (_e, cx) => { this.note = null; cx.notify(); });
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
        // Another conversation in the same terminal (a new Claude there): what the last one made is not this one's.
        if (before?.file && written.file && before.file !== written.file && !this.asked.some((i) => i.path === this.selected?.path)) {
          this.items = []; this.picked = false; this.selected = null; this.shown = null; this.pins = [];
        }
        this.transcript = { address, ...written };
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
        if (fresh && !this.picked && !this.pins.length && !this.box.value().trim()) this.select(fresh, cx, false);
      } catch { /* the next tick reads again */ }
      finally { this.reading = false; this.readAt = Date.now(); cx.notify(); }
    });
  }

  // Opened from outside (`herdr-app do 'kanso-tabs.look <path>'`): shown first, as if you picked it.
  ask(raw, cx) {
    const path = resolvePath(String(raw).trim().replace(/^file:\/\//, ""), null, home());
    const item = path ? itemOf(path) : null;
    if (!item?.kind) { this.note = { error: true, text: `Look shows files: ${raw}` }; return; }
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
      cx.notify();
    });
  }

  // The copy image() draws: { image, picture } (the file the pins are on), or null.
  async copy(item) {
    const key = keyOf(item.path), dir = `${appHome()}/${DIR}`;
    const name = `${key}-${Date.now()}.${item.kind === "image" ? item.path.split(".").at(-1).toLowerCase() : "png"}`, out = `${dir}/${name}`;
    await exec("sh", ["-c", FRESH, "sh", dir, key]);
    const made = item.kind === "image" ? (await exec("cp", ["-f", item.path, out])).code === 0
      : item.kind === "convert" ? await toPng(item.path, out)
        : await firstPage(item.path, Math.round(this.width * 3), out);
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

  pin(e, cx) {
    const at = pinFrom(e.local_position, e.bounds);
    if (!at) return;
    this.pins = [...this.pins, at];
    cx.notify();
  }

  who(address) {
    const k = terminals().find((x) => x.address === address);
    const pane = panes().find((q) => q.terminal === address);
    return { name: k?.labels?.["kanso.shown"] || nameOf(pane ?? { terminal: address }, givenNames()), status: k?.status ?? pane?.status ?? null, pane };
  }

  send(cx) {
    const text = this.box.value().trim(), item = this.selected, address = this.agent();
    if (!text || !item || this.sending) return;
    if (!address) { this.note = { error: true, text: "No agent to send to" }; cx.notify(); return; }
    const { name, status } = this.who(address);
    if (status === "blocked") { this.note = { error: true, text: waitingNote([name]) }; cx.notify(); return; }
    const picture = this.shown?.path === item.path ? this.shown.picture : undefined;
    this.sending = true; cx.notify();
    cx.spawn(async (cx) => {
      const r = await deliver(address, aboutMessage(item, text, this.pins, picture), "you");
      this.sending = false;
      if (r.code === 0) { this.box.set_value(""); this.pins = []; this.note = { text: `Sent to ${name}.` }; }
      else this.note = { error: true, text: `Not sent: ${(r.stderr || r.stdout || "hc send failed").trim()}` };
      cx.notify();
    });
  }

  preview(item) {
    showPanel("preview", { mod: "kanso-panel", props: { panel: "preview", path: item.path, on: null, back: "look" } });
  }

  row(item, c) {
    const on = this.selected?.path === item.path;
    return h_flex().id(`look-${keyOf(item.path)}`).flex_none().h(28).px(G.sm).gap(G.sm).items_center().rounded(R.control).cursor_pointer()
      .when(on, (el) => el.bg(c.selected)).when(!on, (el) => el.hover((s) => s.bg(c.subtle)))
      .on_click((_e, cx) => this.select(item, cx, true))
      .child(div().flex_none().max_w(200).truncate().text_size(12.5).text_color(c.text).when(on, (el) => el.font_medium()).child(item.name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(c.dim).child(tilde(item.path.replace(/\/[^/]+$/, "")) || "/"));
  }

  picture(c) {
    const s = this.shown;
    if (!s || s.busy) return div().p(G.md).text_size(12).text_color(c.dim).child("Drawing it");
    if (s.error) return div().p(G.md).text_size(12).text_color(c.dim).child(s.error);
    const mark = (p, i) => div().absolute().left(`${p.x * 100}%`).top(`${p.y * 100}%`).ml(-9).mt(-9).size(18).rounded_full().bg(c.accent)
      .flex().items_center().justify_center().text_size(10).font_bold().text_color(c.canvas).child(String(i + 1));
    return div().id("look-picture").relative().w_full().cursor_crosshair()
      .on_mouse_down("left", (e, cx) => this.pin(e, cx))
      .child(image(s.image).w_full())
      .children(this.pins.map(mark));
  }

  view(c) {
    const item = this.selected;
    if (!item) return div().p(G.md).text_size(12).text_color(c.dim).child(this.agent() ? "Nothing to look at yet" : "No agent in focus");
    if (shows(item)) return this.picture(c);
    return v_flex().p(G.md).gap(G.xs)
      .child(div().text_size(13).text_color(c.text).child(item.name))
      .child(div().text_size(11.5).text_color(c.dim).child(tilde(item.path)));
  }

  render() {
    const c = tokens(theme()), item = this.selected, address = this.agent();
    const who = address ? this.who(address) : null;
    const list = this.list();
    const ready = Boolean(item && address && this.box.value().trim()) && !this.sending;
    const actions = item ? [
      ...(item.kind === "text" ? [quietLink("look-preview", "Preview", () => this.preview(item), c, { color: c.text })] : []),
      quietLink("look-open", "Open", () => openPath(item.path), c, { color: item.kind === "media" ? c.text : c.muted }),
      ...(this.pins.length ? [quietLink("look-unpin", this.pins.length === 1 ? "Clear the pin" : `Clear ${this.pins.length} pins`, (cx) => { this.pins = []; cx.notify(); }, c)] : []),
    ] : [];
    return v_flex().id("kanso-look").track_focus(this.handle).size_full().min_h(0).bg(c.canvas).text_color(c.text).text_size(13)
      .on_size_change((size, cx) => { if (Math.abs(this.width - size.width) >= 1) { this.width = size.width; cx.notify(); } })
      .on_key_down((e, cx) => { if (sendKey(e)) { this.send(cx); cx.stop_propagation(); } })
      .child(h_flex().h(42).flex_none().px(10).gap(G.sm).items_center().border_b(1).border_color(c.border)
        .child(programIcon(who?.pane?.program, 15, c.muted) ?? div())
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_semibold().text_size(13).child(who?.name ?? "Look"))
          .child(div().truncate().text_size(11).text_color(c.dim).child(who ? tilde(terminals().find((k) => k.address === address)?.cwd ?? "") : "")))
        .when(Boolean(address), (el) => el.child(iconButton("look-pin", "pin", this.pinned ? "Follow the pane in focus" : "Stay on this agent",
          (cx) => { this.pinned = this.pinned ? null : address; this.keep(); cx.notify(); }, c, { active: Boolean(this.pinned) })))
        .child(iconButton("look-refresh", "refresh", "Read again", (cx) => { this.read(cx); if (item && shows(item)) this.draw(item, cx); }, c, { spin: this.reading })))
      .when(list.length > 0, (el) => el.child(v_flex().id("look-list").flex_none().h(Math.min(list.length, ROWS) * 28 + G.sm).px(6).pt(G.xs).overflow_y_scrollbar()
        .children(list.map((i) => this.row(i, c)))))
      .child(v_flex().id("look-view").flex_1().min_h(0).overflow_y_scrollbar().border_t(list.length ? 1 : 0).border_color(c.border).child(this.view(c)))
      .when(actions.length > 0, (el) => el.child(h_flex().flex_none().px(G.md).gap(G.lg).items_center().border_t(1).border_color(c.border).children(actions)))
      .when(Boolean(item), (el) => el.child(v_flex().flex_none().p(G.md).gap(G.sm).border_t(1).border_color(c.border)
        .child(Textarea.new(this.box).px(10).py(8).rounded(R.control).border_1().border_color(c.input).bg(c.raised).text_size(12.5).text_color(c.text))
        .child(h_flex().gap(G.md).items_center()
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(this.note?.error ? c.red : c.dim).child(this.note?.text ?? ""))
          .child(Button.new("look-send").h(28).px(12).flex_none().items_center().rounded(R.control).bg(c.primary)
            .when(!ready, (b) => b.opacity(0.45))
            .when(ready, (b) => b.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => this.send(cx)))
            .child(div().text_size(12).font_medium().text_color(c.primaryText).child(this.sending ? "Sending…" : "Send  ⌘↩"))))));
  }
}

// Images (the panel is "look" inside): pictures an agent made, beside it, and notes pinned to the spots
// they are about. Herdr tells no mod about a click on a terminal's link, so it reads what the agent
// printed: its screen, and the conversation on disk, from the byte it stored last time.
import { div, image } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { exec, hc, focused, panes, terminals, theme, appHome, home, shared, setShared, watchFolder, openOverlay } from "herdr";
import { tilde } from "./lib.js";
import { G, H, R, T, tokens, quietLink, iconButton } from "./ui.js";
import { programIcon, givenNames, nameOf } from "./marks.js";
import { deliver, isAgent, sendKey, waitingNote } from "./deliver.js";
import { openPath, toPng } from "./share.js";
import { mentions, resolvePath, itemOf, shows, arrived, pinFrom, aboutMessage, noted, keyOf, colorOf, indexRows } from "./look-model.js";
import { transcriptPaths, MOST } from "./transcript.js";
import { Kdb } from "./kdb.js";

const LINES = 400;
const READ_MS = 4000; // a terminal's text is read at most this often
const TICK_MS = 1000; // which agent is in focus: Herdr's state, no process
const DIR = "data/kanso-panel/look"; // the copies image() draws, under the app's folder
const KEPT = "kanso.look"; // { follow, pinned }: whose pictures these are, kept while the panel is closed
const NOTE = "kanso.look.note"; // the dialogs' answers, by token: { [token]: { text, at } }, each taken once by the pin that asked
const EMPTY = "Pictures this agent writes show up here, from its conversation.";
const NO_AGENT = "No agent in focus.";
// $1 the copies' folder, $2 one file's key: its older copies go, and any left from yesterday.
const FRESH = 'mkdir -p "$1" && rm -f "$1/$2"-* && find "$1" -type f -mtime +1 -exec rm -f {} + 2>/dev/null; true';
const EXISTING = 'for f; do [ -f "$f" ] && printf "%s\\n" "$f"; done; true';
// One pixel is the picture's average. Sampled once and stored, so a circle is not measured again.
const COLOR = `d=$(mktemp -t kanso-dot).bmp
sips -s format bmp -z 1 1 "$1" --out "$d" >/dev/null 2>&1 || { rm -f "$d"; exit 1; }
python3 - "$d" <<'PY'
import struct,sys
b=open(sys.argv[1],"rb").read()
if len(b)<30: raise SystemExit(1)
off,bpp=struct.unpack_from("<I",b,10)[0],struct.unpack_from("<H",b,28)[0]
px=b[off:off+4]
r,g,bl=(px[2],px[1],px[0]) if bpp>=24 else (0,0,0)
print("#%02x%02x%02x"%(r,g,bl))
PY
rm -f "$d"`;
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
    this.kept = new Map(); // unsent pins, by picture, until Send
    this.readAt = 0; this.reading = false; this.sending = false; this.note = null; this.watching = null;
    this.asking = null; // { id, token }: the pin whose note a dialog asks for, and which dialog
    this.pinId = 0; // each pin its own id: dropping one never moves the dialog's answer onto another
    this.transcript = null; // the agent's conversation on disk, as last read
    this.chains = new Map(); this.waiting = new Set(); // per file: its last draw, and the files with one not started yet
    this.draws = new Map(); // per file: its latest big draw (its copy is published only if still the latest)
    this.colors = new Map(); this.sampling = new Set();
    this.db = new Kdb();
    this.handle = cx.focus_handle();
    if (p.path) this.ask(p.path, cx);
    this.tick(cx);
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
  }

  focusedTerminal() { return live(focused()?.terminal); }

  // Asked again each time: an agent that ends leaves its terminal to the shell, which must never get a note.
  agent() { return this.pinned ? live(this.pinned) : live(this.follow); }

  keep() { setShared(KEPT, { follow: this.follow, pinned: this.pinned }); }

  emptyLine() { return this.agent() ? EMPTY : NO_AGENT; }

  // A click on another terminal moves Images to it, unless you pinned one; a click on Images itself keeps it.
  tick(cx) {
    if (this.pinned && !live(this.pinned)) { this.pinned = null; this.keep(); cx.notify(); } // its agent ended
    const now = this.pinned ? null : this.focusedTerminal();
    if (now && now !== this.follow) {
      // A note goes to the agent shown, so what another agent made is not left selected.
      this.hold();
      this.follow = now; this.items = []; this.picked = false; this.readAt = 0;
      if (!this.asked.some((i) => i.path === this.selected?.path)) { this.selected = null; this.shown = null; this.pins = []; }
      this.keep();
      cx.notify();
    }
    if (Date.now() - this.readAt >= READ_MS) this.read(cx);
  }

  async recall(file) {
    try {
      const got = await this.db.pictures(file);
      return { file, size: got.size, paths: got.rows.map((r) => r.path), rows: got.rows };
    } catch { return null; }
  }

  read(cx) {
    const address = this.agent();
    if (this.reading || !address) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", address, "--lines", String(LINES)]);
        const before = this.transcript?.address === address ? this.transcript : null;
        const written = await transcriptPaths(address, home(), before, (file) => this.recall(file));
        if (address !== this.agent()) return;
        // Another program or conversation in the same terminal: what the last one made is not this one's.
        const other = (before?.front && written.front && before.front.pid !== written.front.pid) || (before?.file && written.file && before.file !== written.file);
        if (other && !this.asked.some((i) => i.path === this.selected?.path)) {
          this.items = []; this.picked = false; this.selected = null; this.shown = null; this.pins = [];
          this.kept = new Map(); this.asking = null;
        }
        if (written.failed) return;
        // No record for a moment (an agent still starting): keep the conversation already read.
        if (!written.file && before?.file && !other) { this.transcript = before; return; }
        const screen = r.code === 0 ? r.stdout : "";
        const cwd = terminals().find((k) => k.address === address)?.cwd ?? null;
        const homeDir = home();
        const named = [...(written.paths ?? []), ...mentions(screen, MOST).toReversed()].map((m) => resolvePath(m, cwd, homeDir)).filter(Boolean);
        const resolved = [...new Set(named)];
        const there = resolved.length ? new Set((await exec("sh", ["-c", EXISTING, "sh", ...resolved])).stdout.split("\n")) : new Set();
        const pictures = resolved.filter((path) => there.has(path) && shows(itemOf(path)));
        const prior = (written.rows ?? []).map((row) => ({ ...row, color: row.color || this.colors.get(row.path) || null }));
        const rows = indexRows(prior, pictures, { replaced: Boolean(written.replaced) });
        if (written.file && written.size != null) {
          try { await this.db.savePictures(written.file, written.size, rows); } catch { /* the next read stores it */ }
        }
        const found = rows.toSorted((a, b) => b.ord - a.ord).map((row) => ({ ...itemOf(row.path), color: row.color || this.colors.get(row.path) || null }));
        if (address !== this.agent()) return;
        const fresh = arrived(found, this.items);
        const previous = this.list();
        this.items = found;
        this.transcript = {
          address, front: written.front, size: written.size, paths: written.paths, rows,
          file: written.file ?? (other ? null : before?.file ?? null),
        };
        const still = (i) => this.list().some((k) => k.path === i.path);
        if (this.selected && !still(this.selected)) {
          const gone = this.selected.path;
          const at = previous.findIndex((i) => i.path === gone);
          const next = previous.slice(at + 1).find(still) ?? previous.slice(0, Math.max(at, 0)).toReversed().find(still) ?? null;
          this.picked = false;
          if (next) this.select(this.list().find((i) => i.path === next.path), cx, false);
          else { this.hold(); this.selected = null; this.shown = null; this.pins = []; }
        } else if (fresh && !this.picked && !this.pins.length) this.select(fresh, cx, false);
        const live = new Set(this.list().map((i) => i.path));
        this.kept = new Map([...this.kept].filter(([path]) => live.has(path)));
        found.filter((i) => !i.color).forEach((i) => this.sample(i, written.file, cx));
      } catch { /* the next tick reads again */ }
      finally { this.reading = false; this.readAt = Date.now(); cx.notify(); }
    });
  }

  // Opened from outside (`herdr-app do 'kanso-tabs.look <path>'`): shown first, as if you picked it.
  ask(raw, cx) {
    const path = resolvePath(String(raw).trim().replace(/^file:\/\//, ""), null, home());
    const item = path ? itemOf(path) : null;
    if (!item?.kind) { this.note = { error: true, text: `Images shows pictures: ${raw}` }; return; }
    this.asked = [item, ...this.asked.filter((i) => i.path !== path)];
    this.select(item, cx, true);
  }

  list() {
    const asked = new Set(this.asked.map((i) => i.path));
    return [...this.asked, ...this.items.filter((i) => !asked.has(i.path))];
  }

  // Unsent pins stay on the picture they were dropped on, including after a later read.
  hold() {
    const path = this.selected?.path;
    if (!path) return;
    if (this.pins.length) this.kept.set(path, this.pins.map((p) => ({ ...p })));
    else this.kept.delete(path);
  }

  select(item, cx, picked) {
    this.picked = this.picked || picked;
    if (this.selected?.path === item.path) return;
    this.hold();
    this.selected = item;
    this.pins = (this.kept.get(item.path) ?? []).map((p) => ({ ...p }));
    this.shown = null; this.watching = null;
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
    this.chains.set(path, done); this.draws.set(path, done);
    cx.spawn(async (cx) => {
      const made = await done;
      if (this.chains.get(path) === done) this.chains.delete(path);
      const last = this.draws.get(path) === done;
      if (last) this.draws.delete(path);
      if (!last || this.selected?.path !== path) { cx.notify(); return; }
      if (!made) {
        this.shown = null;
        const next = this.list().find((i) => i.path !== path);
        if (next) this.select(next, cx, false);
        else { this.hold(); this.selected = null; this.shown = null; this.pins = []; }
        cx.notify();
        return;
      }
      this.shown = { path, ...made };
      cx.notify();
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

  sample(item, file, cx) {
    if (!item || item.color || this.sampling.has(item.path)) return;
    this.sampling.add(item.path);
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", COLOR, "sh", item.path]).catch(() => null);
        const color = colorOf(r?.code === 0 ? r.stdout : "");
        if (!color) return;
        this.colors.set(item.path, color);
        const paint = (i) => (i.path === item.path ? { ...i, color } : i);
        this.items = this.items.map(paint);
        this.asked = this.asked.map(paint);
        if (this.transcript?.rows) this.transcript.rows = this.transcript.rows.map((row) => (row.path === item.path ? { ...row, color } : row));
        if (file) await this.db.setPictureColor(file, item.path, color).catch(() => {});
        cx.notify();
      } finally { this.sampling.delete(item.path); }
    });
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
    // Each dialog its own token: another window's answer, or an earlier one, is never taken for this pin's.
    const token = `${Date.now()}-${Math.random()}`;
    this.asking = { id: p.id, token, path: this.selected.path }; this.note = null;
    openOverlay({ mod: "kanso-prompt", kind: "dialog", width: 420, props: {
      title: `Pin ${index + 1}`, field: "What about this spot?", value: p.note ?? "", button: p.note ? "Save" : "Add", shared: NOTE, token } });
    cx.notify();
  }

  // The dialog's answer, read when the shared value changes: the note goes on its pin; cancelled, a new pin goes.
  answer() {
    const box = shared(NOTE), token = this.asking?.token, a = token ? box?.[token] : null;
    if (!a) return;
    const { id, path } = this.asking; this.asking = null;
    // Taken: out of the box, with whatever was left there over an hour ago (a dialog nobody read, another window's).
    setShared(NOTE, Object.fromEntries(Object.entries(box).filter(([k, v]) => k !== token && (v?.at ?? 0) > Date.now() - 3600000)));
    const pins = path === this.selected?.path ? this.pins : (this.kept.get(path) ?? []);
    const next = a.text ? pins.map((p) => (p.id === id ? { ...p, note: a.text } : p)) : pins.filter((p) => p.id !== id || p.note);
    if (path === this.selected?.path) this.pins = next;
    else if (next.length) this.kept.set(path, next);
    else this.kept.delete(path);
  }

  drop(index, cx) {
    const p = this.pins[index];
    this.pins = this.pins.filter((_, k) => k !== index);
    if (p && this.asking?.id === p.id) this.asking = null;
    cx.notify();
  }

  who(address) {
    const k = terminals().find((x) => x.address === address);
    const pane = panes().find((q) => q.terminal === address);
    return { name: k?.labels?.["kanso.shown"] || nameOf(pane ?? { terminal: address }, givenNames()), status: k?.status ?? pane?.status ?? null, pane };
  }

  send(cx) {
    const item = this.selected, address = this.agent(), pins = this.pins;
    if (!noted(pins).length || !item || this.sending) return;
    if (!address) { this.note = { error: true, text: "No agent to send to" }; cx.notify(); return; }
    const { name, status } = this.who(address);
    if (status === "blocked") { this.note = { error: true, text: waitingNote([name]) }; cx.notify(); return; }
    const picture = this.shown?.path === item.path ? this.shown.picture : undefined;
    this.sending = true; cx.notify();
    cx.spawn(async (cx) => {
      const r = await deliver(address, aboutMessage(item, pins, picture), "you");
      this.sending = false;
      if (r.code === 0) {
        this.kept.delete(item.path);
        if (this.selected?.path === item.path) this.pins = [];
        if (this.asking?.path === item.path) this.asking = null;
        this.note = { text: `Sent to ${name}.` };
      }
      else this.note = { error: true, text: `Not sent: ${(r.stderr || r.stdout || "hc send failed").trim()}` };
      cx.notify();
    });
  }

  // One pin's row: its number, its note (or that it has none yet), a click to write it again, an x to drop it.
  noteRow(p, i, c) {
    return h_flex().id(`look-note-${i}`).flex_none().min_h(H.compact).px(G.sm).gap(G.sm).items_center().rounded(R.control).cursor_pointer()
      .hover((s) => s.bg(c.subtle)).on_click((_e, cx) => this.askNote(i, cx))
      .child(div().flex_none().size(G.lg).rounded_full().bg(p.note ? c.accent : c.border).flex().items_center().justify_center().text_size(T.label).font_bold().text_color(c.canvas).child(String(i + 1)))
      .child(div().flex_1().min_w(0).text_size(T.body).text_color(p.note ? c.text : c.dim).child(p.note ?? "No note yet"))
      .child(div().id(`look-drop-${i}`).flex_none().px(G.xs).text_size(T.card).text_color(c.muted).cursor_pointer().hover((s) => s.text_color(c.text))
        .on_click((_e, cx) => { cx.stop_propagation(); this.drop(i, cx); }).child("×"));
  }

  // One circle per picture. The one shown is filled with that picture's color.
  dot(item, c) {
    const on = this.selected?.path === item.path;
    const color = item.color || c.accent;
    return Button.new(`look-dot-${keyOf(item.path)}`).size(H.compact).flex_none().items_center().justify_center().cursor_pointer()
      .accessibility_label(item.name)
      .when(!on, (el) => el.hover((s) => s.opacity(0.7)))
      .on_click((_e, cx) => this.select(item, cx, true))
      .child(div().size(G.sm).rounded_full().border_1().border_color(on ? color : c.muted).when(on, (el) => el.bg(color)));
  }

  dots(list, c) {
    return h_flex().id("look-dots").flex_none().h(H.compact).px(G.lg).gap(G.sm).items_center().overflow_x_scrollbar()
      .children(list.map((i) => this.dot(i, c)));
  }

  picture(c) {
    const s = this.shown;
    if (!s?.image) return null;
    const mark = (p, i) => div().absolute().left(`${p.x * 100}%`).top(`${p.y * 100}%`).ml(-G.sm).mt(-G.sm).size(G.lg).rounded_full().bg(p.note ? c.accent : c.muted)
      .flex().items_center().justify_center().text_size(T.label).font_bold().text_color(c.canvas).child(String(i + 1));
    return div().id("look-picture").relative().w_full().cursor_crosshair()
      .on_mouse_down("left", (e, cx) => this.pin(e, cx))
      .child(image(s.image).w_full())
      .children(this.pins.map(mark));
  }

  empty(c) {
    return v_flex().id("look-empty").flex_1().w_full().items_center().justify_center().gap(G.md).px(G.xl)
      .child(div().size(G.lg).rounded_full().border_1().border_color(c.border))
      .child(div().text_size(T.card).text_color(c.muted).text_center().child(this.emptyLine()));
  }

  view(c) {
    if (!this.selected) return this.empty(c);
    if (this.shown?.image) return this.picture(c);
    if (this.shown?.busy) return div().text_size(T.body).text_color(c.dim).child("Drawing it");
    return div();
  }

  render() {
    const c = tokens(theme()), item = this.selected, address = this.agent();
    const who = address ? this.who(address) : null;
    const list = this.list();
    this.answer();
    const ready = Boolean(item && address && noted(this.pins).length) && !this.sending;
    const status = this.note?.text ?? (this.pins.length ? "" : item ? "Pin a spot" : "");
    return v_flex().id("kanso-look").track_focus(this.handle).size_full().min_h(0).bg(c.canvas).text_color(c.text)
      .on_key_down((e, cx) => { if (sendKey(e)) { this.send(cx); cx.stop_propagation(); } })
      .child(h_flex().flex_none().px(G.lg).py(G.sm).gap(G.sm).items_center().border_b(1).border_color(c.border)
        .child(programIcon(who?.pane?.program, 15, c.muted) ?? div())
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_semibold().text_size(T.card).child(who?.name ?? "Images"))
          .child(div().truncate().text_size(T.small).text_color(c.dim).child(who ? tilde(terminals().find((k) => k.address === address)?.cwd ?? "") : "")))
        .when(Boolean(address), (el) => el.child(iconButton("look-pin", "pin", this.pinned ? "Follow the pane in focus" : "Stay on this agent",
          (cx) => { this.pinned = this.pinned ? null : address; this.keep(); cx.notify(); }, c, { active: Boolean(this.pinned) })))
        .child(iconButton("look-refresh", "refresh", "Read again", (cx) => { this.read(cx); if (item && shows(item)) this.draw(item, cx); }, c, { spin: this.reading })))
      .child(v_flex().id("look-view").flex_1().min_h(0).w_full().overflow_hidden().items_center().justify_center().child(this.view(c)))
      .when(list.length > 0, (el) => el.child(this.dots(list, c)))
      .when(this.pins.length > 0, (el) => el.child(v_flex().id("look-notes").flex_none().max_h(H.compact * 5 + G.xs * 4).px(G.lg).py(G.sm).gap(G.xs).overflow_y_scrollbar().border_t(1).border_color(c.border)
        .children(this.pins.map((p, i) => this.noteRow(p, i, c)))))
      .when(Boolean(item), (el) => el.child(h_flex().id("look-bar").flex_none().h(H.control).px(G.lg).gap(G.md).items_center().border_t(1).border_color(c.border)
        .child(div().flex_1().min_w(0).truncate().text_size(T.body).text_color(c.dim).child(tilde(item.path)))
        .when(Boolean(status), (bar) => bar.child(div().flex_1().min_w(0).truncate().text_size(T.small).text_color(this.note?.error ? c.red : c.dim).child(status)))
        .child(quietLink("look-open", "Open", () => openPath(item.path), c))
        .when(this.pins.length > 0, (bar) => bar.child(quietLink("look-unpin", this.pins.length === 1 ? "Clear the pin" : `Clear ${this.pins.length} pins`, (cx) => { this.pins = []; this.kept.delete(item.path); this.asking = null; cx.notify(); }, c)))
        .child(Button.new("look-send").h(H.compact).px(G.md).flex_none().items_center().rounded(R.control).bg(c.primary)
          .when(!ready, (b) => b.opacity(0.45))
          .when(ready, (b) => b.cursor_pointer().hover((s) => s.opacity(0.85)).on_click((_e, cx) => this.send(cx)))
          .child(div().text_size(T.value).font_medium().text_color(c.primaryText).child(this.sending ? "Sending…" : noted(this.pins).length > 1 ? `Send ${noted(this.pins).length}  ⌘↩` : "Send  ⌘↩")))));
  }
}

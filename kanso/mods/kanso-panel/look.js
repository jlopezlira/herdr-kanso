import { localService, serviceOn } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
import { imageApi } from "./platform-images.js";
import { systemApi } from "./platform-system.js";
import { bring, machineOf, copyFailure, drawablePath, remoteDue, ArmPoll, pollStart, pollNext, takeStamp, staleView, asOf, bytesLabel, listFailure, sweepLook } from "./remote-file.js";
// Images (the panel is "look" inside): pictures an agent made, beside it, and notes pinned to the spots
// they are about. Herdr tells no mod about a click on a terminal's link, so it reads what the agent
// printed: its screen, and the conversation on disk, from the byte it stored last time.
import { div, image } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { hc, focused, panes, terminals, theme, appHome, home, shared, setShared, watchFolder, openOverlay, window, layout } from "herdr";
import { tilde } from "./lib.js";
import { G, H, R, T, tokens, button, quietLink, iconButton, skeleton, breathe } from "./ui.js";
import { programIcon, givenNames, nameOf } from "./marks.js";
import { deliver, isAgent, sendKey, waitingNote } from "./deliver.js";
import { openPath, toPng } from "./share.js";
import { mentions, resolvePath, itemOf, shows, arrived, pinFrom, aboutMessage, noted, keyOf, colorOf, indexRows } from "./look-model.js";
import { walkLayout } from "./layout.js";
import { lookMemory } from "./panel-state.js";
import { Front } from "./front.js";
import { transcriptPaths, MOST } from "./transcript.js";

const LINES = 400;
const TICK_MS = 1000; // which agent is in focus: Herdr's state, no process
const DIR = "data/kanso-panel/look"; // the copies image() draws, under the app's folder
const KEPT = "kanso.look"; // { follow, pinned }: whose pictures these are, kept while the panel is closed
const NOTE = "kanso.look.note"; // the dialogs' answers, by token: { [token]: { text, at } }, each taken once by the pin that asked
const EMPTY = "Pictures this agent writes show up here, from its conversation.";
const NO_AGENT = "No agent in focus.";
// An agent's terminal that still runs, or null: a shell would run the note.
function live(address) {
  if (!address) return null;
  const term = terminals().find((k) => k.address === address);
  return term && isAgent(term, panes().find((q) => q.terminal === address)) ? address : null;
}

export class Look {
  constructor(db) { this.db = db; }

  init(cx, p) {
    const kept = shared(KEPT) ?? {};
    this.pinned = live(kept.pinned);
    this.follow = this.focusedTerminal() ?? live(kept.follow);
    this.items = []; this.asked = []; // what the agent printed; what `kanso-tabs.look` opened
    this.selected = null; this.picked = false; this.shown = null; this.pins = [];
    this.kept = new Map(); // unsent pins, by agent and picture, until Send
    this.blind = new Set(); // this session: a file that will not open stays out of the row
    this.readAt = 0; this.reading = false; this.sending = false; this.note = null; this.watching = null;
    this.front = new Front(() => this.screenDue());
    this.poll = pollStart(); this.stamp = null; this.pendingStamp = null; this.fresh = null; this.held = null; this.arm = null; this.pullFailed = false;
    this.homeOn = null; this.homeDir = null;
    this.asking = null; // { id, token, path, who }: the pin a dialog asks about, and which dialog
    this.pinId = 0; // each pin its own id: dropping one never moves the dialog's answer onto another
    this.transcript = null; // the agent's conversation on disk, as last read
    this.chains = new Map(); this.waiting = new Set(); // per file: its last draw, and the files with one not started yet
    this.draws = new Map(); // per file: its latest big draw (its copy is published only if still the latest)
    this.colors = new Map(); this.sampling = new Set();
    this.handle = cx.focus_handle();
    if (p.path) this.ask(p.path, cx);
    else if (this.keptPath) { const path = this.keptPath; this.keptPath = null; this.ask(path, cx); }
    this.tick(cx);
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
  }

  saveState() { return this.selected?.path ? { path: this.selected.path, on: machineOf(this.agent()) } : null; }

  async restoreState(state) {
    const path = typeof state?.path === "string" ? state.path : "";
    if (!path) return false;
    const ok = await (await serviceOn(fileApi, state?.on || null)).test(path).catch(() => false);
    if (!lookMemory(state, () => ok) || !shows(itemOf(path))) return false;
    this.keptPath = path;
    return true;
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
      this.stamp = null; this.pendingStamp = null; this.poll = pollStart(); this.arm = null; this.held = null; this.fresh = null;
      if (!this.asked.some((i) => i.path === this.selected?.path)) { this.selected = null; this.shown = null; this.pins = []; }
      else if (this.selected) this.pins = (this.kept.get(this.pinKey(this.selected.path)) ?? []).map((p) => ({ ...p }));
      this.keep();
      cx.notify();
    }
    const on = machineOf(this.agent());
    if (!on) {
      if (!this.screenDue()) { this.front.rest(); return; }
      const woke = this.front.woke();
      if (this.readAt === 0) { this.read(cx); return; }
      if (woke) { this.probeLocal(cx); return; }
      this.armLocal(cx);
      return;
    }
    if (this.readAt === 0) { this.read(cx); return; }
    this.armCheck(cx);
  }

  screenDue() { return window()?.active !== false && !this.paneHidden(); }

  armWhen(cx, due, probe) {
    if (this.arm || !due) return;
    const file = this.transcript?.address === this.agent() ? this.transcript.file : null;
    if (!file) { this.poll = pollNext(this.poll, "same"); new ArmPoll(this).start(cx, (tick) => this.read(tick)); return; }
    new ArmPoll(this).start(cx, probe);
  }

  armLocal(cx) { this.armWhen(cx, this.screenDue(), (tick) => this.probeLocal(tick)); }

  probeLocal(cx) {
    const address = this.agent();
    const file = this.transcript?.address === address ? this.transcript.file : null;
    if (!this.screenDue()) return;
    if (!file) { this.read(cx); return; }
    cx.spawn(async (cx) => {
      const outcome = await this.take(address, () => localService(fileApi).stat(file), listFailure(new Error("timed out"), null));
      if (!outcome) return;
      if (outcome === "changed") this.read(cx);
      else { this.poll = pollNext(this.poll, outcome); this.armLocal(cx); if (outcome === "failed") cx.notify(); }
    });
  }

  async take(address, stat, failure) {
    const { outcome, next } = await takeStamp(stat, this.stamp);
    if (this.agent() !== address) return null;
    if (outcome === "seen") this.stamp = next;
    if (outcome === "changed") this.pendingStamp = next;
    if (outcome === "failed") {
      const view = staleView(this.items.length > 0 || Boolean(this.shown?.image || this.shown?.deferred), this.fresh, Date.now(), failure);
      if (view.keep) this.held = view.hold;
      else if (!this.note) this.note = { error: true, text: view.error };
    }
    return outcome;
  }

  paneHidden() {
    if (typeof layout !== "function") return false;
    return walkLayout(layout(), "panel-body")?.hidden === true;
  }

  // No screen read on a timer: one stat of the conversation, and a read only when it changed.
  armCheck(cx) {
    const on = machineOf(this.agent());
    this.armWhen(cx, Boolean(on) && remoteDue(on, window()?.active, this.paneHidden()), (tick) => this.probe(tick));
  }

  probe(cx) {
    const address = this.agent(), on = machineOf(address);
    const file = this.transcript?.address === address ? this.transcript.file : null;
    if (!file || !remoteDue(on, window()?.active, this.paneHidden())) return;
    cx.spawn(async (cx) => {
      const outcome = await this.take(address, async () => (await serviceOn(fileApi, on)).stat(file), copyFailure(new Error("timed out"), on));
      if (!outcome) return;
      if (outcome === "changed") this.read(cx);
      else { this.poll = pollNext(this.poll, outcome); this.armCheck(cx); }
      cx.notify();
    });
  }

  async recall(file) {
    try {
      const got = await this.db.pictures(file);
      return { file, size: got.size, mark: got.mark ?? "", paths: got.rows.map((r) => r.path), rows: got.rows };
    } catch { return null; }
  }

  read(cx) {
    const address = this.agent();
    if (this.reading || !address) return;
    this.reading = true; this.pullFailed = false;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", address, "--lines", String(LINES)]);
        const on = machineOf(address);
        const homeDir = await (async () => {
          if (!on) return home();
          if (this.homeOn === on && this.homeDir) return this.homeDir;
          try {
            const dir = await (await serviceOn(systemApi, on)).userHome();
            this.homeOn = on; this.homeDir = dir;
            return dir;
          } catch (e) { this.note = { error: true, text: copyFailure(e, on) }; this.pullFailed = true; return null; }
        })();
        if (homeDir == null) return;
        const before = this.transcript?.address === address ? this.transcript : null;
        const written = await transcriptPaths(address, homeDir, before, (file) => this.recall(file), on);
        if (address !== this.agent()) return;
        // Another program or conversation in the same terminal: what the last one made is not this one's.
        const other = (before?.front && written.front && before.front.pid !== written.front.pid) || (before?.file && written.file && before.file !== written.file);
        if (other && !this.asked.some((i) => i.path === this.selected?.path)) {
          this.items = []; this.picked = false; this.selected = null; this.shown = null; this.pins = [];
          this.kept = new Map([...this.kept].filter(([key]) => key.slice(0, address.length + 1) !== `${address}\n`));
          if (this.asking?.who === address) this.asking = null;
        }
        if (written.failed) { this.pullFailed = true; return; }
        // No record for a moment (an agent still starting): keep the conversation already read.
        if (!written.file && before?.file && !other) { this.transcript = before; return; }
        const screen = r.code === 0 ? r.stdout : "";
        const cwd = terminals().find((k) => k.address === address)?.cwd ?? null;
        const named = [...(written.paths ?? []), ...mentions(screen, MOST).toReversed()].map((m) => resolvePath(m, cwd, homeDir)).filter(Boolean);
        const resolved = [...new Set(named)];
        const there = resolved.length ? new Set(await (await serviceOn(fileApi, on)).existing(resolved)) : new Set();
        const pictures = resolved.filter((path) => there.has(path) && shows(itemOf(path)));
        const prior = (written.rows ?? []).map((row) => ({ ...row, color: row.color || this.colors.get(row.path) || null }));
        const rows = indexRows(prior, pictures, { replaced: Boolean(written.replaced) });
        if (written.file && written.size != null) {
          try { await this.db.savePictures(written.file, written.size, rows, written.mark ?? ""); } catch { /* the next read stores it */ }
        }
        const found = rows.toSorted((a, b) => b.ord - a.ord).map((row) => ({ ...itemOf(row.path), color: row.color || this.colors.get(row.path) || null })).filter((i) => !this.blind.has(i.path));
        if (address !== this.agent()) return;
        const fresh = arrived(found, this.items);
        const previous = this.list();
        this.items = found;
        this.asked = this.asked.filter((i) => !this.blind.has(i.path));
        this.transcript = {
          address, front: written.front, size: written.size, mark: written.mark ?? "", paths: written.paths, rows,
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
        this.kept = new Map([...this.kept].filter(([key]) => {
          const cut = key.indexOf("\n");
          const agent = cut < 0 ? "" : key.slice(0, cut);
          const path = cut < 0 ? key : key.slice(cut + 1);
          return agent !== address || live.has(path);
        }));
        if (!on) found.filter((i) => !i.color).forEach((i) => this.sample(i, written.file, cx));
        if (this.pendingStamp && this.selected && shows(this.selected)) this.draw(this.selected, cx);
      } catch { this.pullFailed = true; }
      finally {
        this.reading = false; this.readAt = Date.now();
        if (this.pullFailed) { this.pendingStamp = null; this.poll = pollNext(this.poll, "failed"); }
        else if (this.pendingStamp) { this.stamp = this.pendingStamp; this.pendingStamp = null; this.fresh = Date.now(); this.held = null; }
        else { this.fresh = Date.now(); this.held = null; }
        if (machineOf(this.agent())) this.armCheck(cx);
        cx.notify();
      }
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

  // Unsent pins stay on the picture they were dropped on, for the agent in focus then, until Send.
  pinKey(path, who = this.agent()) { return who ? `${who}\n${path}` : path; }

  hold() {
    const path = this.selected?.path;
    if (!path) return;
    const key = this.pinKey(path);
    if (this.pins.length) this.kept.set(key, this.pins.map((p) => ({ ...p })));
    else this.kept.delete(key);
  }

  select(item, cx, picked) {
    this.picked = this.picked || picked;
    if (this.selected?.path === item.path) return;
    this.hold();
    this.selected = item;
    this.pins = (this.kept.get(this.pinKey(item.path)) ?? []).map((p) => ({ ...p }));
    this.shown = null; this.watching = null;
    if (shows(item)) { this.draw(item, cx); this.watch(item, cx); }
    cx.notify();
  }

  // image() draws only from the app's folder, so each picture is a copy there, under a new name each time
  // so a changed file is never an old picture kept by the image cache.
  // A file's draws run one after another (each clears that file's older copies first, so two at once could
  // delete the one shown); one waiting is already the newest, so no other joins it. Only the last lands,
  // and one whose file you left before it started does nothing.
  draw(item, cx, ask = false) {
    const path = item.path;
    const kept = this.shown?.path === path && this.shown?.deferred ? this.shown : null;
    if (this.selected?.path === path && !kept) this.shown = { path, busy: true };
    if (this.waiting.has(path)) return;
    this.waiting.add(path);
    const done = (this.chains.get(path) ?? Promise.resolve())
      .then(() => { this.waiting.delete(path); return this.selected?.path === path ? this.copy(item, ask) : null; })
      .catch(() => null);
    this.chains.set(path, done); this.draws.set(path, done);
    cx.spawn(async (cx) => {
      const made = await done;
      if (this.chains.get(path) === done) this.chains.delete(path);
      const last = this.draws.get(path) === done;
      if (last) this.draws.delete(path);
      if (!last || this.selected?.path !== path) { cx.notify(); return; }
      if (made?.deferred) { this.shown = { path, deferred: true, size: made.size }; cx.notify(); return; }
      if (made?.error) { this.note = { error: true, text: made.error }; this.shown = kept; cx.notify(); return; }
      if (!made) {
        const previous = this.list();
        const at = previous.findIndex((i) => i.path === path);
        this.dropBlind(path);
        this.selected = null; this.shown = null; this.pins = [];
        const still = (i) => this.list().some((k) => k.path === i.path);
        const next = previous.slice(at + 1).find(still) ?? previous.slice(0, Math.max(at, 0)).toReversed().find(still) ?? null;
        if (next) this.select(this.list().find((i) => i.path === next.path), cx, false);
        cx.notify();
        return;
      }
      this.shown = { path, ...made };
      if (machineOf(this.agent())) this.sample(item, this.transcript?.file, cx);
      cx.notify();
    });
  }

  // Hidden this session. The row stays, so the next open tries the file again.
  dropBlind(path) {
    this.blind.add(path);
    this.items = this.items.filter((i) => i.path !== path);
    this.asked = this.asked.filter((i) => i.path !== path);
    this.kept.delete(this.pinKey(path));
  }

  // The copy image() draws: { image, picture } (the file the pins are on), or null.
  // sips exits 0 and prints pixelWidth <nil> when a raster is not a picture. A valid svg is the tag.
  async copy(item, ask = false) {
    const on = machineOf(this.agent());
    const ext = item.path.split(".").at(-1).toLowerCase();
    const source = await (async () => {
      if (!on) return item.path;
      try {
        const got = await bring(item.path, on, { ask });
        if (got.deferred) return { deferred: true, size: got.size };
        return got.path;
      } catch (e) { return { error: copyFailure(e, on) }; }
    })();
    if (source?.deferred || source?.error) return source;
    const seen = await (await serviceOn(imageApi, on)).probe(item.path, item.kind, ext);
    if (!seen) return null;
    const key = keyOf(item.path), dir = paths.join(appHome(), DIR);
    const name = `${key}-${Date.now()}.${item.kind === "image" ? ext : "png"}`, out = paths.join(dir, name);
    await localService(imageApi).fresh(dir, key);
    const made = item.kind === "image" ? (await localService(fileApi).copy(source, out)).code === 0 : await toPng(source, out);
    if (made) await sweepLook(dir, key, name);
    return made ? { image: `${DIR}/${name}`, picture: item.kind === "image" ? item.path : out } : null;
  }

  sample(item, file, cx) {
    if (!item || item.color || this.sampling.has(item.path)) return;
    this.sampling.add(item.path);
    cx.spawn(async (cx) => {
      try {
        const r = await (await serviceOn(imageApi, machineOf(this.agent()))).color(item.path).catch(() => null);
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
    if (machineOf(this.agent())) return;
    const dir = paths.dirname(item.path);
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
    this.asking = { id: p.id, token, path: this.selected.path, who: this.agent() }; this.note = null;
    openOverlay({ mod: "kanso-prompt", kind: "dialog", width: 420, props: {
      title: `Pin ${index + 1}`, field: "What about this spot?", value: p.note ?? "", button: p.note ? "Save" : "Add", shared: NOTE, token } });
    cx.notify();
  }

  // The dialog's answer, read when the shared value changes: the note goes on its pin; cancelled, a new pin goes.
  answer() {
    const box = shared(NOTE), token = this.asking?.token, a = token ? box?.[token] : null;
    if (!a) return;
    const { id, path, who } = this.asking; this.asking = null;
    // Taken: out of the box, with whatever was left there over an hour ago (a dialog nobody read, another window's).
    setShared(NOTE, Object.fromEntries(Object.entries(box).filter(([k, v]) => k !== token && (v?.at ?? 0) > Date.now() - 3600000)));
    const key = this.pinKey(path, who);
    const here = path === this.selected?.path && (who ?? null) === (this.agent() ?? null);
    const pins = here ? this.pins : (this.kept.get(key) ?? []);
    const next = a.text ? pins.map((p) => (p.id === id ? { ...p, note: a.text } : p)) : pins.filter((p) => p.id !== id || p.note);
    if (here) this.pins = next;
    else if (next.length) this.kept.set(key, next);
    else this.kept.delete(key);
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
    const key = this.pinKey(item.path, address);
    if (!address) { this.note = { error: true, text: "No agent to send to" }; cx.notify(); return; }
    const { name, status } = this.who(address);
    if (status === "blocked") { this.note = { error: true, text: waitingNote([name]) }; cx.notify(); return; }
    const picture = this.shown?.path === item.path ? this.shown.picture : undefined;
    this.sending = true; cx.notify();
    cx.spawn(async (cx) => {
      const r = await deliver(address, aboutMessage(item, pins, picture), "you");
      this.sending = false;
      if (r.code === 0) {
        this.kept.delete(key);
        if (this.selected?.path === item.path && this.agent() === address) this.pins = [];
        if (this.asking?.path === item.path && this.asking?.who === address) this.asking = null;
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
      .child(div().flex_none().size(G.lg).rounded_full().bg(p.note ? c.accent : c.border).flex().items_center().justify_center().text_size(9.5).font_bold().text_color(c.canvas).child(String(i + 1)))
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
      .flex().items_center().justify_center().text_size(9.5).font_bold().text_color(c.canvas).child(String(i + 1));
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

  drawing(c) {
    const { block } = skeleton(c);
    return breathe(v_flex().id("kanso-skeleton").flex_1().w_full().items_center().justify_center()).child(block(240, 180, 8));
  }

  bones(c) {
    const { header } = skeleton(c);
    return v_flex().size_full().min_h(0).bg(c.canvas).text_color(c.text)
      .child(h_flex().flex_none().px(G.lg).py(G.sm).gap(G.sm).items_center().border_b(1).border_color(c.border)
        .child(header(72, 13)))
      .child(this.drawing(c));
  }

  view(c) {
    if (!this.selected) return this.empty(c);
    if (this.shown?.image) return this.picture(c);
    if (this.shown?.deferred) return v_flex().id("look-hold").flex_1().w_full().items_center().justify_center().gap(G.md)
      .child(div().font_semibold().text_size(T.card).child(this.selected.name))
      .child(div().text_size(T.body).text_color(c.dim).child(bytesLabel(this.shown.size)))
      .child(quietLink("look-load", "Load", (cx) => this.draw(this.selected, cx, true), c));
    if (this.shown?.busy) return this.drawing(c);
    return div();
  }

  render(cx) {
    if (!machineOf(this.agent())) this.front?.wake(cx, (wakeCx) => this.tick(wakeCx));
    const c = tokens(theme()), item = this.selected, address = this.agent();
    const who = address ? this.who(address) : null;
    const list = this.list();
    this.answer();
    const machine = machineOf(address);
    const drawn = item ? drawablePath(machine, this.shown?.image, item.path) : null;
    const ready = Boolean(item && address && noted(this.pins).length) && !this.sending;
    const status = this.note?.text ?? (this.pins.length ? "" : item ? "Pin a spot" : "");
    return v_flex().id("kanso-look").track_focus(this.handle).size_full().min_h(0).bg(c.canvas).text_color(c.text)
      .on_key_down((e, cx) => { if (sendKey(e)) { this.send(cx); cx.stop_propagation(); } })
      .child(h_flex().flex_none().px(G.lg).py(G.sm).gap(G.sm).items_center().border_b(1).border_color(c.border)
        .child(programIcon(who?.pane?.program, 15, c.muted) ?? div())
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_semibold().text_size(T.card).child(who?.name ?? "Images"))
          .child(div().truncate().text_size(10.5).text_color(c.dim).child([who ? tilde(terminals().find((k) => k.address === address)?.cwd ?? "") : "", this.held ? asOf(this.held.at, Date.now()) : ""].filter(Boolean).join(" · "))))
        .when(Boolean(address), (el) => el.child(iconButton("look-pin", "pin", this.pinned ? "Follow the pane in focus" : "Stay on this agent",
          (cx) => { this.pinned = this.pinned ? null : address; this.keep(); cx.notify(); }, c, { active: Boolean(this.pinned) })))
        .child(iconButton("look-refresh", "refresh", this.held ? "Retry" : "Read again", (cx) => { this.poll = pollStart(); this.arm = null; this.read(cx); if (item && shows(item) && !this.shown?.deferred) this.draw(item, cx); }, c, { spin: this.reading })))
      .child(v_flex().id("look-view").flex_1().min_h(0).w_full().overflow_hidden().items_center().justify_center().child(this.view(c)))
      .when(list.length > 0, (el) => el.child(this.dots(list, c)))
      .when(this.pins.length > 0, (el) => el.child(v_flex().id("look-notes").flex_none().max_h(H.compact * 5 + G.xs * 4).px(G.lg).py(G.sm).gap(G.xs).overflow_y_scrollbar().border_t(1).border_color(c.border)
        .children(this.pins.map((p, i) => this.noteRow(p, i, c)))))
      .when(Boolean(item), (el) => el.child(h_flex().id("look-bar").flex_none().h(H.control).px(G.lg).gap(G.md).items_center().border_t(1).border_color(c.border)
        .child(div().flex_1().min_w(0).truncate().text_size(T.body).text_color(c.dim).child(tilde(item.path)))
        .when(Boolean(status), (bar) => bar.child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(this.note?.error ? c.red : c.dim).child(status)))
        .child(button("look-send", this.sending ? "Sending…" : noted(this.pins).length > 1 ? `Send ${noted(this.pins).length}  ⌘↩` : "Send  ⌘↩", (cx) => this.send(cx), c, { small: true, disabled: !ready }))
        .when(Boolean(drawn), (bar) => bar.child(quietLink("look-open", "Open", () => openPath(machine ? paths.join(appHome(), drawn) : drawn), c)))
        .when(this.pins.length > 0, (bar) => bar.child(quietLink("look-unpin", this.pins.length === 1 ? "Clear the pin" : `Clear ${this.pins.length} pins`, (cx) => { this.pins = []; this.kept.delete(this.pinKey(item.path)); this.asking = null; cx.notify(); }, c)))));
  }
}

import { div, image } from "gpui-kit";
import { v_flex, h_flex, Editor } from "gpui-base";
import { readTextFile, watchFolder, theme, openOverlay, window, layout, appHome, nextCommand } from "herdr";
import { commandLoop } from "./sidebar.js";
import { localService, serviceOn } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
import { imageApi } from "./platform-images.js";
import { codeState, isMarkdown, showPanel } from "./lib.js";
import { kindOf } from "./kinds.js";
import { MarkdownDoc, tildePath, readingLines, conflictBar, textIo, readWhole } from "./doc.js";
import { drafts, draftKey, remember, restore, seenDisk, typed, opened, beginSave, commitText, applied, word, needsSave, didFail, EDIT_LIMIT, keepMine, takeTheirs, tooLarge } from "./edit.js";
import { skeleton, quietLink, iconButton, tokens, Armed } from "./ui.js";
import { tryOrAsync, extOf } from "./pure.js";
import { fileMemory } from "./panel-state.js";
import { walkLayout } from "./layout.js";
import { bring, appRelative, svgPixels, copyFailure, quietError, remoteDue, fileId, ArmPoll, pollStart, pollNext, takeStamp, staleView, asOf, bytesLabel } from "./remote-file.js";

const folderOf = (path) => path.replace(/[\\/][^\\/]*$/, "") || "/";
const nameOf = (path) => path.split(/[\\/]/).at(-1);
const PREVIEW_DIR = "data/kanso-panel/preview";
// The panels that send a file here, and get it back.
const BACK = { files: "Back to Files", look: "Back to Look" };
export const previewKind = (path) => isMarkdown(path) ? "markdown" : kindOf(path) === "image" ? "picture" : "text";

class PreviewKeys {
  constructor() { this.view = null; this.cx = null; this.live = false; }

  bind(view, cx) {
    this.view = view;
    this.cx = cx;
    if (this.live) return;
    this.live = true;
    cx.spawn((commandCx) => commandLoop(
      () => nextCommand(),
      () => {
        if (!this.view) throw new Error("gone");
        this.cx.notify();
      },
      (command) => {
        if (this.view && String(command).replace(/^kanso-panel\./, "") === "save") this.view.save(this.cx);
      },
      commandCx.timer,
    ).finally(() => { this.live = false; }));
  }

  unbind(view) {
    if (this.view === view) { this.view = null; this.cx = null; }
  }
}

const previewKeys = new PreviewKeys();

export class Preview {
  init(cx, p) {
    const kept = this.kept;
    this.kept = null;
    this.on = p.on ?? kept?.on ?? null;
    this.back = BACK[p.back] ? p.back : (kept?.back && BACK[kept.back] ? kept.back : null);
    this.handle = cx.focus_handle();
    this.poll = pollStart(); this.stamp = null; this.fresh = null; this.held = null; this.arm = null;
    this.ask = new Armed(); this.edit = null;
    previewKeys.bind(this, cx);
    this.open(p.path || kept?.path || "", cx);
  }

  saveState() {
    if (!this.path) return null;
    return { path: this.path, back: this.back, on: this.on };
  }

  // A file that is gone leaves the preview empty, with no error.
  async restoreState(state) {
    const path = typeof state?.path === "string" ? state.path : "";
    if (!path) return false;
    if (previewKind(path) === "picture") {
      const ok = await (await serviceOn(fileApi, state.on ?? null)).test(path).catch(() => false);
      const next = ok ? fileMemory(state, () => true) : null;
      if (!next) return false;
      this.kept = next;
      return true;
    }
    const text = await tryOrAsync(() => readTextFile(path, { on: state.on ?? null }));
    if (text == null || String(text).includes("\0")) return false;
    const next = fileMemory(state, () => true);
    if (!next) return false;
    this.kept = next;
    return true;
  }

  open(path, cx) {
    this.stash();
    this.path = path;
    this.doc?.release(); this.doc = null;
    this.code?.release(); this.code = null; this.edit = null; this.error = null; this.picture = null; this.pixels = null;
    this.stamp = null; this.fresh = null; this.held = null; this.poll = pollStart(); this.arm = null; this.ask?.clear();
    if (!path) { cx.notify(); return; }
    if (previewKind(path) === "markdown") this.doc = new MarkdownDoc(path, this.on, (to) => this.follow(to, cx));
    else if (previewKind(path) === "picture") this.picture = { busy: true };
    this.load(cx);
    this.watch(cx);
    if (this.on) new ArmPoll(this).start(cx, (tick) => this.probe(tick));
    cx.notify();
  }

  follow(to, cx) {
    if (!isMarkdown(to)) { openOverlay({ mod: "open-with", kind: "popup", width: 340, props: { file: to, folder: folderOf(to), machine: this.on } }); return; }
    this.leave(cx, (cx) => this.open(to, cx));
  }

  stash() {
    if (this.doc) this.doc.remember();
    else if (this.path && this.edit) remember(drafts, draftKey(this.path, this.on), this.edit);
  }

  // A draft stays in this session when the write cannot finish, and the panel moves on.
  leave(cx, then) {
    this.stash();
    const doc = this.doc;
    if (doc) { cx.spawn(async (cx) => { await doc.flush(); then(cx); }); return; }
    if (!needsSave(this.edit)) { then(cx); return; }
    cx.spawn(async (cx) => { await this.flushCode(); then(cx); });
  }

  save(cx) {
    if (this.doc) { this.doc.save(cx); return; }
    this.saveCode(cx);
  }

  armCode() {
    const saving = beginSave(this.edit);
    if (!saving) return null;
    this.edit = saving;
    return saving;
  }

  saveCode(cx) {
    const saving = this.armCode();
    if (!saving) return;
    cx.notify();
    cx.spawn(async (cx) => { await this.finishCode(saving); cx.notify(); });
  }

  async flushCode() {
    const saving = this.armCode();
    if (!saving) return;
    await this.finishCode(saving);
  }

  async finishCode(saving) {
    const path = this.path, on = this.on;
    const outcome = await commitText(saving, textIo(path, on));
    const latest = this.path === path && this.edit ? this.edit : saving;
    const next = applied(latest, outcome.written, outcome.result);
    if (this.path === path) this.edit = next;
    remember(drafts, draftKey(path, on), next);
  }

  reread(cx) {
    const dirty = this.doc ? (this.doc.dirty || this.doc.conflict) : needsSave(this.edit) || this.edit?.phase === "conflict";
    if (!dirty) { this.load(cx); return; }
    this.ask.press(this.path, cx, (cx) => this.discard(cx));
  }

  discard(cx) {
    if (this.doc) this.doc.dropDraft();
    else if (this.path) {
      drafts.drop(draftKey(this.path, this.on));
      if (this.edit?.saved != null) this.edit = opened(this.edit.saved);
    }
    this.load(cx);
  }

  keepCode(cx) {
    this.edit = keepMine(this.edit);
    this.saveCode(cx);
  }

  takeCode(cx) {
    this.edit = takeTheirs(this.edit);
    if (this.code) this.code.set_value(this.edit.text ?? "");
    remember(drafts, draftKey(this.path, this.on), this.edit);
    cx.notify();
  }

  load(cx) {
    if (this.doc) { this.doc.load(cx); return; }
    if (this.picture || previewKind(this.path) === "picture") { this.loadPicture(cx); return; }
    const path = this.path, on = this.on;
    cx.spawn(async (cx) => {
      try {
        const got = await readWhole(path, on);
        if (this.path !== path) return;
        if (got.big) {
          if (this.code) this.code.release();
          this.code = null; this.edit = tooLarge(); this.error = null; this.held = null;
          return;
        }
        const text = got.text;
        if (text === null || text === undefined) this.keepUnreadable(path, on, "This file is no longer available");
        else if (String(text).includes("\0")) {
          if (this.code) this.code.release();
          this.code = null; this.edit = null;
          this.miss(on, "Binary file: no text preview");
        } else { this.error = null; this.held = null; this.fresh = Date.now(); this.placeText(path, text); }
      } catch (e) {
        if (this.path !== path) return;
        const note = on ? copyFailure(e, on) : (quietError(e) ? "This computer did not answer" : `Cannot read this file: ${e?.message ?? e}`);
        this.keepUnreadable(path, on, note);
      }
      finally { cx.notify(); }
    });
  }

  heldDraft(path, on) {
    if (this.edit?.text != null) return this.edit;
    const stored = drafts.peek(draftKey(path, on));
    return stored ? restore(stored) : null;
  }

  keepUnreadable(path, on, note) {
    const held = this.heldDraft(path, on);
    if (!held || held.text == null || held.text === held.saved) { this.miss(on, note); return; }
    this.error = null;
    this.edit = didFail(held, note);
    this.showCode(path, this.edit);
  }

  placeText(path, text) {
    const base = this.heldDraft(path, this.on);
    const next = base ? seenDisk(base, text) : opened(text);
    this.edit = next;
    remember(drafts, draftKey(path, this.on), next);
    this.showCode(path, next);
  }

  showCode(path, state) {
    const shown = this.code ? this.code.value() : null;
    if (!state.big && shown === state.text) return;
    if (this.code) this.code.release();
    this.code = codeState(path, state.text ?? "", {
      readonly: Boolean(state.big), limit: EDIT_LIMIT,
      onChange: state.big ? null : (value, cx) => {
        this.edit = typed(this.edit, value);
        remember(drafts, draftKey(this.path, this.on), this.edit);
        cx.notify();
      },
    });
  }

  miss(on, error) {
    const view = on ? staleView(Boolean(this.code), this.fresh, Date.now(), error) : null;
    if (view?.keep) { this.held = view.hold; return; }
    this.error = error;
  }

  loadPicture(cx, ask = false) {
    const path = this.path, on = this.on;
    const kept = this.picture?.image || this.picture?.deferred ? this.picture : null;
    if (!kept) this.picture = { busy: true };
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        const got = on ? await bring(path, on, { ask }) : { path: await this.stage(path) };
        if (this.path !== path) return;
        if (got.deferred) {
          this.picture = { deferred: true, size: got.size };
          this.pixels = null; this.error = null; this.held = null; this.fresh = Date.now();
          if (got.mtime != null) this.stamp = { size: got.size, mtime: got.mtime };
          return;
        }
        const rel = appRelative(got.path, appHome());
        if (!rel) throw new Error("Cannot read this file");
        const pixels = extOf(path) === "svg" ? svgPixels(await readTextFile(got.path)) : await localService(imageApi).pixels(got.path).catch(() => null);
        if (this.path !== path) return;
        this.picture = { image: rel }; this.pixels = pixels; this.error = null; this.held = null; this.fresh = Date.now();
        if (got.mtime != null) this.stamp = { size: got.size, mtime: got.mtime };
      } catch (e) {
        if (this.path !== path) return;
        const view = on ? staleView(Boolean(kept?.image || kept?.deferred), this.fresh, Date.now(), copyFailure(e, on)) : null;
        if (view?.keep) { this.picture = kept; this.held = view.hold; }
        else { this.picture = null; this.error = on ? copyFailure(e, on) : `Cannot read this file: ${e?.message ?? e}`; }
      } finally { cx.notify(); }
    });
  }

  probe(cx) {
    const path = this.path, on = this.on;
    if (!path || !remoteDue(on, window()?.active, walkLayout(layout(), "panel-body")?.hidden)) return;
    cx.spawn(async (cx) => {
      const { outcome, next } = await takeStamp(async () => (await serviceOn(fileApi, on)).stat(path), this.stamp);
      if (this.path !== path) return;
      if (outcome === "seen") this.stamp = next;
      if (outcome === "changed") { this.stamp = next; this.load(cx); }
      if (outcome === "failed") {
        const had = Boolean(this.code || this.picture?.image || this.picture?.deferred || this.doc?.saved != null);
        const view = staleView(had, this.fresh ?? this.doc?.fresh, Date.now(), copyFailure(new Error("timed out"), on));
        if (view.keep) this.held = view.hold;
        else if (!this.error) this.error = view.error;
      }
      this.poll = pollNext(this.poll, outcome);
      new ArmPoll(this).start(cx, (tick) => this.probe(tick));
      cx.notify();
    });
  }

  async stage(file) {
    const dir = paths.join(appHome(), PREVIEW_DIR);
    const id = fileId("here", file);
    await localService(imageApi).fresh(dir, id);
    const out = paths.join(dir, `${id}-${Date.now()}.${extOf(file) || "img"}`);
    const made = await localService(fileApi).copy(file, out);
    if (made.code !== 0) throw new Error(made.stderr || "Cannot read this file");
    return out;
  }

  // Watched via the folder (this computer only): any change there re-reads the file.
  watch(cx) {
    if (this.on) return;
    const path = this.path, dir = folderOf(path);
    cx.spawn(async (cx) => {
      try { while (this.path === path) { await watchFolder(dir); if (this.path === path) this.load(cx); } } catch {}
    });
  }

  openWith() {
    openOverlay({ mod: "open-with", kind: "popup", width: 340, props: { file: this.path, folder: folderOf(this.path), machine: this.on } });
  }

  goBack(cx) {
    this.leave(cx, () => { previewKeys.unbind(this); showPanel(this.back, { mod: "kanso-panel", props: { panel: this.back } }); });
  }

  bones(c) {
    const { header } = skeleton(c);
    return v_flex().size_full().min_h(0).bg(c.canvas).text_color(c.text)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(c.border)
        .child(header(120, 13)))
      .child(readingLines(c));
  }

  render(cx) {
    if (this.on && this.path && !this.arm && remoteDue(this.on, window()?.active, walkLayout(layout(), "panel-body")?.hidden)) new ArmPoll(this).start(cx, (tick) => this.probe(tick));
    const t = theme(), c = tokens(t);
    const editing = this.doc ? this.doc.snapshot() : this.edit;
    const mark = this.doc ? "" : word(this.edit);
    const armed = Boolean(this.ask?.is(this.path));
    return v_flex().id("preview").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => { this.doc?.key(e, cx); })
      .child(h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.back), (el) => el.child(iconButton("preview-back", "chevron-left", BACK[this.back], (cx) => this.goBack(cx), c)))
        .child(v_flex().flex_1().min_w(0).pl(this.back ? 0 : 4)
          .child(div().truncate().font_semibold().text_size(13).child(nameOf(this.path)))
          .child(div().truncate().text_size(11).text_color(t.dim).child(`${tildePath(folderOf(this.path), this.on)}${this.pixels ? ` · ${this.pixels.width} × ${this.pixels.height}` : ""}${(this.held ?? this.doc?.held) ? ` · ${asOf((this.held ?? this.doc.held).at, Date.now())}` : ""}`)))
        .children(this.doc ? this.doc.controls(t, "preview") : [])
        .when(Boolean(mark), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(mark)))
        .when(needsSave(editing), (el) => el.child(quietLink("preview-save", "Save", (cx) => this.save(cx), c)))
        .child(iconButton("preview-open-with", "open-with", "Open with…", () => this.openWith(), c))
        .when(armed, (el) => el.child(quietLink("preview-discard", "Press again to discard", (cx) => this.reread(cx), c)))
        .when(!armed, (el) => el.child(iconButton("preview-refresh", "refresh", this.held || this.doc?.held ? "Retry" : "Read again", (cx) => this.reread(cx), c)))
        .child(iconButton("preview-close", "close", "Close", (cx) => this.leave(cx, () => { previewKeys.unbind(this); showPanel(null); }), c)))
      .child(this.doc ? this.doc.body(t, "preview-md")
        : this.edit?.big ? div().p(12).text_color(t.dim).child("Too large to edit")
        : this.code ? v_flex().flex_1().min_h(0)
          .when(this.edit?.phase === "conflict", (el) => el.child(conflictBar("preview-code", t, (cx) => this.keepCode(cx), (cx) => this.takeCode(cx))))
          .child(Editor.new(this.code).flex_1().min_h(0))
        : this.error ? div().p(12).text_color(t.dim).child(this.error)
        : this.picture?.deferred ? v_flex().id("preview-hold").flex_1().min_h(0).items_center().justify_center().gap(8)
          .child(div().font_semibold().child(nameOf(this.path)))
          .child(div().text_size(12).text_color(t.dim).child(bytesLabel(this.picture.size)))
          .child(quietLink("preview-load", "Load", (cx) => this.loadPicture(cx, true), c))
        : this.picture?.image ? v_flex().id("preview-picture").flex_1().min_h(0).p(16).items_center().justify_center().child(image(this.picture.image).w_full())
        : this.path ? readingLines(t) : div().flex_1());
  }
}

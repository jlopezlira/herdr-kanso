import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor } from "gpui-base";
import { readTextFile, watchFolder, theme, openOverlay } from "herdr";
import { codeState, isMarkdown, showPanel } from "./lib.js";
import { MarkdownDoc, tildePath, readingLines } from "./doc.js";
import { skeleton } from "./ui.js";
import { tryOrAsync } from "./pure.js";
import { fileMemory } from "./panel-state.js";

const folderOf = (path) => path.replace(/[\\/][^\\/]*$/, "") || "/";
const nameOf = (path) => path.split(/[\\/]/).at(-1);
// The panels that send a file here, and get it back.
const BACK = { files: "Back to Files", look: "Back to Look" };

export class Preview {
  init(cx, p) {
    const kept = this.kept;
    this.kept = null;
    this.on = p.on ?? kept?.on ?? null;
    this.back = BACK[p.back] ? p.back : (kept?.back && BACK[kept.back] ? kept.back : null);
    this.handle = cx.focus_handle();
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
    const text = await tryOrAsync(() => readTextFile(path, { on: state.on ?? null }));
    if (text == null || String(text).includes("\0")) return false;
    const next = fileMemory(state, () => true);
    if (!next) return false;
    this.kept = next;
    return true;
  }

  open(path, cx) {
    this.path = path;
    this.doc?.release(); this.doc = null;
    this.code?.release(); this.code = null; this.error = null;
    if (!path) { cx.notify(); return; }
    if (isMarkdown(path)) this.doc = new MarkdownDoc(path, this.on, (to) => this.follow(to, cx));
    this.load(cx);
    this.watch(cx);
    cx.notify();
  }

  follow(to, cx) {
    if (!isMarkdown(to)) { openOverlay({ mod: "open-with", kind: "popup", width: 340, props: { file: to, folder: folderOf(to), machine: this.on } }); return; }
    this.leave(cx, (cx) => this.open(to, cx));
  }

  // What you typed is saved before the panel shows another file or closes.
  leave(cx, then) {
    const doc = this.doc;
    if (!doc) { then(cx); return; }
    cx.spawn(async (cx) => { if (await doc.flush()) then(cx); else cx.notify(); });
  }

  load(cx) {
    if (this.doc) { this.doc.load(cx); return; }
    const path = this.path;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(path, { on: this.on });
        if (this.path !== path) return;
        if (text === null) this.error = "This file is no longer available";
        else if (text.includes("\0")) this.error = "Binary file: no text preview";
        else { this.error = null; this.code?.release(); this.code = codeState(path, text); }
      } catch (e) { this.error = `Cannot read this file: ${e?.message ?? e}`; }
      finally { cx.notify(); }
    });
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
    this.leave(cx, () => showPanel(this.back, { mod: "kanso-panel", props: { panel: this.back } }));
  }

  bones(c) {
    const { header } = skeleton(c);
    return v_flex().size_full().min_h(0).bg(c.canvas).text_color(c.text)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(c.border)
        .child(header(120, 13)))
      .child(readingLines(c));
  }

  render() {
    const t = theme();
    const button = (id, icon, tip, action) => div().id(id).p(4).rounded(6).cursor_pointer().text_color(t.muted).tooltip(tip)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { action(cx); })
      .child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(14));
    return v_flex().id("preview").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => this.doc?.key(e, cx))
      .child(h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.back), (el) => el.child(button("preview-back", "chevron-left", BACK[this.back], (cx) => this.goBack(cx))))
        .child(v_flex().flex_1().min_w(0).pl(this.back ? 0 : 4)
          .child(div().truncate().font_semibold().text_size(13).child(nameOf(this.path)))
          .child(div().truncate().text_size(11).text_color(t.dim).child(tildePath(folderOf(this.path), this.on))))
        .children(this.doc ? this.doc.controls(t, "preview") : [])
        .child(button("preview-open-with", "open-with", "Open with…", () => this.openWith()))
        .when(!this.doc?.editing, (el) => el.child(button("preview-refresh", "refresh", "Read again", (cx) => this.load(cx))))
        .child(button("preview-close", "close", "Close", (cx) => this.leave(cx, () => showPanel(null)))))
      .child(this.doc ? this.doc.body(t, "preview-md")
        : this.error ? div().p(12).text_color(t.dim).child(this.error)
        : this.code ? Editor.new(this.code).flex_1().min_h(0)
        : this.path ? readingLines(t) : div().flex_1());
  }
}

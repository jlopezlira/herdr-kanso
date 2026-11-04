// One file in the side panel. Markdown is shown formatted and edited in
// place (doc.js); anything else is read-only code. A click on a
// Markdown file in Files opens it here (with a way back to Files), and "Open
// with" offers it for text files, in place of an external editor. The file is
// read again when its folder changes (an agent writing a doc shows up as it
// writes). Props: { path, on } (the machine, null here), back ("files").
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor } from "gpui-base";
import { readTextFile, watchFolder, theme, openOverlay } from "herdr";
import { codeState, isMarkdown, showPanel } from "./lib.js";
import { MarkdownDoc, tildePath } from "./doc.js";

const folderOf = (path) => path.replace(/[\\/][^\\/]*$/, "") || "/";
const nameOf = (path) => path.split(/[\\/]/).pop();

export class Preview {
  init(cx, p) {
    this.on = p.on ?? null;
    this.back = p.back === "files" ? "files" : null;
    this.handle = cx.focus_handle();
    this.open(p.path ?? "", cx);
  }

  open(path, cx) {
    this.path = path;
    this.doc?.release(); this.doc = null;
    this.code?.release(); this.code = null; this.error = null;
    if (isMarkdown(path)) this.doc = new MarkdownDoc(path, this.on, (to) => this.follow(to, cx));
    this.load(cx);
    this.watch(cx);
    cx.notify();
  }

  // A link in the document to another Markdown file opens it here; one to
  // any other file is offered to "Open with".
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

  // Watch the file's folder (this computer only) and read the file again on
  // every change there. Opening another file starts a new watch.
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
    this.leave(cx, () => showPanel("files", { mod: "kanso-panel", props: { panel: "files" } }));
  }

  render() {
    const t = theme();
    const button = (id, icon, tip, action) => div().id(id).p(4).rounded(6).cursor_pointer().text_color(t.muted).tooltip(tip)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { action(cx); })
      .child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(14));
    return v_flex().id("preview").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => this.doc?.key(e, cx))
      .child(h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.back), (el) => el.child(button("preview-back", "chevron-left", "Back to Files", (cx) => this.goBack(cx))))
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
        : div().p(12).text_color(t.dim).child("Reading…"));
  }
}

import { serviceOn } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
// Derived from the `files` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: root no longer draws its own rounded, bordered card.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-files.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-files; one of the kanso-panel mod's panels.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, v_virtual_list, Scrollbar } from "gpui-base";
import { exec, readTextFile, watchFolder, theme, openOverlay, shared, setShared, window, layout } from "herdr";
import { location, key, codeState, markdownView, isMarkdown, insideRoot, showPanel } from "./lib.js";
import { kindOf } from "./kinds.js";
import { walkLayout } from "./layout.js";
import { listFailure, remoteDue } from "./remote-file.js";
import { mapSeries } from "./pure.js";
import { filesMemory } from "./panel-state.js";
import { readingLines } from "./doc.js";
import { skeleton, breathe } from "./ui.js";

const PER_FOLDER = 500, TOTAL = 5000;
const RETURN = "kanso.files.return";

async function directory(path, on) {
  return (await serviceOn(fileApi, on)).directory(path);
}

export class Files {
  constructor() { this.rev = 0; } // bumped whenever the rows would differ; the tree is rebuilt only then

  init(cx) {
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    // Returning from the preview: the folders that were open, for the same place.
    const back = shared(RETURN);
    if (back) {
      setShared(RETURN, null);
      if (back.context === key()) { this.context = back.context; ({ cwd: this.root, on: this.on } = location()); this.folders = new Set(back.folders ?? []); }
    }
    this.refresh(cx);
    cx.timer.every(10000, (cx) => { if (!this.on) this.refresh(cx); });
    cx.timer.every(5000, (cx) => { if (remoteDue(this.on, window()?.active, walkLayout(layout(), "panel-body")?.hidden)) this.refresh(cx); });
  }

  saveState() {
    if (!this.root) return undefined;
    return { cwd: this.root, folders: [...this.folders], file: this.file ?? null };
  }

  restoreState(state) {
    this.kept = state;
    return Boolean(state?.cwd);
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async cx => {
      try { while (this.watched === root) { await watchFolder(root); if (this.watched === root) this.later(cx); } }
      catch { if (this.watched === root) this.watched = null; }
    });
  }

  // A save storm wakes the watch once per file. Fold that into one refresh.
  later(cx) {
    this.queued = true;
    if (this.armed) return;
    this.armed = cx.timer.after(400, (cx) => {
      this.armed = null;
      if (!this.queued) return;
      if (this.loading) { this.later(cx); return; }
      this.queued = false;
      this.refresh(cx);
    });
  }

  async loadFolder(path, context) {
    if (path && !insideRoot(path)) return;
    const on = this.on, root = this.root;
    const entries = await directory(path ? paths.join(root, path) : root, on);
    if (key() !== context || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    const kept = entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).toSorted((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    this.entries = new Map([...this.entries, [path, kept]]);
    this.rev = this.rev + 1;
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    if (this.loading) { this.later(cx); return; }
    const { cwd, on } = location(), context = key();
    // No folder yet: keep the remembered tree until the place is known.
    if (!cwd && this.kept) return;
    if (context !== this.context) {
      const mem = filesMemory(this.kept, cwd, () => true);
      this.kept = null;
      this.context = context; this.root = cwd; this.on = on; this.entries = new Map();
      this.folders = new Set(mem?.folders ?? []);
      this.pendingFile = mem?.file ?? null;
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.rev = this.rev + 1;
    }
    if (!cwd) return;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        await mapSeries(["", ...this.folders], async (path) => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (path) this.folders = new Set([...this.folders].filter((folder) => folder !== path && !folder.startsWith(`${path}/`))); else throw e; }
        });
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const status = top?.code === 0
          ? await exec("git", ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal"], { cwd, on }).catch(() => null)
          : null;
        const marks = Object.fromEntries(status?.code === 0 ? status.stdout.split("\0").filter(Boolean).slice(0, TOTAL).map((entry) => {
          const xy = entry.slice(0, 2);
          return [`${top.stdout.trim()}/${entry.slice(3)}`, xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M"];
        }) : []);
        if (key() !== context) return;
        this.marks = marks; this.rev = this.rev + 1; this.error = null; this.watch(cwd, cx);
        if (this.pendingFile) { const file = this.pendingFile; this.pendingFile = null; this.show(file, cx, true); }
      } catch (e) { if (key() === context) this.error = listFailure(e, this.on); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    this.rev = this.rev + 1;
    if (this.folders.has(path)) {
      const closing = (folder) => this.folders.has(folder) && (folder === path || folder.startsWith(path + "/"));
      this.entries = new Map([...this.entries].filter(([folder]) => !closing(folder)));
      this.folders = new Set([...this.folders].filter((folder) => !closing(folder)));
    } else {
      this.folders = new Set([...this.folders, path]);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending = new Set([...this.pending, path]);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (key() === context) this.error = listFailure(e, this.on); }
          finally { this.pending = new Set([...this.pending].filter((p) => p !== path)); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  openWith(path) {
    if (!insideRoot(path)) return;
    openOverlay({ mod: "open-with", kind: "popup", width: 340, props: { file: paths.join(this.root, path), folder: this.root, machine: this.on } });
  }

  // The open folders are kept so returning from the preview restores them.
  read(path) {
    if (!insideRoot(path)) return;
    setShared(RETURN, { context: this.context, folders: [...this.folders] });
    showPanel("preview", { mod: "kanso-panel", props: { panel: "preview", path: paths.join(this.root, path), on: this.on, back: "files" } });
  }

  show(path, cx, quiet = false) {
    this.code?.release(); this.code = null; this.text = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    if (!insideRoot(path)) { if (quiet) this.file = null; else this.fileError = "Cannot preview this file"; return; }
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(paths.join(root, path), { on });
        if (this.file !== path || key() !== context) return;
        if (text === null || text.includes("\0")) {
          if (quiet) { this.file = null; this.fileError = null; return; }
          this.fileError = text === null ? "This file is no longer available" : "Binary file · no text preview";
          return;
        }
        if (isMarkdown(path)) this.text = text; else this.code = codeState(path, text);
      } catch { if (this.file === path && key() === context) { if (quiet) { this.file = null; this.fileError = null; } else this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; } }
      finally { cx.notify(); }
    });
  }

  // Rebuilt only when `rev` changes: a draw comes with every shared write anywhere, and rows run to 5,000.
  rows() {
    if (!this.shown || this.shown.rev !== this.rev) this.shown = { rev: this.rev, items: this.flat("", 0).slice(0, TOTAL) };
    return this.shown.items;
  }

  // Plain rows, so the virtual list builds elements only for the ones on screen.
  flat(prefix, depth) {
    if (depth > 40) return [];
    return (this.entries.get(prefix) ?? []).flatMap((entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const row = { path, entry, depth, mark: this.marks[paths.join(this.root, path)] };
      return entry.dir && this.folders.has(path) ? [row, ...this.flat(path, depth + 1)] : [row];
    });
  }

  row({ path, entry, depth, mark }, t) {
    const open = this.folders.has(path);
    return h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(6).cursor_pointer().hover(s => s.bg(t.hover))
      .child(entry.dir ? svg(`mods/kanso-panel/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
      .child(svg(`mods/kanso-panel/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(entry.name))
      .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark)));
  }

  listBones(c) {
    const { row } = skeleton(c);
    return breathe(v_flex().id("kanso-skeleton").w_full().p(6)).children([0, 1, 2, 3, 4, 5, 6].map((i) => row(i, 28)));
  }

  bones(c) {
    const { header } = skeleton(c);
    return v_flex().size_full().min_h(0).bg(c.canvas).text_color(c.text)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(c.border)
        .child(header(52, 13)))
      .child(this.listBones(c));
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme();
    const items = this.file ? [] : this.rows();
    return v_flex().id("files").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).at(-1) ?? ""))
        .when(Boolean(this.file), el => el.child(div().id("files-open-with").p(4).rounded(6).cursor_pointer().text_color(t.muted).tooltip("Open with…")
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.openWith(this.file))
          .child(svg("mods/kanso-chrome/icons/open-with.svg").size(14)))))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).p(6)
        .when(items.length > 0, (el) => el.child(div().flex_1().min_h(0).relative()
          .child(v_virtual_list("files-rows", items.length, 28, (i) => items[i].path, (range) => items.slice(range.start, range.end).map((item) => this.row(item, t)))
            // Item renderers run during native layout, where per-row handlers are forbidden.
            .on_item_click((path, cx) => {
              const item = items.find((item) => item.path === path);
              if (!item) return;
              if (item.entry.dir) this.toggle(path, cx);
              else if (isMarkdown(path) || kindOf(path) === "image") this.read(path);
              else this.show(path, cx);
            })
            .on_item_secondary_click((path) => {
              const item = items.find((item) => item.path === path);
              if (item && !item.entry.dir) this.openWith(path);
            }).size_full())
          .child(Scrollbar.vertical("files-rows").absolute().inset_0())))
        .when(Boolean(this.error), el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error)))
        .when(!this.error && this.loading && !this.entries.get("")?.length, el => el.child(this.listBones({ border: t.border })))
        .when(!this.error && !this.loading && !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.root ? "No files" : "No folder")))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0)
        : this.text !== null ? markdownView("files-md", this.text, t)
        : this.fileError ? div().p(12).text_color(t.dim).child(this.fileError) : readingLines(t)));
  }
}

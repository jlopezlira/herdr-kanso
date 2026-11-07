// Derived from the `files` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: root no longer draws its own rounded, bordered card.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-files.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-files; one of the kanso-panel mod's panels.
// A lazy file browser for the focused pane's folder, with bounded read-only previews.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, v_virtual_list, Scrollbar } from "gpui-base";
import { exec, readTextFile, watchFolder, theme, window, openOverlay, shared, setShared } from "herdr";
import { location, key, codeState, markdownView, isMarkdown, insideRoot, showPanel, mapWith } from "./lib.js";
import { mapSeries } from "./pure.js";

const PER_FOLDER = 500, TOTAL = 5000;
const RETURN = "kanso.files.return";

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    // The path is the process's cwd, not part of -Command: PowerShell joins
    // everything after -Command into the script, so a folder name could run.
    const script = "& { @(Get-ChildItem -LiteralPath . -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)) } }) | ConvertTo-Json -Compress }";
    const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { cwd: path });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  // One process and no shell: find prints each directory twice in a row (a
  // name can't appear twice in a folder), so the type costs no extra call.
  // Entries are not followed (-type d is false for a link to a folder); -H
  // follows only the folder itself, as a link to it should open.
  const fast = await exec("find", ["-H", ".", "-mindepth", "1", "-maxdepth", "1", "!", "-name", ".git",
    "(", "-type", "d", "-print0", "-print0", "-o", "-print0", ")"], { cwd: path, on }).catch(() => null);
  if (fast?.code === 0) {
    // The names ended by a NUL ("./" dropped), as many as the entries kept
    // can take: two for a folder, one for anything else.
    const names = fast.stdout.split("\0").slice(0, -1).slice(0, 2 * (PER_FOLDER + 2)).map((name) => name.slice(2));
    // A name the same as the one before it, when that one was not itself the
    // second of a pair, is that folder's second print.
    const second = mapWith(names, (last, name) => (name === last ? [null, true] : [name, false]), null);
    const out = names.flatMap((name, i) => (second[i] ? [] : [{ name, dir: second[i + 1] === true }]));
    // One past the cap tells the panel the folder was cut short.
    return out.slice(0, PER_FOLDER + 1);
  }
  // Fallback (no find on that machine, or a folder so large the output went
  // past exec's limit): stream NUL-separated names. Bash's read -d keeps the
  // stream bounded; read one extra entry to detect truncation.
  const script = `
n=0
find -H "$1" -mindepth 1 -maxdepth 1 ! -name .git -print0 2>/dev/null |
while IFS= read -r -d '' p; do
  name=\${p##*/}
  if [ -d "$p" ] && [ ! -L "$p" ]; then kind=d; else kind=f; fi
  printf '%s\\0%s\\0' "$kind" "$name"
  n=$((n+1))
  [ "$n" -ge ${PER_FOLDER + 1} ] && break
done
test -d "$1"`;
  const r = await exec("bash", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0");
  return Array.from({ length: Math.floor(fields.length / 2) }, (_, k) => ({ name: fields[2 * k + 1], dir: fields[2 * k] === "d" }));
}

// The panel exists only while it is shown (kanso-tabs mounts it on demand),
// so it always works: no idle state to keep.
export class Files {
  constructor() { this.rev = 0; } // bumped whenever the rows would differ: the tree is rebuilt only then

  init(cx) {
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    // Back from a Markdown file: the folders that were open, for the same place.
    const back = shared(RETURN);
    if (back) {
      setShared(RETURN, null);
      if (back.context === key()) { this.context = back.context; ({ cwd: this.root, on: this.on } = location()); this.folders = new Set(back.folders ?? []); }
    }
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
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
    const entries = await directory(path ? `${root}/${path}` : root, on);
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
    if (context !== this.context) {
      this.context = context; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set();
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.rev = this.rev + 1;
    }
    if (!cwd) return;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        await mapSeries(["", ...this.folders], (path) => this.loadFolder(path, context));
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
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    this.rev = this.rev + 1;
    if (this.folders.has(path)) {
      // The folder closes, and every open one inside it, with what was read of them.
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
          catch (e) { if (key() === context) this.error = String(e); }
          finally { this.pending = new Set([...this.pending].filter((p) => p !== path)); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  // The file in a code editor of your choice (the `open-with` mod), or in
  // Kanso's own preview panel, which that list offers for text files.
  openWith(path) {
    if (!insideRoot(path)) return;
    openOverlay({ mod: "open-with", kind: "popup", width: 340, props: { file: `${this.root}/${path}`, folder: this.root, machine: this.on } });
  }

  // A Markdown file opens in the preview panel, to read and edit, with a way
  // back here; the open folders are kept for that return.
  read(path) {
    if (!insideRoot(path)) return;
    setShared(RETURN, { context: this.context, folders: [...this.folders] });
    showPanel("preview", { mod: "kanso-panel", props: { panel: "preview", path: `${this.root}/${path}`, on: this.on, back: "files" } });
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.text = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    if (!insideRoot(path)) { this.fileError = "Cannot preview this file"; return; }
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || key() !== context) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        // Markdown is rendered (the SDK's TextView); anything else is read-only code.
        if (isMarkdown(path)) this.text = text; else this.code = codeState(path, text);
      } catch { if (this.file === path && key() === context) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  // The tree's rows, built again only when something in them changed (`rev`):
  // a draw comes with every shared write anywhere, the rows run to 5,000.
  rows() {
    if (!this.shown || this.shown.rev !== this.rev) this.shown = { rev: this.rev, items: this.flat("", 0).slice(0, TOTAL) };
    return this.shown.items;
  }

  // Plain rows, so a frame builds elements only for the ones on screen: a
  // folder's entries, each open one followed by its own, 40 deep at most.
  flat(prefix, depth) {
    if (depth > 40) return [];
    return (this.entries.get(prefix) ?? []).flatMap((entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const row = { path, entry, depth, mark: this.marks[`${this.root}/${path}`] };
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
            // Item renderers run during native layout, where per-row handlers
            // are forbidden. The list owns two handlers, keyed by file path.
            .on_item_click((path, cx) => {
              const item = items.find((item) => item.path === path);
              if (!item) return;
              if (item.entry.dir) this.toggle(path, cx);
              else if (isMarkdown(path)) this.read(path);
              else this.show(path, cx);
            })
            .on_item_secondary_click((path) => {
              const item = items.find((item) => item.path === path);
              if (item && !item.entry.dir) this.openWith(path);
            }).size_full())
          .child(Scrollbar.vertical("files-rows").absolute().inset_0())))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0)
        : this.text !== null ? markdownView("files-md", this.text, t)
        : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}

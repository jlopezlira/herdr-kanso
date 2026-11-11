import { serviceOn } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
// Derived from the `files` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by 0OZ: root no longer draws its own rounded, bordered card.
// Modified by José Gutiérrez (minimalistic, 0oz design fork): renamed from oz-files.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): renamed from mn-files; one of the kanso-panel mod's panels.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, Scrollbar } from "gpui-base";
import { exec, watchFolder, theme, openOverlay, shared, setShared, window, layout } from "herdr";
import { location, key, insideRoot, showPanel } from "./lib.js";
import { walkLayout } from "./layout.js";
import { listFailure, remoteDue, parseTree, pollStart, pollNext, ArmPoll, takeStamp, staleView, asOf } from "./remote-file.js";
import { mapSeries } from "./pure.js";
import { filesMemory } from "./panel-state.js";
import { skeleton, breathe, quietLink, tokens } from "./ui.js";
import { Front } from "./front.js";

const PER_FOLDER = 500, TOTAL = 5000, WATCHED_MS = 60_000;
const RETURN = "kanso.files.return";
const ranked = (entries, room) => entries.slice(0, Math.max(0, room)).toSorted((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
const markOf = (xy) => xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
const marksFrom = (top, rows) => Object.fromEntries(rows.filter(Boolean).slice(0, TOTAL).map((entry) => [`${top}/${entry.slice(3)}`, markOf(entry.slice(0, 2))]));

export function changedFiles(marks, root) {
  const base = String(root ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base) return [];
  return Object.entries(marks ?? {}).flatMap(([abs, mark]) => {
    const full = String(abs).replace(/\\/g, "/").replace(/\/+$/, "");
    const rel = full.startsWith(`${base}/`) ? full.slice(base.length + 1) : "";
    return rel ? [{ path: rel, entry: { name: rel, dir: false }, depth: 0, mark }] : [];
  }).toSorted((a, b) => a.path.localeCompare(b.path));
}

async function directory(path, on) {
  return (await serviceOn(fileApi, on)).directory(path);
}

export class Files {
  constructor() { this.rev = 0; } // bumped whenever the rows would differ; the tree is rebuilt only then

  init(cx, given = {}) {
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.changed = Boolean(given?.changed);
    // Returning from the preview: the folders that were open, for the same place.
    const back = shared(RETURN);
    if (back) {
      setShared(RETURN, null);
      if (back.context === key()) { this.context = back.context; ({ cwd: this.root, on: this.on } = location()); this.folders = new Set(back.folders ?? []); }
    }
    this.poll = pollStart(); this.stamp = null; this.fresh = null; this.held = null; this.arm = null;
    this.front = new Front();
    if (this.front.behind()) this.front.rest();
    else this.refresh(cx);
    cx.timer.every(10000, (cx) => this.laterLocal(cx));
  }

  laterLocal(cx) {
    if (this.on) return;
    if (this.front.behind()) { this.front.rest(); return; }
    if (this.front.woke() || !(this.watched && Date.now() - (this.listedAt ?? 0) < WATCHED_MS)) this.refresh(cx);
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
    const kept = ranked(entries, Math.min(PER_FOLDER, TOTAL - used));
    this.entries = new Map([...this.entries, [path, kept]]);
    this.rev = this.rev + 1;
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    this.front.woke();
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
      this.pending = new Set(); this.marks = {}; this.watched = null; this.error = null; this.limited = false;
      this.stamp = null; this.fresh = null; this.held = null; this.poll = pollStart(); this.arm = null;
      this.rev = this.rev + 1;
    }
    if (!cwd) return;
    this.loading = true;
    this.limited = false;
    cx.spawn(async (cx) => {
      try {
        if (on) await this.loadRemote(cwd, context, cx);
        else await this.loadHere(cwd, on, context, cx);
      } catch (e) {
        if (key() !== context) return;
        if (!on) { this.error = listFailure(e, on); return; }
        const view = staleView(Boolean(this.entries.get("")?.length), this.fresh, Date.now(), listFailure(e, on));
        if (view.keep) { this.held = view.hold; this.error = null; }
        else { this.error = view.error; this.held = null; }
        this.poll = pollNext(this.poll, "failed");
      } finally {
        this.loading = false;
        if (this.on && key() === context) new ArmPoll(this).start(cx, (tick) => this.probe(tick));
        cx.notify();
      }
    });
  }

  async loadHere(cwd, on, context, cx) {
    await mapSeries(["", ...this.folders], async (path) => {
      try { await this.loadFolder(path, context); }
      catch (e) { if (path) this.folders = new Set([...this.folders].filter((folder) => folder !== path && !folder.startsWith(`${path}/`))); else throw e; }
    });
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
    const status = top?.code === 0
      ? await exec("git", ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=normal"], { cwd, on }).catch(() => null)
      : null;
    if (key() !== context) return;
    this.marks = status?.code === 0 ? marksFrom(top.stdout.trim(), status.stdout.split("\0")) : {};
    this.rev = this.rev + 1; this.error = null; this.listedAt = Date.now(); this.watch(cwd, cx);
    if (this.pendingFile) { const file = this.pendingFile; this.pendingFile = null; this.openSaved(file, cx); }
  }

  async loadRemote(cwd, context, cx) {
    const snap = parseTree(await (await serviceOn(fileApi, this.on)).tree(cwd, ["", ...this.folders]));
    if (key() !== context) return;
    const placed = snap.folders.reduce((acc, { rel, entries }) => {
      if (rel && !acc.open.has(rel)) return acc;
      const used = [...acc.entries.values()].reduce((n, rows) => n + rows.length, 0);
      const kept = ranked(entries, Math.min(PER_FOLDER, TOTAL - used));
      return { entries: new Map([...acc.entries, [rel, kept]]), open: acc.open, limited: acc.limited || entries.length > PER_FOLDER || used + entries.length > TOTAL };
    }, { entries: new Map(), open: this.folders, limited: false });
    const got = new Set(snap.folders.map((folder) => folder.rel));
    this.entries = placed.entries;
    this.folders = new Set([...this.folders].filter((folder) => got.has(folder)));
    this.limited = placed.limited;
    this.marks = snap.top ? marksFrom(snap.top, snap.rows) : {};
    this.stamp = snap.stamp ?? this.stamp;
    this.fresh = Date.now(); this.held = null; this.error = null;
    this.poll = pollNext(this.poll, "changed");
    this.rev = this.rev + 1;
    if (this.pendingFile) { const file = this.pendingFile; this.pendingFile = null; this.openSaved(file, cx); }
  }

  probe(cx) {
    const on = this.on, root = this.root;
    if (!remoteDue(on, window()?.active, walkLayout(layout(), "panel-body")?.hidden) || !root) return;
    cx.spawn(async (cx) => {
      const { outcome, next } = await takeStamp(async () => (await serviceOn(fileApi, on)).stat(root), this.stamp);
      if (this.on !== on || this.root !== root) return;
      if (outcome === "changed") this.refresh(cx);
      else {
        if (outcome === "seen") this.stamp = next;
        if (outcome === "failed") {
          const view = staleView(Boolean(this.entries.get("")?.length), this.fresh, Date.now(), listFailure(new Error("timed out"), on));
          if (view.keep) { this.held = view.hold; this.error = null; }
          else if (!this.error) this.error = view.error;
        }
        this.poll = pollNext(this.poll, outcome);
        new ArmPoll(this).start(cx, (tick) => this.probe(tick));
        cx.notify();
      }
    });
  }

  retry(cx) {
    this.poll = pollStart();
    this.arm = null;
    this.refresh(cx);
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
  openSaved(file) { this.read(file); }

  read(path) {
    if (!insideRoot(path)) return;
    setShared(RETURN, { context: this.context, folders: [...this.folders] });
    showPanel("preview", { mod: "kanso-panel", props: { panel: "preview", path: paths.join(this.root, path), on: this.on, back: "files" } });
  }

  // Rebuilt only when `rev` changes: a draw comes with every shared write anywhere, and rows run to 5,000.
  rows() {
    if (this.changed) return changedFiles(this.marks, this.root);
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
    if (!this.on) this.front?.wake(cx, (wakeCx) => this.refresh(wakeCx));
    if (key() !== this.context) {
      if (!this.on && this.front.behind()) this.front.rest();
      else this.refresh(cx);
    }
    if (this.on && !this.arm && remoteDue(this.on, window()?.active, walkLayout(layout(), "panel-body")?.hidden)) new ArmPoll(this).start(cx, (tick) => this.probe(tick));
    const t = theme();
    const items = this.rows();
    return v_flex().id("files").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Files"))
        .when(Boolean(this.changed), (el) => el.child(quietLink("files-all", "All files", (clickCx) => { this.changed = false; clickCx.notify(); }, tokens(t))))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.root?.split(/[\\/]/).at(-1) ?? "")))
      .child(v_flex().id("files-tree").flex_1().min_h(0).p(6)
        .when(items.length > 0, (el) => el.child(div().flex_1().min_h(0).relative()
          .child(v_virtual_list("files-rows", items.length, 28, (i) => items[i].path, (range) => items.slice(range.start, range.end).map((item) => this.row(item, t)))
            // Item renderers run during native layout, where per-row handlers are forbidden.
            .on_item_click((path, cx) => {
              const item = items.find((item) => item.path === path);
              if (!item) return;
              if (item.entry.dir) this.toggle(path, cx);
              else this.read(path);
            })
            .on_item_secondary_click((path) => {
              const item = items.find((item) => item.path === path);
              if (item && !item.entry.dir) this.openWith(path);
            }).size_full())
          .child(Scrollbar.vertical("files-rows").absolute().inset_0())))
        .when(Boolean(this.held), (el) => el.child(h_flex().id("files-stale").px(8).py(4).gap(8).items_center()
          .child(div().text_size(12).text_color(t.dim).child(asOf(this.held.at, Date.now())))
          .child(quietLink("files-retry", "Retry", (cx) => this.retry(cx), tokens(t)))))
        .when(Boolean(this.error), (el) => el.child(h_flex().id("files-error").p(8).gap(8).items_center()
          .child(div().text_size(12).text_color(t.dim).child(this.error))
          .when(Boolean(this.on), (row) => row.child(quietLink("files-retry", "Retry", (cx) => this.retry(cx), tokens(t))))))
        .when(!this.error && this.loading && !this.entries.get("")?.length, el => el.child(this.listBones({ border: t.border })))
        .when(!this.error && !this.loading && items.length === 0, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.changed ? "Nothing changed." : this.root ? "No files" : "No folder")))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total"))));
  }
}

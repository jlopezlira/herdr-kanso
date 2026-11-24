import { paths } from "./platform-paths.js";
import { openApi } from "./platform-open.js";
// Open with: opens the focused pane's folder in a code editor installed on this computer.
// Other mods open it with openOverlay({ mod: "open-with", kind: "popup", props: { folder, machine } }), or props.file (full path) for one file; a text file is also offered to kanso-panel's preview.

import { View } from "gpui-kit";
import { exec, run, notify, theme, props, closeOverlay, focused, panes, spaces, home, appHome, shared, setShared, window as win } from "herdr";
import { listKey, moveTo } from "./listkeys.js";
import { isText } from "./kinds.js";
import { hasPanel, showPreview } from "./preview-open.js";
import { aliasText, machineTitle, focusOn } from "./pure.js";
import { tokens } from "./ui.js";
import { menuList } from "./ui-menu.js";

const MOD = "open-with";
const RECENT = `${MOD}.recent`;
const FOUND = `${MOD}.found`;
const ICONS = `data/${MOD}/icons`;

// Catalog order is the order shown before anything was used; family: how a remote (SSH) folder opens; bin: the CLI inside the macOS bundle.
const VSC = "Contents/Resources/app/bin/";
const EDITORS = [
  { id: "cursor", name: "Cursor", mac: ["Cursor.app"], cli: ["cursor"], family: "vscode", bin: VSC + "cursor", icon: "icons/cursor.svg" },
  { id: "vscode", name: "VS Code", mac: ["Visual Studio Code.app"], cli: ["code"], flatpak: ["com.visualstudio.code"], family: "vscode", bin: VSC + "code" },
  { id: "vscode-insiders", name: "VS Code Insiders", mac: ["Visual Studio Code - Insiders.app"], cli: ["code-insiders"], family: "vscode", bin: VSC + "code-insiders" },
  { id: "windsurf", name: "Windsurf", mac: ["Windsurf.app"], cli: ["windsurf"], family: "vscode", bin: VSC + "windsurf" },
  { id: "antigravity", name: "Antigravity", mac: ["Antigravity.app"], cli: ["antigravity", "agy"], family: "vscode", bin: VSC + "antigravity", icon: "icons/antigravity.svg" },
  { id: "kiro", name: "Kiro", mac: ["Kiro.app"], cli: ["kiro"], family: "vscode", bin: VSC + "kiro", icon: "icons/kiro.svg" },
  { id: "trae", name: "Trae", mac: ["Trae.app"], cli: ["trae"], family: "vscode", bin: VSC + "trae" },
  { id: "vscodium", name: "VSCodium", mac: ["VSCodium.app"], cli: ["codium"], flatpak: ["com.vscodium.codium"], family: "vscode", bin: VSC + "codium" },
  { id: "positron", name: "Positron", mac: ["Positron.app"], cli: ["positron"] },
  { id: "zed", name: "Zed", mac: ["Zed.app", "Zed Preview.app"], cli: ["zed", "zeditor"], flatpak: ["dev.zed.Zed"], family: "zed", bin: "Contents/MacOS/cli" },
  { id: "sublime", name: "Sublime Text", mac: ["Sublime Text.app"], cli: ["subl"], flatpak: ["com.sublimetext.three"] },
  { id: "idea", name: "IntelliJ IDEA", mac: ["IntelliJ IDEA.app", "IntelliJ IDEA Ultimate.app", "IntelliJ IDEA CE.app"], cli: ["idea", "intellij-idea-ultimate", "intellij-idea-community"] },
  { id: "webstorm", name: "WebStorm", mac: ["WebStorm.app"], cli: ["webstorm"] },
  { id: "pycharm", name: "PyCharm", mac: ["PyCharm.app", "PyCharm Professional Edition.app", "PyCharm CE.app"], cli: ["pycharm", "pycharm-professional", "pycharm-community"] },
  { id: "goland", name: "GoLand", mac: ["GoLand.app"], cli: ["goland"] },
  { id: "phpstorm", name: "PhpStorm", mac: ["PhpStorm.app"], cli: ["phpstorm"] },
  { id: "rubymine", name: "RubyMine", mac: ["RubyMine.app"], cli: ["rubymine"] },
  { id: "rustrover", name: "RustRover", mac: ["RustRover.app"], cli: ["rustrover"] },
  { id: "clion", name: "CLion", mac: ["CLion.app"], cli: ["clion"] },
  { id: "rider", name: "Rider", mac: ["Rider.app"], cli: ["rider"] },
  { id: "fleet", name: "Fleet", mac: ["Fleet.app"], cli: ["fleet"] },
  { id: "nova", name: "Nova", mac: ["Nova.app"], cli: ["nova"] },
  { id: "bbedit", name: "BBEdit", mac: ["BBEdit.app"], cli: ["bbedit"] },
  { id: "textmate", name: "TextMate", mac: ["TextMate.app"], cli: ["mate"] },
  { id: "xcode", name: "Xcode", mac: ["Xcode.app"] },
  { id: "nvim", name: "Neovim", cli: ["nvim"], tui: true, icon: "icons/nvim.svg" },
  { id: "hx", name: "Helix", cli: ["hx", "helix"], tui: true, icon: "icons/hx.svg" },
  { id: "vim", name: "Vim", cli: ["vim"], tui: true, icon: "icons/vim.svg" },
];
const BY_ID = Object.fromEntries(EDITORS.map((e) => [e.id, e]));
// The editors show this many, then scroll.
const LIST_ROWS = 13;
// A letter tile's hue, by the editor's place in the catalog.
const TILE_TONES = ["blue", "teal", "violet", "yellow", "green", "red"];

// One shell pass: prints `app|cli|flatpak <tab> key <tab> path` per hit.
const PREVIEW = { id: "preview", name: "Preview in the panel", icon: "mods/kanso-chrome/icons/file.svg", builtin: true };

function shortPath(folder, machine) {
  const h = home();
  if (!machine && folder.startsWith(h)) return "~" + folder.slice(h.length);
  return folder;
}

export default class OpenWith extends View {
  init(_props, cx) {
    this.platform = win()?.platform ?? "macos";
    this.found = shared(FOUND) ?? null;
    this.at = 0;
    this.icons = {};
    this.handle = focusOn(cx);
    this.target = this.resolveTarget();
    this.detect(cx);
  }

  detect(cx) {
    if (this.looking) return;
    this.looking = true; this.error = null;
    cx.spawn(async (cx) => {
      try {
        this.found = await openApi(this.platform, exec).detectEditors(EDITORS);
        setShared(FOUND, this.found);
      } catch (err) {
        this.error = String(err?.message ?? err);
      }
      this.looking = false;
      cx.notify();
      await this.loadIcons();
      cx.notify();
    });
    cx.notify();
  }

  resolveTarget() {
    const p = props() ?? {};
    if (p.file) return { folder: p.folder ?? paths.dirname(p.file), machine: p.machine ?? null, file: p.file };
    if (p.folder) return { folder: p.folder, machine: p.machine ?? null };
    const f = focused();
    const space = spaces().find((s) => s.id === f?.space) ?? spaces().find((s) => s.active);
    const pane = panes().find((x) => x.focused);
    const folder = f?.cwd || pane?.cwd || space?.folder || home();
    return { folder, machine: space?.machine ?? null };
  }

  async loadIcons() {
    const ids = await openApi(this.platform, exec).editorIcons(this.found ?? {}, paths.join(appHome(), ICONS)).catch(() => []);
    this.icons = Object.fromEntries(ids.map((id) => [id, `${ICONS}/${id}.png`]));
  }

  list() {
    const recent = (shared(RECENT) ?? []).filter((id) => BY_ID[id]);
    const have = EDITORS.filter((e) => this.found?.[e.id]);
    const rank = (e) => { const i = recent.indexOf(e.id); return i < 0 ? 1000 + EDITORS.indexOf(e) : i; };
    const gui = have.filter((e) => !e.tui).toSorted((a, b) => rank(a) - rank(b));
    const tui = have.filter((e) => e.tui).toSorted((a, b) => rank(a) - rank(b));
    const own = this.target.file && isText(this.target.file) ? [PREVIEW] : [];
    return [...own, ...gui, ...tui];
  }

  canOpen(e) {
    if (e.builtin) return hasPanel();
    if (!this.target.machine) return true;
    return e.tui || e.family === "vscode" || e.family === "zed";
  }

  close() {
    closeOverlay(props().overlay);
  }

  async open(e) {
    if (!e || !this.canOpen(e)) return;
    const { folder, machine, file } = this.target;
    if (e.builtin) { if (showPreview(file, machine)) this.close(); return; }
    this.close();
    const how = this.found[e.id];
    setShared(RECENT, [e.id, ...(shared(RECENT) ?? []).filter((x) => x !== e.id)].slice(0, 12));
    if (e.tui) {
      // A path found here means nothing on another machine: run it by name there.
      run("terminal.open", { argv: [machine || !how.cli ? e.cli[0] : how.cli, file ?? "."], folder, place: "right" });
      return;
    }
    try {
      const r = await this.launch(e, how, file ?? folder, machine);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `exit ${r.code}`);
    } catch (err) {
      notify({ title: `Could not open ${e.name}`, body: String(err?.message ?? err).slice(0, 300), level: "error" });
    }
  }

  launch(e, how, folder, machine) {
    const cli = how.cli ?? (how.app && e.bin ? paths.join(how.app, e.bin) : null);
    if (machine) {
      if (!cli) throw new Error(`${e.name} has no command line to open a folder on ${machineTitle(machine, "", aliasText(shared("kanso.alias"), machine))}`);
      const args = e.family === "zed" ? [`ssh://${machine}${folder.startsWith("/") ? "" : "/"}${folder}`] : ["--remote", `ssh-remote+${machine}`, folder];
      return this.spawn(cli, args);
    }
    if (how.app) return openApi(this.platform, exec).open(folder, { application: how.app });
    if (how.flatpak && !how.cli) return this.spawn("flatpak", ["run", how.flatpak, folder]);
    return this.spawn(cli, [folder]);
  }

  spawn(cli, args) {
    return openApi(this.platform, exec).spawn(cli, args);
  }

  // An editor as a Menu item: its app's picture, its own icon, or its letter; one that cannot open a remote folder is dim and says so.
  item(e, i, sel) {
    const ok = this.canOpen(e);
    const picture = this.icons[e.id] ?? null;
    return {
      picture, icon: picture ? null : e.icon ?? null, letter: picture || e.icon ? null : e.name[0], tone: TILE_TONES[EDITORS.indexOf(e) % TILE_TONES.length],
      label: e.name, hint: !ok ? (e.builtin ? "no panel in this layout" : "local only") : i < 9 ? String(i + 1) : null,
      disabled: !ok, selected: i === sel && ok, onClick: () => this.open(e),
    };
  }

  render() {
    const list = this.list();
    const pickable = list.filter((e) => this.canOpen(e));
    this.at = Math.max(0, Math.min(this.at, pickable.length - 1));
    const sel = list.indexOf(pickable[this.at]);
    const { folder, machine, file } = this.target;
    const shown = file ?? folder;
    const firstTui = list.findIndex((e) => e.tui);
    const again = (cx) => this.detect(cx);
    const none = !list.some((e) => !e.builtin);
    const state = this.error && none ? [{ failure: { text: "Could not look for editors", source: this.error, fix: "Retry", onClick: again } }]
      : !this.found || (this.looking && none) ? [{ loading: true }, { loading: true }]
      : none ? [{ heading: "No code editor found. Install Cursor, VS Code, Zed or another editor." }, { icon: "refresh-cw", label: "Look again", onClick: again }]
      : [];
    const editors = list.flatMap((e, i) => [...(i === firstTui ? [{ heading: "In a split" }] : []), this.item(e, i, sel)]);
    const title = `Open with · ${machine ? `${machine}: ${shown}` : shortPath(shown, machine)}`;
    return menuList("open-with", { title, items: [...state, { scroll: editors, rows: LIST_ROWS }] }, tokens(theme())).track_focus(this.handle)
      .on_key_down((ev, cx) => {
        const k = ev.key, { move, gAt } = listKey(ev, this.listG);
        this.listG = gAt;
        if (move === "escape") return this.close();
        if (move === "enter") return void (pickable.length ? this.open(pickable[this.at]) : this.detect(cx));
        if (move && move !== "pending") { if (pickable.length) this.at = moveTo(move, this.at, pickable.length); }
        else if (move === "pending") { /* the first g of gg */ }
        else if (!ev.modifiers.control && !ev.modifiers.platform && !ev.modifiers.alt && /^[1-9]$/.test(k)) return void this.open(list[Number(k) - 1]);
        else return;
        cx.stop_propagation();
        cx.notify();
      });
  }
}

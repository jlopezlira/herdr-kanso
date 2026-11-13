import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Button, Input, InputState, Editor, EditorState } from "gpui-base";
import { appHome, closeOverlay, exec, focused, hc, home, knownAgents, notify, panes, pickFolder, props, readTextFile, run, spaces, terminals, theme, window, writeTextFile } from "herdr";

const FILE = `${appHome()}/data/kanso-snippets/snippets.json`;
const KINDS = ["terminal", "prompt"];
export function relativeHome(path, root = home()) {
  const value = String(path ?? "").trim();
  if (!value || value === "~" || value.startsWith("~/")) return value;
  if (!value.startsWith("/")) return `~/${value.replace(/^\.?\//, "")}`;
  return value === root ? "~" : value.startsWith(`${root}/`) ? `~${value.slice(root.length)}` : value;
}
export function absoluteHome(path, root = home()) {
  const value = String(path ?? "").trim();
  return value === "~" ? root : value.startsWith("~/") ? `${root}/${value.slice(2)}` : value;
}
export async function requireWorkingDirectory(path, platform = window()?.platform ?? "macos", execute = exec) {
  if (!path) return;
  const result = platform === "windows"
    ? await execute("powershell", ["-NoProfile", "-NonInteractive", "-Command",
      "if (Test-Path -LiteralPath $args[0] -PathType Container) { exit 0 } else { exit 1 }", path])
    : await execute("test", ["-d", path]);
  if (result.code !== 0) throw new Error(`Working directory does not exist or is not a directory: ${path}`);
}
export function promptAgentArgs(argv) {
  const args = [...argv];
  const executable = String(args[0] ?? "").split(/[\\/]/).at(-1).replace(/\.exe$/i, "").toLowerCase();
  if (executable === "copilot") {
    let replaced = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "-i") { args[i] = "-p"; replaced = true; }
      else if (args[i] === "--interactive") { args[i] = "--prompt"; replaced = true; }
    }
    if (!replaced && !args.slice(1).some((arg) => arg === "-p" || arg === "--prompt")) args.push("-p");
  }
  return args;
}
export async function currentDirectory({ focus, allTerminals, allPanes, allSpaces, getTerminal }) {
  const address = focus?.terminal;
  const terminal = allTerminals.find((item) => item.address === address);
  if (address) {
    try {
      const result = await getTerminal(["get", address, "--json"]);
      if (result.code === 0) {
        const cwd = JSON.parse(result.stdout)?.foreground?.cwd;
        if (typeof cwd === "string" && cwd) return cwd;
      }
    } catch {}
  }
  return terminal?.cwd
    || allPanes.find((pane) => pane.terminal === address)?.cwd
    || focus?.cwd
    || allSpaces.find((space) => space.active)?.folder
    || null;
}

export function normalizeSnippets(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || !KINDS.includes(item.kind) || typeof item.name !== "string" || typeof item.body !== "string") return [];
    let id = String(item.id ?? "");
    if (!id || ids.has(id)) {
      id = `snippet-${index}`;
      while (ids.has(id)) id += "-";
    }
    ids.add(id);
    const place = item.kind === "prompt" || item.place === "new" ? "new" : "current";
    return [{ id, name: item.name, kind: item.kind, body: item.body, cwd: place === "current" ? "" : typeof item.cwd === "string" ? item.cwd : "",
      agent: typeof item.agent === "string" ? item.agent : null, place }];
  });
}

export default class KansoSnippets extends View {
  init(_props, cx) {
    this.snippets = [];
    this.disk = null;
    this.editor = null;
    this.loading = true;
    this.saving = false;
    this.error = null;
    this.agents = null;
    this.agentError = null;
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      try {
        const found = await exec("sh", ["-c", 'if [ -f "$1" ]; then echo file; elif [ -e "$1" ]; then echo other; else echo none; fi', "sh", FILE]);
        if (found.code !== 0) throw new Error((found.stderr || "Could not check the snippets file.").trim());
        const file = found.stdout.trim();
        if (file !== "file" && file !== "none") throw new Error("The snippets path could not be checked.");
        this.disk = file === "file" ? await readTextFile(FILE) : null;
        this.snippets = normalizeSnippets(this.disk ? JSON.parse(this.disk) : []);
      } catch (e) {
        this.error = `Could not read snippets: ${String(e?.message ?? e)}`;
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
    cx.spawn(async (cx) => {
      try {
        this.agents = (await knownAgents({ on: null })).filter((agent) => agent.installed);
        if (this.editor?.kind === "prompt" && !this.agent && this.agents.length) this.agent = this.agents[0].key;
      } catch (e) {
        this.agentError = `Could not read agents: ${String(e?.message ?? e)}`;
      } finally {
        cx.notify();
      }
    });
  }

  edit(snippet, cx) {
    this.editor = { id: snippet?.id ?? null, kind: snippet?.kind ?? "terminal" };
    this.agent = snippet?.agent ?? this.agents?.[0]?.key ?? null;
    this.place = this.editor.kind === "prompt" ? "new" : snippet?.place === "new" ? "new" : "current";
    this.cwd = InputState.new({ value: relativeHome(snippet?.cwd ?? ""), placeholder: "Use the default folder" });
    this.cwd.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.name = InputState.new({ value: snippet?.name ?? "", placeholder: "Snippet name" });
    this.name.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.body = EditorState.new({ value: snippet?.body ?? "", language: "plain", soft_wrap: true, line_numbers: false, folding: false });
    this.body.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    cx.notify();
  }

  browseFolder(cx) {
    pickFolder({ prompt: "Choose working folder" }).then((folder) => {
      if (folder) this.cwd.set_value(relativeHome(folder));
      cx.notify();
    }).catch((e) => {
      this.error = `Could not choose a folder: ${String(e?.message ?? e)}`;
      cx.notify();
    });
  }

  async save(cx) {
    const name = this.name.value().trim(), body = this.body.value();
    const cwd = this.place === "new" ? relativeHome(this.cwd.value()) : "";
    if (!name || !body.trim() || this.saving) return;
    const id = this.editor.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const snippet = { id, name, kind: this.editor.kind, body, cwd,
      agent: this.editor.kind === "prompt" ? this.agent : null,
      place: this.editor.kind === "prompt" ? "new" : this.place };
    const index = this.snippets.findIndex((item) => item.id === id);
    const next = index < 0 ? [...this.snippets, snippet] : this.snippets.map((item, i) => i === index ? snippet : item);
    this.saving = true;
    this.error = null;
    cx.notify();
    try {
      const made = await exec("mkdir", ["-p", `${appHome()}/data/kanso-snippets`]);
      if (made.code !== 0) throw new Error((made.stderr || "Could not create the snippets folder.").trim());
      const disk = JSON.stringify(next, null, 2) + "\n";
      await writeTextFile(FILE, disk, this.disk);
      this.disk = disk;
      this.snippets = next;
      this.editor = null;
      notify({ title: "Snippet saved", body: name, level: "success" });
    } catch (e) {
      this.error = `Could not save snippet: ${String(e?.message ?? e)}`;
    } finally {
      this.saving = false;
      cx.notify();
    }
  }

  async remove(snippet, cx) {
    if (this.saving) return;
    const previous = this.snippets;
    this.snippets = previous.filter((item) => item.id !== snippet.id);
    this.saving = true;
    this.error = null;
    cx.notify();
    try {
      const disk = JSON.stringify(this.snippets, null, 2) + "\n";
      await writeTextFile(FILE, disk, this.disk);
      this.disk = disk;
    } catch (e) {
      this.snippets = previous;
      this.error = `Could not delete snippet: ${String(e?.message ?? e)}`;
    } finally {
      this.saving = false;
      cx.notify();
    }
  }

  async copy(snippet, cx) {
    try {
      if (typeof cx.write_to_clipboard !== "function") throw new Error("Clipboard is unavailable.");
      await cx.write_to_clipboard(snippet.body);
      this.error = null;
      notify({ title: `Copied ${snippet.kind}`, level: "success" });
    } catch (e) {
      this.error = `Could not copy snippet: ${String(e?.message ?? e)}`;
    }
    cx.notify();
  }

  async run(snippet, cx) {
    if (snippet.kind === "prompt") {
      this.saving = true;
      this.error = null;
      cx.notify();
      try {
        const agent = (await knownAgents({ on: null })).find((item) => item.key === snippet.agent);
        if (!agent) throw new Error("Choose an agent in Edit snippet.");
        const space = spaces().find((item) => item.active);
        const folder = snippet.cwd ? absoluteHome(snippet.cwd)
          : await currentDirectory({ focus: focused(), allTerminals: terminals(), allPanes: panes(), allSpaces: spaces(), getTerminal: hc });
        await requireWorkingDirectory(folder);
        run("tab.new", { name: snippet.name, ...(space ? { space: space.id } : {}),
          ...(folder ? { folder } : {}), argv: promptAgentArgs(agent.run), task: snippet.body });
      } catch (e) {
        this.error = `Could not start agent: ${String(e?.message ?? e)}`;
      } finally {
        this.saving = false;
        cx.notify();
      }
      return;
    }
    this.saving = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        let terminal;
        if (snippet.place === "new") {
          const currentSpace = spaces().find((item) => item.active);
          const folder = snippet.cwd ? absoluteHome(snippet.cwd)
            : await currentDirectory({ focus: focused(), allTerminals: terminals(), allPanes: panes(), allSpaces: spaces(), getTerminal: hc });
          await requireWorkingDirectory(folder);
          const name = `${snippet.name} (opening ${Math.random().toString(36).slice(2, 8)})`;
          run("tab.new", { name, ...(currentSpace ? { space: currentSpace.id } : {}), ...(folder ? { folder } : {}) });
          let tab;
          for (let i = 0; i < 60 && !tab; i++) {
            await cx.sleep(100);
            tab = spaces().flatMap((item) => item.tabs ?? []).find((item) => item.name === name);
          }
          if (!tab) throw new Error("Herdr did not open a new tab.");
          run("tab.rename", { id: tab.id, name: snippet.name });
          for (let i = 0; i < 60 && !terminal; i++) {
            await cx.sleep(100);
            terminal = panes().find((item) => item.tab === tab.id && item.terminal)?.terminal;
          }
          if (!terminal) throw new Error("The new tab did not open a terminal.");
        } else {
          const address = focused()?.terminal;
          const current = terminals().find((item) => item.address === address);
          if (!current || current.program?.agent) throw new Error(current ? "Focus a shell terminal to run this snippet." : "Focus a terminal before running this snippet.");
          terminal = current.address;
        }
        const result = await hc(["send", terminal, snippet.body]);
        if (result.code !== 0) throw new Error((result.stderr || result.stdout || "Terminal rejected the command.").trim());
      } catch (e) {
        this.error = `Could not run snippet: ${String(e?.message ?? e)}`;
      } finally {
        this.saving = false;
        cx.notify();
      }
    });
  }

  render() {
    const t = theme(), p = props() ?? {};
    const button = (id, icon, label, active, action, disabled = false) => Button.new(id).size(32).flex_none().items_center().justify_center().rounded(7).cursor_pointer()
      .border_1().border_color(active ? t.solid : t.input).bg(active ? t.solid : t.raised)
      .text_color(active ? t.solid_foreground : t.foreground).accessibility_label(label).tooltip(label)
      .when(disabled, (el) => el.opacity(0.5))
      .when(!disabled, (el) => el.hover((s) => s.opacity(0.85)))
      .on_click(action).child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(15));
    const label = (text) => div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const error = this.error ? div().pt(8).text_size(11.5).text_color(t.blocked).child(this.error) : null;

    if (this.loading) return v_flex().id("kanso-snippets").h_full().p(18).bg(t.popover).text_color(t.foreground).child("Loading snippets…");
    if (this.editor) {
      return v_flex().id("kanso-snippets").track_focus(this.handle).on_key_down((e, cx) => {
        if (e.key === "escape" && !p.panel) { this.editor = null; this.error = null; cx.notify(); cx.stop_propagation(); }
      }).h_full().w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
        .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(this.editor.id ? "Edit snippet" : "New snippet"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")))
        .child(label("Name"))
        .child(Input.new(this.name).h(34).px(10).rounded(7).border_1().border_color(t.input).bg(t.background).text_color(t.foreground))
        .when(this.editor.kind === "prompt", (el) => el.child(label("Agent prompts always open in a new tab")))
        .child(label("Type"))
        .child(h_flex().gap(8).children(KINDS.map((kind) => button(`snippet-kind-${kind}`, kind === "prompt" ? "bot" : "monitor", kind === "prompt" ? "Agent prompt" : "Terminal command", this.editor.kind === kind, (_e, cx) => { this.editor.kind = kind; cx.notify(); }))))
        .when(this.editor.kind === "terminal", (el) => el.child(label("Run in"))
          .child(h_flex().gap(8).children(["current", "new"].map((place) => Button.new(`snippet-place-${place}`).h(32).px(12).rounded(7).cursor_pointer()
            .border_1().border_color(this.place === place ? t.solid : t.input).bg(this.place === place ? t.solid : t.raised)
            .text_color(this.place === place ? t.solid_foreground : t.foreground)
            .on_click((_e, cx) => { this.place = place; cx.notify(); }).child(place === "current" ? "Current tab" : "New tab")))))
        .when(this.editor.kind === "prompt", (el) => el.child(label("Agent"))
          .child(this.agents?.length
          ? v_flex().h(Math.min(this.agents.length * 32, 240)).overflow_y_scrollbar().children(this.agents.map((agent) => Button.new(`snippet-agent-${agent.key}`).h(32).w_full().px(12).rounded(7)
              .border_1().border_color(this.agent === agent.key ? t.solid : t.input).bg(this.agent === agent.key ? t.solid : t.raised)
              .text_color(this.agent === agent.key ? t.solid_foreground : t.foreground)
              .accessibility_label(agent.name).tooltip(agent.name).on_click((_e, cx) => { this.agent = agent.key; cx.notify(); }).child(agent.name)))
            : div().text_size(11.5).text_color(this.agentError ? t.blocked : t.dim)
              .child(this.agentError ?? (this.agents ? "No agent found." : "Loading agents…"))))
        .when(this.place === "new", (el) => el.child(label("Working directory (relative to ~)"))
          .child(h_flex().gap(8).items_center()
            .child(Input.new(this.cwd).flex_1().h(34).px(10).rounded(7).border_1().border_color(t.input).bg(t.background).text_color(t.foreground))
            .child(button("snippet-browse", "folder", "Choose folder", false, (_e, cx) => this.browseFolder(cx)))))
        .child(label(this.editor.kind === "prompt" ? "Prompt" : "Command"))
        .child(Editor.new(this.body).flex_1().min_h(0).px(10).py(8).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
        .when(Boolean(error), (el) => el.child(error))
        .child(h_flex().pt(14).gap(8).justify_end()
          .child(button("snippet-cancel", "close", "Cancel", false, (_e, cx) => { this.editor = null; this.error = null; cx.notify(); }))
          .child(button("snippet-save", "save", this.saving ? "Saving" : "Save", true, (_e, cx) => {this.save(cx); cx.notify();}, this.saving)));
    }
    return v_flex().id("kanso-snippets").track_focus(this.handle).on_key_down((e, cx) => {
      if (e.key === "escape" && !p.panel) { closeOverlay(p.overlay); cx.stop_propagation(); }
    }).h_full().w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child("Snippets"))
      .child(button("snippet-new", "plus", "New snippet", true, (_e, cx) => this.edit(null, cx))))
      .when(Boolean(error), (el) => el.child(error))
      .child(this.snippets.length
        ? v_flex().flex_1().min_h(0).mt(12).overflow_y_scrollbar().children(this.snippets.map((snippet) => h_flex().id(`snippet-${snippet.id}`).flex_none().min_h(58).py(8).gap(10).items_center()
          .when(this.snippets.indexOf(snippet) > 0, (el) => el.border_t(1).border_color(t.border))
          .child(v_flex().flex_1().min_w(0).gap(3)
            .child(div().truncate().text_size(13).font_medium().child(snippet.name))
            .child(div().text_size(11).text_color(t.dim).child(snippet.kind === "prompt" ? "Agent prompt" : "Terminal command")))
          .child(button(`snippet-run-${snippet.id}`, "play", "Run snippet", false, (_e, cx) => this.run(snippet, cx), this.saving))
          .child(button(`snippet-copy-${snippet.id}`, "copy", snippet.kind === "prompt" ? "Copy prompt" : "Copy command", false, (_e, cx) => this.copy(snippet, cx)))
          .child(button(`snippet-edit-${snippet.id}`, "edit", "Edit snippet", false, (_e, cx) => this.edit(snippet, cx)))
          .child(button(`snippet-delete-${snippet.id}`, "trash", "Delete snippet", false, (_e, cx) => this.remove(snippet, cx), this.saving))))
        : div().flex_1().flex().items_center().justify_center().text_size(12.5).text_color(t.dim).child("No snippets yet. Add a prompt or terminal command."))
  }
}

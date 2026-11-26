import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, window, checking } from "herdr";
import { G, T } from "./ui.js";
import { toggleSwitch } from "./ui-toggle.js";
import { stateBlock } from "./ui-state.js";
import { paths } from "./platform-paths.js";

const SUPPORTED = new Set(["macos", "linux"]);

const lastLine = (text) => String(text ?? "").trim().split("\n").at(-1) ?? "";

export class ScriptSwitch {
  constructor(cx, { id, script, labels }) {
    this.id = id;
    this.script = script;
    this.labels = labels;
    this.platform = window()?.platform ?? "macos";
    this.on = null;
    this.busy = false;
    this.wanted = null;
    this.said = null;
    if (SUPPORTED.has(this.platform) && !checking()) cx.spawn(async (next) => { this.on = await this.status(); next.notify(); });
  }

  async run(verb) {
    return exec("sh", [paths.join(appHome(), "mods", ...this.script), verb], { timeout: 120_000 }).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
  }

  async status() {
    const r = await this.run("status");
    return r.code === 0 ? lastLine(r.stdout) === "on" : null;
  }

  label() { return this.labels[this.platform] ?? ""; }

  matches(query) {
    const q = String(query ?? "").trim().toLowerCase();
    return SUPPORTED.has(this.platform) && this.label().toLowerCase().includes(q);
  }

  set(next, cx) {
    this.busy = true;
    this.wanted = next;
    this.said = null;
    cx.notify();
    cx.spawn(async (after) => {
      const r = await this.run(next ? "install" : "uninstall");
      this.on = await this.status();
      this.said = r.code === 0 ? null : { text: lastLine(r.stderr) || lastLine(r.stdout) || "It could not be changed" };
      this.busy = false;
      this.wanted = null;
      after.notify();
    });
  }

  row(c, query) {
    if (!this.matches(query)) return null;
    const label = this.label(), looking = this.on === null && !this.busy;
    return v_flex().w_full().pt(G.lg).gap(G.sm)
      .child(h_flex().w_full().gap(G.md).items_center()
        .child(v_flex().flex_1().min_w(0).gap(G.hair)
          .child(div().text_size(T.card).text_color(c.text).child(label))
          .when(looking, (el) => el.child(div().text_size(T.body).text_color(c.dim).child("Looking…"))))
        .child(toggleSwitch(this.id, this.busy ? this.wanted === true : this.on === true, (next, cx) => this.set(next, cx), c, { label, disabled: this.busy || this.on === null })))
      .children(this.said ? [stateBlock(`${this.id}-error`, c, { text: this.said.text })] : []);
  }
}

export const markdownOpener = (cx) => new ScriptSwitch(cx, { id: "markdown-opener", script: ["kanso-tabs", "markdown-handler.sh"], labels: { macos: "Open .md files in kansō", linux: "Open .md and text files in kansō" } });
export const agentsTodo = (cx) => new ScriptSwitch(cx, { id: "agents-todo", script: ["kanso-panel", "kanso-todo"], labels: { macos: "Agents keep the to-do", linux: "Agents keep the to-do" } });

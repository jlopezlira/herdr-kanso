import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome, window, checking } from "herdr";
import { G, T } from "./ui.js";
import { toggleSwitch } from "./ui-toggle.js";
import { stateBlock } from "./ui-state.js";
import { paths } from "./platform-paths.js";

const SCRIPT = () => paths.join(appHome(), "mods", "kanso-tabs", "markdown-handler.sh");
const SUPPORTED = new Set(["macos", "linux"]);
const LABEL = "Open .md files in kansō";

const lastLine = (text) => String(text ?? "").trim().split("\n").at(-1) ?? "";

export class MarkdownOpener {
  constructor(cx) {
    this.platform = window()?.platform ?? "macos";
    this.on = null;
    this.busy = false;
    this.said = null;
    if (SUPPORTED.has(this.platform) && !checking()) cx.spawn(async (next) => { this.on = await this.status(); next.notify(); });
  }

  async run(verb) {
    return exec("sh", [SCRIPT(), verb], { timeout: 120_000 }).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
  }

  async status() {
    const r = await this.run("status");
    return r.code === 0 ? lastLine(r.stdout) === "on" : null;
  }

  set(next, cx) {
    this.busy = true;
    this.said = null;
    cx.notify();
    cx.spawn(async (after) => {
      const r = await this.run(next ? "install" : "uninstall");
      this.on = await this.status();
      this.said = r.code === 0 ? null : { text: lastLine(r.stderr) || lastLine(r.stdout) || "It could not be changed" };
      this.busy = false;
      after.notify();
    });
  }

  row(c) {
    if (!SUPPORTED.has(this.platform)) return null;
    const words = this.on === null && !this.busy ? "Looking…" : "A click on a .md path in a terminal shows it here, ready to edit.";
    return v_flex().w_full().pt(G.lg).gap(G.sm)
      .child(h_flex().w_full().gap(G.md).items_center()
        .child(v_flex().flex_1().min_w(0).gap(G.hair)
          .child(div().text_size(T.card).text_color(c.text).child(LABEL))
          .child(div().text_size(T.body).text_color(c.dim).child(words)))
        .child(toggleSwitch("markdown-opener", this.on === true, (next, cx) => this.set(next, cx), c, { label: LABEL, disabled: this.busy || this.on === null })))
      .children(this.said ? [stateBlock("markdown-opener-error", c, { text: this.said.text })] : []);
  }
}

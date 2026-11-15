// Derived from the `prompt` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): the same dialog Herdr
// uses to rename a space or a tab, for what Herdr has no command for: a terminal's name, kept as a
// label on the terminal in herdr-core.
import { View } from "gpui-kit";
import { tokens } from "./ui.js";
import { dialog } from "./ui-dialog.js";
import { field, TextField } from "./ui-field.js";
import { run, hc, props, closeOverlay, theme, shared, setShared } from "herdr";

export default class Prompt extends View {
  init(_props, cx) {
    this.text = props()?.value ?? "";
    this.input = new TextField({ value: this.text });
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", () => this.submit());
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  submit() {
    const p = props();
    closeOverlay(p.overlay);
    const name = this.text.trim();
    if (p.label) hc(["label", p.label.terminal, `${p.label.key}=${name}`]).catch(() => {});
    else if (p.command) run(p.command.name, { ...(p.command.args ?? {}), name });
    // A mod with no command for it reads the answer from shared state: under `shared`, by this dialog's `token`, so two
    // dialogs answered in a row both keep theirs until read; `text` null when cancelled.
    else if (p.shared) this.answer(p, name);
  }

  answer(p, text) {
    const box = shared(p.shared);
    setShared(p.shared, { ...(box && typeof box === "object" && !Array.isArray(box) ? box : {}), [p.token ?? "answer"]: { text, at: Date.now() } });
  }

  cancel() {
    const p = props();
    closeOverlay(p.overlay);
    if (p.shared) this.answer(p, null);
  }

  render() {
    const p = props() ?? {};
    const c = tokens(theme());
    return dialog("prompt", c, {
      title: (p.title ?? "").replace(/^./, (c) => c.toUpperCase()),
      body: field("pm-input", this.input, c, { label: p.field ?? "Name" }),
      notes: p.hint ? [{ text: p.hint }] : [],
      secondary: "Cancel", primary: p.button ?? "Save",
      onCancel: () => this.cancel(), onPrimary: () => this.submit(), focusHandle: this.handle,
    });
  }
}

// Derived from the `prompt` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): the same dialog Herdr
// uses to rename a space or a tab, for what Herdr has no command for: a terminal's name, kept as a
// label on the terminal in herdr-core.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { button, field, TextField, G, tokens } from "./ui.js";
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

  key(e, cx) {
    if (e.key === "escape") { this.cancel(); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const c = tokens(t);
    return v_flex().id("prompt").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child((p.title ?? "").replace(/^./, (c) => c.toUpperCase())))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(field("pm-input", this.input, c, { label: p.field ?? "Name" }).pt(G.lg))
      .when(Boolean(p.hint), el => el.child(div().pt(6).text_size(11.5).text_color(t.dim).child(p.hint)))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("pm-cancel", "Cancel", () => this.cancel(), c, { kind: "quiet" }))
        .child(button("pm-save", p.button ?? "Save", () => this.submit(), c)));
  }
}

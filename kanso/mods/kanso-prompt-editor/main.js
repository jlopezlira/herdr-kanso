// Derived from the `prompt` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): the same dialog Herdr
// uses to rename a space or a tab, for what Herdr has no command for: a terminal's name, kept as a
// label on the terminal in herdr-core.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { button, tokens } from "./ui.js";
import { run, hc, props, closeOverlay, theme } from "herdr";

export default class PromptEditor extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.text = p.value ?? "";
    this.input = EditorState.new({ value: this.text, language: "plain", soft_wrap: true, line_numbers: false, folding: false });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.handle = cx.focus_handle();
  }

  submit() {
    const p = props();
    closeOverlay(p.overlay);
    const name = this.text.trim();
    if (p.label) hc(["label", p.label.terminal, `${p.label.key}=${name}`]).catch(() => {});
    else if (p.command) run(p.command.name, { ...(p.command.args ?? {}), [p.command.key ?? "name"]: name });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const label = (text) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(text);
    const c = tokens(t);
    return v_flex().h_full().id("prompt").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().min_h(0).p(18).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child((p.title ?? "").replace(/^./, (c) => c.toUpperCase())))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label(p.title ?? "Name"))
      .child(Editor.new(this.input).flex_1().min_h(0).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .when(Boolean(p.hint), el => el.child(div().pt(6).text_size(11.5).text_color(t.dim).child(p.hint)))
      .child(h_flex().pt(20).gap(8).justify_end()
        .child(button("pm-cancel", "Cancel", () => closeOverlay(p.overlay), c, { kind: "quiet" }))
        .child(button("pm-save", p.submit_button_title ?? "Save", () => this.submit(), c)));
  }
}

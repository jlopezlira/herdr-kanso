// The answer both rename dialogs give, the field that keeps the view's text, and the view both are.
import { View } from "gpui-kit";
import { run, hc, props, theme } from "herdr";
import { tokens } from "./ui.js";
import { dialog } from "./ui-dialog.js";
import { field } from "./ui-field.js";

// A terminal's label, or a command with the new name; false when the dialog has neither to serve.
export function applyRename(p, name) {
  if (p.label) {
    hc(["label", p.label.terminal, `${p.label.key}=${name}`]).catch(() => {});
    return true;
  }
  if (!p.command) return false;
  run(p.command.name, { ...(p.command.args ?? {}), [p.command.key ?? "name"]: name });
  return true;
}

// The field writes the view's text and asks for the redraw.
export const trackText = (input, set) => input.on("change", (_e, cx) => { set(input.value()); cx.notify(); });

// The view both rename dialogs are: `makeField(value)` makes its field from the value it opens with, `labels(p)` names
// the field and the answer, `submit` answers and `cancel` (Cancel and Escape) answers nothing.
// The field has the keyboard as the dialog opens, and again once the overlay has the window's.
export class RenameView extends View {
  init(_props, cx) {
    this.text = props()?.value ?? "";
    this.input = this.makeField(this.text);
    trackText(this.input, (text) => { this.text = text; });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  // Its title capitalised, the one field, the hint as a note, Cancel before the answer.
  render() {
    const p = props() ?? {};
    const { label, primary } = this.labels(p);
    const c = tokens(theme());
    return dialog("prompt", c, {
      title: (p.title ?? "").replace(/^./, (ch) => ch.toUpperCase()),
      body: field("pm-input", this.input, c, { label }),
      notes: p.hint ? [{ text: p.hint }] : [],
      secondary: "Cancel", primary,
      onCancel: () => this.cancel(), onPrimary: () => this.submit(), focusHandle: this.handle,
    });
  }
}

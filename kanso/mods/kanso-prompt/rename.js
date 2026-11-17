// The answer both rename dialogs give, the field that keeps the view's text, and the dialog both draw.
import { run, hc, props } from "herdr";
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

// The view's field, made by `make` from the value it opens with: it keeps the view's text,
// and has the keyboard as the dialog opens and again once the overlay has the window's.
export function holdField(view, cx, make) {
  view.text = props()?.value ?? "";
  view.input = make(view.text);
  trackText(view.input, (text) => { view.text = text; });
  view.input.focus();
  cx.timer.after(600, () => view.input.focus());
  view.handle = cx.focus_handle();
}

// The dialog both draw: its title capitalised, the one field under `label`, the hint as a note, Cancel before `primary`.
// Cancel and Escape run the view's `cancel`, the primary its `submit`.
export const renameDialog = (view, c, p, { label, primary }) => dialog("prompt", c, {
  title: (p.title ?? "").replace(/^./, (ch) => ch.toUpperCase()),
  body: field("pm-input", view.input, c, { label }),
  notes: p.hint ? [{ text: p.hint }] : [],
  secondary: "Cancel", primary,
  onCancel: () => view.cancel(), onPrimary: () => view.submit(), focusHandle: view.handle,
});

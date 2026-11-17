// The answer both rename dialogs give, and the field that keeps the view's text.
import { run, hc } from "herdr";

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

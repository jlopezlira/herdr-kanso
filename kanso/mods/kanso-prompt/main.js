// Derived from the `prompt` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): the same dialog Herdr
// uses to rename a space or a tab, for what Herdr has no command for: a terminal's name, kept as a
// label on the terminal in herdr-core.
import { TextField } from "./ui-field.js";
import { applyRename, RenameView } from "./rename.js";
import { props, closeOverlay, shared, setShared } from "herdr";

export default class Prompt extends RenameView {
  // The name is chosen whole before the field takes the keyboard, so typing replaces it; Enter answers.
  makeField(value) {
    const input = new TextField({ value });
    if (value) input.set_selected_range({ start: 0, end: value.length });
    input.on("submit", () => this.submit());
    return input;
  }

  labels(p) {
    return { label: p.field ?? "Name", primary: p.button ?? "Save" };
  }

  submit() {
    const p = props();
    const name = this.text.trim();
    closeOverlay(p.overlay);
    // A mod with no command for it reads the answer from shared state: under `shared`, by this dialog's `token`, so two
    // dialogs answered in a row both keep theirs until read; `text` null when cancelled.
    if (!applyRename(p, name) && p.shared) this.answer(p, name);
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
}

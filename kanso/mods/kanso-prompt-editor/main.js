// Derived from the `prompt` mod shipped with Herdr (Apache-2.0, https://github.com/herdrdev/herdr-app).
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): the same dialog Herdr
// uses to rename a space or a tab, for what Herdr has no command for: a terminal's name, kept as a
// label on the terminal in herdr-core.
import { TextField } from "./ui-field.js";
import { applyRename, RenameView } from "./rename.js";
import { props, closeOverlay } from "herdr";

// A prompt of many lines: Enter writes a new line, Escape and Cancel close it, Save sends it.
export default class PromptEditor extends RenameView {
  makeField(value) {
    return new TextField({ value }, { multiline: true });
  }

  labels(p) {
    return { label: p.title ?? "Name", primary: p.submit_button_title ?? "Save" };
  }

  submit() {
    const p = props();
    closeOverlay(p.overlay);
    applyRename(p, this.text.trim());
  }

  cancel() {
    closeOverlay(props().overlay);
  }
}

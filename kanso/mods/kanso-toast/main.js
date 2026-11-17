// Kanso's notifications, by jlopezlira (https://github.com/jlopezlira/herdr-kanso).
// Apache-2.0; derived from Herdr's shipped `toast` mod.
// Herdr stacks every toast it is given, the same one as many times as it is posted: a burst of clicks
// fills the screen. Here a toast already on screen is not shown again, and the stack keeps the newest few.
import { View } from "gpui-kit";
import { props, closeOverlay, run, theme, shared, setShared } from "herdr";
import { sorted, admit, marked, keep } from "./stack.js";
import { toastOf, commandOf } from "./toast-model.js";
import { tokens } from "./ui.js";
import { toast } from "./kit.js";

const KEY = "kanso.toasts";
// This window's mods, as they run now: the top of the file runs once for all their copies.
const MARK = `${Date.now()}-${Math.random()}`;

export default class Toast extends View {
  init(_props, _cx) {
    const p = props() ?? {}, now = Date.now();
    const { show, close, next } = admit(this.mine(), p, now);
    close.forEach(closeOverlay);
    setShared(KEY, keep(shared(KEY), MARK, next, now));
    if (!show) closeOverlay(p.overlay);
  }

  mine() { return marked(shared(KEY))[MARK]; }

  dismiss() {
    const p = props() ?? {}, now = Date.now(), { showing, late } = sorted(this.mine(), now);
    [...late, p.overlay].forEach(closeOverlay);
    setShared(KEY, keep(shared(KEY), MARK, showing.filter((s) => s.id !== p.overlay), now));
  }

  act() {
    const command = commandOf(props() ?? {});
    if (command) run(command.name, command.args);
    this.dismiss();
  }

  render(_cx) {
    return toast(toastOf(props() ?? {}))("toast", tokens(theme()), { onClick: () => this.act() });
  }
}

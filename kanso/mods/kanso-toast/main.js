// Kanso's notifications, by jlopezlira (https://github.com/jlopezlira/herdr-kanso).
// Apache-2.0; derived from Herdr's shipped `toast` mod.
// Herdr stacks every toast it is given, the same one as many times as it is posted: a burst of clicks
// fills the screen. Here a toast already on screen is not shown again, and the stack keeps the newest few.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, shared, setShared } from "herdr";
import { sorted, admit, marked, keep } from "./stack.js";

const KEY = "kanso.toasts";
// This window's mods, as they run now: the top of the file runs once for all their copies.
const MARK = `${Date.now()}-${Math.random()}`;
const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

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

  render(_cx) {
    const t = theme();
    const p = props() ?? {};
    return h_flex()
      .id("toast")
      .size_full()
      .px(18)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        this.dismiss();
      })
      .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"]))
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(p.title ?? ""))
          .when(Boolean(p.body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(p.body ?? ""))),
      );
  }
}

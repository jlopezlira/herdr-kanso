// Kanso's notifications, by jlopezlira (https://github.com/jlopezlira/herdr-kanso).
// Apache-2.0; derived from Herdr's shipped `toast` mod.
// Herdr stacks every toast it is given, the same one as many times as it is posted: a burst of clicks
// fills the screen. Here a toast already on screen is not shown again, and the stack keeps the newest few.
import { View, div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, shared, setShared } from "herdr";
import { sorted, admit, marked, keep } from "./stack.js";
import { leadOf, tipOf, fixOf, commandOf } from "./toast-model.js";
import { G, T, ICON_ROW, glyphOf, tokens } from "./ui.js";
import { mark } from "./ui-mark.js";
import { dot } from "./ui-dot.js";
import { button } from "./ui-button.js";

const KEY = "kanso.toasts";
// This window's mods, as they run now: the top of the file runs once for all their copies.
const MARK = `${Date.now()}-${Math.random()}`;
// One drawing for each lead leadOf names.
const LEADS = {
  mark: (c) => mark(c, { status: "blocked" }),
  image: (_c, { icon }) => image(icon).w(ICON_ROW).h(ICON_ROW).flex_none(),
  glyph: (c, { icon, tone }) => svg(glyphOf(icon)).size(ICON_ROW).flex_none().text_color(c[tone]),
  dot: (c, { tone }) => dot(c, tone),
};
const lead = (c, p) => {
  const found = leadOf(p);
  return LEADS[found.kind](c, found);
};

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
    const c = tokens(theme()), p = props() ?? {}, fix = fixOf(p);
    return h_flex()
      .id("toast")
      .size_full()
      .pl(G.md)
      .pr(G.sm)
      .gap(G.sm)
      .items_center()
      .bg(c.popover)
      .cursor_pointer()
      .hover((s) => s.bg(c.subtle))
      .tooltip(tipOf(p))
      .on_click(() => this.act())
      .child(lead(c, p))
      .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(T.value).text_color(c.text).child(p.title ?? ""))
      .when(Boolean(fix), (el) => el.child(button("toast-fix", fix, (cx) => { cx.stop_propagation(); this.act(); }, c, { kind: "tonal", small: true })));
  }
}

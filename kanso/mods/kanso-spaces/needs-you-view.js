import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { G, H, R, T, tokens, quietLink, skeleton } from "./ui.js";
import { waitingReason, queueMessage } from "./needs-you.js";

export function queueLabel(queue, collapsed, empty) {
  if (empty) return queueMessage(queue.state);
  if (collapsed) return String(queue.rows.length);
  return `Needs you · ${queue.rows.length}`;
}

export function queueControl(t, queue, collapsed, empty, toggle) {
  const count = queue.rows.length;
  if (!count && !empty) return div();
  const c = tokens(t), spoken = `Needs you: ${count}`;
  return h_flex().flex_none().px(G.sm).child(quietLink("needs-you-count", queueLabel(queue, collapsed, empty), toggle, c,
    { size: T.body, label: spoken, color: count ? c.text : c.dim }).tooltip(spoken));
}

export function queueList(t, queue, rowFor, age, scroll = null) {
  const c = tokens(t);
  const line = (text, color) => div().text_size(T.body).text_color(color).child(text);
  return v_flex().id("needs-you-list").flex_1().min_h(0).px(G.sm).gap(G.xs).overflow_y_scrollbar()
    .when(Boolean(scroll), (el) => el.track_scroll(scroll))
    .children(queue.rows.map((row) => {
      const { selected, go } = rowFor(row);
      return quietLink(`needs-you-${row.address}`, "", go, c, { label: `${row.project}, ${row.name}, ${waitingReason(row)}` })
        .h_auto().min_h(H.control).w_full().px(G.sm).py(G.xs).rounded(R.control)
        .when(selected, (el) => el.bg(c.selected))
        .child(v_flex().min_w(0).gap(G.xs)
          .child(div().truncate().text_size(T.value).text_color(c.text).child(row.name))
          .child(div().truncate().text_size(10.5).text_color(c.dim).child(row.project))
          .child(h_flex().gap(G.sm).child(line(waitingReason(row), c.muted)).child(line(age(row), c.dim))));
    }))
    .when(queue.state === "loading", (el) => el.child(skeleton(c).row(0, H.control)))
    .when(queue.state === "unavailable" || (!queue.rows.length && queue.state === "ready"),
      (el) => el.child(line(queueMessage(queue.state), c.dim)));
}

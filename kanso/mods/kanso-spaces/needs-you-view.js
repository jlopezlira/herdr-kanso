import { h_flex, v_flex } from "gpui-base";
import { G, SIDEBAR, tokens } from "./ui.js";
import { button, emptyState, failureBlock, skeletonOf, tooltip } from "./kit.js";
import { sessionRow } from "./session-row.js";
import { boundChord } from "./ui-tooltip.js";
import { programOf } from "./agents.js";
import { waitingReason, queueMessage } from "./needs-you.js";

// The key that goes to the next agent that needs you, named in the count's tooltip.
const NEXT_NEEDS = "kanso-spaces.needs-you.next";

export function queueLabel(queue, collapsed, empty) {
  if (empty) return queueMessage(queue.state);
  if (collapsed) return String(queue.rows.length);
  return `Needs you · ${queue.rows.length}`;
}

// The count: a quiet Button that opens and shuts the queue; its tooltip names the next key.
export function queueControl(t, queue, collapsed, empty, toggle) {
  const count = queue.rows.length;
  if (!count && !empty) return null;
  const spoken = `Needs you: ${count}`;
  return h_flex().flex_none().px(G.sm).child(button({ label: queueLabel(queue, collapsed, empty), kind: "quiet", size: "sm", spoken,
    tip: tooltip({ label: spoken, chord: boundChord(NEXT_NEEDS) }) })("needs-you-count", tokens(t), { onClick: toggle }));
}

// Each waiting agent is its session row, the project after the name; then the queue's state: loading, unavailable or empty.
const sessionOf = (row, age, selected) => sessionRow({ program: programOf({ program: row.icon && { icon: row.icon, tint: row.tint } }), name: row.name,
  activity: waitingReason(row), time: age(row), place: row.project, status: row.status, depth: 0, selected, pinnable: false, menu: false });
const STATES = {
  loading: () => skeletonOf({ shape: "row" }),
  unavailable: (queue) => failureBlock({ text: queueMessage(queue.state) }),
  ready: (queue) => (queue.rows.length ? null : emptyState({ text: queueMessage(queue.state) })),
};

export function queueList(t, queue, rowFor, age, scroll = null) {
  const c = tokens(t);
  const state = STATES[queue.state]?.(queue);
  return v_flex().id("needs-you-list").flex_1().min_h(0).px(G.sm).gap(SIDEBAR.gap).overflow_y_scrollbar()
    .when(Boolean(scroll), (el) => el.track_scroll(scroll))
    .children(queue.rows.map((row) => {
      const { selected, go } = rowFor(row);
      return sessionOf(row, age, selected)(`needs-you-${row.address}`, c, { onClick: go });
    }))
    .when(Boolean(state), (el) => el.child(state(`needs-you-${queue.state}`, c)));
}

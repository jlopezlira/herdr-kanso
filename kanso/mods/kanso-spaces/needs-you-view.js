import { h_flex, v_flex } from "gpui-base";
import { SIDEBAR, sidebarSides, tokens } from "./ui.js";
import { button, failureBlock, skeletonOf, tooltip } from "./kit.js";
import { sessionRow } from "./session-row.js";
import { boundChord } from "./ui-tooltip.js";
import { programOf } from "./agents.js";
import { waitingReason, queueMessage, cantReach } from "./needs-you.js";

// The key that goes to the next agent that needs you, named in the count's tooltip.
const NEXT_NEEDS = "kanso-spaces.needs-you.next";

const AS_IS = Object.freeze({ title: (name) => name, retry: () => {} });

export function queueLabel(queue, collapsed, empty, title = AS_IS.title) {
  if (empty) return queueMessage(queue, title);
  if (collapsed) return String(queue.rows.length);
  return `Needs you · ${queue.rows.length}`;
}

// The count: a quiet Button that opens and shuts the queue; its tooltip names the next key.
export function queueControl(t, queue, collapsed, empty, toggle, title = AS_IS.title) {
  const count = queue.rows.length;
  if (!count && !empty) return null;
  const spoken = `Needs you: ${count}`;
  return sidebarSides(h_flex().flex_none(), SIDEBAR.gutter).child(button({ label: queueLabel(queue, collapsed, empty, title), kind: "quiet", size: "sm", spoken,
    tip: tooltip({ label: spoken, chord: boundChord(NEXT_NEEDS) }) })("needs-you-count", tokens(t), { onClick: toggle }));
}

const sessionOf = (row, age, selected) => sessionRow({ program: programOf({ program: row.icon && { icon: row.icon, tint: row.tint } }), name: row.name,
  activity: waitingReason(row), time: age(row), place: row.project, status: row.status, depth: 0, selected, pinnable: false, menu: false });
const stateOf = (queue, c, { title, retry }) => [
  ...(queue.state === "loading" ? [skeletonOf({ shape: "row" })("needs-you-loading", c)] : []),
  ...(queue.unreachable ?? []).map((name) => failureBlock({ text: cantReach([title(name)]), fix: "Refresh" })(`needs-you-unavailable-${name}`, c, { onClick: (cx) => retry(name, cx) })),
];

export function queueList(t, queue, rowFor, age, scroll = null, computer = AS_IS) {
  if (queue.state === "ready" && !queue.rows.length) return null;
  const c = tokens(t);
  return sidebarSides(v_flex().id("needs-you-list").flex_1().min_h(0), SIDEBAR.gutter).gap(SIDEBAR.gap).overflow_y_scrollbar()
    .when(Boolean(scroll), (el) => el.track_scroll(scroll))
    .children(queue.rows.map((row) => {
      const { selected, go } = rowFor(row);
      return sessionOf(row, age, selected)(`needs-you-${row.address}`, c, { onClick: go });
    }))
    .children(stateOf(queue, c, computer));
}

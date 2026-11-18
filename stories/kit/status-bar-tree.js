// The status bar as one tree: the bar, an item, who needs you, and panes per view, the same marks the Storybook writes.
import { html } from "./tree.js";
import { buttonTree, markTree } from "./row-tree.js";
import { plus } from "../../kanso/mods/kanso-panel/ui-facts.js";

const inlineIcon = (icon) => html`<svg class="kanso-icon kanso-icon--inline"><use href="#${icon}"/></svg>`;

export const statusItemTree = ({ icon = "", mark: status = "", text = "", tone = "", pending = false, open = false, hover = false } = {}) => {
  const classes = ["kanso-status-bar__item", tone && `kanso-text--${tone}`, pending && "kanso-state-line--pending", open && "kanso-status-bar__item--open", hover && "kanso-row--hover"].filter(Boolean).join(" ");
  const lead = status ? markTree({ status, size: "sm" }) : icon ? inlineIcon(icon) : null;
  const words = text === "" || text === null ? null : html`<span>${String(text)}</span>`;
  const dot = pending ? html`<i class="kanso-state-line__pending-dot"></i>` : null;
  return html`<span class="${classes}">${lead}${words}${dot}</span>`;
};

export const failureLineTree = ({ text, fix, detail = "" }) => {
  const body = [markTree({ status: "blocked" }), text, buttonTree({ label: fix, kind: "quiet", size: "sm" })];
  return detail ? html`<span class="kanso-state-line" title="${detail}">${body}</span>` : html`<span class="kanso-state-line">${body}</span>`;
};

export const needsItemTree = ({ name, question = "", more = 0 }) => html`<span class="kanso-status-bar__item kanso-status-bar__needs">${markTree({ status: "blocked", size: "sm" })}<span class="kanso-status-bar__name">${name}</span>${question ? html`<span class="kanso-status-bar__question">${question}</span>` : null}${more ? html`<span class="kanso-status-bar__more">${plus(more)}</span>` : null}</span>`;

const columnPanes = ({ width, panes }) => html`<span class="${["kanso-status-bar__column", panes.length > 1 && "kanso-status-bar__column--stacked"].filter(Boolean).join(" ")}">${panes.map((tone) => html`<i class="kanso-status-bar__pane kanso-status-bar__pane--${tone}" data-width="${`calc(var(--k-w-line) * ${Number(width)})`}"></i>`)}</span>`;
const columnButton = (column, i) => html`<span class="kanso-button kanso-button--quiet kanso-text--fg kanso-button--sm kanso-button--drawn" tabindex="0" title="${`Column ${i + 1}`}">${columnPanes(column)}</span>`;
const minimap = (columns) => (columns.length ? html`<span class="kanso-status-bar__columns">${columns.map(columnButton)}</span>` : null);

export const stepperTree = ({ value = 2, open = false, hover = false, columns = [] } = {}) => {
  const classes = ["kanso-status-bar__item", "kanso-status-bar__stepper", open && "kanso-status-bar__item--open", hover && "kanso-control--hover"].filter(Boolean).join(" ");
  const shown = `${Number(value)} per view · scroll to change, click to even out`;
  return html`<span class="${classes}">${minimap(columns)}${buttonTree({ label: "Fewer panes per view ⌘⇧−", kind: "icon", size: "sm", icon: "lu-minus" })}<span class="kanso-status-bar__value" title="${shown}">${Number(value)}</span>${buttonTree({ label: "More panes per view ⌘⇧=", kind: "icon", size: "sm", icon: "lu-plus" })}</span>`;
};

export const computerItemTree = ({ name, remote = true, state = "on", folded = false, detail = null }) => (state === "unreachable"
  ? failureLineTree({ text: `Can't reach ${name}`, fix: "Refresh", detail })
  : statusItemTree({ icon: remote ? "lu-server" : "lu-monitor", text: folded ? null : name, pending: state === "pending" }));

export const paletteDoorTree = () => buttonTree({ label: "Command palette ⌘⇧P", kind: "icon", size: "sm", icon: "lu-command" });
export const layoutPausedTree = ({ detail = null } = {}) => failureLineTree({ text: "Layout paused", fix: "Resume", detail });

const halves = { left: "kanso-status-bar__left", middle: "kanso-status-bar__middle", right: "kanso-status-bar__right" };
const half = (side, items) => html`<div class="${halves[side]}">${items}</div>`;

export const statusBarTree = ({ left = [], middle = null, right = [], popup = null } = {}) => html`<div class="kanso-status-bar kanso-status-bar--grid">${half("left", left)}${half("middle", middle)}${half("right", right)}${popup ? html`<div class="kanso-status-bar__popup">${popup}</div>` : null}</div>`;

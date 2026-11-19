import { html } from "./tree.js";
import { buttonTree, glyphTree, growTree, markTree } from "./row-tree.js";

const tabStates = (item, on, square) => [on && "kanso-tabs__tab--on", square && "kanso-tabs__tab--icon", item.armed && "kanso-action--armed",
  item.pending && "kanso-state-line--pending", item.held && "kanso-control--held"].filter(Boolean).map((name) => ` ${name}`).join("");

export const tabTree = (item, { on = false, icon = false, named = true } = {}) => {
  const square = icon && !named;
  const label = item.label ?? "";
  const name = item.editing ? html`<div class="kanso-field kanso-field--inline"></div>` : html`<span class="kanso-tabs__label">${label}</span>`;
  const dot = (item.dot || (square && item.mark === "blocked")) && !on ? html`<i class="kanso-tabs__dot"></i>` : null;
  const close = on && item.closable && !square && !item.editing ? html`<svg class="kanso-icon kanso-tabs__close"><use href="#lu-x"/></svg>` : null;
  const landing = item.drop ? html`<i class="kanso-tabs__insertion"></i>` : null;
  return [item.drop === "after" ? null : landing,
    html`<span class="kanso-tabs__tab${tabStates(item, on, square)}" role="tab" aria-selected="${String(on)}" aria-label="${label}" tabindex="0" title="${square ? label : item.tip ?? ""}">${icon && item.icon ? glyphTree(item.icon) : null}${named || !item.icon ? name : null}${item.pending ? html`<i class="kanso-state-line__pending-dot"></i>` : null}${item.mark && !square ? markTree({ status: item.mark }) : null}${dot}${close}</span>`, item.drop === "after" ? landing : null];
};

export const tabsTree = ({ items = [], value = null, size = "md", track = false, disabled = false, icon = false, label: named = false }) => {
  const classes = ["kanso-tabs", size !== "md" && `kanso-tabs--${size}`, track && "kanso-tabs--track", disabled && "kanso-control--off"].filter(Boolean).join(" ");
  const tabs = items.map((item) => tabTree(item, { on: item.key === value, icon, named }));
  return disabled ? html`<div class="${classes}" role="tablist" aria-disabled="true">${tabs}</div>` : html`<div class="${classes}" role="tablist">${tabs}</div>`;
};

const door = (icon, label, active = false, tip = "") => buttonTree({ label, kind: icon ? "icon" : "quiet", icon: icon || "none", active, tip });
const skeleton = () => html`<span class="kanso-skeleton kanso-skeleton--breathing kanso-tab-bar__skeleton"></span>`;

export const tabBarTree = ({ items = [], value = null, folded = 0, panels = [], panel = null, state = "connected", arrange = true, help = false, tips = {}, windows = false } = {}) => {
  const connected = state === "connected";
  const tabs = state === "connecting" ? Array.from({ length: Math.max(items.length, 1) }, skeleton)
    : tabsTree({ items: items.map((item) => ({ closable: true, ...item })), value, disabled: state === "unreachable", label: true });
  const more = folded && connected ? html`<span class="kanso-tab-bar__more">${buttonTree({ label: `+${folded}`, kind: "quiet" })}</span>` : null;
  const tools = connected ? [door("lu-plus", "New tab", false, tips["New tab"]), arrange ? door("lu-panels-top-left", "Arrange", false, tips.Arrange) : null] : null;
  const right = connected ? panels.map(({ key, icon, label }) => door(icon, label, key === panel, tips[label])) : null;
  const own = help ? door("lu-circle-question-mark", "kansō help", false, tips["kansō help"]) : null;
  const system = windows ? [door("lu-minus", "Minimize"), door("lu-square", "Maximize"), door("lu-x", "Close")] : null;
  return html`<div class="kanso-tab-bar">${tabs}${more}${tools}${growTree()}<span class="kanso-tab-bar__doors">${right}${own}${system}</span></div>`;
};

import { html } from "./tree.js";

export const kinds = { solid: "kanso-button--solid", tonal: "kanso-button--tonal", quiet: "kanso-button--quiet kanso-text--fg", icon: "kanso-button--icon" };
export const buttonClasses = ({ kind = "solid", size = "md", disabled = false, armed = false, active = false, spin = false, focus = false, held = false, drawn = false, flush = false, truncate = false }) => ["kanso-button", kinds[kind],
  size === "md" ? "" : `kanso-button--${size}`, disabled ? "kanso-control--off" : "", armed ? "kanso-action kanso-action--armed" : "", active ? "kanso-button--active" : "", spin ? "kanso-button--spinning" : "",
  focus ? "kanso-control--focus" : "", held ? "kanso-control kanso-control--held" : "", drawn ? "kanso-button--drawn" : "", flush ? "kanso-button--flush" : "", truncate ? "kanso-button--truncate" : ""].filter(Boolean).join(" ");
const marks = { working: "e-work", blocked: "e-blk", done: "e-done", idle: "e-idle", asleep: "lu-moon" };
const markSizes = { sm: " kanso-icon--inline", md: "", lg: " kanso-icon--control" };

const iconTree = (icon, size, tone = "") => html`<svg class="${tone ? `kanso-text--${tone} ` : ""}${icon.startsWith("p-") ? "kanso-icon--program" : size === "row" ? "kanso-icon kanso-icon--row" : "kanso-icon"}"><use href="#${icon}"/></svg>`;
export const glyphTree = (icon, tone = "") => iconTree(icon, "row", tone);
export const markTree = ({ status, size = "md" }) => html`<svg class="kanso-mark kanso-mark--${status}${markSizes[size]}"><use href="#${marks[status]}"/></svg>`;
export const keyHintTree = ({ text, faint = false, recording = false }) => html`<span class="kanso-key${faint ? " kanso-text--dim" : ""}${recording ? " kanso-key--recording kanso-ring--accent kanso-text--accent" : ""}">${text}</span>`;
export const chipTree = ({ label, quiet = false, pill = false, tone = "" }) => html`<span class="kanso-badge${quiet ? " kanso-badge--quiet" : ""}${pill ? " kanso-badge--pill" : ""}${tone ? ` kanso-text--${tone}` : ""}">${String(label)}</span>`;
export const growTree = () => html`<span class="kanso-layout__grow"></span>`;

export const buttonTree = ({ label, kind = "solid", size = "md", icon = "none", disabled = false, verb = "", armed = false, active = false, spin = false, key = "", tip = "", focus = false, held = false, truncate = false }) => {
  const classes = buttonClasses({ kind, size, disabled, armed, active, spin, focus, held, truncate });
  const lead = icon === "none" ? (spin ? markTree({ status: "working", size: "sm" }) : null) : iconTree(icon, "control");
  const text = kind === "icon" ? null : truncate ? html`<span class="kanso-button__label">${label}</span>` : label;
  const again = `Press again to ${verb || label.toLowerCase()}`;
  const inner = armed && kind !== "icon" ? html`<span>${text}</span><span>${again}</span>` : [lead, text, key ? [" ", keyHintTree({ text: key })] : null];
  const title = armed && kind === "icon" ? again : tip || label;
  if (disabled && spin) return html`<span class="${classes}" title="${title}" aria-disabled="true" aria-busy="true">${inner}</span>`;
  if (disabled) return html`<span class="${classes}" title="${title}" aria-disabled="true">${inner}</span>`;
  if (spin) return html`<span class="${classes}" tabindex="0" title="${title}" aria-busy="true">${inner}</span>`;
  return html`<span class="${classes}" tabindex="0" title="${title}">${inner}</span>`;
};

const markedClass = ({ tone }, base = "") => [base, tone && `kanso-text--${tone}`].filter(Boolean).join(" ");
const fact = (part) => {
  if (typeof part === "string") return html`<span>${part}</span>`;
  if (part.label) return buttonTree({ label: part.text, kind: "quiet", size: "sm", tip: part.tip || part.label });
  return [part.icon ? html`<svg class="kanso-icon kanso-icon--inline"><use href="#${part.icon}"/></svg>` : null, spanOf(part)];
};
const factOf = (part) => (typeof part === "object" ? part : { text: part });
const wrapped = ({ tone, tip, cls: given }, inner) => {
  const cls = given ?? markedClass({ tone });
  if (cls && tip) return html`<span class="${cls}" title="${tip}">${inner}</span>`;
  if (cls) return html`<span class="${cls}">${inner}</span>`;
  if (tip) return html`<span title="${tip}">${inner}</span>`;
  return html`<span>${inner}</span>`;
};
const spanOf = (part, base = "") => wrapped({ tip: part.tip, cls: markedClass(part, base) }, part.text);
const countOf = (count) => (typeof count === "object" ? wrapped(count, chipTree({ label: count.label })) : chipTree({ label: count }));
const guide = (kind, level) => (kind ? html`<span class="kanso-row__guide kanso-row__guide--${kind} kanso-row__guide--level-${level}"></span>` : null);
const rowTool = (action) => buttonTree({ kind: "icon", size: "sm", ...action });

export const rowTree = ({ icon = "none", tone = "", name, detail, meta, chip: count, flag, mark: status = "none", second, heading, title, depth = 0, glint, wrap, selected, current, dimmed, pending, hover, focus, actions = [], action, start = [], tools = [], keys = [], drop, wash, guides = [] }) => {
  const lines = guides.length ? guides : depth > 1 ? [null, "pass"] : [];
  const lead = [lines.map(guide), start, icon === "none" ? null : glyphTree(icon, tone)];
  const label = html`<span class="kanso-row__name${glint ? " kanso-text--glint" : ""}">${name}</span>`;
  const facts = [].concat(detail ?? []).filter(Boolean);
  const tail = [
    facts.length ? html`<span class="kanso-row__detail">${facts.map(fact)}</span>` : null, growTree(),
    meta ? spanOf(factOf(meta), "kanso-row__meta") : null, flag ? html`<span class="kanso-row__flag">${glyphTree(flag)}</span>` : null,
    actions.length ? html`<span class="kanso-row__actions">${actions.map(rowTool)}</span>` : null, count ? countOf(count) : null,
    action ? buttonTree({ size: "sm", ...action }) : null, tools, keys.map(keyHintTree),
    pending ? html`<span class="kanso-state-line__pending-dot"></span>` : null, !status || status === "none" ? null : markTree({ status }),
  ];
  const states = [second && "kanso-row--two-lines", heading && "kanso-row--heading", title && "kanso-row--title", depth && `kanso-row--depth-${depth}`, selected && "kanso-control--selected", current && "kanso-row--selected",
    dimmed && "kanso-control--dim", pending && "kanso-state-line--pending", hover && "kanso-control--hover", focus && "kanso-control--focus",
    drop && `kanso-row--drop-${drop}`, wash && `kanso-row--wash-${wash}`, lines.length && "kanso-row--tree", wrap && "kanso-row--wrap"].filter(Boolean).map((n) => ` ${n}`).join("");
  return second
    ? html`<div class="kanso-row${states}" tabindex="0"><div class="kanso-content__primary">${lead}${label}${tail}</div><div class="kanso-content__secondary">${typeof second === "string" ? second : second.filter(Boolean).map(fact)}</div></div>`
    : html`<div class="kanso-row${states}" tabindex="0">${lead}${label}${tail}</div>`;
};

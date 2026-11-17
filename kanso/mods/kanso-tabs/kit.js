// The kit with the Storybook's signatures: a piece takes its props and returns a drawing, `(id, c, more) => element`.
import { row as drawRow } from "./ui-row.js";
import { button as drawButton } from "./ui-button.js";
import { menu as drawMenu } from "./ui-menu.js";
import { stateEmpty, stateLine, stateBlock } from "./ui-state.js";
import { toast as drawToast } from "./ui-toast.js";
import { skeletonOf as drawSkeleton } from "./ui-skeleton.js";
import { figure } from "./ui-metric.js";
import { diffText, facts, plus } from "./ui-facts.js";
import { card as drawCard } from "./ui-card.js";
import { code as drawCode } from "./ui-code.js";
import { tipText } from "./ui-tooltip.js";

// Facts as words, as the Storybook writes them.
export { diffText, facts, plus };

const EVENTS = {
  onPress: (el, fn) => el.on_mouse_down("left", fn),
  onRelease: (el, fn) => el.on_mouse_up("left", fn),
  onMenu: (el, fn) => el.on_mouse_down("right", fn),
};
const HANDLERS = ["on", "onClick", "onHover", "onKey", "focusHandle", ...Object.keys(EVENTS)];
const appIcon = (icon) => (typeof icon === "string" ? icon.replace(/^lu-/, "") : icon);
const iconOf = (icon) => (icon === "none" ? null : appIcon(icon));
const withIcon = (part) => (part?.icon ? { ...part, icon: appIcon(part.icon) } : part);
const keyOf = ({ icon, label }) => (icon ? appIcon(icon) : label);
const parts = (slot) => [slot].flat(Infinity).filter((part) => part !== null && part !== undefined && part !== false);
const drawn = (id, c, name, slot) => parts(slot).map((part, i) => (typeof part === "function" ? part(`${id}-${name}-${i}`, c) : part));

const given = (more) => {
  const unknown = Object.keys(more).filter((key) => !HANDLERS.includes(key));
  if (unknown.length) throw new Error(`kit: the app gives only handlers, not ${unknown.join(", ")}`);
  return Object.fromEntries(Object.entries(more).filter(([, value]) => value !== undefined));
};

const wired = (on) => (tool) => (tool && on[keyOf(tool)] ? { ...tool, onClick: on[keyOf(tool)] } : tool);

const withHandlers = (id, raw, actions, action) => {
  const on = Object.fromEntries(Object.entries(raw).map(([key, fn]) => [appIcon(key), fn]));
  const own = parts(actions).map(withIcon);
  const lone = withIcon(action);
  const missing = Object.keys(on).filter((key) => ![...own, lone].some((tool) => tool && keyOf(tool) === key));
  if (missing.length) throw new Error(`kit: ${id} has no tool ${missing.join(", ")}`);
  return { actions: own.map(wired(on)), action: wired(on)(lone) };
};

export const row = ({ icon, flag, detail, action, actions, start, tools, ...props }) => (id, c, more = {}) => {
  const { on = {}, onPress, onRelease, onMenu, ...handlers } = given(more);
  const drawnRow = drawRow(id, c, {
    ...props, ...handlers, ...withHandlers(id, on, actions, action), icon: appIcon(icon), flag: appIcon(flag),
    detail: Array.isArray(detail) ? detail.map(withIcon) : withIcon(detail),
    start: drawn(id, c, "start", start), tools: drawn(id, c, "tools", tools),
  });
  return Object.entries({ onPress, onRelease, onMenu }).filter(([, fn]) => fn).reduce((el, [name, fn]) => EVENTS[name](el, fn), drawnRow);
};

// `icon: "none"` is the Storybook's no icon; app-only props, such as `color`, pass through as the row's do.
export const button = ({ label, icon = "none", ...props }) => (id, c, more = {}) => {
  const { onClick = null } = given(more);
  return drawButton(id, label, onClick, c, { ...props, icon: iconOf(icon) });
};

// Each item carries its own `onClick`: a menu's items are data, not tools.
export const menu = ({ title = null, items = [] }) => (id, c, more = {}) => {
  given(more);
  return drawMenu(id, { title, items: items.map(withIcon) }, c);
};

// The state patterns and the toast: the one action or fix takes `onClick`.
const pattern = (draw) => (props) => (id, c, more = {}) => draw(id, c, { ...props, onClick: given(more).onClick ?? null });
export const emptyState = ({ icon = "", text, action = "" }) => pattern(stateEmpty)({ icon: appIcon(icon), text, action });
export const failureLine = ({ text, fix = "", detail = "" }) => pattern(stateLine)({ text, fix, detail });
export const failureBlock = ({ text, source = "", fix = "" }) => pattern(stateBlock)({ text, source, fix });
// A press on the toast or its fix goes home.
export const toast = ({ icon = "none", ...props }) => pattern(drawToast)({ ...props, icon: iconOf(icon) });
export const skeletonOf = ({ shape, count }) => (id, c, more = {}) => {
  given(more);
  return drawSkeleton(id, c, { shape, count });
};

// The one number: its unit beside it, its facts (separated by |) on a quiet line under it. App only: `tone` and `tip` for the value.
export const metric = ({ value, unit = "", facts = "", loading = false, tone = "", tip = "" }) => (id, c, more = {}) => {
  given(more);
  return figure(id, c, { value, unit, facts, loading, tone, tip });
};

// `content`: kit pieces drawn in place of the prose body.
export const card = ({ content = [], ...props }) => (id, c, more = {}) => {
  given(more);
  return drawCard(id, c, { ...props, content: drawn(id, c, "content", content) });
};

export const code = (props) => (id, c, more = {}) => {
  given(more);
  return drawCode(id, c, props);
};

// Herdr's `.tooltip()` takes only a string, so the tooltip is its words: `.tooltip(tooltip({ label, detail, chord }))`.
// `chord` is the key table's chord ("cmd-shift-p", from ui-tooltip.js `boundChord`), written as this computer writes it. Anything else throws.
export const tooltip = ({ label, detail = "", chord = "", ...rest }) => {
  if (Object.keys(rest).length) throw new Error(`kit: a tooltip takes label, detail and chord, not ${Object.keys(rest).join(", ")}`);
  return tipText({ label, detail, chord });
};

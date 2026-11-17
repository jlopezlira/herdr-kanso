// The kit with the Storybook's signatures: a piece takes its props and returns a drawing, `(id, c, more) => element`.
import { row as drawRow } from "./ui-row.js";
import { button as drawButton } from "./ui-button.js";
import { menu as drawMenu } from "./ui-menu.js";
import { stateEmpty, stateLine, stateBlock } from "./ui-state.js";

const EVENTS = {
  onPress: (el, fn) => el.on_mouse_down("left", fn),
  onRelease: (el, fn) => el.on_mouse_up("left", fn),
  onMenu: (el, fn) => el.on_mouse_down("right", fn),
};
const HANDLERS = ["on", "onClick", "onHover", "onKey", "focusHandle", ...Object.keys(EVENTS)];
const appIcon = (icon) => (typeof icon === "string" ? icon.replace(/^lu-/, "") : icon);
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
  return drawButton(id, label, onClick, c, { ...props, icon: icon === "none" ? null : appIcon(icon) });
};

// Each item carries its own `onClick`: a menu's items are data, not tools.
export const menu = ({ title = null, items = [] }) => (id, c, more = {}) => {
  given(more);
  return drawMenu(id, { title, items: items.map(withIcon) }, c);
};

// The state patterns: the one action or fix takes `onClick`.
const pattern = (draw) => (props) => (id, c, more = {}) => draw(id, c, { ...props, onClick: given(more).onClick ?? null });
export const emptyState = ({ icon = "", text, action = "" }) => pattern(stateEmpty)({ icon: appIcon(icon), text, action });
export const failureLine = ({ text, fix = "", detail = "" }) => pattern(stateLine)({ text, fix, detail });
export const failureBlock = ({ text, source = "", fix = "" }) => pattern(stateBlock)({ text, source, fix });

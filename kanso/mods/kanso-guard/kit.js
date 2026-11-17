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
import { thumbnail as drawThumbnail } from "./ui-thumbnail.js";
import { markdown as drawMarkdown, markdownBlock as drawMarkdownBlock } from "./ui-markdown.js";
import { tipText } from "./ui-tooltip.js";

// Facts as words, as the Storybook writes them.
export { diffText, facts, plus };

// A composition's children: the Storybook joins their markup, the app keeps the pieces, each drawn where the list places it.
export const list = (...children) => children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false);
// A label made of words and values, such as a name inside an action's title.
export const phrase = (...parts) => parts.join(" ");
// A tool: its icon and the label its tooltip reads.
export const icon = (name, label) => ({ icon: name, label });

const EVENTS = {
  onPress: (el, fn) => el.on_mouse_down("left", fn),
  onRelease: (el, fn) => el.on_mouse_up("left", fn),
  onMenu: (el, fn) => el.on_mouse_down("right", fn),
  onMove: (el, fn) => el.on_mouse_move(fn),
};
const HANDLERS = ["on", "onClick", "onHover", "onKey", "onLink", "focusHandle", ...Object.keys(EVENTS)];
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

// A detail fact with a `label` is a press, wired by that label as a tool is.
const pressFact = (part) => typeof part === "object" && Boolean(part.label);
const withHandlers = (id, raw, actions, action, detail) => {
  const on = Object.fromEntries(Object.entries(raw).map(([key, fn]) => [appIcon(key), fn]));
  const own = parts(actions).map(withIcon);
  const lone = withIcon(action);
  const facts = parts(detail).map(withIcon);
  const presses = [...own, lone, ...facts.filter(pressFact)];
  const missing = Object.keys(on).filter((key) => !presses.some((tool) => tool && keyOf(tool) === key));
  if (missing.length) throw new Error(`kit: ${id} has no tool ${missing.join(", ")}`);
  return { actions: own.map(wired(on)), action: wired(on)(lone), detail: facts.map((part) => (pressFact(part) ? wired(on)(part) : part)) };
};

export const row = ({ icon, flag, detail, action, actions, start, tools, ...props }) => (id, c, more = {}) => {
  const { on = {}, onPress, onRelease, onMenu, onMove, ...handlers } = given(more);
  const drawnRow = drawRow(id, c, {
    ...props, ...handlers, ...withHandlers(id, on, actions, action, detail), icon: iconOf(icon), flag: appIcon(flag),
    start: drawn(id, c, "start", start), tools: drawn(id, c, "tools", tools),
  });
  return Object.entries({ onPress, onRelease, onMenu, onMove }).filter(([, fn]) => fn).reduce((el, [name, fn]) => EVENTS[name](el, fn), drawnRow);
};

// `icon: "none"` is the Storybook's no icon; app-only props, such as `color`, pass through as the row's do.
// `content`: kit pieces or elements drawn in place of the icon and label, such as a picture and its name.
export const button = ({ label, icon = "none", content = [], ...props }) => (id, c, more = {}) => {
  const { onClick = null } = given(more);
  return drawButton(id, label, onClick, c, { ...props, icon: iconOf(icon), content: drawn(id, c, "content", content) });
};

// Explain to <agent>: the bot icon and the agent named in words; its press starts that agent on the question.
export const explainButton = ({ agent, size = "md" }) => button({ label: `Explain to ${agent}`, kind: "tonal", size, icon: "lu-bot" });

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

// A picture to pick: its press picks it. Proposed: `color`, its ground until the picture is drawn.
export const thumbnail = ({ image = "", label, selected = false, loading = false, color = "" }) => (id, c, more = {}) => {
  const { onClick = null } = given(more);
  return drawThumbnail(id, c, { image, label, selected, loading, color }, onClick);
};

// Prose in blocks, the `block`th (from 1) hovered or edited; `onLink` takes a link's press.
export const markdown = ({ source, block = 0, state = "rest" }) => (id, c, more = {}) => {
  const { onLink = null } = given(more);
  return drawMarkdown(id, c, { source, block, state }, { onLink });
};

// One block of a document. Proposed: `content`, kit pieces or elements in place of its formatted source. `onPress` takes a press on it (a double press edits it).
export const markdownBlock = ({ source = "", state = "rest", content = [] }) => (id, c, more = {}) => {
  const { onLink = null, onPress = null } = given(more);
  return drawMarkdownBlock(id, c, { source, state, content: drawn(id, c, "content", content) }, { onLink, onPress });
};

// Herdr's `.tooltip()` takes only a string, so the tooltip is its words: `.tooltip(tooltip({ label, detail, chord }))`.
// `chord` is the key table's chord ("cmd-shift-p", from ui-tooltip.js `boundChord`), written as this computer writes it. Anything else throws.
export const tooltip = ({ label, detail = "", chord = "", ...rest }) => {
  if (Object.keys(rest).length) throw new Error(`kit: a tooltip takes label, detail and chord, not ${Object.keys(rest).join(", ")}`);
  return tipText({ label, detail, chord });
};

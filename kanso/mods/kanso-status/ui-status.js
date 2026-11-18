// Kanso's panel kit: a status bar item, its mark or icon with its words, and the item of an agent waiting for you. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-status.js.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { glyphOf } from "./ui.js";
import { mark } from "./ui-mark.js";
import { pendingDot } from "./ui-state.js";
import { RULES } from "./ui-css.js";
import { paint } from "./ui-draw.js";

const node = (classes, parent = null) => ({ tag: "span", attrs: {}, classes, parent, children: [] });
// The item's rules are written on the bar, so the node sits in one while the app draws the item.
const inBar = (classes) => node(classes, node(["kanso-status-bar", "kanso-status-bar--grid"]));
const ITEM_HOVER = "kanso-row--hover";
const iconNode = node(["kanso-icon", "kanso-icon--inline"]);
const press = (el, { tip, onClick }) => (onClick ? el.cursor_pointer().on_click((_e, cx) => onClick(cx)) : el)
  .when(Boolean(tip), (item) => item.tooltip(tip));

/** `mark`: an agent state drawn as its mark, else `icon`, a name in kanso-chrome's icons; `tone`: a tone name for an item in that state;
 * `pending`: drawn at once at the pending opacity with a breathing dot; `open`: its menu is open; `onClick` and `tip`: where it goes and what it says. */
export const statusItem = (id, c, { icon = null, mark: status = null, text = null, tone = null, pending = false, open = false, tip = null, onClick = null } = {}) => {
  const classes = ["kanso-status-bar__item", tone ? `kanso-text--${tone}` : "", pending ? "kanso-state-line--pending" : "", open ? "kanso-status-bar__item--open" : ""].filter(Boolean);
  const lead = status ? mark(c, { status, size: "sm" }) : icon ? paint(svg(glyphOf(icon)), iconNode, c, RULES) : null;
  return press(paint(h_flex().id(id), inBar(classes), c, RULES, ITEM_HOVER), { tip, onClick })
    .when(Boolean(lead), (el) => el.child(lead))
    .when(text != null && text !== "", (el) => el.child(div().child(String(text))))
    .when(pending, (el) => el.child(pendingDot(`${id}-pending`, c)));
};

/** Who waits: the blocked mark, the name, the question trimmed to its width, and +`more` for the others; neither the name nor +N folds.
 * The question has no colour of its own: muted with the bar, foreground with the item under the pointer. */
export const needsItem = (id, c, { name, question = null, more = 0, tip = null, onClick = null } = {}) => {
  const item = inBar(["kanso-status-bar__item", "kanso-status-bar__needs"]);
  return press(paint(h_flex().id(id), item, c, RULES, ITEM_HOVER), { tip, onClick })
    .child(mark(c, { status: "blocked", size: "sm" }))
    .child(paint(div(), node(["kanso-status-bar__name"], item), c, RULES).child(name))
    .when(Boolean(question), (el) => el.child(paint(div(), node(["kanso-status-bar__question"], item), c, RULES).child(question)))
    .when(more > 0, (el) => el.child(paint(div(), node(["kanso-status-bar__more"], item), c, RULES).child(`+${more}`)));
};

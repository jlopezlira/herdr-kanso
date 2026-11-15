// Kanso's panel kit: the switch. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-toggle.js.
import { div } from "gpui-kit";
import { h_flex, Toggle } from "gpui-base";
import { G, H, R, SWITCH, WASH, CLEAR, mix, well } from "./ui.js";

/** One switch: off is raised with the input edge, on is the solid colour; only the knob moves. Disabled: the 4% wash, dim knob. */
export function toggleSwitch(id, checked, onChange, c, { label = "Toggle", disabled = false } = {}) {
  // The 1px edge sits inside the pill, so the knob meets it.
  const pad = (SWITCH.h - SWITCH.knob - 2) / 2;
  const fill = disabled ? well(c) : checked ? c.primary : c.raised;
  const edge = disabled ? c.border : checked ? c.primary : c.input;
  const pill = h_flex().id(`${id}-pill`).w(SWITCH.w).h(SWITCH.h).p(pad).items_center()
    .justify_start().when(checked, (el) => el.justify_end())
    .rounded_full().bg(fill).border_1().border_color(edge)
    .when(!disabled, (el) => el.hover((s) => (checked ? s.bg(mix(fill, c.background, WASH.hover)) : s.border_color(c.muted))))
    .child(div().size(SWITCH.knob).flex_none().rounded_full().bg(disabled ? c.dim : checked ? c.primaryText : c.muted));
  // The ring is a border kept clear at rest, as on a button.
  return Toggle.new(id).h(H.compact).px(G.xs - G.hair).items_center()
    .rounded(R.control).border_2().border_color(CLEAR).focus((s) => s.border_color(c.accent))
    .pressed(checked)
    .disabled(disabled)
    .accessibility_label(label)
    .when(!disabled, (el) => el.cursor_pointer().on_change((next, cx) => { onChange(next, cx); cx.notify(); }))
    .child(pill);
}

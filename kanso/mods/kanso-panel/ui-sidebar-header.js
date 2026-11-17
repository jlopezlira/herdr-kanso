// Kanso's panel kit: the sidebar's Header under the window's lights, its Toolbar 40 tall; collapsed, the rail's width with the Toolbar stacked. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-sidebar-header.js.
import { v_flex } from "gpui-base";
import { G, H } from "./ui.js";

/** `toolbar`: the drawn Toolbar, in its column form when `collapsed`.
 * Not the Storybook's `header` as is: the window's lights are Herdr's own block above it, and Dawn Mode is not in the app. */
export const header = (id, { collapsed = false }, toolbar) => v_flex().id(id).w_full().flex_none().px(G.sm).pb(G.xs)
  .when(collapsed, (el) => el.items_center().pt(G.hair))
  .child(collapsed ? toolbar : toolbar.h(H.row));

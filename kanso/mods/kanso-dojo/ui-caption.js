// Kanso's panel kit: the caption, a dim line in the smallest size under a label. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-caption.js.
import { div } from "gpui-kit";
import { T } from "./ui.js";

export const caption = (c, text) => div().text_size(T.micro).text_color(c.dim).child(text);

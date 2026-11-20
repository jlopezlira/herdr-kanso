// Kanso's panel kit: the dialog, its title, scope, body, notes and footer, with Cancel and Escape. Apache-2.0.
// Kept byte for byte by `npm run sync:share`: edit kanso-panel/ui-dialog.js.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { G, H, R, T, CLEAR } from "./ui.js";
import { button } from "./ui-button.js";

const LEADING = 1.5;
const NOTE_TONES = Object.freeze({ dim: "dim", muted: "muted", error: "blocked" });

// Loading keeps each word's place as a shape.
const shaped = (c, el, loading) => (loading ? el.text_color(CLEAR).bg(c.border).rounded(R.sm) : el);
const line = (text) => div().min_w(0).truncate().child(text);

const note = (c, loading) => ({ text, tone = "dim" }) => shaped(c, div().mt(G.md).text_size(T.body).line_height(LEADING)
  .text_color(c[NOTE_TONES[tone] ?? "dim"]).child(text), loading);

const primaryOf = (id, c, { primary, kind, state, loading, onPrimary }) => button(`${id}-primary`, primary, onPrimary, c, {
  kind, disabled: loading || state === "disabled", spin: !loading && state === "loading", icon: !loading && state === "loading" ? "working" : null,
  armed: !loading && state === "armed", verb: state === "armed" ? primary.toLowerCase() : null,
});

/** A view's work under way and its failure, as the notes that say them. */
export const statusNotes = ({ busy = null, error = null }) => [busy && { text: busy, tone: "muted" }, error && { text: error, tone: "error" }].filter(Boolean);

/** `body`: the elements its use composes. `notes`: [{ text, tone: dim | muted | error }]. `state`: the primary's default, disabled, loading or armed.
 * `secondary` is Cancel's label; `onCancel` runs from it and from Escape, which wait while `held`. `onKey` takes every other key. */
export function dialog(id, c, { title, scope = null, body = [], notes = [], primary = null, kind = "solid", state = "default", secondary = null, loading = false,
  onPrimary = null, onCancel = null, onKey = null, focusHandle = null, held = false } = {}) {
  const footer = primary || secondary ? h_flex().mt(G.lg).min_h(H.control).items_center().justify_end().gap(G.sm)
    .when(Boolean(secondary), (el) => el.child(button(`${id}-secondary`, secondary, onCancel, c, { kind: "quiet", disabled: loading || held })))
    .when(Boolean(primary), (el) => el.child(primaryOf(id, c, { primary, kind, state, loading, onPrimary }))) : null;
  const parts = [body].flat().filter(Boolean);
  return v_flex().id(id).w_full().min_h(0).p(G.xl).bg(c.popover).text_color(c.text)
    .when(Boolean(focusHandle), (el) => el.track_focus(focusHandle))
    .on_key_down((e, cx) => {
      if (e.key !== "escape") { onKey?.(e, cx); return; }
      if (held || !onCancel) return;
      cx.stop_propagation();
      onCancel(cx);
    })
    .child(h_flex().min_h(H.icon).items_center().gap(G.sm)
      .child(shaped(c, line(title).flex_1().text_size(T.title).font_semibold(), loading)))
    .when(Boolean(scope), (el) => el.child(shaped(c, line(scope).mt(G.sm).text_size(T.body).text_color(c.dim), loading)))
    .when(parts.length > 0, (el) => el.child(v_flex().mt(G.md).gap(G.xs).children(parts)))
    .children(notes.map(note(c, loading)))
    .when(Boolean(footer), (el) => el.child(footer));
}

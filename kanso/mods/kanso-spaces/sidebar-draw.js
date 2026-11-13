import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run } from "herdr";
import { G, R, T, tokens, quietLink, pendingDot, PENDING } from "./ui.js";
import { commitLayout } from "./layout.js";
import { ASLEEP_ROW, asleepControls, gitControls, gitTask, pullKey } from "./sidebar-rows.js";

const stop = (el, go) => el.cursor_pointer()
  .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
  .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); go(cx); });

export function openAhead(space) {
  if (!space?.id) return;
  if (!space.active) run("space.select", { id: space.id });
  commitLayout({ panel: { id: "pr", type: "block", content: { mod: "kanso-panel", props: { panel: "pr" } } } });
}

export function gitTail(g, tree, name, t, place, act) {
  const folder = place?.cwd ?? "";
  const on = place?.on ?? null;
  const controls = gitControls(g, { folder, on, id: act.id, active: act.active, pulling: act.pulling === pullKey(folder, on) });
  const { repo, branch, commit } = gitTask(g, name, tree);
  const count = (control) => {
    const base = div().id(`git-${control.kind}-${act.id}`).flex_none().tooltip(control.tip);
    // A pull is drawn done at once; the dot breathes until git answers.
    if (control.pulling) return base.child(pendingDot(`git-pending-${act.id}`, tokens(t)));
    const go = control.kind === "ahead" ? act.open : act.pull;
    return stop(base.px(4).py(2).rounded(4).text_size(T.body).text_color(t.muted).hover((s) => s.bg(t.foreground + "1f").text_color(t.foreground)), go).child(control.label);
  };
  const pending = controls.some((control) => control.pulling);
  return h_flex().flex_1().min_w(0).gap(4).items_center().text_size(T.body).text_color(t.dim)
    .opacity(pending ? PENDING : 1)
    .when(Boolean(repo), (el) => el.child(div().min_w(0).truncate().child(repo)))
    .when(Boolean(branch), (el) => el
      .child(svg("mods/kanso-chrome/icons/branch.svg").size(12).flex_none().text_color(t.dim))
      .child(div().min_w(0).truncate().text_color(t.muted).child(branch)))
    .when(Boolean(commit), (el) => el.child(div().flex_none().child(commit)))
    .children(controls.map(count))
    .child(div().flex_1());
}

export function asleepRow(a, pad, t, row, wake, label) {
  const c = tokens(t);
  const controls = asleepControls(a);
  const kbd = Boolean(row.kbd);
  return h_flex().id(`space-agent-${a.address}`).h(ASLEEP_ROW).flex_none()
    .pl(pad).pr(G.md).gap(G.md).items_center().rounded(R.card).cursor_pointer()
    .when(kbd, (el) => el.border_1().border_color(t.accent))
    .hover((s) => s.bg(t.foreground + "0c"))
    .on_click((_e, cx) => { cx.stop_propagation(); row.menu(cx); })
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); row.menu(cx); })
    .when(Boolean(row.hover), (el) => el.on_hover((h, cx) => row.hover(h, cx)))
    .child(svg("mods/kanso-chrome/icons/moon.svg").size(13).flex_none().text_color(t.dim))
    .child(div().flex_1().min_w(0).truncate().text_size(T.card).text_color(t.dim).child(label))
    .when(controls.length > 0, (el) => el.child(quietLink(`wake-${a.asleep.id}`, controls[0].label, (cx) => { cx.stop_propagation(); wake(cx); }, c, { color: kbd ? t.foreground : c.muted })
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_up("left", (_e, cx) => cx.stop_propagation())));
}

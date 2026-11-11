// The pull request page: the verdict, its one action, and the fold under it.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { G, H, R, T, quietLink, section, toneColor } from "./ui.js";
import { ageOf, footLine } from "./pr-poll.js";
import { verdictCard, VIEW } from "./pr-body.js";

const ICON = "mods/kanso-chrome/icons/";

export function footOf(panel) {
  return footLine({ wait: panel.wait, stale: Boolean(panel.stale), at: panel.stale?.at, now: Date.now() });
}

function scopeText(panel) {
  const repo = (panel.home ?? "").split("/").filter(Boolean).at(-1) || panel.repo()?.r || "";
  const flow = panel.pr ? `${panel.pr.headRefName} → ${panel.pr.baseRefName}` : (panel.branch || "");
  if (!repo && !panel.on) return "";
  return [panel.on, repo, flow].filter(Boolean).join(" · ");
}

function scopeRow(panel, c) {
  const text = scopeText(panel);
  if (!text && !panel.pr) return null;
  return h_flex().w_full().items_center().justify_between().gap(G.md)
    .child(div().min_w(0).truncate().text_size(VIEW.meta).text_color(c.dim).child(text))
    .when(Boolean(panel.pr), (el) => el.child(div().flex_none().text_size(VIEW.meta).text_color(c.dim).child(`#${panel.pr.number}`)));
}

function actionLabel(panel, action) {
  if (panel.busy === action.busy) return action.busyLabel || action.label;
  if (action.armed && panel.armed.is(action.target)) return action.press;
  return action.label;
}

function actionButton(panel, c, action) {
  const disabled = !action?.acts || Boolean(panel.busy);
  const hot = Boolean(action?.armed) && panel.armed.is(action.target) && !disabled;
  const fill = hot ? c.accent : c.primary;
  const ink = hot ? c.accentText : c.primaryText;
  return Button.new(action.id).h(H.control).px(G.md).flex_none().items_center().rounded(R.control)
    .disabled(disabled)
    .accessibility_label(actionLabel(panel, action))
    .when(disabled, (el) => el.border_1().border_color(c.input))
    .when(!disabled, (el) => el.bg(fill).cursor_pointer().hover((s) => s.opacity(0.85)))
    .on_click((_e, cx) => { if (!disabled) onAction(panel, action, cx); })
    .child(div().text_size(T.value).font_medium().text_color(disabled ? c.dim : ink).child(actionLabel(panel, action)));
}

function quietAction(panel, c, action) {
  return quietLink(action.id, actionLabel(panel, action), (cx) => onAction(panel, action, cx), c, { disabled: !action.acts || Boolean(panel.busy), size: T.value, color: c.muted });
}

function onAction(panel, action, cx) {
  if (!action?.acts || panel.busy) return;
  if (action.target === "send") return panel.send(cx);
  if (action.target === "failures") return panel.openChecks(cx);
  if (action.target === "details") return panel.setDetails(cx, true);
  if (action.target === "log" || action.target === "reply" || action.target === "github" || action.target === "cli") return panel.openLink(action.url);
  if (action.target === "sign-in") return panel.signIn();
  const go = (next) => panel.runWrite(action, next);
  if (action.armed) return panel.armed.press(action.target, cx, go);
  return go(cx);
}

export function listedRow(panel, c, p, i, { finished = false, id = null } = {}) {
  const on = p.url === panel.pr?.url;
  const state = !finished ? panel.rowState(p, c)
    : p.state === "MERGED" ? { text: "Merged", color: c.violet } : { text: "Closed without merging", color: c.red };
  const when = !finished ? `updated ${ageOf(p.updatedAt, Date.now())}`
    : p.state === "MERGED" ? `merged ${ageOf(p.mergedAt || p.updatedAt, Date.now())}` : `closed ${ageOf(p.closedAt || p.updatedAt, Date.now())}`;
  const mine = Boolean(panel.viewer) && p.author?.login === panel.viewer;
  const meta = [`#${p.number}`, mine ? "you" : p.author?.login, when].filter(Boolean).join(" · ");
  return Button.new(id || `pr-${finished ? "done" : "open"}-${i}`).w_full().px(G.md).py(10).rounded(6).cursor_pointer()
    .selected(on)
    .when(on, (el) => el.bg(c.selected))
    .when(!on, (el) => el.hover((s) => s.bg(c.subtle)))
    .accessibility_label(`#${p.number} ${p.title}${on ? ", shown" : ""}`)
    .on_click((_e, cx) => panel.choose(p, cx))
    .child(v_flex().w_full().min_w(0).gap(4)
      .child(h_flex().w_full().items_start().gap(G.md)
        .child(div().flex_1().min_w(0).text_size(14).line_height(1.35).text_color(c.text).when(on, (e) => e.font_medium()).child(p.title))
        .when(on, (el) => el.child(div().flex_none().pt(2).text_size(11).text_color(c.text).child("Shown"))))
      .child(div().w_full().truncate().text_size(11.5).text_color(c.dim).child(meta))
      .child(h_flex().w_full().gap(G.sm).items_center()
        .child(div().size(6).flex_none().rounded_full().bg(state.color))
        .child(div().text_size(12).text_color(state.color === c.dim ? c.muted : state.color).child(state.text))
        .when(p.additions !== undefined, (el) => el.child(div().text_size(12).text_color(c.dim).child(`+${p.additions} −${p.deletions}`)))));
}

function otherPrs(panel, c, titled) {
  const rows = (panel.openPrs ?? []).filter((pr) => pr.url !== panel.pr?.url);
  const shown = rows.slice(0, 8);
  return v_flex().w_full().gap(G.xs)
    .when(!titled, (el) => el.child(section(c, "Other open pull requests", rows.length ? String(rows.length) : "")))
    .when(!rows.length && !panel.listingOthers, (el) => el.child(div().text_size(T.value).text_color(c.dim).child("Nothing else open.")))
    .children(shown.map((pr, i) => listedRow(panel, c, pr, i, { id: `pr-other-${i}` })))
    .when(rows.length > shown.length, (el) => el.child(quietLink("pr-others", "Open the list", (cx) => panel.showOthers(cx), c)));
}

function writeRow(panel, c, writes) {
  return h_flex().w_full().gap(G.lg).flex_wrap().children((writes ?? []).map((action) => quietAction(panel, c, action)));
}

function fold(panel, c, view) {
  const on = panel.detailsOn();
  const label = view.id === "none" || view.id === "base" ? "Other open pull requests" : "Details";
  return v_flex().w_full().gap(G.lg)
    .child(Button.new("pr-details").w_full().h(H.compact).gap(G.sm).items_center().cursor_pointer()
      .accessibility_label(label)
      .on_click((_e, cx) => panel.setDetails(cx))
      .child(svg(`${ICON}chevron-${on ? "down" : "right"}.svg`).size(VIEW.meta).text_color(c.muted))
      .child(div().flex_none().text_size(T.value).text_color(c.muted).child(label))
      .child(div().flex_1())
      .child(div().min_w(0).truncate().text_size(T.value).text_color(c.dim).child(view.detailsNote ?? "")))
    .when(on && panel.pr, (el) => el.child(panel.description(c)).child(panel.people(c))
      .when(panel.checks().length > 0, (row) => row.child(panel.checksList(c)))
      .when(panel.threads.length > 0, (row) => row.child(panel.discussion(c)))
      .child(panel.files(c)).child(otherPrs(panel, c, false))
      .when(Boolean(view.writes?.length), (row) => row.child(writeRow(panel, c, view.writes))))
    .when(on && !panel.pr, (el) => el.child(otherPrs(panel, c, true)));
}

function footnote(panel, c) {
  const line = footOf(panel);
  if (!line.text) return null;
  return h_flex().gap(G.sm).items_center()
    .child(div().text_size(T.small).text_color(c.dim).child(line.text))
    .when(line.retry, (el) => el.child(quietLink("pr-retry", "Retry", (cx) => panel.again(cx), c)));
}

export function drawHero(panel, c) {
  const view = panel.view();
  const scope = scopeRow(panel, c);
  const card = verdictCard(c, view.body);
  const preview = panel.sendShown && panel.sendFor ? String(panel.sendFor).split("\n") : null;
  const foot = footnote(panel, c);
  const ink = toneColor(c, view.tone);
  const body = v_flex().w_full().gap(G.lg)
    .when(Boolean(view.facts), (el) => el.child(div().text_size(T.value).text_color(c.muted).child(view.facts)))
    .when(Boolean(card), (el) => el.child(card))
    .when(Boolean(view.more?.acts), (el) => el.child(quietAction(panel, c, view.more)))
    .when(Boolean(preview), (el) => el.child(v_flex().w_full().p(G.md).gap(G.xs).rounded(R.card).border_1().border_color(c.border)
      .children(preview.map((line) => div().text_size(T.body).text_color(c.text).child(line || " ")))))
    .child(h_flex().w_full().gap(G.lg).items_center().flex_wrap()
      .when(Boolean(view.primary), (row) => row.child(actionButton(panel, c, view.primary)))
      .when(Boolean(view.quiet), (row) => row.child(quietAction(panel, c, view.quiet))))
    .when(view.details, (el) => el.child(fold(panel, c, view)))
    .when(Boolean(panel.note), (el) => el.child(div().text_size(T.value).text_color(c.red).child(panel.note)));
  return v_flex().w_full().gap(G.lg)
    .when(Boolean(scope), (el) => el.child(scope))
    .when(Boolean(panel.pr?.title), (el) => el.child(div().w_full().max_h(VIEW.titleMax).overflow_hidden().text_size(VIEW.title).line_height(1.3).font_medium().text_color(c.text).child(panel.pr.title)))
    .child(h_flex().gap(G.sm).items_center()
      .child(div().size(VIEW.dot).flex_none().rounded_full().bg(ink))
      .child(div().text_size(T.card).font_medium().text_color(ink).child(view.text)))
    .when(Boolean(view.note), (el) => el.child(div().text_size(T.value).text_color(c.muted).child(view.note)))
    .child(view.dimmed ? body.opacity(VIEW.stale) : body)
    .when(Boolean(foot), (el) => el.child(foot));
}

export function drawEmpty(panel, c) {
  const view = panel.view();
  const action = view.primary ? actionButton(panel, c, view.primary) : view.quiet ? quietAction(panel, c, view.quiet) : null;
  const scope = scopeRow(panel, c);
  const card = verdictCard(c, view.body);
  const foot = footnote(panel, c);
  return v_flex().w_full().gap(G.lg)
    .when(Boolean(scope), (el) => el.child(scope))
    .child(panel.waiting(c, view.text, null, action))
    .when(Boolean(card), (el) => el.child(card))
    .when(view.details, (el) => el.child(fold(panel, c, view)))
    .when(Boolean(panel.note), (el) => el.child(div().text_size(T.value).text_color(c.red).child(panel.note)))
    .when(Boolean(foot), (el) => el.child(foot));
}

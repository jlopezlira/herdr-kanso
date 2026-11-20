// The pull request page: the verdict, its one action, and the fold under it.
import { scopedColumn } from "./ui-page.js";
import { div } from "gpui-kit";
import { shared } from "herdr";
import { v_flex, h_flex } from "gpui-base";
import { G, R, T, PR, PAGE, OPACITY, toneColor } from "./ui.js";
import { button, quietLink } from "./ui-button.js";
import { row } from "./ui-row.js";
import { section } from "./ui-section.js";
import { diffText, failureBlock, row as kitRow } from "./kit.js";
import { ageOf, footLine } from "./pr-poll.js";
import { aliasText, machineTitle } from "./pure.js";
import { verdictBody } from "./pr-body.js";
import { dot } from "./ui-dot.js";


export function footOf(panel) {
  return footLine({ wait: panel.session.wait, stale: Boolean(panel.session.stale), at: panel.session.stale?.at, now: Date.now() });
}

function scopeText(panel) {
  const repo = (panel.session.home ?? "").split("/").filter(Boolean).at(-1) || panel.repo()?.r || "";
  const flow = panel.session.pr ? `${panel.session.pr.headRefName} → ${panel.session.pr.baseRefName}` : (panel.session.branch || "");
  const named = aliasText(shared("kanso.alias"), panel.session.on || "");
  const computer = named ? machineTitle(panel.session.on || "", "", named) : (panel.session.on || "");
  if (!repo && !computer) return "";
  return [computer, repo, flow].filter(Boolean).join(" · ");
}

function scopeRow(panel, c) {
  const text = scopeText(panel);
  if (!text && !panel.session.pr) return null;
  return h_flex().w_full().items_center().justify_between().gap(G.md)
    .child(div().min_w(0).truncate().text_size(PAGE.note).text_color(c.dim).child(text))
    .when(Boolean(panel.session.pr), (el) => el.child(div().flex_none().text_size(PAGE.note).text_color(c.dim).child(`#${panel.session.pr.number}`)));
}

function actionLabel(panel, action) {
  return panel.session.busy === action.busy ? action.busyLabel || action.label : action.label;
}

// What cannot be undone asks twice.
function asks(panel, action) {
  const disabled = !action?.acts || Boolean(panel.session.busy);
  return action?.armed ? { disabled, verb: action.verb, armed: !disabled && panel.armed.is(action.target) } : { disabled };
}

function actionButton(panel, c, action) {
  return button(action.id, actionLabel(panel, action), (cx) => onAction(panel, action, cx), c, asks(panel, action));
}

function quietAction(panel, c, action) {
  return quietLink(action.id, actionLabel(panel, action), (cx) => onAction(panel, action, cx), c, { ...asks(panel, action), color: c.muted });
}

function onAction(panel, action, cx) {
  if (!action?.acts || panel.session.busy) return;
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
  const on = p.url === panel.session.pr?.url;
  const state = !finished ? panel.rowState(p)
    : p.state === "MERGED" ? { text: "Merged", tone: "violet" } : { text: "Closed without merging", tone: "blocked" };
  const when = !finished ? `updated ${ageOf(p.updatedAt, Date.now())}`
    : p.state === "MERGED" ? `merged ${ageOf(p.mergedAt || p.updatedAt, Date.now())}` : `closed ${ageOf(p.closedAt || p.updatedAt, Date.now())}`;
  const mine = Boolean(panel.viewer) && p.author?.login === panel.viewer;
  const meta = [`#${p.number}`, mine ? "you" : p.author?.login, when].filter(Boolean).join(" · ");
  return prRow(id || `pr-${finished ? "done" : "open"}-${i}`, c, p, { meta, state, on, onClick: (cx) => panel.choose(p, cx) });
}

// A pull request in a list: its title, its state and what it changes, then who and when.
export const prRow = (id, c, p, { meta, state, on = false, onClick }) => row(id, c, {
  name: p.title, detail: [state, p.additions == null ? null : diffText({ add: p.additions, del: p.deletions })], meta: on ? "Shown" : null, second: meta, current: on, onClick,
}).aria_selected(on).accessibility_label(`#${p.number} ${p.title}${on ? ", shown" : ""}`);

function otherPrs(panel, c, titled) {
  const rows = (panel.session.openPrs ?? []).filter((pr) => pr.url !== panel.session.pr?.url);
  const shown = rows.slice(0, 8);
  const reading = !rows.length && panel.session.flying("details");
  return v_flex().w_full().gap(G.xs)
    .when(!titled, (el) => el.child(section(c, "Other open pull requests", rows.length ? String(rows.length) : "")))
    .when(reading, (el) => el.child(panel.rowBones(c)))
    .when(!rows.length && !reading, (el) => el.child(div().text_size(T.value).text_color(c.dim).child("Nothing else open.")))
    .children(shown.map((pr, i) => listedRow(panel, c, pr, i, { id: `pr-other-${i}` })))
    .when(rows.length > shown.length, (el) => el.child(quietLink("pr-others", "Open the list", (cx) => panel.showOthers(cx), c)));
}

function writeRow(panel, c, writes) {
  return h_flex().w_full().gap(G.lg).flex_wrap().children((writes ?? []).map((action) => quietAction(panel, c, action)));
}

function detailsButton(panel, c, view) {
  const on = panel.detailsOn();
  const label = view.id === "none" || view.id === "base" ? "Other open pull requests" : "Details";
  // The kit's row: Tab reaches it, Enter and Space open or close the details.
  return kitRow({ icon: on ? "chevron-down" : "chevron-right", name: label, meta: view.detailsNote || null, dimmed: true })("pr-details", c, { onClick: (cx) => panel.setDetails(cx) });
}

function detailParts(panel, c, view) {
  if (!view.details) return [];
  const on = panel.detailsOn();
  const open = on && Boolean(panel.session.pr);
  const checks = open && panel.checks().length > 0 ? [["checks", panel.checksList(c).id("checks")]] : [];
  const threads = open && panel.session.threads.length > 0 ? [["threads", panel.discussion(c).id("threads")]] : [];
  const writes = open && view.writes?.length ? [["writes", writeRow(panel, c, view.writes).id("writes")]] : [];
  const rest = open ? [
    ["description", panel.description(c).id("description")],
    ["people", panel.people(c).id("people")],
    ...checks, ...threads,
    ["files", panel.files(c).id("files")],
    ["others", otherPrs(panel, c, false).id("others")],
    ...writes,
  ] : on ? [["others", otherPrs(panel, c, true).id("others")]] : [];
  return [["details", v_flex().w_full().id("details").child(detailsButton(panel, c, view))], ...rest];
}

function fold(panel, c, view) {
  return v_flex().w_full().gap(G.lg).children(detailParts(panel, c, view).map((part) => part[1]));
}

function footnote(panel, c) {
  const line = footOf(panel);
  if (!line.text) return null;
  return h_flex().gap(G.sm).items_center()
    .child(div().text_size(T.micro).text_color(c.dim).child(line.text))
    .when(line.retry, (el) => el.child(quietLink("pr-retry", "Retry", (cx) => panel.again(cx), c)));
}

function heroTop(panel, c, view) {
  const { scope, card } = viewParts(panel, c, view);
  const preview = panel.session.sendShown && panel.session.sendFor ? String(panel.session.sendFor).split("\n") : null;
  const ink = toneColor(c, view.tone);
  const body = v_flex().w_full().gap(G.lg)
    .when(Boolean(view.facts), (el) => el.child(div().text_size(T.value).text_color(c.muted).child(view.facts)))
    .when(Boolean(card), (el) => el.child(card))
    .when(Boolean(view.more?.acts), (el) => el.child(quietAction(panel, c, view.more)))
    .when(Boolean(preview), (el) => el.child(v_flex().w_full().p(G.md).gap(G.xs).rounded(R.card).border_1().border_color(c.border)
      .children(preview.map((line) => div().text_size(T.body).text_color(c.text).child(line || " ")))))
    .child(h_flex().w_full().gap(G.lg).items_center().flex_wrap()
      .when(Boolean(view.primary), (row) => row.child(actionButton(panel, c, view.primary)))
      .when(Boolean(view.quiet), (row) => row.child(quietAction(panel, c, view.quiet))));
  return scopedColumn(scope)
    .when(Boolean(panel.session.pr?.title), (el) => el.child(div().w_full().max_h(PR.titleMax).overflow_hidden().text_size(PR.title).line_height(1.3).font_medium().text_color(c.text).child(panel.session.pr.title)))
    .child(h_flex().gap(G.sm).items_center()
      .child(dot(c, ink))
      .child(div().text_size(T.card).font_medium().text_color(ink).child(view.text)))
    .when(Boolean(view.note), (el) => el.child(div().text_size(T.value).text_color(c.muted).child(view.note)))
    .child(view.dimmed ? body.opacity(OPACITY.away) : body);
}

// The fold's blocks are siblings of the verdict, so a scroll can land on the checks.
export function heroPieces(panel, c) {
  const view = panel.view();
  const veil = (el) => view.dimmed ? el.opacity(OPACITY.away) : el;
  const note = panel.session.note ? [["remark", veil(failureBlock(panel.session.note)("remark", c))]] : [];
  const foot = footnote(panel, c);
  const tail = foot ? [["foot", foot.id("foot")]] : [];
  return [
    ["hero", heroTop(panel, c, view).id("hero")],
    ...detailParts(panel, c, view).map(([id, el]) => [id, veil(el)]),
    ...note,
    ...tail,
  ];
}

export function drawHero(panel, c) {
  return v_flex().w_full().gap(G.lg).children(heroPieces(panel, c).map((part) => part[1]));
}

export function drawEmpty(panel, c) {
  const view = panel.view();
  const action = view.primary ? actionButton(panel, c, view.primary) : view.quiet ? quietAction(panel, c, view.quiet) : null;
  const { scope, card } = viewParts(panel, c, view);
  const foot = footnote(panel, c);
  return scopedColumn(scope)
    .child(panel.waiting(c, view.text, null, action))
    .when(Boolean(card), (el) => el.child(card))
    .when(view.details, (el) => el.child(fold(panel, c, view)))
    .when(Boolean(panel.session.note), (el) => el.child(failureBlock(panel.session.note)("pr-view-note", c)))
    .when(Boolean(foot), (el) => el.child(foot));
}

const viewParts = (panel, c, view) => ({ scope: scopeRow(panel, c), card: verdictBody(c, view.body) });

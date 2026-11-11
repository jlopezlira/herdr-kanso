// The card under the pull request verdict: the log, the comment, or the rows that state is about.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { G, R, T, toneColor } from "./ui.js";
import { monoFont } from "./lib.js";
import { stateMark } from "./marks.js";

export const VIEW = { title: 17, titleMax: 44, dot: 8, stale: 0.55, meta: 12 };

const mono = () => monoFont();
const WORD = { fail: "failed", pending: "running", unknown: "unknown", pass: "passed", skipped: "skipped" };

function faced(el) {
  const font = mono();
  return font ? el.font_family(font) : el;
}

function shell(c, inner) {
  return v_flex().w_full().p(G.md).gap(G.sm).rounded(R.card).bg(c.canvas).child(inner);
}

function rows(c, lines) {
  return v_flex().w_full().gap(G.xs).children((lines ?? []).filter((line) => line != null && line !== "").map((line) => div().text_size(T.value).text_color(c.muted).child(line)));
}

function logCard(c, body) {
  const took = body.elapsed ? div().flex_none().text_size(T.body).text_color(c.dim).child(body.elapsed) : null;
  return shell(c, v_flex().w_full().gap(G.sm)
    .child(h_flex().w_full().items_center().gap(G.sm)
      .child(div().flex_none().text_size(T.value).font_medium().text_color(c.text).child(body.job || "Check"))
      .when(Boolean(body.step), (el) => el.child(div().flex_none().text_size(T.body).text_color(c.dim).child("›")).child(div().min_w(0).truncate().text_size(T.value).text_color(c.muted).child(body.step)))
      .child(div().flex_1())
      .when(Boolean(took), (el) => el.child(took)))
    .when(Boolean(body.lines?.length), (el) => el.child(faced(v_flex().w_full().gap(G.xs).children(body.lines.map((line) => div().text_size(T.body).text_color(toneColor(c, line.tone)).child(line.text || " ")))))));
}

function commentCard(c, body) {
  const where = `${body.path || ""}${body.line ? `:${body.line}` : ""}`;
  return shell(c, v_flex().w_full().gap(G.sm)
    .child(h_flex().w_full().items_center().gap(G.sm)
      .child(div().size(G.lg).flex_none().rounded_full().bg(c.subtle).flex().items_center().justify_center().text_size(T.body).font_medium().text_color(c.text).child(body.letter || "?"))
      .child(div().flex_none().text_size(T.value).font_medium().text_color(c.text).child(body.author || ""))
      .when(Boolean(where), (el) => el.child(faced(div().min_w(0).truncate().text_size(T.body).text_color(c.dim).child(where)))))
    .when(Boolean(body.text), (el) => el.child(div().w_full().text_size(T.card).line_height(1.45).text_color(c.text).child(body.text))));
}

const runningMark = (c) => stateMark(c, "working", VIEW.meta);

function runningCard(c, body) {
  return shell(c, v_flex().w_full().gap(G.sm).children((body.rows ?? []).map((row) => h_flex().w_full().items_center().gap(G.sm)
    .child(runningMark(c))
    .child(div().min_w(0).truncate().text_size(T.value).text_color(c.text).child(row.name || "Check"))
    .when(Boolean(row.workflow), (el) => el.child(div().min_w(0).truncate().text_size(T.body).text_color(c.dim).child(row.workflow)))
    .child(div().flex_1())
    .when(Boolean(row.elapsed), (el) => el.child(div().flex_none().text_size(T.body).text_color(c.dim).child(row.elapsed))))));
}

function checkCard(c, body) {
  return v_flex().w_full().gap(G.xs).children((body.rows ?? []).map((row) => h_flex().w_full().items_center().gap(G.sm)
    .child(div().min_w(0).truncate().text_size(T.value).text_color(c.text).child(row.name || "Check"))
    .child(div().flex_none().text_size(T.body).text_color(c.dim).child(WORD[row.state] || ""))));
}

export function verdictCard(c, body) {
  if (!body) return null;
  if (body.kind === "note") return div().text_size(T.value).text_color(c.muted).child(body.text || "");
  if (body.kind === "commits" || body.kind === "lines") return rows(c, body.lines);
  if (body.kind === "checks") return checkCard(c, body);
  if (body.kind === "log") return logCard(c, body);
  if (body.kind === "comment") return commentCard(c, body);
  if (body.kind === "running") return runningCard(c, body);
  return null;
}

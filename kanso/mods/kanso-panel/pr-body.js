// What the pull request verdict shows under it: the log, the comment, the checks, or the lines that state is about.
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { G, T } from "./ui.js";
import { card, code, row } from "./kit.js";

const WORD = { fail: "failed", pending: "running", unknown: "unknown", pass: "passed", skipped: "skipped" };

const rows = (list, facts) => card({ content: (list ?? []).map((check) => row({ name: check.name || "Check", ...facts(check) })) });

const PIECES = {
  log: (body) => card({ author: body.job || "Check", initial: "", step: body.step, age: body.elapsed, content: body.lines?.length ? [code({ text: body.lines.join("\n"), kind: "log" })] : [] }),
  comment: (body) => card({ author: body.author, initial: body.letter, where: `${body.path || ""}${body.line ? `:${body.line}` : ""}`, body: body.text }),
  running: (body) => rows(body.rows, (check) => ({ mark: "working", detail: check.workflow || null, meta: check.elapsed || null })),
  checks: (body) => rows(body.rows, (check) => ({ meta: WORD[check.state] || null })),
};

const lines = (c, list) => v_flex().w_full().gap(G.xs).children(list.filter((line) => line != null && line !== "").map((line) => div().text_size(T.value).text_color(c.muted).child(line)));
const TEXTS = { note: (body) => [body.text], commits: (body) => body.lines ?? [], lines: (body) => body.lines ?? [] };

export function verdictBody(c, body) {
  if (Object.hasOwn(PIECES, body?.kind ?? "")) return PIECES[body.kind](body)("pr-body", c);
  if (Object.hasOwn(TEXTS, body?.kind ?? "")) return lines(c, TEXTS[body.kind](body));
  return null;
}

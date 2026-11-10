// Cmd+F on an agent: the conversation, scrolled to the match. No conversation falls back to the terminal's Find.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { exec, hc, readTextFile, home, theme, props, closeOverlay, run, agents } from "herdr";
import { tokens, skeleton, controlInput } from "./ui.js";
import {
  locateConversation, resolveFind, readSlice, freshRead, applySlice, extendIndex, searchIndex,
  enterMatch, retarget, partsOf, whoOf, whenLabel, countLabel,
} from "./find.js";

const ROW = 104;
const WAIT = 120;
const RADIUS = 80;

function hintOf(address) {
  try {
    const agent = agents().find((a) => a.address === address);
    return [agent?.app, agent?.program?.key].filter(Boolean).join(" ");
  } catch { return ""; }
}

function words(text, mark, t) {
  return String(text ?? "").split(/\s+/).filter(Boolean).map((w) => {
    const el = div().max_w_full().child(w);
    return mark ? el.rounded(2).px(1).bg(t.accent).text_color(t.accent_foreground ?? t.background) : el;
  });
}

export class Find {
  init(cx, p) {
    this.terminal = p?.terminal ?? null;
    this.input = InputState.new({ value: "" });
    this.query = "";
    this.pending = "";
    this.hits = [];
    this.at = 0;
    this.index = [];
    this.state = freshRead();
    this.loading = true;
    this.gone = false;
    this.missing = false;
    this.caughtUp = false;
    this.shown = -1;
    this.cached = null;
    this.gen = 0;
    this.enterAt = 0;
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input.on("change", (_e, cx) => this.note(cx));
    this.input.on("submit", (e, cx) => this.enter(Boolean(e?.shift), cx));
    this.input.focus();
    cx.timer.after(600, () => { if (!this.gone) this.input.focus(); });
    cx.spawn(async (cx) => { await this.open(cx); });
  }

  note(cx) {
    this.pending = this.input.value();
    this.gen = this.gen + 1;
    const gen = this.gen;
    cx.timer.after(WAIT, (cx) => {
      if (this.gone || gen !== this.gen || this.pending === this.query) return;
      this.query = this.pending;
      this.hits = searchIndex(this.index, this.query);
      this.at = 0;
      this.shown = -1;
      this.remember();
      this.reveal();
      cx.notify();
    });
  }

  enter(shift, cx) {
    const now = Date.now();
    if (now - this.enterAt < 40) return;
    this.enterAt = now;
    this.gen = this.gen + 1;
    this.pending = this.input.value();
    const next = enterMatch(this, this.index, shift);
    this.query = next.query;
    this.hits = next.hits;
    this.at = next.at;
    this.remember();
    this.reveal();
    cx.notify();
  }

  remember() {
    const hit = this.hits[this.at];
    if (!hit) { this.cached = null; return; }
    this.cached = { turn: hit.turn, at: hit.at, len: hit.len, parts: partsOf(this.state.turns[hit.turn]?.text ?? "", hit, RADIUS) };
  }

  reveal() {
    const turn = this.hits[this.at]?.turn;
    if (turn == null || turn === this.shown) return;
    this.shown = turn;
    this.pendingScroll = turn;
  }

  sync(applied, keep) {
    this.state = applied.state;
    this.index = extendIndex(this.index, this.state.turns, applied.from, applied.reindex);
    if (!this.query) {
      this.hits = [];
      this.at = 0;
      this.cached = null;
      if (!keep) this.revealEnd();
      return;
    }
    const prev = this.hits[this.at];
    const next = keep && prev ? retarget(this.index, this.query, prev) : { hits: searchIndex(this.index, this.query), at: 0 };
    this.hits = next.hits;
    this.at = next.at;
    this.remember();
    this.reveal();
  }

  revealEnd() {
    const last = this.state.turns.length - 1;
    if (last < 0 || this.shown === last) return;
    this.shown = last;
    this.pendingScroll = last;
  }

  restart() {
    this.state = freshRead();
    this.index = [];
    this.hits = [];
    this.at = 0;
    this.cached = null;
    this.shown = -1;
  }

  async open(cx) {
    const where = await locateConversation({ exec, hc, readTextFile, home }, this.terminal, hintOf(this.terminal)).catch(() => ({ file: null }));
    if (this.gone) return;
    if (resolveFind(where).action !== "find") { this.giveBack(); return; }
    this.file = where.file;
    await this.catchUp(cx);
    if (this.gone || this.missing) return;
    cx.timer.every(2000, (cx) => { if (!this.gone) this.grow(cx); });
  }

  async catchUp(cx) {
    while (!this.gone) {
      const prev = this.state.from;
      const parsed = await readSlice(exec, this.file, prev);
      if (this.gone) return;
      if (!parsed) { this.missing = prev === 0 && !this.state.turns.length; break; }
      if (parsed.end === prev) { this.loading = false; this.caughtUp = true; break; }
      const applied = applySlice(this.state, parsed);
      if (applied.reset) { this.restart(); continue; }
      this.loading = false;
      this.sync(applied, false);
      cx.notify();
      if (parsed.end >= parsed.size) { this.caughtUp = true; return; }
    }
    this.loading = false;
    cx.notify();
  }

  async grow(cx) {
    if (this.reading || this.gone || !this.file) return;
    this.reading = true;
    try {
      const prev = this.state.from;
      const parsed = await readSlice(exec, this.file, prev);
      if (this.gone || !parsed) return;
      const applied = applySlice(this.state, parsed);
      if (applied.reset) { this.restart(); await this.catchUp(cx); return; }
      if (parsed.end === prev && !applied.reindex) return;
      this.sync(applied, true);
      cx.notify();
    } finally { this.reading = false; }
  }

  close() {
    if (this.gone) return;
    this.gone = true;
    closeOverlay(props()?.overlay);
    if (this.terminal) run("pane.focus", { terminal: this.terminal });
  }

  giveBack() {
    if (this.gone) return;
    this.gone = true;
    const term = this.terminal;
    closeOverlay(props()?.overlay);
    if (term) run("pane.focus", { terminal: term });
    run("terminal.search");
  }

  bones(c) {
    const { header, row } = skeleton(c);
    return v_flex().size_full().bg(c.canvas).text_color(c.text)
      .child(h_flex().h(48).flex_none().px(14).items_center().border_b(1).border_color(c.border).child(header(48, 13)))
      .child(v_flex().flex_1().p(8).gap(8).children([0, 1, 2, 3, 4].map((i) => row(i, 28))));
  }

  turnRow(i, t) {
    const turn = this.state.turns[i];
    const hit = this.hits[this.at];
    const on = hit?.turn === i;
    const parts = on && this.cached?.turn === i && this.cached.at === hit.at ? this.cached.parts : partsOf(turn?.text ?? "", null, RADIUS);
    const line = parts.flatMap((part) => words(part.text, part.mark, t));
    return v_flex().h(ROW).w_full().px(12).py(8).gap(4).overflow_hidden().rounded(6)
      .when(on, (el) => el.bg(t.selected ?? t.hover))
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(11).text_color(t.muted).child(whoOf(turn)))
        .child(div().text_size(11).text_color(t.dim).child(whenLabel(turn?.at))))
      .child(h_flex().flex_wrap().gap_x(4).gap_y(2).max_w_full().min_w(0).text_size(13).children(line));
  }

  render(cx) {
    const t = theme();
    const c = tokens(t);
    const n = this.state.turns.length;
    const key = (e, cx) => { if (e.key !== "escape") return; this.close(); cx.stop_propagation(); };
    const root = v_flex().id("find").size_full().min_h(0).bg(t.background).text_color(t.foreground).track_focus(this.handle).on_key_down(key)
      .child(h_flex().h(48).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Find"))
        .child(controlInput(Input.new(this.input), c).flex_1())
        .child(div().text_size(12).text_color(t.dim).whitespace_nowrap().child(countLabel(this.query, this.at, this.hits.length)))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(this.loading, (el) => el.child(v_flex().flex_1().p(8).gap(8).children([0, 1, 2, 3, 4].map((i) => skeleton({ border: t.border }).row(i, 28)))))
      .when(this.missing, (el) => el.child(div().p(12).text_size(12).text_color(t.dim).child("This conversation is no longer there.")))
      .when(!this.loading && !this.missing && n > 0, (el) => el.child(v_flex().flex_1().min_h(0).relative()
        .child(v_virtual_list("kanso-find-list", n, ROW, (i) => String(i), (range) => (
          Array.from({ length: range.end - range.start }, (_, k) => this.turnRow(range.start + k, t))
        )).track_scroll(this.scroll).size_full())
        .child(Scrollbar.vertical("kanso-find-list").absolute().inset_0())));
    if (this.pendingScroll != null && !this.loading && !this.missing && n > 0) {
      const to = this.pendingScroll;
      this.pendingScroll = null;
      this.scroll.scroll_to_item(to, "center");
    }
    return root;
  }
}

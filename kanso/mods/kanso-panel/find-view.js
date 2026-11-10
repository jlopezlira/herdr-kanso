// Cmd+F on an agent: a bar until you type, then only the matching turns.
import { div, list } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { exec, hc, readTextFile, home, theme, props, closeOverlay, run, agents } from "herdr";
import { tokens, skeleton, controlInput, G, H, T } from "./ui.js";
import {
  locateConversation, resolveFind, readSlice, freshRead, applySlice, extendIndex, searchIndex,
  chooseMatch, layOut, partsOf, whoOf, whenLabel, countLabel, blankQuery, retarget, EXCERPT,
} from "./find.js";

const WAIT = 120;
const MAX = 300; // the list stops here so Find does not cover the terminal

function hintOf(address) {
  try {
    const agent = agents().find((a) => a.address === address);
    return [agent?.app, agent?.program?.key].filter(Boolean).join(" ");
  } catch { return ""; }
}

export class Find {
  init(cx, p) {
    this.terminal = p?.terminal ?? null;
    this.input = InputState.new({ value: "" });
    this.query = "";
    this.pending = "";
    this.hits = [];
    this.at = 0;
    this.open = false;
    this.index = [];
    this.state = freshRead();
    this.loading = false;
    this.gone = false;
    this.missing = false;
    this.asked = false;
    this.begun = false;
    this.file = null;
    this.pendingScroll = false;
    this.gen = 0;
    this.enterAt = 0;
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input.on("change", (_e, cx) => this.note(cx));
    this.input.on("submit", (e, cx) => this.enter(Boolean(e?.shift), cx));
    this.input.focus();
    cx.timer.after(600, () => { if (!this.gone) this.input.focus(); });
    cx.spawn(async (cx) => { await this.locate(cx); });
  }

  snap() {
    return { pending: this.input.value(), query: this.query, hits: this.hits, at: this.at, open: this.open };
  }

  apply(next) {
    const scroll = next.at !== this.at || next.open !== this.open || next.query !== this.query || (!this.hits.length && next.hits.length);
    this.query = next.query;
    this.hits = next.hits;
    this.at = next.at;
    this.open = Boolean(next.open);
    if (scroll) this.pendingScroll = true;
  }

  note(cx) {
    this.pending = this.input.value();
    this.gen = this.gen + 1;
    const gen = this.gen;
    if (!blankQuery(this.pending)) this.arm(cx);
    if (blankQuery(this.pending)) {
      this.query = "";
      this.hits = [];
      this.at = 0;
      this.open = false;
      cx.notify();
      return;
    }
    cx.timer.after(WAIT, (cx) => {
      if (this.gone || gen !== this.gen || this.pending === this.query) return;
      this.apply(chooseMatch(this.snap(), this.index, { key: "type" }));
      cx.notify();
    });
  }

  arm(cx) {
    this.asked = true;
    if (this.file) this.begin(cx);
    else if (!this.begun) { this.loading = true; cx.notify(); }
  }

  enter(shift, cx) {
    const now = Date.now();
    if (now - this.enterAt < 40) return;
    this.enterAt = now;
    this.gen += 1;
    this.pending = this.input.value();
    if (!blankQuery(this.pending)) this.arm(cx);
    this.apply(chooseMatch(this.snap(), this.index, { key: shift ? "shift" : "enter" }));
    cx.notify();
  }

  pick(key, cx) {
    const index = Number(String(key).split(":")[0]);
    if (!Number.isInteger(index) || index < 0 || index >= this.hits.length) return;
    this.apply(chooseMatch(this.snap(), this.index, { key: "click", at: index }));
    this.input.focus();
    cx.notify();
  }

  sync(applied, keep) {
    this.state = applied.state;
    this.index = extendIndex(this.index, this.state.turns, applied.from, applied.reindex);
    this.loading = false;
    if (blankQuery(this.query)) {
      this.hits = [];
      this.at = 0;
      this.open = false;
      return;
    }
    const prev = keep ? this.hits[this.at] : null;
    const found = prev ? retarget(this.index, this.query, prev) : { hits: searchIndex(this.index, this.query), at: 0 };
    this.apply({ query: this.query, hits: found.hits, at: found.at, open: Boolean(keep && this.open && found.hits.length) });
  }

  restart() {
    this.state = freshRead();
    this.index = [];
    this.hits = [];
    this.at = 0;
    this.open = false;
  }

  async locate(cx) {
    const where = await locateConversation({ exec, hc, readTextFile, home }, this.terminal, hintOf(this.terminal)).catch(() => ({ file: null }));
    if (this.gone) return;
    if (resolveFind(where).action !== "find") { this.giveBack(); return; }
    this.file = where.file;
    if (this.asked) this.begin(cx);
  }

  begin(cx) {
    if (this.begun || !this.file) return;
    this.begun = true;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      await this.catchUp(cx);
      if (!this.gone) cx.timer.every(2000, (cx) => { if (!this.gone) this.grow(cx); });
    });
  }

  async catchUp(cx) {
    while (!this.gone) {
      const prev = this.state.from;
      const parsed = await readSlice(exec, this.file, prev);
      if (this.gone) return;
      if (!parsed) { this.missing = prev === 0 && !this.state.turns.length; break; }
      if (parsed.end === prev) break;
      const applied = applySlice(this.state, parsed);
      if (applied.reset) { this.restart(); continue; }
      this.sync(applied, this.open || this.at > 0);
      cx.notify();
      if (parsed.end >= parsed.size) return;
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

  shut(search) {
    if (this.gone) return;
    this.gone = true;
    const term = this.terminal;
    closeOverlay(props()?.overlay);
    if (term) run("pane.focus", { terminal: term });
    if (search) run("terminal.search");
  }

  close() { this.shut(false); }

  giveBack() { this.shut(true); }

  bar(c, count, field) {
    return h_flex().w_full().flex_none().px(G.md).py(G.sm).gap(G.sm).items_center()
      .child(div().flex_none().font_semibold().text_size(T.card).child("Find"))
      .child(field ? controlInput(field, c).flex_1() : div().flex_1().h(H.control))
      .child(div().flex_none().text_size(T.value).text_color(c.dim).whitespace_nowrap().child(count ?? ""))
      .child(div().flex_none().text_size(T.small).text_color(c.dim).child("Esc"));
  }

  bones(c) {
    return v_flex().w_full().bg(c.canvas).text_color(c.text).child(this.bar(c));
  }

  block(parts, t) {
    const stepped = parts.reduce((acc, part) => String(part.text ?? "").split("\n").reduce((state, bit, i) => {
      const words = bit.split(/\s+/).filter(Boolean).map((w) => ({ w, mark: part.mark }));
      return i ? { lines: state.lines.concat([state.cur]), cur: words } : { lines: state.lines, cur: state.cur.concat(words) };
    }, acc), { lines: [], cur: [] });
    const lines = stepped.cur.length || !stepped.lines.length ? stepped.lines.concat([stepped.cur]) : stepped.lines;
    const word = ({ w, mark }) => {
      const el = div().text_size(T.card).text_color(t.foreground).child(w);
      return mark ? el.rounded(2).px(1).bg(t.accent).text_color(t.accent_foreground ?? t.background) : el;
    };
    return v_flex().w_full().children(lines.map((line) => (
      line.length
        ? h_flex().w_full().flex_wrap().gap_x(G.xs).children(line.map(word))
        : div().text_size(T.card).child(" ")
    )));
  }

  partsFor(item) {
    if (item.kind === "hit") return partsOf(this.state.turns[item.hit.turn]?.text ?? "", item.hit, EXCERPT);
    const piece = item.piece ?? { text: "", from: 0, to: 0, mark: false };
    if (!piece.mark) return [{ text: piece.text, mark: false }];
    return [
      piece.from > 0 ? { text: piece.text.slice(0, piece.from), mark: false } : null,
      piece.to > piece.from ? { text: piece.text.slice(piece.from, piece.to), mark: true } : null,
      piece.to < piece.text.length ? { text: piece.text.slice(piece.to), mark: false } : null,
    ].filter(Boolean);
  }

  keyOf(item) {
    return `${item.index}:${item.k ?? -1}:${item.hit.turn}:${item.hit.at}`;
  }

  cell(item, t, c) {
    const turn = this.state.turns[item.hit.turn];
    return v_flex().w_full().px(G.md).when(item.head, (el) => el.pt(G.sm)).pb(G.xs).gap(G.xs)
      .when(item.index === this.at, (el) => el.bg(c.selected))
      .when(item.head, (el) => el.child(h_flex().gap(G.sm).items_center()
        .child(div().text_size(T.small).text_color(c.muted).child(whoOf(turn)))
        .child(div().text_size(T.small).text_color(c.dim).child(whenLabel(turn?.at)))))
      .child(this.block(this.partsFor(item), t));
  }

  render(cx) {
    const t = theme();
    const c = tokens(t);
    const onKey = (e, cx) => { if (e.key !== "escape") return; this.close(); cx.stop_propagation(); };
    const showSkel = this.loading && !blankQuery(this.pending) && !this.hits.length;
    const laid = !blankQuery(this.query) && this.hits.length
      ? layOut(this.hits, this.at, this.open, (hit) => this.state.turns[hit.turn]?.text ?? "")
      : { items: [], focus: 0 };
    const root = v_flex().id("find").w_full().bg(t.background).text_color(t.foreground).track_focus(this.handle).on_key_down(onKey)
      .child(this.bar(c, countLabel(this.query, this.at, this.hits.length), Input.new(this.input)))
      .when(showSkel, (el) => el.child(v_flex().w_full().px(G.sm).py(G.sm).gap(G.sm).children([0, 1, 2].map((i) => skeleton(c).row(i)))))
      .when(this.missing && !blankQuery(this.pending) && !this.loading, (el) => el.child(
        div().px(G.md).py(G.sm).text_size(T.small).text_color(c.dim).child("This conversation is no longer there.")))
      .when(laid.items.length > 0, (el) => el.child(v_flex().relative().w_full().max_h(MAX).min_h(0)
        .child(list("kanso-find", laid.items.length, (i) => this.keyOf(laid.items[i]), (i) => this.cell(laid.items[i], t, c))
          .w_full().max_h(MAX).track_scroll(this.scroll).on_item_click((key, cx) => this.pick(key, cx)))
        .child(Scrollbar.vertical("kanso-find").absolute().inset_0())));
    if (this.pendingScroll && laid.items.length) {
      const to = laid.focus;
      this.pendingScroll = false;
      this.scroll.scroll_to_item(to, "center");
    }
    return root;
  }
}

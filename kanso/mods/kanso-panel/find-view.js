import { div, list, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { exec, hc, readTextFile, home, theme, props, closeOverlay, run, agents, shared, setShared } from "herdr";
import { tokens, skeleton, controlInput, iconButton, G, H, R, T } from "./ui.js";
import {
  locateConversation, resolveFind, readSlice, freshRead, applySlice, extendIndex, searchIndex,
  chooseMatch, layOut, partsOf, whoOf, whenLabel, countLabel, blankQuery, retarget, keptQuery, withQuery, findChord, EXCERPT, DRAW,
} from "./find.js";

const WAIT = 120;
const EASE = { duration: 180, easing: "ease-out" };
const MAX = 300; // the list stops here so Find does not cover the terminal
const READ = 8000;
const FIND = "kanso.find";

function hintOf(address) {
  try {
    const agent = agents().find((a) => a.address === address);
    return [agent?.app, agent?.program?.key].filter(Boolean).join(" ");
  } catch { return ""; }
}

export class Find {
  init(cx, p) {
    const remembered = keptQuery({ queries: this.kept }, p?.terminal);
    this.terminal = p?.terminal ?? null;
    this.input = InputState.new({ value: remembered, placeholder: "Find in conversation" });
    this.query = remembered;
    this.pending = remembered;
    this.hits = [];
    this.at = 0;
    this.open = false;
    this.index = [];
    this.state = freshRead();
    this.loading = false;
    this.gone = false;
    this.leaving = false;
    this.missing = false;
    this.asked = false;
    this.begun = false;
    this.file = null;
    this.pendingScroll = false;
    this.gen = 0;
    this.enterAt = 0;
    this.rise = null;
    this.slicing = false;
    this.boxH = 0;
    this.hidAt = 0;
    this.wasShow = false;
    this.seen = 0;
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input.on("change", (_e, cx) => this.note(cx));
    this.input.on("submit", (e, cx) => this.enter(Boolean(e?.shift), cx));
    if (remembered) this.input.set_selected_range({ start: 0, end: remembered.length });
    setShared(FIND, { terminal: this.terminal, select: 0 });
    this.input.focus();
    cx.timer.after(600, () => { if (!this.gone) this.input.focus(); });
    if (remembered) this.arm(cx);
    cx.spawn(async (cx) => { await this.locate(cx); });
  }

  restoreState(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) return false;
    if (state.queries != null && (typeof state.queries !== "object" || Array.isArray(state.queries))) return false;
    this.kept = state.queries ?? {};
    return true;
  }

  saveState() {
    return { queries: withQuery(this.kept, this.terminal, this.input?.value() ?? this.query) };
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
    this.move(Boolean(shift), cx);
  }

  move(newer, cx) {
    if (!this.input) return;
    this.gen = this.gen + 1;
    this.pending = this.input.value();
    if (!blankQuery(this.pending)) this.arm(cx);
    this.apply(chooseMatch(this.snap(), this.index, { key: newer ? "up" : "down" }));
    cx.notify();
  }

  pick(key, cx) {
    if (String(key).startsWith("day:")) return;
    const index = Number(String(key).split(":")[0]);
    if (!Number.isInteger(index) || index < 0 || index >= this.hits.length) return;
    this.apply(chooseMatch(this.snap(), this.index, { key: "click", at: index }));
    this.input.focus();
    cx.notify();
  }

  back(cx) {
    this.apply(chooseMatch(this.snap(), this.index, { key: "back" }));
    this.input.focus();
    cx.notify();
  }

  selectAll() {
    const value = this.input.value();
    this.input.set_selected_range({ start: 0, end: value.length });
    this.input.focus();
  }

  escape(cx) {
    if (!blankQuery(this.pending) || !blankQuery(this.query) || this.open) {
      this.input.set_value("");
      this.pending = "";
      this.query = "";
      this.hits = [];
      this.at = 0;
      this.open = false;
      this.gen = this.gen + 1;
      cx.notify();
      return;
    }
    this.shut(false, cx);
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
    if (resolveFind(where).action !== "find") { this.giveBack(cx); return; }
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
    if (this.slicing || this.gone || !this.file) return;
    this.slicing = true;
    try {
      const prev = this.state.from;
      const parsed = await readSlice(exec, this.file, prev);
      if (this.gone || !parsed) return;
      const applied = applySlice(this.state, parsed);
      if (applied.reset) { this.restart(); await this.catchUp(cx); return; }
      if (parsed.end === prev && !applied.reindex) return;
      this.sync(applied, true);
      cx.notify();
    } finally { this.slicing = false; }
  }

  shut(search, cx) {
    if (this.gone) return;
    this.gone = true;
    this.leaving = true;
    const term = this.terminal;
    const done = () => {
      setShared(FIND, null);
      closeOverlay(props()?.overlay);
      if (term) run("pane.focus", { terminal: term });
      if (search) run("terminal.search");
    };
    if (!cx?.timer) { done(); return; }
    cx.notify();
    cx.timer.after(EASE.duration, () => done());
  }

  close(cx) { this.shut(false, cx); }

  giveBack(cx) { this.shut(true, cx); }

  bar(c, count, field) {
    const quiet = !count || count === "No matches";
    return h_flex().w_full().flex_none().px(G.md).py(G.sm).gap(G.sm).items_center()
      .child(svg("mods/kanso-chrome/icons/search.svg").size(15).flex_none().text_color(c.muted))
      .child(field ? controlInput(field, c).flex_1() : div().flex_1().h(H.control))
      .child(div().flex_none().text_size(T.value).text_color(quiet ? c.dim : c.muted).whitespace_nowrap().child(count ?? ""))
      .child(iconButton("find-prev", "chevron-up", "Previous match", (cx) => this.move(true, cx), c, { disabled: !this.hits?.length }))
      .child(iconButton("find-next", "chevron-down", "Next match", (cx) => this.move(false, cx), c, { disabled: !this.hits?.length }));
  }

  bones(c) {
    return v_flex().w_full().rounded(R.card).bg(c.canvas).border_1().border_color(c.border).child(this.bar(c));
  }

  block(parts, c) {
    const stepped = parts.reduce((acc, part) => String(part.text ?? "").split("\n").reduce((state, bit, i) => {
      const words = bit.split(/\s+/).filter(Boolean).map((w) => ({ w, mark: part.mark }));
      return i ? { lines: state.lines.concat([state.cur]), cur: words } : { lines: state.lines, cur: state.cur.concat(words) };
    }, acc), { lines: [], cur: [] });
    const lines = stepped.cur.length || !stepped.lines.length ? stepped.lines.concat([stepped.cur]) : stepped.lines;
    const word = ({ w, mark }) => {
      const el = div().text_size(T.card).child(w);
      return mark ? el.rounded(R.control).px(G.xs).bg(c.highlight).text_color(c.accent) : el.text_color(c.muted);
    };
    return v_flex().w_full().children(lines.map((line) => (
      line.length
        ? h_flex().w_full().flex_wrap().gap_x(G.xs).children(line.map(word))
        : div().text_size(T.card).child(" ")
    )));
  }

  partsFor(item) {
    return partsOf(this.state.turns[item.hit.turn]?.text ?? "", item.hit, EXCERPT);
  }

  keyOf(item) {
    if (item.kind === "day") return `day:${item.index}:${item.label}`;
    return `${item.index}:${item.hit.turn}:${item.hit.at}`;
  }

  cell(item, c) {
    if (item.kind === "day") {
      return div().w_full().px(G.md).pt(G.sm).pb(G.xs).text_size(T.small).text_color(c.dim).child(item.label);
    }
    const turn = this.state.turns[item.hit.turn];
    const on = item.index === this.at;
    return v_flex().w_full().px(G.md).py(G.xs).gap(G.xs)
      .when(on, (el) => el.bg(c.selected))
      .hover((s) => s.bg(c.selected))
      .child(h_flex().gap(G.sm).items_center()
        .child(div().text_size(T.small).text_color(c.muted).child(whoOf(turn)))
        .child(div().text_size(T.small).text_color(c.dim).child(whenLabel(turn?.at))))
      .child(this.block(this.partsFor(item), c));
  }

  reading(c) {
    const hit = this.hits[this.at];
    const turn = this.state.turns[hit?.turn];
    const text = String(turn?.text ?? "");
    const body = text.length > READ ? `${text.slice(0, READ)}\n\n…` : text;
    return v_flex().w_full().max_h(MAX)
      .child(h_flex().px(G.sm).pt(G.xs).items_center()
        .child(iconButton("find-back", "chevron-left", "Back", (cx) => this.back(cx), c))
        .child(div().text_size(T.small).text_color(c.muted).child(whoOf(turn)))
        .child(div().text_size(T.small).text_color(c.dim).child(whenLabel(turn?.at))))
      .child(div().px(G.md).pb(G.xs).child(this.block(hit ? partsOf(text, hit, EXCERPT) : [], c)))
      .child(div().id(`find-read-${hit?.turn ?? 0}`).w_full().flex_1().min_h(0).max_h(MAX).overflow_y_scrollbar().px(G.lg).py(G.sm)
        .child(TextView.markdown(`find-turn-${hit?.turn ?? 0}-${hit?.at ?? 0}`, body).selectable(true)));
  }

  listBox(c, laid) {
    return v_flex().relative().w_full().max_h(MAX).min_h(0)
      .child(list("kanso-find", laid.items.length, (i) => this.keyOf(laid.items[i]), (i) => this.cell(laid.items[i], c))
        .w_full().max_h(MAX).track_scroll(this.scroll).on_item_click((key, cx) => this.pick(key, cx)))
      .child(Scrollbar.vertical("kanso-find").absolute().inset_0());
  }

  well(show, content, cx) {
    if (show && this.rise == null) {
      this.rise = 0;
      cx.timer.after(16, (cx) => { if (!this.gone && this.rise === 0) { this.rise = 1; cx.notify(); } });
    }
    if (!show && this.wasShow) {
      this.hidAt = Date.now();
      cx.timer.after(EASE.duration, (cx) => { if (!this.gone) cx.notify(); });
    }
    const closing = !show && this.hidAt && Date.now() - this.hidAt < EASE.duration;
    if (!show) this.rise = null;
    this.wasShow = show;
    const drawn = show || closing;
    if (!drawn) return null;
    const start = show && this.rise === 0;
    return div().w_full().flex_none().overflow_hidden()
      .h(start || closing ? 0 : (this.boxH || "auto")).opacity(start || closing ? 0 : 1)
      .transition("height", EASE).transition("opacity", EASE)
      .child(div().w_full().flex_none().on_size_change((size, sizeCx) => {
        const next = Math.round(size.height);
        if (!next || next === this.boxH) return;
        this.boxH = next;
        sizeCx.notify();
      }).child(content));
  }

  render(cx) {
    const t = theme();
    const c = tokens(t);
    const mark = shared(FIND);
    if (mark?.terminal === this.terminal && mark.select !== this.seen) {
      this.seen = mark.select;
      if (mark.select) this.selectAll();
    }
    const onKey = (e, cx) => {
      if (findChord(e.modifiers) && String(e.key).toLowerCase() === "f") { this.selectAll(); cx.stop_propagation(); return; }
      if (e.key === "escape") { this.escape(cx); cx.stop_propagation(); return; }
      if (e.key === "up") { this.move(true, cx); cx.stop_propagation(); return; }
      if (e.key === "down") { this.move(false, cx); cx.stop_propagation(); }
    };
    const showSkel = this.loading && !blankQuery(this.pending) && !this.hits.length;
    const laid = !this.open && !blankQuery(this.query) && this.hits.length
      ? layOut(this.hits, this.at, DRAW, (hit) => this.state.turns[hit.turn]?.at)
      : { items: [], focus: 0 };
    const show = this.open || laid.items.length > 0 || showSkel || (this.missing && !blankQuery(this.pending) && !this.loading);
    const body = this.open
      ? this.reading(c)
      : laid.items.length
        ? this.listBox(c, laid)
        : showSkel
          ? v_flex().w_full().px(G.sm).py(G.sm).gap(G.sm).children([0, 1].map((i) => skeleton(c).row(i)))
          : div().px(G.md).py(G.sm).text_size(T.small).text_color(c.dim).child("This conversation is no longer there.");
    const root = v_flex().id("find").w_full().rounded(R.card).bg(c.canvas).border_1().border_color(c.border)
      .text_color(t.foreground).track_focus(this.handle).on_key_down(onKey)
      .opacity(this.leaving ? 0 : 1).transition("opacity", EASE)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(this.bar(c, countLabel(this.query, this.at, this.hits.length), Input.new(this.input)))
      .child(this.well(show, body, cx) ?? div());
    if (this.pendingScroll && laid.items.length) {
      this.pendingScroll = false;
      this.scroll.scroll_to_item(laid.focus, "center");
    }
    return root;
  }
}

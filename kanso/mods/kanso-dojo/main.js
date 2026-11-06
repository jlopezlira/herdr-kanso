// hjkl dōjō, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// A place to practice vim's moves until the fingers know them, with Hachi,
// a pixel shiba. Nine levels, from h and l alone on a board to w b
// e, f t, 0 ^ $ and gg G on real lines of code. A round is 60 seconds: bring
// the cursor onto the target, in the fewest moves for points and a streak.
// After two seconds still, the key that gets there lights up.
//
// It opens as a window (kansō help, or `mod.open` kanso-dojo), so a click
// elsewhere or a stray Esc never ends a round: leaving asks first (Esc
// twice, or × twice). Rounds and the level you are on live in
// data/kanso-dojo/dojo.db (store.js); Share makes a card of your numbers.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, appHome, settings } from "herdr";
import { G, tokens, iconButton } from "./ui.js";
import { Store } from "./store.js";
import { Share } from "./share.js";
import { dojoShare } from "./card.js";
import { hachi } from "./mascot.js";
import { LEVELS, gridWorld, textWorld, move, shortest, newTarget, points, same } from "./dojo.js";

const ROUND_S = 60, HINT_MS = 2000, LIT_MS = 600, ARM_MS = 3000, SLEEP_MS = 20000;
const CELL = 30; // a board cell
const FINGER = { h: ["←", "index, reach"], j: ["↓", "index"], k: ["↑", "middle"], l: ["→", "ring"] };

export default class Dojo extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.store = new Store();
    this.share = new Share("kanso-dojo", `${appHome()}/data/kanso-dojo/share`);
    this.totals = { bests: {}, rounds: 0, rings: 0, fewest: 0, longest: 0, days: [], first: null };
    this.snippet = 0;
    this.pending = ""; // a count, a first g, or f t F T waiting for its letter
    this.lit = null;
    this.armed = 0; // leaving asked for, at
    this.setLevel(1, false);
    cx.spawn(async (cx) => {
      try {
        const n = await this.store.level();
        if (!this.round) this.setLevel(Math.min(LEVELS.length, Math.max(1, n)), false);
        this.totals = await this.store.totals();
      } catch (e) { this.say = String(e?.message ?? e); }
      cx.notify();
    });
    // The clock and the hint: a look twice a second, only while it matters.
    cx.timer.every(500, (cx) => {
      if (this.round && Date.now() - this.round.at >= ROUND_S * 1000) this.endRound(cx);
      if (this.round || this.lit || this.armed) cx.notify();
    });
  }

  get bests() { return this.totals.bests ?? {}; }

  setLevel(n, keep = true) {
    this.level = LEVELS[n - 1];
    if (keep) this.store.setLevel(n).catch(() => {});
    this.world = this.level.world === "grid" ? gridWorld() : textWorld(this.snippet);
    this.at = this.level.world === "grid" ? { x: 9, y: 4 } : { x: 0, y: 0 };
    this.round = null; this.over = null; this.pending = ""; this.say = null; this.last = null; this.record = false;
    this.next();
  }

  next() {
    const { target, need } = newTarget(this.world, this.at, this.level);
    this.target = target; this.need = need; this.moves = 0; this.idleAt = Date.now();
  }

  startRound() {
    this.round = { at: Date.now(), score: 0, hits: 0, perfect: 0, streak: 0, longest: 0 };
    this.over = null; this.record = false;
  }

  endRound(cx) {
    const r = this.round, n = this.level.n;
    this.round = null;
    this.record = r.score > 0 && r.score > (this.bests[n] ?? 0);
    this.over = r;
    if (this.level.world === "text") { this.snippet += 1; this.world = textWorld(this.snippet); this.at = { x: 0, y: 0 }; this.next(); }
    cx.spawn(async (cx) => {
      try {
        await this.store.add({ at: r.at, level: n, score: r.score, rings: r.hits, fewest: r.perfect, streak: r.longest });
        this.totals = await this.store.totals();
      } catch (e) { this.say = `This round could not be kept: ${String(e?.message ?? e)}`; }
      cx.notify();
    });
  }

  light(key, cx) {
    const at = Date.now();
    this.lit = { key, at };
    cx.timer.after(LIT_MS, (cx) => { if (this.lit?.at === at) { this.lit = null; cx.notify(); } });
  }

  // A key: Esc (twice) leaves, a count or a first g or f waits for more,
  // a motion moves. Arrows are not vim's.
  key(e, cx) {
    const k = String(e.key ?? "").toLowerCase(), m = e.modifiers ?? {};
    if (m.platform || m.control || m.alt) return;
    cx.stop_propagation();
    if (k === "escape") {
      if (this.pending) { this.pending = ""; cx.notify(); return; }
      if (Date.now() - this.armed <= ARM_MS) { closeOverlay(props()?.overlay); return; }
      this.armed = Date.now(); cx.notify(); return;
    }
    this.armed = 0;
    const ch = e.key_char ?? (m.shift && k.length === 1 ? k.toUpperCase() : k);
    if (["left", "right", "up", "down"].includes(k)) { this.say = "The arrows don't count in the dōjō: h j k l."; cx.notify(); return; }
    if ((k === "enter" || k === "space") && this.over) { this.over = null; cx.notify(); return; }
    if (!ch || ch.length !== 1) return;
    this.light(ch.toLowerCase(), cx);
    const lv = this.level, p = this.pending;
    let motion = null;
    if (/^[ftFT]$/.test(p)) motion = p + ch;
    else if (p === "g") { if (ch === "g") motion = "gg"; }
    else if (/^\d+$/.test(p) && /[hjkl]/.test(ch)) motion = p + ch;
    else if (lv.counts && /[1-9]/.test(ch)) { this.pending = (p + ch).slice(-1); cx.notify(); return; }
    else if (ch === "g" && lv.motions.includes("gg")) { this.pending = "g"; cx.notify(); return; }
    else if (/^[ftFT]$/.test(ch) && lv.motions.includes(ch)) { this.pending = ch; cx.notify(); return; }
    else motion = ch;
    this.pending = "";
    const base = motion.replace(/^[1-9]\d*/, "")[0] === "g" ? "gg" : motion.replace(/^[1-9]\d*/, "")[0];
    if (!lv.motions.includes(base)) {
      const later = LEVELS.find((L) => L.motions.includes(base));
      this.say = later ? `${base} comes at level ${later.n}. Here: ${lv.motions.join(" ")}` : `${ch} is not a move here: ${lv.motions.join(" ")}`;
      cx.notify(); return;
    }
    this.play(motion, cx);
  }

  play(motion, cx) {
    if (!this.round) this.startRound();
    this.over = null; this.say = null;
    this.at = move(this.world, this.at, motion);
    this.moves += 1;
    this.idleAt = Date.now();
    if (same(this.at, this.target)) {
      const r = this.round, fine = this.moves <= this.need;
      r.score += points(this.moves, this.need, r.streak);
      r.hits += 1;
      if (fine) { r.perfect += 1; r.streak += 1; r.longest = Math.max(r.longest, r.streak); } else r.streak = 0;
      this.last = { moves: this.moves, need: this.need, fine };
      this.next();
    }
    cx.notify();
  }

  mood() {
    const now = Date.now();
    if (!this.round && now - (this.idleAt ?? now) > SLEEP_MS) return "sleep";
    if (this.record || (this.round?.streak ?? 0) >= 3 || this.last?.fine && this.round) return "glad";
    if (this.moves > this.need + 2) return "sweat";
    return "calm";
  }

  // Hachi's line: what the game needs you to know now.
  line() {
    const r = this.round, o = this.over, now = Date.now();
    if (now - this.armed <= ARM_MS) return "Press Esc again to leave the dōjō.";
    if (this.say) return this.say;
    if (o) return `Time. ${o.score} points, ${o.hits} targets, ${o.perfect} in the fewest moves.${this.record ? " A new best!" : ""} Move to go again.`;
    if (/^[ftFT]$/.test(this.pending)) return `${this.pending}… now the letter to find.`;
    if (this.pending === "g") return "g… another g for the first line.";
    if (/^\d$/.test(this.pending)) return `${this.pending}… now h j k or l.`;
    if (!r) return now - (this.idleAt ?? now) > SLEEP_MS ? "Zzz. Any move wakes me." : "Make a move to start: 60 seconds, as many targets as you can.";
    const hint = now - this.idleAt >= HINT_MS ? shortest(this.world, this.at, this.target, this.level).first : null;
    if (hint) return `Try ${hint}.`;
    if (this.last) return this.last.fine ? (r.streak >= 3 ? `${r.streak} in a row in the fewest moves.` : "In the fewest moves.") : `${this.last.moves} moves; ${this.last.need} would do.`;
    return `This one takes ${this.need} at best.`;
  }

  // The board of cells, the cursor filled, the target ringed.
  grid(c, ink) {
    const { w, h } = this.world;
    return v_flex().gap(3).children(Array.from({ length: h }, (_, y) => h_flex().gap(3).children(Array.from({ length: w }, (_, x) => {
      const here = x === this.at.x && y === this.at.y, goal = x === this.target.x && y === this.target.y;
      return div().size(CELL).rounded(5).bg(here ? c.accent : c.text + "08").when(goal && !here, (el) => el.border_2().border_color(c.accent));
    }))));
  }

  // The lines of code, one cell per letter, as a terminal shows them.
  text(c, ink) {
    const mono = settings()?.font_family ?? "JetBrains Mono";
    return v_flex().gap(4).children(this.world.lines.map((line, y) => h_flex().h(26).items_center().children([...(line.length ? line : " ")].map((ch, x) => {
      const here = x === this.at.x && y === this.at.y, goal = x === this.target.x && y === this.target.y;
      return div().w(12).h(24).flex().items_center().justify_center().rounded(3).font_family(mono).text_size(15)
        .bg(here ? c.accent : c.text + "00").text_color(here ? ink : goal ? c.text : c.muted)
        .when(goal && !here, (el) => el.border_2().border_color(c.accent).bg(c.accent + "22"))
        .child(ch === " " ? " " : ch);
    }))));
  }

  // A key of the level as a cap, with what it does; lit when pressed or hinted.
  cap(c, ink, key, word, hinted, sub = null) {
    const lit = this.lit?.key === key.toLowerCase();
    return v_flex().gap(3).items_center()
      .child(div().h(38).min_w(38).px(8).rounded(7).border_1()
        .border_color(lit || hinted ? c.accent : c.accent + "70").bg(lit ? c.accent : hinted ? c.accent + "40" : c.accent + "1c")
        .flex().items_center().justify_center().text_size(14).font_semibold().text_color(lit ? ink : c.text).child(key))
      .child(div().text_size(11).text_color(hinted ? c.accent : c.muted).child(word))
      .when(Boolean(sub), (el) => el.child(div().text_size(9.5).text_color(c.dim).child(sub)));
  }

  render() {
    const t = theme(), c = tokens(t), ink = t.accent_foreground ?? c.canvas;
    const lv = this.level, r = this.round, now = Date.now();
    const left = r ? Math.max(0, ROUND_S - Math.floor((now - r.at) / 1000)) : ROUND_S;
    const hint = r && now - this.idleAt >= HINT_MS ? shortest(this.world, this.at, this.target, lv).first : null;
    const hintBase = hint ? hint.replace(/^[1-9]\d*/, "").slice(0, hint.startsWith("gg") ? 2 : 1) : null;
    const best = this.bests[lv.n];
    const words = { h: "left", j: "down", k: "up", l: "right", w: "next word", b: "word back", e: "word end", f: "find", t: "till", F: "find back", T: "till back", 0: "line start", "^": "first letter", $: "line end", gg: "first line", G: "last line" };
    const keysRow = h_flex().gap(G.md).flex_wrap().items_start()
      .children(lv.motions.map((m) => this.cap(c, ink, m, words[m] ?? m, hintBase === m, FINGER[m]?.[1] ?? null)))
      .when(Boolean(lv.counts), (el) => el.child(this.cap(c, ink, "2-9", "then a key", /^[1-9]/.test(hint ?? ""))));
    const stat = (label, value, strong = false) => v_flex().gap(2)
      .child(div().text_size(10.5).text_color(c.dim).child(label))
      .child(div().text_size(strong ? 26 : 16).font_semibold().text_color(strong ? c.accent : c.text).child(String(value)));
    const levelRow = (L) => {
      const on = L.n === lv.n, b = this.bests[L.n];
      return h_flex().id(`level-${L.n}`).h(30).px(10).gap(G.sm).items_center().rounded(7).cursor_pointer()
        .bg(on ? c.accent + "24" : c.text + "00").border_1().border_color(on ? c.accent : c.text + "00")
        .hover((s) => s.bg(c.text + "0a"))
        .on_click((_e, cx) => { if (!this.round) { this.setLevel(L.n); cx.notify(); } else { this.say = "Finish the round first, or wait for the time."; cx.notify(); } })
        .child(div().w(14).text_size(11).font_semibold().text_color(on ? c.accent : c.dim).child(String(L.n)))
        .child(div().flex_1().text_size(12.5).text_color(on ? c.text : c.muted).child(L.name))
        .child(div().text_size(11).text_color(c.dim).child(b != null ? String(b) : ""));
    };
    const leaving = now - this.armed <= ARM_MS;
    return v_flex().id("kanso-dojo").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx))
      // The title bar: drag the window by it; × asks before it closes.
      .child(h_flex().h(44).px(16).gap(G.md).items_center().border_b_1().border_color(c.border)
        .child(svg("mods/kanso-chrome/icons/enso.svg").size(16).text_color(c.accent))
        .child(div().text_size(14).font_semibold().child("hjkl dōjō"))
        .child(div().text_size(12).text_color(c.dim).child(`level ${lv.n} · ${lv.name}`))
        .child(div().flex_1())
        .when(this.totals.rounds > 0, (el) => el.child(div().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(iconButton("dojo-share", "share", "Share", (cx) => this.share.toggle(cx), c, { active: this.share.open }))))
        .child(div().id("dojo-close").h(26).px(10).rounded(6).flex().items_center().cursor_pointer()
          .text_size(12).text_color(leaving ? c.accent : c.muted).hover((s) => s.bg(c.subtle))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { if (leaving) closeOverlay(props()?.overlay); else { this.armed = Date.now(); cx.notify(); } })
          .child(leaving ? "Leave? Click again" : "Leave")))
      .child(h_flex().flex_1().min_h(0).items_start().gap(G.xl).p(20)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        // Hachi, the numbers, the levels.
        .child(v_flex().w(196).flex_none().gap(G.lg)
          .child(h_flex().gap(G.md).items_end()
            .child(hachi(t, { mood: this.mood(), px: 8 }))
            .child(div().pb(4).text_size(11).text_color(c.dim).child(this.mood() === "sleep" ? "z z" : "")))
          .child(h_flex().gap(G.lg)
            .child(stat("Score", r ? r.score : this.over ? this.over.score : 0, true))
            .child(stat("Time", `${left}s`)))
          .child(h_flex().gap(G.lg)
            .child(stat("Streak", r ? r.streak : 0))
            .child(stat("Best", best ?? "–")))
          .child(v_flex().gap(2).children(LEVELS.map(levelRow))))
        // The board or the code, the time, the line, the keys.
        .child(v_flex().flex_1().min_w(0).gap(G.lg)
          .when(this.share.open && this.totals.rounds > 0, (el) => el.child(this.share.row(c, () => ({ ...dojoShare(this.totals), name: "dojo", title: "hjkl dōjō" }),
            "Your best round, targets, days practiced and levels: nothing else. The post opens with the image in it.", G.sm)))
          .child(div().text_size(12.8).line_height(1.5).text_color(c.muted).child(lv.tip))
          .child(div().p(14).rounded(12).bg(c.text + "05").border_1().border_color(c.border)
            .child(lv.world === "grid" ? this.grid(c, ink) : this.text(c, ink)))
          .child(div().w_full().h(4).rounded_full().bg(c.text + "10")
            .child(div().h(4).rounded_full().bg(c.accent).w(`${(100 * left) / ROUND_S}%`)))
          .child(h_flex().min_h(40).px(14).py(10).rounded(10).bg(leaving ? c.accent + "30" : c.accent + "14").items_center()
            .child(div().text_size(13).line_height(1.45).text_color(c.text).child(this.line())))
          .child(keysRow)));
  }
}

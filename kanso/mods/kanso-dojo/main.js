import { paths } from "./platform.js";
// hjkl dōjō, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, appHome, settings } from "herdr";
import { G, tokens, iconButton } from "./ui.js";
import { Store } from "./store.js";
import { Share } from "./share.js";
import { dojoShare } from "./card.js";
import { TICK_MS, Companion } from "./pets.js";
import { LEVELS, gridWorld, textWorld, move, shortest, newTarget, points, same } from "./dojo.js";

const TARGETS = 10, HINT_MS = 2000, LIT_MS = 600, ARM_MS = 3000, SLEEP_MS = 20000;
const CELL = 30;
const FINGER = { h: ["←", "index, reach"], j: ["↓", "index"], k: ["↑", "middle"], l: ["→", "ring"] };

export default class Dojo extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.store = new Store();
    this.share = new Share("kanso-dojo", paths.join(appHome(), "data", "kanso-dojo", "share"));
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
    cx.timer.every(500, (cx) => { if (this.round || this.lit || this.armed) cx.notify(); });
    this.pal = new Companion(this.store); this.choosing = false;
    this.pal.load(cx);
    // A pet moves on its own: a redraw only when its frame changes.
    cx.timer.every(TICK_MS, (cx) => { const r = this.reaction(); if (this.pal.moved(r.state, r.since)) cx.notify(); });
  }

  // The pet is still until the game gives it something: a target in the fewest moves, a streak,
  // a key that is no move, the long way round, a round won or a new best. Then a while, and still again.
  // `since`: when it began, so the reaction plays from its first frame.
  reaction(now = Date.now()) {
    const o = this.over, at = (t, ms) => t != null && now - t < ms;
    if (o?.kept && at(this.overAt, this.record ? 3000 : 2200)) return { state: this.record ? "jumping" : "waving", since: this.overAt };
    if (!o && at(this.hitAt, this.cheer ? 1600 : 900)) return { state: this.cheer ? "waving" : "jumping", since: this.hitAt };
    if (!o && at(this.missAt, 1200)) return { state: "failed", since: this.missAt };
    if (this.mood() === "sleep") return { state: "waiting", since: 0 };
    return { state: "idle", since: 0 };
  }
  petState(now = Date.now()) { return this.reaction(now).state; }

  toggleChooser(cx) {
    this.choosing = !this.choosing;
    if (this.choosing) this.pal.bring(cx);
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

  endRound(cx, kept = true) {
    const r = this.round, n = this.level.n;
    if (!r) return;
    this.round = null;
    this.record = kept && r.score > 0 && r.score > (this.bests[n] ?? 0);
    this.over = { ...r, ms: Date.now() - r.at, kept }; this.overAt = Date.now();
    this.pending = ""; this.say = null;
    if (this.level.world === "text") { this.snippet += 1; this.world = textWorld(this.snippet); this.at = { x: 0, y: 0 }; this.next(); }
    if (!kept) return;
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

  key(e, cx) {
    const k = String(e.key ?? "").toLowerCase(), m = e.modifiers ?? {};
    if (m.platform || m.control || m.alt) return;
    cx.stop_propagation();
    if (this.choosing) { if (k === "escape") { this.choosing = false; cx.notify(); } return; }
    if (k === "escape") {
      if (this.pending) { this.pending = ""; cx.notify(); return; }
      if (Date.now() - this.armed <= ARM_MS) { closeOverlay(props()?.overlay); return; }
      this.armed = Date.now(); cx.notify(); return;
    }
    this.armed = 0;
    const ch = e.key_char ?? (m.shift && k.length === 1 ? k.toUpperCase() : k);
    if (["left", "right", "up", "down"].includes(k)) { this.say = "The arrows don't count in the dōjō: h j k l."; this.missAt = Date.now(); cx.notify(); return; }
    if (this.over) {
      if (k === "enter" || k === "space") this.again();
      else if (k === "n" && this.level.n < LEVELS.length) this.setLevel(this.level.n + 1);
      cx.notify(); return;
    }
    if (!ch || ch.length !== 1) return;
    this.light(ch.toLowerCase(), cx);
    const lv = this.level, p = this.pending;
    const step = /^[ftFT]$/.test(p) ? { motion: p + ch }
      : p === "g" ? { motion: ch === "g" ? "gg" : null }
      : /^\d+$/.test(p) && /[hjkl]/.test(ch) ? { motion: p + ch }
      : lv.counts && /[1-9]/.test(ch) ? { wait: (p + ch).slice(-1) }
      : ch === "g" && lv.motions.includes("gg") ? { wait: "g" }
      : /^[ftFT]$/.test(ch) && lv.motions.includes(ch) ? { wait: ch }
      : { motion: ch };
    if ("wait" in step) { this.pending = step.wait; cx.notify(); return; }
    const { motion } = step;
    this.pending = "";
    const base = motion.replace(/^[1-9]\d*/, "")[0] === "g" ? "gg" : motion.replace(/^[1-9]\d*/, "")[0];
    if (!lv.motions.includes(base)) {
      const later = LEVELS.find((L) => L.motions.includes(base));
      this.say = later ? `${base} comes at level ${later.n}. Here: ${lv.motions.join(" ")}` : `${ch} is not a move here: ${lv.motions.join(" ")}`;
      this.missAt = Date.now();
      cx.notify(); return;
    }
    this.play(motion, cx);
  }

  again() { this.over = null; this.record = false; this.next(); }

  play(motion, cx) {
    if (!this.round) this.startRound();
    this.say = null;
    this.at = move(this.world, this.at, motion);
    this.moves += 1;
    this.idleAt = Date.now();
    // Gone the long way round: it winces once, as it happens.
    if (this.moves === this.need + 3) this.missAt = Date.now();
    if (same(this.at, this.target)) {
      const r = this.round, fine = this.moves <= this.need, streak = fine ? r.streak + 1 : 0;
      this.round = { ...r, score: r.score + points(this.moves, this.need, r.streak), hits: r.hits + 1, perfect: r.perfect + (fine ? 1 : 0), streak, longest: fine ? Math.max(r.longest, streak) : r.longest };
      this.last = { moves: this.moves, need: this.need, fine };
      // Only the fewest moves earn a jump; a streak of three or more, a wave.
      if (fine) { this.hitAt = Date.now(); this.cheer = streak >= 3; }
      if (this.round.hits >= TARGETS) { this.endRound(cx); cx.notify(); return; }
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

  line() {
    const r = this.round, o = this.over, now = Date.now();
    if (now - this.armed <= ARM_MS) return "Press Esc again to leave the dōjō.";
    if (this.say) return this.say;
    if (o) return o.kept ? (this.record ? "A new best! Enter to play again, n for the next level." : "Enter to play again, n for the next level.") : "Round stopped, not counted. Enter to start again.";
    if (/^[ftFT]$/.test(this.pending)) return `${this.pending}… now the letter to find.`;
    if (this.pending === "g") return "g… another g for the first line.";
    if (/^\d$/.test(this.pending)) return `${this.pending}… now h j k or l.`;
    if (!r) return now - (this.idleAt ?? now) > SLEEP_MS ? "Zzz. Any move wakes me." : `Make a move to start: ${TARGETS} targets, in as few moves as you can.`;
    const hint = now - this.idleAt >= HINT_MS ? shortest(this.world, this.at, this.target, this.level).first : null;
    if (hint) return `Try ${hint}.`;
    if (this.last) return this.last.fine ? (r.streak >= 3 ? `${r.streak} in a row in the fewest moves.` : "In the fewest moves.") : `${this.last.moves} moves; ${this.last.need} would do.`;
    return `This one takes ${this.need} at best.`;
  }

  grid(c, ink) {
    const { w, h } = this.world;
    return v_flex().gap(3).children(Array.from({ length: h }, (_, y) => h_flex().gap(3).children(Array.from({ length: w }, (_, x) => {
      const here = x === this.at.x && y === this.at.y, goal = x === this.target.x && y === this.target.y;
      return div().size(CELL).rounded(5).bg(here ? c.accent : c.text + "08").when(goal && !here, (el) => el.border_2().border_color(c.accent));
    }))));
  }

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

  cap(c, ink, key, word, hinted, sub = null) {
    const lit = this.lit?.key === key.toLowerCase();
    return v_flex().gap(3).items_center()
      .child(div().h(38).min_w(38).px(8).rounded(7).border_1()
        .border_color(lit || hinted ? c.accent : c.accent + "70").bg(lit ? c.accent : hinted ? c.accent + "40" : c.accent + "1c")
        .flex().items_center().justify_center().text_size(14).font_semibold().text_color(lit ? ink : c.text).child(key))
      .child(div().text_size(11).text_color(hinted ? c.accent : c.muted).child(word))
      .when(Boolean(sub), (el) => el.child(div().text_size(9.5).text_color(c.dim).child(sub)));
  }

  // The pet, at its reaction; a click chooses another.
  petView(t, c, now) {
    const asleep = this.mood() === "sleep";
    return v_flex().id("dojo-pet").gap(6).cursor_pointer().tooltip("Choose your pet")
      .hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => { this.toggleChooser(cx); cx.notify(); })
      .child(h_flex().h(128).gap(G.md).items_end()
        .child(this.pal.face(t, this.reaction(now).state, { now, since: this.reaction(now).since, mood: this.mood() }))
        .child(div().pb(4).text_size(11).text_color(c.dim).child(asleep ? "z z" : "")))
      .child(div().text_size(11.5).text_color(this.choosing ? c.accent : c.dim).child(this.pal.pet.name));
  }

  // Every pet: a click and it is the dōjō's.
  chooser(t, c, button) {
    return v_flex().id("dojo-pets").flex_1().min_w(0).min_h(0).gap(G.lg).overflow_y_scrollbar()
      .child(this.pal.grid(t, c, () => { this.choosing = false; }))
      .child(h_flex().pt(G.sm).child(button("pets-done", "Done  esc", () => { this.choosing = false; }, { strong: true })));
  }

  render() {
    const t = theme(), c = tokens(t), ink = t.accent_foreground ?? c.canvas;
    const lv = this.level, r = this.round, now = Date.now();
    const secs = (ms) => `${Math.floor(ms / 1000)}s`;
    const elapsed = r ? secs(now - r.at) : this.over ? secs(this.over.ms) : "0s";
    const done = r ? r.hits : this.over ? this.over.hits : 0;
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
        .on_click((_e, cx) => { if (!this.round) { this.setLevel(L.n); cx.notify(); } else { this.say = "Finish the round first, or End round."; cx.notify(); } })
        .child(div().w(14).text_size(11).font_semibold().text_color(on ? c.accent : c.dim).child(String(L.n)))
        .child(div().flex_1().text_size(12.5).text_color(on ? c.text : c.muted).child(L.name))
        .child(div().text_size(11).text_color(c.dim).child(b != null ? String(b) : ""));
    };
    const leaving = now - this.armed <= ARM_MS;
    const button = (id, text, act, { strong = false, warn = false } = {}) => div().id(id).h(32).px(14).rounded(8).flex().items_center().cursor_pointer()
      .border_1().border_color(strong ? c.accent : warn ? c.accent + "90" : c.border).bg(strong ? c.accent : warn ? c.accent + "24" : c.text + "08")
      .text_size(12.5).font_semibold().text_color(strong ? ink : c.text).hover((s) => s.opacity(0.85))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { act(); cx.notify(); })
      .child(text);
    // A new element each place it shows: an element can have one parent, and the result shows it beside the header's.
    const leave = (id) => button(id, leaving ? "Click again to leave" : "Leave the dōjō",
      () => { if (Date.now() - this.armed <= ARM_MS) closeOverlay(props()?.overlay); else this.armed = Date.now(); }, { warn: leaving });
    const o = this.over;
    const result = o ? v_flex().gap(G.lg).p(24).rounded(12).bg(c.accent + "10").border_1().border_color(c.accent + "50")
      .child(div().text_size(13).text_color(c.muted).child(o.kept ? `Level ${lv.n}: ${lv.name}, done` : "Round stopped"))
      .child(h_flex().gap(G.xl).items_end()
        .child(v_flex().gap(2).child(div().text_size(44).font_semibold().text_color(c.accent).child(String(o.score))).child(div().text_size(12).text_color(c.dim).child("points")))
        .child(stat("Targets", `${o.hits} / ${TARGETS}`))
        .child(stat("Fewest moves", `${o.perfect}`))
        .child(stat("Best streak", `${o.longest}`))
        .child(stat("Time", secs(o.ms))))
      .when(this.record, (el) => el.child(div().text_size(15).font_semibold().text_color(c.text).child("A new best for this level.")))
      .child(h_flex().gap(G.md).flex_wrap()
        .child(button("dojo-again", "Play again  ↩", () => this.again(), { strong: true }))
        .when(lv.n < LEVELS.length, (el) => el.child(button("dojo-next", `Next level: ${LEVELS[lv.n].name}  n`, () => this.setLevel(lv.n + 1))))
        .child(leave("dojo-leave-result"))) : null;
    return v_flex().id("kanso-dojo").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(44).px(16).gap(G.md).items_center().border_b_1().border_color(c.border)
        .child(svg("mods/kanso-chrome/icons/enso.svg").size(16).text_color(c.accent))
        .child(div().text_size(14).font_semibold().child("hjkl dōjō"))
        .child(div().text_size(12).text_color(c.dim).child(`level ${lv.n} · ${lv.name}`))
        .child(div().flex_1())
        .when(this.totals.rounds > 0, (el) => el.child(div().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(iconButton("dojo-share", "share", "Share", (cx) => this.share.toggle(cx), c, { active: this.share.open }))))
        .when(Boolean(r), (el) => el.child(button("dojo-end", "End round", () => this.endRound(null, false))))
        .child(leave("dojo-leave")))
      .child(h_flex().flex_1().min_h(0).items_start().gap(G.xl).p(20)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(v_flex().w(196).flex_none().gap(G.lg)
          .child(this.petView(t, c, now))
          .child(h_flex().gap(G.lg)
            .child(stat("Score", r ? r.score : this.over ? this.over.score : 0, true))
            .child(stat("Time", elapsed)))
          .child(h_flex().gap(G.lg)
            .child(stat("Streak", r ? r.streak : 0))
            .child(stat("Best", best ?? "–")))
          .child(v_flex().gap(2).children(LEVELS.map(levelRow))))
        .child(this.choosing ? this.chooser(t, c, button) : v_flex().flex_1().min_w(0).gap(G.lg)
          .when(this.share.open && this.totals.rounds > 0, (el) => el.child(this.share.row(c, async () => ({ ...dojoShare(this.totals, Date.now(), await this.pal.figure(theme(), this.share.workDir).catch(() => null)), name: "dojo", title: "hjkl dōjō" }),
            "Your best round, targets, days practiced and levels: nothing else. The post opens with the image in it.", G.sm)))
          .child(div().text_size(12.8).line_height(1.5).text_color(c.muted).child(lv.tip))
          .when(Boolean(result), (el) => el.child(result))
          .when(!result, (el) => el.child(div().p(14).rounded(12).bg(c.text + "05").border_1().border_color(c.border)
            .child(lv.world === "grid" ? this.grid(c, ink) : this.text(c, ink))))
          .child(h_flex().gap(6).items_center()
            .children(Array.from({ length: TARGETS }, (_, i) => div().h(6).flex_1().rounded_full().bg(i < done ? c.accent : c.text + "14")))
            .child(div().pl(G.sm).text_size(12).text_color(c.muted).child(`${done} / ${TARGETS}`)))
          .child(h_flex().min_h(40).px(14).py(10).rounded(10).bg(leaving ? c.accent + "30" : c.accent + "14").items_center()
            .child(div().text_size(13).line_height(1.45).text_color(c.text).child(this.line())))
          .child(keysRow)));
  }
}
